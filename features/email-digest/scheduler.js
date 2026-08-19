// scheduler.js — pure per-client send-time computation for the email digest
// (EMAIL-REBUILD-PLAN.md Phase 3, owner decision: real per-client hours,
// GitHub-Actions dispatcher, hour precision). No I/O, no Firestore, no
// Next-specific imports — safe to unit-test directly and safe to import from
// the worker dispatch route.
//
// `schedule` is the existing normalizeSchedule() shape from
// features/intelligence/_digest-config.js: { enabled, frequency, sendHour,
// weekday, timezone }. This module does not validate that shape — callers
// pass an already-normalized schedule.

/** Local wall-clock parts of `date` inside `timeZone`, DST-aware. */
function getZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month), // 1-12
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // Intl can format midnight as "24" under h23 in some engines
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY[parts.weekday],
  };
}

/** `timeZone`'s UTC offset in minutes (positive = ahead of UTC) at `date`. */
function getTzOffsetMinutes(date, timeZone) {
  const p = getZonedParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUtc - date.getTime()) / 60000;
}

/**
 * The UTC instant for local wall-clock (y, mo 0-based, d, h, mi, s) in
 * `timeZone`. Iterates to converge across a DST boundary (the offset a
 * candidate instant lands on can put it on either side of a transition).
 * A wall-clock time that doesn't exist (spring-forward gap) or occurs twice
 * (fall-back overlap) resolves to a well-defined instant either way — never
 * throws — since a daily-digest sendHour landing exactly on a transition
 * moment is an acceptable, rare edge case, not a crash.
 */
function zonedTimeToUtc(y, mo, d, h, mi, s, timeZone) {
  let guess = Date.UTC(y, mo, d, h, mi, s);
  for (let i = 0; i < 4; i += 1) {
    const offsetMin = getTzOffsetMinutes(new Date(guess), timeZone);
    const corrected = Date.UTC(y, mo, d, h, mi, s) - offsetMin * 60000;
    if (corrected === guess) return corrected;
    guess = corrected;
  }
  return guess;
}

/** Pure calendar-day arithmetic (no timezone) on a {year, month, day} triple. */
function addCalendarDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/**
 * The next occurrence of `schedule`, strictly after `now` (ms epoch).
 * Returns null when the schedule is disabled/off.
 *
 * Missed-run recovery is implicit, not a separate code path: this function
 * always computes relative to the CALLER-SUPPLIED `now`, never relative to a
 * stale stored nextRunAt. A dispatcher that calls
 * `computeNextRunAt(schedule, Date.now())` right after claiming a due
 * occurrence — no matter how overdue that occurrence was — always lands on
 * the next real future slot. There is no way to accumulate a backlog: at
 * most one occurrence is ever claimable per client, because nextRunAt is a
 * single scalar, not a queue.
 */
function computeNextRunAt(schedule, now = Date.now()) {
  const { enabled, frequency, sendHour, weekday, timezone } = schedule || {};
  if (!enabled || frequency === 'off' || (frequency !== 'daily' && frequency !== 'weekly')) return null;

  const nowParts = getZonedParts(new Date(now), timezone);

  if (frequency === 'daily') {
    let candidate = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    let candidateUtc = zonedTimeToUtc(candidate.year, candidate.month - 1, candidate.day, sendHour, 0, 0, timezone);
    if (candidateUtc <= now) {
      candidate = addCalendarDays(candidate, 1);
      candidateUtc = zonedTimeToUtc(candidate.year, candidate.month - 1, candidate.day, sendHour, 0, 0, timezone);
    }
    return candidateUtc;
  }

  // weekly
  const daysAhead = ((weekday - nowParts.weekday) + 7) % 7;
  let candidate = addCalendarDays({ year: nowParts.year, month: nowParts.month, day: nowParts.day }, daysAhead);
  let candidateUtc = zonedTimeToUtc(candidate.year, candidate.month - 1, candidate.day, sendHour, 0, 0, timezone);
  if (candidateUtc <= now) {
    candidate = addCalendarDays({ year: nowParts.year, month: nowParts.month, day: nowParts.day }, daysAhead + 7);
    candidateUtc = zonedTimeToUtc(candidate.year, candidate.month - 1, candidate.day, sendHour, 0, 0, timezone);
  }
  return candidateUtc;
}

export { computeNextRunAt, getZonedParts, getTzOffsetMinutes, zonedTimeToUtc, addCalendarDays };
