// Background-image fit math — CSS `background-size` semantics for three.js
// `scene.background`, which otherwise stretches a Texture to the canvas and
// skews any aspect-ratio mismatch. Pure math (same standalone-module tier
// as diffusion-focus.js) so the exact transforms the render loop and the
// contain-bake apply are unit-testable without a WebGL context.

const clampShift = (v) => Math.min(1, Math.max(-1, Number.isFinite(v) ? v : 0));

/**
 * `background-size: cover` — the image always covers the full canvas, never
 * stretched; the overflowing axis is cropped. `shiftY` (-1..1, default 0 =
 * centered) slides the visible window along the image's VERTICAL slack:
 * +1 pins the window to the image's top, -1 to its bottom. When the crop
 * falls on the horizontal axis instead (image proportionally wider than the
 * canvas) there is no vertical slack and shiftY honestly does nothing.
 * Returned as texture repeat/offset (three.js UV space, v=1 = image top for
 * a DOM-image texture).
 */
export function computeBackgroundCover(imageAspect, canvasAspect, shiftY = 0) {
  const img = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  const cnv = Number.isFinite(canvasAspect) && canvasAspect > 0 ? canvasAspect : 1;
  if (img > cnv) {
    // Image proportionally wider — full height shows, width crops centered.
    const rx = cnv / img;
    return { repeatX: rx, repeatY: 1, offsetX: (1 - rx) / 2, offsetY: 0 };
  }
  // Image proportionally taller (or equal) — full width, height crops; the
  // slack [0, 1-ry] is where shiftY slides the window.
  const ry = img / cnv;
  const slack = 1 - ry;
  return { repeatX: 1, repeatY: ry, offsetX: 0, offsetY: (slack / 2) * (1 + clampShift(shiftY)) };
}

/**
 * `background-size: contain` — the WHOLE image always shows, letterboxed
 * inside the canvas (the bake fills the bars with the background color).
 * Returns the image's draw rect in unit canvas space ({x,y,w,h}, y=0 = TOP,
 * canvas-2D convention — this feeds a canvas bake, not a UV transform).
 * `shiftY` (+1 = slide the image to the top of the canvas, -1 = bottom)
 * moves the image within the vertical letterbox slack; when the bars fall
 * on the sides instead there is no vertical slack and it does nothing.
 */
export function computeContainLayout(imageAspect, canvasAspect, shiftY = 0) {
  const img = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  const cnv = Number.isFinite(canvasAspect) && canvasAspect > 0 ? canvasAspect : 1;
  if (img > cnv) {
    // Image proportionally wider — full width, bars above/below.
    const h = cnv / img;
    const slack = 1 - h;
    return { x: 0, y: (slack / 2) * (1 - clampShift(shiftY)), w: 1, h };
  }
  // Image proportionally taller (or equal) — full height, bars at the sides.
  const w = img / cnv;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}
