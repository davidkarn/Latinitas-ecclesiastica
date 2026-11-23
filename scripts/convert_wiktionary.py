"""Slim the kaikki.org Wiktionary Latin dump into per-letter lemma JSON plus a form -> lemma index.

Usage: python scripts/convert_wiktionary.py [jsonl_path] [out_dir]
Source: https://kaikki.org/dictionary/Latin/ (Wiktionary, CC BY-SA 4.0 / GFDL; extracted with wiktextract)

Output:
  lemmas/<letter>.json   {plain_word: [entry, ...]}  one entry per (word, pos, etymology)
  forms_index.json       {plain_form: [[plain_lemma, pos, entry_index], ...]}
"""
import json, re, sys, unicodedata, pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "resources/dictionaries/wiktionary/kaikki-latin.jsonl"
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "resources/dictionaries/wiktionary"

META_TAGS = {"table-tags", "inflection-template", "class"}


def plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)).lower()


def letter_of(word: str) -> str:
    c = plain(word).lstrip("-*")[:1]
    return c if "a" <= c <= "z" else "_"


def is_form_of(e: dict) -> bool:
    senses = e.get("senses") or []
    return bool(senses) and all("form_of" in s or "alt_of" in s or "form-of" in s.get("tags", []) for s in senses)


def slim_forms(forms: list) -> tuple[list, list]:
    """Split into principal parts (headword line) and the inflection table, dropping wiktextract metadata."""
    parts, table = [], []
    for f in forms or []:
        tags = f.get("tags", [])
        if META_TAGS & set(tags) or f.get("form") in ("-", "—", ""):
            continue
        d = {"form": f["form"], "tags": tags}
        (table if f.get("source") in ("declension", "conjugation", "inflection") else parts).append(d)
    return parts, table


def slim_entry(e: dict) -> dict:
    parts, table = slim_forms(e.get("forms"))
    canonical = next((p["form"] for p in parts if "canonical" in p["tags"]), e["word"])
    head = (e.get("head_templates") or [{}])[0]
    d = {
        "word": e["word"],
        "canonical": canonical,
        "pos": e["pos"],
        "head": head.get("expansion"),
        "template": head.get("name"),
        "template_args": head.get("args"),
    }
    if e.get("etymology_number"): d["etymology_number"] = e["etymology_number"]
    if e.get("etymology_text"):
        # Drop the machine "Etymology tree" preamble; keep the prose
        txt = e["etymology_text"]
        d["etymology"] = txt.split("\n")[-1] if txt.startswith("Etymology tree") else txt
    d["principal_parts"] = [p for p in parts if "canonical" not in p["tags"]]
    d["forms"] = table
    d["senses"] = [{k: s[k] for k in ("glosses", "tags", "examples") if s.get(k)} for s in e.get("senses", [])
                   if s.get("glosses")]
    for s in d["senses"]:
        if "examples" in s:
            s["examples"] = [{k: x[k] for k in ("text", "english", "ref") if x.get(k)} for x in s["examples"]]
    for k in ("synonyms", "antonyms", "derived", "related"):
        if e.get(k): d[k] = [x["word"] for x in e[k] if x.get("word")]
    if e.get("sounds"):
        ipa = [s["ipa"] for s in e["sounds"] if s.get("ipa")]
        if ipa: d["ipa"] = ipa[:2]
    return d


def main():
    lemmas: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    index: dict[str, set] = defaultdict(set)
    n_lemma = n_formof = 0
    with SRC.open(encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            if e.get("lang_code") != "la":
                continue
            if is_form_of(e):
                n_formof += 1
                # Form-of pages: index them too (catches alternative spellings missing from tables)
                for s in e["senses"]:
                    for ref in s.get("form_of", []) + s.get("alt_of", []):
                        if ref.get("word"):
                            index[plain(e["word"])].add((plain(ref["word"]), e["pos"], -1))
                continue
            n_lemma += 1
            d = slim_entry(e)
            key = plain(d["word"])
            bucket = lemmas[letter_of(key)][key]
            i = len(bucket)
            bucket.append(d)
            for form in {d["canonical"], *(x["form"] for x in d["forms"] + d["principal_parts"])}:
                if "+" in form:          # periphrastic descriptions like "amātus + present active indicative of sum"
                    continue
                # Multi-word forms ("amātus sum", "aquae rēgiae") are indexed only as whole phrases;
                # splitting them would map "sum" to amō and "regis" to aqua rēgia.
                index[plain(form)].add((key, d["pos"], i))

    (OUT / "lemmas").mkdir(parents=True, exist_ok=True)
    for letter, entries in sorted(lemmas.items()):
        (OUT / "lemmas" / f"{letter}.json").write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")

    # Prefer table hits (index >= 0) over form-of hits for the same lemma+pos
    out_index = {}
    for form, hits in index.items():
        best = {}
        for lemma, pos, i in sorted(hits, key=lambda h: -h[2]):
            best.setdefault((lemma, pos), [lemma, pos, i])
        out_index[form] = sorted(best.values())
    (OUT / "forms_index.json").write_text(json.dumps(out_index, ensure_ascii=False, sort_keys=True), encoding="utf-8")

    report = {"source": "https://kaikki.org/dictionary/Latin/kaikki.org-dictionary-Latin.jsonl",
              "license": "Wiktionary content, CC BY-SA 4.0 and GFDL",
              "lemma_entries": n_lemma, "form_of_pages": n_formof,
              "distinct_lemma_words": sum(len(v) for v in lemmas.values()),
              "indexed_forms": len(out_index),
              "entries_per_letter": {k: len(v) for k, v in sorted(lemmas.items())}}
    (OUT / "_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
