/**
 * Plays a chapter verse by verse (one clip per verse) and reports which word is being spoken,
 * using the per-token start/end times from the chapter file.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Verse } from "../../src/api/index.ts";
import { apiUrl } from "./api.ts";

export interface ActiveWord { verse: number; token: number }

export interface ChapterAudio {
  playing: boolean;
  /** Index into verses of the clip that is loaded (playing or paused), or -1 */
  verseIndex: number;
  active: ActiveWord | null;
  toggle(): void;
  playFrom(verseIndex: number): void;
  stop(): void;
}

/** Index of the token being spoken at time t: the last one that has started, while its verse plays. */
function tokenAt(v: Verse, t: number): number {
  let found = -1;
  for (let i = 0; i < v.tokens.length; i++) {
    const s = v.tokens[i]!.start;
    if (s === undefined) continue;
    if (s <= t) found = i;
    else break;
  }
  return found;
}

export function useChapterAudio(verses: Verse[] | undefined): ChapterAudio {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  audioRef.current ??= typeof Audio !== "undefined" ? new Audio() : null;
  const versesRef = useRef(verses);
  const indexRef = useRef(-1);
  const loadSeq = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [verseIndex, setVerseIndex] = useState(-1);
  const [active, setActive] = useState<ActiveWord | null>(null);

  const setIndex = (i: number) => { indexRef.current = i; setVerseIndex(i); };

  const stop = useCallback(() => {
    const a = audioRef.current;
    loadSeq.current++;
    if (a) { a.pause(); a.removeAttribute("src"); a.load(); }
    setIndex(-1);
    setActive(null);
    setPlaying(false);
  }, []);

  const playFrom = useCallback((start: number) => {
    const a = audioRef.current, vs = versesRef.current;
    if (!a || !vs) return;
    let i = start;
    while (i < vs.length && !vs[i]!.audio) i++;
    if (i >= vs.length) { stop(); return; }
    const seq = ++loadSeq.current;
    setIndex(i);
    setActive(null);
    void apiUrl(vs[i]!.audio!.file).then(url => {
      if (seq !== loadSeq.current) return;   // superseded by a later click
      a.src = url;
      a.currentTime = 0;
      a.play().catch(() => setPlaying(false));
    });
  }, [stop]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) a.pause();
    else if (indexRef.current >= 0 && a.src) a.play().catch(() => setPlaying(false));
    else playFrom(0);
  }, [playFrom]);

  // New chapter: stop whatever was playing
  useEffect(() => {
    versesRef.current = verses;
    stop();
  }, [verses, stop]);

  // Audio element events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      const next = indexRef.current + 1;
      if (versesRef.current && next < versesRef.current.length) playFrom(next);
      else stop();
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.pause();
    };
  }, [playFrom, stop]);

  // Word highlighting: poll currentTime every frame while playing; re-render only when the word changes
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current, v = versesRef.current?.[indexRef.current];
      if (a && v) {
        const token = tokenAt(v, a.currentTime);
        setActive(prev => {
          const next = token < 0 ? null : { verse: indexRef.current, token };
          return prev?.verse === next?.verse && prev?.token === next?.token ? prev : next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return { playing, verseIndex, active, toggle, playFrom, stop };
}
