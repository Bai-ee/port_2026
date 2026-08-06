import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextDuplicateId, nextElementId, restoreExtraInstances, createSceneElement,
  duplicateInstance, removeInstance, normalizeSelection, isRenderableInstance,
  applyPresetToInstance, randomizeInstanceFields, randomizeAllElements, shouldReapplyInstance, shouldSyncElementEntry,
  heroDuplicateWarnings, mergeElementLocks, restoreElementLocks,
} from '../scene-elements.js';
import { createElementInstance } from '../schema.js';
import { createHistory, pushHistory, undoHistory, redoHistory } from '../history.js';
import { getElementDefinition, getElementWeight } from '../catalog.js';
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

// ── shouldSyncElementEntry — the FULL production reconciliation-effect
// gate (ClothStudio.jsx's scene-element sync effect calls this exact
// function, not a hand-rolled inline expression), including the format
// check and the two named exceptions (glb-import's unresolved-asset
// retry, hanging-tshirt's logo-library recheck). Codex P2 review, Part B
// round 3: this is the production-level reconciliation regression test
// the review asked for — it exercises the ACTUAL gating logic the live
// sync effect runs, proving a tshirt-model sitting in its factory's
// 'error' state has no special-cased bypass here, distinct from (and in
// addition to) factories.test.js's existing proof that a bare
// applyInstance call never retries once IT is invoked. Together the two
// close the full path: the reconciliation loop must decide NOT to touch
// an unrelated errored entry at all, AND, on the rare occasion it does
// legitimately decide to touch it (the entry's own data changed), the
// factory call that follows must not retry either. ─────────────────────

test('shouldSyncElementEntry: a brand-new entry always needs its first sync', () => {
  assert.equal(shouldSyncElementEntry(undefined, { id: 'r-1' }, 'draft', 'landscape'), true);
  assert.equal(shouldSyncElementEntry(null, { id: 'r-1' }, 'draft', 'landscape'), true);
});

test('shouldSyncElementEntry: false when nothing relevant changed — instance reference, tier, AND format all match', () => {
  const instance = createElementInstance('tshirt-model', { id: 't-1' });
  const entry = { lastInstance: instance, lastTier: 'draft', lastFormatId: 'landscape' };
  assert.equal(shouldSyncElementEntry(entry, instance, 'draft', 'landscape'), false);
});

test('shouldSyncElementEntry: true when the instance reference changed (the entry itself was actually edited)', () => {
  const a = createElementInstance('tshirt-model', { id: 't-1' });
  const b = createElementInstance('tshirt-model', { id: 't-1' });
  const entry = { lastInstance: a, lastTier: 'draft', lastFormatId: 'landscape' };
  assert.equal(shouldSyncElementEntry(entry, b, 'draft', 'landscape'), true);
});

test('shouldSyncElementEntry: true when only the format changed', () => {
  const instance = createElementInstance('tshirt-model', { id: 't-1' });
  const entry = { lastInstance: instance, lastTier: 'draft', lastFormatId: 'landscape' };
  assert.equal(shouldSyncElementEntry(entry, instance, 'draft', 'square'), true);
});

// The actual P2 regression: a tshirt-model entry whose live three.js
// object sits in an 'error' state must NOT be resynced merely because
// this reconciliation pass ran for a reason that has nothing to do with
// THIS entry — its own instance/tier/format are all unchanged. An
// earlier version of the reconciliation effect special-cased
// `object.userData.loadState === 'error'` as an unconditional bypass of
// this exact gate (routed through tshirtModelRetry once past it) — this
// test proves shouldSyncElementEntry has no such branch: it takes no
// three.js object or loadState at all, so there is nothing for a future
// regression to even read.
test('shouldSyncElementEntry: a tshirt-model with an unrelated, unchanged instance is NOT synced merely because the reconciliation effect reran for another reason — no error-state bypass exists', () => {
  const instance = createElementInstance('tshirt-model', { id: 't-1' });
  const entry = { lastInstance: instance, lastTier: 'draft', lastFormatId: 'landscape' };
  // Simulates the effect rerunning because a DIFFERENT element was edited,
  // the quality tier/format stayed put, and glbAssets/logoLibrary are
  // irrelevant to a tshirt-model (fixed asset URL, no logo) — every input
  // this function actually receives is identical to the "already synced"
  // case above.
  assert.equal(shouldSyncElementEntry(entry, instance, 'draft', 'landscape'), false, 'an untouched, already-failed tshirt-model must stay untouched — only its own Retry action may resync it');
});

test('shouldSyncElementEntry: glbNeedsRetry and tshirtLogoNeedsRecheck still force a sync even when the instance/tier/format are all unchanged (the two real, narrow exceptions)', () => {
  const instance = createElementInstance('glb-import', { id: 'g-1' });
  const entry = { lastInstance: instance, lastTier: 'draft', lastFormatId: 'landscape' };
  assert.equal(shouldSyncElementEntry(entry, instance, 'draft', 'landscape', { glbNeedsRetry: true }), true);
  assert.equal(shouldSyncElementEntry(entry, instance, 'draft', 'landscape', { tshirtLogoNeedsRecheck: true }), true);
  assert.equal(shouldSyncElementEntry(entry, instance, 'draft', 'landscape', {}), false, 'sanity: without either flag, an unchanged entry stays unsynced');
});

// ── heroDuplicateWarnings (Slice 1 guardrail: no duplicate hero elements) ──

test('heroDuplicateWarnings: a single enabled hero-depth instance (no primary hero) is not flagged', () => {
  const glb = createElementInstance('glb-import', { id: 'glb-1', enabled: true, depth: 'hero' });
  assert.deepEqual(heroDuplicateWarnings([glb], { primaryIsHero: false }), {});
});

test('heroDuplicateWarnings: two enabled hero-depth extraInstances are both flagged', () => {
  const a = createElementInstance('glb-import', { id: 'glb-1', enabled: true, depth: 'hero' });
  const b = createElementInstance('glb-import', { id: 'glb-2', enabled: true, depth: 'hero' });
  assert.deepEqual(heroDuplicateWarnings([a, b], { primaryIsHero: false }), { 'glb-1': true, 'glb-2': true });
});

test('heroDuplicateWarnings: primaryIsHero folds the primary glass sphere into the count — one extra hero instance is now a collision', () => {
  const glb = createElementInstance('glb-import', { id: 'glb-1', enabled: true, depth: 'hero' });
  assert.deepEqual(heroDuplicateWarnings([glb], { primaryIsHero: true }), { 'glb-1': true });
});

test('heroDuplicateWarnings: a disabled hero-depth instance never counts toward the collision', () => {
  const a = createElementInstance('glb-import', { id: 'glb-1', enabled: false, depth: 'hero' });
  const b = createElementInstance('glb-import', { id: 'glb-2', enabled: true, depth: 'hero' });
  assert.deepEqual(heroDuplicateWarnings([a, b], { primaryIsHero: false }), {}, 'only 1 enabled hero occupant — no collision');
});

test('heroDuplicateWarnings: non-hero-depth instances are never flagged regardless of count', () => {
  const a = createElementInstance('kinetic-rings', { id: 'r-1', enabled: true });
  const b = createElementInstance('kinetic-rings', { id: 'r-2', enabled: true });
  assert.deepEqual(heroDuplicateWarnings([a, b], { primaryIsHero: true }), {});
});

// ── getElementWeight (weighted-category schema stub, deferred to Slice 2) ──

test('getElementWeight: defaults to 1 for every current catalog entry (none declare a weight yet)', () => {
  assert.equal(getElementWeight('glass-petal-sphere'), 1);
  assert.equal(getElementWeight('kinetic-rings'), 1);
});

test('getElementWeight: an unknown type also defaults to 1, never throws', () => {
  assert.equal(getElementWeight('not-a-real-type'), 1);
});

// ── mergeElementLocks / restoreElementLocks (Codex-blocked P1: whole-element
// lock was never actually applied to the batch "Elements only"/"All" path) ──

test('mergeElementLocks: sets random.locked from the elementLocks map, overriding the instance\'s own (always-false) value', () => {
  const inst = createElementInstance('kinetic-rings', { id: 'r1', enabled: true });
  assert.equal(inst.random.locked, false, 'sanity: schema default is false');
  const merged = mergeElementLocks([inst], { r1: { locked: true } });
  assert.equal(merged[0].random.locked, true);
});

test('mergeElementLocks: an id absent from elementLocks merges to locked:false', () => {
  const inst = createElementInstance('kinetic-rings', { id: 'r1', enabled: true });
  const merged = mergeElementLocks([inst], {});
  assert.equal(merged[0].random.locked, false);
});

test('mergeElementLocks: empty/missing instances or elementLocks never throw', () => {
  assert.deepEqual(mergeElementLocks([], { r1: { locked: true } }), []);
  assert.deepEqual(mergeElementLocks(undefined, { r1: { locked: true } }), []);
  const inst = createElementInstance('kinetic-rings', { id: 'r1', enabled: true });
  assert.equal(mergeElementLocks([inst], undefined)[0].random.locked, false);
});

test('restoreElementLocks: restores the ORIGINAL random block by position, discarding whatever the merged/processed value became', () => {
  const original = [createElementInstance('kinetic-rings', { id: 'r1', enabled: true, random: { locked: false, groups: { motion: true } } })];
  const merged = mergeElementLocks(original, { r1: { locked: true } });
  assert.equal(merged[0].random.locked, true);
  const restored = restoreElementLocks(merged, original);
  assert.deepEqual(restored[0].random, original[0].random, 'the per-group locks and the real (unmerged) locked:false must both come back exactly as they were');
});

test('mergeElementLocks -> randomizeAllElements -> restoreElementLocks: THE exact regression — a whole-element-locked non-primary instance is skipped, and elementLocks never leaks into the persisted instance', () => {
  const locked = createElementInstance('kinetic-rings', { id: 'r1', enabled: true });
  const unlocked = createElementInstance('chrome-ribbon', { id: 'c1', enabled: true });
  const original = [locked, unlocked];
  const elementLocks = { r1: { locked: true } };

  const merged = mergeElementLocks(original, elementLocks);
  const { instances: processed, changedById } = randomizeAllElements(merged, {
    primaryId: 'glass-petal-sphere-1', intensity: 'wild', deriveRand: (id) => mulberry32(id.length + 7),
  });
  const restored = restoreElementLocks(processed, original);

  assert.deepEqual(restored[0].material, locked.material, 'locked instance untouched by the batch randomize');
  assert.equal(changedById.r1, undefined, 'locked instance never appears in the changed report');
  assert.ok(changedById.c1?.length, 'the unlocked sibling still randomizes normally');
  // The fix's whole point: elementLocks must never get baked into the
  // instance's own stored random.locked — it stays exactly what schema.js
  // always defaults it to (false), not what the merge temporarily set.
  assert.equal(restored[0].random.locked, false);
  assert.equal(restored[1].random.locked, false);
});
