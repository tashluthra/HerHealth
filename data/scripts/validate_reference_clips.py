from pathlib import Path
import json, re, sys

ALLOWED = {
    "stance": {"shoulder","hip","wide"},
    "depth": {"half","full"},
    "speed": {"slow","normal","fast"},
    "view": {"front","side"}
}

YOUTUBE_ID_RE = re.compile(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{6,})")

def extract_id(url:str) -> str|None:
    m = YOUTUBE_ID_RE.search(url)
    return m.group(1) if m else None

p = Path("data/reference/reference_clips.json")
data = json.loads(p.read_text())

ok = True
for i, clip in enumerate(data, start=1):
    # Required fields
    for key in ["url","start","end","stance","depth","speed"]:
        if key not in clip:
            ok = False
            print(f"[Row {i}] Missing '{key}'")

    # Start/end sanity
    if clip.get("start") is not None and clip.get("end") is not None:
        if not (isinstance(clip["start"], (int,float)) and isinstance(clip["end"], (int,float))):
            ok = False
            print(f"[Row {i}] start/end must be numbers")
        elif clip["end"] <= clip["start"]:
            ok = False
            print(f"[Row {i}] end ({clip['end']}) must be > start ({clip['start']})")

    # Enums
    for key in ["stance","depth","speed","view"]:
        if key in clip and clip[key] not in ALLOWED[key]:
            ok = False
            print(f"[Row {i}] '{key}' has invalid value: {clip[key]}")

    # ID presence / derivation check
    want_id = clip.get("id") or extract_id(clip.get("url",""))
    if not want_id:
        ok = False
        print(f"[Row {i}] Could not derive YouTube ID from url: {clip.get('url')}")

if ok:
    print("reference_clips.json looks good!")
else:
    sys.exit("Validation failed.")
