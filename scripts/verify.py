"""Spot-check verse clips: re-transcribe random clips with Whisper and compare to the verse text."""
import json, random, sys, pathlib, difflib, mlx_whisper
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from align_split import match_norm
random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 0)
meta_path = pathlib.Path(sys.argv[1]); meta = json.loads(meta_path.read_text())
vs = random.sample(meta["verses"], 12)
for v in vs:
    r = mlx_whisper.transcribe(str(meta_path.parent / v["audio_file"]), path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="la")
    a = [match_norm(w) for w in r["text"].split()]; b = [match_norm(w) for w in (x["word"] for x in v["words"])]
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    print(f"{v['ref']:14s} {ratio:.2f}\n  REF: {v['text']}\n  ASR: {r['text'].strip()}")
