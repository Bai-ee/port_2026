import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePackage, needsApproval, isApproved, PRIORITIES, FORMATS, APPROVAL_STATES, SOURCE_KINDS } from '../schema.js';
import { SERIES } from '../categories.js';
import { ENGINE_IDS, SERIES_ENGINE } from '../engines.js';

const base = { id: 'a', series: 'C1', pillar: 'found-this', title: 't', story: 'x'.repeat(50), mediaState: 'video', effort: 'ready', rights: 'owned', status: 'drafted' };
const errs = (extra) => validatePackage({ ...base, ...extra }).errors;
const ok = (extra) => assert.deepEqual(errs(extra), []);
const bad = (extra, frag) => assert.ok(errs(extra).some((e) => e.includes(frag)), `${JSON.stringify(extra)} -> ${errs(extra)}`);

test('legacy row without new fields stays valid', () => {
  assert.equal(validatePackage(base).ok, true);
});

test('enums are exported', () => {
  assert.deepEqual(PRIORITIES, ['pinned', 'timely', 'evergreen']);
  assert.deepEqual(FORMATS, ['video', 'still', 'text', 'thread', 'carousel']);
  assert.deepEqual(APPROVAL_STATES, ['none', 'needed', 'approved', 'rejected']);
  assert.deepEqual(SOURCE_KINDS, ['discogs', 'ue', 'manual', 'thread', 'rendered-video', 'nas-archive', 'ideas']);
});

test('engine', () => {
  for (const e of ENGINE_IDS) ok({ engine: e });
  bad({ engine: 'nope' }, 'engine');
});

test('source', () => {
  ok({ source: { kind: 'discogs', externalId: '123', url: 'https://x.test' } });
  ok({ source: { kind: 'manual' } });
  bad({ source: { kind: 'tiktok' } }, 'source.kind');
  bad({ source: 'discogs' }, 'source');
  bad({ source: { kind: 'ue', externalId: '' } }, 'externalId');
});

test('priority and expiresAt', () => {
  for (const p of PRIORITIES) ok({ priority: p });
  bad({ priority: 'urgent' }, 'priority');
  ok({ expiresAt: null });
  ok({ expiresAt: '2026-12-01T00:00:00Z' });
  bad({ expiresAt: 'soon' }, 'expiresAt');
});

test('campaign, related, tags', () => {
  ok({ campaign: null });
  ok({ campaign: 'launch', related: ['b', 'c'], tags: ['house'] });
  bad({ campaign: 5 }, 'campaign');
  bad({ related: 'b' }, 'related');
  bad({ related: [1] }, 'related');
  bad({ tags: [''] }, 'tags');
});

test('format', () => {
  for (const f of FORMATS) ok({ format: f });
  bad({ format: 'gif' }, 'format');
});

test('approval', () => {
  for (const state of APPROVAL_STATES) ok({ approval: { state } });
  ok({ approval: { state: 'approved', by: 'bryan', at: '2026-10-01T10:00:00Z' } });
  bad({ approval: { state: 'maybe' } }, 'approval.state');
  bad({ approval: { state: 'approved', at: 'yesterday' } }, 'approval.at');
  bad({ approval: 'approved' }, 'approval');
});

test('variants', () => {
  ok({ variants: { x: { copy: 'hi' }, instagram: {} } });
  bad({ variants: { tiktok: {} } }, 'variants key');
  bad({ variants: { x: 'str' } }, 'variants.x');
  bad({ variants: [] }, 'variants');
});

test('metrics and signals are type-checked only', () => {
  ok({ metrics: { anything: 1 }, signals: {} });
  bad({ metrics: [] }, 'metrics');
  bad({ signals: 'x' }, 'signals');
});

test('needsApproval / isApproved truth table', () => {
  const rows = [
    // [approval, rights, needsApproval, isApproved]
    [undefined, 'owned', false, false],
    [undefined, 'client-approval-needed', true, false],
    [{ state: 'none' }, 'client-approval-needed', false, false],
    [{ state: 'needed' }, 'owned', true, false],
    [{ state: 'rejected' }, 'owned', true, false],
    [{ state: 'approved' }, 'client-approval-needed', false, true],
    [{ state: 'approved' }, 'owned', false, true],
  ];
  for (const [approval, rights, n, a] of rows) {
    const pkg = { rights, ...(approval ? { approval } : {}) };
    assert.equal(needsApproval(pkg), n, JSON.stringify(pkg));
    assert.equal(isApproved(pkg), a, JSON.stringify(pkg));
  }
  assert.equal(needsApproval(undefined), false);
  assert.equal(isApproved(undefined), false);
});

test('every SERIES has a valid engine matching SERIES_ENGINE', () => {
  for (const [k, s] of Object.entries(SERIES)) {
    assert.ok(ENGINE_IDS.includes(s.engine), k);
    assert.equal(s.engine, SERIES_ENGINE[k], k);
  }
});
