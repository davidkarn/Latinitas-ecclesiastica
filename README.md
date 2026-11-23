# learnlatin

Generates a static JSON API for the learnlatin Preact frontend. The output is flat files that
nginx serves; there is no application server.

```
scripts/fetch_sources.sh      download Perseus Lewis & Short + Wiktionary (kaikki.org)
scripts/convert_*.py          slim the raw dumps into resources/dictionaries/{perseus_ls,wiktionary}
src/cli.ts                    generate dist/api/** from the converted dictionaries
src/api/                      types, paths and Latin normalization shared with the frontend (no Node deps)
deploy/nginx.conf             example server block
```

## Usage

```sh
npm install
npm run data:fetch        # ~1.3 GB download, only needed once
npm run data:convert      # ~20 s
npm run generate          # ~25 s → dist/api   (add -- --gzip to precompress, --out <dir> to change target)
npm test && npm run typecheck
```

Generation writes to `<out>.staging-<id>` and renames it into place only on success, so a live
nginx keeps serving the previous build until the new one is complete.

## Endpoints

| Path | Type (`src/api/types.ts`) | Contents |
| --- | --- | --- |
| `manifest.json` | `Manifest` | build id, counts, sources/licenses |
| `words/{slug}.json` | `WordFile` | Wiktionary entries (full paradigms) + Lewis & Short entries for one lookup key |
| `forms/_shards.json` | `FormShardList` | shard prefixes for form lookup |
| `forms/{prefix}.json` | `FormShard` | inflected form → lemma(s) with grammatical analyses |

Looking up a word from running text in the frontend:

```ts
import { lookupCandidates, lookupKey, paths, shardFor, type FormShard } from "learnlatin/api";

for (const key of lookupCandidates("Dixitque")) {           // ["dixitque", "dixit"]
  const shard: FormShard = await get(paths.formShard(shardFor(key, shards)));
  const hits = shard[lookupKey(key)];
  if (hits) return hits;                                       // → get(paths.word(hits[0].word))
}
```

## Data licenses

Lewis & Short: Perseus Digital Library, CC BY-SA 4.0 (http://www.perseus.tufts.edu/).
Wiktionary: CC BY-SA 4.0 / GFDL. Generated output must carry the same attribution.
