import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildClientPackage, applyApproval, STORY_PLACEHOLDER } from '../client-capture.js';
import { validateInventory, needsApproval } from '../schema.js';

const base = { client: 'Acme', project: 'Launch', problem: 'slow site', decision: 'static', rejectedIdea: 'SPA', result: 'fast' };

test('defaults: C6, engine client, approval needed, rights client-approval-needed, placeholder story', () => {
  const r = buildClientPackage(base);
  assert.equal(r.ok, true);
  assert.equal(r.pkg.series, 'C6');
  assert.equal(r.pkg.engine, 'client');
  assert.deepEqual(r.pkg.approval, { state: 'needed' });
  assert.equal(r.pkg.rights, 'client-approval-needed');
  assert.equal(r.pkg.story, STORY_PLACEHOLDER);
  assert.match(r.pkg.variants.x.suggestedStory, /Problem: slow site/);
  assert.equal(needsApproval(r.pkg), true);
});

test('story is only ever the supplied text; owned drops the gate', () => {
  const r = buildClientPackage({ ...base, story: 'I was in the room when it shipped.', rights: 'owned' });
  assert.equal(r.pkg.story, 'I was in the room when it shipped.');
  assert.equal(r.pkg.rights, 'owned');
  assert.equal(r.pkg.approval.state, 'none');
});

test('client is required', () => {
  const r = buildClientPackage({ project: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length);
});

test('applyApproval stamps state/by/at and rejects bad states', () => {
  const { pkg } = buildClientPackage(base);
  const a = applyApproval(pkg, 'approved', 'me@x.com', '2026-10-06T00:00:00.000Z');
  assert.deepEqual(a.approval, { state: 'approved', by: 'me@x.com', at: '2026-10-06T00:00:00.000Z' });
  assert.throws(() => applyApproval(pkg, 'maybe'));
});

test('client-stories.json: 16 valid idea rows, no fictional Fernwood, unmarked ones gated', () => {
  const rows = JSON.parse(readFileSync(new URL('../client-stories.json', import.meta.url), 'utf8'));
  assert.equal(rows.length, 16);
  const audit = validateInventory(rows);
  assert.equal(audit.valid, 16);
  assert.ok(rows.every((r) => r.status === 'idea' && r.story === STORY_PLACEHOLDER && r.engine === 'client'));
  assert.ok(!JSON.stringify(rows).toLowerCase().includes('fernwood'));
  assert.ok(rows.filter((r) => r.rights === 'owned').every((r) => r.approval.state === 'none'));
  assert.ok(rows.filter((r) => r.rights !== 'owned').every((r) => r.approval.state === 'needed'));
});
