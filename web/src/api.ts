/** Fetching the static JSON API (served at /api by nginx, or by the Vite dev server from ../dist/api). */
import { paths, type ChapterFile, type Manifest, type TextIndex, type WordFile } from "../../src/api/index.ts";

export const API_ROOT = "/api/";

let buildId: Promise<string> | undefined;

/** The manifest is served no-cache; its buildId busts the cache on everything else. */
function version(): Promise<string> {
  return (buildId ??= fetch(API_ROOT + paths.manifest(), { cache: "no-cache" })
    .then(r => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error(`manifest: ${r.status}`))))
    .then(m => m.buildId)
    .catch(() => ""));
}

export async function apiUrl(rel: string): Promise<string> {
  const v = await version();
  return API_ROOT + rel + (v ? `?v=${v}` : "");
}

const cache = new Map<string, Promise<unknown>>();

export function getJson<T>(rel: string): Promise<T> {
  let p = cache.get(rel) as Promise<T> | undefined;
  if (!p) {
    p = apiUrl(rel).then(async url => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
      return (await r.json()) as T;
    });
    p.catch(() => cache.delete(rel));
    cache.set(rel, p);
  }
  return p;
}

export const getTextIndex = () => getJson<TextIndex>(paths.texts());
export const getChapter = (text: string, n: number) => getJson<ChapterFile>(paths.chapter(text, n));
export const getWordFile = (file: string) => getJson<WordFile>(file);
