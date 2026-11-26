/** The whole of Plater & White's Grammar of the Vulgate, with a contents list; /grammar/23 opens at § 23. */
import { useEffect, useState } from "react";
import { paths, type GrammarBlock, type GrammarFile, type GrammarSection } from "../../src/api/index.ts";
import { getJson } from "./api.ts";

interface Props {
  section: number | null;
  onOpen(section: number): void;
  onBack(): void;
  backLabel: string;
}

export function GrammarPage({ section, onOpen, onBack, backLabel }: Props) {
  const [g, setG] = useState<GrammarFile>();
  const [error, setError] = useState<string>();
  useEffect(() => { getJson<GrammarFile>(paths.grammar()).then(setG, e => setError(String(e))); }, []);

  useEffect(() => {
    document.title = section ? `§ ${section} — A Grammar of the Vulgate` : "A Grammar of the Vulgate";
    if (!g) return;
    const el = section ? document.getElementById(`s-${section}`) : null;
    if (el) el.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }, [g, section]);

  if (error) return <main className="page"><p className="error">Couldn’t load the grammar: {error}</p></main>;
  if (!g) return <main className="page"><p className="loading">Loading…</p></main>;

  const byChapter = (id: string) => g.sections.filter(s => s.chapter === id || (id === "intro" && s.n === 0));
  return (
    <div className="grammar-page">
      <header className="masthead grammar-head">
        <button className="back-btn" onClick={onBack}>← {backLabel}</button>
        <div>
          <h1>A Grammar of the Vulgate</h1>
          <p className="muted">{g.authors.join(" & ")} · {g.published} · {g.license}</p>
        </div>
      </header>

      <div className="grammar-layout">
        <nav className="grammar-toc" aria-label="Contents">
          <details open={innerWidth >= 900}>
            <summary>Contents</summary>
            <ol>
              {g.chapters.map(c => (
                <li key={c.id}>
                  <span className="toc-chapter">{c.id === "intro" ? "" : `${c.id}. `}{c.title}</span>
                  <ol>
                    {topics(byChapter(c.id)).map(t => (
                      <li key={t.first}>
                        <a href={`/grammar/${t.first}`} className={section !== null && section >= t.first && section <= t.last ? "on" : undefined}
                          onClick={e => { e.preventDefault(); onOpen(t.first); }}>
                          {t.topic} <span className="muted">§ {t.first}{t.last > t.first ? `–${t.last}` : ""}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          </details>
        </nav>

        <article className="grammar-text">
          <p className="grammar-source">
            Text from an OCR scan of the 1926 edition. Greek and Hebrew in particular may be garbled; the page
            references in the original are omitted.
          </p>
          {g.chapters.map(c => (
            <section key={c.id} className="grammar-chapter">
              <h2>{c.id === "intro" ? "" : `${c.id}. `}{c.title}</h2>
              {byChapter(c.id).map(s => <Section key={s.n} s={s} current={s.n === section} />)}
            </section>
          ))}
          <section className="grammar-chapter">
            <h2>Conclusion</h2>
            <Blocks blocks={g.conclusion.blocks} />
            <Footnotes notes={g.conclusion.footnotes} />
          </section>
        </article>
      </div>
    </div>
  );
}

/** Runs of consecutive sections sharing a topic, for the contents list */
function topics(sections: GrammarSection[]) {
  const out: { topic: string; first: number; last: number }[] = [];
  for (const s of sections) {
    if (s.n === 0) continue;
    const last = out.at(-1);
    if (last && last.topic === s.topic && last.last === s.n - 1) last.last = s.n;
    else out.push({ topic: s.topic, first: s.n, last: s.n });
  }
  return out;
}

function Section({ s, current }: { s: GrammarSection; current: boolean }) {
  return (
    <section id={s.n ? `s-${s.n}` : undefined} className={`grammar-section${current ? " current" : ""}`}>
      {s.n > 0 && <p className="section-tag">§ {s.n} · {s.topic}</p>}
      <Blocks blocks={s.blocks} />
      <Footnotes notes={s.footnotes} />
    </section>
  );
}

// The HTML comes from scripts/convert_grammar.py, which keeps only i, b, sup, br and table/list tags.
function Blocks({ blocks }: { blocks: GrammarBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "h") return <h3 key={i} dangerouslySetInnerHTML={{ __html: b.html }} />;
        if (b.type === "table") return <div key={i} className="table-scroll" dangerouslySetInnerHTML={{ __html: b.html }} />;
        if (b.type === "list") return <div key={i} className="g-list" dangerouslySetInnerHTML={{ __html: b.html }} />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: b.html }} />;
      })}
    </>
  );
}

function Footnotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <aside className="g-footnotes">
      {notes.map((n, i) => <p key={i} dangerouslySetInnerHTML={{ __html: n }} />)}
    </aside>
  );
}
