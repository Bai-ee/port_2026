// Color-field helpers for hex / OKLCH editing and the hue slider track (pure).

import {
  getRoleDef, hexToOklch, oklchToHex, setRoleCustom,
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
