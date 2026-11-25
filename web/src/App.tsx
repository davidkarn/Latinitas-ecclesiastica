import { useCallback, useEffect, useState } from "react";
import type { ChapterFile, TextIndex, Token } from "../../src/api/index.ts";
import { getChapter, getTextIndex } from "./api.ts";
import { PlayerBar } from "./PlayerBar.tsx";
import { Reader } from "./Reader.tsx";
import { useChapterAudio } from "./useChapterAudio.ts";
import { WordPopup } from "./WordPopup.tsx";

interface Route { text: string; chapter: number }

function parseRoute(): Route {
  const m = /^\/([a-z0-9-]+)\/(\d+)\/?$/.exec(location.pathname);
  return m ? { text: m[1]!, chapter: Number(m[2]) } : { text: "genesis", chapter: 1 };
}

export interface Selection { token: Token; anchor: HTMLElement; seq: number }
let selectionSeq = 0;

export function App() {
  const [route, setRoute] = useState(parseRoute);
  const [index, setIndex] = useState<TextIndex>();
  const [chapter, setChapter] = useState<ChapterFile>();
  const [error, setError] = useState<string>();
  const [selection, setSelection] = useState<Selection | null>(null);
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
    const onPop = () => setRoute(parseRoute());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const text = index?.texts.find(t => t.id === route.text);
  const chapters = text?.chapters.map(c => c.chapter) ?? [];
  const pos = chapters.indexOf(route.chapter);
  const prev = pos > 0 ? chapters[pos - 1] : undefined;
  const next = pos >= 0 && pos < chapters.length - 1 ? chapters[pos + 1] : undefined;

  const go = useCallback((n: number) => {
    const r = { text: route.text, chapter: n };
    history.pushState(null, "", `/${r.text}/${r.chapter}`);
    setRoute(r);
  }, [route.text]);

  useEffect(() => {
    if (chapter) document.title = `${chapter.title} ${chapter.chapter} — Learn Latin`;
  }, [chapter]);

  // Space toggles playback; ← / → change chapter (unless typing or a popup is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, select, textarea")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || selection) return;
      if (e.key === " ") { e.preventDefault(); audio.toggle(); }
      else if (e.key === "ArrowLeft" && prev !== undefined) go(prev);
      else if (e.key === "ArrowRight" && next !== undefined) go(next);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [audio, prev, next, go, selection]);

  const select = useCallback((token: Token, anchor: HTMLElement) => setSelection({ token, anchor, seq: ++selectionSeq }), []);
  const closePopup = useCallback(() => setSelection(null), []);

  const current = chapter && chapter.text === route.text && chapter.chapter === route.chapter ? chapter : undefined;

  return (
    <>
      <header className="masthead">
        <h1>{text?.title ?? "Genesis"} <span className="chapter-no">{route.chapter}</span></h1>
        {chapters.length > 0 && (
          <label className="chapter-select">
            <span className="visually-hidden">Chapter</span>
            <select value={route.chapter} onChange={e => go(Number(e.target.value))}>
              {chapters.map(c => <option key={c} value={c}>Chapter {c}</option>)}
            </select>
          </label>
        )}
      </header>

      <main className="page">
        {error && <p className="error">Couldn’t load this chapter: {error}</p>}
        {!current && !error && <p className="loading">Loading…</p>}
        {current && (
          <Reader
            chapter={current}
            audio={audio}
            selectedToken={selection?.token ?? null}
            onSelect={select}
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
        prev={prev}
        next={next}
        onGo={go}
      />

      {selection && current && (
        <WordPopup
          key={selection.seq}
          token={selection.token}
          anchor={selection.anchor}
          words={current.words}
          onClose={closePopup}
        />
      )}
    </>
  );
}
