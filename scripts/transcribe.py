"""Step 1: rough Whisper transcription with word timestamps (used only as alignment anchors)."""
import json, sys, pathlib, mlx_whisper

out_dir = pathlib.Path("work/whisper"); out_dir.mkdir(parents=True, exist_ok=True)
for f in sys.argv[1:]:
    p = pathlib.Path(f)
    out = out_dir / (p.stem + ".json")
    if out.exists():
        continue
    r = mlx_whisper.transcribe(str(p), path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
                               language="la", word_timestamps=True, condition_on_previous_text=False)
    words = [{"w": w["word"].strip(), "s": w["start"], "e": w["end"]}
             for s in r["segments"] for w in s.get("words", [])]
    out.write_text(json.dumps({"segments": [{"s": s["start"], "e": s["end"], "t": s["text"]} for s in r["segments"]],
                               "words": words}, ensure_ascii=False))
    print("done", p.name, len(words), flush=True)
