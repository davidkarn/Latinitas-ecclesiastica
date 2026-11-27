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
  /** Modern English name, where it differs from the Vulgate/Douay-Rheims one ("1 Samuel" for 1 Kings) */
  aka?: string;
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

/**
 * Genesis to 4 Kings. `id` is the URL segment; `vulgateBook` is the book name scripts/align_split.py writes.
 * The Vulgate and the Douay-Rheims count four books of Kings (1–2 Samuel and 1–2 Kings in modern Bibles);
 * the titles follow them, as the Latin does, and `aka` gives the modern name. The Douay-Rheims JSON uses
 * modern names, and its verse numbering matches the Clementine text exactly in all of these books.
 */
const book = (title: string, vulgateBook = title, englishBook = title, aka?: string): TextDef => ({
  id: title.toLowerCase().replace(/\s+/g, "-"),
  title,
  ...(aka ? { aka } : {}),
  vulgateBook,
  englishBook,
  sources: VULGATE_SOURCES,
});

export const TEXTS: TextDef[] = [
  book("Genesis"), book("Exodus"), book("Leviticus"), book("Numbers"), book("Deuteronomy"),
  book("Joshua"), book("Judges"), book("Ruth"),
  book("1 Kings", "1Kings", "1 Samuel", "1 Samuel"),
  book("2 Kings", "2Kings", "2 Samuel", "2 Samuel"),
  book("3 Kings", "3Kings", "1 Kings", "1 Kings"),
  book("4 Kings", "4Kings", "2 Kings", "2 Kings"),
];

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
