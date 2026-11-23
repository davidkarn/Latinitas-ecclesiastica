/** JSON shapes of the generated endpoints. Imported by the frontend; keep free of Node types. */

export const API_VERSION = 1;

/** GET /api/manifest.json */
export interface Manifest {
  apiVersion: number;
  generatedAt: string;
  /** Changes on every generation; append as ?v= to bust caches. */
  buildId: string;
  counts: Record<string, number>;
  sources: { name: string; url: string; license: string }[];
}

export interface InflectedForm {
  form: string;
  /** Wiktionary tags, e.g. ["active", "first-person", "indicative", "present", "singular"] */
  tags: string[];
}

export interface WiktionaryEntry {
  /** Headword with macrons, e.g. "amō" */
  canonical: string;
  pos: string;
  /** Headword line, e.g. "amō (present infinitive amāre, perfect active amāvī, supine amātum); first conjugation" */
  head?: string;
  etymologyNumber?: string;
  etymology?: string;
  principalParts: InflectedForm[];
  forms: InflectedForm[];
  senses: { glosses: string[]; tags?: string[] }[];
  ipa?: string[];
}

export interface LsSense {
  label?: string;
  level: number;
  definition: string;
  glosses?: string[];
  examples?: { latin: string; ref?: string; urn?: string }[];
  senses?: LsSense[];
}

export interface LewisShortEntry {
  /** Perseus entry key, e.g. "acer2" */
  key: string;
  headword: string;
  homograph?: number | string;
  itype?: string;
  gender?: string[];
  partOfSpeech?: string;
  conjugation?: number;
  etymology?: string;
  senses: LsSense[];
}

/** GET /api/words/{slug}.json — everything for one lookup key, from both dictionaries */
export interface WordFile {
  slug: string;
  words: {
    /** Lookup key (no diacritics), e.g. "amo" */
    key: string;
    wiktionary: WiktionaryEntry[];
    lewisShort: LewisShortEntry[];
  }[];
}

/** One way an inflected form can be parsed. */
export interface FormHit {
  /** Slug of the word file: fetch /api/words/{word}.json */
  word: string;
  /** Lookup key of the lemma inside that word file */
  lemma: string;
  pos: string;
  /** Tag sets this form carries in the lemma's paradigm (a form can fill several cells) */
  analyses: string[][];
}

/** GET /api/forms/_shards.json — sorted shard prefixes; pick the longest prefix of the lookup key */
export interface FormShardList {
  shards: string[];
}

/** GET /api/forms/{prefix}.json — lookup key of a form → its parses */
export type FormShard = Record<string, FormHit[]>;
