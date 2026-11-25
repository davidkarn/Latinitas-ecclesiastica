# learnlatin

Generates a static JSON API for the learnlatin React frontend in `web/`. The output is flat files that
nginx serves; there is no application server.

```
scripts/fetch_sources.sh      download Perseus Lewis & Short + Wiktionary (kaikki.org)
scripts/convert_*.py          slim the raw dumps into resources/dictionaries/{perseus_ls,wiktionary}
src/cli.ts                    generate dist/api/** from the converted dictionaries
src/api/                      types, paths and Latin normalization shared with the frontend (no Node deps)
web/                          React reader (Vite): Latin | English verses, audio with word highlighting, dictionary popups
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

Frontend:

```sh
npm --prefix web install
npm run web:dev           # http://localhost:5173/genesis/1, serves dist/api at /api (API_DIR=... to change)
npm run web:build         # → web/dist, deploy to /srv/learnlatin/web
```

The reader plays a chapter one verse clip at a time and highlights each word from the token timings
(space = play/pause, ←/→ = chapter). Clicking a word opens its Lewis & Short, Wiktionary and
Lexicon of St. Thomas entries, each with its source attribution.

Generation writes to `<out>.staging-<id>` and renames it into place only on success, so a live
nginx keeps serving the previous build until the new one is complete.

## Endpoints

| Path | Type (`src/api/types.ts`) | Contents |
| --- | --- | --- |
| `manifest.json` | `Manifest` | build id, counts, sources/licenses |
| `texts/index.json` | `TextIndex` | available texts and their chapters |
| `texts/{text}/{chapter}.json` | `ChapterFile` | verses (Latin, English, audio clip, timed tokens with word ids) + a `WordSummary` per word id: principal parts, inflection class, gender, short L&S definition |
| `audio/vulgate/Genesis/*.mp3` | — | one clip per verse (hard-linked from `resources/audio`) |
| `words/{slug}.json` | `WordFile` | Wiktionary entries (full paradigms), Lewis & Short and Lexicon of St. Thomas entries for one lookup key; a token's `wordId` is a `WiktionaryEntry.id` in `words/{summary.file}` |
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
