import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePostSlot, recentPostsFromQueue, OCCUPYING } from '../allocate-slot.js';

// 2026-10-05 12:00Z = 07:00 CDT
const NOW = Date.parse('2026-10-05T12:00:00Z');
const row = (id, at, extra = {}) => ({ id, source: 'manual', engine: 'identity', status: 'scheduled', scheduledAt: at, ...extra });
const alloc = (o) => allocatePostSlot({ now: NOW, tz: 'America/Chicago', ...o });

test('OCCUPYING is the five slot-holding statuses', () => {
  assert.deepEqual([...OCCUPYING].sort(), ['approved', 'posted', 'posting', 'queued', 'scheduled']);
});

test('free slot: granted exactly as desired, no reasons', () => {
  const r = alloc({ posts: [], candidate: { id: 'c' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.deepEqual(r, { ok: true, scheduledAt: '2026-10-05T14:00:00.000Z', reasons: [] });
});

test('spacing violation: 119 min is moved to the first valid step, 120 min is allowed', () => {
  const near = alloc({ posts: [row('o', '2026-10-05T12:01:00Z')], candidate: {}, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(near.ok, true);
  assert.equal(near.scheduledAt, '2026-10-05T14:15:00.000Z');
  assert.match(near.reasons[0], /moved from/);
  const exact = alloc({ posts: [row('o', '2026-10-05T12:00:00Z')], candidate: {}, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(exact.scheduledAt, '2026-10-05T14:00:00.000Z');
});

test('spacing violation with no room to move (horizon 0) is a blocker', () => {
  const r = alloc({ posts: [row('o', '2026-10-05T14:00:00Z')], candidate: {}, desiredAt: '2026-10-05T14:00:00Z', config: { horizonDays: 0, stepMin: 60 * 24 } });
  assert.equal(r.ok, false);
  assert.equal(r.blockers[0].code, 'spacing-violation');
});

test('non-occupying rows (draft, failed) and replies do not hold the slot', () => {
  const posts = [row('a', '2026-10-05T14:00:00Z', { status: 'draft' }), row('b', '2026-10-05T14:00:00Z', { status: 'failed' }), row('c', '2026-10-05T14:00:00Z', { replyTo: { url: 'u' } })];
  assert.equal(alloc({ posts, candidate: {}, desiredAt: '2026-10-05T14:00:00Z' }).scheduledAt, '2026-10-05T14:00:00.000Z');
});

test('per-day cap: a full day pushes the post to the same local time next day; horizon 0 blocks', () => {
  const posts = ['14:00', '17:00'].map((t, i) => row(`o${i}`, `2026-10-05T${t}:00Z`));
  const moved = alloc({ posts, candidate: {}, desiredAt: '2026-10-05T20:00:00Z', config: { perDay: 2 } });
  assert.equal(moved.ok, true);
  assert.equal(moved.scheduledAt, '2026-10-06T20:00:00.000Z');
  const blocked = alloc({ posts, candidate: {}, desiredAt: '2026-10-05T20:00:00Z', config: { perDay: 2, horizonDays: 0 } });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers[0].code, 'per-day-cap');
});

test('package collision: any other pending copy blocks; own row, draft and posted copies do not', () => {
  for (const status of ['awaiting_approval', 'scheduled', 'queued', 'posting']) {
    const r = alloc({ posts: [row('other', '2026-10-09T14:00:00Z', { packageId: 'p1', status })], candidate: { id: 'me', packageId: 'p1' }, desiredAt: '2026-10-05T14:00:00Z' });
    assert.equal(r.ok, false, status);
    assert.equal(r.blockers[0].code, 'package-already-pending');
  }
  const ok = alloc({ posts: [row('me', null, { packageId: 'p1', status: 'scheduled' }), row('d', '2026-10-09T14:00:00Z', { packageId: 'p1', status: 'draft' }), row('x', '2026-10-01T14:00:00Z', { packageId: 'p1', status: 'posted' })], candidate: { id: 'me', packageId: 'p1' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(ok.ok, true);
});

test('expired opportunity: already past is blocked; expiry before any free slot is blocked; expiry after the slot is fine', () => {
  const past = alloc({ posts: [], candidate: { expiresAt: '2026-10-05T11:00:00Z' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(past.blockers[0].code, 'opportunity-expired');
  const before = alloc({ posts: [], candidate: { expiresAt: '2026-10-05T13:00:00Z' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(before.blockers[0].code, 'opportunity-expired');
  const blockedByNeighbour = alloc({ posts: [row('o', '2026-10-05T14:00:00Z')], candidate: { expiresAt: '2026-10-05T15:00:00Z' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(blockedByNeighbour.blockers[0].code, 'opportunity-expired');
  assert.match(blockedByNeighbour.blockers[0].message, /Last conflict/);
  const fine = alloc({ posts: [], candidate: { expiresAt: '2026-10-05T20:00:00Z' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(fine.ok, true);
});

test('two producers proposing the same slot sequentially: the second gets the next valid slot', () => {
  const desiredAt = '2026-10-05T14:00:00Z';
  const first = alloc({ posts: [], candidate: { id: 'a', packageId: 'pa' }, desiredAt });
  assert.equal(first.scheduledAt, '2026-10-05T14:00:00.000Z');
  const queue = [row('a', first.scheduledAt, { packageId: 'pa' })];
  const second = alloc({ posts: queue, candidate: { id: 'b', packageId: 'pb' }, desiredAt });
  assert.equal(second.ok, true);
  assert.equal(second.scheduledAt, '2026-10-05T16:00:00.000Z');
  // the same package proposed twice is blocked instead
  const dup = alloc({ posts: queue, candidate: { id: 'c', packageId: 'pa' }, desiredAt });
  assert.equal(dup.blockers[0].code, 'package-already-pending');
});

test('record engine caps: share and maxPerDay apply to engine "record" candidates only', () => {
  const rec = row('r', '2026-10-05T23:00:00Z', { engine: 'record', source: 'discogs-ingest', packageId: 'discogs-9' });
  const asRecord = alloc({ posts: [rec], candidate: { engine: 'record' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(asRecord.scheduledAt.slice(0, 10), '2026-10-06');
  const asIdentity = alloc({ posts: [rec], candidate: { engine: 'identity' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.equal(asIdentity.scheduledAt, '2026-10-05T14:00:00.000Z');
});

test('minimum lead and invalid inputs', () => {
  const lead = alloc({ posts: [], candidate: {}, desiredAt: '2026-10-05T12:05:00Z', config: { minLeadMs: 15 * 60_000 } });
  assert.equal(lead.scheduledAt, '2026-10-05T12:15:00.000Z');
  assert.equal(alloc({ posts: [], candidate: {}, desiredAt: 'nope' }).blockers[0].code, 'invalid-desired-time');
  assert.equal(allocatePostSlot({ posts: [], candidate: {}, desiredAt: '2026-10-05T14:00:00Z' }).blockers[0].code, 'invalid-now');
});

test('deterministic with a fixed now; does not mutate its input', () => {
  const posts = [row('o', '2026-10-05T14:00:00Z')];
  const snap = JSON.stringify(posts);
  const a = alloc({ posts, candidate: { id: 'x' }, desiredAt: '2026-10-05T14:00:00Z' });
  const b = alloc({ posts, candidate: { id: 'x' }, desiredAt: '2026-10-05T14:00:00Z' });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(posts), snap);
});

test('recentPostsFromQueue maps occupying rows to {engine, postedAt}; drops drafts, replies, untimed and engine-less rows', () => {
  const out = recentPostsFromQueue([
    row('a', '2026-10-05T14:00:00Z'),
    row('b', '2026-10-05T15:00:00Z', { status: 'posted', postedAt: '2026-10-05T15:05:00Z', engine: undefined, source: 'discogs-ingest', entities: ['warp'] }),
    row('c', '2026-10-05T16:00:00Z', { status: 'draft' }),
    row('d', '2026-10-05T16:00:00Z', { replyTo: { url: 'u' } }),
    row('e', null),
    row('f', '2026-10-05T17:00:00Z', { engine: undefined }),
  ], { now: NOW });
  assert.deepEqual(out, [
    // CT wall clock as UTC epoch (engine-quota's axis): 14:00Z = 09:00 CDT
    { engine: 'identity', postedAt: Date.parse('2026-10-05T09:00:00Z') },
    { engine: 'record', postedAt: Date.parse('2026-10-05T10:05:00Z'), entities: ['warp'] },
  ]);
});

test('recentPostsFromQueue: a 20:00 CT post stays on its CT day for the quota window (not tomorrow)', () => {
  const [r] = recentPostsFromQueue([{ id: 'e', status: 'scheduled', scheduledAt: '2026-10-06T01:00:00Z', engine: 'identity' }]);
  assert.equal(new Date(r.postedAt).toISOString().slice(0, 10), '2026-10-05');
});
