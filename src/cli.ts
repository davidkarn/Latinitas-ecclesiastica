/**
 * Generate the static JSON API.
 *
 *   npm run generate -- [--out dist/api] [--gzip]
 *
 * Writes to <out>.staging-<id> and swaps it into <out> only when every endpoint succeeded.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { API_VERSION, paths, type Manifest } from "./api/index.ts";
import { generateForms } from "./endpoints/forms.ts";
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
  const forms = new Buckets<FormRec>(path.join(out.tmp, "forms"));
  step("words");
  const wordCounts = generateWords(out, forms);
  step("forms");
  const formCounts = generateForms(out, forms);

  const manifest: Manifest = {
    apiVersion: API_VERSION,
    generatedAt: new Date(started).toISOString(),
    buildId,
    counts: { ...wordCounts, ...formCounts },
    sources: SOURCES,
  };
  out.json(paths.manifest(), manifest);
  out.commit();
  step(`done: ${out.files} files, ${(out.bytes / 1e6).toFixed(0)} MB → ${out.finalDir}`);
  console.log(manifest.counts);
} catch (err) {
  out.abort();
  throw err;
}
