/** Latin text normalization shared by the generator and the frontend. No Node dependencies. */

/** Strip diacritics (macrons, breves, diaeresis), lowercase, and fold orthographic variants:
 *  j → i, æ → ae, œ → oe. Keeps u/v distinct, as both Wiktionary and Lewis & Short do. */
export function lookupKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/j/g, "i")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/[ˈ'’]/g, "")
    .trim();
}

/** Filesystem- and URL-safe slug for a lookup key: runs of anything outside [a-z0-9-] become "_".
 *  Distinct words can share a slug ("a.d." and "a d"); endpoint files hold an array for that reason. */
export function slug(s: string): string {
  const k = lookupKey(s).replace(/[^a-z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
  return k || "_";
}

const ENCLITICS = ["que", "ne", "ve", "ce"] as const;

/** Lookup keys to try for a token from running text, most specific first:
 *  "Dixitque" → ["dixitque", "dixit"]. A real word ending in -que/-ne (e.g. "quoque", "bene")
 *  is tried whole first, so the caller should stop at the first hit. */
export function lookupCandidates(token: string): string[] {
  const k = lookupKey(token).replace(/[^\p{L}-]/gu, "");
  const out = [k];
  for (const e of ENCLITICS) {
    if (k.length > e.length + 1 && k.endsWith(e)) out.push(k.slice(0, -e.length));
  }
  return out;
}
