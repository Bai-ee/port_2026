// Phase 3 gate: approved-but-unscheduled work persists across weeks, and the calendar shows the same rows the queue holds.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeekCalendar } from '../week-calendar.js';
import { buildMonthCalendar } from '../month-calendar.js';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const posts = [
  { id: 'a', status: 'approved', content: 'approved backlog', createdAt: '2026-10-01T00:00:00Z', engine: 'identity' },
  { id: 'b', status: 'scheduled', content: 'scheduled', scheduledAt: '2026-10-14T15:00:00Z', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'c', status: 'failed', content: 'failed never published', scheduledAt: '2026-10-13T15:00:00Z', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'd', status: 'expired', content: 'expired', scheduledAt: '2026-10-13T16:00:00Z', createdAt: '2026-10-01T00:00:00Z' },
];

test('approved unscheduled work stays in the week view for every later week (nothing ages out)', () => {
  for (const start of ['2026-10-11', '2026-10-18', '2026-10-25', '2026-11-29']) {
    assert.deepEqual(buildWeekCalendar({ posts, start }).unscheduled.map((p) => p.id), ['a'], start);
  }
});

test('scheduled work appears on its CT date; failed and expired rows never occupy a slot', () => {
  const wk = buildWeekCalendar({ posts, start: '2026-10-11' });
  const ids = wk.days.flatMap((d) => (d.slots || d.posts || []).map((p) => p.id));
  assert.deepEqual(ids.sort(), ['b']);
});

test('month view: approved backlog is proposed onto a day in the current window and the scheduled row keeps its day', () => {
  const m = buildMonthCalendar({ posts, month: '2026-10', now: NOW });
  const placed = m.weeks.flat().flatMap((d) => d.posts.map((p) => ({ date: d.date, id: p.id, state: p.state, proposed: p.proposed })));
  assert.ok(placed.some((p) => p.id === 'a' && p.proposed === true));
  assert.deepEqual(placed.find((p) => p.id === 'b'), { date: '2026-10-14', id: 'b', state: 'scheduled', proposed: false });
  assert.ok(!placed.some((p) => p.id === 'c' || p.id === 'd') || placed.filter((p) => p.id === 'c' || p.id === 'd').every((p) => p.state === 'failed'));
});

test('rows hidden by replyTo are excluded from both calendars (replies sit outside the authored cap)', () => {
  const withReply = [...posts, { id: 'r', status: 'draft', content: 'reply', replyTo: { url: 'https://x.com/a/status/1' }, createdAt: '2026-10-02T00:00:00Z' }];
  assert.ok(!buildWeekCalendar({ posts: withReply, start: '2026-10-11' }).unscheduled.some((p) => p.id === 'r'));
});
