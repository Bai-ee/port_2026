# Mockup Template Calibration Guide

Use this guide whenever `public/img/device_template.png` is replaced with a new image.  
The goal is to find the exact pixel X/Y coordinate of each device screen's top-left corner.

---

## What Needs Calibration

Only the **X/Y origin** of each bounding box needs to be measured.  
The **WIDTH/HEIGHT** are locked to the screen content area and must not change unless the template artwork changes the screen size.

| Device  | Width | Height | Notes              |
|---------|-------|--------|--------------------|
| Desktop | 707   | 418    | Locked             |
| iPad    | 298   | 437    | Locked             |
| iPhone  | 138   | 307    | Locked             |

---

## Step 1 — Open the Template

Use **one** of these tools:

**Figma (recommended)**
1. Import `public/img/device_template.png` as a frame or place it on the canvas.
2. Zoom to 100% (`Cmd+0`).
3. Click the exact top-left pixel of each device screen opening.
4. Read the `X` and `Y` values from the right panel.

**macOS Preview**
1. Open the PNG.
2. `Tools → Show Inspector` (or `Cmd+I`).
3. Hover over the top-left corner of each screen area.
4. The inspector shows pixel coordinates in real time.

**GIMP**
1. Open the PNG.
2. Use the pointer tool. Pixel coordinates show in the bottom status bar as `(x, y)`.

**Python one-liner (no GUI needed)**
```python
# Prints the template size so you can sanity-check scale.
from PIL import Image
img = Image.open("public/img/device_template.png")
print(img.size)  # (width, height)
```

---

## Step 2 — Record the Coordinates

For each device, click (or hover over) the **top-left corner** of the screen content area — the pixel where your screenshot content should begin.

Fill in this table:

| Device  | X (px) | Y (px) |
|---------|--------|--------|
| Desktop | ?      | ?      |
| iPad    | ?      | ?      |
| iPhone  | ?      | ?      |

---

## Step 3 — Update the Script

File: `scripts/generate_device_mockup.py`

Find the `DESKTOP_BOX`, `IPAD_BOX`, `IPHONE_BOX` constants near the top:

```python
DESKTOP_BOX: Tuple[int, int, int, int] = (
    180,   # X  ← replace with measured value
    110,   # Y  ← replace with measured value
    707,   # WIDTH  (do not change)
    418,   # HEIGHT (do not change)
)

IPAD_BOX: Tuple[int, int, int, int] = (
    1220,  # X  ← replace with measured value
    220,   # Y  ← replace with measured value
    298,   # WIDTH  (do not change)
    437,   # HEIGHT (do not change)
)

IPHONE_BOX: Tuple[int, int, int, int] = (
    1630,  # X  ← replace with measured value
    260,   # Y  ← replace with measured value
    138,   # WIDTH  (do not change)
    307,   # HEIGHT (do not change)
)
```

Replace only the first two values (X, Y) in each tuple with your measured coordinates.  
Remove the `NEEDS_CALIBRATION` comment once verified.

---

## Step 4 — Run Debug Mode

Debug mode draws red bounding boxes on the template **without** pasting any screenshots.  
Use it to visually confirm placement before a real run.

```bash
# From the repo root
python scripts/generate_device_mockup.py \
  --template public/img/device_template.png \
  --output output/final_mockup.png \
  --debug
```

Output: `output/debug_overlay.png`

Open it and check:
- Red boxes fall exactly inside each device screen border
- No box clips outside the device frame
- No box is offset or misaligned

If a box is off:
- Adjust the X/Y for that device only
- Re-run `--debug`
- Repeat until all three align

---

## Step 5 — Production Run

Once debug confirms alignment, run without `--debug`:

```bash
python scripts/generate_device_mockup.py \
  --desktop input/desktop.png \
  --ipad input/ipad.png \
  --iphone input/iphone.png \
  --template public/img/device_template.png \
  --output output/final_mockup.png
```

Output is written to:
- `output/final_mockup.png`
- `public/output/final_mockup.png` (served to the dashboard at `/output/final_mockup.png`)

---

## Current Calibrated Values (device_template.png, 1536×1024)

| Device  | X    | Y   | Width | Height | How found                                                        |
|---------|------|-----|-------|--------|------------------------------------------------------------------|
| Desktop | 155  | 150 | 707   | 418    | Visually confirmed via debug overlay                |
| iPad    | 889  | 308 | 298   | 437    | Visually confirmed via debug overlay                |
| iPhone  | 1257 | 470 | 138   | 307    | Visually confirmed via debug overlay                |

Verified visually via `--debug`. Overlay saved at `public/output/debug_final.png`.

---

## Validation Checklist

- [ ] All three screen areas fully filled edge-to-edge
- [ ] No distortion (content is not stretched)
- [ ] No overflow (content stays within device screen bounds)
- [ ] No visible offset or gap at any screen edge
- [ ] Calibrated values table above is updated with new measurements

---

## Screen Dimensions Reference

These are the **content area** dimensions — the area inside the device bezel where screenshots are pasted. They must match the actual pixel-clear rectangular region on the template artwork.

| Device  | Width | Height | Aspect Ratio |
|---------|-------|--------|-------------|
| Desktop | 707   | 418    | ~1.69:1     |
| iPad    | 298   | 437    | ~0.68:1     |
| iPhone  | 138   | 307    | ~0.45:1     |

If the template artwork changes the screen area size, update the WIDTH/HEIGHT in the script to match and re-calibrate X/Y.

---

## Dashboard Integration Note

The final composited image is served at `/output/final_mockup.png` and injected into:

```
.tile-intake-placeholder.tile-intake-placeholder-intake-terminal
```

Handled in `DashboardPage.jsx` via `checkMockupAvailability()` → `intakeMockupSrc` state → `<img className="tile-intake-mockup-image">`.

No dashboard changes are needed when recalibrating the template.
