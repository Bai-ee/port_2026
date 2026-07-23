import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, deriveSeed, randomInRange, pick, snapToStep } from '../randomize.js';

test('mulberry32: same seed produces the exact same sequence (reproducibility)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('mulberry32: different seeds diverge', () => {
  const a = mulberry32(1)();
  const b = mulberry32(2)();
  assert.notEqual(a, b);
});

test('deriveSeed: same inputs always derive the same numeric seed', () => {
  assert.equal(deriveSeed(7, 'glass-petal-sphere-1', 'material'), deriveSeed(7, 'glass-petal-sphere-1', 'material'));
});

test('deriveSeed: different elements/groups derive different seeds from the same base', () => {
  const s1 = deriveSeed(7, 'glass-petal-sphere-1', 'material');
  const s2 = deriveSeed(7, 'glass-petal-sphere-1', 'motion');
  const s3 = deriveSeed(7, 'other-element', 'material');
  assert.notEqual(s1, s2);
  assert.notEqual(s1, s3);
});

test('randomInRange: stays within [min, max] across many draws', () => {
  const rand = mulberry32(99);
  for (let i = 0; i < 200; i += 1) {
    const v = randomInRange(rand, [0.4, 2.2]);
    assert.ok(v >= 0.4 && v <= 2.2, `${v} out of range`);
  }
});

test('pick: only returns list members', () => {
  const rand = mulberry32(5);
  const list = ['#ffffff', '#f4c9d8', '#dfeef8'];
  for (let i = 0; i < 50; i += 1) {
    assert.ok(list.includes(pick(rand, list)));
  }
});

test('snapToStep: rounds to the nearest step', () => {
  assert.equal(snapToStep(0.4133333, 0.02), 0.42);
  assert.equal(snapToStep(1.001, 0.05), 1);
  assert.equal(snapToStep(5, 0), 5); // no step → passthrough
});
