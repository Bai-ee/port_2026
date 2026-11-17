// synced-calendar.js — show other clients' calendars inside a viewer's calendar; open a row to make it the viewer's own.
//
// A viewer (e.g. the HITLOOP client) lists source clients in client_configs/{viewer}.calendarSyncs. For every entry
// in 'draft' mode ("Show only", the default) the month-calendar action builds the SOURCE's own month calendar and
// merges its post rows into the viewer's days: drafts, proposals, scheduled, awaiting approval, posted, failed —
// exactly where the source's calendar puts them. Showing writes nothing.
//
// Every merged row is re-keyed `synced:<sourceClientId>:<postId>` and carries `readOnly: true` plus
// `synced: { clientId, name, postId }`. The dashboard routes refuse every action on a synced id (`isSyncedId`) except
// SYNCED_ADOPT_ACTION below; the id cannot match a real social_posts row in the viewer's scope anyway.
// The viewer's own counts, totals, flags and review queue are untouched (they describe the viewer's own posts).
// 'schedule' entries keep the mirror-copy behaviour of ./calendar-sync.js and are not shown here (no double rows).
//
// OPEN = ADOPT (owner rule 2026-11-17): opening a synced row makes the viewer's OWN copy of that post (a draft on the
// viewer's calendar, `adoptedFrom: { clientId, postId }`) and opens it in the normal editor: copy, creative, X /
// Instagram, approve, schedule are all the viewer's. The source's post is read once and never written. Once adopted,
// the synced row is hidden and the viewer's copy shows in its place. Pushing anything back to the source channels is
// a separate, owner-asked step (chat).

export const SYNCED_ID_PREFIX = 'synced:';

export const isSyncedId = (id) => typeof id === 'string' && id.startsWith(SYNCED_ID_PREFIX);

/** { clientId, postId } of a synced id, or null. Client ids never contain ':'; the post id is the rest. */
export function parseSyncedId(id) {
  if (!isSyncedId(id)) return null;
  const rest = id.slice(SYNCED_ID_PREFIX.length);
  const i = rest.indexOf(':');
  if (i < 1 || i === rest.length - 1) return null;
  return { clientId: rest.slice(0, i), postId: rest.slice(i + 1) };
}

/** The only action allowed on a synced row: make (or reuse) the viewer's own copy of it. */
export const SYNCED_ADOPT_ACTION = 'synced-adopt';
export const adoptKey = (sourceClientId, postId) => `${sourceClientId}:${postId}`;
export const adoptIdempotencyKey = (sourceClientId, postId) => `synced-adopt:${sourceClientId}:${postId}`;

/** adoptKeys of every source post the viewer already has its own copy of (any status). */
export function adoptedKeys(viewerPosts) {
  const out = new Set();
  for (const p of Array.isArray(viewerPosts) ? viewerPosts : []) {
    if (p?.adoptedFrom?.clientId && p.adoptedFrom.postId) out.add(adoptKey(p.adoptedFrom.clientId, p.adoptedFrom.postId));
  }
  return out;
}

/**
 * Pure. The draft payload for the viewer's own copy of a source post (ensureDraftPost). Copy, creative and planned time
 * come from the source; channels start on X only (the editor's X / Instagram toggles change them).
 */
export function adoptPayload(sourcePost, sourceClientId) {
  const at = sourcePost?.scheduledAt || sourcePost?.plannedAt || null;
  const planned = Number.isFinite(Date.parse(String(at || ''))) && Date.parse(at) > Date.now() ? at : null;
  return {
    idempotencyKey: adoptIdempotencyKey(sourceClientId, sourcePost.id),
    content: sourcePost.content,
    source: 'synced-adopt',
    adoptedFrom: { clientId: sourceClientId, postId: sourcePost.id },
    targets: { x: true, instagram: false },
    ...(planned ? { plannedAt: planned } : {}),
    ...(sourcePost.mediaUrl ? {
      mediaUrl: sourcePost.mediaUrl,
      mediaType: sourcePost.mediaType || null,
      mediaContentType: sourcePost.mediaContentType || null,
      mediaStoragePath: sourcePost.mediaStoragePath || null,
      mediaJobId: sourcePost.mediaJobId || null,
    } : {}),
    ...(sourcePost.mediaVariants ? { mediaVariants: sourcePost.mediaVariants } : {}),
    ...(sourcePost.nasSha ? { nasSha: sourcePost.nasSha } : {}),
  };
}

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
 * sources: [{ clientId, name, calendar } | { clientId, error }]. adopted: Set of adoptKeys the viewer already copied (hidden). Only `kind: 'post'` rows are shown (suggestions,
 * requotes and tasks are the source's own working items, not its calendar of posts). Returns a new calendar with
 * `synced: [{ clientId, name, rows } | { clientId, error }]`; the input is not mutated.
 */
export function mergeSyncedCalendars(calendar, sources = [], adopted = null) {
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
        if (adopted?.has?.(adoptKey(src.clientId, r.id))) continue; // the viewer's own copy shows instead
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
