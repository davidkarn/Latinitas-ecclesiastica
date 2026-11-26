/**
 * grammar.json, plus notes from Plater & White's Grammar of the Vulgate attached to verses:
 *   - "cited": the grammar cites the verse; the Latin it quotes is matched to the verse's words
 *   - "construction": a construction the grammar describes, found by pattern wherever it occurs
 * Every note quotes the book; the reader links to the whole section.
 * Input: resources/text/plater_white/grammar.json (scripts/convert_grammar.py).
 */
import fs from "node:fs";
import path from "node:path";
import { lookupKey, paths, type GrammarFile, type GrammarNote, type Token } from "../api/index.ts";
import type { Output } from "../lib/output.ts";

const FILE = path.resolve(import.meta.dirname, "../../resources/text/plater_white/grammar.json");

interface Citation {
  text: string; chapter: number; verse: number; section: number;
  clause: string; quotes: string[]; lead: string; in: "text" | "footnote";
}
export interface Grammar extends GrammarFile { citations: Citation[] }

export function loadGrammar(): Grammar | undefined {
  if (!fs.existsSync(FILE)) {
    console.warn(`${FILE} not found: run python3 -I scripts/convert_grammar.py; skipping grammar notes`);
    return undefined;
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8")) as Grammar;
}

export function writeGrammar(out: Output, g: Grammar) {
  const { citations: _, ...file } = g;
  out.json(paths.grammar(), file satisfies GrammarFile);
}

const plain = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").replace(/\s+([,.;:)])/g, "$1").trim();

// ---------- matching the book's Latin to the Clementine text ----------

/** The grammar quotes the Oxford Vulgate (uespere, inluminent); the Clementine text has vespere, illuminent. */
const ASSIMILATION: [RegExp, string][] = [
  [/^inl/, "ill"], [/^inm/, "imm"], [/^inr/, "irr"], [/^inp/, "imp"], [/^inb/, "imb"],
  [/^conl/, "coll"], [/^conm/, "comm"], [/^conr/, "corr"], [/^conp/, "comp"], [/^conb/, "comb"],
  [/^adp/, "app"], [/^adf/, "aff"], [/^adc/, "acc"], [/^ads/, "ass"], [/^adt/, "att"], [/^adl/, "all"],
  [/^adr/, "arr"], [/^adg/, "agg"], [/^obp/, "opp"], [/^subp/, "supp"], [/^subm/, "summ"],
];
export function norm(w: string): string {
  let k = lookupKey(w).replace(/[^a-z]/g, "").replace(/v/g, "u").replace(/y/g, "i").replace(/h/g, "");
  for (const [re, to] of ASSIMILATION) k = k.replace(re, to);
  return k.replace(/(.)\1/g, "$1");
}

function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  // one edit apart
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Token indices of a quotation in the verse (words in order, small gaps allowed; "..." allows a long gap). */
export function findQuote(quote: string, verse: string[]): number[] {
  const words: { w: string; gap: boolean }[] = [];
  let gap = false;
  for (const raw of quote.split(/\s+/)) {
    if (/^[.…]+$/.test(raw) || /^\.{3}|…/.test(raw)) { gap = true; continue; }   // "...", "…", or ". . ." split up
    const w = norm(raw);
    if (w) { words.push({ w, gap }); gap = false; }
  }
  if (!words.length) return [];
  let best: number[] = [];
  // The verse may differ at the start ("ore ad os" for the grammar's "os ad os"): try each quoted word as the anchor
  for (let k = 0; k < words.length; k++) for (let i = 0; i < verse.length; i++) {
    if (!close(verse[i]!, words[k]!.w)) continue;
    const got = [i];
    let at = i;
    for (const { w, gap } of words.slice(k + 1)) {
      const limit = Math.min(verse.length, at + 1 + (gap ? 12 : 3));
      for (let j = at + 1; j < limit; j++) if (close(verse[j]!, w)) { got.push(j); at = j; break; }
    }
    if (got.length > best.length) best = got;
  }
  const enough = words.length === 1 ? best.length === 1 : best.length >= 2 && best.length / words.length >= 0.6;
  if (enough) return best;
  // A list of words ("Nullus, nullum"): any of them
  return quote.includes(",") ? [...new Set(quote.split(/,\s*/).flatMap(q => q.trim().split(/\s+/).length === 1 ? findQuote(q, verse) : []))] : [];
}

// ---------- construction rules ----------

interface Tok {
  key: string;        // lookup key of the word as written
  lemma: string;      // lookup key of its (best-guess) lemma
  pos: string;
  tags: Set<string>;  // every tag of every analysis
  properName: boolean;
  /** Punctuation between this token and the next */
  pause: boolean;
}

function toks(tokens: Token[], latin: string): Tok[] {
  return tokens.map((t, i) => ({
    key: t.form,
    lemma: t.wordId?.split(":")[0] ?? "",
    pos: t.wordId?.split(":")[1] ?? "",
    tags: new Set(t.analyses.flat()),
    properName: !!t.properName,
    pause: i + 1 < tokens.length && /[,;:.?!]/.test(latin.slice(t.offset + t.text.length, tokens[i + 1]!.offset)),
  }));
}
/** No punctuation between tokens i and j */
const sameClause = (t: Tok[], i: number, j: number) => t.slice(Math.min(i, j), Math.max(i, j)).every(x => !x.pause);
const NOMINAL = new Set(["noun", "pron", "name", "det", "num", "adj"]);

const finite = (t: Tok | undefined) => !!t && t.pos === "verb" && ["first-person", "second-person", "third-person"].some(p => t.tags.has(p));

interface Rule {
  id: string;
  section: number;
  label: string;
  /** Excerpt from the section: [from, to] snippets of one paragraph, inclusive ("to" omitted = to the end) */
  excerpt: [string, string?][];
  /** Only the first match in a chapter gets the note */
  oncePerChapter?: boolean;
  match(t: Tok[]): number[][];
}

const FACTITIVE = new Set(("uxor signum gens populus servus ancilla testimonium cibus esca possessio hereditas memoria " +
  "holocaustum foedus nihilum praeda lapis sanctificatio abominatio exemplum fabula proverbium sibilus desolatio").split(" "));
const MAKING = new Set("sum fio facio pono do accipio constituo sumo statuo converto verto dono trado erigo".split(" "));
const PERCEIVING = new Set("video scio cognosco audio intellego intelligo sentio nescio animadverto".split(" "));
const SPEAKING = new Set("loquor dico praecipio respondeo clamo voco mando nuntio".split(" "));

const RULES: Rule[] = [
  {
    id: "cognate-participle", section: 26, label: "Participle strengthening its own verb (Hebraism)",
    excerpt: [["(i) The present participle", "Gen. 22. 17."]],
    match: t => t.flatMap((x, i) => {
      const n = t[i + 1];
      return /(ns|ntes)$/.test(x.key) && finite(n) && x.key.slice(0, 4) === n!.key.slice(0, 4) ? [[i, i + 1]] : [];
    }),
  },
  {
    id: "cognate-ablative", section: 26, label: "Cognate ablative: “dying you shall die” (Hebraism)",
    excerpt: [["(ii) The ablative of the cognate noun", "Lk. 22. 15"]],
    match: t => t.flatMap((x, i) => [i - 1, i + 1].flatMap(j => {
      const v = t[j];
      return x.pos === "noun" && x.tags.has("ablative") && finite(v) && x.lemma !== v!.lemma
        && x.lemma.length >= 3 && x.lemma.slice(0, 3) === v!.lemma.slice(0, 3) ? [[Math.min(i, j), Math.max(i, j)]] : [];
    })),
  },
  {
    id: "eo-quod", section: 88, label: "eo quod = because",
    excerpt: [["eo quod", "frequently."]],
    match: t => t.flatMap((x, i) => x.key === "eo" && t[i + 1]?.key === "quod" ? [[i, i + 1]] : []),
  },
  {
    id: "factum-est-adverb", section: 95, label: "Adverb as predicate: factum est vespere",
    excerpt: [["Such adverbs as bene", "Mt. 20. 8."]],
    match: t => t.flatMap((x, i) => {
      const j = t[i + 1]?.key === "est" ? i + 2 : -1;
      return /^factum(que)?$/.test(x.key) && j > 0 && ["vespere", "mane"].includes(t[j]?.key ?? "") ? [[i, i + 1, j]] : [];
    }),
  },
  {
    id: "factum-est", section: 134, label: "factum est opening a narrative (“and it came to pass”)",
    excerpt: [["Frequently in the narrative portions", "Mt. 13. 53"]],
    match: t => t.flatMap((x, i) => {
      // "Factum est autem, cum …", "factum est ut …": not "factum est omne tempus" (= was) or "factum est vespere"
      if (!/^factum(que)?$/.test(x.key) || t[i + 1]?.key !== "est" || i > 2) return [];
      const next = t[i + 2]?.key ?? "", after = t[i + 3]?.key ?? "";
      if (["vespere", "mane"].includes(after) || ["vespere", "mane", "ita", "sic"].includes(next)) return [];
      return t[i + 1]!.pause || ["autem", "ergo", "igitur", "vero", "cum", "ut", "postquam"].includes(next) ? [[i, i + 1]] : [];
    }),
  },
  {
    id: "ecce", section: 108, label: "Nominative after ecce",
    excerpt: [["A similar use of the nominative is found after ecce", "Isa. 8. 18."]],
    match: t => t.flatMap((x, i) => {
      if (x.key !== "ecce" || x.pause) return [];
      const j = ["autem", "enim", "vero", "ergo"].includes(t[i + 1]?.key ?? "") ? i + 2 : i + 1;
      const n = t[j];
      return n && NOMINAL.has(n.pos) && n.tags.has("nominative") && !finite(t[j + 1]) ? [[i, j]] : [];
    }),
  },
  {
    id: "coram", section: 117, label: "coram = before, in the presence of",
    excerpt: [["coram = ", "Old Test."]],
    match: t => t.flatMap((x, i) => x.key === "coram" ? [[i]] : []),
  },
  {
    id: "addidit", section: 28, label: "“Add” for repeated action (Hebraism)",
    excerpt: [["(c) Repeated action", "Lk. 20. 11, 12"], ["We similarly say in English", "'He added sin to sin'."]],
    match: t => t.flatMap((x, i) => {
      if (!["addo", "adicio", "appono"].includes(x.lemma) || !finite(x)) return [];
      for (let j = i + 1; j <= i + 3 && j < t.length; j++) if (t[j]!.key === "ut" || t[j]!.tags.has("infinitive")) return [[i, j]];
      return [];
    }),
  },
  {
    id: "dicens", section: 19, label: "dicens, “saying”, introducing speech",
    excerpt: [["The Hebrew word for 'saying' is also used loosely", "(Apoc. 14. 6, 7; cf. 11. 1)."]],
    match: t => t.flatMap((x, i) => ["dicens", "dicentes"].includes(x.key) && t.slice(0, i).some(y => SPEAKING.has(y.lemma)) ? [[i]] : []),
  },
  {
    id: "in-factitive", section: 22, label: "in + accusative = as, for, to be (Hebraism)",
    excerpt: [["(1) In with acc. in factitive sense", "Gen. 1. 14"]],
    match: t => !t.some(x => MAKING.has(x.lemma)) ? [] : t.flatMap((x, i) => {
      for (let j = i + 1; j <= i + 2 && j < t.length; j++) {
        if (x.key === "in" && FACTITIVE.has(t[j]!.lemma) && t[j]!.tags.has("accusative")) return [[i, j]];
      }
      return [];
    }),
  },
  {
    id: "dies-unus", section: 23, label: "Cardinal for ordinal: dies unus = the first day",
    excerpt: [["Cardinal for Ordinal", "Gen. 1. 5"]],
    match: t => t.flatMap((x, i) => x.key === "unus" && t[i - 1]?.key === "dies" ? [[i - 1, i]] : []),
  },
  {
    id: "omnis-non", section: 23, label: "non … omnis = no, none",
    excerpt: [["Omnis... non or non... omnis = no", "Ecclus. 33. 21"]],
    match: t => t.flatMap((x, i) => {
      // "omne fermentatum non comedetis" / "non comederetis de omni ligno": within one clause
      if (x.key !== "non") return [];
      for (let j = Math.max(0, i - 4); j <= i + 3 && j < t.length; j++) {
        const between = t.slice(Math.min(i, j) + 1, Math.max(i, j));
        if (j !== i && t[j]!.lemma === "omnis" && sameClause(t, i, j) && !between.some(b => b.lemma === "qui")) {
          return [[Math.min(i, j), Math.max(i, j)]];   // not "omnia quae non fuerint" (= all that are not)
        }
      }
      return [];
    }),
  },
  {
    id: "verba-sentiendi", section: 134, label: "quod / quia after verbs of seeing and knowing",
    excerpt: [["(2) After Verbs denoting some activity of the senses", "( Verba sentiendi )"],
      ["Sometimes the Subject of the Subordinate Clause", "Gen. 1. 4"], ["The Old Testament, as may be seen", "prefers the Subjunctive."]],
    match: t => t.flatMap((x, i) => {
      if (!PERCEIVING.has(x.lemma) || x.pos !== "verb") return [];
      for (let j = i + 1; j <= i + 4 && j < t.length; j++) if (["quod", "quia", "quoniam"].includes(t[j]!.key)) return [[i, j]];
      return [];
    }),
  },
  {
    id: "hebrew-names", section: 13, label: "Hebrew proper names: often indeclinable", oncePerChapter: true,
    excerpt: [["The usual declension is the 3rd", "have the abl. in - e"], ["Abraham sometimes has gen. and dat. Abrahae", "is indeclinable."]],
    match: t => t.flatMap((x, i) => x.properName ? [[i]] : []),
  },
];

// ---------- notes ----------

/** A clause as cut from its paragraph: no footnote number or "§ n." in front, no dangling ")" from a parenthesis
 *  that opened before it ("κατά ): 'ad imaginem nostram'") */
function tidyClause(c: string): string {
  let t = c.replace(/^\d+\s+/, "").replace(/^§\s*\d+\.\s*/, "");
  const close = t.indexOf(")"), open = t.indexOf("(");
  if (close >= 0 && (open < 0 || close < open) && close < 60) t = t.slice(close + 1);
  return t.replace(/^[\s,;:.]+/, "").trim();
}

export class GrammarNotes {
  private bySection = new Map<number, string[]>();      // plain paragraphs of each section
  private topic = new Map<number, string>();
  private cited = new Map<string, Citation[]>();
  private excerpts = new Map<string, string>();
  counts = { cited: 0, citedMatched: 0, construction: 0 };

  constructor(g: Grammar) {
    for (const s of g.sections) {
      this.topic.set(s.n, s.topic);
      this.bySection.set(s.n, [...s.blocks.map(b => plain(b.html)), ...s.footnotes.map(plain)]);
    }
    for (const c of g.citations) {
      const k = `${c.text}:${c.chapter}:${c.verse}`;
      (this.cited.get(k) ?? this.cited.set(k, []).get(k)!).push(c);
    }
    for (const r of RULES) this.excerpts.set(r.id, r.excerpt.map(([from, to]) => this.find(r.section, from, to)).join(" … "));
  }

  /** Text of a section from `from` through `to`; throws if the OCR text no longer contains them */
  private find(section: number, rawFrom: string, rawTo?: string): string {
    const from = plain(rawFrom), to = rawTo && plain(rawTo);   // same spacing rules as the paragraphs
    for (const p of this.bySection.get(section) ?? []) {
      const a = p.indexOf(from);
      if (a < 0) continue;
      const b = to ? p.indexOf(to, a) : p.length;
      if (to && b < 0) continue;
      return p.slice(a, to ? b + to.length : undefined).replace(/^§\s*\d+\.\s*/, "").trim();
    }
    throw new Error(`grammar § ${section}: excerpt "${rawFrom}" … "${rawTo ?? ""}" not found`);
  }

  /** Notes for one verse. `seen` is shared across a chapter (for once-per-chapter rules). */
  notesFor(text: string, chapter: number, verse: number, latin: string, tokens: Token[], seen: Set<string>): GrammarNote[] {
    const notes: GrammarNote[] = [];
    const words = tokens.map(t => norm(t.text));
    const lemmas = tokens.map(t => norm(t.wordId?.split(":")[0] ?? ""));
    // A single cited word ("facies") also matches its other forms in the verse ("faciem")
    const locate = (q: string) => {
      const hit = findQuote(q, words);
      if (hit.length || /\s/.test(q.trim())) return hit;
      const k = norm(q);
      return lemmas.flatMap((l, i) => (l && l === k ? [i] : []));
    };

    for (const c of this.cited.get(`${text}:${chapter}:${verse}`) ?? []) {
      const idx = [...new Set(c.quotes.flatMap(locate))].sort((a, b) => a - b);
      const clause = tidyClause(c.clause);
      const lead = c.lead && !clause.includes(c.lead) && !/^[\d(.,;]/.test(c.lead) ? `${c.lead} ` : "";
      let body = `${lead}${clause}`.trim();
      if (body.length > 480) body = `${body.slice(0, 477).replace(/\s+\S*$/, "")}…`;
      const same = notes.find(n => n.section === c.section && n.text === body);
      if (same) { same.tokens = [...new Set([...same.tokens, ...idx])].sort((a, b) => a - b); continue; }
      notes.push({ section: c.section, topic: this.topic.get(c.section) ?? "", text: body, tokens: idx, source: "cited" });
      this.counts.cited++;
      if (idx.length) this.counts.citedMatched++;
    }

    const t = toks(tokens, latin);
    for (const r of RULES) {
      for (const idx of r.match(t)) {
        if (r.oncePerChapter) {
          const k = r.id;   // e.g. one note on Hebrew names per chapter, on the first one
          if (seen.has(k)) continue;
          seen.add(k);
        }
        // The grammar's own note on this verse already covers it: lend it the words if it found none
        const cited = notes.find(n => n.section === r.section && n.source === "cited");
        if (cited) {
          if (!cited.tokens.length) { cited.tokens = idx; this.counts.citedMatched++; }
          continue;
        }
        if (notes.some(n => n.section === r.section && n.tokens.some(i => idx.includes(i)))) continue;
        notes.push({ section: r.section, topic: this.topic.get(r.section) ?? "", label: r.label,
          text: this.excerpts.get(r.id)!, tokens: idx, source: "construction" });
        this.counts.construction++;
      }
    }
    return notes;
  }
}
