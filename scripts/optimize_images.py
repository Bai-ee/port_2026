#!/usr/bin/env python3
"""
optimize_images.py

SEO-aware image optimizer for the portfolio.

- Scans public/ for raster images (PNG, JPG, JPEG).
- Parses JSX/TSX/JS for <img>, <Image>, CSS background-image usages referencing
  each file, and derives the largest rendered width (width/sizes/max-width).
- Uses that × 2 (retina) as a floor. Images are NEVER downscaled below that floor.
- Writes an optimized WebP next to the original. Originals are preserved.
- OG image (og_meta.*): re-encoded as optimized JPG at 1200x630, target <300 KB.
- Dry-run by default. Pass --write to emit files.

Usage (from repo root):
  scripts/.venv-img/bin/python scripts/optimize_images.py
  scripts/.venv-img/bin/python scripts/optimize_images.py --write
  scripts/.venv-img/bin/python scripts/optimize_images.py --write --only og
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.stderr.write(
        "Pillow not installed. Run:\n"
        "  python3 -m venv scripts/.venv-img && "
        "scripts/.venv-img/bin/pip install Pillow\n"
    )
    sys.exit(1)


REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "public"
SCAN_EXTS = {".png", ".jpg", ".jpeg"}
CODE_EXTS = {".jsx", ".tsx", ".js", ".ts", ".mjs", ".cjs", ".css", ".scss", ".html"}
EXCLUDE_DIRS = {"node_modules", ".next", "dist", ".git", "scripts/.venv-img", ".venv-img"}

# Safety floor when we can't infer DOM width — keeps retina sharpness on large displays.
DEFAULT_RETINA_FLOOR_PX = 1600
OG_TARGET_W, OG_TARGET_H = 1200, 630
OG_MAX_BYTES = 300 * 1024

# Min savings to bother writing a WebP.
MIN_SAVINGS_RATIO = 0.10


@dataclass
class ImageInfo:
    path: Path
    rel: str
    width: int
    height: int
    bytes: int
    referenced_widths: list[int] = field(default_factory=list)

    @property
    def max_dom_width(self) -> int:
        return max(self.referenced_widths) if self.referenced_widths else 0

    @property
    def retina_floor(self) -> int:
        if self.max_dom_width:
            return self.max_dom_width * 2
        return DEFAULT_RETINA_FLOOR_PX


def iter_code_files(root: Path) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        # prune
        rel = Path(dirpath).relative_to(root).as_posix()
        dirnames[:] = [
            d for d in dirnames
            if d not in EXCLUDE_DIRS and not (rel and any(
                (rel + "/" + d).startswith(ex) for ex in EXCLUDE_DIRS
            ))
        ]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in CODE_EXTS:
                yield p


def iter_public_images(public: Path) -> Iterable[Path]:
    for dirpath, _dirnames, filenames in os.walk(public):
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in SCAN_EXTS:
                yield p


_WIDTH_RE = re.compile(r"""width\s*[:=]\s*['"]?\s*(\d{2,5})""", re.IGNORECASE)
_SIZES_PX_RE = re.compile(r"(\d{2,5})\s*px", re.IGNORECASE)
_TAG_RE = re.compile(
    r"<\s*(?:img|Image)\b[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
_SRC_RE = re.compile(r"""(?:src|source)\s*=\s*['"]([^'"]+)['"]""", re.IGNORECASE)


def extract_widths_from_tag(tag: str) -> list[int]:
    widths: list[int] = []
    for m in _WIDTH_RE.finditer(tag):
        try:
            widths.append(int(m.group(1)))
        except ValueError:
            pass
    for m in _SIZES_PX_RE.finditer(tag):
        try:
            widths.append(int(m.group(1)))
        except ValueError:
            pass
    return widths


def scan_references(images: dict[str, ImageInfo]) -> None:
    """
    Walk code files, match <img>/<Image> tags and CSS url(), attribute widths or
    sizes to the referenced image basename.
    """
    basenames = {Path(k).name: k for k in images.keys()}
    url_re = re.compile(r"""url\(\s*['"]?([^'")]+)['"]?\s*\)""")

    for cf in iter_code_files(REPO):
        try:
            text = cf.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        # JSX/HTML tags
        for tag in _TAG_RE.findall(text):
            src_m = _SRC_RE.search(tag)
            if not src_m:
                continue
            src = src_m.group(1).strip()
            name = Path(src).name
            if name not in basenames:
                continue
            widths = extract_widths_from_tag(tag)
            if widths:
                images[basenames[name]].referenced_widths.extend(widths)

        # CSS url() — no width context, but mark as referenced w/ default floor later
        for m in url_re.finditer(text):
            name = Path(m.group(1)).name
            if name in basenames:
                # no width hint from CSS; leave empty (default floor applies)
                pass


def collect_images() -> dict[str, ImageInfo]:
    out: dict[str, ImageInfo] = {}
    for p in iter_public_images(PUBLIC):
        try:
            with Image.open(p) as im:
                w, h = im.size
        except Exception as e:
            sys.stderr.write(f"skip (unreadable): {p} — {e}\n")
            continue
        out[str(p)] = ImageInfo(
            path=p,
            rel=p.relative_to(REPO).as_posix(),
            width=w,
            height=h,
            bytes=p.stat().st_size,
        )
    return out


def resize_for_floor(im: Image.Image, floor_px: int) -> Image.Image:
    """If image wider than floor, downscale to floor. Never below floor."""
    if im.width <= floor_px:
        return im
    ratio = floor_px / im.width
    new_h = max(1, round(im.height * ratio))
    return im.resize((floor_px, new_h), Image.LANCZOS)


def write_webp(info: ImageInfo, dry_run: bool) -> tuple[str, int, int, str]:
    """
    Produce a WebP alongside the original. Returns (out_rel, new_bytes, w, note).
    """
    out_path = info.path.with_suffix(".webp")
    floor = info.retina_floor

    with Image.open(info.path) as im:
        im = ImageOps.exif_transpose(im)
        # preserve alpha for PNG sources
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        if has_alpha:
            im = im.convert("RGBA")
        else:
            im = im.convert("RGB")

        target = resize_for_floor(im, floor)

        # Encode to memory to compare size
        import io
        buf = io.BytesIO()
        # quality 82 is a solid SEO default; method=6 for best compression
        save_kwargs = dict(format="WEBP", quality=82, method=6)
        if has_alpha:
            save_kwargs["lossless"] = False
        target.save(buf, **save_kwargs)
        new_bytes = buf.tell()

        note = ""
        if new_bytes >= info.bytes * (1 - MIN_SAVINGS_RATIO):
            note = f"skip: savings <{int(MIN_SAVINGS_RATIO*100)}% ({new_bytes} vs {info.bytes})"
            return (out_path.relative_to(REPO).as_posix(), new_bytes, target.width, note)

        if not dry_run:
            with open(out_path, "wb") as f:
                f.write(buf.getvalue())
            note = "written"
        else:
            note = "dry-run"

    return (out_path.relative_to(REPO).as_posix(), new_bytes, target.width, note)


def optimize_og(info: ImageInfo, dry_run: bool) -> tuple[str, int, int, str]:
    """
    Optimize OG image: re-encode as JPG at 1200x630, under 300 KB.
    Writes <stem>.optimized.jpg next to original.
    """
    out_path = info.path.with_name(info.path.stem + ".optimized.jpg")

    with Image.open(info.path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        # Cover-crop to 1200x630
        src_ratio = im.width / im.height
        tgt_ratio = OG_TARGET_W / OG_TARGET_H
        if src_ratio > tgt_ratio:
            new_w = int(im.height * tgt_ratio)
            x = (im.width - new_w) // 2
            im = im.crop((x, 0, x + new_w, im.height))
        elif src_ratio < tgt_ratio:
            new_h = int(im.width / tgt_ratio)
            y = (im.height - new_h) // 2
            im = im.crop((0, y, im.width, y + new_h))
        im = im.resize((OG_TARGET_W, OG_TARGET_H), Image.LANCZOS)

        import io
        chosen_bytes = None
        chosen_q = None
        for q in (85, 82, 78, 74, 70, 66, 62):
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=q, optimize=True, progressive=True)
            if buf.tell() <= OG_MAX_BYTES:
                chosen_bytes = buf.getvalue()
                chosen_q = q
                break
        if chosen_bytes is None:
            # fallback to lowest tried
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=60, optimize=True, progressive=True)
            chosen_bytes = buf.getvalue()
            chosen_q = 60

        if not dry_run:
            with open(out_path, "wb") as f:
                f.write(chosen_bytes)
            note = f"written q={chosen_q}"
        else:
            note = f"dry-run q={chosen_q}"

    return (out_path.relative_to(REPO).as_posix(), len(chosen_bytes), OG_TARGET_W, note)


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}" if unit != "B" else f"{n}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="Actually write files. Default is dry-run.")
    ap.add_argument("--only", choices=("webp", "og", "all"), default="all", help="Which pass to run.")
    ap.add_argument("--min-bytes", type=int, default=100 * 1024,
                    help="Skip sources smaller than this (default 100 KB).")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if not PUBLIC.exists():
        sys.stderr.write(f"public/ not found at {PUBLIC}\n")
        return 2

    images = collect_images()
    scan_references(images)

    print(f"{'WRITE' if args.write else 'DRY-RUN'} — {len(images)} raster images under public/")
    print(f"{'file':<56} {'dims':>11} {'orig':>8}  →  {'new':>8}  floor  note")
    print("-" * 120)

    total_orig = 0
    total_new = 0

    for info in sorted(images.values(), key=lambda i: -i.bytes):
        total_orig += info.bytes

        is_og = info.path.name.lower().startswith("og_") or "og_meta" in info.path.name.lower()

        if info.bytes < args.min_bytes and not is_og:
            if args.verbose:
                print(f"{info.rel:<56} {info.width}x{info.height:<5} {human(info.bytes):>8}  —  skip (<min-bytes)")
            total_new += info.bytes
            continue

        # OG pass
        if is_og and args.only in ("og", "all"):
            out_rel, new_bytes, new_w, note = optimize_og(info, dry_run=not args.write)
            print(f"{info.rel:<56} {info.width}x{info.height:<5} {human(info.bytes):>8}  →  {human(new_bytes):>8}  og     {note}  [{out_rel}]")
            total_new += min(new_bytes, info.bytes)
            # also continue to webp pass? No — OG is served as JPG/PNG to scrapers.
            continue

        # WebP pass
        if args.only in ("webp", "all"):
            out_rel, new_bytes, new_w, note = write_webp(info, dry_run=not args.write)
            print(f"{info.rel:<56} {info.width}x{info.height:<5} {human(info.bytes):>8}  →  {human(new_bytes):>8}  {info.retina_floor:>5}  {note}  [{out_rel}]")
            if "skip" in note:
                total_new += info.bytes
            else:
                total_new += new_bytes
        else:
            total_new += info.bytes

    print("-" * 120)
    print(f"totals: {human(total_orig)}  →  {human(total_new)}  "
          f"(Δ {human(max(0, total_orig - total_new))}, "
          f"{(1 - total_new/total_orig)*100:.1f}% smaller)" if total_orig else "no images")
    if not args.write:
        print("\n(dry-run) re-run with --write to emit files. Originals are never deleted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
