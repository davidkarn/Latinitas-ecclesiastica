import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  paths,
  type GrammarNote, type LewisShortEntry, type LexiconEntry, type LsSense, type Token, type WiktionaryEntry, type WordFile, type WordSummary,
} from "../../src/api/index.ts";
import { getWordFile } from "./api.ts";
import { describeAnalyses, ENCLITIC, POS_LABEL } from "./grammar.ts";
import { GrammarNotesBox } from "./GrammarNotes.tsx";
import { hasInflections, Inflections } from "./Inflections.tsx";

interface Props {
  token: Token;
  anchor: HTMLElement;
  words: Record<string, WordSummary>;
  /** Grammar notes on this word */
  notes: GrammarNote[];
  onOpenGrammar(section: number): void;
  onClose(): void;
}

type Tab = "forms" | "ls" | "wikt" | "lex";
/** The tab last chosen, so a reader who wants inflections keeps getting them */
let preferredTab: Tab | null = null;

export function WordPopup({ token, anchor, words, notes, onOpenGrammar, onClose }: Props) {
  const readings = token.wordId
    ? [{ wordId: token.wordId, analyses: token.analyses }, ...(token.alternatives ?? [])]
    : [];
  const [wordId, setWordId] = useState(token.wordId);
  const reading = readings.find(r => r.wordId === wordId);
  const summary = wordId ? words[wordId] : undefined;
  const entries = useEntries(summary);
  const [tab, setTabState] = useState<Tab | null>(preferredTab);
  const setTab = (t: Tab | null) => { if (t) preferredTab = t; setTabState(t); };

  const ref = useRef<HTMLDivElement>(null);
  const style = usePlacement(anchor, ref);
  useDismiss(ref, anchor, onClose);

  const available: Record<Tab, number> = {
    forms: entries.data?.paradigm ? 1 : 0,
    ls: entries.data?.lewisShort.length ?? 0,
    wikt: entries.data?.wiktionary ? 1 : 0,
    lex: entries.data?.lexicon.length ?? 0,
  };
  // The chosen tab if this word has it (prepositions have no inflection), else the first dictionary that does
  const shownTab: Tab = tab && (!entries.data || available[tab]) ? tab
    : (["ls", "wikt", "lex", "forms"] as const).find(t => available[t]) ?? "ls";

  return (
    <div ref={ref} className="popup" role="dialog" aria-modal="false" aria-labelledby="popup-title" tabIndex={-1} style={style}>
      <button className="popup-close" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>

      <header className="popup-head">
        <p className="popup-form" lang="la">{token.text}</p>
        {summary ? (
          <>
            <h2 id="popup-title" lang="la">
              {summary.lemma}
              <span className="pos">{POS_LABEL[summary.pos] ?? summary.pos}</span>
            </h2>
            <PrincipalParts summary={summary} />
            {reading && describeAnalyses(reading.analyses).length > 0 && (
              <p className="parse">
                <span className="label">This form</span>
                {describeAnalyses(reading.analyses).join(" · ")}
              </p>
            )}
            {token.enclitic && (
              <p className="parse"><span className="label">+ -{token.enclitic}</span>{ENCLITIC[token.enclitic] ?? "enclitic"}</p>
            )}
            {summary.altOf?.length ? (
              <p className="parse"><span className="label">Spelling of</span><span lang="la">{summary.altOf.map(a => a.lemma).join(", ")}</span></p>
            ) : null}
            {(summary.lewisShort?.definition || summary.gloss) && (
              <p className="short-def">{summary.lewisShort?.definition || summary.gloss}</p>
            )}
          </>
        ) : (
          <>
            <h2 id="popup-title">Not in the dictionaries</h2>
            <p className="muted">
              {token.properName
                ? "Probably a proper name: most unrecognised words in Genesis are Hebrew names of people and places."
                : "None of the dictionaries lists this form."}
            </p>
          </>
        )}

        {notes.length > 0 && <GrammarNotesBox notes={notes} onOpen={onOpenGrammar} />}

        {readings.length > 1 && (
          <div className="readings">
            <span className="label">Could also be</span>
            <div className="chips">
              {readings.map(r => {
                const s = words[r.wordId];
                if (!s) return null;
                return (
                  <button key={r.wordId} className={`chip${r.wordId === wordId ? " on" : ""}`}
                    aria-pressed={r.wordId === wordId} onClick={() => { setWordId(r.wordId); setTab(null); }}>
                    <span lang="la">{s.lemma}</span> <small>{POS_LABEL[s.pos] ?? s.pos}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {summary && (
        <div className="popup-body">
          <div className="tabs" role="tablist" aria-label="Dictionaries">
            {([["ls", "Lewis & Short"], ["wikt", "Wiktionary"], ["lex", "St. Thomas"], ["forms", "Inflection"]] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={shownTab === id} className={shownTab === id ? "on" : ""}
                disabled={entries.data !== undefined && !available[id]} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel">
            {entries.error && <p className="error">Couldn’t load the dictionary entries.</p>}
            {!entries.data && !entries.error && <p className="muted">Loading…</p>}
            {entries.data && shownTab === "ls" && <LewisShort entries={entries.data.lewisShort} matched={summary.lewisShort?.key} />}
            {entries.data && shownTab === "wikt" && entries.data.wiktionary && <Wiktionary entry={entries.data.wiktionary} />}
            {entries.data && shownTab === "lex" && <Lexicon entries={entries.data.lexicon} />}
            {entries.data && shownTab === "forms" && entries.data.paradigm && (
              <>
                {entries.data.paradigm.id !== summary.id && (
                  <p className="muted">Forms of <span lang="la">{entries.data.paradigm.canonical}</span>, of which this is a spelling.</p>
                )}
                <Inflections entry={entries.data.paradigm}
                  form={wordId === token.wordId || token.alternatives?.some(a => a.wordId === wordId) ? token.form : undefined} />
                <Attribution>
                  Inflected forms from <a href={`https://en.wiktionary.org/wiki/${encodeURIComponent(plain(entries.data.paradigm.canonical))}#Latin`}
                    target="_blank" rel="noreferrer">Wiktionary</a>, by its contributors, via kaikki.org (wiktextract);
                  licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
                </Attribution>
              </>
            )}
            {entries.data && !available[shownTab] && <p className="muted">No entry in this dictionary.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- data ----------

interface Entries {
  wiktionary?: WiktionaryEntry;
  /** Entry whose forms make the inflection table: this one, or for an alternative spelling, the main one's */
  paradigm?: WiktionaryEntry;
  lewisShort: LewisShortEntry[];
  lexicon: LexiconEntry[];
}

/** Loads the word file and picks out this word's entries. Alternative spellings borrow the
 *  Lewis & Short / Lexicon entries of the spelling they point to. */
function useEntries(summary: WordSummary | undefined): { data?: Entries; error?: boolean } {
  const [state, setState] = useState<{ id?: string; data?: Entries; error?: boolean }>({});
  useEffect(() => {
    if (!summary) return;
    let live = true;
    (async () => {
      const file = await getWordFile(summary.file);
      const group = file.words.find(w => w.key === summary.key) ?? file.words[0];
      const wiktionary = group?.wiktionary.find(e => e.id === summary.id);
      let lewisShort = group?.lewisShort ?? [];
      let lexicon = group?.lexicon ?? [];
      const target = summary.altOf?.find(a => a.id)?.id;
      let paradigm = hasInflections(wiktionary) ? wiktionary : undefined;
      if (target && !paradigm) {
        const other: WordFile = await getWordFile(paths.word(target.split(":")[0]!));
        const e = other.words.flatMap(w => w.wiktionary).find(e => e.id === target);
        if (hasInflections(e)) paradigm = e;
      }
      if (target && ((summary.lewisShort && !lewisShort.some(e => e.key === summary.lewisShort!.key)) || !lexicon.length)) {
        const key = target.split(":")[0]!;
        const other: WordFile = await getWordFile(paths.word(key));
        const g = other.words.find(w => w.key === key);
        if (g && !lewisShort.some(e => e.key === summary.lewisShort?.key)) lewisShort = [...lewisShort, ...g.lewisShort];
        if (g && !lexicon.length) lexicon = g.lexicon;
      }
      // Same spelling, different verb (dīcō 3 "say" vs dicō 1 "dedicate"): match the conjugation when both state one
      const conj = conjugationOf(summary.inflectionClass);
      if (conj) lexicon = lexicon.filter(e => !e.conjugation || e.conjugation === conj);
      // The entry matched to this word first
      const k = summary.lewisShort?.key;
      lewisShort = [...lewisShort].sort((a, b) => Number(b.key === k) - Number(a.key === k));
      if (live) setState({ id: summary.id, data: { wiktionary, paradigm, lewisShort, lexicon } });
    })().catch(() => { if (live) setState({ id: summary.id, error: true }); });
    return () => { live = false; };
  }, [summary]);
  return state.id === summary?.id ? state : {};
}

const CONJ: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };
function conjugationOf(inflectionClass?: string): number | undefined {
  const m = /\b(first|second|third|fourth) conjugation/.exec(inflectionClass ?? "");
  return m ? CONJ[m[1]!] : undefined;
}

// ---------- placement ----------

/** Escape or a click outside closes the popup; focus moves into it, and back to the anchor on close */
export function useDismiss(ref: RefObject<HTMLDivElement | null>, anchor: HTMLElement, onClose: () => void) {
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [ref, anchor, onClose]);
}

const BAR = 84;     // fixed player bar
const GAP = 8;

export function usePlacement(anchor: HTMLElement, ref: RefObject<HTMLDivElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      if (innerWidth < 640) { setStyle({}); return; }   // bottom sheet, positioned by CSS
      const r = anchor.getBoundingClientRect();
      const width = Math.min(460, innerWidth - 24);
      const room = innerHeight - BAR - GAP * 2;
      const h = Math.min(ref.current?.scrollHeight ?? 560, room, 640);
      // Beside the word, over the other column, so the verse stays readable
      // Over the English column, or just right of the Latin when English is hidden
      const english = document.querySelector(".verse .english")?.getBoundingClientRect().left
        ?? (document.querySelector(".verse .latin")?.getBoundingClientRect().right ?? innerWidth / 2) + GAP * 3;
      let left = Math.max(r.right + GAP * 3, Math.min(english - GAP * 2, innerWidth - width - 12));
      if (left + width > innerWidth - 12) left = r.left - GAP * 3 - width;
      if (left < 12) {
        // No room beside it: centre under or over the word
        left = Math.min(Math.max(12, r.left + r.width / 2 - width / 2), innerWidth - width - 12);
        const below = room - r.bottom;
        if (below >= Math.min(h, 320) || below >= r.top) setStyle({ left, width, top: r.bottom + GAP, maxHeight: below });
        else setStyle({ left, width, bottom: innerHeight - r.top + GAP, maxHeight: r.top - GAP * 2 });
        return;
      }
      const top = Math.min(Math.max(GAP * 2, r.top - 48), GAP + room - h);
      setStyle({ left, width, top, maxHeight: room - top + GAP });
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    place();
    // Re-place when the entries load or a tab changes the height
    const mo = new MutationObserver(schedule);
    if (ref.current) mo.observe(ref.current, { childList: true, subtree: true });
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => { mo.disconnect(); cancelAnimationFrame(raf); removeEventListener("scroll", schedule); removeEventListener("resize", schedule); };
  }, [anchor, ref]);
  return style;
}

// ---------- dictionaries ----------

function PrincipalParts({ summary }: { summary: WordSummary }) {
  const parts = [summary.lemma];
  for (const p of summary.principalParts) {
    if (p.tags.some(t => t === "alternative" || t === "canonical" || t === "Old-Latin")) continue;
    if (!parts.includes(p.form)) parts.push(p.form);
  }
  const extra = [summary.inflectionClass, summary.gender?.join(" / ")].filter(Boolean).join(", ");
  if (parts.length < 2 && !extra) return null;
  return (
    <p className="principal-parts">
      <span lang="la">{parts.join(", ")}</span>
      {extra && <span className="muted"> · {extra}</span>}
    </p>
  );
}

/** Perseus' L&S text loses its quotations, leaving runs of ": : :" behind; tidy them for reading. */
function tidy(s: string): string {
  return s
    .replace(/\s*([:;])(\s*[:;,])+/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/\(\s*[,;:]?\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s:;,.—-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function flatten(senses: LsSense[], out: LsSense[] = []): LsSense[] {
  for (const s of senses) { out.push(s); if (s.senses) flatten(s.senses, out); }
  return out;
}

const SHOW_SENSES = 4;

/** English renderings L&S italicizes in a sense, minus its italic grammar labels ("gen.", "fin.", "Lit.") */
function meanings(s: LsSense): string[] {
  const out: string[] = [];
  for (const g of s.glosses ?? []) {
    const t = g.replace(/\s+/g, " ").trim();
    if (t.length < 3 || /\.$/.test(t) || /^[(\[]|[)\]]$/.test(t) || /\b[A-Za-z]{1,4}\.\s/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  // L&S italicizes both "emptyhanded, without presents" and each of its parts: keep the whole
  return out.filter(t => !out.some(u => u !== t && u.split(/,\s*/).includes(t)));
}

function LewisShortEntryView({ e, open }: { e: LewisShortEntry; open: boolean }) {
  const [all, setAll] = useState(false);
  const senses = flatten(e.senses).filter(s => tidy(s.definition));
  const shown = all ? senses : senses.slice(0, SHOW_SENSES);
  const meta = [e.itype, e.gender?.map(g => g[0] + ".").join(" "), e.partOfSpeech].filter(Boolean).join(" · ");
  return (
    <details className="ls-entry" open={open}>
      <summary>
        <span className="hw" lang="la">{e.headword}</span>
        {e.homograph !== undefined && <sup>{e.homograph}</sup>}
        {meta && <span className="muted"> {meta}</span>}
      </summary>
      {e.etymology && <p className="etym">{tidy(e.etymology)}</p>}
      <ol className="ls-senses">
        {shown.map((s, i) => (
          <li key={i} style={{ marginInlineStart: `${(s.level - 1) * 0.9}rem` }}>
            {s.label && <b className="sense-label">{s.label}.</b>}
            {meanings(s).length > 0 && <span className="meanings">{meanings(s).join(", ")}</span>}
            <span className={`ls-text${all ? "" : " clamp"}`}>{tidy(s.definition)}</span>
          </li>
        ))}
      </ol>
      <button className="link-btn" onClick={() => setAll(!all)}>
        {all ? "Show less" : senses.length > SHOW_SENSES ? `Show all ${senses.length} senses with citations` : "Show citations"}
      </button>
      <p className="source-link">
        <a href={`https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.04.0059:entry=${encodeURIComponent(e.key)}`}
          target="_blank" rel="noreferrer">Full entry at Perseus ↗</a>
      </p>
    </details>
  );
}

function LewisShort({ entries, matched }: { entries: LewisShortEntry[]; matched?: string }) {
  if (!entries.length) return null;
  return (
    <>
      {entries.map((e, i) => <LewisShortEntryView key={e.key} e={e} open={i === 0 || e.key === matched} />)}
      <Attribution>
        Charlton T. Lewis &amp; Charles Short, <cite>A Latin Dictionary</cite> (Oxford: Clarendon Press, 1879).
        Digital edition from the <a href="https://www.perseus.tufts.edu/" target="_blank" rel="noreferrer">Perseus Digital Library</a>,
        Tufts University, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
      </Attribution>
    </>
  );
}

/** Usage labels worth showing (figurative, transitive, Late Latin…), not paradigm bookkeeping */
const senseTags = (tags?: string[]) =>
  (tags ?? []).filter(t => !/^(conjugation|declension)-|^(form-of|irregular|no-gloss|alt-of)$/.test(t)).map(t => t.replace(/-/g, " "));

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function Wiktionary({ entry }: { entry: WiktionaryEntry }) {
  const page = `https://en.wiktionary.org/wiki/${encodeURIComponent(plain(entry.canonical))}#Latin`;
  return (
    <>
      {entry.head && <p className="wikt-head" lang="la">{entry.head}</p>}
      <ol className="wikt-senses">
        {entry.senses.map((s, i) => (
          <li key={i}>
            {senseTags(s.tags).length ? <span className="tags">{senseTags(s.tags).join(", ")}</span> : null}
            {s.glosses.join("; ")}
          </li>
        ))}
      </ol>
      {entry.etymology && <><h3 className="sub">Etymology</h3><p className="etym">{entry.etymology}</p></>}
      {entry.ipa?.length ? <p className="muted">Pronunciation: {entry.ipa.slice(0, 2).join(", ")}</p> : null}
      <p className="source-link"><a href={page} target="_blank" rel="noreferrer">“{entry.canonical}” on Wiktionary ↗</a></p>
      <Attribution>
        From <a href={page} target="_blank" rel="noreferrer">Wiktionary</a>, the free dictionary, by its contributors;
        extracted by <a href="https://kaikki.org/dictionary/Latin/" target="_blank" rel="noreferrer">kaikki.org</a> (wiktextract).
        Licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> and
        GFDL.
      </Attribution>
    </>
  );
}

interface LexSense { number?: number | string; definition?: string; examples?: { latin: string; ref?: string; work?: string }[] }

function LexiconView({ e }: { e: LexiconEntry }) {
  const senses = (e.senses ?? []) as LexSense[];
  const examples = (x?: LexSense["examples"]) => x?.slice(0, 2).map((ex, i) => (
    <blockquote key={i} className="example">
      <span lang="la">{ex.latin}</span>
      {(ex.work || ex.ref) && <cite> — {[ex.work, ex.ref].filter(Boolean).join(", ")}</cite>}
    </blockquote>
  ));
  return (
    <div className="lex-entry">
      <p><span className="hw" lang="la">{e.headword}</span>{e.grammar && <span className="muted"> {e.grammar}</span>}</p>
      {e.definition && <p>{e.definition}</p>}
      {!senses.length && examples(e.examples)}
      {senses.length > 0 && (
        <ol className="lex-senses">
          {senses.map((s, i) => (
            <li key={i}>
              {s.number !== undefined && <b className="sense-label">{s.number}.</b>} {s.definition}
              {examples(s.examples)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Lexicon({ entries }: { entries: LexiconEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      {entries.map((e, i) => <LexiconView key={i} e={e} />)}
      <Attribution>
        Roy J. Deferrari &amp; Sister M. Inviolata Barry, <cite>A Lexicon of Saint Thomas Aquinas</cite> (Washington:
        Catholic University of America Press, 1948–1949). Text from a scanned copy; errors from character recognition may remain.
      </Attribution>
    </>
  );
}

function Attribution({ children }: { children: ReactNode }) {
  return <footer className="attribution"><span className="label">Source</span> {children}</footer>;
}

