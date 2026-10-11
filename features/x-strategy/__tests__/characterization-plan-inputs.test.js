// CHARACTERIZATION: pins resolvePlanInputs for an ABSENT / unusable plan doc (legacy defaults) and a few plan-doc edge shapes TODAY.
// Complements plan-inputs.test.js; not a spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanInputs } from '../plan-inputs.js';
import { DEFAULT_TYPE_FLOORS, TIER_1_MAX_POSTS } from '../../x-content-inventory/daily-loop/slots.js';

const LEGACY = {
  posts: undefined, engineConfig: undefined, typeFloors: { 'quote-react': 1 }, typeCaps: {},
  benchmarkPrimary: null, source: 'default', planVersion: null, authoredPerDay: null,
};

test('absent plan doc (null / undefined) => exactly the legacy defaults', () => {
  assert.deepEqual(resolvePlanInputs(null), LEGACY);
  assert.deepEqual(resolvePlanInputs(undefined), LEGACY);
  assert.deepEqual(resolvePlanInputs(), LEGACY);
});

test('unusable docs (no plan, plan not an object, array plan, primitives) also resolve to the legacy defaults', () => {
  for (const doc of [{}, { version: 3 }, { plan: null }, { plan: 'x' }, { plan: [1, 2] }, 'doc', 7, [], { version: 3, plan: undefined }]) {
    assert.deepEqual(resolvePlanInputs(doc), LEGACY, JSON.stringify(doc));
  }
});

test('legacy defaults: typeFloors is a COPY of DEFAULT_TYPE_FLOORS (mutating it does not touch the frozen default)', () => {
  const r = resolvePlanInputs(null);
  assert.deepEqual(r.typeFloors, DEFAULT_TYPE_FLOORS);
  assert.notEqual(r.typeFloors, DEFAULT_TYPE_FLOORS);
  r.typeFloors['quote-react'] = 9;
  assert.deepEqual(DEFAULT_TYPE_FLOORS, { 'quote-react': 1 });
  assert.notEqual(resolvePlanInputs(null).typeFloors, r.typeFloors);
});

test('an empty plan object is a plan doc: source plan-doc but every field falls back (floors default, no caps, no posts)', () => {
  const r = resolvePlanInputs({ plan: {} });
  assert.equal(r.source, 'plan-doc');
  assert.equal(r.posts, undefined);
  assert.equal(r.authoredPerDay, null);
  assert.equal(r.engineConfig, undefined);
  assert.deepEqual(r.typeFloors, { 'quote-react': 1 });
  assert.deepEqual(r.typeCaps, {});
  assert.equal(r.planVersion, null);
});

test('authoredPerDay is accepted as any integer >= 1 - resolvePlanInputs does NOT apply the Tier-1 clamp (slots.js does)', () => {
  assert.equal(resolvePlanInputs({ plan: { authoredPerDay: 16 } }).posts, 16);
  assert.ok(16 > TIER_1_MAX_POSTS);
  for (const bad of [0, -1, 2.5, '4', null, NaN]) {
    const r = resolvePlanInputs({ plan: { authoredPerDay: bad } });
    assert.equal(r.posts, undefined, String(bad));
    assert.equal(r.authoredPerDay, null, String(bad));
  }
});

test('an explicit {} typeFloors means NO floors (honoured); a missing map means the default floor', () => {
  assert.deepEqual(resolvePlanInputs({ plan: { typeFloors: {} } }).typeFloors, {});
  assert.deepEqual(resolvePlanInputs({ plan: {} }).typeFloors, { 'quote-react': 1 });
  assert.deepEqual(resolvePlanInputs({ plan: { typeFloors: [1] } }).typeFloors, { 'quote-react': 1 });
});

test('planVersion only when the doc version is an integer; empty engineTargets leaves engineConfig undefined', () => {
  assert.equal(resolvePlanInputs({ version: 4, plan: {} }).planVersion, 4);
  assert.equal(resolvePlanInputs({ version: '4', plan: {} }).planVersion, null);
  assert.equal(resolvePlanInputs({ version: 1.5, plan: {} }).planVersion, null);
  assert.equal(resolvePlanInputs({ plan: { engineTargets: {} } }).engineConfig, undefined);
  // engineTargets is handed to mergeEngineConfig as-is, so it must already be in { authored?, engines? } override shape.
  assert.equal(resolvePlanInputs({ plan: { engineTargets: { engines: { record: { maxPerDay: 1 } } } } }).engineConfig.engines.record.maxPerDay, 1);
  assert.equal(resolvePlanInputs({ plan: { engineTargets: { record: { maxPerDay: 1 } } } }).engineConfig.engines.record.maxPerDay, 2, 'bare engine map is silently ignored');
});

test('benchmarkPrimary: only a non-empty string survives', () => {
  assert.equal(resolvePlanInputs({ plan: { benchmarkPrimary: 'seb__design' } }).benchmarkPrimary, 'seb__design');
  for (const bad of ['', 5, null, {}]) assert.equal(resolvePlanInputs({ plan: { benchmarkPrimary: bad } }).benchmarkPrimary, null);
});
