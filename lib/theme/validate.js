// Validation, normalisation and canonicalisation (contract §3, §7.4).
//
// `validateDefinition` never throws. It returns the canonical definition (fixed
// key order, l/c/a rounded to 4 dp, degrees to 2 dp, hue wrapped to [0,360))
// plus errors (definition unusable) and warnings (repaired). Canonicalisation is
// idempotent, which is what makes export -> import -> export byte-identical.

import {
  SCHEMA_ID, SCHEMA_VERSION, MODES, PREFERENCES, DP_COLOR, DP_DEG,
} from './constants.js';
import { ROLE_IDS, isRoleId } from './roles.js';
import { BASELINE_DEFINITION, createBaseline } from './baseline.js';
import { round, clamp, wrapRound, isPlainObject, has, clone, fnv1a32 } from './util.js';

const STATUSES = ['draft', 'validated'];
const HUE_SOURCES = ['fixed', 'master'];
const SCENE_SOURCES = ['follow', 'custom'];

class Ctx {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  error(path, code, message) {
    this.errors.push({ path, code, message });
  }
  warn(path, code, message) {
    this.warnings.push({ path, code, message });
  }
}

const join = (a, b) => (a ? `${a}.${b}` : b);

/** Read an object-valued field; returns {obj, missing}. A missing object is defaulted once. */
function readObject(ctx, parent, key, path, fallback) {
  const p = join(path, key);
  if (!has(parent, key) || parent[key] === undefined) {
    ctx.warn(p, 'MISSING_FIELD_DEFAULTED', `missing "${p}", defaulted from the baseline`);
    return { obj: fallback, missing: true };
  }
  const v = parent[key];
  if (!isPlainObject(v)) {
    ctx.error(p, 'NOT_AN_OBJECT', `"${p}" must be an object`);
    return { obj: fallback, missing: true };
  }
  return { obj: v, missing: false };
}

function warnUnknownKeys(ctx, obj, allowed, path) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) ctx.warn(join(path, k), 'UNKNOWN_KEY', `unknown key "${join(path, k)}" dropped`);
  }
}

/**
 * Read a finite number. spec: { min, max, dp, wrap, def }.
 * - undefined  -> default + MISSING_FIELD_DEFAULTED warning (unless quiet)
 * - not finite -> NONFINITE error (never coerced), default used to keep going
 * - hue (wrap) -> wrapped silently
 * - out of range -> clamped + CLAMPED warning
 */
function readNum(ctx, parent, key, path, spec, quiet) {
  const p = join(path, key);
  const { min, max, dp = DP_COLOR, wrap = false, def } = spec;
  if (!has(parent, key) || parent[key] === undefined) {
    if (!quiet) ctx.warn(p, 'MISSING_FIELD_DEFAULTED', `missing "${p}", defaulted to ${def}`);
    return def;
  }
  const v = parent[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    ctx.error(p, 'NONFINITE', `"${p}" must be a finite number`);
    return def;
  }
  if (wrap) return wrapRound(v, dp);
  let x = v;
  if (x < min || x > max) {
    ctx.warn(p, 'CLAMPED', `"${p}" = ${v} is outside [${min}, ${max}], clamped`);
    x = clamp(x, min, max);
  }
  return round(x, dp);
}

function readEnum(ctx, parent, key, path, allowed, def, quiet) {
  const p = join(path, key);
  if (!has(parent, key) || parent[key] === undefined) {
    if (!quiet) ctx.warn(p, 'MISSING_FIELD_DEFAULTED', `missing "${p}", defaulted to "${def}"`);
    return def;
  }
  const v = parent[key];
  if (typeof v !== 'string' || !allowed.includes(v)) {
    ctx.error(p, 'BAD_ENUM', `"${p}" must be one of ${allowed.join(', ')}`);
    return def;
  }
  return v;
}

function readString(ctx, parent, key, path, def, quiet) {
  const p = join(path, key);
  if (!has(parent, key) || parent[key] === undefined) {
    if (!quiet) ctx.warn(p, 'MISSING_FIELD_DEFAULTED', `missing "${p}", defaulted`);
    return def;
  }
  const v = parent[key];
  if (typeof v !== 'string') {
    ctx.error(p, 'BAD_TYPE', `"${p}" must be a string`);
    return def;
  }
  return v;
}

function readBool(ctx, parent, key, path, def, quiet) {
  const p = join(path, key);
  if (!has(parent, key) || parent[key] === undefined) {
    if (!quiet) ctx.warn(p, 'MISSING_FIELD_DEFAULTED', `missing "${p}", defaulted to ${def}`);
    return def;
  }
  if (typeof parent[key] !== 'boolean') {
    ctx.error(p, 'BAD_TYPE', `"${p}" must be a boolean`);
    return def;
  }
  return parent[key];
}

// ---------- sections ----------

function readOklch(ctx, parent, key, path, fallback, quiet) {
  const { obj, missing } = readObject(ctx, parent, key, path, fallback);
  const q = quiet || missing;
  if (!missing) warnUnknownKeys(ctx, obj, ['l', 'c', 'h'], join(path, key));
  const p = join(path, key);
  return {
    l: readNum(ctx, obj, 'l', p, { min: 0, max: 1, def: fallback.l }, q),
    c: readNum(ctx, obj, 'c', p, { min: 0, max: 0.5, def: fallback.c }, q),
    h: readNum(ctx, obj, 'h', p, { wrap: true, dp: DP_DEG, def: fallback.h }, q),
  };
}

function readScene(ctx, input, path, base) {
  const { obj, missing } = readObject(ctx, input, path.split('.').pop(), path.split('.').slice(0, -1).join('.'), base);
  const q = missing;
  if (!missing) warnUnknownKeys(ctx, obj, ['source', 'follow', 'custom'], path);
  const source = readEnum(ctx, obj, 'source', path, SCENE_SOURCES, base.source, q);

  const f = readObject(ctx, obj, 'follow', path, base.follow);
  const fq = q || f.missing;
  if (!f.missing) warnUnknownKeys(ctx, f.obj, ['hueShiftDeg', 'saturationMul', 'lightnessDelta', 'opacityMul', 'hueSpan'], `${path}.follow`);
  const fp = `${path}.follow`;
  const follow = {
    hueShiftDeg: readNum(ctx, f.obj, 'hueShiftDeg', fp, { min: -180, max: 180, dp: DP_DEG, def: base.follow.hueShiftDeg }, fq),
    saturationMul: readNum(ctx, f.obj, 'saturationMul', fp, { min: 0, max: 1.5, def: base.follow.saturationMul }, fq),
    lightnessDelta: readNum(ctx, f.obj, 'lightnessDelta', fp, { min: -0.5, max: 0.5, def: base.follow.lightnessDelta }, fq),
    opacityMul: readNum(ctx, f.obj, 'opacityMul', fp, { min: 0, max: 3, def: base.follow.opacityMul }, fq),
    hueSpan: readNum(ctx, f.obj, 'hueSpan', fp, { min: 0.05, max: 1, def: base.follow.hueSpan }, fq),
  };

  const c = readObject(ctx, obj, 'custom', path, base.custom);
  const cq = q || c.missing;
  const cp = `${path}.custom`;
  if (!c.missing) warnUnknownKeys(ctx, c.obj, ['base', 'secondary', 'highlight', 'highlightStrength', 'opacityMul'], cp);
  const cBase = readOklch(ctx, c.obj, 'base', cp, base.custom.base, cq);
  let secondary = null;
  if (has(c.obj, 'secondary') && c.obj.secondary !== null && c.obj.secondary !== undefined) {
    secondary = readOklch(ctx, c.obj, 'secondary', cp, base.custom.secondary || base.custom.base, cq);
  }
  const highlight = readOklch(ctx, c.obj, 'highlight', cp, base.custom.highlight, cq);
  const custom = {
    base: cBase,
    secondary,
    highlight,
    highlightStrength: readNum(ctx, c.obj, 'highlightStrength', cp, { min: 0, max: 1, def: base.custom.highlightStrength }, cq),
    opacityMul: readNum(ctx, c.obj, 'opacityMul', cp, { min: 0, max: 3, def: base.custom.opacityMul }, cq),
  };
  return { source, follow, custom };
}

function readLinkSpec(ctx, spec, path) {
  warnUnknownKeys(ctx, spec, ['to', 'mode', 'dL', 'dC', 'dH', 'a'], path);
  const out = {};
  const to = spec.to;
  if (typeof to !== 'string' || !isRoleId(to)) {
    ctx.error(`${path}.to`, 'LINK_TARGET_MISSING', `link target "${String(to)}" is not a known role`);
    out.to = typeof to === 'string' ? to : '';
  } else {
    out.to = to;
  }
  if (has(spec, 'mode') && spec.mode !== undefined) {
    if (typeof spec.mode === 'string' && MODES.includes(spec.mode)) out.mode = spec.mode;
    else ctx.error(`${path}.mode`, 'BAD_ENUM', `"${path}.mode" must be light or dark`);
  }
  const num = (key, rangeMin, rangeMax, dp) => {
    if (!has(spec, key) || spec[key] === undefined) return;
    out[key] = readNum(ctx, spec, key, path, { min: rangeMin, max: rangeMax, dp, def: 0 }, true);
  };
  num('dL', -1, 1, DP_COLOR);
  num('dC', -0.5, 0.5, DP_COLOR);
  if (has(spec, 'dH') && spec.dH !== undefined) {
    const v = spec.dH;
    if (typeof v !== 'number' || !Number.isFinite(v)) ctx.error(`${path}.dH`, 'NONFINITE', `"${path}.dH" must be a finite number`);
    else out.dH = round(clamp(v, -360, 360), DP_DEG);
  }
  num('a', 0, 1, DP_COLOR);
  return out;
}

function readRole(ctx, entry, path, baseRole) {
  if (entry === undefined) {
    ctx.warn(path, 'MISSING_FIELD_DEFAULTED', `missing role "${path}", defaulted from the baseline`);
    return clone(baseRole);
  }
  if (!isPlainObject(entry)) {
    ctx.error(path, 'NOT_AN_OBJECT', `"${path}" must be an object`);
    return clone(baseRole);
  }
  warnUnknownKeys(ctx, entry, ['link', 'base', 'custom', 'locked'], path);

  // base
  const b = readObject(ctx, entry, 'base', path, baseRole.base);
  const bp = `${path}.base`;
  if (!b.missing) warnUnknownKeys(ctx, b.obj, ['l', 'c', 'a'], bp);
  const base = {
    l: readNum(ctx, b.obj, 'l', bp, { min: 0, max: 1, def: baseRole.base.l }, b.missing),
    c: readNum(ctx, b.obj, 'c', bp, { min: 0, max: 0.5, def: baseRole.base.c }, b.missing),
    a: readNum(ctx, b.obj, 'a', bp, { min: 0, max: 1, def: baseRole.base.a }, b.missing),
  };

  // link
  let link;
  const lp = `${path}.link`;
  if (!has(entry, 'link') || entry.link === undefined) {
    ctx.warn(lp, 'MISSING_FIELD_DEFAULTED', `missing "${lp}", defaulted`);
    link = clone(baseRole.link);
  } else if (entry.link === 'auto' || entry.link === 'custom') {
    link = entry.link;
  } else if (isPlainObject(entry.link)) {
    link = readLinkSpec(ctx, entry.link, lp);
  } else {
    ctx.error(lp, 'BAD_LINK', `"${lp}" must be "auto", "custom" or a link object`);
    link = 'auto';
  }

  // custom
  let custom;
  const cp = `${path}.custom`;
  if (has(entry, 'custom') && entry.custom !== undefined) {
    if (!isPlainObject(entry.custom)) {
      ctx.error(cp, 'NOT_AN_OBJECT', `"${cp}" must be an object`);
    } else {
      warnUnknownKeys(ctx, entry.custom, ['l', 'c', 'h', 'a'], cp);
      const fb = baseRole.custom || { l: base.l, c: base.c, h: 0, a: base.a };
      custom = {
        l: readNum(ctx, entry.custom, 'l', cp, { min: 0, max: 1, def: fb.l }, true),
        c: readNum(ctx, entry.custom, 'c', cp, { min: 0, max: 0.5, def: fb.c }, true),
        h: readNum(ctx, entry.custom, 'h', cp, { wrap: true, dp: DP_DEG, def: fb.h }, true),
        a: readNum(ctx, entry.custom, 'a', cp, { min: 0, max: 1, def: fb.a }, true),
      };
      for (const k of ['l', 'c', 'h', 'a']) {
        if (!has(entry.custom, k) || entry.custom[k] === undefined) ctx.warn(`${cp}.${k}`, 'MISSING_FIELD_DEFAULTED', `missing "${cp}.${k}", defaulted`);
      }
    }
  }
  if (link === 'custom' && !custom) {
    ctx.error(cp, 'CUSTOM_MISSING', `"${path}" is custom but has no "custom" value`);
    custom = { l: base.l, c: base.c, h: 0, a: base.a };
  }

  // locked
  const locked = has(entry, 'locked') && entry.locked !== undefined ? readBool(ctx, entry, 'locked', path, false, true) : false;
  if (locked && link !== 'custom') {
    ctx.error(`${path}.locked`, 'LOCKED_NOT_CUSTOM', `"${path}" is locked but its link is not "custom"`);
  }

  const out = { link, base };
  if (custom) out.custom = custom;
  if (locked) out.locked = true;
  return out;
}

function readMode(ctx, input, mode, baseMode) {
  const path = `modes.${mode}`;
  const { obj, missing } = readObject(ctx, input, mode, 'modes', baseMode);
  if (!missing) warnUnknownKeys(ctx, obj, ['settings', 'roles'], path);
  const s = readObject(ctx, obj, 'settings', path, baseMode.settings);
  const sp = `${path}.settings`;
  const sq = missing || s.missing;
  if (!s.missing) warnUnknownKeys(ctx, s.obj, ['lightnessShift', 'chromaScale'], sp);
  const settings = {
    lightnessShift: readNum(ctx, s.obj, 'lightnessShift', sp, { min: -0.15, max: 0.15, def: baseMode.settings.lightnessShift }, sq),
    chromaScale: readNum(ctx, s.obj, 'chromaScale', sp, { min: 0, max: 2, def: baseMode.settings.chromaScale }, sq),
  };
  const r = readObject(ctx, obj, 'roles', path, baseMode.roles);
  const rp = `${path}.roles`;
  if (!r.missing) {
    for (const k of Object.keys(r.obj)) {
      if (!isRoleId(k)) ctx.warn(`${rp}.${k}`, 'UNKNOWN_KEY', `unknown role "${k}" dropped`);
    }
  }
  const roles = {};
  for (const id of ROLE_IDS) {
    roles[id] = r.missing
      ? clone(baseMode.roles[id])
      : readRole(ctx, r.obj[id], `${rp}.${id}`, baseMode.roles[id]);
  }
  return { settings, roles };
}

function detectLinkCycles(ctx, def) {
  const state = new Map(); // node -> 0 visiting, 1 done
  const reported = new Set();
  const depOf = (mode, id) => {
    const link = def.modes[mode].roles[id].link;
    if (!isPlainObject(link) || !isRoleId(link.to)) return null;
    return { mode: link.mode && MODES.includes(link.mode) ? link.mode : mode, id: link.to };
  };
  for (const startMode of MODES) {
    for (const startId of ROLE_IDS) {
      const stack = [];
      let node = { mode: startMode, id: startId };
      for (;;) {
        const key = `${node.mode}:${node.id}`;
        const st = state.get(key);
        if (st === 1) break;
        if (st === 0) {
          const at = stack.findIndex((n) => `${n.mode}:${n.id}` === key);
          const cycle = stack.slice(at);
          const sig = cycle.map((n) => `${n.mode}:${n.id}`).sort().join('|');
          if (!reported.has(sig)) {
            reported.add(sig);
            const first = cycle[0];
            ctx.error(
              `modes.${first.mode}.roles.${first.id}.link`,
              'LINK_CYCLE',
              `link cycle: ${[...cycle, cycle[0]].map((n) => `${n.mode}:${n.id}`).join(' -> ')}`
            );
          }
          break;
        }
        state.set(key, 0);
        stack.push(node);
        const next = depOf(node.mode, node.id);
        if (!next) break;
        node = next;
      }
      for (const n of stack) state.set(`${n.mode}:${n.id}`, 1);
    }
  }
}

const TOP_KEYS = ['schema', 'version', 'meta', 'defaults', 'features', 'master', 'offsets', 'neutral', 'modes', 'scene'];

function normalizeInto(ctx, input) {
  const B = BASELINE_DEFINITION;
  if (!isPlainObject(input)) {
    ctx.error('', 'NOT_AN_OBJECT', 'a theme definition must be a JSON object');
    return null;
  }
  warnUnknownKeys(ctx, input, TOP_KEYS, '');

  // schema + version
  if (has(input, 'schema') && input.schema !== undefined) {
    if (input.schema !== SCHEMA_ID) ctx.error('schema', 'BAD_SCHEMA', `schema must be "${SCHEMA_ID}"`);
  } else {
    ctx.warn('schema', 'MISSING_FIELD_DEFAULTED', `missing "schema", assumed "${SCHEMA_ID}"`);
  }
  const v = input.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    ctx.error('version', 'BAD_VERSION', '"version" must be a positive integer');
  } else if (v > SCHEMA_VERSION) {
    ctx.error('version', 'UNSUPPORTED_VERSION', `version ${v} is newer than the supported version ${SCHEMA_VERSION}`);
  }

  // meta
  const m = readObject(ctx, input, 'meta', '', B.meta);
  if (!m.missing) warnUnknownKeys(ctx, m.obj, ['id', 'name', 'description', 'status', 'baselineOf', 'updatedAt'], 'meta');
  const meta = {
    id: readString(ctx, m.obj, 'id', 'meta', B.meta.id, m.missing),
    name: readString(ctx, m.obj, 'name', 'meta', B.meta.name, m.missing),
  };
  if (has(m.obj, 'description') && m.obj.description !== undefined) meta.description = readString(ctx, m.obj, 'description', 'meta', '', true);
  meta.status = readEnum(ctx, m.obj, 'status', 'meta', STATUSES, 'draft', m.missing);
  if (has(m.obj, 'baselineOf') && m.obj.baselineOf !== undefined) meta.baselineOf = readString(ctx, m.obj, 'baselineOf', 'meta', '', true);
  if (has(m.obj, 'updatedAt') && m.obj.updatedAt !== undefined) meta.updatedAt = readString(ctx, m.obj, 'updatedAt', 'meta', '', true);

  // defaults / features
  const d = readObject(ctx, input, 'defaults', '', B.defaults);
  if (!d.missing) warnUnknownKeys(ctx, d.obj, ['viewerPreference'], 'defaults');
  const defaults = { viewerPreference: readEnum(ctx, d.obj, 'viewerPreference', 'defaults', PREFERENCES, B.defaults.viewerPreference, d.missing) };
  const f = readObject(ctx, input, 'features', '', B.features);
  if (!f.missing) warnUnknownKeys(ctx, f.obj, ['focusRing', 'selection'], 'features');
  const features = {
    focusRing: readBool(ctx, f.obj, 'focusRing', 'features', B.features.focusRing, f.missing),
    selection: readBool(ctx, f.obj, 'selection', 'features', B.features.selection, f.missing),
  };

  // master / offsets / neutral
  const ma = readObject(ctx, input, 'master', '', B.master);
  if (!ma.missing) warnUnknownKeys(ctx, ma.obj, ['hue', 'intensity'], 'master');
  const master = {
    hue: readNum(ctx, ma.obj, 'hue', 'master', { wrap: true, dp: DP_DEG, def: B.master.hue }, ma.missing),
    intensity: readNum(ctx, ma.obj, 'intensity', 'master', { min: 0, max: 1.5, def: B.master.intensity }, ma.missing),
  };
  const of = readObject(ctx, input, 'offsets', '', B.offsets);
  if (!of.missing) warnUnknownKeys(ctx, of.obj, ['accentBright', 'support1', 'support2'], 'offsets');
  const offsets = {};
  for (const k of ['accentBright', 'support1', 'support2']) {
    offsets[k] = readNum(ctx, of.obj, k, 'offsets', { min: -180, max: 180, dp: DP_DEG, def: B.offsets[k] }, of.missing);
  }
  const ne = readObject(ctx, input, 'neutral', '', B.neutral);
  if (!ne.missing) warnUnknownKeys(ctx, ne.obj, ['tintStrength', 'hueSource', 'hue'], 'neutral');
  const neutral = {
    tintStrength: readNum(ctx, ne.obj, 'tintStrength', 'neutral', { min: 0, max: 2, def: B.neutral.tintStrength }, ne.missing),
    hueSource: readEnum(ctx, ne.obj, 'hueSource', 'neutral', HUE_SOURCES, B.neutral.hueSource, ne.missing),
    hue: readNum(ctx, ne.obj, 'hue', 'neutral', { wrap: true, dp: DP_DEG, def: B.neutral.hue }, ne.missing),
  };

  // modes
  const mo = readObject(ctx, input, 'modes', '', B.modes);
  if (!mo.missing) warnUnknownKeys(ctx, mo.obj, MODES, 'modes');
  const modes = {
    light: readMode(ctx, mo.obj, 'light', B.modes.light),
    dark: readMode(ctx, mo.obj, 'dark', B.modes.dark),
  };

  // scene
  const sc = readObject(ctx, input, 'scene', '', B.scene);
  if (!sc.missing) warnUnknownKeys(ctx, sc.obj, MODES, 'scene');
  const scene = {
    light: readScene(ctx, sc.obj, 'scene.light', B.scene.light),
    dark: readScene(ctx, sc.obj, 'scene.dark', B.scene.dark),
  };

  return { schema: SCHEMA_ID, version: SCHEMA_VERSION, meta, defaults, features, master, offsets, neutral, modes, scene };
}

/**
 * Validate and canonicalise. Never throws.
 * @returns {{ ok:boolean, definition:object|null, errors:Array, warnings:Array }}
 */
export function validateDefinition(input) {
  const ctx = new Ctx();
  let def = null;
  try {
    def = normalizeInto(ctx, input);
    if (def) detectLinkCycles(ctx, def);
  } catch (e) {
    ctx.error('', 'INTERNAL', `validation failed unexpectedly: ${e && e.message}`);
    def = null;
  }
  const ok = ctx.errors.length === 0 && def !== null;
  return { ok, definition: ok ? def : null, errors: ctx.errors, warnings: ctx.warnings };
}

/** Parse JSON text, then validate. Never throws. */
export function parseDefinition(text) {
  let parsed;
  try {
    const src = typeof text === 'string' ? text.replace(/^﻿/, '') : text;
    if (typeof src !== 'string') throw new Error('input is not text');
    parsed = JSON.parse(src);
  } catch (e) {
    return {
      ok: false,
      definition: null,
      errors: [{ path: '', code: 'JSON_PARSE', message: `invalid JSON: ${e && e.message}` }],
      warnings: [],
    };
  }
  return validateDefinition(parsed);
}

/**
 * Canonical form of any input: missing fields filled, values clamped and
 * rounded, key order fixed. Never throws; invalid parts fall back to the
 * baseline (use validateDefinition to learn what was repaired).
 */
export function normalizeDefinition(input) {
  const ctx = new Ctx();
  try {
    const def = normalizeInto(ctx, input);
    if (def) return def;
  } catch {
    // fall through
  }
  return createBaseline();
}

export const canonicalize = normalizeDefinition;

/** 8-hex FNV-1a32 of the canonical JSON, excluding meta.updatedAt. */
export function hashDefinition(def) {
  const n = normalizeDefinition(def);
  const meta = { ...n.meta };
  delete meta.updatedAt;
  return fnv1a32(JSON.stringify({ ...n, meta }));
}
