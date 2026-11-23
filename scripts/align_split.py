"""Step 2: align Vulgate text to each audio part, split into one file per verse, write metadata.

For each source mp3 (a LibriVox "Biblia Sacra / Vulgata Clementina" part):
  1. read its ID3 title ("001 - Genesis 1-12") to know which chapters it covers
  2. match the rough Whisper transcript (work/whisper/*.json, from transcribe.py) against the
     reference text to get coarse anchors, and use them to bound each chapter in time
  3. forced-align each chapter's text with the MMS multilingual aligner (torchaudio MMS_FA),
     with wildcard (*) tokens on both sides to absorb chapter announcements / LibriVox intros
  4. cut one mp3 per verse and write <part>.json with per-word times relative to the verse file

Usage: .venv/bin/python scripts/align_split.py audio/vulgate/*.mp3
"""
import difflib, json, pathlib, re, subprocess, sys, unicodedata
import numpy as np
import torch, torchaudio

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXT_DIR = ROOT / "text" / "vulgate"
WHISPER_DIR = ROOT / "work" / "whisper"
OUT_DIR = ROOT / "audio" / "vulgate" / "verses"
BOOK_FILES = {"Genesis": "Gn"}  # book name in ID3 title -> vulsearch text file stem
SR = 16000
PAD_PRE, PAD_POST = 0.25, 0.45  # seconds of padding around each verse (capped at midpoint of gap)
DEVICE = "cpu"  # MPS lacks the wav2vec2 feature-extractor conv for long inputs


# ---------- text ----------
def load_book(book):
    verses = []
    for line in (TEXT_DIR / f"{BOOK_FILES[book]}.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"(\d+):(\d+)\s+(.*)", line)
        if not m:
            continue
        text = re.sub(r"[\\/\[\]]", " ", m.group(3))          # vulsearch poetry/paragraph markup
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"\s+([:;?!.,)])", r"\1", text)            # "Deus :" -> "Deus:"
        words = [w for w in (t.strip(".,:;?!()[]\"'") for t in text.split()) if w]
        verses.append({"chapter": int(m.group(1)), "verse": int(m.group(2)), "text": text, "words": words})
    return verses


def ascii_fold(w):
    w = w.lower().replace("æ", "ae").replace("œ", "oe")
    return "".join(c for c in unicodedata.normalize("NFD", w) if unicodedata.category(c) != "Mn")


def mms_norm(w):  # what the aligner sees
    return re.sub(r"[^a-z]", "", ascii_fold(w))


def match_norm(w):  # loose form for matching Whisper's spelling (celum ~ cælum, iuxta ~ juxta, ...)
    w = mms_norm(w).replace("ae", "e").replace("oe", "e").replace("ph", "f")
    w = w.translate(str.maketrans("jyvk", "iiuc")).replace("h", "")
    return re.sub(r"(.)\1+", r"\1", w)


# ---------- audio ----------
def decode(path, sr, out=None):
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr)]
    if out:
        subprocess.run(cmd + ["-y", str(out)], check=True)
        return None
    raw = subprocess.run(cmd + ["-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def compute_emissions(model, wav, chunk_s=30, ctx_s=2):
    """Log-prob emissions for the whole file, computed in overlapping chunks. Returns (T, C), sec/frame."""
    hop = 320  # wav2vec2 frame stride at 16 kHz
    chunk, ctx = chunk_s * SR, ctx_s * SR
    out = []
    for s in range(0, len(wav), chunk):
        a, b = max(0, s - ctx), min(len(wav), s + chunk + ctx)
        x = torch.from_numpy(wav[a:b]).unsqueeze(0).to(DEVICE)
        with torch.inference_mode():
            em, _ = model(x)
        em = em[0].float().cpu()
        lf = (s - a) // hop
        n = (min(len(wav), s + chunk) - s) // hop
        piece = em[lf:lf + n]
        if piece.shape[0] < n:  # pad tail by repeating last frame
            piece = torch.cat([piece, piece[-1:].repeat(n - piece.shape[0], 1)])
        out.append(piece)
    return torch.cat(out), hop / SR


# ---------- main ----------
def part_info(mp3):
    title = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format_tags=title", "-of", "json", str(mp3)],
        check=True, capture_output=True, text=True).stdout)["format"]["tags"]["title"]
    m = re.match(r"\s*\d+\s*-\s*(.+?)\s+(\d+)\s*-\s*(\d+)\s*$", title)
    return title, m.group(1), int(m.group(2)), int(m.group(3))


def whisper_anchors(stem, ref_words):
    """Map reference word index -> (start, end) from Whisper words that match exactly (loosely normalized)."""
    wh = json.loads((WHISPER_DIR / f"{stem}.json").read_text())["words"]
    wnorm = [match_norm(w["w"]) for w in wh]
    rnorm = [match_norm(w) for w in ref_words]
    sm = difflib.SequenceMatcher(None, wnorm, rnorm, autojunk=False)
    anchors = {}
    for blk in sm.get_matching_blocks():
        if blk.size >= 3:  # ignore short, possibly spurious matches
            for k in range(blk.size):
                w = wh[blk.a + k]
                anchors[blk.b + k] = (w["s"], w["e"])
    return anchors


def process(mp3, model, tokenizer, aligner):
    mp3 = pathlib.Path(mp3)
    title, book, c0, c1 = part_info(mp3)
    verses = [v for v in load_book(book) if c0 <= v["chapter"] <= c1]
    print(f"== {mp3.name}: {title} ({len(verses)} verses)", flush=True)

    wav = decode(mp3, SR)
    dur = len(wav) / SR
    emission, spf = compute_emissions(model, wav)
    star = emission.shape[1] - 1  # with_star=True adds '*' as the last class

    # flatten reference words, remember (verse idx, word idx)
    flat = [(vi, wi, w) for vi, v in enumerate(verses) for wi, w in enumerate(v["words"])]
    anchors = whisper_anchors(mp3.stem, [w for _, _, w in flat])
    print(f"   whisper anchors: {len(anchors)}/{len(flat)} words", flush=True)

    word_times = {}  # (vi, wi) -> (start, end, score)
    for ch in range(c0, c1 + 1):
        idx = [i for i, (vi, _, _) in enumerate(flat) if verses[vi]["chapter"] == ch]
        a, b = idx[0], idx[-1] + 1
        prev = [anchors[i][1] for i in anchors if i < a]
        nxt = [anchors[i][0] for i in anchors if i >= b]
        t0 = max(prev) if prev else 0.0
        t1 = min(nxt) if nxt else dur
        f0, f1 = int(t0 / spf), min(int(t1 / spf) + 1, emission.shape[0])
        words = [mms_norm(flat[i][2]) for i in range(a, b)]
        keep = [i for i, w in zip(range(a, b), words) if w]
        tokens = [star] + [t for w in words if w for t in tokenizer([w])[0]] + [star]
        em = emission[f0:f1].unsqueeze(0)
        ali, scores = torchaudio.functional.forced_align(em, torch.tensor([tokens], dtype=torch.int32), blank=0)
        spans = torchaudio.functional.merge_tokens(ali[0], scores[0].exp())
        spans = spans[1:-1] if len(spans) == len(tokens) else None
        if spans is None:
            raise RuntimeError(f"chapter {ch}: alignment produced wrong span count")
        k = 0
        for i, w in zip(range(a, b), words):
            if not w:
                continue
            sp = spans[k:k + len(w)]
            k += len(w)
            s = (f0 + sp[0].start) * spf
            e = (f0 + sp[-1].end) * spf
            sc = float(sum(x.score * (x.end - x.start) for x in sp) / sum(x.end - x.start for x in sp))
            word_times[flat[i][:2]] = (s, e, sc)
        print(f"   ch {ch}: window {t0:7.1f}-{t1:7.1f}s, {len(keep)} words", flush=True)

    # verse spans and cut points
    spans_v = []
    for vi, v in enumerate(verses):
        ts = [word_times[(vi, wi)] for wi in range(len(v["words"])) if (vi, wi) in word_times]
        spans_v.append((ts[0][0], ts[-1][1]))
    book_dir = OUT_DIR / book
    book_dir.mkdir(parents=True, exist_ok=True)
    full = OUT_DIR.parent / "work_full.wav"
    decode(mp3, 44100, out=full)  # exact-seek source for cutting

    meta_verses = []
    for vi, v in enumerate(verses):
        s, e = spans_v[vi]
        cs = s - PAD_PRE
        if vi > 0:
            cs = max(cs, (spans_v[vi - 1][1] + s) / 2)
        ce = e + PAD_POST
        if vi + 1 < len(verses):
            ce = min(ce, (e + spans_v[vi + 1][0]) / 2)
        cs, ce = max(0.0, cs), min(dur, ce)
        name = f"{book}_{v['chapter']:02d}_{v['verse']:02d}.mp3"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{cs:.3f}", "-to", f"{ce:.3f}", "-i", str(full),
                        "-c:a", "libmp3lame", "-b:a", "128k",
                        "-metadata", f"title={book} {v['chapter']}:{v['verse']}",
                        "-metadata", "artist=Vulgata Clementina", "-metadata", "album=Biblia Sacra",
                        str(book_dir / name)], check=True)
        words = []
        for wi, w in enumerate(v["words"]):
            t = word_times.get((vi, wi))
            words.append({"word": w,
                          "start": round(t[0] - cs, 3) if t else None,
                          "end": round(t[1] - cs, 3) if t else None,
                          "confidence": round(t[2], 3) if t else None})
        meta_verses.append({
            "ref": f"{book} {v['chapter']}:{v['verse']}", "book": book,
            "chapter": v["chapter"], "verse": v["verse"], "text": v["text"],
            "audio_file": f"{book}/{name}",
            "duration": round(ce - cs, 3),
            "source_start": round(cs, 3), "source_end": round(ce, 3),
            "words": words,
        })
    full.unlink()

    meta = {
        "source_audio": mp3.name, "title": title, "book": book, "chapters": [c0, c1],
        "text_source": "Clementine Vulgate (vulsearch.sourceforge.net, via github.com/BibleGet-I-O/Clementine-Vulgate)",
        "notes": "Word start/end times are seconds from the start of the verse's audio_file. "
                 "source_start/source_end locate the verse clip in source_audio. "
                 "Timings from forced alignment (torchaudio MMS_FA); confidence is the mean aligner probability.",
        "verses": meta_verses,
    }
    (OUT_DIR / f"{mp3.stem}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    # sanity check: aligned verse starts vs. Whisper anchors on the verse's first word
    off = []
    i = 0
    for vi, v in enumerate(verses):
        if i in anchors:
            off.append((abs(spans_v[vi][0] - anchors[i][0]), f"{v['chapter']}:{v['verse']}"))
        i += len(v["words"])
    off.sort(reverse=True)
    print(f"   verse-start vs whisper: median {np.median([o for o, _ in off]):.2f}s, worst {off[:5]}", flush=True)


def main():
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=True).to(DEVICE).eval()
    tokenizer = bundle.get_tokenizer()
    for f in sys.argv[1:]:
        process(f, model, tokenizer, None)


if __name__ == "__main__":
    main()
