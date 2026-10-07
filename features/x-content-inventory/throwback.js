// Throwbacks — "On this day" for flyers (printed event dates only).
//
// OWNER RULE: dates come only from the flyer's printed text, carried in the
// eventMonthDay / eventDates facets. Nothing here ever reads capturedAt, file
// dates or folder names. Pure: no fs, no network; "today" is always injected.

import { effectiveFacets, eventPairs, sanitizeEventFacets } from './facets.js';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** True when the item carries at least one printed event date. */
export function hasEventDate(item) {
  return eventPairs(effectiveFacets(item || {})).length > 0;
}

/** Occurrence of MM-DD in `year` as a UTC day number; Feb 29 in a non-leap year lands on Feb 28. */
function occurrence(monthDay, year) {
  const m = Number(monthDay.slice(0, 2)); let d = Number(monthDay.slice(3));
  if (m === 2 && d === 29 && !isLeap(year)) d = 28;
  return Date.UTC(year, m - 1, d) / DAY_MS;
}

function parseToday(todayISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayISO ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  const t = Date.UTC(y, Number(m[2]) - 1, Number(m[3]));
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== Number(m[2]) - 1 || dt.getUTCDate() !== Number(m[3])) return null;
  return { year: y, day: t / DAY_MS };
}

/**
 * Items whose printed event month/day is within ±windowDays of today's
 * month/day, year ignored (Dec/Jan wrap and Feb 29 handled).
 * Returns [{ item, monthDay, yearsAgo: number|null, yearKnown: boolean }],
 * nearest first, then oldest event first.
 */
export function onThisDay(items, todayISO, { windowDays = 3 } = {}) {
  const today = parseToday(todayISO);
  if (!today || !Array.isArray(items)) return [];
  const window = Math.max(0, Math.floor(Number(windowDays) || 0));
  const out = [];
  for (const item of items) {
    let best = null;
    for (const { monthDay, year } of eventPairs(effectiveFacets(item || {}))) {
      for (const y of [today.year - 1, today.year, today.year + 1]) {
        const diff = Math.abs(occurrence(monthDay, y) - today.day);
        if (diff > window) continue;
        const known = year != null;
        const yearsAgo = known && y - year >= 0 ? y - year : null; // anniversary year minus event year
        const cand = { diff, monthDay, yearsAgo, yearKnown: known };
        if (!best || diff < best.diff || (diff === best.diff && known && !best.yearKnown)) best = cand;
      }
    }
    if (best) out.push({ item, monthDay: best.monthDay, yearsAgo: best.yearsAgo, yearKnown: best.yearKnown, diff: best.diff });
  }
  out.sort((a, b) => a.diff - b.diff || (b.yearsAgo ?? -1) - (a.yearsAgo ?? -1) || String(a.item?.id).localeCompare(String(b.item?.id)));
  return out.map(({ diff, ...r }) => r);
}

const fmtMonthDay = (md) => `${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3))}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
function joinYears(ys) {
  if (ys.length <= 1) return String(ys[0]);
  return `${ys.slice(0, -1).join(', ')} or ${ys[ys.length - 1]}`;
}

/**
 * Drawer copy, from the event-date facets only.
 * Returns null when there is no event date, else { line, printed|null }.
 */
export function describeEventDate(facets) {
  const e = sanitizeEventFacets(facets || {});
  const pairs = eventPairs(facets || {});
  if (!pairs.length) return null;
  const primary = pairs[0];
  const entry = (e.eventDates || []).find((d) => d.monthDay === primary.monthDay && (primary.year == null || d.year === primary.year || d.year == null));
  const source = e.eventYearSource || entry?.yearSource || null;
  let line = `Event date: ${fmtMonthDay(primary.monthDay)}`;
  if (primary.year != null) {
    line += `, ${primary.year}`;
    if (source === 'weekday') line += ` · inferred from ${entry?.weekday ? cap(entry.weekday) : 'the weekday'}`;
  } else if (e.eventYearCandidates?.length) {
    line += ` · year could be ${joinYears(e.eventYearCandidates)}`;
  } else {
    line += ' · year unknown';
  }
  const raw = e.eventDateRaw || entry?.raw || '';
  return { line, printed: raw ? `Printed: "${raw}"` : null };
}
