// Parse the colour strings that `readToken('--t-…')` returns ('#rrggbb', '#rgb' or
// 'rgba(r, g, b, a)') into an "r, g, b" triplet for canvas 2D strokes. Pure.

const RGB_RE = /^rgba?\(\s*(-?[0-9.]+)\s*[, ]\s*(-?[0-9.]+)\s*[, ]\s*(-?[0-9.]+)/i;

/** @returns {string|null} "r, g, b" with integer channels, or null when the value is not understood. */
export function cssColorToRgbTriplet(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (v[0] === '#') {
    const raw = v.slice(1);
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return null;
    const n = parseInt(full.slice(0, 6), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const m = RGB_RE.exec(v);
  if (!m) return null;
  const ch = (s) => Math.min(255, Math.max(0, Math.round(parseFloat(s))));
  return `${ch(m[1])}, ${ch(m[2])}, ${ch(m[3])}`;
}
