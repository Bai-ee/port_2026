#!/usr/bin/env python3
"""
Optimize reel.mp4 for web delivery.
- Keeps source resolution (1200x674)
- Drops 60fps → 30fps (halves motion data)
- H.264 CRF 24 — visually lossless at this resolution
- AAC 128k audio
- -movflags +faststart — moov atom at front for instant playback
- Two-pass NOT needed at CRF; single-pass is fine
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC  = REPO_ROOT / "public" / "vid" / "reel.mp4"
OUT  = REPO_ROOT / "public" / "vid" / "reel.optimized.mp4"

def probe(path: Path) -> dict:
    import json
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)

def fmt_mb(path: Path) -> str:
    return f"{path.stat().st_size / 1_048_576:.1f} MB"

def run():
    if not SRC.exists():
        print(f"ERROR: source not found: {SRC}", file=sys.stderr)
        sys.exit(1)

    info = probe(SRC)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    w, h  = video["width"], video["height"]
    fps_raw = video.get("r_frame_rate", "30/1")
    num, den = map(int, fps_raw.split("/"))
    src_fps = num / den
    target_fps = 30 if src_fps > 30 else src_fps
    duration = float(info["format"]["duration"])

    print(f"Source  : {SRC.name}")
    print(f"Size    : {fmt_mb(SRC)}")
    print(f"Stream  : {w}x{h}  {src_fps:.0f}fps  {duration:.1f}s")
    print(f"Target  : {w}x{h}  {target_fps:.0f}fps  CRF 24  AAC 128k  +faststart")
    print()

    cmd = [
        "ffmpeg", "-y",
        "-i", str(SRC),
        "-vf", f"fps={target_fps}",
        "-c:v", "libx264",
        "-crf", "24",
        "-preset", "slow",
        "-profile:v", "high",
        "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ac", "2",
        "-movflags", "+faststart",
        str(OUT),
    ]

    print("Running ffmpeg…")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print("ffmpeg stderr:\n", proc.stderr, file=sys.stderr)
        sys.exit(1)

    src_mb  = SRC.stat().st_size  / 1_048_576
    out_mb  = OUT.stat().st_size  / 1_048_576
    savings = (1 - out_mb / src_mb) * 100

    print(f"\nDone.")
    print(f"  Before : {src_mb:.1f} MB")
    print(f"  After  : {out_mb:.1f} MB  ({savings:.0f}% smaller)")

if __name__ == "__main__":
    run()
