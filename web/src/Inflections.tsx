/**
 * Paradigm tables built from a Wiktionary entry's inflected forms: declension (nouns), declension by gender
 * (adjectives, pronouns, participles) or conjugation (verbs). Cells holding the form being read are highlighted.
 */
import { lookupKey, type InflectedForm, type WiktionaryEntry } from "../../src/api/index.ts";

const CASES = ["nominative", "genitive", "dative", "accusative", "ablative", "vocative", "locative"];
const NUMBERS = ["singular", "plural"];
const GENDERS = ["masculine", "feminine", "neuter"];
const PERSONS: [string, string][] = [
  ["first-person singular", "1st sg."], ["second-person singular", "2nd sg."], ["third-person singular", "3rd sg."],
  ["first-person plural", "1st pl."], ["second-person plural", "2nd pl."], ["third-person plural", "3rd pl."],
];

/** Tags that place a form in the paradigm; anything else (archaic, poetic, alternative…) marks a variant of a cell */
const GRAM = new Set([
  ...CASES, ...NUMBERS, "first-person", "second-person", "third-person",
  "present", "imperfect", "future", "perfect", "pluperfect", "active", "passive",
  "indicative", "subjunctive", "imperative", "infinitive", "participle", "gerund", "supine", "noun-from-verb",
  "sigmatic", "aorist", "potential", "comparative", "superlative",
]);

type Spec = { tags: string[]; gender?: string };

function matches(f: InflectedForm, spec: Spec): boolean {
  const gram = f.tags.filter(t => GRAM.has(t));
  if (gram.length !== spec.tags.length || !spec.tags.every(t => gram.includes(t))) return false;
  if (!spec.gender) return true;
  const g = f.tags.filter(t => GENDERS.includes(t));
  return g.length === 0 || g.includes(spec.gender);   // "bonīs" is tagged with all three genders at once
}

const tagsOf = (...parts: string[]) => parts.join(" ").split(" ").filter(Boolean);

interface Table {
  title: string;
  rows: { label: string; spec: Spec }[];
  cols: { label: string; spec: Spec }[];
  /** Periphrastic forms with no person ("creātus + present active indicative of sum"), shown under the table */
  notes?: { label: string; spec: Spec }[];
}

function nounTables(): Table[] {
  return [{
    title: "Declension",
    rows: CASES.map(c => ({ label: c, spec: { tags: [c] } })),
    cols: NUMBERS.map(n => ({ label: n, spec: { tags: [n] } })),
  }];
}

function adjectiveTables(): Table[] {
  return NUMBERS.map(n => ({
    title: n === "singular" ? "Singular" : "Plural",
    rows: CASES.map(c => ({ label: c, spec: { tags: [c, n] } })),
    cols: GENDERS.map(g => ({ label: g, spec: { tags: [], gender: g } })),
  }));
}

function verbTables(): Table[] {
  const personRows = PERSONS.map(([tags, label]) => ({ label, spec: { tags: tagsOf(tags) } }));
  const tenses = (mood: string, voice: string, ts: [string, string][]) => ts.map(([t, label]) => ({ label, spec: { tags: tagsOf(t, mood, voice) } }));
  const finite = (mood: string, voice: string, title: string, ts: [string, string][]): Table => ({
    title,
    rows: personRows,
    cols: tenses(mood, voice, ts),
    notes: tenses(mood, voice, ts),
  });
  const ind: [string, string][] = [["present", "present"], ["imperfect", "imperfect"], ["future", "future"],
    ["perfect", "perfect"], ["pluperfect", "pluperfect"], ["future perfect", "future perfect"]];
  const sub: [string, string][] = [["present", "present"], ["imperfect", "imperfect"], ["perfect", "perfect"], ["pluperfect", "pluperfect"]];
  const v = (voice: string) => ({ label: voice, spec: { tags: [voice] } });
  return [
    finite("indicative", "active", "Indicative active", ind.slice(0, 3)),
    finite("indicative", "active", "Indicative active (perfect system)", ind.slice(3)),
    finite("subjunctive", "active", "Subjunctive active", sub),
    finite("indicative", "passive", "Indicative passive", ind.slice(0, 3)),
    finite("indicative", "passive", "Indicative passive (perfect system)", ind.slice(3)),
    finite("subjunctive", "passive", "Subjunctive passive", sub),
    {
      title: "Imperative",
      rows: personRows,
      cols: [["present", "active"], ["future", "active"], ["present", "passive"], ["future", "passive"]]
        .map(([t, vo]) => ({ label: `${t} ${vo}`, spec: { tags: [t!, vo!, "imperative"] } })),
    },
    {
      title: "Infinitives",
      rows: ["present", "perfect", "future"].map(t => ({ label: t, spec: { tags: [t, "infinitive"] } })),
      cols: [v("active"), v("passive")],
    },
    {
      title: "Participles",
      rows: ["present", "perfect", "future"].map(t => ({ label: t, spec: { tags: [t, "participle"] } })),
      cols: [v("active"), v("passive")],
    },
    {
      title: "Gerund and supine",
      rows: ["genitive", "dative", "accusative", "ablative"].map(c => ({ label: c, spec: { tags: [c, "noun-from-verb"] } })),
      cols: [{ label: "gerund", spec: { tags: ["gerund"] } }, { label: "supine", spec: { tags: ["supine"] } }],
    },
  ];
}

function tablesFor(entry: WiktionaryEntry): Table[] {
  const f = entry.forms;
  if (f.some(x => x.tags.includes("indicative") || x.tags.includes("infinitive"))) return verbTables();
  if (f.some(x => x.tags.some(t => GENDERS.includes(t)))) return adjectiveTables();
  if (f.some(x => x.tags.some(t => CASES.includes(t)))) return nounTables();
  return [];
}

const merge = (a: Spec, b: Spec): Spec => ({ tags: [...a.tags, ...b.tags], ...(a.gender || b.gender ? { gender: a.gender ?? b.gender } : {}) });

/** Forms for each cell, with empty rows and columns dropped */
function fill(t: Table, forms: InflectedForm[]) {
  const grid = t.rows.map(r => t.cols.map(c => forms.filter(f => matches(f, merge(r.spec, c.spec))).map(f => f.form)));
  const rows = t.rows.map((_, i) => i).filter(i => grid[i]!.some(c => c.length));
  const cols = t.cols.map((_, j) => j).filter(j => rows.some(i => grid[i]![j]!.length));
  const notes = (t.notes ?? []).flatMap(n => forms.filter(f => matches(f, n.spec)).map(f => ({ label: n.label, form: f.form })));
  return { grid, rows, cols, notes };
}

export function hasInflections(entry: WiktionaryEntry | undefined): boolean {
  return !!entry && tablesFor(entry).some(t => fill(t, entry.forms).rows.length > 0);
}

export function Inflections({ entry, form }: { entry: WiktionaryEntry; /** lookup key of the form being read */ form?: string }) {
  const isCurrent = (f: string) => form !== undefined && lookupKey(f) === form;
  const tables = tablesFor(entry).map(t => ({ t, ...fill(t, entry.forms) })).filter(x => x.rows.length || x.notes.length);
  const comparison = entry.principalParts.filter(p => p.tags.includes("comparative") || p.tags.includes("superlative") || p.tags.includes("adverb"));
  if (!tables.length) return <p className="muted">This word doesn’t inflect.</p>;
  // Open the table that holds the form being read (or the first one)
  const open = Math.max(0, tables.findIndex(x => x.grid.some(r => r.some(c => c.some(isCurrent))) || x.notes.some(n => isCurrent(n.form))));

  return (
    <div className="inflections">
      {tables.map(({ t, grid, rows, cols, notes }, k) => (
        <details key={t.title} open={k === open || tables.length <= 2}>
          <summary>{t.title}</summary>
          {rows.length > 0 && (
            <div className="table-scroll">
            <table className="paradigm">
              <thead>
                <tr><th />{cols.map(j => <th key={j} scope="col">{t.cols[j]!.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(i => (
                  <tr key={i}>
                    <th scope="row">{t.rows[i]!.label}</th>
                    {cols.map(j => {
                      const cell = grid[i]![j]!;
                      return (
                        <td key={j} lang="la" className={cell.some(isCurrent) ? "current-form" : undefined}>
                          {cell.length ? cell.map((f, n) => <span key={n} className={n ? "variant" : undefined}>{f}</span>) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {notes.length > 0 && (
            <ul className="periphrastic">
              {notes.map((n, i) => <li key={i}><span className="label">{n.label}</span><span lang="la">{n.form}</span></li>)}
            </ul>
          )}
        </details>
      ))}
      {comparison.length > 0 && (
        <p className="comparison">
          {comparison.map((p, i) => (
            <span key={i}><span className="label">{p.tags.find(t => ["comparative", "superlative", "adverb"].includes(t))}</span>
              <span lang="la" className={isCurrent(p.form) ? "current-form" : undefined}>{p.form}</span></span>
          ))}
        </p>
      )}
    </div>
  );
}
