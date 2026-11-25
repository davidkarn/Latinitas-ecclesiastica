/** Turning Wiktionary tag sets into readable descriptions. */

const ORDER = [
  "first-person", "second-person", "third-person",
  "nominative", "genitive", "dative", "accusative", "ablative", "vocative", "locative",
  "masculine", "feminine", "neuter", "common",
  "singular", "plural",
  "present", "imperfect", "future", "perfect", "pluperfect", "future-perfect",
  "active", "passive",
  "indicative", "subjunctive", "imperative", "infinitive", "participle", "gerund", "gerundive", "supine",
];

const LABEL: Record<string, string> = {
  "first-person": "1st person", "second-person": "2nd person", "third-person": "3rd person",
  "future-perfect": "future perfect",
};

/** Tags that say nothing about this particular form */
const HIDE = new Set(["alternative", "Latin", "Old-Latin", "Medieval-Latin", "Late-Latin", "archaic", "especially",
  "sigmatic", "aorist", "one-termination", "noun-from-verb", "with-accusative", "with-ablative", "apocopic"]);

export function describeAnalysis(tags: string[]): string {
  if (tags.includes("canonical")) return "dictionary form";
  const known = tags.filter(t => ORDER.includes(t)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const other = tags.filter(t => !ORDER.includes(t) && !HIDE.has(t));
  return [...known, ...other].map(t => LABEL[t] ?? t.replace(/-/g, " ")).join(" ");
}

/** Distinct readable analyses, e.g. ["ablative singular", "dative singular"] */
export function describeAnalyses(analyses: string[][]): string[] {
  const all = [...new Set(analyses.map(describeAnalysis).filter(Boolean))];
  return all.length > 1 ? all.filter(a => a !== "dictionary form") : all;
}

export const POS_LABEL: Record<string, string> = {
  noun: "noun", verb: "verb", adj: "adjective", adv: "adverb", prep: "preposition", conj: "conjunction",
  pron: "pronoun", det: "determiner", num: "numeral", name: "proper noun", intj: "interjection",
  participle: "participle", particle: "particle", suffix: "suffix", prefix: "prefix", phrase: "phrase",
};

export const ENCLITIC: Record<string, string> = {
  que: "and", ne: "question marker", ve: "or", ce: "emphatic (here, this)",
};
