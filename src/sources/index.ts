/**
 * Readers for the converted dictionary JSON (produced by scripts/convert_*.py) and mapping into API types.
 */
import fs from "node:fs";
import path from "node:path";
import { lookupKey, type LewisShortEntry, type LexiconEntry, type LsSense, type WiktionaryEntry } from "../api/index.ts";

export const DICT_DIR = path.resolve(import.meta.dirname, "../../resources/dictionaries");

export const SOURCES = [
  { name: "Lewis & Short, A Latin Dictionary (Perseus Digital Library)",
    url: "https://github.com/PerseusDL/lexica", license: "CC BY-SA 4.0; http://www.perseus.tufts.edu/" },
  { name: "Wiktionary (via kaikki.org / wiktextract)",
    url: "https://kaikki.org/dictionary/Latin/", license: "CC BY-SA 4.0 and GFDL" },
];

// ---------- raw shapes written by the Python converters ----------
interface RawWikt {
  word: string; canonical: string; pos: string; head?: string;
  etymology_number?: string; etymology?: string;
  principal_parts: { form: string; tags: string[] }[];
  forms: { form: string; tags: string[] }[];
  senses: { glosses: string[]; tags?: string[] }[];
  ipa?: string[];
  alt_of?: string[];
}
interface RawLsSense {
  label?: string; level: number; definition: string; glosses?: string[];
  examples?: { latin: string; ref?: string; urn?: string }[];
  senses?: RawLsSense[];
}
interface RawLs {
  key: string; headword: string; lemma: string; type: string; homograph?: number | string;
  itype?: string; gender?: string[]; part_of_speech?: string; conjugation?: number;
  etymology?: string; senses?: RawLsSense[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function letterFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) throw new Error(`${dir} not found: run npm run data:fetch && npm run data:convert`);
  return fs.readdirSync(dir).filter(f => /^[a-z_]\.json$/.test(f)).map(f => path.join(dir, f)).sort();
}

/** Yields Wiktionary lemma entries one letter file at a time, each with a unique stable id. */
export function* wiktionaryEntries(): Generator<WiktionaryEntry & { word: string }> {
  const ids = new Set<string>();
  for (const file of letterFiles(path.join(DICT_DIR, "wiktionary/lemmas"))) {
    const byWord = readJson<Record<string, RawWikt[]>>(file);
    for (const entries of Object.values(byWord)) {
      for (const e of entries) {
        const base = `${lookupKey(e.word)}:${e.pos}:${e.etymology_number ?? 1}`;
        let id = base;
        for (let n = 2; ids.has(id); n++) id = `${base}~${n}`;   // e.g. "Abel" vs "abel": same key, pos, etymology
        ids.add(id);
        yield {
          id,
          word: e.word,
          canonical: e.canonical,
          pos: e.pos,
          ...(e.head && { head: e.head }),
          ...(e.etymology_number && { etymologyNumber: e.etymology_number }),
          ...(e.etymology && { etymology: e.etymology }),
          principalParts: e.principal_parts,
          forms: e.forms,
          senses: e.senses.map(s => ({ glosses: s.glosses, ...(s.tags?.length && { tags: s.tags }) })),
          ...(e.ipa && { ipa: e.ipa }),
          ...(e.alt_of && { altOf: e.alt_of }),
        };
      }
    }
  }
}

function lsSense(s: RawLsSense): LsSense {
  return {
    ...(s.label && { label: s.label }),
    level: s.level,
    definition: s.definition,
    ...(s.glosses && { glosses: s.glosses }),
    ...(s.examples && { examples: s.examples.map(x => ({ latin: x.latin, ...(x.ref && { ref: x.ref }), ...(x.urn && { urn: x.urn }) })) }),
    ...(s.senses && { senses: s.senses.map(lsSense) }),
  };
}

/** Yields Lewis & Short entries one letter file at a time. */
export function* lewisShortEntries(): Generator<LewisShortEntry> {
  for (const file of letterFiles(path.join(DICT_DIR, "perseus_ls"))) {
    for (const e of Object.values(readJson<Record<string, RawLs>>(file))) {
      yield {
        key: e.key,
        headword: e.headword,
        ...(e.homograph !== undefined && { homograph: e.homograph }),
        ...(e.itype && { itype: e.itype }),
        ...(e.gender && { gender: e.gender }),
        ...(e.part_of_speech && { partOfSpeech: e.part_of_speech }),
        ...(e.conjugation && { conjugation: e.conjugation }),
        ...(e.etymology && { etymology: e.etymology }),
        senses: (e.senses ?? []).map(lsSense),
      };
    }
  }
}

/** Yields Lexicon of St. Thomas entries, dropping OCR bookkeeping (page numbers, raw text). */
export function* lexiconEntries(): Generator<LexiconEntry> {
  const drop = new Set(["page", "pdf_page", "text", "reference_count", "part_of_speech"]);
  for (const file of letterFiles(path.join(DICT_DIR, "lexicon_of_st_thomas"))) {
    const byHead = readJson<Record<string, Record<string, unknown> | Record<string, unknown>[]>>(file);
    for (const v of Object.values(byHead)) {
      for (const e of Array.isArray(v) ? v : [v]) {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(e)) if (!drop.has(k) && val != null) out[k] = val;
        if (e.part_of_speech) out.partOfSpeech = e.part_of_speech;
        yield out as unknown as LexiconEntry;
      }
    }
  }
}

/** Wiktionary "form of" pages: plain form → [plain lemma, pos, tag sets from the page's senses]. */
export function formOfIndex(): Map<string, [lemma: string, pos: string, tags: string[][]][]> {
  type Hit = [string, string, number, string[][]?];
  const raw = readJson<Record<string, Hit[]>>(path.join(DICT_DIR, "wiktionary/forms_index.json"));
  const out = new Map<string, [string, string, string[][]][]>();
  for (const [form, hits] of Object.entries(raw)) {
    const extra = hits.filter(h => h[2] === -1).map(h => [h[0], h[1], h[3] ?? []] as [string, string, string[][]]);
    if (extra.length) out.set(form, extra);
  }
  return out;
}
