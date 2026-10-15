// Scene palette (contract §9.1). Both models are *deltas over the surface's own
// params* (so Home's scroll interpolation keeps working):
//   follow: hueShift = wrapTurns((master.hue - 201)/360 + follow.hueShiftDeg/360)
//   custom: the custom base colour is converted to HSL and compared with the
//           inner-page reference params (SCENE_REFERENCE).
// All values are display-space numbers; nothing here touches colour management.

import { BASELINE_MASTER_HUE } from './constants.js';
import { gamutMap, rgb255ToHsl, hslToSrgb01, formatHex, wrapTurns } from './color.js';
import { round, clamp } from './util.js';

export const SCENE_REFERENCE = Object.freeze({ hue: 0.44, saturation: 0.9, lightness: 0.52 });

const r5 = (x) => round(x, 5);

function hslHex(h, s, l) {
  const [r, g, b] = hslToSrgb01({ h, s: clamp(s, 0, 1), l: clamp(l, 0, 1) });
  return formatHex({ r: r * 255, g: g * 255, b: b * 255 });
}

function rgbTriplet01([r, g, b]) {
  return [r5(r / 255), r5(g / 255), r5(b / 255)];
}

function mapOklch(o) {
  const m = gamutMap(o);
  return { rgb: m.rgb255, hex: formatHex({ r: m.rgb255[0], g: m.rgb255[1], b: m.rgb255[2] }) };
}

/**
 * @param definition  canonical definition
 * @param mode        'light' | 'dark'
 * @param resolvedRoles  ResolvedTheme.roles (page, accent-bright, scene-wash are read; optional)
 */
export function resolveScene(definition, mode, resolvedRoles) {
  const sc = definition.scene[mode];
  const roles = resolvedRoles || {};
  const pageHex = roles.page ? roles.page.hex : '#ffffff';
  const wash = roles['scene-wash'] ? roles['scene-wash'].value : 'rgba(245, 241, 223, 0.08)';
  const brightRgb = roles['accent-bright'] ? roles['accent-bright'].rgba.slice(0, 3) : [0, 210, 230];
  const brightHex = roles['accent-bright'] ? roles['accent-bright'].hex : formatHex({ r: brightRgb[0], g: brightRgb[1], b: brightRgb[2] });

  if (sc.source === 'custom') {
    const c = sc.custom;
    const base = mapOklch(c.base);
    const hsl = rgb255ToHsl(base.rgb);
    let hueSpan = 0.8;
    let secondaryHex;
    if (c.secondary) {
      const sec = mapOklch(c.secondary);
      const h2 = rgb255ToHsl(sec.rgb).h;
      hueSpan = clamp((((h2 - hsl.h) % 1) + 1) % 1, 0.05, 1);
      secondaryHex = sec.hex;
    } else {
      secondaryHex = hslHex(hsl.h + hueSpan, hsl.s, hsl.l);
    }
    const hi = mapOklch(c.highlight);
    return {
      source: 'custom',
      background: pageHex,
      hueShift: r5(wrapTurns(hsl.h - SCENE_REFERENCE.hue)),
      saturationMul: r5(hsl.s / SCENE_REFERENCE.saturation),
      lightnessDelta: r5(hsl.l - SCENE_REFERENCE.lightness),
      opacityMul: r5(c.opacityMul),
      hueSpan: r5(hueSpan),
      highlight: { srgb: rgbTriplet01(hi.rgb), mix: r5(c.highlightStrength) },
      swatches: { base: base.hex, secondary: secondaryHex, highlight: hi.hex },
      wash,
    };
  }

  const f = sc.follow;
  const hueShift = wrapTurns((definition.master.hue - BASELINE_MASTER_HUE) / 360 + f.hueShiftDeg / 360);
  const s = SCENE_REFERENCE.saturation * f.saturationMul;
  const l = SCENE_REFERENCE.lightness + f.lightnessDelta;
  const hue0 = SCENE_REFERENCE.hue + hueShift;
  return {
    source: 'follow',
    background: pageHex,
    hueShift: r5(hueShift),
    saturationMul: r5(f.saturationMul),
    lightnessDelta: r5(f.lightnessDelta),
    opacityMul: r5(f.opacityMul),
    hueSpan: r5(f.hueSpan),
    highlight: { srgb: rgbTriplet01(brightRgb), mix: 0 },
    swatches: {
      base: hslHex(hue0, s, l),
      secondary: hslHex(hue0 + f.hueSpan, s, l),
      highlight: brightHex,
    },
    wash,
  };
}
