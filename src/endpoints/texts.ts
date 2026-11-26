/**
 * texts/index.json + texts/{text}/{chapter}.json — parallel Latin/English verses with audio clips,
 * per-word timings, and a word id for every token.
 *
 * Choosing among ambiguous parses ("regis": rēx or regō) is heuristic:
 *   - book-wide evidence: a word that some other token can *only* be counts strongly, any candidacy a little
 *   - part of speech prior (affixes and phrases almost never; proper names only when capitalized)
 *   - frequency proxy: the number of citations in the word's Lewis & Short entry
 *   - the token being the headword itself; 2nd-person/imperative-only parses are discounted
 * Every other parse is kept in Token.alternatives so the UI can offer them.
 */
import path from "node:path";
import {
  lookupCandidates, lookupKey, paths,
  type ChapterFile, type FormHit, type TextIndex, type Token, type Verse, type WordSummary,
} from "../api/index.ts";
import type { Output } from "../lib/output.ts";
import type { GrammarNotes } from "./grammar.ts";
import { AUDIO_DIR, availableTexts, englishVerses, vulgateVerses, type AlignedVerse, type TextDef } from "../sources/texts.ts";

export interface LoadedText {
  def: TextDef;
  verses: AlignedVerse[];
  english: Map<string, string>;
}

export function loadTexts(): LoadedText[] {
  return availableTexts().map(def => ({ def, verses: vulgateVerses(def.vulgateBook), english: englishVerses(def.englishBook) }));
}

const tokenWords = (v: AlignedVerse) => v.words.map(w => w.word);

/** Every lookup key a token could need, so the forms pass can hand back their hits. */
export function wantedForms(texts: LoadedText[]): Set<string> {
  const want = new Set<string>();
  for (const t of texts) for (const v of t.verses) for (const w of tokenWords(v)) for (const c of lookupCandidates(w)) want.add(c);
  return want;
}

const POS_PRIOR: Record<string, number> = {
  verb: 1, noun: 1, adj: 1, adv: 1, participle: 0.9, num: 1, conj: 1.2, prep: 1.2, pron: 1.1, det: 1.1,
  name: 0.6, intj: 0.5,
};
const MAX_ALTERNATIVES = 5;

interface Resolved { form: string; enclitic?: string; hits: FormHit[] }

function resolve(word: string, forms: Map<string, FormHit[]>): Resolved {
  const cands = lookupCandidates(word);
  for (const c of cands) {
    const hits = forms.get(c);
    if (hits?.length) return { form: c, ...(c !== cands[0] && { enclitic: cands[0]!.slice(c.length) }), hits };
  }
  return { form: cands[0]!, hits: [] };
}

export function generateTexts(
  out: Output,
  texts: LoadedText[],
  forms: Map<string, FormHit[]>,
  summaries: Map<string, WordSummary>,
  /** L&S citation counts by word id: a frequency proxy */
  weights: Map<string, number> = new Map(),
  /** Notes from Plater & White's Grammar of the Vulgate */
  grammar?: GrammarNotes,
) {
  const index: TextIndex = { texts: [] };
  let tokens = 0, unknown = 0, ambiguous = 0, audio = 0;

  for (const { def, verses, english } of texts) {
    // Pass 1: book-wide evidence for each word id
    const resolved = new Map<AlignedVerse, Resolved[]>();
    const only = new Map<string, number>(), seen = new Map<string, number>();
    const formByHit = new Map<FormHit, string>();
    for (const v of verses) {
      const rs = tokenWords(v).map(w => resolve(w, forms));
      resolved.set(v, rs);
      for (const r of rs) {
        for (const h of r.hits) formByHit.set(h, r.form);
        if (r.hits.length === 1) only.set(r.hits[0]!.id, (only.get(r.hits[0]!.id) ?? 0) + 1);
        for (const h of r.hits) seen.set(h.id, (seen.get(h.id) ?? 0) + 1);
      }
    }
    const formOf = (h: FormHit) => formByHit.get(h) ?? "";
    const score = (h: FormHit, capitalizedMidVerse: boolean): number => {
      const s = summaries.get(h.id);
      let p = POS_PRIOR[h.pos] ?? 0.05;
      if (h.pos === "name" && capitalizedMidVerse) p = 1.5;
      if (s && /^\p{Lu}/u.test(s.lemma) && !capitalizedMidVerse) p *= 0.3;
      p *= 1 + Math.log1p(weights.get(h.id) ?? 0) / 2;   // common words have long L&S entries
      if (h.analyses.length) p *= 1.2;
      // The token is the word's own headword (inanis → inānis, not inaniō "you empty")
      if (h.analyses.some(a => a.includes("canonical")) || (s && lookupKey(s.lemma) === h.lemma && h.lemma === formOf(h))) p *= 2;
      // Narrative prose rarely addresses "you": 2nd-person and imperative-only parses are unlikely
      if (h.analyses.length && h.analyses.every(a => a.includes("second-person") || a.includes("imperative"))) p *= 0.4;
      // An adjective matched only through its adverb ("super" as superus → [adverb]) is a weak parse
      if (h.analyses.length && h.analyses.every(a => a.length === 1 && a[0] === "adverb")) p *= 0.3;
      return p * (1 + 3 * (only.get(h.id) ?? 0) + (seen.get(h.id) ?? 0));
    };

    // Pass 2: chapter files
    const chapters = new Map<number, AlignedVerse[]>();
    for (const v of verses) (chapters.get(v.chapter) ?? chapters.set(v.chapter, []).get(v.chapter)!).push(v);
    const chapterList: TextIndex["texts"][number]["chapters"] = [];

    for (const [chapter, cvs] of chapters) {
      const words: Record<string, WordSummary> = {};
      const use = (id: string) => { const s = summaries.get(id); if (s) words[id] = s; };
      const out_verses: Verse[] = [];
      const latinNums = new Set(cvs.map(v => v.verse));
      const seen = new Set<string>();   // once-per-chapter grammar notes

      for (const v of cvs) {
        // English: this verse, plus any following English verses the Latin merges into it
        const englishNums = [v.verse];
        for (let n = v.verse + 1; !latinNums.has(n) && english.has(`${chapter}:${n}`); n++) englishNums.push(n);
        const englishText = englishNums.map(n => english.get(`${chapter}:${n}`) ?? "").join(" ").trim();

        let cursor = 0;
        const toks: Token[] = v.words.map((w, i) => {
          const r = resolved.get(v)![i]!;
          const at = v.text.indexOf(w.word, cursor);
          const offset = at >= 0 ? at : cursor;
          cursor = offset + w.word.length;
          const capitalizedMidVerse = i > 0 && /^\p{Lu}/u.test(w.word);
          const ranked = [...r.hits].sort((a, b) => score(b, capitalizedMidVerse) - score(a, capitalizedMidVerse));
          const [best, ...rest] = ranked;
          tokens++;
          if (!best) unknown++;
          if (rest.length) ambiguous++;
          if (best) use(best.id);
          const alternatives = rest.slice(0, MAX_ALTERNATIVES).map(h => { use(h.id); return { wordId: h.id, analyses: h.analyses }; });
          return {
            text: w.word,
            offset,
            start: w.start,
            end: w.end,
            wordId: best?.id ?? null,
            form: r.form,
            ...(r.enclitic && { enclitic: r.enclitic }),
            analyses: best?.analyses ?? [],
            ...(!best && /^\p{Lu}/u.test(w.word) && { properName: true as const }),
            ...(alternatives.length && { alternatives }),
          };
        });

        let audioRef: Verse["audio"] = null;
        if (v.audio_file) {
          const rel = paths.audio(`vulgate/${v.audio_file}`);
          out.link(rel, path.join(AUDIO_DIR, v.audio_file));
          audioRef = { file: rel, duration: v.duration };
          audio++;
        }
        const notes = grammar?.notesFor(def.id, chapter, v.verse, v.text, toks, seen) ?? [];
        out_verses.push({
          verse: v.verse,
          ref: v.ref,
          latin: v.text,
          english: englishText,
          ...(englishNums.length > 1 && { englishVerses: englishNums }),
          audio: audioRef,
          tokens: toks,
          ...(notes.length && { notes }),
        });
      }

      const file: ChapterFile = { text: def.id, title: def.title, chapter, verses: out_verses, words, sources: def.sources };
      out.json(paths.chapter(def.id, chapter), file);
      chapterList.push({ chapter, verses: out_verses.length, file: paths.chapter(def.id, chapter) });
    }
    index.texts.push({ id: def.id, title: def.title, chapters: chapterList, sources: def.sources });
  }

  out.json(paths.texts(), index);
  return { tokens, unknownTokens: unknown, ambiguousTokens: ambiguous, audioFiles: audio };
}
