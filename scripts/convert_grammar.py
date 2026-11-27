"""Plater & White, A Grammar of the Vulgate (1926): Surya OCR output -> structured sections + Scripture citations.

Usage: python3 -I scripts/convert_grammar.py [results.json]
  default input: resources/text/plater_white/surya.json (Surya `results.json` for vulgate_grammar.pdf)
  output:        resources/text/plater_white/grammar.json

The output keeps the book's own words. Each section (§ 1-144) is a list of blocks (paragraph, heading, list,
table) of sanitized HTML (only i, b, sup, br and table/list tags) plus its footnotes. `citations` lists every
reference to a Pentateuch verse with the clause it occurs in and any Latin quoted there, for the generator to
attach to verses and words.
"""
import html as htmllib
import json
import pathlib
import re
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "resources" / "text" / "plater_white"

# Table of contents (pp. ix-x): chapters and the topic of each section
CHAPTERS = [
    ("intro", "Introduction", 1, 8),
    ("I", "The Foreign Element: Hebrew", 9, 32),
    ("II", "The Foreign Element: Greek", 33, 54),
    ("III", "The Native Element: Form of Words", 55, 81),
    ("IV", "Lexical Peculiarities: Meaning of Words", 82, 89),
    ("V", "Inflexional and Other Peculiarities", 90, 102),
    ("VI", "Syntax: The Simple Sentence", 103, 117),
    ("VII", "Syntax of the Verb", 118, 131),
    ("VIII", "Syntax: Double and Complex Sentences", 132, 144),
]
TOPICS = [
    (1, 5, "Latin Versions"), (6, 8, "Origin and Composition of the Vulgate"),
    (9, 9, "Hebrew influence"), (10, 13, "Proper Names"), (14, 16, "Common Nouns"),
    (17, 22, "Number, Gender, Case"), (23, 23, "Adjectives"), (24, 24, "Pronouns"), (25, 30, "Verbs"),
    (31, 32, "Repetition"),
    (33, 36, "General Influence"), (37, 42, "Lexical (Nouns, Adjectives, Verbs)"), (43, 43, "Inflexional"),
    (44, 54, "Syntactical"),
    (55, 57, "Characteristics of Popular Latin"), (58, 61, "Orthography"), (62, 65, "Lengthened Terminations"),
    (66, 68, "Nouns"), (69, 77, "Adjectives"), (78, 81, "Verbs (derived, compound, in -ficare)"),
    (82, 82, "New and Unusual Meanings"), (83, 83, "Nouns"), (84, 84, "Adjectives"), (85, 86, "Verbs"),
    (87, 88, "Adverbs, Particles"), (89, 89, "Tendency"),
    (90, 90, "Inflexional Peculiarities"), (91, 93, "Nouns, Adjectives, Verbs"), (94, 94, "Adjectives"),
    (95, 95, "Adverbs"), (96, 102, "Pronouns"),
    (103, 104, "The Simple Sentence"), (105, 105, "Agreement"), (106, 106, "Want of Article"),
    (107, 107, "How the Article is Supplied"), (108, 108, "The Nominative"), (109, 109, "Impersonal Verbs"),
    (110, 110, "The Accusative"), (111, 111, "Accusative with Prepositions"), (112, 112, "The Dative"),
    (113, 114, "The Genitive"), (115, 116, "The Ablative"), (117, 117, "The Ablative with Prepositions"),
    (118, 124, "Indicative Mood: Tenses"), (125, 125, "Imperative"), (126, 126, "Subjunctive"),
    (127, 127, "Infinitive"), (128, 128, "Participles"), (129, 129, "Gerund Noun"),
    (130, 130, "Gerund Adjective (Gerundive)"), (131, 131, "Supines"),
    (132, 132, "Double Sentence"), (133, 133, "Complex Sentence"), (134, 134, "Noun-Clause: Dependent Statement"),
    (135, 135, "Dependent Question"), (136, 136, "Dependent Exclamation"), (137, 137, "Dependent Desire"),
    (138, 138, "Adjective ('Qui') Clause"), (139, 139, "Adverb-Clause"), (140, 140, "Si"), (141, 141, "Cum"),
    (142, 142, "Dum"), (143, 143, "Other Conjunctions"), (144, 144, "Unusual Subjunctive"),
]


def topic(n):
    return next(t for a, b, t in TOPICS if a <= n <= b)


def chapter_of(n):
    return next(c for c, _, a, b in CHAPTERS if a <= n <= b)


# OCR misreadings that break the section sequence: (start of paragraph text, correct section number)
SECTION_FIXES = [("§ 116. The Genitive as Object", 114)]

# ---------- HTML ----------
ALLOWED = {"i", "b", "sup", "br", "table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li"}
VOID = {"br"}


class Sanitizer(HTMLParser):
    """Keeps only ALLOWED tags (without attributes); splits top-level <p>/<h*> into separate parts."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.cur, self.kind = [], [], "p"

    def flush(self):
        s = re.sub(r"\s+", " ", "".join(self.cur)).strip()
        if s:
            self.parts.append((self.kind, s))
        self.cur, self.kind = [], "p"

    def handle_starttag(self, tag, attrs):
        if tag == "p" or re.fullmatch(r"h\d", tag):
            self.flush()
            self.kind = "h" if tag != "p" else "p"
        elif tag in ALLOWED:
            self.cur.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag == "p" or re.fullmatch(r"h\d", tag):
            self.flush()
        elif tag in ALLOWED and tag not in VOID:
            self.cur.append(f"</{tag}>")

    def handle_data(self, data):
        self.cur.append(htmllib.escape(data, quote=False))


def parts_of(block_html):
    s = Sanitizer()
    s.feed(block_html)
    s.close()
    s.flush()
    return s.parts


def plain(h):
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


# ---------- citations ----------
BOOKS = {"Gen": "genesis", "Gn": "genesis", "Ex": "exodus", "Exod": "exodus", "Lev": "leviticus",
         "Num": "numbers", "Deut": "deuteronomy", "Dt": "deuteronomy",
         "Jos": "joshua", "Josh": "joshua", "Jud": "judges", "Judg": "judges", "Ruth": "ruth",   # Judith is never abbreviated
         # Samuel and Kings are cited with both names, "I Sam. (I Reg.) 9. 15", "II Kgs. (IV Reg.) 2. 3"; text ids
         # follow the Vulgate count (src/sources/texts.ts)
         "I Reg": "1-kings", "II Reg": "2-kings", "III Reg": "3-kings", "IV Reg": "4-kings"}
# Any book abbreviation (to know where a run of references for one book ends)
ANY_BOOK = r"(?:[1-4I]{1,3}\s+)?[A-Z][a-z]{1,7}\.?(?:\s+\([^)]*\))?"
REF = re.compile(r"\b(Gen|Gn|Exod|Ex|Lev|Num|Deut|Dt|Josh|Jos|Judg|Jud|Ruth"
                 r"|(?:I{1,2}\s+(?:Sam|Kgs)\.?\s*\(\s*)?(?:IV|I{1,3})\s+Reg\.?\s*\)?)\.?\s+(\d+)\.\s*(\d+)(?:\s*-\s*(\d+))?")


def book_id(abbr):
    """'Gen' → 'genesis'; 'I Kgs. (III Reg.)' and 'III Reg.' → '3-kings' (by the Vulgate name in either form)"""
    m = re.search(r"\b(IV|I{1,3})\s+Reg", abbr)
    return BOOKS[f"{m.group(1)} Reg"] if m else BOOKS[abbr]
CONT = re.compile(r"\s*(?:,|;|,?\s*cf\.|and)\s*(?:cf\.\s*)?(\d+)(?:\.\s*(\d+))?(?:\s*-\s*(\d+))?(?![\d.]*\s*[A-Z])")


def refs_in(text):
    """[(book, chapter, verse, start, end)] for every verse cited from Genesis–4 Kings, following runs like
    'Gen. 1. 26, 27, 2. 5, cf. 13. 10' (bare numbers continue the chapter; 'n. m' starts a new one)."""
    out = []
    for m in REF.finditer(text):
        book, ch, v, v2 = book_id(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
        out += [(book, ch, x, m.start(), m.end()) for x in range(v, int(v2) + 1 if v2 and int(v2) - v < 10 else v + 1)]
        pos = m.end()
        while True:
            c = CONT.match(text, pos)
            if not c:
                break
            if c.group(2):
                ch, v = int(c.group(1)), int(c.group(2))
            else:
                v = int(c.group(1))
            hi = int(c.group(3)) if c.group(3) and 0 <= int(c.group(3)) - v < 10 else v
            if ch > 50 or v > 80:
                break
            out += [(book, ch, x, m.start(), c.end()) for x in range(v, hi + 1)]
            pos = c.end()
    return out


# Clause breaks: ';' or a real sentence end (a lowercase word of 4+ letters before the full stop, so
# abbreviations like "Jer. 1. 13" or "the N. Jer." don't split)
SEP = re.compile(r";|(?<=[a-z]{4})\.\s+(?=[A-Z])")


def clause_around(h, start_plain, end_plain):
    """The clause of plain text h containing [start, end): between ';' / sentence breaks, outside quotes."""
    t = plain(h)
    cuts = [0] + [m.end() for m in SEP.finditer(t)] + [len(t)]
    a = max(c for c in cuts if c <= start_plain)
    b = min((c for c in cuts if c >= end_plain), default=len(t))
    return t[a:b].strip(" ;")


QUOTE = re.compile(r"[‘'“]([^’'”]{3,200})[’'”]")


def quotes_in(h, clause):
    """Latin quoted in the clause: '…'-quoted text, else italic runs."""
    qs = [q.strip() for q in QUOTE.findall(clause)]
    if not qs:   # an italic Latin word or phrase in the clause (not a one- or two-letter ending like "-en")
        ital = [plain(x) for x in re.findall(r"<i>(.*?)</i>", h)]
        qs = [x for x in ital if len(x) >= 4 and x in clause and not x.startswith("-")]
    return [q for q in qs if re.search(r"[a-z]{2}", q)]


# ---------- main ----------
def main():
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else OUT_DIR / "surya.json"
    doc = json.loads(src.read_text())
    pages = next(iter(doc.values()))

    # Body: from INTRODUCTION (after the contents) to the indexes
    blocks, started = [], False
    for pg in pages:
        for b in sorted(pg["blocks"], key=lambda b: b["reading_order"]):
            label, h = b["label"], b["html"]
            t = plain(h)
            if not started:
                started = label == "SectionHeader" and t == "INTRODUCTION"
                continue
            if label == "SectionHeader" and t.startswith("I. INDEX OF SUBJECTS"):
                break
            if label in ("PageHeader", "PageFooter", "Picture"):
                continue
            blocks.append((pg["page"], label, h))
        else:
            continue
        break

    sections = {0: {"n": 0, "blocks": [], "footnotes": []}}   # 0 = Introduction before § 1
    conclusion = {"blocks": [], "footnotes": []}
    cur = sections[0]
    last = 0
    for page, label, h in blocks:
        if label == "Footnote":
            cur["footnotes"].append({"html": " ".join(x for _, x in parts_of(h)), "page": page})
            continue
        if label == "SectionHeader":
            t = plain(h)
            if t == "CONCLUSION":
                cur, last = conclusion, 999
                continue
            if re.fullmatch(r"[IVX]+|THE FOREIGN ELEMENT|[AB]\. (HEBREW|GREEK)", t):
                continue                                     # chapter titles come from the contents
        kind_default = {"SectionHeader": "h", "ListGroup": "list", "Table": "table"}.get(label, "p")
        if label in ("Table", "ListGroup"):
            items = [(kind_default, re.sub(r"\s+", " ", " ".join(x for _, x in parts_of(h))))]
        else:
            items = [(kind_default if k == "p" else k, x) for k, x in parts_of(h)]
        for kind, x in items:
            m = re.match(r"§\s*(\d+)\b", plain(x))
            num = int(m.group(1)) if m else None
            for prefix, fixed in SECTION_FIXES:
                if plain(x).startswith(prefix):
                    num = fixed
            if num and last + 1 <= num <= last + 3:   # a new section (allow a missed number)
                last = num
                cur = sections.setdefault(last, {"n": last, "blocks": [], "footnotes": []})
                if kind == "h":
                    kind = "p"
            prev = cur["blocks"][-1] if cur["blocks"] else None
            # Paragraphs split by a page or column break: join when the first doesn't end a sentence
            if (prev and kind == "p" and prev["type"] == "p"
                    and not re.search(r"[.:;!?)'’”]\s*(</\w+>)*\s*$", prev["html"])
                    and re.match(r"(<\w+>)*\s*[a-z(‘'—]", x)):
                joined = prev["html"]
                if re.search(r"\w-\s*(</\w+>)*$", joined):        # hyphenated across the break
                    prev["html"] = re.sub(r"-(\s*(</\w+>)*)$", r"\1", joined) + x
                else:
                    prev["html"] = joined + " " + x
                continue
            cur["blocks"].append({"type": kind, "html": x})

    # A heading at the very end of a section introduces the next one ("THE ADJECTIVE" before § 23)
    order = sorted(sections)
    for a_n, b_n in zip(order, order[1:]):
        while sections[a_n]["blocks"] and sections[a_n]["blocks"][-1]["type"] == "h":
            sections[b_n]["blocks"].insert(0, sections[a_n]["blocks"].pop())

    out_sections = []
    for n in sorted(sections):
        s = sections[n]
        if n == 0:
            title, chap = "Introduction", "intro"
        else:
            title, chap = topic(n), chapter_of(n)
        out_sections.append({"n": n, "chapter": chap, "topic": title, "blocks": s["blocks"],
                             "footnotes": [f["html"] for f in s["footnotes"]]})

    # Citations of Pentateuch verses
    citations = []
    for s in out_sections:
        texts = [(b["html"], "text") for b in s["blocks"] if b["type"] in ("p", "list")]
        texts += [(f, "footnote") for f in s["footnotes"]]
        for h, where in texts:
            t = plain(h)
            # The paragraph's own statement of the rule: its text up to the first colon (or sentence)
            body = re.sub(r"^(§\s*\d+\.\s*|\d+\s+)", "", t)
            head = re.split(r"(?<=:)\s|(?<=[a-z]{4}\.)\s", body, maxsplit=1)[0]
            lead = head if len(head) <= 200 else ""
            for book, ch, v, a, b in refs_in(t):
                clause = clause_around(h, a, b)
                citations.append({"text": book, "chapter": ch, "verse": v, "section": s["n"],
                                  "clause": clause, "quotes": quotes_in(h, clause), "lead": lead, "in": where})

    seen, uniq = set(), []
    for c in citations:
        k = (c["text"], c["chapter"], c["verse"], c["section"], c["clause"])
        if k not in seen:
            seen.add(k)
            uniq.append(c)

    out = {
        "title": "A Grammar of the Vulgate, being an Introduction to the Study of the Latinity of the Vulgate Bible",
        "authors": ["W. E. Plater", "H. J. White"],
        "published": "Oxford: Clarendon Press, 1926",
        "license": "Public domain (published 1926; authors d. 1933 and 1934)",
        "source": "OCR of a scan of the 1926 edition (Surya)",
        "chapters": [{"id": c, "title": t, "sections": [a, b]} for c, t, a, b in CHAPTERS],
        "sections": out_sections,
        "conclusion": {"blocks": conclusion["blocks"], "footnotes": [f["html"] for f in conclusion["footnotes"]]},
        "citations": uniq,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "grammar.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    nums = [s["n"] for s in out_sections if s["n"]]
    missing = sorted(set(range(1, 145)) - set(nums))
    print(f"{len(nums)} sections (missing {missing}), {len(uniq)} citations (Genesis–4 Kings) "
          f"on {len({(c['text'], c['chapter'], c['verse']) for c in uniq})} verses")


if __name__ == "__main__":
    main()
