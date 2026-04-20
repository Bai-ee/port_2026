#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, Tuple

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT / "input"
TEMPLATE_CANDIDATES = [
    ROOT / "api" / "_lib" / "assets" / "device_template.png",
    ROOT / "public" / "img" / "device_template.png",
    ROOT / "public" / "IMG" / "device_template.png",
    ROOT / "IMG" / "device_template.png",
]
OUTPUT_PATH = ROOT / "output" / "final_mockup.png"
PUBLIC_OUTPUT_PATH = ROOT / "public" / "output" / "final_mockup.png"


# ── Bounding Boxes ─────────────────────────────────────────────────────────────
# Format: (x, y, width, height)
#
# Calibrated against public/img/device_template.png (1536x1024).
# X/Y are the top-left corner of each screen content area.
# WIDTH/HEIGHT are the screen content dimensions (locked).
#
# To recalibrate when the template changes, see scripts/MOCKUP_CALIBRATION.md.
# Use --debug to generate a visual confirmation overlay before any production run.

DESKTOP_BOX: Tuple[int, int, int, int] = (
    159,   # X  — left edge of iMac screen glass
    145,   # Y  — top edge of iMac screen glass (text-centroid calibrated)
    707,   # WIDTH  (locked)
    418,   # HEIGHT (locked)
)

IPAD_BOX: Tuple[int, int, int, int] = (
    887,   # X  — left edge of iPad screen content area
    308,   # Y  — top edge of iPad screen content area
    298,   # WIDTH  (locked)
    437,   # HEIGHT (locked)
)

IPHONE_BOX: Tuple[int, int, int, int] = (
    1254,  # X  — left edge of iPhone screen content area
    470,   # Y  — top edge of iPhone screen content area
    138,   # WIDTH  (locked)
    307,   # HEIGHT (locked)
)

SCREEN_BOXES: Dict[str, Tuple[int, int, int, int]] = {
    "desktop": DESKTOP_BOX,
    "ipad": IPAD_BOX,
    "iphone": IPHONE_BOX,
}

# Corner radii per device (pixels at template resolution). 0 = sharp corners.
SCREEN_CORNER_RADII: Dict[str, int] = {
    "desktop": 0,
    "ipad": 7,
    "iphone": 11,
}

# Debug overlay colors
DEBUG_BOX_OUTLINE = (255, 0, 0, 255)        # red outline
DEBUG_BOX_FILL    = (255, 0, 0, 60)         # semi-transparent red fill


# ── Template resolution ────────────────────────────────────────────────────────

def resolve_template_path(explicit_path: str | None) -> Path:
    if explicit_path:
        path = Path(explicit_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Template not found: {path}")
        return path

    for candidate in TEMPLATE_CANDIDATES:
        if candidate.exists():
            return candidate

    searched = "\n".join(f"  - {candidate}" for candidate in TEMPLATE_CANDIDATES)
    raise FileNotFoundError(f"Could not find a template image. Searched:\n{searched}")


def load_images(desktop_path: Path, ipad_path: Path, iphone_path: Path, template_path: Path):
    template = Image.open(template_path).convert("RGBA")
    images = {
        "desktop": Image.open(desktop_path).convert("RGBA"),
        "ipad": Image.open(ipad_path).convert("RGBA"),
        "iphone": Image.open(iphone_path).convert("RGBA"),
    }
    return template, images


# ── Core fit logic ─────────────────────────────────────────────────────────────
# COVER + CENTER CROP. Never stretches. Never letterboxes.

def resize_and_fit(image: Image.Image, target_width: int, target_height: int) -> Image.Image:
    source_width, source_height = image.size
    scale = max(target_width / source_width, target_height / source_height)
    resized_width = int(round(source_width * scale))
    resized_height = int(round(source_height * scale))
    resized = image.resize((resized_width, resized_height), Image.Resampling.LANCZOS)

    left = max(0, (resized_width - target_width) // 2)
    top = 0  # anchor to top of screenshot, not center
    right = left + target_width
    bottom = top + target_height
    return resized.crop((left, top, right, bottom))


# ── Debug overlay ──────────────────────────────────────────────────────────────

def draw_debug_overlay(template: Image.Image, boxes: Dict[str, Tuple[int, int, int, int]]) -> Image.Image:
    """Return a copy of the template with each screen area outlined in red.
    Use this to verify X/Y coordinates before a real run."""
    overlay = template.copy().convert("RGBA")
    fill_layer = Image.new("RGBA", overlay.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(fill_layer)

    for device_name, (x, y, w, h) in boxes.items():
        draw.rectangle([x, y, x + w - 1, y + h - 1], fill=DEBUG_BOX_FILL, outline=DEBUG_BOX_OUTLINE, width=2)
        draw.text((x + 6, y + 6), device_name, fill=(255, 255, 255, 220))

    return Image.alpha_composite(overlay, fill_layer)


# ── Paste ──────────────────────────────────────────────────────────────────────

def paste_into_template(
    template: Image.Image,
    image: Image.Image,
    box: Tuple[int, int, int, int],
    corner_radius: int = 0,
) -> None:
    x, y, width, height = box
    fitted = resize_and_fit(image, width, height)
    if corner_radius > 0:
        mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, width - 1, height - 1], radius=corner_radius, fill=255
        )
        template.paste(fitted, (x, y), mask)
    else:
        template.paste(fitted, (x, y))


# ── Main generation ────────────────────────────────────────────────────────────

def generate_mockup(
    desktop_path: Path,
    ipad_path: Path,
    iphone_path: Path,
    template_path: Path,
    output_path: Path,
    public_output_path: Path,
    debug: bool = False,
) -> Path:
    template = Image.open(template_path).convert("RGBA")

    if debug:
        debug_path = output_path.parent / "debug_overlay.png"
        debug_image = draw_debug_overlay(template, SCREEN_BOXES)
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        debug_image.save(debug_path, format="PNG")
        print(f"Debug overlay saved: {debug_path}")
        print("Review debug_overlay.png to confirm X/Y coordinates before running in production.")
        return debug_path

    images = {
        "desktop": Image.open(desktop_path).convert("RGBA"),
        "ipad": Image.open(ipad_path).convert("RGBA"),
        "iphone": Image.open(iphone_path).convert("RGBA"),
    }

    for device_name, box in SCREEN_BOXES.items():
        paste_into_template(template, images[device_name], box, corner_radius=SCREEN_CORNER_RADII.get(device_name, 0))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    public_output_path.parent.mkdir(parents=True, exist_ok=True)
    template.save(output_path, format="PNG")
    template.save(public_output_path, format="PNG")
    return output_path


# ── CLI ────────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a clay-style multi-device mockup from three screenshots."
    )
    parser.add_argument("--desktop",  default=str(INPUT_DIR / "desktop.png"),  help="Path to desktop screenshot PNG.")
    parser.add_argument("--ipad",     default=str(INPUT_DIR / "ipad.png"),     help="Path to iPad screenshot PNG.")
    parser.add_argument("--iphone",   default=str(INPUT_DIR / "iphone.png"),   help="Path to iPhone screenshot PNG.")
    parser.add_argument("--template", default=None,                            help="Optional explicit path to the device template PNG.")
    parser.add_argument("--output",   default=str(OUTPUT_PATH),                help="Output path for the final composite PNG.")
    parser.add_argument(
        "--debug",
        action="store_true",
        help=(
            "Draw red bounding boxes on the template without pasting screenshots. "
            "Saves debug_overlay.png next to --output. Use to verify X/Y coordinates."
        ),
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    desktop_path = Path(args.desktop).expanduser().resolve()
    ipad_path    = Path(args.ipad).expanduser().resolve()
    iphone_path  = Path(args.iphone).expanduser().resolve()
    template_path = resolve_template_path(args.template)
    output_path   = Path(args.output).expanduser().resolve()
    public_output_path = PUBLIC_OUTPUT_PATH.resolve()

    if not args.debug:
        for path in (desktop_path, ipad_path, iphone_path):
            if not path.exists():
                raise FileNotFoundError(f"Input screenshot not found: {path}")

    final_path = generate_mockup(
        desktop_path=desktop_path,
        ipad_path=ipad_path,
        iphone_path=iphone_path,
        template_path=template_path,
        output_path=output_path,
        public_output_path=public_output_path,
        debug=args.debug,
    )

    if not args.debug:
        print(f"Mockup generated: {final_path}")
        print(f"Dashboard URL: /output/{PUBLIC_OUTPUT_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
