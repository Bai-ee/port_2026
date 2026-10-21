// Which quote-targets POST actions need the owner-pilot gate (requirePilotOwner) and which only need admin + client context.
//
// The pilot gate protects the transactional posting machinery: approve, schedule, reserve slots, post-now, reconcile,
// the global package store, NAS / Discogs / media mutation, anything that spends (X API, paid sync) and anything that
// lets the agent act on its own (autonomy, proposal confirm, undo). Strategy work, reads and DRAFT creation do not
// schedule, reserve, publish or spend, so any client the admin can open may use them.
//
// DEFAULT IS THE GATE: an action not named below (including every future one) requires the pilot owner. Loosening an
// action is an explicit edit to this list plus a test. Pure and dependency-free so a test can pin it.

/** Admin + client context is enough. Reads, strategy/plan/doc edits, draft creation (never schedules). */
export const PILOT_FREE_ACTIONS = Object.freeze(new Set([
  // strategy reads and edits (plan doc, strategy doc, profile, reply style, chat)
  'strategy-get', 'strategy-refresh-status', 'strategy-evaluate-handle', 'strategy-plan-apply', 'strategy-plan-revert',
  'strategy-chat-send', 'strategy-chat-history', 'strategy-profile-save', 'strategy-doc-get', 'strategy-doc-save',
  'strategy-doc-revert', 'strategy-review', 'strategy-freshness', 'strategy-action-log', 'strategy-autonomy-get',
  'strategy-reply-style-get', 'strategy-reply-style-save', 'strategy-unmet-list', 'strategy-unmet-status',
  'x-data-sources-get',
  // draft creation only (unscheduled social_posts rows; no slot, no ledger, no plan enforcement)
  'strategy-calendar-batch-preview', 'strategy-calendar-batch-create', 'strategy-daily-fill-preview', 'strategy-daily-fill-create',
  'draft-quote', 'create-draft-from-item', 'dismiss', 'bookmark-decide',
  // Today queue
  'daily-run-latest', 'daily-run-generate', 'daily-run-edit', 'daily-run-dismiss', 'daily-run-save-draft',
  // quote targets (free Mac-queue scans and reads)
  'quote-scan-status', 'hot-quotes-find', 'bookmarks-find', 'bookmarks-list',
  // pure reads
  'content-context', 'content-plan', 'inventory-list', 'post-status', 'quoted-post-preview', 'post-results',
  'month-calendar', 'now', 'engine-performance', 'list-buckets', 'list-folders',
  'timeline-day', 'timeline-days', 'timeline-search', 'timeline-archives',
]));

/** Loose unless the caller sets the paid flag: the same click that spends is the owner-pilot-only path. */
const PAID_FLAG_ACTIONS = Object.freeze({
  'strategy-refresh': (body) => body?.confirmPaid === true,
  'quote-scan-refresh': (body) => body?.confirmPaid === true,
  'daily-run-generate': (body) => body?.draftWithModel === true,
});

/** @returns {boolean} true when requirePilotOwner must run for this POST action. */
export function actionNeedsPilot(action, body) {
  const a = String(action || '');
  const paid = PAID_FLAG_ACTIONS[a];
  if (paid && paid(body)) return true;
  if (PILOT_FREE_ACTIONS.has(a)) return false;
  if (paid) return false; // strategy-refresh / quote-scan-refresh without the paid flag
  return true;
}
