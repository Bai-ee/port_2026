import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRunAt, getZonedParts, getTzOffsetMinutes } from '../scheduler.js';

const TZ = 'America/Chicago';
const DAY_MS = 24 * 60 * 60 * 1000;

function schedule(overrides = {}) {
  return { enabled: true, frequency: 'daily', sendHour: 7, weekday: 1, timezone: TZ, ...overrides };
}

test('disabled schedule returns null', () => {
  assert.equal(computeNextRunAt(schedule({ enabled: false }), Date.now()), null);
});

test('frequency "off" returns null even if enabled is true', () => {
  assert.equal(computeNextRunAt(schedule({ frequency: 'off' }), Date.now()), null);
});

test('daily: before sendHour today returns today at sendHour', () => {
  // 2026-06-15 is a Monday, no DST transition nearby. 05:00 CDT (UTC-5) local.
  const now = Date.UTC(2026, 5, 15, 10, 0, 0); // 10:00 UTC = 05:00 CDT
  const next = computeNextRunAt(schedule({ sendHour: 7 }), now);
  const p = getZonedParts(new Date(next), TZ);
  assert.equal(p.year, 2026); assert.equal(p.month, 6); assert.equal(p.day, 15); assert.equal(p.hour, 7);
  assert.ok(next > now);
});

test('daily: after sendHour today rolls to tomorrow at sendHour', () => {
  const now = Date.UTC(2026, 5, 15, 14, 0, 0); // 09:00 CDT — already past 07:00 sendHour
  const next = computeNextRunAt(schedule({ sendHour: 7 }), now);
  const p = getZonedParts(new Date(next), TZ);
  assert.equal(p.day, 16); assert.equal(p.hour, 7);
  assert.ok(next > now);
});

test('daily: exactly at sendHour is NOT due again until tomorrow (strictly after now)', () => {
  const exact = computeNextRunAt(schedule({ sendHour: 7 }), Date.UTC(2026, 5, 15, 10, 0, 0));
  const next = computeNextRunAt(schedule({ sendHour: 7 }), exact);
  assert.ok(next > exact, 'computeNextRunAt(schedule, exact-hit-instant) must return a LATER instant, never the same one');
});

test('weekly: same-day-of-week before sendHour returns today', () => {
  // 2026-06-15 is a Monday (weekday=1).
  const now = Date.UTC(2026, 5, 15, 10, 0, 0); // 05:00 CDT
  const next = computeNextRunAt(schedule({ frequency: 'weekly', weekday: 1, sendHour: 7 }), now);
  const p = getZonedParts(new Date(next), TZ);
  assert.equal(p.day, 15); assert.equal(p.weekday, 1);
});

test('weekly: same-day-of-week after sendHour wraps a full 7 days forward', () => {
  const now = Date.UTC(2026, 5, 15, 14, 0, 0); // Monday, 09:00 CDT — past sendHour
  const next = computeNextRunAt(schedule({ frequency: 'weekly', weekday: 1, sendHour: 7 }), now);
  const p = getZonedParts(new Date(next), TZ);
  assert.equal(p.day, 22); assert.equal(p.weekday, 1); // next Monday
});

test('weekly: wraps across the Sat->Sun week boundary correctly', () => {
  // 2026-06-19 is a Friday. Target weekday = Sunday (0).
  const now = Date.UTC(2026, 5, 19, 10, 0, 0);
  const next = computeNextRunAt(schedule({ frequency: 'weekly', weekday: 0, sendHour: 7 }), now);
  const p = getZonedParts(new Date(next), TZ);
  assert.equal(p.weekday, 0);
  assert.equal(p.day, 21); // the coming Sunday
});

test('weekly: wraps correctly across a month boundary', () => {
  // 2026-06-29 is a Monday (last Monday of June). Target weekday = Monday, already past sendHour that day.
  const now = Date.UTC(2026, 5, 29, 14, 0, 0);
  const next = computeNextRunAt(schedule({ frequency: 'weekly', weekday: 1, sendHour: 7 }), now);
  const p = getZonedParts(new Date(next), TZ);
  assert.equal(p.month, 7); assert.equal(p.day, 6); assert.equal(p.weekday, 1);
});

test('missed-run recovery: a nextRunAt from days ago still resolves to a real FUTURE slot near `now`, never a backlog', () => {
  // Simulate "nextRunAt was 5 days ago" by just computing relative to the
  // CURRENT now, exactly as a dispatcher must (never relative to the stale
  // stored value) — computeNextRunAt has no memory of a "missed" occurrence,
  // which is precisely the point: there is nothing to catch up on.
  const now = Date.UTC(2026, 5, 15, 10, 0, 0);
  const next = computeNextRunAt(schedule({ sendHour: 7 }), now);
  assert.ok(next - now <= DAY_MS + 60 * 60 * 1000, 'next slot must be within about a day of now, never a multi-day-old backlog slot');
  assert.ok(next > now);
});

test('determinism: identical schedule+now always returns the identical instant (required for safe concurrent claiming)', () => {
  const now = Date.UTC(2026, 5, 15, 10, 0, 0);
  const s = schedule({ sendHour: 7 });
  const a = computeNextRunAt(s, now);
  const b = computeNextRunAt(s, now);
  assert.equal(a, b);
});

test('unknown/garbage frequency returns null rather than throwing', () => {
  assert.equal(computeNextRunAt(schedule({ frequency: 'monthly' }), Date.now()), null);
});

// ── DST correctness ─────────────────────────────────────────────────────────
// Rather than hardcode a transition date (fragile if US DST rules or the
// test year ever change), discover the actual spring-forward and fall-back
// instants for TZ by scanning daily offsets across the year — self-verifying.

function findTransitions(year, timeZone) {
  const transitions = [];
  let prevOffset = getTzOffsetMinutes(new Date(Date.UTC(year, 0, 1, 12)), timeZone);
  for (let day = 2; day <= 365; day += 1) {
    const d = new Date(Date.UTC(year, 0, day, 12));
    const offset = getTzOffsetMinutes(d, timeZone);
    if (offset !== prevOffset) transitions.push({ day, from: prevOffset, to: offset });
    prevOffset = offset;
  }
  return transitions;
}

test('spring-forward: sendHour inside the skipped hour still returns a well-formed, later instant (never throws)', () => {
  const transitions = findTransitions(2026, TZ);
  const springForward = transitions.find((t) => t.to > t.from); // offset moves later (e.g. -6h -> -5h)
  assert.ok(springForward, 'expected to find a spring-forward transition in 2026 for America/Chicago');
  // The day before the transition, at noon local — well before the 2am gap.
  const dayBefore = new Date(Date.UTC(2026, 0, springForward.day - 1, 18)); // ~noon CST
  const p = getZonedParts(dayBefore, TZ);
  const now = Date.UTC(p.year, p.month - 1, p.day, 12); // treat as a UTC anchor for the test's `now`
  const next = computeNextRunAt(schedule({ sendHour: 2 }), now); // 2am is the classically-skipped hour
  assert.equal(typeof next, 'number');
  assert.ok(Number.isFinite(next));
  assert.ok(next > now);
});

test('fall-back: sendHour inside the repeated hour still returns a well-formed, later instant (never throws)', () => {
  const transitions = findTransitions(2026, TZ);
  const fallBack = transitions.find((t) => t.to < t.from); // offset moves earlier
  assert.ok(fallBack, 'expected to find a fall-back transition in 2026 for America/Chicago');
  const dayBefore = new Date(Date.UTC(2026, 0, fallBack.day - 1, 18));
  const p = getZonedParts(dayBefore, TZ);
  const now = Date.UTC(p.year, p.month - 1, p.day, 12);
  const next = computeNextRunAt(schedule({ sendHour: 1 }), now); // 1am is the classically-repeated hour
  assert.equal(typeof next, 'number');
  assert.ok(Number.isFinite(next));
  assert.ok(next > now);
});

test('DST does not shift the LOCAL sendHour: the computed instant always reads back as sendHour:00 in the zone, both sides of a transition', () => {
  const transitions = findTransitions(2026, TZ);
  for (const t of transitions) {
    for (const daysBefore of [3, 1]) {
      const anchor = new Date(Date.UTC(2026, 0, t.day - daysBefore, 18));
      const p = getZonedParts(anchor, TZ);
      const now = Date.UTC(p.year, p.month - 1, p.day, 0); // midnight-ish UTC anchor, before sendHour local
      const next = computeNextRunAt(schedule({ sendHour: 9 }), now);
      const nextParts = getZonedParts(new Date(next), TZ);
      assert.equal(nextParts.hour, 9, `expected local hour 9 at UTC ${new Date(next).toISOString()} near transition day ${t.day}`);
    }
  }
});
