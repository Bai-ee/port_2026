#!/usr/bin/env python3
"""
Optimize reel for web delivery — aggressive, audio stripped.

Encodes from the source master (public/vid/reel.mp4) into two web assets:
  reel.optimized.mp4  — H.264, CRF 33, no audio, +faststart
  reel.poster.jpg     — poster for instant first paint (poster=). Uses the provided
                        splash (public/img/video_splash.png) if present, else a frame.

Why these settings:
- 1200x674 is small, so high CRF is near-invisible. CRF 33 ~quarters the weight.
- 60fps -> 30fps halves motion data; reel motion stays smooth.
- Audio removed (-an): saves bytes AND lets the browser autoplay without a mute gesture.
- +faststart: moov atom at front => playback starts before full download.
- VP9/WebM was tested and came out LARGER than H.264 for this content, so it's dropped.

Tune with env vars: CRF_H264, FPS, POSTER_T (seconds).
Usage:
  scripts/.venv-img/bin/python scripts/optimize_reel.py        # or any python3
"""

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC          = REPO_ROOT / "public" / "vid" / "reel.mp4"
OUT_MP4      = REPO_ROOT / "public" / "vid" / "reel.optimized.mp4"
OUT_POSTER   = REPO_ROOT / "public" / "vid" / "reel.poster.jpg"
POSTER_SRC   = REPO_ROOT / "public" / "img" / "video_splash.png"  # provided splash; optional
POSTER_W     = 1280  # retina for the ~640px display container

CRF_H264 = os.environ.get("CRF_H264", "33")
POSTER_T = os.environ.get("POSTER_T", "2")
FPS_CAP  = float(os.environ.get("FPS", "30"))


def probe(path: Path) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def mb(path: Path) -> float:
    return path.stat().st_size / 1_048_576


def ffmpeg(cmd: list[str], label: str) -> None:
    print(f"\n[{label}] running ffmpeg…")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"ffmpeg stderr ({label}):\n{proc.stderr}", file=sys.stderr)
        sys.exit(1)


def run() -> None:
    if not SRC.exists():
        print(f"ERROR: source not found: {SRC}", file=sys.stderr)
        sys.exit(1)

    info = probe(SRC)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    w, h = video["width"], video["height"]
    num, den = map(int, video.get("r_frame_rate", "30/1").split("/"))
    src_fps = num / den if den else 30.0
    target_fps = FPS_CAP if src_fps > FPS_CAP else src_fps
    duration = float(info["format"]["duration"])

    print(f"Source : {SRC.name}  ({mb(SRC):.1f} MB)")
    print(f"Stream : {w}x{h}  {src_fps:.0f}fps  {duration:.1f}s")
    print(f"Target : {w}x{h}  {target_fps:.0f}fps  no audio  h264 CRF {CRF_H264}")

    # H.264 MP4
    ffmpeg([
        "ffmpeg", "-y", "-i", str(SRC),
        "-vf", f"fps={target_fps}",
        "-an",
        "-c:v", "libx264", "-crf", CRF_H264, "-preset", "slower",
        "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(OUT_MP4),
    ], "h264")

    # Poster: prefer the provided splash, else extract a frame
    if POSTER_SRC.exists():
        from PIL import Image, ImageOps  # Pillow already in scripts/.venv-img
        import io
        im = ImageOps.exif_transpose(Image.open(POSTER_SRC)).convert("RGB")
        if im.width > POSTER_W:
            im = im.resize((POSTER_W, round(im.height * POSTER_W / im.width)), Image.LANCZOS)
        for q in (85, 82, 78, 74, 70):
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=q, optimize=True, progressive=True)
            if buf.tell() <= 160 * 1024:
                break
        OUT_POSTER.write_bytes(buf.getvalue())
        print(f"\n[poster] from splash {POSTER_SRC.name}  {im.size}  q={q}")
    else:
        ffmpeg([
            "ffmpeg", "-y", "-ss", POSTER_T, "-i", str(SRC),
            "-frames:v", "1", "-q:v", "3",
            str(OUT_POSTER),
        ], "poster")

    print("\nDone.")
    print(f"  source : {mb(SRC):.1f} MB")
    print(f"  mp4    : {mb(OUT_MP4):.1f} MB  ({OUT_MP4.name})")
    print(f"  poster : {mb(OUT_POSTER)*1024:.0f} KB  ({OUT_POSTER.name})")


if __name__ == "__main__":
    run()
