// WCAG 2.x contrast (contract §6.3).
// Alpha is composited in gamma-encoded sRGB, per channel, rounded to 8-bit, which
// matches browser blending. Evaluate AFTER gamut mapping (inputs are 8-bit).

import { parseHex } from './color.js';

function toRgba(x) {
  if (typeof x === 'string') {
    const p = parseHex(x);
    if (!p) throw new Error(`contrast: invalid colour "${x}"`);
    return p;
  }
  return { r: x.r, g: x.g, b: x.b, a: x.a === undefined ? 1 : x.a };
}

const to8 = (n) => {
  const v = Math.round(n);
  return v < 0 ? 0 : v > 255 ? 255 : v;
};

export function relativeLuminance(c) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Composite fg over bg (both {r,g,b,a}); channels rounded to 8-bit. */
export function composite(fgIn, bgIn) {
  const fg = toRgba(fgIn);
  const bg = toRgba(bgIn);
  const fa = fg.a;
  const ba = bg.a;
  const oa = fa + ba * (1 - fa);
  if (oa <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (f, b) => to8((fa * f + ba * (1 - fa) * b) / oa);
  return { r: ch(fg.r, bg.r), g: ch(fg.g, bg.g), b: ch(fg.b, bg.b), a: oa };
}

/**
 * Contrast ratio of fg on bg. Operands may be hex strings or {r,g,b,a}.
 * A translucent fg is composited over bg first; bg must be (or is treated as) opaque.
 */
export function contrastRatio(fgIn, bgIn) {
  const bg = toRgba(bgIn);
  const fg = toRgba(fgIn);
  const solidBg = bg.a < 1 ? composite(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
  const solidFg = fg.a < 1 ? composite(fg, solidBg) : fg;
  const l1 = relativeLuminance(solidFg);
  const l2 = relativeLuminance(solidBg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
