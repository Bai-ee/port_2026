// Colour-harmony generator for the Palette combos section. Pure: no DOM, no
// storage, no Math.random. Every function returns a palette-preset-shaped patch
// ({ hue, intensity?, offsets, neutral? }) that is applied with applyPalettePreset
// (lib/theme/edit.js). That function only touches master hue, intensity, offsets
// and neutral tint, never individual roles, so custom and locked roles are kept.
//
// Offsets are degrees added to the master hue, stored in the contract range
// -180..180 (270 deg is written as -90). Modulo 360 they are always distinct.

import { createBaseline } from '../theme/index.js';

const wrap360 = (h) => ((h % 360) + 360) % 360;
const wrap180 = (h) => { const w = wrap360(h); return w > 180 ? w - 360 : w; };
const round = (n, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const fin = (n) => typeof n === 'number' && Number.isFinite(n);

/** Harmony id -> support offsets from the accent hue. accentBright is the small nudge every combo uses. */
export const HARMONIES = Object.freeze([
  { id: 'complementary', name: 'Complementary', note: 'Support 1 opposite the accent, support 2 beside it.', support1: 180, support2: 150 },
  { id: 'split-complementary', name: 'Split complementary', note: 'Both supports flank the opposite hue.', support1: 150, support2: -150 },
  { id: 'triad', name: 'Triad', note: 'Three hues evenly spaced.', support1: 120, support2: -120 },
  { id: 'analogous', name: 'Analogous', note: 'Neighbouring hues. Calm.', support1: 30, support2: -30 },
  { id: 'monochrome', name: 'Monochrome', note: 'Supports hug the accent hue.', support1: 14, support2: -14 },
]);

export function getHarmony(id) {
  return HARMONIES.find((h) => h.id === id) || null;
}

// Small deterministic PRNG (mulberry32). Same seed, same sequence.
function rng(seed) {
  let a = (Number.isFinite(seed) ? Math.trunc(seed) : 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function masterHueOf(definition) {
  return fin(definition?.master?.hue) ? definition.master.hue : createBaseline().master.hue;
}

/**
 * Patch for one harmony. seedHue defaults to the draft's master hue; with no
 * seedHue but a numeric `seed`, the hue is derived from the seed.
 */
export function buildHarmonyPatch(definition, { harmony = 'triad', seedHue, seed } = {}) {
  const h = getHarmony(harmony) || getHarmony('triad');
  let hue;
  if (fin(seedHue)) hue = seedHue;
  else if (fin(seed)) hue = rng(seed)() * 360;
  else hue = masterHueOf(definition);
  return {
    hue: round(wrap360(hue), 1),
    offsets: { accentBright: 8, support1: h.support1, support2: h.support2 },
  };
}

/**
 * Deterministic, tasteful random combo. `locks` ({ hue, offsets, neutral,
 * intensity }) keeps those parts of the current draft out of the patch.
 */
export function shufflePatch(definition, { seed = 1, locks = {} } = {}) {
  const r = rng(seed);
  const hue = round(r() * 360, 0);
  // Skip monochrome most of the time: a shuffle should look like a palette.
  const pool = HARMONIES.filter((h) => h.id !== 'monochrome');
  const harmony = r() < 0.08 ? getHarmony('monochrome') : pool[Math.floor(r() * pool.length)];
  const jitter = () => round((r() - 0.5) * 16, 0);
  const patch = {};
  if (!locks.hue) patch.hue = hue;
  if (!locks.offsets) {
    patch.offsets = {
      accentBright: round(4 + r() * 12, 0),
      support1: round(wrap180(harmony.support1 + jitter()), 0),
      support2: round(wrap180(harmony.support2 + jitter()), 0),
    };
    if (patch.offsets.support1 === patch.offsets.support2) patch.offsets.support2 = wrap180(patch.offsets.support2 + 12);
  } else {
    r(); r(); r(); // keep later draws stable whether or not offsets are locked
  }
  if (!locks.neutral) {
    const accentHue = fin(patch.hue) ? patch.hue : masterHueOf(definition);
    const towardComplement = r() < 0.35;
    const tintHue = wrap360(accentHue + (towardComplement ? 180 : 0) + (r() - 0.5) * 50);
    patch.neutral = { hueSource: 'fixed', hue: round(tintHue, 0), tintStrength: round(0.8 + r() * 0.6, 2) };
  }
  if (!locks.intensity) patch.intensity = round(0.8 + r() * 0.4, 2);
  return patch;
}
