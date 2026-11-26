import { memo, useEffect, useRef, type ReactNode } from "react";
import type { ChapterFile, Token, Verse } from "../../src/api/index.ts";
import type { ChapterAudio } from "./useChapterAudio.ts";

interface Props {
  chapter: ChapterFile;
  audio: ChapterAudio;
  selectedToken: Token | null;
  showEnglish: boolean;
  /** Mark words and verses that have notes from the grammar */
  showNotes: boolean;
  onSelect(token: Token, anchor: HTMLElement, verse: Verse): void;
  /** Open the notes about a verse as a whole */
  onVerseNotes(verse: Verse, anchor: HTMLElement): void;
}

export function Reader({ chapter, audio, selectedToken, showEnglish, showNotes, onSelect, onVerseNotes }: Props) {
  const rows = useRef<(HTMLElement | null)[]>([]);

  // Keep the verse being read in view
  useEffect(() => {
    if (audio.verseIndex < 0 || !audio.playing) return;
    const el = rows.current[audio.verseIndex];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bottom = innerHeight - 96;   // above the player bar
    if (r.top < 72 || r.bottom > bottom) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [audio.verseIndex, audio.playing]);

  return (
    <article className={`reader${showEnglish ? "" : " latin-only"}`}>
      <div className="columns-head" aria-hidden="true">
        <div>Latin <span>Vulgata Clementina</span></div>
        {showEnglish && <div>English <span>Douay–Rheims</span></div>}
      </div>

      {chapter.verses.map((v, i) => {
        const current = i === audio.verseIndex;
        return (
          <section key={v.verse} ref={el => { rows.current[i] = el; }}
            className={`verse${current ? " current" : ""}`} aria-label={v.ref}>
            <div className="latin" lang="la">
              <button className="verse-no" onClick={() => audio.playFrom(i)} disabled={!v.audio}
                title={v.audio ? `Play from verse ${v.verse}` : undefined} aria-label={`Play from verse ${v.verse}`}>
                {v.verse}
              </button>
              <LatinVerse verse={v}
                activeToken={current && audio.active?.verse === i ? audio.active.token : -1}
                selected={selectedToken && v.tokens.includes(selectedToken) ? selectedToken : null}
                showNotes={showNotes}
                onSelect={onSelect} />
              {showNotes && v.notes?.some(n => !n.tokens.length) && (
                <button className="verse-note" onClick={e => onVerseNotes(v, e.currentTarget)} aria-haspopup="dialog"
                  title="The grammar comments on this verse" aria-label={`Grammar notes on ${v.ref}`}>§</button>
              )}
            </div>
            {showEnglish && (
              <div className="english" lang="en">
                <span className="verse-no static" aria-hidden="true">
                  {v.englishVerses ? `${v.englishVerses[0]}–${v.englishVerses.at(-1)}` : v.verse}
                </span>
                {v.english || <em className="muted">(no English text)</em>}
              </div>
            )}
          </section>
        );
      })}

      <footer className="text-sources">
        <p>Latin: {chapter.sources.latin}.</p>
        <p>English: {chapter.sources.english}.</p>
        <p>Audio: {chapter.sources.audio}.</p>
      </footer>
    </article>
  );
}

interface VerseProps {
  verse: Verse;
  activeToken: number;
  selected: Token | null;
  showNotes: boolean;
  onSelect(token: Token, anchor: HTMLElement, verse: Verse): void;
}

/** The verse text with each token as a clickable word; punctuation and spacing come from the original text. */
const LatinVerse = memo(function LatinVerse({ verse, activeToken, selected, showNotes, onSelect }: VerseProps) {
  const noted = new Set(showNotes ? verse.notes?.flatMap(n => n.tokens) : []);
  const parts: ReactNode[] = [];
  let at = 0;
  verse.tokens.forEach((t, i) => {
    if (t.offset > at) parts.push(verse.latin.slice(at, t.offset));
    const cls = ["w", i === activeToken && "speaking", t === selected && "selected", !t.wordId && "unknown", noted.has(i) && "has-note"]
      .filter(Boolean).join(" ");
    parts.push(
      <button key={i} className={cls} onClick={e => onSelect(t, e.currentTarget, verse)}
        aria-haspopup="dialog">
        {verse.latin.slice(t.offset, t.offset + t.text.length) || t.text}
      </button>,
    );
    at = Math.max(at, t.offset + t.text.length);
  });
  if (at < verse.latin.length) parts.push(verse.latin.slice(at));
  return <p className="verse-text">{parts}</p>;
});
