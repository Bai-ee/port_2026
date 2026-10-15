// Baseline preset (contract §12). Reproduces today's light look (values derived
// from the real legacy colours; see __tests__/baseline-parity.test.js) and ships
// new, authored dark palettes. The table below is data: [id, light, dark].
//
// state shorthands
//   A(l, c, a)                 auto: authored base, hue/scale from the role rule
//   K(to, {dL,dC,dH,a,mode})   link to another role's final value
//   U(l, c, h, a)              custom override (exact value, ignores master)

import { SCHEMA_ID, SCHEMA_VERSION, BASELINE_MASTER_HUE } from './constants.js';
import { ROLE_IDS } from './roles.js';

const A = (l, c, a = 1) => ({ t: 'auto', l, c, a });
const K = (to, o = {}) => ({ t: 'link', to, ...o });
const U = (l, c, h, a = 1) => ({ t: 'custom', l, c, h, a });

// Terminal semantic lines: light (pfx l,c) (msg l,c); dark = l .78/.84, c x 0.8.
const TERM = [
  ['info', [0.5226, 0.0419], [0.4461, 0.0263]],
  ['fetch', [0.5383, 0.0903], [0.4863, 0.0756]],
  ['ok', [0.5299, 0.1298], [0.5066, 0.1103]],
  ['ai', [0.5177, 0.1797], [0.4726, 0.1585]],
  ['build', [0.6158, 0.122], [0.5372, 0.1058]],
  ['error', [0.5433, 0.174], [0.4937, 0.1561]],
  ['active', [0.5741, 0.2015], [0.3035, 0.0332]],
  ['screen', [0.5036, 0.1613], [0.379, 0.0847]],
  ['mock', [0.6213, 0.1333], [0.5443, 0.1235]],
  ['countdown', [0.6158, 0.122], [0.5372, 0.1058]],
];
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// Comet stops (light = dark) and hero tint blobs (dark = light l - 0.06).
const COMET = [
  [0.8656, 0.1424], [0.7602, 0.1433], [0.6081, 0.2114], [0.5734, 0.2427],
  [0.6459, 0.2478], [0.7465, 0.2637], [0.8123, 0.1186],
];
const DECO = [[0.6539, 0.1042], [0.7246, 0.0863], [0.8089, 0.0909], [0.713, 0.1028]];

const TABLE = [
  // ---- surfaces ----
  ['page', A(1, 0), A(0.165, 0.008)],
  ['surface', A(1, 0), A(0.205, 0.009)],
  ['raised', A(0.9937, 0.0054), A(0.245, 0.01)],
  ['inset', A(0.9759, 0.0013), A(0.135, 0.006)],
  ['overlay', A(0.1928, 0.0051, 0.42), A(0.08, 0.004, 0.62)],
  ['chrome', A(0.9564, 0.0241, 0.55), A(0.22, 0.012, 0.6)],
  ['chrome-strong', K('chrome', { a: 0.85 }), K('chrome', { a: 0.85 })],
  ['glass-soft', K('surface', { a: 0.5 }), K('surface', { dL: 0.04, a: 0.5 })],
  ['glass', K('surface', { a: 0.62 }), K('surface', { dL: 0.04, a: 0.62 })],
  ['glass-strong', K('surface', { a: 0.78 }), K('surface', { dL: 0.04, a: 0.78 })],
  ['glass-border', A(0.8269, 0.0384, 0.82), A(0.42, 0.02, 0.5)],
  ['glass-highlight', A(1, 0, 0.45), A(0.95, 0, 0.1)],
  ['scrim', K('page', { a: 0 }), K('page', { a: 0.55 })],
  // ---- text and borders ----
  ['text-default', A(0, 0), A(0.93, 0.01)],
  ['text-strong', A(0.1448, 0), A(0.975, 0.004)],
  ['text-body', A(0.2178, 0), A(0.9, 0.006)],
  ['text', A(0.2656, 0.0117), A(0.93, 0.01)],
  ['text-secondary', K('text', { a: 0.72 }), K('text', { a: 0.72 })],
  ['text-muted', K('text', { a: 0.52 }), K('text', { a: 0.58 })],
  ['text-faint', K('text', { a: 0.38 }), K('text', { a: 0.5 })],
  ['text-eyebrow', A(0.445, 0.0225), A(0.72, 0.014)],
  ['text-inverse', A(0.9771, 0.0074), A(0.2, 0.008)],
  ['on-overlay', A(0.9771, 0.0074), A(0.95, 0.006)],
  ['on-accent', A(0.1448, 0.006), A(0.18, 0.01)],
  ['on-solid', A(1, 0), A(0.15, 0.01)],
  ['text-disabled', K('text', { a: 0.3 }), K('text', { a: 0.3 })],
  ['accent-text', A(0.5, 0.105), A(0.8, 0.12)],
  ['border-faint', K('text', { a: 0.08 }), K('text', { a: 0.1 })],
  ['border-subtle', K('text', { a: 0.12 }), K('text', { a: 0.14 })],
  ['control-border', K('text', { a: 0.22 }), K('text', { a: 0.38 })],
  ['control-border-strong', K('text', { a: 0.55 }), K('text', { a: 0.62 })],
  ['focus', A(0.52, 0.11), A(0.8, 0.12)],
  // ---- accent and supporting ----
  ['accent', A(0.6799, 0.1156), A(0.76, 0.12)],
  ['accent-hover', K('accent', { dL: -0.05 }), K('accent', { dL: 0.05 })],
  ['accent-pressed', K('accent', { dL: -0.09 }), K('accent', { dL: 0.09 })],
  ['accent-soft', K('accent', { a: 0.1 }), K('accent', { a: 0.16 })],
  ['accent-soft-border', K('accent', { a: 0.25 }), K('accent', { a: 0.35 })],
  ['accent-bright', A(0.7894, 0.1353), A(0.8, 0.135)],
  ['support-1', A(0.5199, 0.286), A(0.7, 0.2)],
  ['support-2', A(0.6703, 0.2877), A(0.74, 0.22)],
  ['selection-bg', K('accent', { a: 0.25 }), K('accent', { a: 0.35 })],
  ['selection-fg', K('text'), K('text')],
  // ---- decorative ----
  ...COMET.map(([l, c], i) => [`comet-${i + 1}`, A(l, c), A(l, c)]),
  ...DECO.map(([l, c], i) => [`deco-${i + 1}`, A(l, c), A(r4(l - 0.06), c)]),
  // ---- status ----
  ['success', A(0.4379, 0.0835), A(0.78, 0.14)],
  ['success-bg', K('success', { a: 0.1 }), K('success', { a: 0.16 })],
  ['success-border', K('success', { a: 0.25 }), K('success', { a: 0.35 })],
  ['success-solid', A(0.6299, 0.1279), A(0.7, 0.14)],
  ['warning', A(0.4566, 0.0428), A(0.8, 0.1)],
  ['warning-bg', K('warning', { a: 0.12 }), K('warning', { a: 0.16 })],
  ['warning-border', K('warning', { a: 0.3 }), K('warning', { a: 0.35 })],
  ['warning-solid', A(0.7534, 0.1274), A(0.8, 0.13)],
  ['danger', A(0.4578, 0.1648), A(0.72, 0.17)],
  ['danger-bg', K('danger', { a: 0.08 }), K('danger', { a: 0.14 })],
  ['danger-border', K('danger', { a: 0.25 }), K('danger', { a: 0.35 })],
  ['danger-solid', A(0.5607, 0.2177), A(0.68, 0.2)],
  ['info', A(0.4882, 0.2172), A(0.76, 0.13)],
  ['info-bg', K('info', { a: 0.08 }), K('info', { a: 0.14 })],
  ['info-border', K('info', { a: 0.25 }), K('info', { a: 0.35 })],
  ['info-solid', A(0.5741, 0.2015), A(0.68, 0.17)],
  // ---- state ----
  ['disabled-bg', K('text', { a: 0.06 }), K('text', { a: 0.08 })],
  ['shadow', A(0, 0, 0.1), A(0, 0, 0.45)],
  ['scene-wash', A(0.9564, 0.0241, 0.08), A(0.1838, 0.0045, 0.08)],
  // ---- dashboard neutrals (exact legacy, untinted) ----
  ['dash-page', A(0.9702, 0), A(0, 0)],
  ['dash-surface', A(1, 0), A(0.1776, 0)],
  ['dash-surface-raised', A(0.9551, 0), A(0.2178, 0)],
  ['dash-border', A(0.9189, 0), A(0.252, 0)],
  ['dash-border-visible', A(0.8328, 0), A(0.3211, 0)],
  ['dash-text-disabled', A(0.7155, 0), A(0.5103, 0)],
  ['dash-text-secondary', A(0.5103, 0), A(0.683, 0)],
  ['dash-text-primary', A(0.252, 0), A(0.931, 0)],
  ['dash-text-display', A(0, 0), A(1, 0)],
  ['dash-dot-grid', A(0, 0, 0.065), A(1, 0, 0.045)],
  ['dash-accent', U(0.5607, 0.2177, 26.79), U(0.5607, 0.2177, 26.79)],
  // ---- terminal ----
  ['term-bg-top', A(0.9858, 0.0045), A(0.15, 0.006)],
  ['term-bg-bottom', A(0.9425, 0.0165), A(0.12, 0.006)],
  ['term-border', K('text', { a: 0.1 }), K('text', { a: 0.12 })],
  ['term-border-top', K('text', { a: 0.06 }), K('text', { a: 0.08 })],
  ['term-titlebar-bg', K('text', { a: 0.035 }), K('text', { a: 0.05 })],
  ['term-titlebar-border', K('text', { a: 0.07 }), K('text', { a: 0.09 })],
  ['term-title-fg', K('text', { a: 0.42 }), K('text', { a: 0.5 })],
  ['term-scroll-thumb', K('text', { a: 0.16 }), K('text', { a: 0.22 })],
  ['term-fg', K('text'), K('text')],
  ['term-dim', A(0.6129, 0.0183), A(0.66, 0.012)],
  ['term-shadow-1', K('text', { a: 0.05 }), K('shadow', { a: 0.3 })],
  ['term-shadow-2', K('text', { a: 0.08 }), K('shadow', { a: 0.45 })],
  ...TERM.flatMap(([k, [pl, pc], [ml, mc]]) => [
    [`term-${k}-pfx`, A(pl, pc), A(0.78, r4(pc * 0.8))],
    [`term-${k}-msg`, A(ml, mc), A(0.84, r4(mc * 0.8))],
  ]),
  ['term-caret', K('info-solid'), K('info-solid')],
];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// base values used when a linked role is switched to 'auto'
function baseOf(modeIdx, id, seen = new Set()) {
  const row = TABLE.find((r) => r[0] === id);
  const s = row[modeIdx + 1];
  if (s.t === 'auto') return { l: s.l, c: s.c, a: s.a };
  if (s.t === 'custom') return { l: s.l, c: s.c, a: s.a };
  if (seen.has(id)) return { l: 0, c: 0, a: 1 };
  seen.add(id);
  const t = baseOf(modeIdx, s.to, seen);
  return { l: r4(t.l + (s.dL || 0)), c: r4(t.c + (s.dC || 0)), a: s.a !== undefined ? s.a : t.a };
}

function roleState(modeIdx, id, s) {
  const base = baseOf(modeIdx, id);
  if (s.t === 'auto') return { link: 'auto', base };
  if (s.t === 'custom') return { link: 'custom', base, custom: { l: s.l, c: s.c, h: s.h, a: s.a } };
  const link = { to: s.to };
  if (s.mode) link.mode = s.mode;
  if (s.dL !== undefined) link.dL = s.dL;
  if (s.dC !== undefined) link.dC = s.dC;
  if (s.dH !== undefined) link.dH = s.dH;
  if (s.a !== undefined) link.a = s.a;
  return { link, base };
}

function buildRoles(modeIdx) {
  const roles = {};
  for (const id of ROLE_IDS) {
    const row = TABLE.find((r) => r[0] === id);
    if (!row) throw new Error(`baseline: missing role ${id}`);
    roles[id] = roleState(modeIdx, id, row[modeIdx + 1]);
  }
  return roles;
}

const CUSTOM_SCENE = {
  base: { l: 0.852, c: 0.1895, h: 160.21 },
  secondary: null,
  highlight: { l: 0.7894, c: 0.1353, h: 206.9 },
  highlightStrength: 0,
  opacityMul: 1,
};

function sceneDef(follow) {
  return { source: 'follow', follow, custom: JSON.parse(JSON.stringify(CUSTOM_SCENE)) };
}

function build() {
  return {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    meta: {
      id: 'baseline',
      name: 'Baseline',
      description: 'Reproduces the current site look in light mode; dark mode is a new authored palette.',
      status: 'draft',
    },
    defaults: { viewerPreference: 'light' },
    features: { focusRing: false, selection: false },
    master: { hue: BASELINE_MASTER_HUE, intensity: 1 },
    offsets: { accentBright: 6, support1: 86, support2: 142 },
    neutral: { tintStrength: 1, hueSource: 'fixed', hue: 56 },
    modes: {
      light: { settings: { lightnessShift: 0, chromaScale: 1 }, roles: buildRoles(0) },
      dark: { settings: { lightnessShift: 0, chromaScale: 1 }, roles: buildRoles(1) },
    },
    scene: {
      light: sceneDef({ hueShiftDeg: 0, saturationMul: 1, lightnessDelta: 0, opacityMul: 1, hueSpan: 0.8 }),
      dark: sceneDef({ hueShiftDeg: 0, saturationMul: 0.95, lightnessDelta: 0.1, opacityMul: 1.5, hueSpan: 0.8 }),
    },
  };
}

export const BASELINE_DEFINITION = deepFreeze(build());

/** Deep clone of the baseline (mutable). */
export function createBaseline() {
  return JSON.parse(JSON.stringify(BASELINE_DEFINITION));
}
