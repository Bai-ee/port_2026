import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENSITY_TIERS, INTENSITY_META, DEFAULT_INTENSITY, isValidIntensity,
  isNudge, biasesTowardExtremes, forcesCategoricalChange, rollNumeric, rollCategorical,
} from '../intensity.js';
import { mulberry32, randomInRange, pick } from '../randomize.js';

test('INTENSITY_TIERS / INTENSITY_META / DEFAULT_INTENSITY: all four plan tiers present with label+description, remix is the default', () => {
  assert.deepEqual(INTENSITY_TIERS, ['refine', 'remix', 'transform', 'wild']);
  INTENSITY_TIERS.forEach((t) => {
    assert.ok(INTENSITY_META[t].label);
    assert.ok(INTENSITY_META[t].description);
  });
  assert.equal(DEFAULT_INTENSITY, 'remix');
  assert.equal(isValidIntensity('remix'), true);
  assert.equal(isValidIntensity('made-up-tier'), false);
});

test('isNudge: only refine nudges near the current value', () => {
  assert.equal(isNudge('refine'), true);
  assert.equal(isNudge('remix'), false);
  assert.equal(isNudge('transform'), false);
  assert.equal(isNudge('wild'), false);
});

test('biasesTowardExtremes: only wild', () => {
  assert.equal(biasesTowardExtremes('wild'), true);
  assert.equal(biasesTowardExtremes('refine'), false);
  assert.equal(biasesTowardExtremes('remix'), false);
  assert.equal(biasesTowardExtremes('transform'), false);
});

test('forcesCategoricalChange: transform and wild only', () => {
  assert.equal(forcesCategoricalChange('transform'), true);
  assert.equal(forcesCategoricalChange('wild'), true);
  assert.equal(forcesCategoricalChange('refine'), false);
  assert.equal(forcesCategoricalChange('remix'), false);
});

test('rollNumeric: "remix" is byte-identical to the pre-existing randomInRange(rand, range) — the default tier is not a new behavior', () => {
  const rand1 = mulberry32(123);
  const rand2 = mulberry32(123);
  const range = [0.4, 2.2];
  for (let i = 0; i < 20; i += 1) {
    assert.equal(rollNumeric(rand1, 1, range, 'remix'), randomInRange(rand2, range));
  }
});

test('rollNumeric: "transform" is a flat full-range reroll too (same formula as remix, just a distinct name)', () => {
  const rand1 = mulberry32(9);
  const rand2 = mulberry32(9);
  const range = [0, 10];
  assert.equal(rollNumeric(rand1, 5, range, 'transform'), randomInRange(rand2, range));
});

test('rollNumeric: "refine" stays clamped within [min,max] and stays close to the current value across many rolls', () => {
  const rand = mulberry32(1);
  const range = [0, 100];
  const current = 50;
  let maxDeviation = 0;
  for (let i = 0; i < 500; i += 1) {
    const v = rollNumeric(rand, current, range, 'refine');
    assert.ok(v >= range[0] && v <= range[1], `refine roll ${v} escaped the declared range`);
    maxDeviation = Math.max(maxDeviation, Math.abs(v - current));
  }
  // spread is 8% of a 100-wide range = 8; +-1x spread clamp means deviation
  // should never exceed the spread by more than a small margin.
  assert.ok(maxDeviation <= 9, `refine strayed too far from composition: max deviation ${maxDeviation}`);
});

test('rollNumeric: "refine" with a missing/invalid current value falls back to a fresh in-range roll rather than NaN-ing', () => {
  const rand = mulberry32(2);
  const v = rollNumeric(rand, undefined, [0, 10], 'refine');
  assert.ok(Number.isFinite(v) && v >= 0 && v <= 10);
});

test('rollNumeric: "wild" stays within bounds and is statistically biased toward the extremes vs a flat "remix" roll', () => {
  const range = [0, 100];
  const mid = 50;
  const wildRand = mulberry32(77);
  const remixRand = mulberry32(77);
  let wildNearEdge = 0;
  let remixNearEdge = 0;
  const N = 2000;
  for (let i = 0; i < N; i += 1) {
    const w = rollNumeric(wildRand, mid, range, 'wild');
    const r = rollNumeric(remixRand, mid, range, 'remix');
    assert.ok(w >= range[0] && w <= range[1], 'wild roll escaped the declared range — "still valid" requires staying in bounds');
    if (w < 20 || w > 80) wildNearEdge += 1;
    if (r < 20 || r > 80) remixNearEdge += 1;
  }
  assert.ok(wildNearEdge > remixNearEdge, `wild (${wildNearEdge}/${N} near edges) should land near the extremes more often than a flat remix roll (${remixNearEdge}/${N})`);
});

const PALETTE = ['#ffffff', '#f4c9d8', '#dfeef8', '#fff3d0'];

test('rollCategorical: "remix" is byte-identical to the pre-existing pick(rand, list)', () => {
  const rand1 = mulberry32(55);
  const rand2 = mulberry32(55);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(rollCategorical(rand1, PALETTE[0], PALETTE, 'remix'), pick(rand2, PALETTE));
  }
});

test('rollCategorical: "transform"/"wild" always land on a value different from current when the list has more than one option', () => {
  const rand = mulberry32(3);
  for (let i = 0; i < 50; i += 1) {
    const v = rollCategorical(rand, PALETTE[0], PALETTE, 'transform');
    assert.notEqual(v, PALETTE[0]);
  }
});

test('rollCategorical: a single-option list can never satisfy "always different" — falls back to that one option rather than throwing/looping', () => {
  const rand = mulberry32(4);
  assert.equal(rollCategorical(rand, 'only-option', ['only-option'], 'transform'), 'only-option');
});

test('rollCategorical: an empty/non-array list returns the current value unchanged', () => {
  const rand = mulberry32(5);
  assert.equal(rollCategorical(rand, 'current', [], 'transform'), 'current');
  assert.equal(rollCategorical(rand, 'current', null, 'remix'), 'current');
});
