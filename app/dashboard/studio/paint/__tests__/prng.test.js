import test from 'node:test';
import assert from 'node:assert/strict';
import { createRand, deriveTemplateSeed, randomInRange, pick, snapToStep } from '../prng.js';
import { mulberry32, deriveSeed } from '../../elements/randomize.js';

test('createRand: same seed produces the exact same sequence as the underlying mulberry32', () => {
  const a = createRand(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('createRand: different seeds diverge', () => {
  assert.notEqual(createRand(1)(), createRand(2)());
});

test('deriveTemplateSeed: delegates to the shared deriveSeed with the same derivation rule', () => {
  assert.equal(
    deriveTemplateSeed(7, 'watercolour-bloom', 'palette'),
    deriveSeed(7, 'watercolour-bloom', 'palette'),
  );
});

test('deriveTemplateSeed: different templateId/purpose derive different seeds from the same base', () => {
  const s1 = deriveTemplateSeed(7, 'watercolour-bloom', 'palette');
  const s2 = deriveTemplateSeed(7, 'watercolour-bloom', 'density');
  const s3 = deriveTemplateSeed(7, 'botanical-weave', 'palette');
  assert.notEqual(s1, s2);
  assert.notEqual(s1, s3);
});

test('randomInRange / pick / snapToStep are re-exported unchanged (same behavior as ../elements/randomize.js)', () => {
  const rand = createRand(99);
  for (let i = 0; i < 50; i += 1) {
    const v = randomInRange(rand, [0, 1]);
    assert.ok(v >= 0 && v <= 1, `${v} out of range`);
  }
  const list = ['a', 'b', 'c'];
  const picked = pick(createRand(3), list);
  assert.ok(list.includes(picked));
  assert.equal(snapToStep(0.4133333, 0.02), 0.42);
});
