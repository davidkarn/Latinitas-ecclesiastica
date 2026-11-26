/**
 * words/{slug}.json — one file per slug, merging Wiktionary, Lewis & Short and Lexicon of St. Thomas
 * entries that share a lookup key. Also emits one form record per paradigm cell for the forms endpoint,
 * and returns a compact WordSummary for every Wiktionary entry (used by the texts endpoint).
 */
import path from "node:path";
import {
  lookupKey, paths, slug,
  type LewisShortEntry, type LexiconEntry, type LsSense, type WiktionaryEntry, type WordFile, type WordSummary,
} from "../api/index.ts";
import { Buckets, type Output } from "../lib/output.ts";
import { formOfIndex, lewisShortEntries, lexiconEntries, wiktionaryEntries } from "../sources/index.ts";

type WordRec =
  | { src: "w"; key: string; entry: WiktionaryEntry }
  | { src: "l"; key: string; entry: LewisShortEntry }
  | { src: "x"; key: string; entry: LexiconEntry };

/** One paradigm cell: form key, word slug, lemma key, word id, pos, tags (null for Wiktionary form-of pages) */
export type FormRec = { f: string; w: string; l: string; i: string | null; p: string; t: string[] | null };

/** Printed dictionaries write compounds with a hyphen ("tam-quam"); Wiktionary only uses hyphens for affixes. */
function printedKey(headword: string): string {
  return lookupKey(headword).replace(/(?<=\p{L})-(?=\p{L})/gu, "");
}

const bucketOf = (s: string) => s[0] ?? "_";

// ---------- summaries ----------

/** Wiktionary POS → substrings of Lewis & Short part-of-speech labels it can match */
const LS_POS: Record<string, string[]> = {
  noun: ["noun"], name: ["noun"], verb: ["verb", "v."], adj: ["adjective", "adj", "participle"],
  participle: ["participle"], adv: ["adverb", "adv"], conj: ["conjunction", "conj"], prep: ["prep"],
  pron: ["pronoun", "pron"], intj: ["interjection"], num: ["num"], det: ["pronoun", "pron", "adj"],
};

/**
 * Pick the Lewis & Short homograph that is the same word as a Wiktionary entry: dīcō, dīcere (L&S dico2,
 * "xi, ctum, 3") rather than dĭcō, dicāre (dico1, "āvi, ātum, 1"). Scores conjugation, the principal part /
 * genitive ending, part of speech, and vowel length on the headword.
 */
function pickLewisShort(entries: LewisShortEntry[], e: WiktionaryEntry): LewisShortEntry | undefined {
  if (!entries.length) return undefined;
  const want = LS_POS[e.pos] ?? [e.pos];
  const tags = new Set(e.senses.flatMap(s => s.tags ?? []));
  const conj = [...tags].map(t => t.match(/^conjugation-(\d)/)?.[1]).find(Boolean);
  const parts = e.principalParts.map(p => lookupKey(p.form));
  const marks = (s: string) => s.normalize("NFC").replace(/[ōŏ]$/, "o").replace(/ŭs$/, "us");
  const wiktWords = glossWords(e.senses.slice(0, 4).flatMap(s => s.glosses));
  let best: LewisShortEntry | undefined, bestScore = -1;
  for (const ls of entries) {
    let score = 0;
    const isNoun = e.pos === "noun" || e.pos === "name";
    if (ls.partOfSpeech ? want.some(w => ls.partOfSpeech!.includes(w)) : isNoun === !!ls.gender) score += 2;
    if (conj && ls.conjugation === Number(conj)) score += 3;
    const firstPart = ls.itype ? lookupKey(ls.itype.split(/[,\s]+/)[0]!) : "";
    if (firstPart && parts.some(p => p.endsWith(firstPart))) score += 2;
    if (marks(ls.headword).replace(/[^\p{L}]/gu, "") === marks(e.canonical)) score += 1;
    // Same meaning: caelum "sky" ↔ caelum2 "the sky, heaven", not caelum1 "the chisel"
    const shared = [...glossWords(lsGlosses(ls.senses))].filter(w => wiktWords.has(w)).length;
    if (shared) score += 3 + Math.min(shared, 3);
    if (score > bestScore) { best = ls; bestScore = score; }
  }
  return bestScore > 0 || entries.length === 1 ? best : undefined;
}

/** Italic runs in L&S are glosses but also grammar labels ("gen.", "voc. sing.", "conj.", "init.");
 *  a gloss must contain at least one word that is not such an abbreviation. */
const LS_ABBR = new Set(("gen dat acc abl voc nom sing plur pl pers indic subj subst pres praes imperf perf pluperf fut futur " +
  "imper imp inf part partt pass act dep conj init fin adv adj comp sup neutr masc fem lit prop transf trop poet " +
  "absol tempp perff supine freq inch esp cf id ib ii iii ellipt al gr sc etc sync syncop praet contr orig " +
  "pron praep prep advv dem demonstr demonstratives med neg rel interrog indef num interj sq sqq lat sanscr dub etym " +
  "v n m f a p clause object impers irr irreg comm dim dimin poss foll art lu posit superl").split(" "));
/** Latin words L&S italicizes to show a construction ("ut, ne", "cum", "alicui aliquid"): not English meanings */
const LS_LATIN = new Set(("ad ut ne cum de ab ex e per sub super inter atque ac et sed is ea id ce cine quantus tantus " +
  "alicui aliquid aliquem aliquis aliqua alicujus quod quia si num an ui non qui quae quis quam ubi aut vel neque nec " +
  "se sibi suus esse est sum habere re rem contra adversus erga apud pro prae ob propter quando ubi quo unde").split(" "));
/** A gloss needs one word that is neither of these, an abbreviation nor Latin ("of the demonstr" fails) */
const EN_FUNCTION = new Set("of the to a an and or with by in on at for from".split(" "));
/** Two-letter English words that can stand as a meaning */
const EN2 = new Set("to be go do in on at by up so no of or as if it he we me my us".split(" "));

function isGloss(g: string): boolean {
  const t = g.trim().replace(/[\s.,;:]+$/, "");
  if ((t.match(/\(/g) ?? []).length !== (t.match(/\)/g) ?? []).length) return false;   // "(2d pers."
  if (/(^|\s)\p{L}{1,7}\.\s/u.test(t)) return false;                                     // "Perf. sync", "v. facio fin"
  if (/-(clause|sentence)$/.test(t)) return false;                                      // "rel.-clause", "subject-sentence"
  const words = t.normalize("NFD").replace(/\p{M}/gu, "").split(/[\s.,;:()\d—–-]+/).filter(Boolean).map(w => w.toLowerCase());
  if (words.length === 1 && words[0]!.length <= 2 && !EN2.has(words[0]!)) return false; // "ui"
  return words.some(w => w.length > 1 && !LS_ABBR.has(w) && !LS_LATIN.has(w) && !EN_FUNCTION.has(w));
}

/** Drops leading grammar labels L&S runs into a gloss: "Act., to move" → "to move" */
function stripLabels(g: string): string {
  let t = g.trim().replace(/^[—–-]+\s*/, "");
  for (let m; (m = /^(\p{L}{1,8})\.[\s,—–-]*/u.exec(t)) && LS_ABBR.has(m[1]!.toLowerCase());) t = t.slice(m[0].length);
  return t.replace(/[\s.,;:]+$/, "");
}

/** Content words of English glosses, for matching homographs across dictionaries. */
const STOP = new Set("with from that this which into upon about other their them have been make made also used".split(" "));
function glossWords(glosses: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const g of glosses) for (const w of g.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!STOP.has(w)) out.add(w);
  return out;
}
function lsGlosses(senses: LsSense[], depth = 0, acc: string[] = []): string[] {
  for (const s of senses) {
    if (s.glosses) acc.push(...s.glosses.filter(isGloss));
    if (s.senses && depth < 1) lsGlosses(s.senses, depth + 1, acc);
  }
  return acc;
}

/** Citations in an L&S entry: a proxy for how common the word is in classical Latin. */
export function lsWeight(e: LewisShortEntry): number {
  const count = (ss: LsSense[]): number => ss.reduce((n, s) => n + (s.examples?.length ?? 0) + count(s.senses ?? []), 0);
  return count(e.senses);
}

/** First gloss-bearing sense, as a short comma-separated definition. */
export function shortDefinition(senses: LsSense[]): string | undefined {
  const walk = (ss: LsSense[]): LsSense | undefined => {
    for (const s of ss) {
      if (s.glosses?.some(isGloss)) return s;
      const deeper = s.senses && walk(s.senses);
      if (deeper) return deeper;
    }
  };
  const s = walk(senses);
  if (!s) {
    // No italic glosses: use the first sense's text only if it reads as a plain definition
    // ("to have an ill smell, to stink"), not grammar notes ("fin.", "v. the foll. art.")
    const text = senses[0]?.definition?.trim().replace(/[\s.,;:—-]+$/, "");
    return text && text.length <= 120 && !/\p{L}{1,7}\.(\s|,|$)/u.test(text) && isGloss(text) ? text : undefined;
  }
  const glosses: string[] = [];
  const raw = s.glosses!.map(stripLabels);
  for (let i = 0; i < raw.length; i++) {
    let g = raw[i]!;
    // L&S sets "of or belonging to" with "or" in roman, so the italics split into "of" + "belonging to"
    if (/^of$/i.test(g) && raw[i + 1] && isGloss(raw[i + 1]!)) g = `${g} or ${raw[++i]}`;
    if (g.length > 1 && isGloss(g) && !glosses.includes(g)) glosses.push(g);
  }
  // "easily appeased, placable" already says "placable"
  const whole = glosses.filter(g => !glosses.some(u => u !== g && u.split(/[,;]\s*/).includes(g)));
  return whole.length ? whole.slice(0, 5).join(", ") : undefined;
}

const GENDERS = ["masculine", "feminine", "neuter"];
const CLASS_TAG = /^(declension|conjugation)-(\d|irreg)/;
const ORDINAL: Record<string, string> = { "1": "first", "2": "second", "3": "third", "4": "fourth", "5": "fifth" };

function summarize(e: WiktionaryEntry, key: string, ls: LewisShortEntry[], weights: Map<string, number>): WordSummary {
  const tags = new Set(e.senses.flatMap(s => s.tags ?? []));
  const gender = GENDERS.filter(g => tags.has(g));
  let inflectionClass = e.head?.split(";").slice(1).join(";").trim() || undefined;
  if (!inflectionClass) {
    const t = [...tags].map(t => t.match(CLASS_TAG)).find(Boolean);
    if (t) inflectionClass = t[2] === "irreg" ? "irregular" : `${ORDINAL[t[2]!] ?? t[2]} ${t[1]}`;
  }
  const lsEntry = pickLewisShort(ls, e);
  const lsDef = lsEntry && shortDefinition(lsEntry.senses);
  if (lsEntry) weights.set(e.id, lsWeight(lsEntry));
  return {
    id: e.id,
    file: paths.word(key),
    key,
    lemma: e.canonical,
    pos: e.pos,
    ...(e.head && { head: e.head }),
    ...(inflectionClass && { inflectionClass }),
    ...(gender.length && { gender }),
    principalParts: [{ form: e.canonical, tags: ["canonical"] }, ...e.principalParts],
    ...(lsEntry && { lewisShort: { key: lsEntry.key, ...(lsDef && { definition: lsDef }) } }),
    ...(e.senses[0]?.glosses[0] && { gloss: e.senses[0].glosses[0] }),
    ...(e.altOf && { altOf: e.altOf.map(lemma => ({ lemma })) }),
  };
}

// ---------- generation ----------

export function generateWords(out: Output, forms: Buckets<FormRec>) {
  const words = new Buckets<WordRec>(path.join(out.tmp, "words"));

  for (const { word, ...entry } of wiktionaryEntries()) {
    const key = lookupKey(word);
    const w = slug(key);
    words.add(bucketOf(w), { src: "w", key, entry });
    const cells = [{ form: entry.canonical, tags: ["canonical"] }, ...entry.principalParts, ...entry.forms];
    for (const { form, tags } of cells) {
      if (form.includes("+")) continue; // "amātus + present active indicative of sum"
      const f = lookupKey(form);
      forms.add(bucketOf(slug(f)), { f, w, l: key, i: entry.id, p: entry.pos, t: tags });
    }
  }
  for (const entry of lewisShortEntries()) {
    const key = printedKey(entry.headword);
    words.add(bucketOf(slug(key)), { src: "l", key, entry });
  }
  for (const entry of lexiconEntries()) {
    const key = printedKey(entry.headword);
    words.add(bucketOf(slug(key)), { src: "x", key, entry });
  }
  // Form-of / alternative-form pages: lemma key → the lemma keys it points to (conpello → compello)
  const aliases = new Map<string, Set<string>>();
  for (const [form, hits] of formOfIndex()) {
    const f = lookupKey(form);
    for (const [lemma, pos, tagSets] of hits) {
      const l = lookupKey(lemma);
      for (const t of tagSets.length ? tagSets : [null]) forms.add(bucketOf(slug(f)), { f, w: slug(l), l, i: null, p: pos, t });
      if (l !== f) (aliases.get(f) ?? aliases.set(f, new Set()).get(f)!).add(l);
    }
  }

  const summaries = new Map<string, WordSummary>();
  const weights = new Map<string, number>();
  let files = 0, wiktionary = 0, lewisShort = 0, lexicon = 0;
  for (const bucket of words.names()) {
    const bySlug = new Map<string, Map<string, WordFile["words"][number]>>();
    for (const rec of words.read(bucket)) {
      const s = slug(rec.key);
      let keys = bySlug.get(s);
      if (!keys) bySlug.set(s, (keys = new Map()));
      let word = keys.get(rec.key);
      if (!word) keys.set(rec.key, (word = { key: rec.key, wiktionary: [], lewisShort: [], lexicon: [] }));
      if (rec.src === "w") { word.wiktionary.push(rec.entry); wiktionary++; }
      else if (rec.src === "l") { word.lewisShort.push(rec.entry); lewisShort++; }
      else { word.lexicon.push(rec.entry); lexicon++; }
    }
    for (const [s, keys] of bySlug) {
      const file: WordFile = { slug: s, words: [...keys.values()].sort((a, b) => a.key.localeCompare(b.key)) };
      for (const w of file.words) {
        w.lewisShort.sort((a, b) => String(a.homograph ?? "").localeCompare(String(b.homograph ?? "")));
        for (const e of w.wiktionary) summaries.set(e.id, summarize(e, w.key, w.lewisShort, weights));
      }
      out.json(paths.word(s), file);
      files++;
    }
  }
  return {
    counts: { wordFiles: files, wiktionaryEntries: wiktionary, lewisShortEntries: lewisShort, lexiconEntries: lexicon },
    summaries,
    weights,
    aliases,
  };
}
