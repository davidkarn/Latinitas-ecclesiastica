/**
 * The compact bar that appears once the masthead scrolls away (book · chapter, English and Grammar switches),
 * and the contents panel it opens: every book, with the current one's chapters as a grid.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TextIndex } from "../../src/api/index.ts";
import { useDismiss } from "./WordPopup.tsx";

type Texts = TextIndex["texts"];
interface Route { text: string; chapter: number }

interface BarProps {
  visible: boolean;
  texts: Texts | undefined;
  route: Route;
  /** The English and Grammar switches */
  children: ReactNode;
  onGo(r: Route): void;
  onOpenGrammar(): void;
}

export function TopBar({ visible, texts, route, children, onGo, onOpenGrammar }: BarProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const text = texts?.find(t => t.id === route.text);
  // Scrolling back up to the masthead closes the panel along with the bar
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);

  return (
    <div className={`topbar${visible ? " shown" : ""}`} inert={!visible}>
      <div className="topbar-inner">
        <button ref={button} className="contents-btn" aria-expanded={open} aria-haspopup="dialog"
          onClick={() => setOpen(o => !o)} title="Books and chapters">
          <span className="contents-title">{text?.title} <span className="chapter-no">{route.chapter}</span></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div className="topbar-tools">{children}</div>
      </div>
      {open && texts && button.current && (
        <ContentsPanel texts={texts} route={route} anchor={button.current} onClose={() => setOpen(false)}
          onGo={r => { setOpen(false); onGo(r); }} onOpenGrammar={() => { setOpen(false); onOpenGrammar(); }} />
      )}
    </div>
  );
}

interface PanelProps {
  texts: Texts;
  route: Route;
  anchor: HTMLElement;
  onGo(r: Route): void;
  onOpenGrammar(): void;
  onClose(): void;
}

function ContentsPanel({ texts, route, anchor, onGo, onOpenGrammar, onClose }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(route.text);
  useDismiss(ref, anchor, onClose);
  // Start with the current book in view
  useEffect(() => {
    const panel = ref.current, book = panel?.querySelector<HTMLElement>(".contents-book[aria-expanded='true']");
    if (panel && book) panel.scrollTop = book.offsetTop - 6;   // the panel only: scrollIntoView could move the page
  }, []);

  return (
    <div ref={ref} className="contents" role="dialog" aria-label="Books and chapters" tabIndex={-1}>
      <ol className="contents-books">
        {texts.map(t => {
          const isOpen = t.id === expanded;
          return (
            <li key={t.id}>
              <button className={`contents-book${t.id === route.text ? " current" : ""}`} aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? "" : t.id)}>
                <span lang="la">{t.title}</span>
                {t.aka && <span className="muted">{t.aka}</span>}
              </button>
              {isOpen && (
                <div className="chapter-grid">
                  {t.chapters.map(c => {
                    const here = t.id === route.text && c.chapter === route.chapter;
                    return (
                      <a key={c.chapter} href={`/${t.id}/${c.chapter}`} aria-current={here ? "page" : undefined}
                        aria-label={`${t.title} ${c.chapter}`}
                        onClick={e => { e.preventDefault(); onGo({ text: t.id, chapter: c.chapter }); }}>
                        {c.chapter}
                      </a>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <a className="grammar-link contents-grammar" href="/grammar" onClick={e => { e.preventDefault(); onOpenGrammar(); }}>
        § A Grammar of the Vulgate
      </a>
    </div>
  );
}
