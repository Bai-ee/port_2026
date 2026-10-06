import test from 'node:test';
import assert from 'node:assert/strict';
import { planRecordSchedule, zonedTimeToUtcMs, isRecordReady } from '../scheduler.js';

const ready = (id, createdAt, extra = {}) => ({
  id, createdAt, source: 'discogs-ingest', status: 'draft', needsStory: false,
  content: 'Artist - Title\nLabel · CAT · 1995\nI bought this at Gramaphone.', mediaUrl: 'https://x/v.mp4', ...extra,
});
// 2026-10-05 12:00 UTC = 07:00 CDT Monday
const NOW = new Date('2026-10-05T12:00:00Z');

test('slot is 09:00 CT: CDT offset in October', () => {
  const [p] = planRecordSchedule({ posts: [ready('a', '1')], now: NOW });
  assert.equal(p.scheduledAt, '2026-10-05T14:00:00.000Z');
});

test('DST: 09:00 CT is 15:00Z in winter (CST) and 14:00Z in summer (CDT)', () => {
  assert.equal(new Date(zonedTimeToUtcMs(2026, 12, 1, 9, 0, 'America/Chicago')).toISOString(), '2026-12-01T15:00:00.000Z');
  assert.equal(new Date(zonedTimeToUtcMs(2026, 7, 1, 9, 0, 'America/Chicago')).toISOString(), '2026-07-01T14:00:00.000Z');
});

test('DST transition days keep wall-clock 09:00 (fall back Nov 1 2026, spring forward Mar 8 2026)', () => {
  assert.equal(new Date(zonedTimeToUtcMs(2026, 11, 1, 9, 0, 'America/Chicago')).toISOString(), '2026-11-01T15:00:00.000Z');
  assert.equal(new Date(zonedTimeToUtcMs(2026, 3, 8, 9, 0, 'America/Chicago')).toISOString(), '2026-03-08T14:00:00.000Z');
});

test('one record per day by default, oldest first', () => {
  const plan = planRecordSchedule({ posts: [ready('b', '2'), ready('a', '1'), ready('c', '3')], now: NOW });
  assert.deepEqual(plan.map((p) => p.postId), ['a', 'b', 'c']);
  assert.deepEqual(plan.map((p) => p.scheduledAt.slice(0, 10)), ['2026-10-05', '2026-10-06', '2026-10-07']);
});

test('perDay 2 uses 09:00 and 19:00 CT, 10 h apart', () => {
  const plan = planRecordSchedule({ posts: [ready('a', '1'), ready('b', '2'), ready('c', '3')], now: NOW, config: { perDay: 2 } });
  assert.deepEqual(plan.map((p) => p.scheduledAt), ['2026-10-05T14:00:00.000Z', '2026-10-06T00:00:00.000Z', '2026-10-06T14:00:00.000Z']);
});

test('perDay is clamped to the C1 series maximum', () => {
  const plan = planRecordSchedule({ posts: [1, 2, 3, 4].map((n) => ready(`p${n}`, String(n))), now: NOW, config: { perDay: 9 } });
  assert.equal(plan.filter((p) => p.scheduledAt.startsWith('2026-10-05') || p.scheduledAt.startsWith('2026-10-06T00')).length, 2);
});

test('skips a slot already holding another scheduled post (within 60 min)', () => {
  const other = { id: 'x', source: 'manual', status: 'scheduled', scheduledAt: '2026-10-05T14:30:00.000Z' };
  const [p] = planRecordSchedule({ posts: [other, ready('a', '1')], now: NOW });
  assert.equal(p.scheduledAt, '2026-10-06T00:00:00.000Z'); // falls to 19:00 CT same day
});

test('an existing scheduled record counts against perDay and the 4 h gap', () => {
  const rec = { id: 'r', source: 'discogs-ingest', status: 'scheduled', scheduledAt: '2026-10-05T14:00:00.000Z' };
  const [p] = planRecordSchedule({ posts: [rec, ready('a', '1')], now: NOW });
  assert.equal(p.scheduledAt, '2026-10-06T14:00:00.000Z');
});

test('past slots are skipped', () => {
  const [p] = planRecordSchedule({ posts: [ready('a', '1')], now: new Date('2026-10-05T14:10:00Z') });
  assert.equal(p.scheduledAt, '2026-10-06T00:00:00.000Z'); // 19:00 CT same day
});

test('skips not-ready drafts', () => {
  const posts = [
    ready('placeholder', '1', { content: 'x\n[add your memory]' }),
    ready('needs', '2', { needsStory: true }),
    ready('nomedia', '3', { mediaUrl: null }),
    ready('manual', '4', { source: 'manual' }),
    ready('scheduled', '5', { status: 'scheduled', scheduledAt: '2030-01-01T00:00:00Z' }),
    ready('ok', '6'),
  ];
  assert.deepEqual(posts.filter(isRecordReady).map((p) => p.id), ['ok']);
  assert.deepEqual(planRecordSchedule({ posts, now: NOW }).map((p) => p.postId), ['ok']);
});

test('no collisions across a batch', () => {
  const plan = planRecordSchedule({ posts: Array.from({ length: 10 }, (_, i) => ready(`p${i}`, String(i))), now: NOW, config: { perDay: 2 } });
  const t = plan.map((p) => Date.parse(p.scheduledAt)).sort((a, b) => a - b);
  for (let i = 1; i < t.length; i += 1) assert.ok(t[i] - t[i - 1] >= 4 * 3600 * 1000);
});
