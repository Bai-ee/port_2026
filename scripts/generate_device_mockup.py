#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, Tuple

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT / "input"
TEMPLATE_CANDIDATES = [
    ROOT / "public" / "img" / "device_template.png",
    ROOT / "public" / "IMG" / "device_template.png",
    ROOT / "IMG" / "device_template.png",
]
OUTPUT_PATH = ROOT / "output" / "final_mockup.png"
PUBLIC_OUTPUT_PATH = ROOT / "public" / "output" / "final_mockup.png"


# ── Bounding Box Edits ────────────────────────────────────────────────────────
# Format: (x, y, width, height)
DESKTOP_BOX = (180, 110, 1080, 610)
IPAD_BOX = (1220, 220, 360, 520)
IPHONE_BOX = (1630, 260, 180, 420)

SCREEN_BOXES: Dict[str, Tuple[int, int, int, int]] = {
    "desktop": DESKTOP_BOX,
    "ipad": IPAD_BOX,
    "iphone": IPHONE_BOX,
}


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


def resize_and_fit(image: Image.Image, target_width: int, target_height: int) -> Image.Image:
    source_width, source_height = image.size
    scale = max(target_width / source_width, target_height / source_height)
    resized_width = int(round(source_width * scale))
    resized_height = int(round(source_height * scale))
    resized = image.resize((resized_width, resized_height), Image.Resampling.LANCZOS)

    left = max(0, (resized_width - target_width) // 2)
    top = max(0, (resized_height - target_height) // 2)
    right = left + target_width
    bottom = top + target_height
    return resized.crop((left, top, right, bottom))


def paste_into_template(template: Image.Image, image: Image.Image, box: Tuple[int, int, int, int]) -> None:
    x, y, width, height = box
    fitted = resize_and_fit(image, width, height)
    template.paste(fitted, (x, y))


def generate_mockup(
    desktop_path: Path,
    ipad_path: Path,
    iphone_path: Path,
    template_path: Path,
    output_path: Path,
    public_output_path: Path,
) -> Path:
    template, images = load_images(desktop_path, ipad_path, iphone_path, template_path)

    for device_name, box in SCREEN_BOXES.items():
        paste_into_template(template, images[device_name], box)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    public_output_path.parent.mkdir(parents=True, exist_ok=True)
    template.save(output_path, format="PNG")
    template.save(public_output_path, format="PNG")
    return output_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate a clay-style multi-device mockup from three screenshots.")
    parser.add_argument("--desktop", default=str(INPUT_DIR / "desktop.png"), help="Path to desktop screenshot PNG.")
    parser.add_argument("--ipad", default=str(INPUT_DIR / "ipad.png"), help="Path to iPad screenshot PNG.")
    parser.add_argument("--iphone", default=str(INPUT_DIR / "iphone.png"), help="Path to iPhone screenshot PNG.")
    parser.add_argument("--template", default=None, help="Optional explicit path to the device template PNG.")
    parser.add_argument("--output", default=str(OUTPUT_PATH), help="Output path for the final composite PNG.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    desktop_path = Path(args.desktop).expanduser().resolve()
    ipad_path = Path(args.ipad).expanduser().resolve()
    iphone_path = Path(args.iphone).expanduser().resolve()
    template_path = resolve_template_path(args.template)
    output_path = Path(args.output).expanduser().resolve()
    public_output_path = PUBLIC_OUTPUT_PATH.resolve()

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
    )

    print(f"Mockup generated: {final_path}")
    print(f"Dashboard URL: /output/{PUBLIC_OUTPUT_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
