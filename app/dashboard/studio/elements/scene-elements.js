// Scene-element state helpers — add/duplicate/remove/restore/randomize/preset
// for every NON-PRIMARY instance in ClothStudio's Elements system (Phase 1 of
// docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md registered the glass
// shell; Phase 2 adds five real multi-instance-capable types on top of the
// same `extraInstances` array).
//
// Two kinds of non-primary instance share this one array:
//   - a DUPLICATE of a `singleInstanceRenderer` type (today: only
//     glass-petal-sphere) — data-only, can never have a live render object,
//     always opens (and stays) `enabled:false`.
//   - an instance of a real (non-singleton) type, whether created via "Add
//     Element" or duplicated from another real instance — genuinely
//     rendered by a factory (see factories.js) via ClothStudio's live-object
//     sync effect.
// Both are told apart purely by `getElementDefinition(type).singleInstanceRenderer`
// — nothing here or in ClothStudio hardcodes a type list.
//
// Pure logic — no React, no three.js — so every transition (including
// round-tripped through the undo/redo history stack in history.js) is
// directly unit-testable.

import { getElementDefinition } from './catalog.js';
import { createElementInstance, normalizeElementInstance } from './schema.js';
import { snapToStep } from './randomize.js';
import { defaultTransformForFormat, offsetPosition } from './placement.js';
import { DEFAULT_INTENSITY, rollNumeric, rollCategorical } from './intensity.js';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Next collision-safe DUPLICATE id for `type`, given every currently-known
 * instance id. IDs look like `${type}-dup-<n>`; scans every id for that
 * suffix (any type prefix) and returns the next integer above the highest
 * found. Safe to call at duplicate-time with the live id list — no
 * counter/ref to seed or keep in sync after a reload.
 */
export function nextDuplicateId(type, existingIds) {
  let maxN = 0;
  for (const id of existingIds || []) {
    const m = /-dup-(\d+)$/.exec(String(id || ''));
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return `${type}-dup-${maxN + 1}`;
}

/**
 * Next collision-safe FRESH-ELEMENT id for `type` (an "Add Element", not a
 * duplicate) — `${type}-<n>`, scoped to exact `${type}-<digits>` matches so
 * it never collides with (or is thrown off by) that type's `-dup-<n>` ids.
 */
export function nextElementId(type, existingIds) {
  const re = new RegExp(`^${escapeRegExp(type)}-(\\d+)$`);
  let maxN = 0;
  for (const id of existingIds || []) {
    const m = re.exec(String(id || ''));
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return `${type}-${maxN + 1}`;
}

/**
 * Validate + normalize a restored list of non-primary instances (rehydrating
 * Studio settings from localStorage). Rejects, per entry: non-object
 * entries, a missing/non-string `type`, an unsupported (unknown-to-the-
 * catalog) `type`, a missing/blank `id`, `id === primaryId`, and repeat
 * `id`s within the batch (first occurrence wins). Truncates to at most
 * `maxCount` surviving entries. Every surviving entry is run through
 * normalizeElementInstance, so its nested fields are clamped/allowlisted
 * exactly like any other instance — malformed field values don't reject the
 * whole entry, they just fall back to catalog defaults for that field.
 */
export function restoreExtraInstances(rawList, { primaryId, maxCount = Infinity } = {}) {
  if (!Array.isArray(rawList)) return [];
  const seenIds = new Set();
  const out = [];
  for (const raw of rawList) {
    if (out.length >= maxCount) break;
    if (!raw || typeof raw !== 'object') continue;
    const type = raw.type;
    if (typeof type !== 'string' || !getElementDefinition(type)) continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || id === primaryId || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(normalizeElementInstance(raw, type));
  }
  return out;
}

/**
 * Add a fresh instance of `type` (catalog defaults, opened enabled) to
 * `state.extraInstances`, selecting it. Its starting position AND scale come
 * from the type's deliberate per-format default transform
 * (elements/placement.js defaultTransformForFormat) for `formatId` — never
 * the origin at scale 1 by assumption; scale is shrunk below 1 only when the
 * type's actual bounding sphere needs it to genuinely clear the artwork and
 * stay framed (see placement.js's bounds-model comment).
 * No-ops (returns `state`, the SAME reference) once `maxCount` is reached,
 * or if `type` isn't a real catalog type. Never used for glass-petal-sphere
 * — that type is the primary and has no "add another" affordance (it's
 * singleInstanceRenderer, so even if added it could only ever be a
 * non-rendering duplicate; the UI only offers this action for real types).
 */
export function createSceneElement(state, type, { maxCount, formatId }) {
  if (state.extraInstances.length >= maxCount) return state;
  const def = getElementDefinition(type);
  if (!def) return state;
  const id = nextElementId(type, state.extraInstances.map((i) => i.id));
  const { position, scale } = defaultTransformForFormat(type, formatId, def);
  const created = createElementInstance(type, { id, enabled: true, transform: { position, scale } });
  return { ...state, extraInstances: [...state.extraInstances, created], selectedElementId: id };
}

/**
 * Add a duplicate of `source` (any currently-selected instance — the primary
 * or an existing extra) to `state.extraInstances`, selecting it. No-ops
 * (returns `state`, the SAME reference) once `maxCount` is reached — callers
 * can compare `result.extraInstances === state.extraInstances` to detect the
 * no-op. The clone mirrors `source.enabled` UNLESS `source.type` is
 * `singleInstanceRenderer`, in which case it is forced `false` — that type
 * can never render regardless of the flag, so `false` is the only honest
 * value. A RENDERABLE clone's position gets a small deterministic offset
 * (elements/placement.js DUPLICATE_OFFSET) so it doesn't render exactly on
 * top of its source — a glass duplicate skips the offset since its position
 * is inert (it never renders, so there's nothing to visually overlap).
 */
export function duplicateInstance(state, { source, primaryId, maxCount }) {
  if (state.extraInstances.length >= maxCount) return state;
  const def = getElementDefinition(source.type);
  const renders = !def?.singleInstanceRenderer;
  const id = nextDuplicateId(source.type, [primaryId, ...state.extraInstances.map((i) => i.id)]);
  const clone = normalizeElementInstance({
    id,
    name: `${source.name} copy`,
    enabled: renders ? source.enabled : false,
    depth: source.depth,
    transform: renders ? { ...source.transform, position: offsetPosition(source.transform.position) } : source.transform,
    material: source.material,
    motion: source.motion,
    appearance: source.appearance,
  }, source.type);
  return { ...state, extraInstances: [...state.extraInstances, clone], selectedElementId: id };
}

/**
 * Remove instance `id` from `state.extraInstances` and its `elementLocks`
 * entry (if any), reselecting `primaryId`. No-ops (returns `state` unchanged)
 * on the primary id itself — the rendered primary can't be removed, only
 * hidden via its own visibility toggle.
 */
export function removeInstance(state, id, { primaryId }) {
  if (id === primaryId) return state;
  const nextLocks = { ...state.elementLocks };
  delete nextLocks[id];
  return {
    ...state,
    extraInstances: state.extraInstances.filter((i) => i.id !== id),
    elementLocks: nextLocks,
    selectedElementId: primaryId,
  };
}

/**
 * A selection is valid if it's the primary id or an id present in
 * `extraInstances`. Used after every undo/redo (and on restore) so a
 * dangling selection — pointing at an instance a history jump just made not
 * exist — always falls back to the primary rather than silently pointing at
 * nothing.
 */
export function normalizeSelection(selectedElementId, extraInstances, primaryId) {
  if (selectedElementId === primaryId) return selectedElementId;
  return (extraInstances || []).some((i) => i.id === selectedElementId) ? selectedElementId : primaryId;
}

/**
 * True for any instance that a factory actually renders (see factories.js):
 * the primary, or any non-`singleInstanceRenderer` type. Used to scope the
 * "active/rendered" count and the performance budget so data-only
 * duplicates never inflate either, and to gate which extraInstances get a
 * live three.js object at all.
 */
export function isRenderableInstance(instance, primaryId) {
  if (instance.id === primaryId) return true;
  return !getElementDefinition(instance.type)?.singleInstanceRenderer;
}

/** Merge a catalog preset's nested `values` (transform/material/motion/appearance partials) into `instance`, re-normalizing. */
export function applyPresetToInstance(instance, preset) {
  if (!preset?.values) return instance;
  const v = preset.values;
  return normalizeElementInstance({
    ...instance,
    transform: { ...instance.transform, ...(v.transform || {}) },
    material: { ...instance.material, ...(v.material || {}) },
    motion: { ...instance.motion, ...(v.motion || {}) },
    appearance: { ...instance.appearance, ...(v.appearance || {}) },
  }, instance.type);
}

function findControlStep(def, bucket, key) {
  const c = (def?.controls || []).find((ctrl) => ctrl.bucket === bucket && ctrl.key === key);
  return c?.step;
}

/**
 * Seeded-random a real instance's material/motion/appearance fields from its
 * catalog `randomRanges` (nested by bucket, same shape as `fieldSpec`:
 * `{ material: { key: [min,max] | [...palette] }, motion: {...}, appearance: {...} }`).
 * `transform` (position/rotation) is deliberately never touched — no safe-
 * zone/collision guardrails exist yet (later phase). Numeric ranges snap to
 * that field's control step when the catalog declares one, so randomized
 * values land on the same grid the slider does.
 *
 * `intensity` (elements/intensity.js — Refine/Remix/Transform/Wild, plan
 * "Seeded randomization system" § Intensity) controls how far each field
 * moves; 'remix' (the default) is BYTE-IDENTICAL to this function's pre-
 * intensity behavior, so every existing caller that doesn't opt in is
 * unaffected. `lockedGroups` (a `{material,motion,appearance}` boolean map —
 * the instance's OWN `random.groups`, plan guardrail "allow the user to lock
 * any element or parameter group") skips a bucket entirely when true.
 *
 * Returns `{ instance, changedGroups }` — `changedGroups` is the plan's
 * "exact list of changed groups" guardrail: which of material/motion/
 * appearance actually rolled to a different value (a locked or range-less
 * bucket is never in this list; a bucket whose roll coincidentally lands
 * back on its current value also isn't — this reports real change, not
 * "was eligible to change").
 */
export function randomizeInstanceFields(instance, def, rand, { intensity = DEFAULT_INTENSITY, lockedGroups = {} } = {}) {
  const ranges = def?.randomRanges || {};
  const patch = { material: {}, motion: {}, appearance: {} };
  const changedGroups = [];
  ['material', 'motion', 'appearance'].forEach((bucket) => {
    if (lockedGroups[bucket]) return;
    const bucketRanges = ranges[bucket] || {};
    let bucketChanged = false;
    Object.keys(bucketRanges).forEach((key) => {
      const range = bucketRanges[key];
      if (!Array.isArray(range) || !range.length) return;
      const current = instance[bucket]?.[key];
      let v;
      if (typeof range[0] === 'number' && typeof range[1] === 'number' && range.length === 2) {
        const step = findControlStep(def, bucket, key);
        const rolled = rollNumeric(rand, current, range, intensity);
        v = step ? snapToStep(rolled, step) : rolled;
      } else {
        v = rollCategorical(rand, current, range, intensity);
      }
      patch[bucket][key] = v;
      if (v !== current) bucketChanged = true;
    });
    if (bucketChanged) changedGroups.push(bucket);
  });
  const next = normalizeElementInstance({
    ...instance,
    material: { ...instance.material, ...patch.material },
    motion: { ...instance.motion, ...patch.motion },
    appearance: { ...instance.appearance, ...patch.appearance },
  }, instance.type);
  return { instance: next, changedGroups };
}

/**
 * "Elements only" randomization scope (plan § Randomization scopes) — every
 * RENDERABLE, unlocked (whole-element `random.locked`) instance in one
 * atomic batch, each rolled independently (its own derived sub-seed, its own
 * `random.groups` lock respected). `primaryInstance` is handled the same as
 * any extraInstances entry EXCEPT it's excluded here — the primary's
 * randomRanges are flat (scale/rotSpeed/clarity/tintPalette), not bucketed
 * by material/motion/appearance, so it doesn't fit this bucketed function;
 * ClothStudio.jsx's own primary-specific randomize path already covers it
 * and callers should invoke both if "Elements only" is meant to include it.
 * Returns `{ instances, changedById }` — `instances` is the full next
 * `extraInstances` array (renderable-and-locked/non-renderable entries pass
 * through untouched), `changedById` maps id -> changedGroups for reporting.
 */
export function randomizeAllElements(extraInstances, { primaryId, deriveRand, intensity = DEFAULT_INTENSITY }) {
  const changedById = {};
  const instances = (extraInstances || []).map((inst) => {
    if (inst.id === primaryId) return inst;
    if (!isRenderableInstance(inst, primaryId)) return inst; // a glass duplicate — nothing to vary
    if (inst.random?.locked) return inst;
    const def = getElementDefinition(inst.type);
    if (!def) return inst;
    const rand = deriveRand(inst.id);
    const { instance: next, changedGroups } = randomizeInstanceFields(inst, def, rand, {
      intensity, lockedGroups: inst.random?.groups || {},
    });
    if (changedGroups.length) changedById[inst.id] = changedGroups;
    return next;
  });
  return { instances, changedById };
}

/**
 * True when a live-object entry needs `factory.applyInstance` called again —
 * i.e. the instance reference OR the quality tier changed since the entry
 * was last applied. `entry` is `{ lastInstance, lastTier }` (or absent for a
 * brand-new entry, which always needs its first apply). Immutable-update
 * state management means an UNCHANGED instance keeps the exact same object
 * reference across a `setExtraInstances` call — only the entry (or entries)
 * that actually changed get new references — so this reference check is
 * sufficient and cheap: it's what stops editing one element from
 * re-applying (and, inside each factory, potentially rebuilding) every
 * other element's geometry on every keystroke/drag.
 */
export function shouldReapplyInstance(entry, instance, tier) {
  if (!entry) return true;
  return entry.lastInstance !== instance || entry.lastTier !== tier;
}
