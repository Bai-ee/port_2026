import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, pushHistory, undoHistory, redoHistory } from '../history.js';
import { mulberry32, deriveSeed, pick, randomInRange } from '../randomize.js';

// Integration-level regression for the Look-history/seeded-randomize contract
// fixed in ClothStudio.jsx (Codex review, 2026-07-23T17:58:38Z): a Look
// randomization action must round-trip EVERY piece of state it mutates,
// including its seed, not just the visible fx/mat/etc fields — otherwise
// undo restores the look but leaves the seed counter stranded (the same
// snapshot-completeness contract element-history's own tests already prove
// for its own seed field). Uses `lookSeed` as the field name throughout,
// matching production (ClothStudio.jsx's Look scope owns an INDEPENDENT
// `lookSeed`, separate from the Elements scope's `sceneSeed` — a later
// review, 2026-07-23T18:24:04Z, found the two scopes originally shared one
// counter and fixed that; see cross-scope-seed-independence.test.js for the
// regression proving the two scopes' undo/redo can never affect each other).
// ClothStudio.jsx itself can't be imported here (a 'use client' component
// pulling in three.js/DOM) — this drives the exact same production
// primitives (elements/history.js, elements/randomize.js) through the exact
// sequence randomizeFx/applyLookMutation/undoLook/redoLook perform: snapshot
// BEFORE mutating (pushLookHistory then mutate, per applyLookMutation), seed
// included in both the snapshot and the restore.

const LOOK_IDS = ['a', 'b', 'c', 'd'];

// Mirrors randomizeFx's actual shape: derive a seeded rand off the NEXT seed,
// pick an id, jitter one numeric field — then the caller decides what to push
// through history, exactly like applyLookMutation(() => { setSceneSeed(...);
// applyFxPreset(id); setFx(...); }).
function rollLook(lookSeed) {
  const nextSeed = lookSeed + 1;
  const rand = mulberry32(deriveSeed(nextSeed, 'look', 'randomize'));
  const id = pick(rand, LOOK_IDS);
  const grain = randomInRange(rand, [0, 1]);
  return { lookSeed: nextSeed, fxPresetId: id, grain };
}

test('randomize -> undo restores the PRE-roll seed alongside the look (not just the look)', () => {
  let history = createHistory();
  const before = { lookSeed: 5, fxPresetId: '', grain: 0.2 };

  // applyLookMutation: push the pre-mutation snapshot, THEN mutate.
  history = pushHistory(history, before);
  const after = rollLook(before.lookSeed);

  assert.notEqual(after.lookSeed, before.lookSeed, 'sanity: the roll actually advanced the seed');

  const { history: h2, snapshot: restored } = undoHistory(history, after);
  assert.deepEqual(restored, before, 'undo must restore the seed the look was rolled FROM, not leave it stranded at the post-roll value');
  assert.equal(restored.lookSeed, 5);
  history = h2;

  const { snapshot: redone } = redoHistory(history, restored);
  assert.deepEqual(redone, after, 'redo must replay the exact previously-rolled state (id/grain/seed together), not recompute a fresh roll');
});

test('redo replays the ORIGINAL roll verbatim rather than re-rolling from the restored seed', () => {
  let history = createHistory();
  const before = { lookSeed: 5, fxPresetId: '', grain: 0.2 };
  history = pushHistory(history, before);
  const firstRoll = rollLook(before.lookSeed);

  const undone = undoHistory(history, firstRoll);
  history = undone.history;

  // If someone rolled AGAIN from the restored seed, it would reproduce the
  // same values (determinism) — redo must give back the ORIGINAL roll object
  // via history, not silently depend on that coincidence.
  const redone = redoHistory(history, undone.snapshot);
  assert.deepEqual(redone.snapshot, firstRoll);
});

test('rolling again from the seed undo restored reproduces the exact same result — the seed is genuinely usable after undo, not just present', () => {
  let history = createHistory();
  const before = { lookSeed: 5, fxPresetId: '', grain: 0.2 };
  history = pushHistory(history, before);
  const firstRoll = rollLook(before.lookSeed);

  const { snapshot: restored } = undoHistory(history, firstRoll);
  assert.equal(restored.lookSeed, before.lookSeed);

  // The actual point of fixing the contract: after undo, the NEXT randomize
  // draws from the correctly-restored seed and is therefore deterministic —
  // rolling from the restored seed reproduces the first roll bit-for-bit.
  const secondRollFromRestoredSeed = rollLook(restored.lookSeed);
  assert.deepEqual(secondRollFromRestoredSeed, firstRoll);
});

test('multiple randomize rolls each push their own pre-roll snapshot; undo walks back one seed step at a time', () => {
  let history = createHistory();
  let state = { lookSeed: 1, fxPresetId: '', grain: 0 };

  history = pushHistory(history, state);
  const roll1 = rollLook(state.lookSeed);
  state = roll1;

  history = pushHistory(history, state);
  const roll2 = rollLook(state.lookSeed);
  state = roll2;

  assert.equal(roll1.lookSeed, 2);
  assert.equal(roll2.lookSeed, 3);

  const undo1 = undoHistory(history, state);
  assert.deepEqual(undo1.snapshot, roll1, 'first undo steps back to the state after roll 1, seed included');

  const undo2 = undoHistory(undo1.history, undo1.snapshot);
  assert.deepEqual(undo2.snapshot, { lookSeed: 1, fxPresetId: '', grain: 0 }, 'second undo steps back to the original pre-roll state');
});
