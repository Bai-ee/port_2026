/**
 * Holiday signal provider for Strategy Builder.
 * Resolves fixed-date and moveable-feast holidays within a campaign window.
 */

import { getHolidaysForVertical } from '../holidays-vertical-map.js';

/**
 * Compute the next ISO date (YYYY-MM-DD) for a holiday with a fixed MM-DD,
 * on or after startDate. Tries current year, then next year.
 * @param {string} mmdd  — e.g. "05-05"
 * @param {Date} startRef — start of window
 * @returns {string} ISO date
 */
function resolveFixedDate(mmdd, startRef) {
  const year = startRef.getFullYear();
  for (const y of [year, year + 1]) {
    const candidate = new Date(`${y}-${mmdd}T00:00:00Z`);
    if (candidate >= startRef) return candidate.toISOString().slice(0, 10);
  }
  // fallback — next year
  return `${year + 1}-${mmdd}`;
}

/**
 * Approximate resolver for common moveable feast descriptions.
 * Returns an estimated ISO date string. Accuracy sufficient for signal window.
 * @param {string} dateRule
 * @param {Date} startRef
 * @returns {string} ISO date (estimated)
 */
function resolveDateRule(dateRule, startRef) {
  const rule = dateRule.toLowerCase();
  const year = startRef.getFullYear();

  /** nth weekday of a month. weekday: 0=Sun..6=Sat */
  function nthWeekday(y, month, weekday, n) {
    const d = new Date(Date.UTC(y, month, 1));
    let count = 0;
    while (d.getUTCMonth() === month) {
      if (d.getUTCDay() === weekday) {
        count++;
        if (count === n) return d.toISOString().slice(0, 10);
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return null;
  }

  /** Last weekday of a month */
  function lastWeekday(y, month, weekday) {
    const d = new Date(Date.UTC(y, month + 1, 0)); // last day of month
    while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  for (const y of [year, year + 1]) {
    let result = null;

    if (rule.includes('first sunday of february')) {
      result = nthWeekday(y, 1, 0, 1);
    } else if (rule.includes('second sunday of may')) {
      result = nthWeekday(y, 4, 0, 2);
    } else if (rule.includes('third sunday of june')) {
      result = nthWeekday(y, 5, 0, 3);
    } else if (rule.includes('third friday of june')) {
      result = nthWeekday(y, 5, 5, 3);
    } else if (rule.includes('last monday of may')) {
      result = lastWeekday(y, 4, 1);
    } else if (rule.includes('first monday of september')) {
      result = nthWeekday(y, 8, 1, 1);
    } else if (rule.includes('fourth thursday of november')) {
      result = nthWeekday(y, 10, 4, 4);
    } else if (rule.includes('fourth friday of november')) {
      result = nthWeekday(y, 10, 5, 4);
    } else if (rule.includes('monday after thanksgiving')) {
      // Thanksgiving = 4th Thursday of November, Cyber Monday = following Monday
      const thxg = nthWeekday(y, 10, 4, 4);
      if (thxg) {
        const d = new Date(thxg + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 4); // Thursday + 4 = Monday
        result = d.toISOString().slice(0, 10);
      }
    }

    if (result) {
      const candidateDate = new Date(result + 'T00:00:00Z');
      if (candidateDate >= startRef) return result;
    }
  }

  // Fallback: estimate based on rule text — return next-year placeholder
  return `${year + 1}-01-01`;
}

/**
 * Returns holidays for the given vertical that fall within the campaign window.
 * @param {{ vertical: string, enabled: boolean, startDate: string, days: number }} opts
 * @returns {Promise<{ enabled: boolean, items: import('../schemas.js').Holiday[] }>}
 */
export async function getHolidays({ vertical, enabled, startDate, days }) {
  if (!enabled) return { enabled: false, items: [] };

  const candidates = getHolidaysForVertical(vertical);
  if (!candidates.length) return { enabled: true, items: [] };

  const windowStart = new Date(startDate + 'T00:00:00Z');
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + days);

  const resolved = [];
  let upcoming = null; // soonest legitimate anchor just beyond the window

  for (const holiday of candidates) {
    let resolvedDate;
    if (holiday.date) {
      resolvedDate = resolveFixedDate(holiday.date, windowStart);
    } else if (holiday.dateRule) {
      resolvedDate = resolveDateRule(holiday.dateRule, windowStart);
    } else {
      continue;
    }

    const d = new Date(resolvedDate + 'T00:00:00Z');
    if (d >= windowStart && d < windowEnd) {
      resolved.push({ ...holiday, resolvedDate });
    } else if (d >= windowEnd) {
      if (!upcoming || d < new Date(upcoming.resolvedDate + 'T00:00:00Z')) {
        upcoming = { ...holiday, resolvedDate };
      }
    }
  }

  // Always give the strategist the next horizon anchor so the calendar can
  // point forward even when no holiday falls inside the window.
  return { enabled: true, items: resolved, upcoming };
}
