import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPlanDoc, validatePlan, normalizePlan, diffPlans, applyChange, revertTo,
} from '../plan-state.js';
import { DEFAULT_PLAN, PLAN_LIMITS } from '../contracts.js';

const base = (over = {}) => normalizePlan(over);
const req = (over = {}) => ({ changes: {}, by: 'owner', source: 'manual', reason: 'r', expectedVersion: 0, now: 1_000, ...over });
const errs = (plan) => validatePlan(plan).errors.join(' | ');

test('default plan validates; doc is version 0', () => {
  assert.equal(validatePlan(normalizePlan({})).ok, true);
  const d = defaultPlanDoc();
  assert.equal(d.version, 0);
  assert.deepEqual(d.plan, JSON.parse(JSON.stringify(DEFAULT_PLAN)));
});

test('authoredPerDay: 0, 17, 3.5, "4" rejected; 1 and 16 accepted', () => {
  for (const bad of [0, 17, 3.5, '4', null, NaN]) {
    const r = validatePlan({ ...base(), authoredPerDay: bad });
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(validatePlan(base({ authoredPerDay: 1, typeFloors: {} })).ok, true);
  assert.equal(validatePlan(base({ authoredPerDay: 16 })).ok, true);
});

test('tier derivation: 7 -> 1, 8 -> 2; tier mismatch rejected', () => {
  assert.equal(normalizePlan({ authoredPerDay: 7 }).tier, 1);
  assert.equal(normalizePlan({ authoredPerDay: 8 }).tier, 2);
  assert.match(errs({ ...base(), tier: 3 }), /tier/);
});

test('unknown slot type, reply/retweet floors+caps rejected', () => {
  assert.match(errs(base({ typeFloors: { bogus: 1 } })), /unknown slot type/);
  assert.match(errs(base({ typeCaps: { bogus: 1 } })), /unknown slot type/);
  assert.match(errs(base({ typeFloors: { reply: 1 } })), /not a calendar slot/);
  assert.match(errs(base({ typeCaps: { retweet: 1 } })), /not a calendar slot/);
  assert.match(errs(base({ typeFloors: { 'quote-react': -1 } })), /non-negative/);
  assert.match(errs(base({ typeFloors: { 'quote-react': 1.5 } })), /non-negative/);
});

test('floors exceeding the day, floor > cap', () => {
  assert.match(errs(base({ authoredPerDay: 2, typeFloors: { 'quote-react': 2, 'original-text': 1 } })), /exceeds authoredPerDay/);
  assert.equal(validatePlan(base({ authoredPerDay: 3, typeFloors: { 'quote-react': 2, 'original-text': 1 } })).ok, true);
  assert.match(errs(base({ typeFloors: { 'quote-react': 2 }, typeCaps: { 'quote-react': 1 } })), /exceeds typeCaps/);
});

test('bad engineTargets', () => {
  for (const bad of [
    [], 'x', { nope: 1 }, { authored: { bogus: 1 } }, { authored: { targetPerDay: 0 } },
    { authored: 5 }, { engines: { fake: { maxPerDay: 1 } } }, { engines: { identity: { minPerDay: 3, maxPerDay: 1 } } },
    { engines: { identity: { maxSharePct: 101 } } },
  ]) {
    assert.equal(validatePlan({ ...base(), engineTargets: bad }).ok, false, JSON.stringify(bad));
  }
  assert.equal(validatePlan(base({ engineTargets: { authored: { capPerDay: 8 }, engines: { record: { maxPerDay: 1 } } } })).ok, true);
});

test('benchmarkPrimary and notes', () => {
  for (const h of ['', '@seb__design', 'has space', 'x'.repeat(16), 5]) assert.equal(validatePlan({ ...base(), benchmarkPrimary: h }).ok, false, String(h));
  assert.equal(validatePlan({ ...base(), notes: 'x'.repeat(1001) }).ok, false);
  assert.equal(validatePlan({ ...base(), notes: 'x'.repeat(1000) }).ok, true);
  assert.equal(validatePlan({ ...base(), extra: 1 }).ok, false);
});

test('diffPlans reports changed paths only', () => {
  const a = base(); const b = base({ authoredPerDay: 8, typeCaps: { 'quote-commentary': 1 } });
  const d = diffPlans(a, b);
  assert.deepEqual(d.map((x) => x.path).sort(), ['authoredPerDay', 'tier', 'typeCaps.quote-commentary']);
  assert.deepEqual(diffPlans(a, base()), []);
});

test('applyChange: first write expectedVersion 0 from null creates v1 with history', () => {
  const r = applyChange(null, req({ changes: { authoredPerDay: 8 } }));
  assert.equal(r.version, 1);
  assert.equal(r.plan.authoredPerDay, 8);
  assert.equal(r.plan.tier, 2);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].version, 1);
  assert.equal(r.history[0].before.authoredPerDay, 4);
  assert.equal(r.history[0].after.authoredPerDay, 8);
  assert.equal(r.updatedAt, new Date(1_000).toISOString());
});

test('applyChange: stale expectedVersion -> conflict, input untouched', () => {
  const doc = applyChange(null, req({ changes: { authoredPerDay: 6 } }));
  const snapshot = JSON.stringify(doc);
  const r = applyChange(doc, req({ changes: { authoredPerDay: 7 }, expectedVersion: 0 }));
  assert.equal(r.error, 'version-conflict');
  assert.equal(r.currentVersion, 1);
  assert.equal(JSON.stringify(doc), snapshot);
});

test('applyChange: noop does not bump; invalid inputs do not apply', () => {
  const doc = applyChange(null, req({ changes: { authoredPerDay: 6 } }));
  assert.equal(applyChange(doc, req({ changes: { authoredPerDay: 6 }, expectedVersion: 1 })).error, 'noop');
  assert.equal(applyChange(doc, req({ changes: {}, expectedVersion: 1 })).error, 'noop');
  for (const bad of [
    req({ changes: { authoredPerDay: 17 }, expectedVersion: 1 }),
    req({ changes: { tier: 2 }, expectedVersion: 1 }),
    req({ changes: { zzz: 1 }, expectedVersion: 1 }),
    req({ expectedVersion: undefined }),
    req({ source: 'bot', expectedVersion: 1 }),
    req({ by: '', expectedVersion: 1 }),
  ]) assert.equal(applyChange(doc, bad).error, 'invalid');
  // lowering the day below existing floors is invalid
  const r = applyChange(doc, req({ changes: { authoredPerDay: 1, typeFloors: { 'quote-react': 1, 'original-text': 1 } }, expectedVersion: 1 }));
  assert.equal(r.error, 'invalid');
});

test('history capped at 30, oldest dropped, newest last', () => {
  let doc = null;
  for (let i = 0; i < 35; i += 1) {
    doc = applyChange(doc, req({ changes: { authoredPerDay: 2 + (i % 2) }, expectedVersion: i, now: 1_000 + i }));
    assert.ok(!doc.error, JSON.stringify(doc));
  }
  assert.equal(doc.version, 35);
  assert.equal(doc.history.length, PLAN_LIMITS.historyCap);
  assert.equal(doc.history[0].version, 6);
  assert.equal(doc.history.at(-1).version, 35);
});

test('proposalId stored only when given', () => {
  const a = applyChange(null, req({ changes: { notes: 'a' }, proposalId: 'p1' }));
  assert.equal(a.history[0].proposalId, 'p1');
  const b = applyChange(a, req({ changes: { notes: 'b' }, expectedVersion: 1 }));
  assert.equal('proposalId' in b.history[1], false);
});

test('revertTo restores plan exactly and bumps version', () => {
  let doc = applyChange(null, req({ changes: { authoredPerDay: 8, notes: 'one' } }));
  doc = applyChange(doc, req({ changes: { authoredPerDay: 12, typeCaps: { 'quote-commentary': 1 } }, expectedVersion: 1 }));
  doc = applyChange(doc, req({ changes: { benchmarkPrimary: 'someone' }, expectedVersion: 2 }));
  const v1plan = JSON.parse(JSON.stringify(doc.history[0].after));
  const r = revertTo(doc, 1, { by: 'owner', now: 5_000 });
  assert.equal(r.version, 4);
  assert.deepEqual(r.plan, v1plan);
  assert.equal(r.history.length, 4);
  assert.equal(r.history.at(-1).reason, 'revert to v1');
  // the revert itself is revertible
  assert.deepEqual(revertTo(r, 3, { by: 'owner' }).plan, doc.plan);
});

test('revertTo errors: dropped version, out of range, current (noop), no doc', () => {
  let doc = null;
  for (let i = 0; i < 35; i += 1) doc = applyChange(doc, req({ changes: { authoredPerDay: 2 + (i % 2) }, expectedVersion: i }));
  assert.equal(revertTo(doc, 2, { by: 'o' }).error, 'version-unavailable');
  assert.equal(revertTo(doc, 36, { by: 'o' }).error, 'invalid');
  assert.equal(revertTo(doc, 0, { by: 'o' }).error, 'invalid');
  assert.equal(revertTo(doc, 35, { by: 'o' }).error, 'noop');
  assert.equal(revertTo(null, 1, { by: 'o' }).error, 'invalid');
  assert.ok(!revertTo(doc, 6, { by: 'o' }).error);
});
