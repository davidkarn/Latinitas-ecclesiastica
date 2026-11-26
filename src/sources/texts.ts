/**
 * Readers for parallel texts: aligned Latin verses with audio (scripts/align_split.py output)
 * and the Douay-Rheims English translation.
 */
import fs from "node:fs";
import path from "node:path";
import type { TextSources } from "../api/index.ts";

const RES = path.resolve(import.meta.dirname, "../../resources");
export const AUDIO_DIR = path.join(RES, "audio/vulgate/verses");

export interface AlignedVerse {
  ref: string;
  chapter: number;
  verse: number;
  text: string;
  /** Relative to AUDIO_DIR */
  audio_file: string;
  duration: number;
  words: { word: string; start: number; end: number; confidence: number }[];
}

export interface TextDef {
  id: string;
  title: string;
  /** Book name in the aligned audio metadata */
  vulgateBook: string;
  /** Book name in the Douay-Rheims JSON */
  englishBook: string;
  sources: TextSources;
}

const VULGATE_SOURCES: TextSources = {
  latin: "Clementine Vulgate (vulsearch.sourceforge.net, via github.com/BibleGet-I-O/Clementine-Vulgate)",
  english: "Douay-Rheims Bible, 1899 American Edition (public domain, via github.com/midvash/bible-data)",
  audio: "LibriVox, Biblia Sacra Vulgata Clementina (public domain); verse clips by forced alignment",
};

/** The Pentateuch. `id` is the URL segment; the aligned audio and the Douay-Rheims both use the English book name. */
export const TEXTS: TextDef[] = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"].map(title => ({
  id: title.toLowerCase(),
  title,
  vulgateBook: title,
  englishBook: title,
  sources: VULGATE_SOURCES,
}));

/** Books whose verses have been aligned (scripts/align_split.py); the rest are skipped with a warning. */
export function availableTexts(): TextDef[] {
  const books = new Set<string>();
  for (const f of fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith(".json"))) {
    books.add((JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, f), "utf8")) as { book: string }).book);
  }
  return TEXTS.filter(t => books.has(t.vulgateBook) || (console.warn(`skipping ${t.title}: no aligned verses`), false));
}

/** Aligned Latin verses of a book, in order. */
export function vulgateVerses(book: string): AlignedVerse[] {
  const verses: AlignedVerse[] = [];
  for (const f of fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith(".json")).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, f), "utf8")) as { book: string; verses: AlignedVerse[] };
    if (meta.book === book) verses.push(...meta.verses);
  }
  return verses.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
}

/** English verses of a book: "chapter:verse" → text. */
export function englishVerses(book: string): Map<string, string> {
  const file = path.join(RES, "text/douay_rheims/dra.json");
  const d = JSON.parse(fs.readFileSync(file, "utf8")) as {
    books: { englishName: string; chapters: { chapter: number; verses: { number: number; text: string }[] }[] }[];
  };
  const b = d.books.find(x => x.englishName === book);
  if (!b) throw new Error(`${book} not in ${file}`);
  const out = new Map<string, string>();
  for (const c of b.chapters) for (const v of c.verses) out.set(`${c.chapter}:${v.number}`, v.text.trim());
  return out;
}
