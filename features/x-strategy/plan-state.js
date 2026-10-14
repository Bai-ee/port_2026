// plan-state.js - pure plan document logic for x_strategy_plans/{clientId} (T1c).
// Client-safe: no node:/firebase imports, no I/O. Source: X-STRATEGY-TAB-MASTER-PLAN.md section 5.
//
// Decisions (see tests):
// - Floors/caps are about CALENDAR slots (slots.js applyTypeFloors). 'reply' is a separate
//   daily-minimum quota slot appended outside the calendar and 'retweet' is manual/never filled,
//   so both are REJECTED as floor or cap keys (UNPLANNABLE_TYPES).
// - History is ordered OLDEST FIRST, newest LAST; capped at PLAN_LIMITS.historyCap by dropping the
//   oldest. Each entry stores `before`/`after` plan snapshots so any retained version can be restored.
// - A patch (`changes`) replaces whole top-level fields; typeFloors/typeCaps/engineTargets are
//   replaced as maps, not deep-merged. `tier` is derived and may not be set.
// - engineTargets.authored.targetPerDay is not cross-checked against authoredPerDay (separate knobs).

import { mergeEngineConfig } from '../x-content-inventory/engine-quota.js';
import { normalizeContentTracks } from './content-tracks.js';
import {
  DEFAULT_PLAN, PLAN_LIMITS, KNOWN_SLOT_TYPES, tierForAuthoredPerDay, isValidAuthoredPerDay,
} from './contracts.js';

export const UNPLANNABLE_TYPES = Object.freeze(['reply', 'retweet']);
export const PLAN_FIELDS = Object.freeze([
  'authoredPerDay', 'tier', 'typeFloors', 'typeCaps', 'engineTargets', 'benchmarkPrimary', 'notes', 'contentTracks',
]);
export const NOTES_MAX = 1000;
export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isCount = (v) => Number.isInteger(v) && v >= 0;

function toIso(now) {
  const d = now === undefined ? new Date() : new Date(now);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function defaultPlan() {
  return clone(DEFAULT_PLAN);
}

/** Fresh version-0 doc shape (never persisted by get; used as the base for a first write). */
export function defaultPlanDoc() {
  return { version: 0, updatedAt: null, updatedBy: null, plan: defaultPlan(), history: [] };
}

/** Merge a partial plan onto the defaults and derive tier. Does not validate. */
export function normalizePlan(partial) {
  const plan = { ...defaultPlan(), ...(isPlain(partial) ? clone(partial) : {}) };
  for (const k of Object.keys(plan)) if (!PLAN_FIELDS.includes(k)) delete plan[k];
  // contentTracks is optional: absent/null => the field stays off the plan (no tracks; tracksOf() returns []).
  // A valid list is stored normalized (shares sum to 1); an invalid one is kept raw so validatePlan reports why.
  if (plan.contentTracks == null) delete plan.contentTracks;
  else {
    try { plan.contentTracks = normalizeContentTracks(plan.contentTracks, { maxDistinctBenchmarks: PLAN_LIMITS.maxBenchmarkHandles }); } catch { /* validatePlan reports it */ }
  }
  if (isValidAuthoredPerDay(plan.authoredPerDay)) plan.tier = tierForAuthoredPerDay(plan.authoredPerDay);
  else delete plan.tier;
  return plan;
}

function collectEngineTargetErrors(overrides, merged, path, errors) {
  for (const [k, v] of Object.entries(overrides)) {
    const p = path ? `${path}.${k}` : k;
    const m = merged == null ? undefined : merged[k];
    if (isPlain(v)) {
      if (!isPlain(m)) { errors.push(`engineTargets.${p} is not accepted`); continue; }
      collectEngineTargetErrors(v, m, p, errors);
    } else if (JSON.stringify(m) !== JSON.stringify(v)) {
      errors.push(`engineTargets.${p} rejected (invalid, unknown, or conflicts with a min/max)`);
    }
  }
}

function validateMap(plan, field, errors) {
  const map = plan[field];
  if (!isPlain(map)) { errors.push(`${field} must be an object`); return; }
  for (const [type, n] of Object.entries(map)) {
    if (!KNOWN_SLOT_TYPES.includes(type)) errors.push(`${field}.${type}: unknown slot type`);
    else if (UNPLANNABLE_TYPES.includes(type)) errors.push(`${field}.${type}: not a calendar slot type (reply is a daily minimum, retweet is manual)`);
    if (!isCount(n)) errors.push(`${field}.${type} must be a non-negative integer`);
  }
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validatePlan(plan) {
  const errors = [];
  if (!isPlain(plan)) return { ok: false, errors: ['plan must be an object'] };
  for (const k of Object.keys(plan)) if (!PLAN_FIELDS.includes(k)) errors.push(`unknown field: ${k}`);

  const perDayOk = isValidAuthoredPerDay(plan.authoredPerDay);
  if (!perDayOk) {
    errors.push(`authoredPerDay must be an integer ${PLAN_LIMITS.authoredPerDayMin}-${PLAN_LIMITS.authoredPerDayMax}`);
  } else if (plan.tier !== tierForAuthoredPerDay(plan.authoredPerDay)) {
    errors.push('tier must equal the tier derived from authoredPerDay');
  }

  validateMap(plan, 'typeFloors', errors);
  validateMap(plan, 'typeCaps', errors);
  if (isPlain(plan.typeFloors) && isPlain(plan.typeCaps)) {
    let sum = 0;
    for (const [t, f] of Object.entries(plan.typeFloors)) {
      if (!isCount(f)) continue;
      sum += f;
      const cap = plan.typeCaps[t];
      if (isCount(cap) && f > cap) errors.push(`typeFloors.${t} (${f}) exceeds typeCaps.${t} (${cap})`);
    }
    if (perDayOk && sum > plan.authoredPerDay) errors.push(`typeFloors sum (${sum}) exceeds authoredPerDay (${plan.authoredPerDay})`);
  }

  if (!isPlain(plan.engineTargets)) {
    errors.push('engineTargets must be an object');
  } else {
    for (const k of Object.keys(plan.engineTargets)) {
      if (k !== 'authored' && k !== 'engines') errors.push(`engineTargets.${k}: unknown top-level key`);
    }
    const known = {};
    for (const k of ['authored', 'engines']) if (k in plan.engineTargets) known[k] = plan.engineTargets[k];
    let merged;
    try { merged = mergeEngineConfig(known); } catch { errors.push('engineTargets rejected by mergeEngineConfig'); }
    if (merged) collectEngineTargetErrors(known, merged, '', errors);
  }

  // '' = no benchmark set (the default: no client inherits one from code).
  if (typeof plan.benchmarkPrimary !== 'string' || (plan.benchmarkPrimary !== '' && !HANDLE_RE.test(plan.benchmarkPrimary))) {
    errors.push('benchmarkPrimary must be empty (no benchmark) or an X handle (1-15 letters, digits, underscore; no @)');
  }
  if (plan.contentTracks !== undefined) {
    try { normalizeContentTracks(plan.contentTracks, { maxDistinctBenchmarks: PLAN_LIMITS.maxBenchmarkHandles }); } catch (err) { errors.push(`contentTracks: ${err.message}`); }
  }
  if (typeof plan.notes !== 'string' || plan.notes.length > NOTES_MAX) errors.push(`notes must be a string of at most ${NOTES_MAX} chars`);

  return { ok: errors.length === 0, errors };
}

/** Deep diff of two plans -> [{path, from, to}] (top-level fields; maps/objects by key). */
export function diffPlans(a, b) {
  const out = [];
  const walk = (x, y, path) => {
    if (isPlain(x) && isPlain(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      out.push({ path, from: x === undefined ? null : x, to: y === undefined ? null : y });
    }
  };
  walk(a ?? {}, b ?? {}, '');
  return out;
}

function pushHistory(history, entry) {
  return [...history, entry].slice(-PLAN_LIMITS.historyCap);
}

/**
 * @param {object|null} doc  current doc (null/undefined = absent, treated as version 0)
 * @param {{changes:object, by:string, source:'manual'|'chat', reason?:string, proposalId?:string,
 *          expectedVersion:number, now?:Date|number|string}} req
 * @returns {object | {error:'version-conflict'|'invalid'|'noop', errors?:string[], currentVersion?:number}}
 */
export function applyChange(doc, req = {}) {
  const base = doc ?? defaultPlanDoc();
  const { changes, by, source, reason, proposalId, expectedVersion, now } = req;
  const errors = [];
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) errors.push('expectedVersion must be a non-negative integer');
  if (!isPlain(changes)) errors.push('changes must be an object');
  if (typeof by !== 'string' || !by.trim()) errors.push('by is required');
  if (source !== 'manual' && source !== 'chat') errors.push("source must be 'manual' or 'chat'");
  if (isPlain(changes)) {
    for (const k of Object.keys(changes)) {
      if (k === 'tier') errors.push('tier is derived from authoredPerDay and cannot be set');
      else if (!PLAN_FIELDS.includes(k)) errors.push(`unknown field: ${k}`);
    }
  }
  if (errors.length) return { error: 'invalid', errors };
  if (expectedVersion !== base.version) return { error: 'version-conflict', currentVersion: base.version };

  const before = clone(base.plan);
  const after = normalizePlan({ ...before, ...clone(changes) });
  const check = validatePlan(after);
  if (!check.ok) return { error: 'invalid', errors: check.errors };
  const diff = diffPlans(before, after);
  if (!diff.length) return { error: 'noop' };

  const at = toIso(now);
  const version = base.version + 1;
  const entry = { version, at, by, source, ...(proposalId ? { proposalId } : {}), diff, reason: reason ?? '', before, after: clone(after) };
  return { version, updatedAt: at, updatedBy: by, plan: after, history: pushHistory(base.history ?? [], entry) };
}

/**
 * Restore the plan as it stood AFTER `version`, written as a NEW version (history is never rewound).
 * @returns {object | {error:'invalid'|'version-unavailable'|'noop', errors?:string[]}}
 */
export function revertTo(doc, version, { by, now } = {}) {
  if (!doc) return { error: 'invalid', errors: ['no plan to revert'] };
  if (!Number.isInteger(version) || version < 1 || version > doc.version) return { error: 'invalid', errors: ['version out of range'] };
  if (typeof by !== 'string' || !by.trim()) return { error: 'invalid', errors: ['by is required'] };
  const target = (doc.history ?? []).find((h) => h.version === version);
  if (!target || !isPlain(target.after)) return { error: 'version-unavailable' };
  const before = clone(doc.plan);
  const after = clone(target.after);
  const diff = diffPlans(before, after);
  if (!diff.length) return { error: 'noop' };
  const at = toIso(now);
  const next = doc.version + 1;
  const entry = { version: next, at, by, source: 'manual', diff, reason: `revert to v${version}`, before, after: clone(after) };
  return { version: next, updatedAt: at, updatedBy: by, plan: after, history: pushHistory(doc.history ?? [], entry) };
}
