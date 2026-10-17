// Pure row model for the one-calendar approval marks, filters and inline approve controls.
// Reads the uniform fields the month-calendar data layer adds to every row:
//   approval: 'unapproved'|'approved'|'scheduled'|'posted'|'held'|'suggested'
//   kind: 'suggestion'|'requote' (suggestion rows only), state: 'suggested'
// Every helper falls back to the legacy `state` so the UI still works before the data layer ships.

export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unapproved', label: 'Unapproved' },
  { value: 'approved', label: 'Approved' },
  { value: 'suggestions', label: 'Suggestions' },
];

export const APPROVAL_LABEL = {
  unapproved: 'Unapproved',
  approved: 'Approved',
  scheduled: 'Scheduled',
  posted: 'Posted',
  held: 'Held',
  suggested: 'Suggested',
  failed: 'Failed',
};

export const isSuggestionRow = (row) => row?.kind === 'suggestion' || row?.kind === 'requote' || row?.state === 'suggested';

/** Uniform approval value for a row (data field first, legacy state second). */
export function rowApproval(row) {
  if (!row) return 'unapproved';
  if (isSuggestionRow(row)) return 'suggested';
  if (row.approval) return row.approval;
  switch (row.state) {
    case 'approved': return 'approved';
    case 'scheduled': return 'scheduled';
    case 'manual': return 'scheduled';
    case 'posted': return 'posted';
    case 'held': return 'held';
    case 'failed': return 'failed';
    default: return 'unapproved'; // pending / awaiting
  }
}

/** Which mark to draw: suggestion rows use their kind (sparkle vs quote), the rest use the approval value. */
export function rowMark(row) {
  const a = rowApproval(row);
  if (a === 'suggested') return row?.kind === 'requote' ? 'requote' : 'suggestion';
  return a;
}

/** Filter chip match. Chips are about review work, so posted/held/failed only show under All. */
export function matchesFilter(row, filter) {
  if (!filter || filter === 'all') return true;
  const a = rowApproval(row);
  if (filter === 'unapproved') return a === 'unapproved';
  if (filter === 'approved') return a === 'approved' || a === 'scheduled';
  if (filter === 'suggestions') return a === 'suggested';
  return true;
}

export const filterRows = (rows, filter) => (Array.isArray(rows) ? rows.filter((r) => matchesFilter(r, filter)) : []);

/** Approve inline: unapproved saved posts, and suggestions that are still actionable. Never schedules. */
export function canApproveRow(row, nowMs = Date.now()) {
  const a = rowApproval(row);
  if (a === 'unapproved') return row?.status !== 'needs_review';
  if (a === 'suggested') return !isRowWindowClosed(row, nowMs);
  return false;
}

/** Unapprove = approved -> draft, only when not scheduled. */
export const canUnapproveRow = (row) => rowApproval(row) === 'approved';

export function isRowWindowClosed(row, nowMs = Date.now()) {
  if (row?.windowOpen === false) return true;
  const t = row?.expiresAt ? Date.parse(row.expiresAt) : NaN;
  return Number.isFinite(t) && t < nowMs;
}

/** "5h left" / "40m left" / "closed" for a requote row; '' when there is no expiry. */
export function windowLeftLabel(row, nowMs = Date.now()) {
  const t = row?.expiresAt ? Date.parse(row.expiresAt) : NaN;
  if (!Number.isFinite(t)) return '';
  const ms = t - nowMs;
  if (ms <= 0) return 'closed';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m left`;
  const hrs = Math.floor(mins / 60);
  return hrs < 48 ? `${hrs}h left` : `${Math.floor(hrs / 24)}d left`;
}

/** Everything a day shows, in one list: saved posts plus any separate suggestion/requote arrays, deduped by id. */
export function dayRows(day) {
  if (!day) return [];
  const seen = new Set();
  const out = [];
  for (const r of [...(day.posts || []), ...(day.suggestions || []), ...(day.requotes || [])]) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** Apply optimistic overrides ({ [id]: 'approved'|'unapproved' }) to a row. */
export function withOverride(row, overrides) {
  const o = overrides?.[row?.id];
  if (!o) return row;
  if (o === 'approved') return { ...row, approval: 'approved', state: isSuggestionRow(row) ? 'approved' : (row.state === 'pending' || row.state === 'awaiting' ? 'approved' : row.state), kind: undefined };
  if (o === 'unapproved') return { ...row, approval: 'unapproved', state: 'pending' };
  return row;
}

/** Route action + body for approving a row inline. */
export function approveRequest(row) {
  if (isSuggestionRow(row)) {
    const requote = row.kind === 'requote';
    // The server wants the raw suggestion / quote-target id; row.id is prefixed ('suggestion:<id>' / 'requote:<id>') to stay unique.
    const raw = (requote ? row.quoteTargetId : row.suggestionId) ?? String(row.id || '').replace(/^(suggestion|requote):/, '');
    return { action: 'calendar-suggestion-approve', body: { kind: requote ? 'requote' : 'suggestion', id: raw, date: row.date || null } };
  }
  return { action: 'calendar-approve', body: { postId: row.id } };
}

export const unapproveRequest = (row) => ({ action: 'calendar-unapprove', body: { postId: row.id } });

/** True when approving would strip a blocking placeholder (post sheet label). */
export function hasBlockingPlaceholder(text) {
  return /\[add your (memory|take)\]/i.test(String(text || ''));
}
