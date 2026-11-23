/**
 * words/{slug}.json — one file per slug, merging Wiktionary and Lewis & Short entries that share a lookup key.
 * Also emits one form record per paradigm cell for the forms endpoint.
 */
import path from "node:path";
import { lookupKey, paths, slug, type LewisShortEntry, type WiktionaryEntry, type WordFile } from "../api/index.ts";
import { Buckets, type Output } from "../lib/output.ts";
import { formOfIndex, lewisShortEntries, wiktionaryEntries } from "../sources/index.ts";

type WordRec =
  | { src: "w"; key: string; entry: WiktionaryEntry }
  | { src: "l"; key: string; entry: LewisShortEntry };

/** One paradigm cell: form key, word slug, lemma key, pos, tags (null for Wiktionary form-of pages) */
export type FormRec = { f: string; w: string; l: string; p: string; t: string[] | null };

/** L&S writes compounds with a hyphen ("tam-quam"); Wiktionary only uses hyphens for affixes ("-que"). */
function lsKey(headword: string): string {
  return lookupKey(headword).replace(/(?<=\p{L})-(?=\p{L})/gu, "");
}

const bucketOf = (s: string) => s[0] ?? "_";

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
      forms.add(bucketOf(slug(f)), { f, w, l: key, p: entry.pos, t: tags });
    }
  }
  for (const entry of lewisShortEntries()) {
    const key = lsKey(entry.headword);
    words.add(bucketOf(slug(key)), { src: "l", key, entry });
  }
  for (const [form, hits] of formOfIndex()) {
    const f = lookupKey(form);
    for (const [lemma, pos] of hits) {
      const l = lookupKey(lemma);
      forms.add(bucketOf(slug(f)), { f, w: slug(l), l, p: pos, t: null });
    }
  }

  let files = 0, wiktionary = 0, lewisShort = 0;
  for (const bucket of words.names()) {
    const bySlug = new Map<string, Map<string, WordFile["words"][number]>>();
    for (const rec of words.read(bucket)) {
      const s = slug(rec.key);
      let keys = bySlug.get(s);
      if (!keys) bySlug.set(s, (keys = new Map()));
      let word = keys.get(rec.key);
      if (!word) keys.set(rec.key, (word = { key: rec.key, wiktionary: [], lewisShort: [] }));
      if (rec.src === "w") { word.wiktionary.push(rec.entry); wiktionary++; }
      else { word.lewisShort.push(rec.entry); lewisShort++; }
    }
    for (const [s, keys] of bySlug) {
      const file: WordFile = { slug: s, words: [...keys.values()].sort((a, b) => a.key.localeCompare(b.key)) };
      for (const w of file.words) w.lewisShort.sort((a, b) => String(a.homograph ?? "").localeCompare(String(b.homograph ?? "")));
      out.json(paths.word(s), file);
      files++;
    }
  }
  return { wordFiles: files, wiktionaryEntries: wiktionary, lewisShortEntries: lewisShort };
}
