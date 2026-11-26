/** Notes from Plater & White's Grammar of the Vulgate: in the word popup, and in a popup for a whole verse. */
import { useRef } from "react";
import type { GrammarNote } from "../../src/api/index.ts";
import { useDismiss, usePlacement } from "./WordPopup.tsx";

export const GRAMMAR_CITATION = "W. E. Plater & H. J. White, A Grammar of the Vulgate (Oxford, 1926)";

export function GrammarNotesBox({ notes, onOpen }: { notes: GrammarNote[]; onOpen(section: number): void }) {
  return (
    <section className="grammar-notes" aria-label="Notes from A Grammar of the Vulgate">
      {notes.map((n, i) => (
        <article key={i} className="grammar-note">
          <header>
            <span className="label">{n.source === "cited" ? "Grammar on this verse" : "Grammar"}</span>
            <button className="section-link" onClick={() => onOpen(n.section)}>§ {n.section} · {n.topic}</button>
          </header>
          {n.label && <p className="note-label">{n.label}</p>}
          <blockquote>{n.text}</blockquote>
        </article>
      ))}
      <p className="note-source">From {GRAMMAR_CITATION}. Public domain.</p>
    </section>
  );
}

interface PopupProps {
  title: string;
  notes: GrammarNote[];
  anchor: HTMLElement;
  onOpen(section: number): void;
  onClose(): void;
}

/** Notes about a verse as a whole (the grammar cites the verse but not particular words in it) */
export function VerseNotesPopup({ title, notes, anchor, onOpen, onClose }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const style = usePlacement(anchor, ref);
  useDismiss(ref, anchor, onClose);
  return (
    <div ref={ref} className="popup" role="dialog" aria-labelledby="notes-title" tabIndex={-1} style={style}>
      <button className="popup-close" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <header className="popup-head">
        <p className="popup-form">Grammar notes</p>
        <h2 id="notes-title">{title}</h2>
      </header>
      <GrammarNotesBox notes={notes} onOpen={onOpen} />
    </div>
  );
}
