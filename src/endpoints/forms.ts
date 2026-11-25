/**
 * forms/_shards.json + forms/{prefix}.json — inflected form → lemma lookup.
 *
 * Forms are sharded by slug prefix. A shard is split by the next character until it holds
 * at most MAX_FORMS forms, so "con…" gets many small files while "x" stays one file.
 * Every split prefix keeps its own shard for the leftovers, so the longest matching prefix
 * in _shards.json always names the file that holds a form (or would, if it existed).
 */
import { paths, slug, type FormHit, type FormShard, type FormShardList } from "../api/index.ts";
import type { Buckets, Output } from "../lib/output.ts";
import type { FormRec } from "./words.ts";

const MAX_FORMS = 4000;
const MIN_CHILD = 300;  // children smaller than this stay in the parent shard
const MAX_DEPTH = 8;

type Item = { s: string; key: string };

export function planShards(prefix: string, items: Item[], out: Map<string, Item[]>): void {
  if (items.length <= MAX_FORMS || prefix.length >= MAX_DEPTH) {
    out.set(prefix, items);
    return;
  }
  const groups = new Map<string, Item[]>();
  const stay: Item[] = [];
  for (const it of items) {
    const c = it.s[prefix.length];
    if (c === undefined) { stay.push(it); continue; }
    let g = groups.get(c);
    if (!g) groups.set(c, (g = []));
    g.push(it);
  }
  for (const [c, g] of groups) {
    if (g.length < MIN_CHILD) stay.push(...g);
    else planShards(prefix + c, g, out);
  }
  out.set(prefix, stay);
}

/** Headword-line tags (["genitive"]) duplicate table tags (["genitive", "singular"]); keep the fuller set. */
export function dropSubsets(analyses: string[][]): string[][] {
  return analyses.filter((a, i) =>
    !analyses.some((b, j) => j !== i && b.length > a.length && a.every(t => b.includes(t))));
}

/**
 * @param idFor  resolves (lemma key, pos) to a word id, for Wiktionary form-of pages that only name the lemma
 * @param want   form keys whose hits should be returned (e.g. every token of the texts)
 */
export function generateForms(
  out: Output,
  forms: Buckets<FormRec>,
  idFor: (lemmaKey: string, pos: string) => string | undefined,
  want: ReadonlySet<string> = new Set(),
) {
  const shardNames: string[] = [];
  const wanted = new Map<string, FormHit[]>();
  let formCount = 0;

  for (const bucket of forms.names()) {
    // form key → word id → hit
    const byForm = new Map<string, Map<string, FormHit>>();
    for (const r of forms.read(bucket)) {
      const id = r.i ?? idFor(r.l, r.p);
      if (!id) continue;                       // form-of page for a lemma Wiktionary has no entry for
      let hits = byForm.get(r.f);
      if (!hits) byForm.set(r.f, (hits = new Map()));
      let hit = hits.get(id);
      if (!hit) hits.set(id, (hit = { id, word: r.w, lemma: r.l, pos: r.p, analyses: [] }));
      if (r.t && !hit.analyses.some(a => a.join() === r.t!.join())) hit.analyses.push(r.t);
    }

    const plan = new Map<string, Item[]>();
    planShards(bucket, [...byForm.keys()].map(key => ({ s: slug(key), key })), plan);
    for (const [prefix, items] of plan) {
      const shard: FormShard = {};
      for (const { key } of items.sort((a, b) => (a.key < b.key ? -1 : 1))) {
        const hits = [...byForm.get(key)!.values()].sort((a, b) => a.id.localeCompare(b.id));
        for (const h of hits) h.analyses = dropSubsets(h.analyses);
        shard[key] = hits;
        if (want.has(key)) wanted.set(key, hits);
      }
      out.json(paths.formShard(prefix), shard);
      shardNames.push(prefix);
    }
    formCount += byForm.size;
  }

  const list: FormShardList = { shards: shardNames.sort() };
  out.json(paths.formShards(), list);
  return { counts: { forms: formCount, formShards: shardNames.length }, wanted };
}
