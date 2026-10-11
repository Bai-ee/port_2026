// CHARACTERIZATION: pins what planRecordSchedule / scheduleReadyRecords do TODAY (fixed NOW, no I/O).
// Complements scheduler.test.js; not a spec. "CURRENT (known gap)" = behaviour the content-management work plans to change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planRecordSchedule, scheduleReadyRecords, isRecordReady, DEFAULT_SCHEDULE_CONFIG } from '../scheduler.js';

// 2026-10-05 12:00 UTC = 07:00 CDT Monday
const NOW = new Date('2026-10-05T12:00:00Z');
const plan = (o) => planRecordSchedule({ now: NOW, ...o });
const iso = (r) => r.scheduled.map((s) => s.scheduledAt);
const ready = (id, createdAt = '1', extra = {}) => ({
  id, createdAt, source: 'discogs-ingest', status: 'draft', needsStory: false, sourceRef: { releaseId: Number(id.replace(/\D/g, '')) || 1 },
  content: 'Artist - Title\nI bought this.', mediaUrl: 'https://x/v.mp4', ...extra,
});
const occupier = (id, at, extra = {}) => ({ id, source: 'manual', engine: 'identity', status: 'scheduled', scheduledAt: at, ...extra });
const FIRST = '2026-10-05T14:00:00.000Z'; // 09:00 CT preferred slot on day 0

test('default config values are pinned', () => {
  assert.deepEqual({ ...DEFAULT_SCHEDULE_CONFIG }, {
    timezone: 'America/Chicago', preferredLocal: ['09:00', '19:00'], windowLocal: ['08:00', '21:00'], stepMin: 15, perDay: null, minLeadMs: 900000, horizonDays: 21,
  });
});

test('OCCUPYING: scheduled/queued/approved/posting/posted block the 09:00 slot (spacing) ...', () => {
  for (const status of ['scheduled', 'queued', 'approved', 'posting', 'posted']) {
    const o = occupier('o', FIRST, { status, postedAt: FIRST });
    const r = plan({ posts: [o, ready('a1')] });
    assert.notEqual(iso(r)[0], FIRST, status);
  }
});

test('OCCUPYING: draft / needs_review / awaiting_approval / failed / rejected / expired / cancelled rows do NOT occupy a slot', () => {
  for (const status of ['draft', 'needs_review', 'awaiting_approval', 'failed', 'rejected', 'expired', 'cancelled']) {
    const o = occupier('o', FIRST, { status });
    const r = plan({ posts: [o, ready('a1')] });
    assert.equal(iso(r)[0], FIRST, status);
  }
});

test('occupying rows without a parseable time, and reply rows, do not occupy', () => {
  assert.equal(iso(plan({ posts: [occupier('o', null), ready('a1')] }))[0], FIRST);
  assert.equal(iso(plan({ posts: [occupier('o', FIRST, { replyTo: { url: 'u' } }), ready('a1')] }))[0], FIRST);
  assert.equal(iso(plan({ posts: [occupier('o', FIRST, { kind: 'reply' }), ready('a1')] }))[0], FIRST);
});

test('a posted row occupies at postedAt (not scheduledAt) when both exist', () => {
  const o = occupier('o', '2026-10-09T14:00:00Z', { status: 'posted', postedAt: FIRST });
  assert.notEqual(iso(plan({ posts: [o, ready('a1')] }))[0], FIRST);
});

test('spacing boundary: a post EXACTLY 120 min away is allowed, 119 min is not', () => {
  // candidates near 09:00 CT (14:00Z): 16:00Z is exactly 120 min after.
  const exact = plan({ posts: [occupier('o', '2026-10-05T12:00:00Z'), ready('a1')] });
  assert.equal(iso(exact)[0], FIRST);
  const tooClose = plan({ posts: [occupier('o', '2026-10-05T12:01:00Z'), ready('a1')] });
  assert.notEqual(iso(tooClose)[0], FIRST);
});

test('minimum lead: nothing is scheduled less than 15 min after NOW', () => {
  // NOW 13:50Z -> 09:00 CT (14:00Z) is only 10 min away.
  const r = planRecordSchedule({ now: new Date('2026-10-05T13:50:00Z'), posts: [ready('a1')] });
  assert.notEqual(iso(r)[0], FIRST);
  assert.ok(Date.parse(iso(r)[0]) >= Date.parse('2026-10-05T13:50:00Z') + 15 * 60_000);
});

test('record cap: one record per day by default - even ONE occupying record blocks the whole day', () => {
  const rec = { id: 'r0', source: 'discogs-ingest', engine: 'record', packageId: 'discogs-90', status: 'scheduled', scheduledAt: '2026-10-05T23:00:00Z' };
  const r = plan({ posts: [rec, ready('a1')] });
  assert.ok(iso(r)[0].startsWith('2026-10-06'));
});

test('record share cap (40%) judged against max(authored+1, targetPerDay=4): perDay 2 with one other post still refuses a 2nd record', () => {
  // 1 record + 1 other already that day; adding => 2 of max(3,4) = 50% > 40%.
  const rec = { id: 'r0', source: 'discogs-ingest', engine: 'record', packageId: 'discogs-90', status: 'scheduled', scheduledAt: '2026-10-05T23:00:00Z' };
  const r = plan({ posts: [rec, occupier('o', '2026-10-05T18:00:00Z'), ready('a1')], config: { perDay: 2 } });
  assert.ok(iso(r)[0].startsWith('2026-10-06'));
});

test('entity cooldown boundary: exactly 30 days apart is allowed; 29 days pushes the post to the next day', () => {
  const pkgs = { 'discogs-9': { id: 'discogs-9', engine: 'record', entities: ['warp'] }, 'discogs-1': { id: 'discogs-1', engine: 'record', entities: ['warp'] } };
  const old = (at) => ({ id: 'old', source: 'discogs-ingest', engine: 'record', packageId: 'discogs-9', status: 'posted', postedAt: at, scheduledAt: at });
  // candidate lands at 2026-10-05 14:00Z; previous record 30d earlier at the same instant.
  const ok = plan({ posts: [old('2026-09-05T14:00:00Z'), ready('a1')], packages: pkgs });
  assert.equal(iso(ok)[0], FIRST);
  const blocked = plan({ posts: [old('2026-09-06T14:00:00Z'), ready('a1')], packages: pkgs });
  // Day 0 is refused (29d < 30d); the planner moves on and lands on day 1, exactly 30d after the old record.
  assert.equal(iso(blocked)[0], '2026-10-06T14:00:00.000Z');
});

test('entity cooldown also reads package.lastPostedAt for discogs-* packages with no post row', () => {
  const pkgs = {
    'discogs-9': { id: 'discogs-9', engine: 'record', entities: ['warp'], lastPostedAt: '2026-10-01T14:00:00Z' },
    'discogs-1': { id: 'discogs-1', engine: 'record', entities: ['warp'] },
  };
  const r = plan({ posts: [ready('a1')], packages: pkgs });
  assert.equal(r.scheduled.length, 0);
  assert.match(r.skipped[0].reasons.join(' '), /entity cooldown/);
});

test('21-day horizon: days 0..21 are tried (22 days); a queue longer than that is skipped with a record-cap reason', () => {
  const posts = Array.from({ length: 24 }, (_, i) => ready(`r${i + 1}`, String(i + 1).padStart(3, '0')));
  const r = plan({ posts });
  assert.equal(r.scheduled.length, 22);
  assert.equal(iso(r)[21].slice(0, 10), '2026-10-26'); // day 21
  assert.deepEqual(r.skipped.map((s) => s.postId), ['r23', 'r24']);
  assert.ok(r.skipped[0].reasons.length <= 4);
  assert.match(r.skipped[0].reasons[0], /record cap 1\/1/);
});

test('horizonDays config shortens the search', () => {
  const posts = [1, 2, 3].map((n) => ready(`r${n}`, String(n)));
  assert.equal(plan({ posts, config: { horizonDays: 1 } }).scheduled.length, 2);
});

test('PHASE 3: a package already pending as a scheduled copy under a DIFFERENT source blocks the draft (skipped with a reason)', () => {
  const pending = { id: 'engine-copy', source: 'content-engine', engine: 'record', packageId: 'discogs-1', status: 'scheduled', scheduledAt: '2026-10-08T14:00:00Z' };
  const r = plan({ posts: [pending, ready('a1')] });
  assert.equal(r.scheduled.length, 0);
  assert.equal(r.skipped[0].postId, 'a1');
  assert.match(r.skipped[0].reasons[0], /already has an open copy/);
});

test('PHASE 3: a pending copy that is awaiting_approval / queued / posting also blocks; approved/draft/posted copies do not', () => {
  for (const status of ['awaiting_approval', 'queued', 'posting']) {
    const pending = { id: 'x', source: 'content-engine', packageId: 'discogs-1', status };
    assert.equal(plan({ posts: [pending, ready('a1')] }).scheduled.length, 0, status);
  }
  const other = { id: 'x', source: 'content-engine', packageId: 'discogs-1', status: 'draft' };
  assert.equal(plan({ posts: [other, ready('a1')] }).scheduled.length, 1);
});

test('PHASE 3: two drafts for the SAME package in one run schedule only ONE (the older); the other is skipped', () => {
  const a = ready('a1', '1', { packageId: 'discogs-1' });
  const b = ready('b1', '2', { packageId: 'discogs-1' });
  const r = plan({ posts: [a, b] });
  assert.deepEqual(r.scheduled.map((s) => s.postId), ['a1']);
  assert.deepEqual(r.skipped.map((s) => s.postId), ['b1']);
  assert.match(r.skipped[0].reasons[0], /already has an open copy \(a1/);
});

test('CURRENT (known gap): the same package already posted by a non-record-engine row carries no cooldown without entities', () => {
  const posted = { id: 'p', source: 'content-engine', engine: 'identity', packageId: 'discogs-1', status: 'posted', postedAt: '2026-10-04T14:00:00Z', scheduledAt: '2026-10-04T14:00:00Z' };
  const r = plan({ posts: [posted, ready('a1')], packages: { 'discogs-1': { id: 'discogs-1', engine: 'record', entities: ['warp'] } } });
  assert.equal(r.scheduled.length, 1);
});

test('isRecordReady: draft or unscheduled approved only', () => {
  assert.equal(isRecordReady(ready('a1')), true);
  assert.equal(isRecordReady(ready('a1', '1', { status: 'approved' })), true);
  assert.equal(isRecordReady(ready('a1', '1', { status: 'approved', scheduledAt: FIRST })), false);
  assert.equal(isRecordReady(ready('a1', '1', { status: 'scheduled' })), false);
});

test('scheduleReadyRecords: dryRun writes nothing; update failures are reported per item with status and do not stop the batch', async () => {
  const rows = [ready('a1', '1'), ready('b2', '2')];
  const writes = [];
  const deps = {
    readSocialQueue: async () => rows,
    getPackage: async () => null,
    updateSocialPost: async (_c, id, patch) => {
      if (id === 'a1') throw Object.assign(new Error('nope'), { status: 409 });
      writes.push([id, patch]);
    },
  };
  const dry = await scheduleReadyRecords({ clientId: 'c', now: NOW, dryRun: true, deps });
  assert.equal(dry.plan.length, 2);
  assert.equal(writes.length, 0);
  const live = await scheduleReadyRecords({ clientId: 'c', now: NOW, deps });
  assert.equal(live.errors.length, 1);
  assert.equal(live.errors[0].postId, 'a1');
  assert.equal(live.errors[0].status, 409);
  assert.deepEqual(live.scheduled.map((s) => s.postId), ['b2']);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0][1]), ['scheduledAt']);
});
