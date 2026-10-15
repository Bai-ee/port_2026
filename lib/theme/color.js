// Colour math (contract §6). No dependencies. Björn Ottosson OKLab constants.
//
// Conventions
//   - sRGB channels are 0..255 numbers in the "rgb255" shapes and 0..1 in
//     "linear" / "srgb01" shapes.
//   - OKLab = { l, a, b }, OKLCH = { l, c, h } (h in degrees, [0,360)).
//   - Achromatic colours (c < ACHROMATIC) take their hue from the caller.

export const ACHROMATIC = 1e-4;
const GAMUT_EPS = 1e-6;
const JND = 0.02;
const GAMUT_ITER_EPS = 0.0001;

// ---------- small numeric helpers ----------

export function wrapHue(h) {
  if (h >= 0 && h < 360) return h === 0 ? 0 : h; // exact for in-range values (no float drift)
  const x = ((h % 360) + 360) % 360;
  return x === 0 ? 0 : x; // normalise -0
}

/** Shortest signed distance from hue a to hue b, in (-180, 180]. */
export function hueDelta(a, b) {
  let d = wrapHue(b - a);
  if (d > 180) d -= 360;
  return d;
}

/** Wrap a turns value to (-0.5, 0.5]. */
export function wrapTurns(t) {
  let x = t - Math.floor(t); // [0,1)
  if (x > 0.5) x -= 1;
  return x === 0 ? 0 : x;
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const toRad = Math.PI / 180;
const toDeg = 180 / Math.PI;

// ---------- hex / rgba strings ----------

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa. Returns {r,g,b,a} (0..255, a 0..1) or null. */
export function parseHex(str) {
  if (typeof str !== 'string') return null;
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(str.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = h.split('').map((ch) => ch + ch).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function to8(n) {
  const v = Math.round(n);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function hex2(n) {
  return to8(n).toString(16).padStart(2, '0');
}

export function formatHex({ r, g, b }) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Alpha trimmed to <= 3 dp, no trailing zeros ("0.5", "1", "0.082"). */
export function formatAlpha(a) {
  const v = Math.round(clamp01(Number.isFinite(a) ? a : 1) * 1000) / 1000;
  return String(v === 0 ? 0 : v);
}

export function formatRgba({ r, g, b, a }) {
  return `rgba(${to8(r)}, ${to8(g)}, ${to8(b)}, ${formatAlpha(a)})`;
}

// ---------- sRGB <-> linear ----------

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ---------- linear sRGB <-> OKLab ----------

export function linearSrgbToOklab({ r, g, b }) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToLinearSrgb({ l: L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

// ---------- OKLab <-> OKLCH ----------

export function oklchToOklab({ l, c, h }) {
  const hr = h * toRad;
  return { l, a: c * Math.cos(hr), b: c * Math.sin(hr) };
}

export function oklabToOklch({ l, a, b }, fallbackHue = 0) {
  const c = Math.hypot(a, b);
  const h = c < ACHROMATIC ? fallbackHue : wrapHue(Math.atan2(b, a) * toDeg);
  return { l, c, h };
}

/** Euclidean distance in OKLab. Accepts OKLab ({l,a,b}) or OKLCH ({l,c,h}) operands. */
export function deltaEOK(p, q) {
  const isLch = (o) => 'c' in o && 'h' in o; // an OKLCH operand may also carry an alpha `a`
  const A = isLch(p) ? oklchToOklab(p) : p;
  const B = isLch(q) ? oklchToOklab(q) : q;
  return Math.hypot(A.l - B.l, A.a - B.a, A.b - B.b);
}

// ---------- hex <-> OKLCH ----------

export function hexToOklch(hex, fallbackHue = 0) {
  const p = parseHex(hex);
  if (!p) return null;
  const lab = linearSrgbToOklab({
    r: srgbToLinear(p.r / 255),
    g: srgbToLinear(p.g / 255),
    b: srgbToLinear(p.b / 255),
  });
  return oklabToOklch(lab, fallbackHue);
}

function oklchToLinear(o) {
  return oklabToLinearSrgb(oklchToOklab(o));
}

function inGamutLinear(lin) {
  return (
    lin.r >= -GAMUT_EPS && lin.r <= 1 + GAMUT_EPS &&
    lin.g >= -GAMUT_EPS && lin.g <= 1 + GAMUT_EPS &&
    lin.b >= -GAMUT_EPS && lin.b <= 1 + GAMUT_EPS
  );
}

/** Unmapped conversion; r,g,b are 0..255 floats and may fall outside the range. */
export function oklchToRgb255(o) {
  const lin = oklchToLinear(o);
  return {
    r: linearToSrgb(lin.r) * 255,
    g: linearToSrgb(lin.g) * 255,
    b: linearToSrgb(lin.b) * 255,
    inGamut: inGamutLinear(lin),
  };
}

function clipLinear(lin) {
  return { r: clamp01(lin.r), g: clamp01(lin.g), b: clamp01(lin.b) };
}

function sanitizeOklch(o) {
  const l = Number.isFinite(o?.l) ? o.l : 0;
  const c = Number.isFinite(o?.c) && o.c > 0 ? o.c : 0;
  const h = Number.isFinite(o?.h) ? wrapHue(o.h) : 0;
  return { l, c, h };
}

function encode8(lin) {
  return [
    to8(linearToSrgb(clamp01(lin.r)) * 255),
    to8(linearToSrgb(clamp01(lin.g)) * 255),
    to8(linearToSrgb(clamp01(lin.b)) * 255),
  ];
}

/**
 * CSS Color Module 4 §13.2 gamut mapping (OKLCH chroma reduction with the
 * delta-E-OK clip test). Returns
 *   { oklch (mapped, continuous), rgb255:[r,g,b] (rounded 8-bit), mapped, deltaE }
 * `deltaE` is the OKLab distance between the input and the mapped colour (0 when
 * the input was already in gamut).
 */
export function gamutMap(input) {
  const origin = sanitizeOklch(input);
  if (origin.l >= 1 || origin.l <= 0) {
    // lightness at/over the ends is pure white / black whatever the chroma
    const white = origin.l >= 1;
    const end = { l: white ? 1 : 0, c: 0, h: origin.h };
    const moved = origin.l > 1 || origin.l < 0 || origin.c > ACHROMATIC;
    return {
      oklch: end,
      rgb255: white ? [255, 255, 255] : [0, 0, 0],
      mapped: moved,
      deltaE: moved ? deltaEOK(origin, end) : 0,
      candidate: end,
    };
  }

  const originLin = oklchToLinear(origin);
  if (inGamutLinear(originLin)) {
    return { oklch: origin, rgb255: encode8(originLin), mapped: false, deltaE: 0, candidate: origin };
  }

  let clipped = clipLinear(originLin);
  const clippedLab = () => linearSrgbToOklab(clipped);
  let E = deltaEOK(clippedLab(), oklchToOklab(origin));
  if (E < JND) {
    return finish(clipped, origin, origin);
  }

  let lastCandidate = origin;
  let min = 0;
  let max = origin.c;
  let minInGamut = true;
  while (max - min > GAMUT_ITER_EPS) {
    const chroma = (min + max) / 2;
    const cur = { l: origin.l, c: chroma, h: origin.h };
    const curLin = oklchToLinear(cur);
    if (minInGamut && inGamutLinear(curLin)) {
      min = chroma;
      continue;
    }
    clipped = clipLinear(curLin);
    lastCandidate = cur;
    E = deltaEOK(linearSrgbToOklab(clipped), oklchToOklab(cur));
    if (E < JND) {
      if (JND - E < GAMUT_ITER_EPS) return finish(clipped, origin, cur);
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return finish(clipped, origin, lastCandidate);
}

function finish(clippedLin, origin, candidate) {
  const lab = linearSrgbToOklab(clippedLin);
  const mapped = oklabToOklch(lab, origin.h);
  return {
    oklch: mapped,
    rgb255: encode8(clippedLin),
    mapped: true,
    deltaE: deltaEOK(lab, oklchToOklab(origin)),
    candidate,
  };
}

/** Gamut-mapped '#rrggbb'. */
export function oklchToHex(o) {
  const [r, g, b] = gamutMap(o).rgb255;
  return formatHex({ r, g, b });
}

/** Convert 8-bit sRGB to HSL ({h,s,l} all 0..1; h in turns). */
export function rgb255ToHsl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
    else if (max === G) h = ((B - R) / d + 2) / 6;
    else h = ((R - G) / d + 4) / 6;
  }
  return { h, s, l };
}

/** HSL (all 0..1, h in turns) to sRGB 0..1 floats. Matches THREE.Color.setHSL's raw numbers. */
export function hslToSrgb01({ h, s, l }) {
  const hue = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let x = ((t % 1) + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * 6 * (2 / 3 - x);
    return p;
  };
  if (s === 0) return [l, l, l];
  return [f(hue + 1 / 3), f(hue), f(hue - 1 / 3)];
}
