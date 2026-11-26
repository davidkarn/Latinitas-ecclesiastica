/**
 * Generate the static JSON API.
 *
 *   npm run generate -- [--out dist/api] [--gzip]
 *
 * Writes to <out>.staging-<id> and swaps it into <out> only when every endpoint succeeded.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { API_VERSION, lookupKey, paths, type Manifest } from "./api/index.ts";
import { generateForms } from "./endpoints/forms.ts";
import { generateTexts, loadTexts, wantedForms } from "./endpoints/texts.ts";
import { generateWords, type FormRec } from "./endpoints/words.ts";
import { Buckets, Output } from "./lib/output.ts";
import { SOURCES } from "./sources/index.ts";

const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: "dist/api" },
    gzip: { type: "boolean", default: false },
  },
});

const started = Date.now();
const buildId = `${started.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const out = new Output(path.resolve(args.out!), buildId, args.gzip!);
const step = (name: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${name}`);

try {
  step("texts: load");
  const texts = loadTexts();
  const forms = new Buckets<FormRec>(path.join(out.tmp, "forms"));
  step("words");
  const words = generateWords(out, forms);
  // Form-of pages name a lemma and a POS that may differ from the lemma's own (participle → verb)
  const idByLemma = new Map<string, string>();
  for (const s of words.summaries.values()) {
    for (const k of [`${s.key}\u0000${s.pos}`, s.key]) if (!idByLemma.has(k)) idByLemma.set(k, s.id);
  }
  const idFor = (key: string, pos: string, depth = 0): string | undefined =>
    idByLemma.get(`${key}\u0000${pos}`) ?? idByLemma.get(key) ??
    (depth < 3 ? [...(words.aliases.get(key) ?? [])].map(a => idFor(a, pos, depth + 1)).find(Boolean) : undefined);
  // Alternative spellings (conpellō) point at their main lemma (compellō) and borrow its L&S definition
  for (const s of words.summaries.values()) {
    for (const alt of s.altOf ?? []) {
      const id = idFor(lookupKey(alt.lemma), s.pos);
      if (!id) continue;
      alt.id = id;
      const target = words.summaries.get(id);
      // Alternative spellings borrow the main spelling's L&S entry when their own is only a cross-reference ("foeteo, v. feteo")
      if (!s.lewisShort?.definition && target?.lewisShort?.definition) s.lewisShort = target.lewisShort;
    }
  }
  step("forms");
  const formsOut = generateForms(out, forms, idFor, wantedForms(texts));
  step("texts");
  const textCounts = generateTexts(out, texts, formsOut.wanted, words.summaries, words.weights);

  const manifest: Manifest = {
    apiVersion: API_VERSION,
    generatedAt: new Date(started).toISOString(),
    buildId,
    counts: { ...words.counts, ...formsOut.counts, ...textCounts },
    sources: [
      ...SOURCES,
      { name: "Deferrari, A Lexicon of St. Thomas Aquinas", url: "", license: "unverified: check copyright before publishing" },
      ...texts.flatMap(t => Object.values(t.def.sources).map(name => ({ name, url: "", license: "public domain" }))),
    ],
  };
  out.json(paths.manifest(), manifest);
  out.commit();
  step(`done: ${out.files} files, ${(out.bytes / 1e6).toFixed(0)} MB → ${out.finalDir}`);
  console.log(manifest.counts);
} catch (err) {
  out.abort();
  throw err;
}
