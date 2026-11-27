import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChapterFile, GrammarNote, TextIndex, Token, Verse } from "../../src/api/index.ts";
import { getChapter, getTextIndex } from "./api.ts";
import { VerseNotesPopup } from "./GrammarNotes.tsx";
import { GrammarPage } from "./GrammarPage.tsx";
import { PlayerBar } from "./PlayerBar.tsx";
import { Reader } from "./Reader.tsx";
import { useChapterAudio } from "./useChapterAudio.ts";
import { WordPopup } from "./WordPopup.tsx";

interface Route { text: string; chapter: number }

function parseRoute(): Route {
  const m = /^\/([a-z0-9-]+)\/(\d+)\/?$/.exec(location.pathname);
  return m && m[1] !== "grammar" ? { text: m[1]!, chapter: Number(m[2]) } : { text: "genesis", chapter: 1 };
}

/** undefined: reading a text; null: the grammar's start; n: § n */
function parseGrammar(): number | null | undefined {
  const m = /^\/grammar(?:\/(\d+))?\/?$/.exec(location.pathname);
  return m ? (m[1] ? Number(m[1]) : null) : undefined;
}

function readFlag(name: string): boolean {
  try { return localStorage.getItem(name) !== "0"; } catch { return true; }
}
function useFlag(name: string): [boolean, () => void] {
  const [on, setOn] = useState(() => readFlag(name));
  const toggle = useCallback(() => setOn(v => {
    try { localStorage.setItem(name, v ? "0" : "1"); } catch { /* private mode: not remembered */ }
    return !v;
  }), [name]);
  return [on, toggle];
}

export type Selection =
  | { kind: "word"; token: Token; verse: Verse; notes: GrammarNote[]; anchor: HTMLElement; seq: number }
  | { kind: "verse"; verse: Verse; anchor: HTMLElement; seq: number };
let selectionSeq = 0;

export function App() {
  const [route, setRoute] = useState(parseRoute);
  const [grammarAt, setGrammarAt] = useState(parseGrammar);
  const [index, setIndex] = useState<TextIndex>();
  const [chapter, setChapter] = useState<ChapterFile>();
  const [error, setError] = useState<string>();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showEnglish, toggleEnglish] = useFlag("showEnglish");
  const [showNotes, toggleNotes] = useFlag("showNotes");
  const audio = useChapterAudio(chapter?.verses);

  useEffect(() => { getTextIndex().then(setIndex, e => setError(String(e))); }, []);

  useEffect(() => {
    let live = true;
    setError(undefined);
    setSelection(null);
    getChapter(route.text, route.chapter).then(
      c => { if (live) { setChapter(c); window.scrollTo({ top: 0 }); } },
      e => { if (live) setError(String(e)); },
    );
    return () => { live = false; };
  }, [route.text, route.chapter]);

  useEffect(() => {
    const onPop = () => {
      const g = parseGrammar();
      setGrammarAt(g);
      if (g === undefined) setRoute(parseRoute());
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const text = index?.texts.find(t => t.id === route.text);
  const chapters = text?.chapters.map(c => c.chapter) ?? [];
  // Previous/next run on across books: Genesis 50 → Exodus 1
  const all = index?.texts.flatMap(t => t.chapters.map(c => ({ text: t.id, title: t.title, chapter: c.chapter }))) ?? [];
  const pos = all.findIndex(r => r.text === route.text && r.chapter === route.chapter);
  const prev = pos > 0 ? all[pos - 1] : undefined;
  const next = pos >= 0 && pos < all.length - 1 ? all[pos + 1] : undefined;
  const label = (r: { text: string; title: string; chapter: number }) =>
    r.text === route.text ? `Chapter ${r.chapter}` : `${r.title} ${r.chapter}`;

  const go = useCallback((r: Route) => {
    history.pushState(null, "", `/${r.text}/${r.chapter}`);
    setRoute({ text: r.text, chapter: r.chapter });
    setGrammarAt(undefined);
  }, []);

  // Grammar pages opened from the reader count their depth, so "back" returns to the reader in one step
  const readerScroll = useRef(0);
  const openGrammar = useCallback((section: number) => {
    const depth = (history.state as { grammarDepth?: number } | null)?.grammarDepth ?? 0;
    if (grammarAt === undefined) readerScroll.current = scrollY;
    history.pushState({ grammarDepth: grammarAt === undefined ? 1 : depth + (depth ? 1 : 0) }, "", `/grammar/${section}`);
    setSelection(null);
    if (audio.playing) audio.toggle();
    setGrammarAt(section);
  }, [audio, grammarAt]);
  const leaveGrammar = useCallback(() => {
    const depth = (history.state as { grammarDepth?: number } | null)?.grammarDepth;
    if (depth) history.go(-depth);
    else go(route);
  }, [go, route]);
  // Back in the reader: where it was
  useLayoutEffect(() => {
    if (grammarAt === undefined && readerScroll.current) {
      scrollTo({ top: readerScroll.current });
      readerScroll.current = 0;
    }
  }, [grammarAt]);

  useEffect(() => {
    if (chapter) document.title = `${chapter.title} ${chapter.chapter} — Learn Latin`;
  }, [chapter]);

  // Space toggles playback; ← / → change chapter (unless typing or a popup is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, select, textarea")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || selection || grammarAt !== undefined) return;
      if (e.key === " ") { e.preventDefault(); audio.toggle(); }
      else if (e.key === "ArrowLeft" && prev !== undefined) go(prev);
      else if (e.key === "ArrowRight" && next !== undefined) go(next);
      else if (e.key === "e") toggleEnglish();
      else if (e.key === "g") toggleNotes();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [audio, prev, next, go, selection, toggleEnglish, toggleNotes, grammarAt]);

  const select = useCallback((token: Token, anchor: HTMLElement, verse: Verse) => {
    const i = verse.tokens.indexOf(token);
    const notes = verse.notes?.filter(n => n.tokens.includes(i)) ?? [];
    setSelection({ kind: "word", token, verse, notes, anchor, seq: ++selectionSeq });
  }, []);
  const selectVerse = useCallback((verse: Verse, anchor: HTMLElement) =>
    setSelection({ kind: "verse", verse, anchor, seq: ++selectionSeq }), []);
  const closePopup = useCallback(() => setSelection(null), []);

  const current = chapter && chapter.text === route.text && chapter.chapter === route.chapter ? chapter : undefined;

  if (grammarAt !== undefined) {
    return <GrammarPage section={grammarAt} onOpen={openGrammar} onBack={leaveGrammar}
      backLabel={`${text?.title ?? "Back"} ${route.chapter}`} />;
  }

  return (
    <>
      <header className="masthead">
        <h1>{text?.title ?? ""} <span className="chapter-no">{route.chapter}</span>
          {text?.aka && <span className="book-aka">{text.aka} {route.chapter}</span>}</h1>
        <div className="masthead-tools">
        <button className="toggle" role="switch" aria-checked={showEnglish} onClick={toggleEnglish}
          title="Show or hide the English translation (E)">
          <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
          English
        </button>
        <button className="toggle" role="switch" aria-checked={showNotes} onClick={toggleNotes}
          title="Mark words the Grammar of the Vulgate comments on (G)">
          <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
          Grammar
        </button>
        <a className="grammar-link" href="/grammar" onClick={e => { e.preventDefault(); openGrammar(1); }}>§ Grammar</a>
        {index && index.texts.length > 1 && (
          <label className="chapter-select">
            <span className="visually-hidden">Book</span>
            <select value={route.text} onChange={e => {
              const t = index.texts.find(x => x.id === e.target.value);
              if (t?.chapters[0]) go({ text: t.id, chapter: t.chapters[0].chapter });
            }}>
              {index.texts.map(t => <option key={t.id} value={t.id}>{t.aka ? `${t.title} (${t.aka})` : t.title}</option>)}
            </select>
          </label>
        )}
        {chapters.length > 0 && (
          <label className="chapter-select">
            <span className="visually-hidden">Chapter</span>
            <select value={route.chapter} onChange={e => go({ text: route.text, chapter: Number(e.target.value) })}>
              {chapters.map(c => <option key={c} value={c}>Chapter {c}</option>)}
            </select>
          </label>
        )}
        </div>
      </header>

      <main className="page">
        {error && <p className="error">Couldn’t load this chapter: {error}</p>}
        {!current && !error && <p className="loading">Loading…</p>}
        {current && (
          <Reader
            chapter={current}
            audio={audio}
            selectedToken={selection?.kind === "word" ? selection.token : null}
            showEnglish={showEnglish}
            showNotes={showNotes}
            onSelect={select}
            onVerseNotes={selectVerse}
          />
        )}
      </main>

      <PlayerBar
        title={`${text?.title ?? ""} ${route.chapter}`.trim()}
        playing={audio.playing}
        verse={current && audio.verseIndex >= 0 ? current.verses[audio.verseIndex]?.verse : undefined}
        verseCount={current?.verses.length}
        canPlay={!!current?.verses.some(v => v.audio)}
        onToggle={audio.toggle}
        prev={prev && label(prev)}
        next={next && label(next)}
        onPrev={() => prev && go(prev)}
        onNext={() => next && go(next)}
      />

      {selection?.kind === "word" && current && (
        <WordPopup
          key={selection.seq}
          token={selection.token}
          anchor={selection.anchor}
          words={current.words}
          notes={showNotes ? selection.notes : []}
          onOpenGrammar={openGrammar}
          onClose={closePopup}
        />
      )}
      {selection?.kind === "verse" && (
        <VerseNotesPopup
          key={selection.seq}
          title={selection.verse.ref}
          notes={selection.verse.notes?.filter(n => !n.tokens.length) ?? []}
          anchor={selection.anchor}
          onOpen={openGrammar}
          onClose={closePopup}
        />
      )}
    </>
  );
}
