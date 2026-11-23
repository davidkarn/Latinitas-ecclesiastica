/** URL paths of the generated endpoints, relative to the API root (e.g. "/api"). */
import { slug } from "./latin.ts";

export const paths = {
  manifest: () => "manifest.json",
  word: (wordOrSlug: string) => `words/${slug(wordOrSlug)}.json`,
  formShards: () => "forms/_shards.json",
  formShard: (prefix: string) => `forms/${prefix || "_"}.json`,
};

/** Shard file holding a form: the longest prefix in _shards.json that the form's slug starts with.
 *  Inside the shard, look the form up by lookupKey(form). */
export function shardFor(form: string, shards: readonly string[]): string {
  const s = slug(form);
  let best = "";
  for (const p of shards) if (p.length > best.length && s.startsWith(p)) best = p;
  return best;
}
