/**
 * Plays a chapter verse by verse (one clip per verse) and reports which word is being spoken,
 * using the per-token start/end times from the chapter file. While a verse plays, the next verse's clip is
 * fetched into memory, so the switch when a clip ends doesn't wait on the network.
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

/** The next verse's clip, fetched ahead into a blob URL (url is set once the download finishes) */
interface Prefetch { index: number; url?: string; abort: AbortController }

function firstWithAudio(vs: Verse[], from: number): number {
  let i = from;
  while (i < vs.length && !vs[i]!.audio) i++;
  return i;
}

export function useChapterAudio(verses: Verse[] | undefined): ChapterAudio {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  audioRef.current ??= typeof Audio !== "undefined" ? new Audio() : null;
  const versesRef = useRef(verses);
  const indexRef = useRef(-1);
  const loadSeq = useRef(0);
  const nextRef = useRef<Prefetch | null>(null);
  /** Blob URL the element is playing, revoked when replaced */
  const blobRef = useRef<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [verseIndex, setVerseIndex] = useState(-1);
  const [active, setActive] = useState<ActiveWord | null>(null);

  const setIndex = (i: number) => { indexRef.current = i; setVerseIndex(i); };

  const dropPrefetch = () => {
    const n = nextRef.current;
    nextRef.current = null;
    if (!n) return;
    n.abort.abort();
    if (n.url) URL.revokeObjectURL(n.url);
  };

  const setSource = (a: HTMLAudioElement, url: string | null) => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = url?.startsWith("blob:") ? url : null;
    if (url) a.src = url;
    else { a.removeAttribute("src"); a.load(); }
  };

  /** Start downloading the clip of the first verse with audio at or after `from` */
  const prefetch = (from: number) => {
    const vs = versesRef.current;
    if (!vs) return;
    const i = firstWithAudio(vs, from);
    if (nextRef.current?.index === i) return;
    dropPrefetch();
    if (i >= vs.length) return;
    const entry: Prefetch = { index: i, abort: new AbortController() };
    nextRef.current = entry;
    void apiUrl(vs[i]!.audio!.file)
      .then(u => fetch(u, { signal: entry.abort.signal }))
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(b => {
        if (nextRef.current === entry) entry.url = URL.createObjectURL(b);
      })
      .catch(() => { if (nextRef.current === entry) nextRef.current = null; });   // playFrom falls back to streaming
  };

  const stop = useCallback(() => {
    const a = audioRef.current;
    loadSeq.current++;
    dropPrefetch();
    if (a) { a.pause(); setSource(a, null); }
    setIndex(-1);
    setActive(null);
    setPlaying(false);
  }, []);

  const playFrom = useCallback((start: number) => {
    const a = audioRef.current, vs = versesRef.current;
    if (!a || !vs) return;
    const i = firstWithAudio(vs, start);
    if (i >= vs.length) { stop(); return; }
    const seq = ++loadSeq.current;
    setIndex(i);
    setActive(null);
    const begin = (url: string) => {
      setSource(a, url);
      a.currentTime = 0;
      a.play().catch(() => setPlaying(false));
      prefetch(i + 1);
    };
    // Already downloaded: switch synchronously, so a clip ending flows straight into the next
    const ready = nextRef.current;
    if (ready?.index === i && ready.url) {
      nextRef.current = null;
      begin(ready.url);
      return;
    }
    dropPrefetch();
    void apiUrl(vs[i]!.audio!.file).then(url => {
      if (seq !== loadSeq.current) return;   // superseded by a later click
      begin(url);
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
    const onPause = () => { if (!a.ended) setPlaying(false); };   // a clip ending isn't a pause: the next one follows
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
