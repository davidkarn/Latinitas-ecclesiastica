interface Props {
  title: string;
  playing: boolean;
  verse?: number;
  verseCount?: number;
  canPlay: boolean;
  onToggle(): void;
  prev?: number;
  next?: number;
  onGo(chapter: number): void;
}

export function PlayerBar({ title, playing, verse, verseCount, canPlay, onToggle, prev, next, onGo }: Props) {
  return (
    <nav className="player-bar" aria-label="Chapter navigation and audio">
      <button className="nav-btn prev" disabled={prev === undefined} onClick={() => prev !== undefined && onGo(prev)}
        aria-label={prev !== undefined ? `Previous chapter, ${prev}` : "No previous chapter"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        <span className="nav-label">{prev !== undefined ? `Chapter ${prev}` : "—"}</span>
      </button>

      <div className="player-center">
        <button className="play-btn" onClick={onToggle} disabled={!canPlay}
          aria-label={playing ? "Pause" : "Play chapter audio"} title={playing ? "Pause (space)" : "Play (space)"}>
          {playing
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>}
        </button>
        <div className="player-status" aria-live="polite">
          <span className="player-title">{title}</span>
          <span className="player-verse">{verse !== undefined ? `Verse ${verse} of ${verseCount}` : canPlay ? "Ready" : "No audio"}</span>
        </div>
      </div>

      <button className="nav-btn next" disabled={next === undefined} onClick={() => next !== undefined && onGo(next)}
        aria-label={next !== undefined ? `Next chapter, ${next}` : "No next chapter"}>
        <span className="nav-label">{next !== undefined ? `Chapter ${next}` : "—"}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </nav>
  );
}
