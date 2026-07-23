import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextDuplicateId, nextElementId, restoreExtraInstances, createSceneElement,
  duplicateInstance, removeInstance, normalizeSelection, isRenderableInstance,
  applyPresetToInstance, randomizeInstanceFields, randomizeAllElements, shouldReapplyInstance,
} from '../scene-elements.js';
import { createElementInstance } from '../schema.js';
import { createHistory, pushHistory, undoHistory, redoHistory } from '../history.js';
import { getElementDefinition } from '../catalog.js';
import { mulberry32 } from '../randomize.js';
import { DUPLICATE_OFFSET, defaultTransformForFormat } from '../placement.js';

const PRIMARY_ID = 'glass-petal-sphere-1';
const primary = () => createElementInstance('glass-petal-sphere', { id: PRIMARY_ID, name: 'Glass Petal Sphere', enabled: true });

// ── nextDuplicateId ──────────────────────────────────────────────────────────

test('nextDuplicateId: starts at 1 when no existing ids match the pattern', () => {
  assert.equal(nextDuplicateId('glass-petal-sphere', ['glass-petal-sphere-1']), 'glass-petal-sphere-dup-1');
});

test('nextDuplicateId: continues past the highest existing suffix', () => {
  const ids = ['glass-petal-sphere-1', 'glass-petal-sphere-dup-1', 'glass-petal-sphere-dup-3'];
  assert.equal(nextDuplicateId('glass-petal-sphere', ids), 'glass-petal-sphere-dup-4');
});

test('nextDuplicateId: reuses freed numbers once nothing currently holds them', () => {
  assert.equal(nextDuplicateId('glass-petal-sphere', ['glass-petal-sphere-1', 'glass-petal-sphere-dup-2']), 'glass-petal-sphere-dup-3');
});

// ── nextElementId ────────────────────────────────────────────────────────────

test('nextElementId: starts at 1 with no existing ids', () => {
  assert.equal(nextElementId('kinetic-rings', []), 'kinetic-rings-1');
});

test('nextElementId: continues past the highest existing suffix, scoped to exact type-N ids', () => {
  const ids = ['kinetic-rings-1', 'kinetic-rings-3', 'kinetic-rings-dup-9', 'chrome-ribbon-1'];
  assert.equal(nextElementId('kinetic-rings', ids), 'kinetic-rings-4'); // ignores dup-9 and the other type
});

// ── restoreExtraInstances ────────────────────────────────────────────────────

test('restoreExtraInstances: non-array input returns empty', () => {
  assert.deepEqual(restoreExtraInstances(undefined, { primaryId: PRIMARY_ID }), []);
});

test('restoreExtraInstances: rejects the primary id, unsupported types, malformed entries, repeat ids', () => {
  const out = restoreExtraInstances([
    { id: PRIMARY_ID, type: 'glass-petal-sphere' },
    { id: 'x-1', type: 'not-a-real-type' },
    { type: 'kinetic-rings' }, // no id
    { id: 'r-1', type: 'kinetic-rings' },
    { id: 'r-1', type: 'kinetic-rings' }, // repeat
  ], { primaryId: PRIMARY_ID });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'r-1');
});

test('restoreExtraInstances: enforces maxCount and normalizes survivors (clamped, unknown fields stripped)', () => {
  const raw = [
    { id: 'r-1', type: 'kinetic-rings', appearance: { count: 99, evil: 'x' } },
    { id: 'r-2', type: 'kinetic-rings' },
    { id: 'r-3', type: 'kinetic-rings' },
  ];
  const out = restoreExtraInstances(raw, { primaryId: PRIMARY_ID, maxCount: 2 });
  assert.equal(out.length, 2);
  assert.equal(out[0].appearance.count, 5); // clamped to catalog max
  assert.equal(out[0].appearance.evil, undefined);
});

// ── createSceneElement ───────────────────────────────────────────────────────

test('createSceneElement: adds a fresh, enabled instance and selects it', () => {
  const state = { extraInstances: [], selectedElementId: PRIMARY_ID };
  const next = createSceneElement(state, 'kinetic-rings', { maxCount: 8, formatId: 'landscape' });
  assert.equal(next.extraInstances.length, 1);
  assert.equal(next.extraInstances[0].type, 'kinetic-rings');
  assert.equal(next.extraInstances[0].enabled, true);
  assert.equal(next.selectedElementId, next.extraInstances[0].id);
});

test('createSceneElement: seeds position AND scale from the type/format deliberate default, not the origin at scale 1', () => {
  const state = { extraInstances: [], selectedElementId: PRIMARY_ID };
  const next = createSceneElement(state, 'chrome-ribbon', { maxCount: 8, formatId: 'reel' });
  const expected = defaultTransformForFormat('chrome-ribbon', 'reel', getElementDefinition('chrome-ribbon'));
  assert.deepEqual(next.extraInstances[0].transform.position, expected.position);
  assert.deepEqual(next.extraInstances[0].transform.scale, expected.scale);
  assert.notDeepEqual(next.extraInstances[0].transform.position, [0, 0, 0]);
});

test('createSceneElement: no-ops on an unsupported type or once maxCount is reached', () => {
  const state = { extraInstances: [], selectedElementId: PRIMARY_ID };
  assert.equal(createSceneElement(state, 'not-a-real-type', { maxCount: 8 }), state);
  const full = { extraInstances: [{ id: 'a' }, { id: 'b' }], selectedElementId: PRIMARY_ID };
  assert.equal(createSceneElement(full, 'kinetic-rings', { maxCount: 2 }), full);
});

// ── duplicateInstance (generalized: any source, not just the primary) ───────

test('duplicateInstance: cloning the primary (singleInstanceRenderer) always forces enabled:false', () => {
  const state = { extraInstances: [], selectedElementId: PRIMARY_ID };
  const source = primary(); // enabled: true
  const next = duplicateInstance(state, { source, primaryId: PRIMARY_ID, maxCount: 3 });
  assert.equal(next.extraInstances[0].enabled, false);
});

test('duplicateInstance: cloning a real element mirrors its enabled state', () => {
  const state = { extraInstances: [], selectedElementId: PRIMARY_ID };
  const source = createElementInstance('kinetic-rings', { id: 'r-1', enabled: true });
  const next = duplicateInstance(state, { source, primaryId: PRIMARY_ID, maxCount: 3 });
  assert.equal(next.extraInstances[0].enabled, true);
  assert.equal(next.extraInstances[0].type, 'kinetic-rings');
});

test('duplicateInstance: no-ops (same reference) once maxCount is reached', () => {
  const state = { extraInstances: [{ id: 'dup-1' }, { id: 'dup-2' }], selectedElementId: PRIMARY_ID };
  const next = duplicateInstance(state, { source: primary(), primaryId: PRIMARY_ID, maxCount: 2 });
  assert.equal(next, state);
});

test('duplicateInstance: a real element clone gets a deterministic position offset from its source (never overlaps exactly)', () => {
  const source = createElementInstance('kinetic-rings', { id: 'r-1', enabled: true, transform: { position: [0.5, 0.2, -0.4] } });
  const next = duplicateInstance({ extraInstances: [], selectedElementId: PRIMARY_ID }, { source, primaryId: PRIMARY_ID, maxCount: 8 });
  assert.deepEqual(next.extraInstances[0].transform.position, [
    Math.round((0.5 + DUPLICATE_OFFSET[0]) * 1000) / 1000,
    Math.round((0.2 + DUPLICATE_OFFSET[1]) * 1000) / 1000,
    Math.round((-0.4 + DUPLICATE_OFFSET[2]) * 1000) / 1000,
  ]);
  assert.notDeepEqual(next.extraInstances[0].transform.position, source.transform.position);
});

test('duplicateInstance: a glass (singleInstanceRenderer) clone keeps the source position untouched — no offset, nothing to overlap', () => {
  const source = primary();
  const next = duplicateInstance({ extraInstances: [], selectedElementId: PRIMARY_ID }, { source, primaryId: PRIMARY_ID, maxCount: 8 });
  assert.deepEqual(next.extraInstances[0].transform.position, source.transform.position);
});

// ── removeInstance ───────────────────────────────────────────────────────────

test('removeInstance: removes the instance and its lock, reselects primary', () => {
  const state = { extraInstances: [{ id: 'dup-1' }], elementLocks: { 'dup-1': { locked: true } }, selectedElementId: 'dup-1' };
  const next = removeInstance(state, 'dup-1', { primaryId: PRIMARY_ID });
  assert.deepEqual(next.extraInstances, []);
  assert.equal(next.elementLocks['dup-1'], undefined);
  assert.equal(next.selectedElementId, PRIMARY_ID);
});

test('removeInstance: no-ops on the primary id', () => {
  const state = { extraInstances: [], elementLocks: {}, selectedElementId: PRIMARY_ID };
  assert.equal(removeInstance(state, PRIMARY_ID, { primaryId: PRIMARY_ID }), state);
});

// ── normalizeSelection ───────────────────────────────────────────────────────

test('normalizeSelection: keeps a valid selection, falls back to primary once invalid', () => {
  assert.equal(normalizeSelection(PRIMARY_ID, [], PRIMARY_ID), PRIMARY_ID);
  assert.equal(normalizeSelection('dup-1', [{ id: 'dup-1' }], PRIMARY_ID), 'dup-1');
  assert.equal(normalizeSelection('dup-1', [{ id: 'dup-2' }], PRIMARY_ID), PRIMARY_ID);
});

// ── isRenderableInstance ─────────────────────────────────────────────────────

test('isRenderableInstance: true for the primary and any real (non-singleton) type, false for a glass duplicate', () => {
  assert.equal(isRenderableInstance({ id: PRIMARY_ID, type: 'glass-petal-sphere' }, PRIMARY_ID), true);
  assert.equal(isRenderableInstance({ id: 'glass-petal-sphere-dup-1', type: 'glass-petal-sphere' }, PRIMARY_ID), false);
  assert.equal(isRenderableInstance({ id: 'r-1', type: 'kinetic-rings' }, PRIMARY_ID), true);
});

// ── applyPresetToInstance ────────────────────────────────────────────────────

test('applyPresetToInstance: merges nested preset values, re-normalizing (clamped)', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  const def = getElementDefinition('kinetic-rings');
  const preset = def.presets[0]; // chrome-orbit
  const next = applyPresetToInstance(instance, preset);
  assert.equal(next.material.color, preset.values.material.color);
  assert.equal(next.appearance.count, preset.values.appearance.count);
  // untouched fields keep their prior values
  assert.equal(next.transform.scale[0], instance.transform.scale[0]);
});

test('applyPresetToInstance: no-op on a preset with no values', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  assert.equal(applyPresetToInstance(instance, {}), instance);
  assert.equal(applyPresetToInstance(instance, null), instance);
});

// ── randomizeInstanceFields ──────────────────────────────────────────────────

test('randomizeInstanceFields: same seed -> same result (reproducible); stays within catalog bounds', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  const def = getElementDefinition('kinetic-rings');
  const a = randomizeInstanceFields(instance, def, mulberry32(42));
  const b = randomizeInstanceFields(instance, def, mulberry32(42));
  assert.deepEqual(a, b);
  assert.ok(def.randomRanges.material.metalness[0] <= a.instance.material.metalness);
  assert.ok(a.instance.material.metalness <= def.randomRanges.material.metalness[1]);
  assert.ok(def.randomRanges.appearance.count[0] <= a.instance.appearance.count && a.instance.appearance.count <= def.randomRanges.appearance.count[1]);
  assert.ok(def.randomRanges.material.color.includes(a.instance.material.color));
});

test('randomizeInstanceFields: never touches transform (no safe-zone guardrails yet)', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1', transform: { position: [0.4, -0.2, 0.1] } });
  const { instance: next } = randomizeInstanceFields(instance, getElementDefinition('kinetic-rings'), mulberry32(7));
  assert.deepEqual(next.transform, instance.transform);
});

test('randomizeInstanceFields: default intensity ("remix") reproduces the EXACT pre-intensity output this function always returned — a strict behavioral no-op for every caller that does not opt in', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  const def = getElementDefinition('kinetic-rings');
  const withDefaultOptions = randomizeInstanceFields(instance, def, mulberry32(11));
  const withExplicitRemix = randomizeInstanceFields(instance, def, mulberry32(11), { intensity: 'remix' });
  assert.deepEqual(withDefaultOptions, withExplicitRemix);
});

test('randomizeInstanceFields: reports exactly which groups changed — never a bucket with no eligible fields, never a locked bucket', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  const def = getElementDefinition('kinetic-rings');
  const { changedGroups } = randomizeInstanceFields(instance, def, mulberry32(6));
  // kinetic-rings declares material + motion + appearance ranges (elements/catalog.js) — every reported
  // group must be one of those three; a specific seed's continuous fields (material.metalness/roughness,
  // motion.speed) reliably differ from their defaults, so both are asserted present. appearance.count is a
  // narrow integer range that can coincidentally re-roll its own current value — not asserted, to avoid a
  // seed-fragile test (see the dedicated lockedGroups assertion below for the "never appears" guarantee).
  changedGroups.forEach((g) => assert.ok(['material', 'motion', 'appearance'].includes(g)));
  assert.ok(changedGroups.includes('material'));
  assert.ok(changedGroups.includes('motion'));

  const { changedGroups: lockedOut } = randomizeInstanceFields(instance, def, mulberry32(6), { lockedGroups: { motion: true } });
  assert.ok(!lockedOut.includes('motion'), 'a locked group must never be reported as changed — it was never touched');
});

test('randomizeInstanceFields: a locked group\'s field values are left completely untouched', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  const { instance: next } = randomizeInstanceFields(instance, getElementDefinition('kinetic-rings'), mulberry32(6), {
    lockedGroups: { material: true, appearance: true },
  });
  assert.deepEqual(next.material, instance.material);
  assert.deepEqual(next.appearance, instance.appearance);
  assert.notDeepEqual(next.motion, instance.motion, 'sanity: the unlocked bucket should actually have rolled to something');
});

// ── randomizeAllElements ("Elements only" scope) ────────────────────────────

test('randomizeAllElements: randomizes every renderable, unlocked instance; skips the primary, locked, and non-renderable entries', () => {
  const locked = { ...createElementInstance('kinetic-rings', { id: 'locked-1' }), random: { locked: true, groups: {} } };
  const unlocked = createElementInstance('kinetic-rings', { id: 'unlocked-1' });
  const glassDuplicate = createElementInstance('glass-petal-sphere', { id: 'glass-dup-1' }); // singleInstanceRenderer -> never renders
  const { instances, changedById } = randomizeAllElements([locked, unlocked, glassDuplicate], {
    primaryId: PRIMARY_ID,
    deriveRand: (id) => mulberry32(id.length + 1),
  });
  assert.equal(instances.find((i) => i.id === 'locked-1'), locked, 'a whole-element-locked instance must be returned untouched (same reference)');
  assert.equal(instances.find((i) => i.id === 'glass-dup-1'), glassDuplicate, 'a non-renderable duplicate has nothing to vary — untouched');
  assert.notEqual(instances.find((i) => i.id === 'unlocked-1'), unlocked, 'the unlocked renderable instance must have actually changed');
  assert.ok(!changedById['locked-1']);
  assert.ok(changedById['unlocked-1']?.length > 0);
});

test('randomizeAllElements: each instance gets its OWN derived rand stream (deriveRand called per-id), not one shared stream', () => {
  const a = createElementInstance('kinetic-rings', { id: 'r-a' });
  const b = createElementInstance('kinetic-rings', { id: 'r-b' });
  const calledWith = [];
  randomizeAllElements([a, b], {
    primaryId: PRIMARY_ID,
    deriveRand: (id) => { calledWith.push(id); return mulberry32(1); },
  });
  assert.deepEqual(calledWith, ['r-a', 'r-b']);
});

test('randomizeAllElements: an empty/missing extraInstances list is a safe no-op', () => {
  assert.deepEqual(randomizeAllElements([], { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(1) }), { instances: [], changedById: {} });
  assert.deepEqual(randomizeAllElements(undefined, { primaryId: PRIMARY_ID, deriveRand: () => mulberry32(1) }), { instances: [], changedById: {} });
});

// ── Requested integration scenarios, generalized to a real (rendering) element ──

test('Duplicate -> Undo -> Redo: works the same for a real element, not just the primary', () => {
  let state = { extraInstances: [], elementLocks: {}, selectedElementId: PRIMARY_ID };
  let history = createHistory();
  const source = createElementInstance('kinetic-rings', { id: 'r-1', enabled: true });

  history = pushHistory(history, { extraInstances: state.extraInstances, elementLocks: state.elementLocks });
  state = duplicateInstance(state, { source, primaryId: PRIMARY_ID, maxCount: 8 });
  const dupId = state.extraInstances[0].id;
  assert.equal(state.extraInstances[0].enabled, true); // real element — mirrors source, not forced false

  const undone = undoHistory(history, { extraInstances: state.extraInstances, elementLocks: state.elementLocks });
  assert.deepEqual(undone.snapshot.extraInstances, []);

  const redone = redoHistory(undone.history, undone.snapshot);
  assert.equal(redone.snapshot.extraInstances[0].id, dupId);
});

test('Remove -> Undo: restores a real element and its lock state', () => {
  let state = duplicateInstance(
    { extraInstances: [], selectedElementId: PRIMARY_ID },
    { source: createElementInstance('kinetic-rings', { id: 'r-1', enabled: true }), primaryId: PRIMARY_ID, maxCount: 8 }
  );
  const dupId = state.extraInstances[0].id;
  state = { ...state, elementLocks: { [dupId]: { locked: true } } };

  let history = createHistory();
  history = pushHistory(history, { extraInstances: state.extraInstances, elementLocks: state.elementLocks });
  const afterRemove = removeInstance(state, dupId, { primaryId: PRIMARY_ID });

  const undone = undoHistory(history, { extraInstances: afterRemove.extraInstances, elementLocks: afterRemove.elementLocks });
  assert.equal(undone.snapshot.extraInstances[0].id, dupId);
  assert.equal(undone.snapshot.elementLocks[dupId].locked, true);
});

// ── shouldReapplyInstance — the sync-effect-level rebuild-churn guard ──────

test('shouldReapplyInstance: a brand-new entry (no prior bookkeeping) always needs its first apply', () => {
  assert.equal(shouldReapplyInstance(undefined, { id: 'r-1' }, 'draft'), true);
  assert.equal(shouldReapplyInstance(null, { id: 'r-1' }, 'draft'), true);
});

test('shouldReapplyInstance: false when neither the instance reference nor the tier changed', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  const entry = { lastInstance: instance, lastTier: 'draft' };
  assert.equal(shouldReapplyInstance(entry, instance, 'draft'), false);
});

test('shouldReapplyInstance: true when the instance reference changed (even if deep-equal)', () => {
  const a = createElementInstance('kinetic-rings', { id: 'r-1' });
  const b = createElementInstance('kinetic-rings', { id: 'r-1' }); // same content, different object
  const entry = { lastInstance: a, lastTier: 'draft' };
  assert.equal(shouldReapplyInstance(entry, b, 'draft'), true);
});

test('shouldReapplyInstance: true when only the tier changed', () => {
  const instance = createElementInstance('kinetic-rings', { id: 'r-1' });
  const entry = { lastInstance: instance, lastTier: 'draft' };
  assert.equal(shouldReapplyInstance(entry, instance, 'ultra'), true);
});

test('shouldReapplyInstance: an unrelated sibling instance (untouched by a setExtraInstances map) is correctly skippable', () => {
  // Simulates ClothStudio's setExtraInstances(prev => prev.map(...)) pattern:
  // editing ONE instance produces a new array where every OTHER entry keeps
  // its exact prior object reference.
  const a = createElementInstance('kinetic-rings', { id: 'r-1' });
  const b = createElementInstance('chrome-ribbon', { id: 'c-1' });
  const prevArray = [a, b];
  const nextArray = prevArray.map((i) => (i.id === 'r-1' ? { ...i, material: { ...i.material, color: '#000000' } } : i));
  const entryA = { lastInstance: a, lastTier: 'draft' };
  const entryB = { lastInstance: b, lastTier: 'draft' };
  assert.equal(shouldReapplyInstance(entryA, nextArray[0], 'draft'), true); // a changed
  assert.equal(shouldReapplyInstance(entryB, nextArray[1], 'draft'), false); // b untouched
});
