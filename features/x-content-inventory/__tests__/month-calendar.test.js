import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthCalendar, monthGridDates, ctWallToMs, addDays } from '../month-calendar.js';
import { DEFAULT_ENGINE_CONFIG } from '../engine-quota.js';

// October 2026 is CDT (UTC-5): 14:00Z = 09:00 CT. Oct 1 is a Thursday.
const NOW = Date.parse('2026-10-10T12:00:00Z'); // 07:00 CT, Sat Oct 10
const post = (id, iso, extra = {}) => ({ id, scheduledAt: iso, status: 'scheduled', engine: 'identity', content: `post ${id}`, ...extra });
const draft = (id, extra = {}) => ({ id, status: 'draft', scheduledAt: null, engine: 'identity', content: `draft ${id}`, createdAt: '2026-10-01T00:00:00Z', ...extra });
const allDays = (cal) => cal.weeks.flat();
const day = (cal, date) => allDays(cal).find((d) => d.date === date);

test('monthGridDates covers whole weeks, Sunday-first by default', () => {
  const d = monthGridDates('2026-10');
  assert.equal(d[0], '2026-09-27'); // Sunday before Thu Oct 1
  assert.equal(d[d.length - 1], '2026-10-31'); // Oct 31 is a Saturday
  assert.equal(d.length % 7, 0);
  const mon = monthGridDates('2026-10', { weekStartsOn: 1 });
  assert.equal(mon[0], '2026-09-28');
  assert.equal(mon[mon.length - 1], '2026-11-01');
  assert.throws(() => monthGridDates('2026-13'));
});

test('ctWallToMs is DST-correct on both sides of the November change', () => {
  assert.equal(new Date(ctWallToMs('2026-10-10', 9 * 60)).toISOString(), '2026-10-10T14:00:00.000Z'); // CDT
  assert.equal(new Date(ctWallToMs('2026-11-10', 9 * 60)).toISOString(), '2026-11-10T15:00:00.000Z'); // CST
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('dated posts land on their CT day with a visual state; failed shows but is not counted for spacing', () => {
  const cal = buildMonthCalendar({
    month: '2026-10',
    now: NOW,
    posts: [
      post('a', '2026-10-12T14:00:00Z'),
      post('b', '2026-10-13T03:30:00Z'), // 22:30 CT on the 12th
      post('p', '2026-10-05T14:00:00Z', { status: 'posted', postedAt: '2026-10-05T14:00:00Z' }),
      post('f', '2026-10-12T14:30:00Z', { status: 'failed', error: 'boom' }),
      post('r', '2026-10-12T15:00:00Z', { replyTo: 'https://x.com/a/status/1' }),
    ],
  });
  const d12 = day(cal, '2026-10-12');
  assert.deepEqual(d12.posts.map((p) => p.id), ['a', 'f', 'b']);
  assert.equal(d12.posts[0].time, '09:00');
  assert.equal(d12.posts[0].state, 'scheduled');
  assert.equal(d12.posts[1].state, 'failed');
  assert.equal(d12.posts[1].error, 'boom');
  assert.equal(d12.flags.length, 0, 'failed row must not trigger a spacing flag');
  assert.equal(day(cal, '2026-10-05').posts[0].state, 'posted');
  assert.equal(day(cal, '2026-10-05').isPast, true);
  assert.equal(day(cal, '2026-10-10').isToday, true);
  assert.equal(day(cal, '2026-09-27').inMonth, false);
  assert.equal(cal.totals.scheduled, 2);
  assert.equal(cal.totals.failed, 1);
});

test('an undated draft is proposed into the next open slot from today, never before now + lead', () => {
  const cal = buildMonthCalendar({ month: '2026-10', now: NOW, posts: [draft('d1')] });
  const d10 = day(cal, '2026-10-10');
  assert.equal(d10.posts.length, 1);
  const p = d10.posts[0];
  assert.equal(p.proposed, true);
  assert.equal(p.state, 'pending');
  assert.equal(p.time, '09:00'); // 07:00 now + 30 min lead → 09:00 window start
  assert.equal(p.proposedAt, '2026-10-10T14:00:00.000Z');
  assert.deepEqual(cal.reviewQueue, ['d1']);
  assert.equal(cal.totals.proposed, 1);
  assert.equal(cal.unplaced.length, 0);
});

test('proposals respect min spacing, the authored target and per-engine max', () => {
  const cal = buildMonthCalendar({
    month: '2026-10',
    now: NOW,
    posts: [
      post('s', '2026-10-10T14:00:00Z'), // 09:00 CT taken
      draft('d1', { createdAt: '2026-10-01T00:00:00Z' }),
      draft('d2', { createdAt: '2026-10-02T00:00:00Z' }),
      draft('d3', { createdAt: '2026-10-03T00:00:00Z' }),
    ],
  });
  const d10 = day(cal, '2026-10-10').posts;
  // identity maxPerDay is 2: the scheduled one + d1. d2/d3 roll to the next day.
  assert.deepEqual(d10.map((p) => p.id), ['s', 'd1']);
  assert.equal(d10[1].time, '11:00'); // 120 min after 09:00
  assert.deepEqual(day(cal, '2026-10-11').posts.map((p) => [p.id, p.time]), [['d2', '09:00'], ['d3', '11:00']]);

  const target = DEFAULT_ENGINE_CONFIG.authored.targetPerDay;
  const many = Array.from({ length: target + 1 }, (_, i) => draft(`m${i}`, { engine: null, createdAt: `2026-10-0${i + 1}T00:00:00Z` }));
  const cal2 = buildMonthCalendar({ month: '2026-10', now: NOW, posts: many });
  assert.equal(day(cal2, '2026-10-10').posts.length, target);
  assert.equal(day(cal2, '2026-10-11').posts.length, 1);
});

test('needs-story drafts are never proposed; past months report out-of-range', () => {
  const cal = buildMonthCalendar({ month: '2026-10', now: NOW, posts: [draft('n', { needsStory: true })] });
  assert.equal(cal.unplaced[0].reason, 'needs-story');
  assert.equal(cal.totals.pending, 0);

  const past = buildMonthCalendar({ month: '2026-08', now: NOW, posts: [draft('d1')] });
  assert.equal(past.unplaced[0].reason, 'out-of-range');
});

test('proposal for a draft is the same whichever month is viewed', () => {
  const posts = Array.from({ length: 140 }, (_, i) => draft(`d${i}`, { engine: null, createdAt: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60000).toISOString() }));
  const oct = buildMonthCalendar({ month: '2026-10', now: NOW, posts });
  const nov = buildMonthCalendar({ month: '2026-11', now: NOW, posts, weekStartsOn: 1 }); // grid starts Mon Oct 26
  const where = (cal, id) => allDays(cal).flatMap((d) => d.posts).find((p) => p.id === id)?.proposedAt;
  const lastInOct = allDays(oct).filter((d) => d.date === '2026-10-31')[0].posts.at(-1).id;
  assert.equal(where(oct, lastInOct), where(nov, lastInOct));
  assert.ok(nov.totals.proposed > 0);
});
