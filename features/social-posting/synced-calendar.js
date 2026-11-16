// synced-calendar.js — show other clients' calendars inside a viewer's calendar, view-only.
//
// A viewer (e.g. the HITLOOP client) lists source clients in client_configs/{viewer}.calendarSyncs. For every entry
// in 'draft' mode ("Show only", the default) the month-calendar action builds the SOURCE's own month calendar and
// merges its post rows into the viewer's days: drafts, proposals, scheduled, awaiting approval, posted, failed —
// exactly where the source's calendar puts them. Nothing is written: no copy rows, no approvals, nothing to publish.
//
// Every merged row is re-keyed `synced:<sourceClientId>:<postId>` and carries `readOnly: true` plus
// `synced: { clientId, name, postId }`. The UI hides its actions; the dashboard routes refuse any action whose post
// id is a synced id (`isSyncedId`), and the id cannot match a real social_posts row in the viewer's scope anyway.
// The viewer's own counts, totals, flags and review queue are untouched (they describe the viewer's own posts).
// 'schedule' entries keep the mirror-copy behaviour of ./calendar-sync.js and are not shown here (no double rows).

export const SYNCED_ID_PREFIX = 'synced:';

export const isSyncedId = (id) => typeof id === 'string' && id.startsWith(SYNCED_ID_PREFIX);

/** The entries shown view-only (everything except auto-post copies). */
export const shownEntries = (list) => (Array.isArray(list) ? list.filter((e) => e?.clientId && e.mode !== 'schedule') : []);

/** True when an action body names a synced (view-only) row in any of the id fields the calendar actions use. */
export function bodyTargetsSyncedRow(body) {
  if (!body || typeof body !== 'object') return false;
  return ['postId', 'id', 'rowId'].some((k) => isSyncedId(body[k]));
}

/** One source row as a view-only row on the viewer's calendar. Pure. */
export function toSyncedRow(row, source) {
  return {
    ...row,
    id: `${SYNCED_ID_PREFIX}${source.clientId}:${row.id}`,
    readOnly: true,
    synced: { clientId: source.clientId, name: source.name || source.clientId, postId: row.id },
  };
}

const rowMs = (r) => {
  const ms = Date.parse(r?.scheduledAt || r?.proposedAt || r?.postedAt || '');
  return Number.isFinite(ms) ? ms : Infinity;
};

/**
 * Pure. Merge source calendars (buildMonthCalendar shape) into the viewer's calendar for the same month.
 * sources: [{ clientId, name, calendar } | { clientId, error }]. Only `kind: 'post'` rows are shown (suggestions,
 * requotes and tasks are the source's own working items, not its calendar of posts). Returns a new calendar with
 * `synced: [{ clientId, name, rows } | { clientId, error }]`; the input is not mutated.
 */
export function mergeSyncedCalendars(calendar, sources = []) {
  if (!calendar || !Array.isArray(calendar.weeks)) return calendar;
  const extra = new Map();
  const summary = [];
  for (const src of Array.isArray(sources) ? sources : []) {
    if (!src?.clientId) continue;
    if (src.error || !src.calendar?.weeks) {
      summary.push({ clientId: src.clientId, name: src.name || src.clientId, error: src.error || 'Could not load that calendar.' });
      continue;
    }
    let rows = 0;
    for (const day of src.calendar.weeks.flat()) {
      for (const r of Array.isArray(day?.posts) ? day.posts : []) {
        if (r?.kind !== 'post' || !r.id) continue;
        if (!extra.has(day.date)) extra.set(day.date, []);
        extra.get(day.date).push(toSyncedRow(r, src));
        rows += 1;
      }
    }
    summary.push({ clientId: src.clientId, name: src.name || src.clientId, rows });
  }
  const weeks = calendar.weeks.map((week) => week.map((day) => {
    const add = extra.get(day.date);
    if (!add?.length) return day;
    // Stable merge by time; rows without a time (review-day items) keep their place at the end.
    const posts = [...(day.posts || []), ...add]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rowMs(a.r) - rowMs(b.r) || a.i - b.i)
      .map(({ r }) => r);
    return { ...day, posts, syncedCount: add.length };
  }));
  return { ...calendar, weeks, synced: summary };
}
