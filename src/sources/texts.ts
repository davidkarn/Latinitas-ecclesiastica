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
  /** English name, where it differs from the Vulgate one ("Numbers" for Numeri, "1 Samuel" for I Regum) */
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
 * Genesis to 4 Kings. Titles are the Vulgate's own (short) names, as in the Clementine headings ("Liber
 * Numeri", "Liber Primus Regum"), and `aka` gives the English name where it differs. The Vulgate counts
 * four books of Kings, which modern Bibles call 1–2 Samuel and 1–2 Kings.
 * `id` is the URL segment (English, kept stable for links and grammar citations); `vulgateBook` is the book
 * name scripts/align_split.py writes; `englishBook` is the name in the Douay-Rheims JSON, whose verse
 * numbering matches the Clementine text exactly in all of these books.
 */
const book = (id: string, title: string, aka?: string, vulgateBook?: string, englishBook?: string): TextDef => {
  const english = englishBook ?? aka ?? title;
  return {
    id,
    title,
    ...(aka ? { aka } : {}),
    vulgateBook: vulgateBook ?? english,
    englishBook: english,
    sources: VULGATE_SOURCES,
  };
};

export const TEXTS: TextDef[] = [
  book("genesis", "Genesis"),
  book("exodus", "Exodus"),
  book("leviticus", "Leviticus"),
  book("numbers", "Numeri", "Numbers"),
  book("deuteronomy", "Deuteronomium", "Deuteronomy"),
  book("joshua", "Josue", "Joshua"),
  book("judges", "Judicum", "Judges"),
  book("ruth", "Ruth"),
  book("1-kings", "I Regum", "1 Samuel", "1Kings"),
  book("2-kings", "II Regum", "2 Samuel", "2Kings"),
  book("3-kings", "III Regum", "1 Kings", "3Kings"),
  book("4-kings", "IV Regum", "2 Kings", "4Kings"),
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
