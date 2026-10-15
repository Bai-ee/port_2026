// Palette combos: named patches over the parametric controls that a designer
// can click to try live in the Studio. Each one is applied with
// applyPalettePreset (lib/theme/edit.js), so custom and locked roles are kept
// and one click is one undo entry. Values are inside the contract §3 ranges.
//
// Baseline for reference: hue 201, intensity 1, offsets 6/86/142, neutral tint
// hue 56 at strength 1, mode settings 0/1, scene follow defaults.

import { resolveTheme, applyPalettePreset } from '../theme/index.js';

export const PALETTE_PRESETS = Object.freeze([
  {
    id: 'baseline', name: 'Signal', note: 'Today’s teal. The production default.',
    patch: { hue: 201, intensity: 1, offsets: { accentBright: 6, support1: 86, support2: 142 }, neutral: { tintStrength: 1, hueSource: 'fixed', hue: 56 }, modes: { light: { lightnessShift: 0, chromaScale: 1 }, dark: { lightnessShift: 0, chromaScale: 1 } } },
  },
  {
    id: 'lava', name: 'Lava', note: 'Hot orange accent, magenta and violet support.',
    patch: { hue: 45, intensity: 1.15, offsets: { accentBright: 10, support1: 300, support2: 250 }, neutral: { tintStrength: 1.2, hueSource: 'fixed', hue: 50 } },
  },
  {
    id: 'moss', name: 'Moss', note: 'Green accent, warm amber and sky support.',
    patch: { hue: 145, intensity: 0.95, offsets: { accentBright: 8, support1: -70, support2: 90 }, neutral: { tintStrength: 1.1, hueSource: 'fixed', hue: 110 } },
  },
  {
    id: 'dusk', name: 'Dusk', note: 'Violet accent with pink and teal support, cool neutrals.',
    patch: { hue: 290, intensity: 1.05, offsets: { accentBright: 12, support1: 50, support2: -90 }, neutral: { tintStrength: 1, hueSource: 'master', hue: 0 } },
  },
  {
    id: 'ember', name: 'Ember', note: 'Red accent, gold and plum support, warm paper.',
    patch: { hue: 25, intensity: 1.1, offsets: { accentBright: 15, support1: 60, support2: 320 }, neutral: { tintStrength: 1.4, hueSource: 'fixed', hue: 60 } },
  },
  {
    id: 'ocean', name: 'Ocean', note: 'Deep blue accent, cyan and indigo support, blue-grey neutrals.',
    patch: { hue: 250, intensity: 1, offsets: { accentBright: -20, support1: -50, support2: 30 }, neutral: { tintStrength: 1.2, hueSource: 'master', hue: 0 } },
  },
  {
    id: 'candy', name: 'Candy', note: 'Pink accent, lime and cyan support. Loud.',
    patch: { hue: 350, intensity: 1, offsets: { accentBright: 10, support1: 130, support2: 210 }, neutral: { tintStrength: 0.9, hueSource: 'fixed', hue: 340 }, modes: { light: { chromaScale: 1 }, dark: { chromaScale: 1.15 } } },
  },
  {
    id: 'sand', name: 'Sand', note: 'Muted gold accent, soft and low-saturation everywhere.',
    patch: { hue: 80, intensity: 0.6, offsets: { accentBright: 5, support1: 40, support2: 160 }, neutral: { tintStrength: 1.6, hueSource: 'fixed', hue: 75 }, modes: { light: { chromaScale: 0.8 }, dark: { chromaScale: 0.8 } } },
  },
  {
    id: 'mono', name: 'Mono ink', note: 'Almost grey. Hue only shows in the scene and focus ring.',
    patch: { hue: 201, intensity: 0.15, offsets: { accentBright: 6, support1: 86, support2: 142 }, neutral: { tintStrength: 0.3, hueSource: 'fixed', hue: 56 }, modes: { light: { chromaScale: 0.5 }, dark: { chromaScale: 0.5 } } },
  },
  {
    id: 'midnight', name: 'Midnight', note: 'Indigo accent, darker dark mode, brighter light mode.',
    patch: { hue: 270, intensity: 1.1, offsets: { accentBright: -15, support1: -80, support2: 120 }, neutral: { tintStrength: 1, hueSource: 'master', hue: 10 }, modes: { light: { lightnessShift: 0.03, chromaScale: 1 }, dark: { lightnessShift: -0.04, chromaScale: 1.05 } } },
  },
]);

export const PRESET_SWATCH_ROLES = Object.freeze(['page', 'accent', 'accent-bright', 'support-1', 'support-2']);

export function getPalettePreset(id) {
  return PALETTE_PRESETS.find((p) => p.id === id) || null;
}

/** Hex values of the five preview roles after applying `preset` to `def`, for one mode. */
export function presetSwatches(def, preset, mode) {
  const resolved = resolveTheme(applyPalettePreset(def, preset), mode);
  return PRESET_SWATCH_ROLES.map((id) => resolved.roles[id].hex);
}

/** Id of the combo whose patch is already fully in effect in `def`, else null. */
export function activePalettePreset(def) {
  if (!def) return null;
  for (const p of PALETTE_PRESETS) if (applyPalettePreset(def, p) === def) return p.id;
  return null;
}
