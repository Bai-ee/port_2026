// Immutable edit helpers (contract §7.1). Every helper returns a NEW definition
// with structural sharing (untouched subtrees keep their identity) and returns
// the SAME object when nothing changed. Values are clamped and rounded to the
// canonical precision so an edited definition is already canonical
// (normalizeDefinition(edit(d)) deep-equals edit(d)).
//
// Locked roles are protected from every bulk operation (copyMode, resetMode,
// linkModes); direct per-role edits by the user always apply.

import { MODES, PREFERENCES, DP_COLOR, DP_DEG } from './constants.js';
import { ROLE_IDS, isRoleId } from './roles.js';
import { BASELINE_DEFINITION } from './baseline.js';
import { resolveTheme } from './resolve.js';
import { round, clamp, wrapRound, isPlainObject, clone } from './util.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const isMode = (m) => MODES.includes(m);

function withRole(def, mode, id, nextRole) {
  const cur = def.modes[mode].roles[id];
  if (cur === nextRole) return def;
  return {
    ...def,
    modes: {
      ...def.modes,
      [mode]: { ...def.modes[mode], roles: { ...def.modes[mode].roles, [id]: nextRole } },
    },
  };
}

function shallowEqual(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

// ---------- master / offsets / neutral / mode settings ----------

export function setMasterHue(def, hue) {
  if (!fin(hue)) return def;
  const h = wrapRound(hue, DP_DEG);
  return def.master.hue === h ? def : { ...def, master: { ...def.master, hue: h } };
}

export function setIntensity(def, v) {
  if (!fin(v)) return def;
  const x = round(clamp(v, 0, 1.5), DP_COLOR);
  return def.master.intensity === x ? def : { ...def, master: { ...def.master, intensity: x } };
}

export function setOffset(def, key, deg) {
  if (!['accentBright', 'support1', 'support2'].includes(key) || !fin(deg)) return def;
  const x = round(clamp(deg, -180, 180), DP_DEG);
  return def.offsets[key] === x ? def : { ...def, offsets: { ...def.offsets, [key]: x } };
}

export function setNeutral(def, patch = {}) {
  const next = { ...def.neutral };
  if (fin(patch.tintStrength)) next.tintStrength = round(clamp(patch.tintStrength, 0, 2), DP_COLOR);
  if (patch.hueSource === 'fixed' || patch.hueSource === 'master') next.hueSource = patch.hueSource;
  if (fin(patch.hue)) next.hue = wrapRound(patch.hue, DP_DEG);
  return shallowEqual(next, def.neutral) ? def : { ...def, neutral: next };
}

export function setModeSettings(def, mode, patch = {}) {
  if (!isMode(mode)) return def;
  const cur = def.modes[mode].settings;
  const next = { ...cur };
  if (fin(patch.lightnessShift)) next.lightnessShift = round(clamp(patch.lightnessShift, -0.15, 0.15), DP_COLOR);
  if (fin(patch.chromaScale)) next.chromaScale = round(clamp(patch.chromaScale, 0, 2), DP_COLOR);
  if (shallowEqual(next, cur)) return def;
  return { ...def, modes: { ...def.modes, [mode]: { ...def.modes[mode], settings: next } } };
}

// ---------- features / defaults / meta ----------

export function setFeatures(def, patch = {}) {
  const next = { ...def.features };
  if (typeof patch.focusRing === 'boolean') next.focusRing = patch.focusRing;
  if (typeof patch.selection === 'boolean') next.selection = patch.selection;
  return shallowEqual(next, def.features) ? def : { ...def, features: next };
}

export function setViewerPreference(def, pref) {
  if (!PREFERENCES.includes(pref) || def.defaults.viewerPreference === pref) return def;
  return { ...def, defaults: { ...def.defaults, viewerPreference: pref } };
}

export function setMeta(def, patch = {}) {
  const next = { ...def.meta };
  for (const k of ['id', 'name', 'description', 'baselineOf', 'updatedAt']) {
    if (typeof patch[k] === 'string') next[k] = patch[k];
  }
  if (patch.status === 'draft' || patch.status === 'validated') next.status = patch.status;
  return shallowEqual(next, def.meta) ? def : { ...def, meta: next };
}

// ---------- roles ----------

export function setRoleBase(def, mode, roleId, patch = {}) {
  if (!isMode(mode) || !isRoleId(roleId)) return def;
  const role = def.modes[mode].roles[roleId];
  const base = { ...role.base };
  if (fin(patch.l)) base.l = round(clamp(patch.l, 0, 1), DP_COLOR);
  if (fin(patch.c)) base.c = round(clamp(patch.c, 0, 0.5), DP_COLOR);
  if (fin(patch.a)) base.a = round(clamp(patch.a, 0, 1), DP_COLOR);
  return shallowEqual(base, role.base) ? def : withRole(def, mode, roleId, { ...role, base });
}

function canonicalCustom(v) {
  return {
    l: round(clamp(v.l, 0, 1), DP_COLOR),
    c: round(clamp(v.c, 0, 0.5), DP_COLOR),
    h: wrapRound(v.h, DP_DEG),
    a: round(clamp(v.a, 0, 1), DP_COLOR),
  };
}

/** Make the role Custom with an explicit value. Keeps `locked` as it is. */
export function setRoleCustom(def, mode, roleId, value) {
  if (!isMode(mode) || !isRoleId(roleId) || !isPlainObject(value)) return def;
  if (![value.l, value.c, value.h, value.a].every(fin)) return def;
  const role = def.modes[mode].roles[roleId];
  const custom = canonicalCustom(value);
  if (role.link === 'custom' && role.custom && shallowEqual(role.custom, custom)) return def;
  return withRole(def, mode, roleId, { ...role, link: 'custom', custom });
}

function targetOf(def, mode, link) {
  return { mode: link.mode && isMode(link.mode) ? link.mode : mode, id: link.to };
}

/** Would giving (mode, roleId) this link create a cycle? */
export function wouldCycle(def, mode, roleId, link) {
  let node = targetOf(def, mode, link);
  for (let i = 0; i < 1000; i++) {
    if (node.mode === mode && node.id === roleId) return true;
    const l = def.modes[node.mode]?.roles[node.id]?.link;
    if (!isPlainObject(l) || !isRoleId(l.to)) return false;
    node = targetOf(def, node.mode, l);
  }
  return true;
}

function sanitizeLink(spec) {
  const out = { to: spec.to };
  if (isMode(spec.mode)) out.mode = spec.mode;
  if (fin(spec.dL)) out.dL = round(clamp(spec.dL, -1, 1), DP_COLOR);
  if (fin(spec.dC)) out.dC = round(clamp(spec.dC, -0.5, 0.5), DP_COLOR);
  if (fin(spec.dH)) out.dH = round(clamp(spec.dH, -360, 360), DP_DEG);
  if (fin(spec.a)) out.a = round(clamp(spec.a, 0, 1), DP_COLOR);
  return out;
}

/**
 * Set a role's link: 'auto' | 'custom' | { to, mode?, dL?, dC?, dH?, a? }.
 * - 'custom' freezes the CURRENT resolved value ("Make custom": no visual jump).
 * - Locked roles stay custom: the call is ignored until the role is unlocked.
 * - A link that would create a cycle, or that targets an unknown role, is ignored.
 */
export function setRoleLink(def, mode, roleId, link) {
  if (!isMode(mode) || !isRoleId(roleId)) return def;
  const role = def.modes[mode].roles[roleId];
  if (role.locked) return def;
  if (link === 'auto') {
    if (role.link === 'auto') return def;
    return withRole(def, mode, roleId, { ...role, link: 'auto' });
  }
  if (link === 'custom') {
    if (role.link === 'custom') return def;
    const cur = resolveTheme(def, mode).roles[roleId].oklch;
    return withRole(def, mode, roleId, { ...role, link: 'custom', custom: canonicalCustom(cur) });
  }
  if (!isPlainObject(link) || !isRoleId(link.to)) return def;
  const spec = sanitizeLink(link);
  if (wouldCycle(def, mode, roleId, spec)) return def;
  return withRole(def, mode, roleId, { ...role, link: spec });
}

/** Lock a role (converting it to Custom with its current value first) or unlock it. */
export function setLocked(def, mode, roleId, locked) {
  if (!isMode(mode) || !isRoleId(roleId)) return def;
  const role = def.modes[mode].roles[roleId];
  if (!locked) {
    if (!role.locked) return def;
    const { locked: _drop, ...rest } = role;
    return withRole(def, mode, roleId, rest);
  }
  if (role.locked) return def;
  let next = role;
  if (role.link !== 'custom') {
    const cur = resolveTheme(def, mode).roles[roleId].oklch;
    next = { ...role, link: 'custom', custom: canonicalCustom(cur) };
  }
  return withRole(def, mode, roleId, { ...next, locked: true });
}

function baselineRole(mode, roleId) {
  return clone(BASELINE_DEFINITION.modes[mode].roles[roleId]);
}

/** Return one role to its baseline state (also unlocks it: an explicit user action). */
export function resetRole(def, mode, roleId) {
  if (!isMode(mode) || !isRoleId(roleId)) return def;
  const next = baselineRole(mode, roleId);
  const cur = def.modes[mode].roles[roleId];
  if (JSON.stringify(cur) === JSON.stringify(next)) return def;
  return withRole(def, mode, roleId, next);
}

/** Reset a whole palette (settings + every NON-locked role) to the baseline. */
export function resetMode(def, mode) {
  if (!isMode(mode)) return def;
  let out = def;
  const bs = BASELINE_DEFINITION.modes[mode].settings;
  out = setModeSettings(out, mode, bs);
  for (const id of ROLE_IDS) {
    if (out.modes[mode].roles[id].locked) continue;
    out = resetRole(out, mode, id);
  }
  return out;
}

/**
 * Copy role states from one palette to the other.
 * - destination roles that are locked are skipped (unless skipLocked:false)
 * - the `locked` flag is never copied; cross-mode `link.mode` is rebased to the destination
 * - copies that would create a link cycle are skipped
 * - mode settings are copied only with { settings:true }
 */
export function copyMode(def, from, to, opts = {}) {
  if (!isMode(from) || !isMode(to) || from === to) return def;
  const { roleIds = ROLE_IDS, skipLocked = true, settings = false } = opts;
  let out = def;
  if (settings) out = setModeSettings(out, to, out.modes[from].settings);
  for (const id of roleIds) {
    if (!isRoleId(id)) continue;
    const dest = out.modes[to].roles[id];
    if (skipLocked && dest.locked) continue;
    const src = def.modes[from].roles[id];
    const next = clone({ ...src, locked: undefined });
    delete next.locked;
    if (isPlainObject(next.link)) {
      delete next.link.mode;
      if (wouldCycle(out, to, id, next.link)) continue;
    }
    if (JSON.stringify(dest) === JSON.stringify(next)) continue;
    out = withRole(out, to, id, next);
  }
  return out;
}

/** Make roles in `to` follow the same role in `from` (a cross-mode link). */
export function linkModes(def, from, to, roleIds = ROLE_IDS) {
  if (!isMode(from) || !isMode(to) || from === to) return def;
  let out = def;
  for (const id of roleIds) {
    if (!isRoleId(id)) continue;
    const dest = out.modes[to].roles[id];
    if (dest.locked) continue;
    const spec = { to: id, mode: from };
    if (wouldCycle(out, to, id, spec)) continue;
    out = withRole(out, to, id, { ...dest, link: spec });
  }
  return out;
}

// ---------- scene ----------

function withScene(def, mode, next) {
  if (next === def.scene[mode]) return def;
  return { ...def, scene: { ...def.scene, [mode]: next } };
}

export function setSceneSource(def, mode, source) {
  if (!isMode(mode) || (source !== 'follow' && source !== 'custom')) return def;
  const cur = def.scene[mode];
  return cur.source === source ? def : withScene(def, mode, { ...cur, source });
}

const FOLLOW_RANGES = {
  hueShiftDeg: [-180, 180, DP_DEG],
  saturationMul: [0, 1.5, DP_COLOR],
  lightnessDelta: [-0.5, 0.5, DP_COLOR],
  opacityMul: [0, 3, DP_COLOR],
  hueSpan: [0.05, 1, DP_COLOR],
};

export function setSceneFollow(def, mode, patch = {}) {
  if (!isMode(mode)) return def;
  const cur = def.scene[mode];
  const follow = { ...cur.follow };
  for (const [k, [min, max, dp]] of Object.entries(FOLLOW_RANGES)) {
    if (fin(patch[k])) follow[k] = round(clamp(patch[k], min, max), dp);
  }
  return shallowEqual(follow, cur.follow) ? def : withScene(def, mode, { ...cur, follow });
}

function oklchPatch(cur, patch) {
  const next = { ...cur };
  if (fin(patch.l)) next.l = round(clamp(patch.l, 0, 1), DP_COLOR);
  if (fin(patch.c)) next.c = round(clamp(patch.c, 0, 0.5), DP_COLOR);
  if (fin(patch.h)) next.h = wrapRound(patch.h, DP_DEG);
  return next;
}

/** patch: { base?, secondary? (partial OKLCH or null), highlight?, highlightStrength?, opacityMul? } */
export function setSceneCustom(def, mode, patch = {}) {
  if (!isMode(mode)) return def;
  const cur = def.scene[mode];
  const custom = { ...cur.custom };
  if (isPlainObject(patch.base)) custom.base = oklchPatch(custom.base, patch.base);
  if (patch.secondary === null) custom.secondary = null;
  else if (isPlainObject(patch.secondary)) custom.secondary = oklchPatch(custom.secondary || custom.base, patch.secondary);
  if (isPlainObject(patch.highlight)) custom.highlight = oklchPatch(custom.highlight, patch.highlight);
  if (fin(patch.highlightStrength)) custom.highlightStrength = round(clamp(patch.highlightStrength, 0, 1), DP_COLOR);
  if (fin(patch.opacityMul)) custom.opacityMul = round(clamp(patch.opacityMul, 0, 3), DP_COLOR);
  return JSON.stringify(custom) === JSON.stringify(cur.custom) ? def : withScene(def, mode, { ...cur, custom });
}

export function resetScene(def, mode) {
  if (!isMode(mode)) return def;
  const next = clone(BASELINE_DEFINITION.scene[mode]);
  return JSON.stringify(next) === JSON.stringify(def.scene[mode]) ? def : withScene(def, mode, next);
}

// ---------- palette combos (Studio "click to try") ----------

/**
 * Apply a palette combo: a small patch over the parametric controls
 * (master hue/intensity, support offsets, neutral tint, per-mode settings,
 * scene follow). Composes the setters above, so it never touches custom or
 * locked roles and returns the SAME object when nothing changes.
 * preset.patch: { hue?, intensity?, offsets?, neutral?, modes?: {light?, dark?}, scene?: {light?, dark?} }
 */
export function applyPalettePreset(def, preset) {
  const p = preset && isPlainObject(preset.patch) ? preset.patch : null;
  if (!p) return def;
  let next = def;
  if (fin(p.hue)) next = setMasterHue(next, p.hue);
  if (fin(p.intensity)) next = setIntensity(next, p.intensity);
  if (isPlainObject(p.offsets)) {
    for (const k of ['accentBright', 'support1', 'support2']) if (fin(p.offsets[k])) next = setOffset(next, k, p.offsets[k]);
  }
  if (isPlainObject(p.neutral)) next = setNeutral(next, p.neutral);
  if (isPlainObject(p.modes)) {
    for (const m of MODES) if (isPlainObject(p.modes[m])) next = setModeSettings(next, m, p.modes[m]);
  }
  if (isPlainObject(p.scene)) {
    for (const m of MODES) if (isPlainObject(p.scene[m])) next = setSceneFollow(next, m, p.scene[m]);
  }
  return next;
}
