// Time and id helpers: local date, zoned wall-clock to ISO, stable hash, and the
// derived suggestion / social-post ids.
// Decides when and what to call things deterministically; never reads clocks implicitly or does I/O.
// Depends on config only.

import { DEFAULT_TIMEZONE } from './config.js';

// --- time ----------------------------------------------------------------------

export function localDateOf(now, timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

function tzOffsetMs(utcMs, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs;
}

/** A wall-clock time in `timezone` -> ISO UTC. Never parses the CT clock as UTC. */
export function zonedTimeToIso(localDate, hhmm, timezone = DEFAULT_TIMEZONE) {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - tzOffsetMs(guess, timezone);
  utc = guess - tzOffsetMs(utc, timezone);
  return new Date(utc).toISOString();
}

// --- ids -----------------------------------------------------------------------

/** FNV-1a, hex. Stable ids without node:crypto, so this file stays pure. */
export function stableHash(input) {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function suggestionIdFor({ clientId, localDate, opportunityId, packageId }) {
  return `dl_${localDate.replace(/-/g, '')}_${stableHash(`${clientId}|${localDate}|${opportunityId || 'original'}|${packageId || 'none'}`)}`;
}

/** The queue id Save Draft writes to. Derived, so a double-click lands on the same row. */
export function socialPostIdFor(suggestionId) {
  return `social_${suggestionId}`;
}
