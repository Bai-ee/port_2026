import test from 'node:test';
import assert from 'node:assert/strict';
import { isCapStepLocked } from '../tier-access-config.js';

test('isCapStepLocked: admins are never locked, regardless of bucket/step', () => {
  assert.strictEqual(isCapStepLocked('brief', 0, true), false);
  assert.strictEqual(isCapStepLocked('deliverables', 5, true), false);
});

test('isCapStepLocked: non-admins are unlocked only on the deliverables bucket\'s step 0', () => {
  assert.strictEqual(isCapStepLocked('deliverables', 0, false), false);
});

test('isCapStepLocked: non-admins are locked on any other step of a gated bucket', () => {
  assert.strictEqual(isCapStepLocked('deliverables', 1, false), true);
});

test('isCapStepLocked: buckets with no unlocked-steps entry are never locked by this check', () => {
  assert.strictEqual(isCapStepLocked('brief', 0, false), false);
  assert.strictEqual(isCapStepLocked('growth', 2, false), false);
});
