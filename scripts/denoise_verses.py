"""Step 3 (optional): remove background hiss from aligned parts and re-cut their verse clips.

Parts 001-007 (Genesis and Exodus 1-22) carry a flat broadband hiss: in the pauses, 4-16 kHz sits ~10-15 dB
above the rest of the recording. This denoises a whole part with ffmpeg's FFT denoiser, then re-cuts each verse
at the cut points align_split.py recorded (source_start/source_end), so word timings stay valid as they are.
Run it after align_split.py; re-aligning a part overwrites the clips with unfiltered ones again.

Usage: .venv/bin/python scripts/denoise_verses.py resources/audio/vulgate/bibliasacra_00[1-7]_128kb.mp3
       ... --filter none   (re-cut from the original audio, undoing the denoise)
"""
import argparse, json, os, pathlib, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "resources" / "audio" / "vulgate" / "verses"
# White-noise model, 18 dB reduction, noise floor -42 dB tracked through the file: brings the hiss down to the
# level of the other parts (-55 dB at 4-16 kHz in pauses) and leaves the voice within ~0.3 dB.
DEFAULT_FILTER = "afftdn=nt=w:nr=18:nf=-42:tn=1"


def process(mp3, af):
    mp3 = pathlib.Path(mp3)
    meta_file = OUT_DIR / f"{mp3.stem}.json"
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(dir=OUT_DIR.parent) as tmp:
        full = pathlib.Path(tmp) / "full.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", "44100"]
                       + (["-af", af] if af else []) + ["-y", str(full)], check=True)
        for v in meta["verses"]:
            out = OUT_DIR / v["audio_file"]
            part = out.with_suffix(".tmp.mp3")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{v['source_start']:.3f}", "-to", f"{v['source_end']:.3f}",
                            "-i", str(full), "-c:a", "libmp3lame", "-b:a", "128k",
                            "-metadata", f"title={v['book']} {v['chapter']}:{v['verse']}",
                            "-metadata", "artist=Vulgata Clementina", "-metadata", "album=Biblia Sacra",
                            str(part)], check=True)
            os.replace(part, out)
    if af:
        meta["denoise"] = af
    else:
        meta.pop("denoise", None)
    meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{mp3.name}: {len(meta['verses'])} verses re-cut ({af or 'no filter'})", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("parts", nargs="+")
    ap.add_argument("--filter", default=DEFAULT_FILTER, help='ffmpeg audio filter, or "none" for the original audio')
    a = ap.parse_args()
    af = None if a.filter == "none" else a.filter
    for p in a.parts:
        process(p, af)


if __name__ == "__main__":
    main()
