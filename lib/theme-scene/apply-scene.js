// Pure scene math (contract §9.2). The scene is a set of *deltas over a surface's own params*, so
// Home's scroll interpolation and the inner pages' constants keep working untouched:
//
//   hueOffset  = wrap01(surface.hueOffset + scene.hueShift)
//   saturation = clamp(surface.saturation * scene.saturationMul, 0, 1)
//   lightness  = clamp(surface.lightness + scene.lightnessDelta, 0, 1)
//   opacity    = clamp(surface.opacity * scene.opacityMul, 0, 1)
//   hueSpan    = scene.hueSpan                 (ox.jsx used a hardcoded 0.8)
//
// Everything here is display-space HSL numbers. Nothing touches three.js colour management.

import { clamp, num, wrap01, wrapTurns, hexToRgb01 } from './util.js';

export const DEFAULT_HUE_SPAN = 0.8;

/** Surface defaults used when a caller omits a field (ox.jsx ParticleSwarm defaults). */
const SURFACE_DEFAULTS = Object.freeze({ hueOffset: 0, saturation: 0.85, lightness: 0.5, opacity: 1 });

/** The identity scene: applying it changes nothing. Also the bridge's value before ThemeRuntime has run. */
export const SCENE_IDENTITY = Object.freeze({
  source: 'follow',
  background: '#ffffff',
  hueShift: 0,
  saturationMul: 1,
  lightnessDelta: 0,
  opacityMul: 1,
  hueSpan: DEFAULT_HUE_SPAN,
  highlight: Object.freeze({ srgb: Object.freeze([0, 0.82353, 0.90196]), mix: 0 }),
  swatches: Object.freeze({ base: '#16f3a3', secondary: '#92f316', highlight: '#01d2e6' }),
  wash: 'rgba(245, 241, 223, 0.08)',
});

/**
 * Pure helper (contract §9.2). `scene` may be a ResolvedScene, a driver state (same field names),
 * or null/'off' for "no theme" (identity). `out` is an optional reusable result object so the
 * per-frame caller allocates nothing.
 *
 * @returns {{hueOffset:number, saturation:number, lightness:number, opacity:number, hueSpan:number}}
 */
export function applySceneToParams(surfaceParams, scene, out = {}) {
  const p = surfaceParams || {};
  const s = scene && typeof scene === 'object' ? scene : SCENE_IDENTITY;
  const hueOffset = num(p.hueOffset, SURFACE_DEFAULTS.hueOffset);
  const saturation = num(p.saturation, SURFACE_DEFAULTS.saturation);
  const lightness = num(p.lightness, SURFACE_DEFAULTS.lightness);
  const opacity = num(p.opacity, SURFACE_DEFAULTS.opacity);

  out.hueOffset = wrap01(hueOffset + num(s.hueShift, 0));
  out.saturation = clamp(saturation * num(s.saturationMul, 1), 0, 1);
  out.lightness = clamp(lightness + num(s.lightnessDelta, 0), 0, 1);
  out.opacity = clamp(opacity * num(s.opacityMul, 1), 0, 1);
  out.hueSpan = clamp(num(s.hueSpan, DEFAULT_HUE_SPAN), 0.05, 1);
  return out;
}

/**
 * Normalise any ResolvedScene-ish value (including a malformed one read from localStorage) into the
 * flat numeric record the driver smooths. Never throws; unknown / non-finite fields fall back to the
 * identity values.
 */
export function normalizeSceneTargets(scene, out = {}) {
  const s = scene && typeof scene === 'object' ? scene : SCENE_IDENTITY;
  const hi = s.highlight && typeof s.highlight === 'object' ? s.highlight : SCENE_IDENTITY.highlight;
  const srgb = Array.isArray(hi.srgb) && hi.srgb.length >= 3 ? hi.srgb : SCENE_IDENTITY.highlight.srgb;
  const bg = hexToRgb01(s.background) || hexToRgb01(SCENE_IDENTITY.background);

  out.hueShift = wrapTurns(num(s.hueShift, 0));
  out.saturationMul = clamp(num(s.saturationMul, 1), 0, 4);
  out.lightnessDelta = clamp(num(s.lightnessDelta, 0), -1, 1);
  out.opacityMul = clamp(num(s.opacityMul, 1), 0, 4);
  out.hueSpan = clamp(num(s.hueSpan, DEFAULT_HUE_SPAN), 0.05, 1);
  out.highlightMix = clamp(num(hi.mix, 0), 0, 1);
  out.highlightR = clamp(num(srgb[0], 0), 0, 1);
  out.highlightG = clamp(num(srgb[1], 0), 0, 1);
  out.highlightB = clamp(num(srgb[2], 0), 0, 1);
  out.backgroundR = bg[0];
  out.backgroundG = bg[1];
  out.backgroundB = bg[2];
  return out;
}
