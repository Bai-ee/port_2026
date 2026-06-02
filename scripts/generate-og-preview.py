#!/usr/bin/env python3
"""
Generate OG preview image for a client brief.
Requires: pip install Pillow
Requires: Doto font installed (Google Fonts) or in ./fonts/

Usage:
  python3 scripts/generate-og-preview.py \
    --headline "IT'S\nRAW\nPOKE" \
    --subtitle "Website Updates w/ Online Ordering & Pick Up" \
    --date "June 1, 2026" \
    --out clients/fast-poker/its-raw-poke/og-preview.png
"""

import argparse
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630

def find_doto_font():
    """Try common locations for Doto-Black font."""
    candidates = [
        # macOS Google Fonts cache
        os.path.expanduser("~/Library/Fonts/Doto-Black.ttf"),
        os.path.expanduser("~/Library/Fonts/Doto[wght].ttf"),
        # Linux
        "/usr/share/fonts/truetype/doto/Doto-Black.ttf",
        "/usr/local/share/fonts/Doto-Black.ttf",
        # Local repo fonts folder
        os.path.join(os.path.dirname(__file__), "..", "fonts", "Doto-Black.ttf"),
        # Current directory
        "Doto-Black.ttf",
    ]

    # Also search for any Doto font file
    for root_dir in [os.path.expanduser("~/Library/Fonts"), "/usr/share/fonts", "/usr/local/share/fonts"]:
        if os.path.isdir(root_dir):
            for f in os.listdir(root_dir):
                if 'doto' in f.lower() and f.endswith(('.ttf', '.otf')):
                    candidates.insert(0, os.path.join(root_dir, f))

    for path in candidates:
        if os.path.exists(path):
            return path

    return None


def make_gradient(img):
    """Paint the warm gradient background matching the brief CSS."""
    for y in range(H):
        for x in range(W):
            r, g, b = 254, 253, 249

            dx, dy = x / W, y / H

            # Top-left: warm peach/coral
            dist = (dx**2 + (dy*0.8)**2)**0.5
            if dist < 0.9:
                f = (0.9 - dist) * 0.4
                r = min(255, int(r + 55 * f))
                g = min(255, int(g - 25 * f))
                b = min(255, int(b - 45 * f))

            # Top-right: purple
            dx2 = (W - x) / W
            dist2 = (dx2**2 + (dy * 0.5)**2)**0.5
            if dist2 < 0.7:
                f = (0.7 - dist2) * 0.35
                r = min(255, int(r + 15 * f))
                g = min(255, int(g - 35 * f))
                b = min(255, int(b + 85 * f))

            # Center-left: pink
            cx = abs(x - W * 0.1) / W
            cy = abs(y - H * 0.5) / H
            dist3 = (cx**2 + cy**2)**0.5
            if dist3 < 0.6:
                f = (0.6 - dist3) * 0.3
                r = min(255, int(r + 50 * f))
                g = min(255, int(g - 30 * f))
                b = min(255, int(b + 25 * f))

            # Bottom-right: subtle blue
            bx = (W - x) / W
            by2 = (H - y) / H
            dist4 = (bx**2 + (by2*0.8)**2)**0.5
            if dist4 < 0.6:
                f = (0.6 - dist4) * 0.15
                r = min(255, int(r - 10 * f))
                g = min(255, int(g - 5 * f))
                b = min(255, int(b + 40 * f))

            img.putpixel((x, y), (min(255, r), min(255, g), min(255, b)))


def generate(headline, subtitle, date, out_path):
    img = Image.new('RGB', (W, H), '#fefdf9')
    make_gradient(img)
    draw = ImageDraw.Draw(img)

    # Find fonts
    doto_path = find_doto_font()
    if doto_path:
        print(f"Using Doto font: {doto_path}")
        font_huge = ImageFont.truetype(doto_path, 120)
    else:
        print("WARNING: Doto font not found. Using system monospace bold.")
        print("Install Doto from https://fonts.google.com/specimen/Doto")
        font_huge = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 100)

    try:
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14)
    except:
        font_small = ImageFont.load_default()

    ink = '#0a0a0a'
    light = '#8a8070'

    # Top left
    draw.text((50, 28), "BRYAN BALLI", fill=light, font=font_small)
    draw.text((50, 48), f"PREPARED {date.upper()}", fill=light, font=font_small)

    # Top right
    bbox = draw.textbbox((0, 0), "HITLOOP.AGENCY", font=font_small)
    tw = bbox[2] - bbox[0]
    draw.text((W - tw - 50, 28), "HITLOOP.AGENCY", fill=light, font=font_small)

    # Main headline
    lines = headline.upper().split('\n')
    y_pos = 120
    for line in lines:
        draw.text((50, y_pos), line.strip(), fill=ink, font=font_huge)
        y_pos += 125

    # Subtitle
    draw.text((50, H - 90), subtitle, fill=light, font=font_small)

    # Sig
    repo_root = os.path.join(os.path.dirname(__file__), '..')
    sig_path = os.path.join(repo_root, 'public', 'img', 'sig.png')
    if os.path.exists(sig_path):
        sig = Image.open(sig_path).convert('RGBA')
        sig = sig.resize((50, 38), Image.LANCZOS)
        r2, g2, b2, a2 = sig.split()
        a2 = a2.point(lambda x: int(x * 0.5))
        sig = Image.merge('RGBA', (r2, g2, b2, a2))
        img.paste(sig, (50, H - 60), sig)

    # Bottom right
    bbox = draw.textbbox((0, 0), "Platform Recommendations", font=font_small)
    tw = bbox[2] - bbox[0]
    draw.text((W - tw - 50, H - 50), "Platform Recommendations", fill=light, font=font_small)

    img.save(out_path, 'PNG', optimize=True)
    print(f"Saved: {out_path} ({os.path.getsize(out_path)} bytes)")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generate OG preview for a brief')
    parser.add_argument('--headline', default="IT'S\nRAW\nPOKE", help='Headline text (use \\n for line breaks)')
    parser.add_argument('--subtitle', default="Website Updates w/ Online Ordering & Pick Up")
    parser.add_argument('--date', default="June 1, 2026")
    parser.add_argument('--out', default="clients/fast-poker/its-raw-poke/og-preview.png")

    args = parser.parse_args()
    generate(args.headline, args.subtitle, args.date, args.out)
