# learnlatin

Generates a static JSON API for the learnlatin React frontend in `web/`. The output is flat files that
nginx serves; there is no application server.

```
scripts/fetch_sources.sh      download Perseus Lewis & Short + Wiktionary (kaikki.org)
scripts/convert_*.py          slim the raw dumps into resources/dictionaries/{perseus_ls,wiktionary}
src/cli.ts                    generate web/dist/api/** from the converted dictionaries
src/api/                      types, paths and Latin normalization shared with the frontend (no Node deps)
web/                          React reader (Vite): Latin | English verses, audio with word highlighting, dictionary popups
deploy/nginx.conf             example server block
```

## Usage

```sh
npm install
npm run data:fetch        # ~1.3 GB download, only needed once
npm run data:convert      # ~20 s
npm run generate          # ~25 s → web/dist/api   (add -- --gzip to precompress, --out <dir> to change target)
npm test && npm run typecheck
```

Texts and audio (the Pentateuch: Genesis–Deuteronomy). The Latin is the Clementine Vulgate
(`resources/text/vulgate/{Gn,Ex,Lv,Nm,Dt}.txt`, from BibleGet-I-O/Clementine-Vulgate), the English
the Douay-Rheims, and the audio the LibriVox *Biblia Sacra Vulgata Clementina* parts 001–020
(archive.org item `Vulgata_Clementina`, saved to `resources/audio/vulgate/`). Verse clips and word
timings come from a Python 3 venv with `mlx-whisper`, `torch` and `torchaudio`:

```sh
.venv/bin/python scripts/transcribe.py  resources/audio/vulgate/bibliasacra_0*_128kb.mp3   # Whisper anchors → work/whisper
.venv/bin/python scripts/align_split.py resources/audio/vulgate/bibliasacra_0*_128kb.mp3   # → resources/audio/vulgate/verses
```

Both skip parts already done. To add a book, add it to `BOOKS` in `align_split.py` and to `TEXTS`
in `src/sources/texts.ts`; books without aligned verses are skipped by `npm run generate`.

Grammar notes come from W. E. Plater & H. J. White, *A Grammar of the Vulgate* (Oxford, 1926; public
domain), OCR'd with Surya. `scripts/convert_grammar.py` turns the OCR output
(`resources/text/plater_white/surya.json`) into sections and Pentateuch citations
(`resources/text/plater_white/grammar.json`); the generator then writes `grammar.json` and attaches
`notes` to verses: the book's own remarks on verses it cites, matched to the words it quotes, and the
constructions it describes (`RULES` in `src/endpoints/grammar.ts`) wherever they occur.

```sh
python3 -I scripts/convert_grammar.py [path/to/surya/results.json]
```

Frontend:

```sh
npm --prefix web install
npm run web:dev           # http://localhost:5173/genesis/1, serves web/dist/api at /api (API_DIR=... to change)
npm run web:build         # → web/dist (empties it first, except web/dist/api)
DEPLOY_TARGET=host:/srv/learnlatin/web npm run deploy   # build, then rsync all of web/dist
```

`web/dist` is the whole site: the frontend build at the top and the generated API in `web/dist/api`, so
one rsync deploys both. `npm run deploy` uses `--delete` to remove stale assets on the server and
`--delay-updates` so the new files appear together at the end rather than one by one (otherwise a reader
could pick up the new `manifest.json` before the files it points to have arrived). It skips the
generator's in-progress `api.staging-*` directories.

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
| `grammar.json` | `GrammarFile` | Plater & White, *A Grammar of the Vulgate*: every section (§ 1–144), for the grammar reader |
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
