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
  /** Stable word id, `${lookupKey}:${pos}:${etymologyNumber ?? 1}`, e.g. "amo:verb:1". Referenced by texts and forms. */
  id: string;
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
  /** This is an alternative spelling of these lemmas (e.g. conpellō → ["compellō"]) */
  altOf?: string[];
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

/** Deferrari, A Lexicon of St. Thomas Aquinas (OCR'd; fields vary by entry). */
export interface LexiconEntry {
  headword: string;
  grammar?: string;
  partOfSpeech?: string[];
  gender?: string[];
  conjugation?: number;
  definition?: string;
  senses?: unknown[];
  examples?: { latin: string; ref?: string; work?: string }[];
  phrases?: unknown[];
  see?: unknown;
  variants?: unknown;
}

/** GET /api/words/{slug}.json — everything for one lookup key, from all dictionaries */
export interface WordFile {
  slug: string;
  words: {
    /** Lookup key (no diacritics), e.g. "amo" */
    key: string;
    wiktionary: WiktionaryEntry[];
    lewisShort: LewisShortEntry[];
    lexicon: LexiconEntry[];
  }[];
}

/** One way an inflected form can be parsed. */
export interface FormHit {
  /** Word id (WiktionaryEntry.id) */
  id: string;
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

// ---------- texts ----------

/** GET /api/texts/index.json */
export interface TextIndex {
  texts: {
    id: string;
    title: string;
    /** Modern English name, where it differs ("1 Samuel" for 1 Kings) */
    aka?: string;
    chapters: { chapter: number; verses: number; file: string }[];
    sources: TextSources;
  }[];
}

export interface TextSources {
  latin: string;
  english: string;
  audio: string;
}

/** Just enough about a word to show it inline and build its inflection table;
 *  fetch `file` (a WordFile) for full definitions and every inflected form. */
export interface WordSummary {
  id: string;
  /** Path of the full word file, relative to the API root */
  file: string;
  /** Lookup key inside the word file */
  key: string;
  /** Headword with macrons, e.g. "terra" */
  lemma: string;
  pos: string;
  /** Wiktionary headword line, e.g. "terra f (genitive terrae); first declension" */
  head?: string;
  /** e.g. "first declension", "third conjugation", "irregular" */
  inflectionClass?: string;
  gender?: string[];
  /** The forms that define the paradigm: the headword plus the genitive (nouns), feminine/neuter (adjectives),
   *  or infinitive, perfect and supine (verbs). */
  principalParts: InflectedForm[];
  /** The matching Lewis & Short entry, and its English meanings when L&S gives them as glosses */
  lewisShort?: { key: string; definition?: string };
  /** First Wiktionary gloss, for words Lewis & Short lacks (often proper names) */
  gloss?: string;
  /** Alternative spelling of these lemmas; `lewisShort` then comes from the first of them */
  altOf?: { lemma: string; id?: string }[];
}

export interface Token {
  /** The word as written in the verse */
  text: string;
  /** Character offset of `text` in Verse.latin */
  offset: number;
  /** Seconds from the start of the verse's audio file */
  start?: number;
  end?: number;
  /** Best-guess word (key into ChapterFile.words); null if no dictionary knows the form */
  wordId: string | null;
  /** Lookup key that matched, without any enclitic */
  form: string;
  /** Enclitic split off before lookup ("que" in "Dixitque") */
  enclitic?: string;
  /** Grammatical analyses of `form` as `wordId` */
  analyses: string[][];
  /** No dictionary knows the form and it is capitalized: almost always a proper name (Esau, Laban, Bethel) */
  properName?: true;
  /** Other words this form could belong to, most likely first */
  alternatives?: { wordId: string; analyses: string[][] }[];
}

/** A note from Plater & White's Grammar of the Vulgate on something in this verse. */
export interface GrammarNote {
  /** Section of the grammar (§ 1-144); read it whole in GrammarFile */
  section: number;
  /** The section's topic, e.g. "Number, Gender, Case" */
  topic: string;
  /** Short name of the construction, for notes found by pattern ("Cognate ablative") */
  label?: string;
  /** The book's own words about it (plain text) */
  text: string;
  /** Indices into Verse.tokens of the words it is about; empty when it concerns the verse as a whole */
  tokens: number[];
  /** "cited": the grammar cites this verse; "construction": the same construction the grammar describes */
  source: "cited" | "construction";
}

export interface Verse {
  verse: number;
  ref: string;
  latin: string;
  english: string;
  /** English verse numbers when they differ from the Latin (Genesis 5:31 = Douay-Rheims 5:31–32) */
  englishVerses?: number[];
  audio: { file: string; duration: number } | null;
  tokens: Token[];
  notes?: GrammarNote[];
}

/** GET /api/texts/{text}/{chapter}.json */
export interface ChapterFile {
  text: string;
  title: string;
  chapter: number;
  verses: Verse[];
  /** Every word referenced by a token (including alternatives), by id */
  words: Record<string, WordSummary>;
  sources: TextSources;
}

// ---------- grammar ----------

/** A block of a grammar section: sanitized HTML using only i, b, sup, br and table/list tags */
export interface GrammarBlock { type: "p" | "h" | "list" | "table"; html: string }

export interface GrammarSection {
  /** § number; 0 is the untitled opening of the Introduction */
  n: number;
  chapter: string;
  topic: string;
  blocks: GrammarBlock[];
  footnotes: string[];
}

/** GET /api/grammar.json — W. E. Plater & H. J. White, A Grammar of the Vulgate (1926), whole */
export interface GrammarFile {
  title: string;
  authors: string[];
  published: string;
  license: string;
  source: string;
  chapters: { id: string; title: string; sections: [number, number] }[];
  sections: GrammarSection[];
  conclusion: { blocks: GrammarBlock[]; footnotes: string[] };
}
