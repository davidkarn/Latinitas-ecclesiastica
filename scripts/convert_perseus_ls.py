"""Convert Perseus's TEI Lewis & Short (lat.ls.perseus-eng2.xml) into per-letter JSON.

Usage: python scripts/convert_perseus_ls.py [xml_path] [out_dir]
Source: https://github.com/PerseusDL/lexica (CC BY-SA, Perseus Digital Library, http://www.perseus.tufts.edu/)
"""
import json, re, sys, unicodedata, pathlib
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "resources/dictionaries/perseus_ls/lat.ls.perseus-eng2.xml"
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "resources/dictionaries/perseus_ls"

POS_MAP = {"v. a.": "verb", "v. n.": "verb", "v. dep.": "verb", "v. freq. a.": "verb", "adj.": "adjective",
           "adv.": "adverb", "conj.": "conjunction", "praep.": "preposition", "interj.": "interjection",
           "pron.": "pronoun", "num.": "numeral", "subst.": "noun", "P. a.": "participle"}
GEN_MAP = {"m.": "masculine", "f.": "feminine", "n.": "neuter", "comm.": "common"}


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip(" ,;:")


def text(el, skip=("cit", "sense")) -> str:
    """Plain text of el, leaving out nested elements whose tag is in skip (their tails are kept)."""
    parts = [el.text or ""]
    for ch in el:
        if ch.tag not in skip:
            parts.append(text(ch, skip))
        parts.append(ch.tail or "")
    return "".join(parts)


def plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def cit(el) -> dict:
    q, b = el.find("quote"), el.find("bibl")
    d = {"latin": clean(text(q)) if q is not None else ""}
    if b is not None:
        d["ref"] = clean("".join(b.itertext()))
        a = b.find("author")
        if a is not None: d["author_abbr"] = clean(a.text)
        if b.get("n"): d["urn"] = b.get("n")
    return d


def sense(el) -> dict:
    d = {"label": el.get("n"), "level": int(el.get("level", 1)), "id": el.get("id")}
    d["definition"] = clean(text(el))
    glosses = [clean("".join(h.itertext())) for h in el.iter() if h.tag in ("hi", "trans", "tr") and h.get("rend", "ital") == "ital"]
    if glosses: d["glosses"] = [g for g in glosses if g]
    ex = [cit(c) for c in el.iter("cit")]
    if ex: d["examples"] = ex
    return d


def nest(flat: list) -> list:
    """Senses are flat siblings with a level attribute; rebuild the tree."""
    root, stack = [], []
    for s in flat:
        while stack and stack[-1]["level"] >= s["level"]:
            stack.pop()
        (stack[-1].setdefault("senses", []) if stack else root).append(s)
        stack.append(s)
    return root


def entry(el, letter: str) -> dict:
    # Grammar block = top-level elements outside senses, excluding those inside a parenthetical
    # note such as "(m. acris, Enn.; f. acer, Naev.)". Track paren depth through the text and tails.
    head, depth = [], 0
    depth += (el.text or "").count("(") - (el.text or "").count(")")
    for c in el:
        if c.tag != "sense" and (depth <= 0 or c.tag == "orth"):  # variant spellings in parentheses are still useful
            head.append(c)
        if c.tag == "sense":
            break
        t = c.tail or ""
        depth += t.count("(") - t.count(")") + (text(c).count("(") - text(c).count(")") if c.tag not in ("bibl",) else 0)
    orths = [clean("".join(o.itertext())) for o in head if o.tag == "orth"]
    itypes = [clean("".join(o.itertext())) for o in head if o.tag == "itype"]
    gens = [clean(o.text) for o in head if o.tag == "gen"]
    poss = [clean(o.text) for o in head if o.tag == "pos"]
    etym = [clean("".join(o.itertext())) for o in head if o.tag == "etym"]
    key = el.get("key")
    d = {
        "key": key,
        "id": el.get("id"),
        "letter": letter,
        "type": el.get("type"),
        "headword": orths[0] if orths else re.sub(r"\d+$", "", key),
        "lemma": plain(orths[0] if orths else re.sub(r"\d+$", "", key)).lower().replace("-", ""),
    }
    if el.get("n"): d["homograph"] = int(el.get("n")) if el.get("n").isdigit() else el.get("n")
    if len(orths) > 1: d["variants"] = orths[1:]
    if itypes: d["itype"] = itypes[0]
    if gens: d["gender"] = [GEN_MAP.get(g, g) for g in gens]
    if poss: d["pos_raw"] = poss[0]; d["part_of_speech"] = POS_MAP.get(poss[0], poss[0])
    elif gens and itypes: d["part_of_speech"] = "noun"            # L&S marks nouns only by genitive + gender
    if "dep." in (poss[0] if poss else ""): d["deponent"] = True
    m = re.search(r"\b([1-4])\s*$", itypes[0]) if itypes else None
    if m: d["conjugation"] = int(m.group(1))
    if etym: d["etymology"] = etym[0]
    d["grammar_text"] = clean(text(el, skip=("cit", "sense", "bibl", "etym")))
    senses = [sense(s) for s in el if s.tag == "sense"]
    if senses: d["senses"] = nest(senses)
    return d


def main():
    raw = SRC.read_text(encoding="utf-8")
    raw = re.sub(r"<!DOCTYPE.*?\]>", "", raw, count=1, flags=re.S)  # external DTD isn't needed (no named entities)
    tree = ET.fromstring(raw)
    by_letter: dict[str, dict] = {}
    for div in tree.iter("div0"):
        letter = div.get("n").lower()
        for el in div.iter("entryFree"):
            e = entry(el, letter)
            by_letter.setdefault(letter, {})[e["key"]] = e
    OUT.mkdir(parents=True, exist_ok=True)
    for letter, entries in sorted(by_letter.items()):
        (OUT / f"{letter}.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
    report = {"source": "PerseusDL/lexica CTS_XML_TEI/perseus/pdllex/lat/ls/lat.ls.perseus-eng2.xml",
              "license": "CC BY-SA 4.0, Perseus Digital Library, http://www.perseus.tufts.edu/",
              "entries_per_letter": {k: len(v) for k, v in sorted(by_letter.items())},
              "total": sum(len(v) for v in by_letter.values())}
    (OUT / "_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report["entries_per_letter"]), report["total"])


if __name__ == "__main__":
    main()
