// resolveTheme: the one pure, deterministic function that turns a theme
// definition into sRGB strings (CSS) and a numeric scene palette (Three.js).
// Precedence (contract §1): preset base -> linked generation -> mode settings ->
// explicit custom overrides; gamut mapping happens once at the end.
//
// It never reads Date / Math.random / window and never depends on the identity
// or key order of its input (the input is canonicalised first).

import { MODES, SCHEMA_VERSION } from './constants.js';
import {
  wrapHue, gamutMap, formatHex, formatRgba,
} from './color.js';
import { ROLE_DEFS, getRoleDef } from './roles.js';
import { TOKEN_NAMES } from './tokens.js';
import { normalizeDefinition, hashDefinition } from './validate.js';
import { resolveScene } from './scene.js';
import { round, clamp, isPlainObject } from './util.js';

function tintHue(def) {
  const n = def.neutral;
  return n.hueSource === 'master' ? wrapHue(def.master.hue + n.hue) : n.hue;
}

function ruleHue(def, rd) {
  const h = rd.hue;
  switch (h.src) {
    case 'tint': return wrapHue(tintHue(def) + h.value);
    case 'master': return wrapHue(def.master.hue + h.value);
    case 'offset': return wrapHue(def.master.hue + def.offsets[h.key]);
    default: return wrapHue(h.value);
  }
}

function scaleFactor(def, rd) {
  if (rd.scale === 'tint') return def.neutral.tintStrength;
  if (rd.scale === 'int') return def.master.intensity;
  return 1;
}

/** Final (pre-gamut) OKLCH+alpha for one role, with memoisation and cycle guard. */
class Finals {
  constructor(def) {
    this.def = def;
    this.memo = new Map();
    this.stack = new Set();
  }

  get(mode, id) {
    const key = `${mode}:${id}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const rd = getRoleDef(id);
    const state = this.def.modes[mode].roles[id];
    this.stack.add(key);
    let out;
    if (state.link === 'custom') {
      out = this.custom(state);
    } else if (isPlainObject(state.link) && !this.hasCycle(mode, state.link)) {
      out = this.linked(mode, rd, state);
    } else {
      out = this.auto(mode, rd, state);
    }
    this.stack.delete(key);
    out.locked = state.locked === true && state.link === 'custom';
    this.memo.set(key, out);
    return out;
  }

  hasCycle(mode, link) {
    const tm = link.mode && MODES.includes(link.mode) ? link.mode : mode;
    return this.stack.has(`${tm}:${link.to}`) || !getRoleDef(link.to);
  }

  custom(state) {
    const c = state.custom;
    return { l: c.l, c: c.c, h: c.h, a: c.a, source: 'custom' };
  }

  applyMode(mode, rd, v) {
    if (!rd.modeSettings) return v;
    const s = this.def.modes[mode].settings;
    return { ...v, l: v.l + s.lightnessShift, c: v.c * s.chromaScale };
  }

  auto(mode, rd, state) {
    const v = {
      l: state.base.l,
      c: state.base.c * scaleFactor(this.def, rd),
      h: ruleHue(this.def, rd),
      a: state.base.a,
      source: 'auto',
    };
    return this.applyMode(mode, rd, v);
  }

  linked(mode, rd, state) {
    const link = state.link;
    const tm = link.mode && MODES.includes(link.mode) ? link.mode : mode;
    const t = this.get(tm, link.to);
    const v = {
      l: t.l + (link.dL || 0),
      c: Math.max(0, t.c + (link.dC || 0)),
      h: link.dH ? wrapHue(t.h + link.dH) : t.h,
      a: link.a !== undefined ? link.a : t.a,
      source: 'link',
    };
    // A target flagged modeSettings already carries its mode's shift/scale in
    // its final value; applying them again would double-count (L +0.1 -> +0.2).
    if (getRoleDef(link.to).modeSettings) return v;
    return this.applyMode(mode, rd, v);
  }
}

const o5 = (x) => round(x, 5);

function compileRole(rd, fin) {
  const l = clamp(fin.l, 0, 1);
  const c = Math.max(0, fin.c);
  const a = clamp(fin.a, 0, 1);
  const gm = gamutMap({ l, c, h: fin.h });
  const [r, g, b] = gm.rgb255;
  const a3 = round(a, 3);
  const kind = rd.kind === 'alpha' || a3 < 1 ? 'alpha' : 'solid';
  const hex = formatHex({ r, g, b });
  return {
    id: rd.id,
    css: rd.css,
    kind,
    oklch: { l: o5(l), c: o5(c), h: round(fin.h, 3), a: round(a, 4) },
    mapped: { l: o5(gm.oklch.l), c: o5(gm.oklch.c), h: round(gm.oklch.h, 3) },
    hex,
    rgba: [r, g, b, a3],
    value: kind === 'alpha' ? formatRgba({ r, g, b, a: a3 }) : hex,
    gamut: { mapped: gm.mapped, deltaE: o5(gm.deltaE) },
    source: fin.source,
    locked: fin.locked,
  };
}

function composites(mode, roles, scene) {
  const dark = mode === 'dark';
  const swatch = scene.swatches;
  return {
    '--t-gradient-accent': 'linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%)',
    '--t-term-bg': 'linear-gradient(180deg, var(--t-term-bg-top) 0%, var(--t-term-bg-bottom) 100%)',
    '--t-term-shadow': '0px 4px 10px var(--t-term-shadow-1), 0px 14px 30px var(--t-term-shadow-2)',
    '--t-shadow-sm': '0 1px 2px var(--t-shadow)',
    '--t-shadow-md': '0 4px 12px var(--t-shadow)',
    '--t-shadow-lg': '0 14px 30px var(--t-shadow)',
    '--t-blend-deco': dark ? 'screen' : 'multiply',
    '--t-logo-blend': dark ? 'lighten' : 'darken',
    '--t-logo-filter': dark ? 'invert(1)' : 'none',
    '--t-logo-filter-muted': dark ? 'grayscale(1) invert(1) opacity(.45)' : 'grayscale(1) opacity(.45)',
    '--t-scene-bg': roles.page.hex,
    '--t-scene-base': swatch.base,
    '--t-scene-secondary': swatch.secondary,
    '--t-scene-highlight': swatch.highlight,
    '--t-scene-fallback': `radial-gradient(60% 50% at 30% 20%, ${swatch.base}33, transparent), radial-gradient(50% 50% at 75% 70%, ${swatch.secondary}26, transparent)`,
  };
}

function resolveMode(def, mode, finals, hash) {
  const roles = {};
  for (const rd of ROLE_DEFS) roles[rd.id] = compileRole(rd, finals.get(mode, rd.id));
  const scene = resolveScene(def, mode, roles);
  const comp = composites(mode, roles, scene);
  const tokens = {};
  for (const name of TOKEN_NAMES) {
    tokens[name] = name in comp ? comp[name] : null;
  }
  for (const rd of ROLE_DEFS) tokens[rd.css] = roles[rd.id].value;
  return {
    version: SCHEMA_VERSION,
    mode,
    definitionId: def.meta.id,
    hash,
    meta: {
      masterHue: def.master.hue,
      intensity: def.master.intensity,
      tintStrength: def.neutral.tintStrength,
    },
    defaults: { viewerPreference: def.defaults.viewerPreference },
    features: { focusRing: def.features.focusRing, selection: def.features.selection },
    tokens,
    roles,
    scene,
  };
}

/**
 * @param definition  any theme definition (canonicalised internally)
 * @param mode        'light' | 'dark'
 * @param options     { assumeCanonical?: boolean }  skip canonicalisation when the caller guarantees it
 */
export function resolveTheme(definition, mode, options = {}) {
  const m = mode === 'dark' ? 'dark' : 'light';
  const def = options.assumeCanonical ? definition : normalizeDefinition(definition);
  return resolveMode(def, m, new Finals(def), hashDefinition(def));
}

export function resolveBoth(definition, options = {}) {
  const def = options.assumeCanonical ? definition : normalizeDefinition(definition);
  const finals = new Finals(def);
  const hash = hashDefinition(def);
  return {
    light: resolveMode(def, 'light', finals, hash),
    dark: resolveMode(def, 'dark', finals, hash),
  };
}
