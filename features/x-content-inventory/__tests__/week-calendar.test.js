import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekCalendar, weekDates } from '../week-calendar.js';

// 2026-10-06 is CDT (UTC-5): 14:00Z = 09:00 CT.
const post = (id, iso, engine, extra = {}) => ({ id, scheduledAt: iso, status: 'scheduled', engine, content: `post ${id}`, ...extra });

test('weekDates returns 7 consecutive dates', () => {
  const d = weekDates('2026-10-06');
  assert.equal(d.length, 7);
  assert.equal(d[0], '2026-10-06');
  assert.equal(d[6], '2026-10-12');
});

test('posts land on their Chicago day, with CT time and engine counts', () => {
  const cal = buildWeekCalendar({
    start: '2026-10-06',
    posts: [
      post('a', '2026-10-06T14:00:00Z', 'record', { packageId: 'p1' }),
      post('b', '2026-10-06T18:00:00Z', 'identity'),
      post('c', '2026-10-07T03:30:00Z', 'ue'), // 22:30 CT on the 6th
    ],
  });
  assert.equal(cal.days[0].total, 3);
  assert.equal(cal.days[0].slots[0].time, '09:00');
  assert.equal(cal.days[0].slots[0].packageId, 'p1');
  assert.equal(cal.days[0].counts.record, 1);
  assert.equal(cal.engines.ue.week, 1);
  assert.equal(cal.weekTotal, 3);
});

test('spacing, over-cap and weekly-min flags', () => {
  const cal = buildWeekCalendar({
    start: '2026-10-06',
    posts: [
      post('a', '2026-10-06T14:00:00Z', 'record'),
      post('b', '2026-10-06T14:30:00Z', 'record'),
      post('c', '2026-10-06T17:00:00Z', 'record'),
      post('d', '2026-10-06T19:00:00Z', 'identity'),
      post('e', '2026-10-06T21:00:00Z', 'identity'),
      post('f', '2026-10-06T23:00:00Z', 'identity'),
      post('g', '2026-10-07T01:00:00Z', 'identity'),
    ],
  });
  const kinds = cal.flags.map((f) => f.kind);
  assert.ok(kinds.includes('spacing'));
  assert.ok(kinds.includes('over-cap'));
  assert.ok(kinds.includes('engine-over-max'));
  assert.ok(cal.flags.some((f) => f.kind === 'weekly-min' && f.engine === 'client'));
  assert.equal(cal.engines.client.belowWeeklyMin, true);
});

test('failed/expired rows, replies and out-of-window posts are ignored; drafts without a time are unscheduled', () => {
  const cal = buildWeekCalendar({
    start: '2026-10-06',
    posts: [
      post('x', '2026-10-06T14:00:00Z', 'record', { status: 'failed' }),
      post('y', '2026-10-06T14:00:00Z', 'record', { replyTo: 'https://x.com/a/status/1' }),
      post('z', '2026-10-20T14:00:00Z', 'record'),
      { id: 'd', status: 'draft', scheduledAt: null, engine: 'client', content: 'draft' },
    ],
  });
  assert.equal(cal.weekTotal, 0);
  assert.equal(cal.unscheduled.length, 1);
});

test('untagged rows are counted separately, never as an engine', () => {
  const cal = buildWeekCalendar({ start: '2026-10-06', posts: [post('a', '2026-10-06T14:00:00Z', undefined)] });
  assert.equal(cal.untagged, 1);
  assert.equal(cal.days[0].counts.untagged, 1);
});
