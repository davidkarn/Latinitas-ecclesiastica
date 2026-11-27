/** Where the reader left off (book, chapter, and the last verse played there), kept in this browser only. */

export interface Position { text: string; chapter: number; verse?: number }

const KEY = "position";

export function loadPosition(): Position | undefined {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Position> | null;
    if (!p || typeof p.text !== "string" || !/^[a-z0-9-]+$/.test(p.text) || !Number.isInteger(p.chapter)) return undefined;
    return { text: p.text, chapter: p.chapter!, ...(Number.isInteger(p.verse) ? { verse: p.verse! } : {}) };
  } catch {
    return undefined;   // storage blocked (private mode) or bad data: start fresh
  }
}

export function savePosition(p: Position): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not remembered */ }
}
