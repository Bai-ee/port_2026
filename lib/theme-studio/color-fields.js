// Color-field helpers for hex / OKLCH editing and the hue slider track (pure).

import {
  getRoleDef, hexToOklch, oklchToHex, setRoleCustom, gamutMap, formatHex, rgb255ToHsl, hslToSrgb01,
} from '../theme/index.js';
import { isFixedMeaning } from './role-state.js';

/** '#abc', 'abc', ' AABBCC ' -> '#aabbcc'; anything else -> null. No alpha channel. */
export function normalizeHexInput(text) {
  const s = String(text ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s.split('').map((c) => c + c).join('').toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

/**
 * Edit a role from a typed HEX. `current` is the role's resolved {l,c,h,a}.
 * An achromatic result keeps the previous hue (hexToOklch fallbackHue) and the
 * role keeps its alpha. Invalid text returns the same definition.
 */
export function editRoleHex(def, mode, roleId, hexText, current) {
  const hex = normalizeHexInput(hexText);
  if (!hex || !current) return def;
  const o = hexToOklch(hex, current.h);
  if (!o) return def;
  const h = isFixedMeaning(roleId) ? current.h : o.h;
  return setRoleCustom(def, mode, roleId, { l: o.l, c: o.c, h, a: current.a });
}

/** Edit one or more of l/c/h/a of a custom role. Status roles never change hue. */
export function editRoleOklch(def, mode, roleId, patch, current) {
  if (!current || !getRoleDef(roleId)) return def;
  const next = { l: current.l, c: current.c, h: current.h, a: current.a };
  for (const k of ['l', 'c', 'a']) if (Number.isFinite(patch[k])) next[k] = patch[k];
  if (Number.isFinite(patch.h) && !isFixedMeaning(roleId)) next.h = patch.h;
  return setRoleCustom(def, mode, roleId, next);
}

/** Hex of an OKLCH value as it will be displayed (gamut mapped). */
export function oklchHex(o) {
  return oklchToHex({ l: o.l, c: o.c, h: o.h });
}

/** Stops for the hue slider track: the current lightness/chroma at every hue. */
export function hueTrackStops(l, c, steps = 12) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const h = (360 * i) / steps;
    out.push({ h, pct: (100 * i) / steps, hex: oklchToHex({ l, c, h }) });
  }
  return out;
}

export function hueTrackGradient(l, c, steps = 12) {
  const stops = hueTrackStops(l, c, steps).map((s) => `${s.hex} ${Math.round(s.pct * 100) / 100}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Track for a chroma / lightness slider at a fixed hue (same idea, one axis). */
export function axisTrackGradient(axis, { l, c, h }, steps = 8) {
  const stops = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const o = axis === 'l' ? { l: t, c, h } : axis === 'c' ? { l, c: 0.4 * t, h } : { l, c, h: 360 * t };
    stops.push(`${oklchToHex(o)} ${Math.round(t * 10000) / 100}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Studio v2 / P2: direct colour editing (ColorPicker). Additive; every
// conversion goes through lib/theme/color.js, nothing here is new maths.
// ---------------------------------------------------------------------------

/** Hard bounds (the only ones validation enforces). */
export const HARD_BOUNDS = Object.freeze({ l: [0, 1], c: [0, 0.4], h: [0, 360] });

/** A gamut-mapped colour counts as "gamut-mapped" for the tag beyond this OKLab distance. */
export const GAMUT_TAG_DELTA = 0.02;

/**
 * Slider / pad bounds. Both modes use the hard bounds; "Full range" additionally
 * hides the advisory per-role range warnings (`warn` false).
 */
export function sliderBounds(fullRange) {
  return { l: HARD_BOUNDS.l, c: HARD_BOUNDS.c, h: HARD_BOUNDS.h, warn: !fullRange };
}

const byte = (n) => Math.min(255, Math.max(0, Math.round(n)));

/** [r,g,b] 8-bit, gamut mapped. */
export function oklchToRgb(o) {
  return [...gamutMap({ l: o.l, c: o.c, h: o.h }).rgb255];
}

export function rgbToOklch(rgb, fallbackHue = 0) {
  const [r, g, b] = rgb;
  return hexToOklch(formatHex({ r: byte(r), g: byte(g), b: byte(b) }), fallbackHue);
}

/** { h: degrees, s: percent, l: percent } of the displayed (gamut mapped) colour. */
export function oklchToHsl(o) {
  const { h, s, l } = rgb255ToHsl(oklchToRgb(o));
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** HSL (degrees / percent) -> OKLCH. An achromatic result keeps `fallbackHue`. */
export function hslToOklch({ h, s, l }, fallbackHue = 0) {
  const rgb = hslToSrgb01({ h: h / 360, s: s / 100, l: l / 100 }).map((v) => v * 255);
  return rgbToOklch(rgb, fallbackHue);
}

const NUM = '(-?\\d*\\.?\\d+)';

/** 'rgb(1, 2, 3)', '1 2 3', '1,2,3' -> [r,g,b] (0..255) or null. */
export function parseRgbText(text) {
  const m = new RegExp(`^\\s*(?:rgba?\\()?\\s*${NUM}[\\s,]+${NUM}[\\s,]+${NUM}\\s*(?:[,/]\\s*[\\d.]+%?\\s*)?\\)?\\s*$`, 'i').exec(String(text ?? ''));
  if (!m) return null;
  const v = [m[1], m[2], m[3]].map(Number);
  return v.every((n) => Number.isFinite(n) && n >= 0 && n <= 255) ? v.map(byte) : null;
}

/** 'hsl(210, 50%, 40%)', '210 50 40' -> { h, s, l } or null. */
export function parseHslText(text) {
  const m = new RegExp(`^\\s*(?:hsla?\\()?\\s*${NUM}(?:deg)?[\\s,]+${NUM}%?[\\s,]+${NUM}%?\\s*(?:[,/]\\s*[\\d.]+%?\\s*)?\\)?\\s*$`, 'i').exec(String(text ?? ''));
  if (!m) return null;
  const h = ((Number(m[1]) % 360) + 360) % 360;
  const s = Number(m[2]);
  const l = Number(m[3]);
  if (![h, s, l].every(Number.isFinite) || s < 0 || s > 100 || l < 0 || l > 100) return null;
  return { h, s, l };
}

/** Any pasted colour text (hex, rgb(), hsl()) -> '#rrggbb', or null. */
export function parseColorPaste(text) {
  const hex = normalizeHexInput(text);
  if (hex) return hex;
  const t = String(text ?? '');
  if (/^\s*hsla?\(/i.test(t)) {
    const hsl = parseHslText(t);
    return hsl ? oklchToHex(hslToOklch(hsl)) : null;
  }
  if (/^\s*rgba?\(/i.test(t)) {
    const rgb = parseRgbText(t);
    return rgb ? formatHex({ r: rgb[0], g: rgb[1], b: rgb[2] }) : null;
  }
  return null;
}

/**
 * Is the displayed colour visibly different from the authored OKLCH (gamut
 * mapped by more than ΔEOK 0.02)? Chroma above sRGB is allowed, this is only a tag.
 */
export function colorGamutInfo(o) {
  const g = gamutMap({ l: o.l, c: o.c, h: o.h });
  return { mapped: g.deltaE > GAMUT_TAG_DELTA, deltaE: g.deltaE };
}

/** Advisory (never blocking) range findings for one role value, [] when inside. */
export function advisoryIssues(roleId, mode, o) {
  const rd = getRoleDef(roleId);
  if (!rd || !o) return [];
  const rg = rd.ranges[mode];
  const TOL = 0.00006;
  const out = [];
  for (const field of ['l', 'c']) {
    const [min, max] = rg[field];
    if (o[field] < min - TOL || o[field] > max + TOL) out.push({ field, value: o[field], min, max });
  }
  return out;
}

/** Pad position (0..1 each, origin top-left) <-> lightness x chroma. */
export function padToLc({ x, y }, bounds = HARD_BOUNDS) {
  const cx = Math.min(1, Math.max(0, x));
  const cy = Math.min(1, Math.max(0, y));
  return { c: bounds.c[0] + cx * (bounds.c[1] - bounds.c[0]), l: bounds.l[1] - cy * (bounds.l[1] - bounds.l[0]) };
}
export function lcToPad({ l, c }, bounds = HARD_BOUNDS) {
  return {
    x: (c - bounds.c[0]) / (bounds.c[1] - bounds.c[0]),
    y: (bounds.l[1] - l) / (bounds.l[1] - bounds.l[0]),
  };
}

/**
 * Picker edits. A LINKED role becomes custom as part of the same updater, so a
 * single edit-session gesture (drag or discrete set) is one undo entry. A LOCKED
 * role is never changed (the picker is read-only for it).
 */
export function pickerEditOklch(def, mode, roleId, patch, current) {
  if (def.modes[mode]?.roles[roleId]?.locked) return def;
  return editRoleOklch(def, mode, roleId, patch, def.modes[mode].roles[roleId].custom || current);
}

export function pickerEditHex(def, mode, roleId, hexText, current) {
  if (def.modes[mode]?.roles[roleId]?.locked) return def;
  return editRoleHex(def, mode, roleId, hexText, def.modes[mode].roles[roleId].custom || current);
}

/** Rows of the L x C pad: one horizontal chroma gradient per lightness step, at hue h. */
export function padRowGradients(h, rows = 24, stops = 9) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const l = 1 - (r + 0.5) / rows;
    const parts = [];
    for (let i = 0; i < stops; i++) {
      const t = i / (stops - 1);
      parts.push(`${oklchToHex({ l, c: HARD_BOUNDS.c[1] * t, h })} ${Math.round(t * 10000) / 100}%`);
    }
    out.push(`linear-gradient(to right, ${parts.join(', ')})`);
  }
  return out;
}
