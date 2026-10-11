import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadModels, groupQueue } from '../read-models.js';
import { buildMonthCalendar } from '../../x-content-inventory/month-calendar.js';

// Minimal Firestore double: collection(c).doc(id).get() -> {exists, data()}
function fakeDb(docs) {
  return { collection: (c) => ({ doc: (id) => ({ get: async () => { const d = docs[`${c}/${id}`]; return { exists: !!d, data: () => d }; } }) }) };
}

const NOW = Date.parse('2026-10-29T15:00:00Z');

function make(over = {}) {
  const calls = { brief: 0, queue: 0 };
  const rows = over.rows || [];
  const rm = createReadModels({
    db: fakeDb(over.docs || {}),
    getBriefForClient: async () => { calls.brief += 1; return over.brief === undefined ? { clientId: 'c1', clientName: 'Client', intel: { headline: 'H', generatedAt: '2026-10-29T10:00:00Z' } } : over.brief; },
    readSocialQueue: async () => { calls.queue += 1; return rows; },
    buildMonthCalendar,
    readEngineConfig: async () => undefined,
    getDigestConfig: async () => ({ schedule: { timezone: over.tz || 'America/New_York' } }),
    now: () => NOW,
  });
  return { rm, calls };
}

test('groupQueue buckets statuses incl. manual and expired', () => {
  const g = groupQueue([
    { id: 'a', status: 'needs_review' }, { id: 'b', status: 'awaiting_approval' }, { id: 'c', status: 'draft' },
    { id: 'd', status: 'failed' }, { id: 'e', status: 'expired' }, { id: 'f', status: 'manual' }, { id: 'g', status: 'posted' },
  ]);
  assert.deepEqual([g.needsReview, g.awaitingApproval, g.drafts, g.failed, g.manual].map((x) => x.length), [1, 1, 1, 2, 1]);
});

test('loadBriefing combines brief, scan (minus dismissed), queue, tz, freshness', async () => {
  const { rm } = make({
    rows: [{ id: 'p', status: 'draft' }],
    docs: { 'dashboard_state/c1': { marketingBrief: { quoteTargets: { generatedAt: '2026-10-29T13:00:00Z', candidates: [{ id: 'k1' }, { id: 'k2' }], dismissed: ['k2'] } } } },
  });
  const b = await rm.loadBriefing('c1');
  assert.equal(b.intel.headline, 'H');
  assert.deepEqual(b.quoteTargets.candidates.map((c) => c.id), ['k1']);
  assert.equal(b.queue.drafts.length, 1);
  assert.equal(b.tz, 'America/New_York');
  assert.deepEqual(b.freshness, { briefAt: '2026-10-29T10:00:00Z', scanAt: '2026-10-29T13:00:00Z' });
});

test('loadBriefing tolerates missing brief / scan / failures', async () => {
  const { rm } = make({ brief: null });
  const b = await rm.loadBriefing('c1');
  assert.equal(b.intel, null);
  assert.deepEqual(b.quoteTargets.candidates, []);
  assert.equal(b.freshness.briefAt, null);
  const bad = createReadModels({ db: fakeDb({}), getBriefForClient: async () => { throw new Error('boom'); }, readSocialQueue: async () => { throw new Error('q'); }, getDigestConfig: async () => { throw new Error('d'); } });
  const r = await bad.loadBriefing('c1');
  assert.equal(r.intel, null); assert.equal(r.tz, 'America/Chicago'); assert.equal(r.queue.drafts.length, 0);
});

test('loadCalendar: 7 days from CT today, crosses month end', async () => {
  const { rm } = make({ rows: [{ id: 'n', status: 'scheduled', scheduledAt: '2026-11-02T18:00:00Z', content: 'Nov post' }] });
  const c = await rm.loadCalendar('c1', { now: NOW });
  assert.equal(c.today, '2026-10-29');
  assert.deepEqual(c.week.map((d) => d.date), ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  assert.equal(c.week[4].posts.find((p) => p.id === 'n')?.content, 'Nov post');
  assert.equal(c.tz, 'America/Chicago');
  assert.ok(c.config.authored);
});

test('loadCalendar within one month builds one month', async () => {
  const { rm } = make();
  const c = await rm.loadCalendar('c1', { now: Date.parse('2026-10-10T15:00:00Z') });
  assert.equal(c.week.length, 7);
  assert.equal(c.week[6].date, '2026-10-16');
});

test('loadAccountHandle reads social_accounts platforms.x.username only', async () => {
  const { rm } = make({ docs: { 'social_accounts/c1': { platforms: { x: { username: '@bai_ee', handle: 'other' }, ig: { username: 'nope' } } } } });
  assert.equal(await rm.loadAccountHandle('c1'), 'bai_ee');
  assert.equal(await rm.loadAccountHandle('zzz'), null);
});

test('loadPost uses injected getSocialPost, else scans the queue', async () => {
  const { rm } = make({ rows: [{ id: 'p1', status: 'draft' }] });
  assert.equal((await rm.loadPost('c1', 'p1')).id, 'p1');
  assert.equal(await rm.loadPost('c1', 'nope'), null);
  const rm2 = createReadModels({ getSocialPost: async (c, id) => ({ id, c }) });
  assert.deepEqual(await rm2.loadPost('c1', 'x'), { id: 'x', c: 'c1' });
});
