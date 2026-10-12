// Pure view helpers for components/dashboard/x-content/TimelinePanel.jsx.
// Client-safe: no node builtins, no Firestore.

const MIN_YEAR = 1990;

/**
 * A native <input type="date"> fires onChange per typed segment, so "2019"
 * passes through "0002", "0020", "0201" first. Only a full YYYY-MM-DD with a
 * plausible year is worth a lookup.
 */
export function isCompleteDay(value, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > now.getUTCFullYear() + 1) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Latest archive day for a platform ('' = all platforms); '' when none. */
export function latestDayFor(archives, platform = '') {
  return (Array.isArray(archives) ? archives : [])
    .filter((a) => !platform || a.platform === platform)
    .map((a) => (a.lastTs ? String(a.lastTs).slice(0, 10) : ''))
    .filter(Boolean)
    .sort()
    .pop() || '';
}

/** Header text for an open day: filtered count first when a platform filter hides entries. */
export function dayCountLabel(shown, total, platformName = '') {
  const word = (n) => `entr${n === 1 ? 'y' : 'ies'}`;
  if (!platformName || shown === total) return `${total} ${word(total)}`;
  return `${shown} ${platformName} ${word(shown)} of ${total}`;
}
