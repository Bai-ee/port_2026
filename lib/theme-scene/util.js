// Tiny pure helpers shared by the scene modules. No dependencies on lib/theme (the scene chunk
// must not pull the authoring engine) and no DOM access.

export const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Finite number or the fallback. */
export const num = (v, fallback) => (isFiniteNumber(v) ? v : fallback);

/** Wrap a hue expressed in turns into [0, 1). 0.44 -> 0.44 exactly (no float drift for in-range input). */
export const wrap01 = (h) => h - Math.floor(h);

/** Wrap a signed turn delta into (-0.5, 0.5]. */
export const wrapTurns = (t) => {
  const w = t - Math.round(t);
  return w <= -0.5 ? w + 1 : w;
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * '#rgb' / '#rrggbb' -> [r, g, b] in 0..1 display space, or null.
 * (Display-space numbers: they are written to the canvas as-is or converted once by
 * Color.setRGB(r, g, b, SRGBColorSpace); see three-bindings.js.)
 */
export function hexToRgb01(hex) {
  if (typeof hex !== 'string') return null;
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
