import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanInputs } from '../plan-inputs.js';
import { normalizePlan } from '../plan-state.js';
import { DEFAULT_TYPE_FLOORS } from '../../x-content-inventory/daily-loop/slots.js';
import { DEFAULT_ENGINE_CONFIG, mergeEngineConfig } from '../../x-content-inventory/engine-quota.js';

const doc = (plan, version = 3) => ({ version, plan: normalizePlan(plan) });

test('no plan doc resolves to exactly today\'s defaults', () => {
  for (const none of [null, undefined, {}, { version: 1 }]) {
    const r = resolvePlanInputs(none);
    assert.equal(r.source, 'default');
    assert.equal(r.posts, undefined);
    assert.equal(r.engineConfig, undefined);
    assert.deepEqual(r.typeFloors, DEFAULT_TYPE_FLOORS);
    assert.deepEqual(r.typeCaps, {});
    assert.equal(r.benchmarkPrimary, null);
    assert.equal(r.planVersion, null);
  }
  // A fresh object each call: callers cannot mutate the shared default.
  const a = resolvePlanInputs(null);
  a.typeFloors['quote-react'] = 9;
  assert.deepEqual(resolvePlanInputs(null).typeFloors, DEFAULT_TYPE_FLOORS);
});

test('a plan doc drives posts, floors, caps, primary benchmark and version', () => {
  const r = resolvePlanInputs(doc({ authoredPerDay: 6, typeFloors: { 'quote-react': 2 }, typeCaps: { 'self-quote': 1 }, benchmarkPrimary: 'someone' }, 7));
  assert.equal(r.source, 'plan-doc');
  assert.equal(r.posts, 6);
  assert.equal(r.authoredPerDay, 6);
  assert.deepEqual(r.typeFloors, { 'quote-react': 2 });
  assert.deepEqual(r.typeCaps, { 'self-quote': 1 });
  assert.equal(r.benchmarkPrimary, 'someone');
  assert.equal(r.planVersion, 7);
});

test('engineConfig is merged only when engineTargets is non-empty', () => {
  assert.equal(resolvePlanInputs(doc({ authoredPerDay: 4 })).engineConfig, undefined);
  const targets = { authored: { targetPerDay: 3 } };
  const r = resolvePlanInputs(doc({ authoredPerDay: 3, engineTargets: targets }));
  assert.deepEqual(r.engineConfig, mergeEngineConfig(targets));
  assert.equal(r.engineConfig.authored.targetPerDay, 3);
  assert.notEqual(DEFAULT_ENGINE_CONFIG.authored.targetPerDay, 3);
});

test('an explicit empty typeFloors map means no floors; a missing one means the default floor', () => {
  assert.deepEqual(resolvePlanInputs(doc({ authoredPerDay: 4, typeFloors: {} })).typeFloors, {});
  const missing = { version: 1, plan: { authoredPerDay: 4 } };
  assert.deepEqual(resolvePlanInputs(missing).typeFloors, DEFAULT_TYPE_FLOORS);
});

test('an invalid authoredPerDay is ignored (posts undefined) rather than trusted', () => {
  assert.equal(resolvePlanInputs({ version: 1, plan: { authoredPerDay: 0 } }).posts, undefined);
  assert.equal(resolvePlanInputs({ version: 1, plan: { authoredPerDay: 'x' } }).posts, undefined);
});
