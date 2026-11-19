// Pure model for the single View & Edit Post editor (PostEditor.jsx). No React, no fetch, no node builtins.
//
// What the server binds into an approval (features/social-posting/lifecycle.js contentHash):
//   content, selfReply, mediaUrl, mediaVariants, replyTo.
// The editor must show all of them, and Approve stays disabled while any of them is hidden from the operator.

export const MAX_CHARS = 280;
export const MIN_LEAD_MS = 60_000;
export const DEFAULT_TIME_ZONE = 'America/Chicago';

export const MEDIA_CHANGED_MESSAGE = 'New creative cleared approval — approve again.';
export const CONFLICT_MESSAGE = 'This post changed while you were editing. Your edit is kept; reload to see the latest, then re-apply it.';
export const OWNER_ONLY_MESSAGE = 'Only the account owner can approve or schedule.';

const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// ---- text ----

// A draft may carry "\n\nINTERNAL VIDEO BRIEF: <brief>" after the public copy (features/brief-video/brief.js). The brief is
// never published, so the count, the limit and "empty" look at the public copy only. The editor shows it in its own box.
export const BRIEF_MARKER_RE = /INTERNAL VIDEO BRIEF/i;
export const BRIEF_MAX_CHARS = 8000;
const BRIEF_SEP = '\n\n';
const BRIEF_PREFIX = 'INTERNAL VIDEO BRIEF: ';

/** { publicCopy, brief, hasBrief } — exact inverse of joinBrief for content joinBrief produced. */
export function splitBrief(content) {
  const text = String(content ?? '');
  const m = BRIEF_MARKER_RE.exec(text);
  if (!m) return { publicCopy: text, brief: '', hasBrief: false };
  let publicCopy = text.slice(0, m.index);
  if (publicCopy.endsWith(BRIEF_SEP)) publicCopy = publicCopy.slice(0, -BRIEF_SEP.length);
  const brief = text.slice(m.index).replace(/^INTERNAL VIDEO BRIEF:? ?/i, '');
  return { publicCopy, brief, hasBrief: true };
}

/** Public copy + brief back into one content string; an empty brief drops the marker. */
export const joinBrief = (publicCopy, brief) => (String(brief ?? '') === '' ? String(publicCopy ?? '') : `${publicCopy ?? ''}${BRIEF_SEP}${BRIEF_PREFIX}${brief}`);

export const charCount = (text) => splitBrief(text).publicCopy.length;
export const isOverLimit = (text, max = MAX_CHARS) => charCount(text) > max;
export const isEmptyText = (text) => !splitBrief(text).publicCopy.trim();
export const briefText = (text) => splitBrief(text).brief;
export const isBriefOverLimit = (text) => briefText(text).trim().length > BRIEF_MAX_CHARS;

// ---- time zone ----

export function resolveTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function zoneParts(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') === '24' ? '00' : get('hour'), mi: get('minute') };
}

/** { date: 'YYYY-MM-DD', time: 'HH:MM' } for an instant, in the client's zone. Empty strings when ms is not a number. */
export function formatInZone(ms, tz) {
  if (!Number.isFinite(ms)) return { date: '', time: '' };
  const p = zoneParts(ms, tz);
  return { date: `${p.y}-${p.mo}-${p.d}`, time: `${p.h}:${p.mi}` };
}

/** Wall clock in `tz` -> epoch ms (two-pass offset correction, DST safe except for the skipped/repeated hour). NaN on bad input. */
export function zonedWallToMs(date, time, tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return NaN;
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return NaN;
  const want = Date.UTC(y, m - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 2; i += 1) {
    const g = zoneParts(guess, tz);
    guess -= Date.UTC(Number(g.y), Number(g.mo) - 1, Number(g.d), Number(g.h), Number(g.mi)) - want;
  }
  return guess;
}

/** ISO string for a wall time in `tz`, or null when the fields are incomplete/invalid. */
export function whenToIso(when, tz) {
  const ms = zonedWallToMs(when?.date, when?.time, tz);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Editable wall time for a row (scheduled > proposed > posted), in `tz`. */
export function initialWhen(row, tz) {
  const iso = row?.scheduledAt || row?.proposedAt || row?.postedAt || null;
  const ms = iso ? Date.parse(iso) : NaN;
  return formatInZone(ms, tz);
}

/** True when `iso` is at least `leadMs` after `now`. */
export function isFutureEnough(iso, now = Date.now(), leadMs = MIN_LEAD_MS) {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) && ms >= now + leadMs;
}

/** Short zone label for display ("CDT", "GMT+1"). */
export function zoneLabel(tz, ms = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: resolveTimeZone(tz), timeZoneName: 'short' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || resolveTimeZone(tz);
  } catch {
    return resolveTimeZone(tz);
  }
}

// ---- row kind / status ----

export const isSuggestion = (row) => row?.kind === 'suggestion' || row?.kind === 'requote' || row?.state === 'suggested';

const LOCKED_STATUSES = new Set(['posted', 'failed', 'posting', 'needs_review', 'manual']);

/** Posted / failed / in flight / held: the copy can't be edited here (More menu only). */
export const isLockedRow = (row) => !!row && !isSuggestion(row) && (LOCKED_STATUSES.has(row.status) || row.state === 'held' || row.state === 'posted' || row.state === 'failed');

/** Pill the operator sees: Draft / Approved / Scheduled / Needs review (+ Posted / Failed / Suggestion). */
export function statusPill(row) {
  if (!row) return { key: 'draft', label: 'Draft' };
  if (isSuggestion(row)) return { key: 'suggestion', label: row.kind === 'requote' ? 'Requote' : 'Suggestion' };
  switch (row.status) {
    case 'approved': return { key: 'approved', label: 'Approved' };
    case 'scheduled': case 'queued': case 'posting': return { key: 'scheduled', label: 'Scheduled' };
    case 'needs_review': return { key: 'needs-review', label: 'Needs review' };
    case 'posted': return { key: 'posted', label: 'Posted' };
    case 'failed': return { key: 'failed', label: 'Failed' };
    case 'manual': return { key: 'scheduled', label: 'Posting manually' };
    default: break;
  }
  if (row.state === 'approved' || row.approval === 'approved') return { key: 'approved', label: 'Approved' };
  if (row.state === 'scheduled' || row.approval === 'scheduled') return { key: 'scheduled', label: 'Scheduled' };
  if (row.state === 'held') return { key: 'needs-review', label: 'Needs review' };
  return { key: 'draft', label: 'Draft' };
}

export const isApprovedStatus = (row) => !isSuggestion(row) && (row?.status === 'approved' || (!row?.status && (row?.state === 'approved' || row?.approval === 'approved')));
export const isScheduledStatus = (row) => !isSuggestion(row) && (['scheduled', 'queued'].includes(row?.status) || (!row?.status && row?.state === 'scheduled'));

// ---- approval-bound fields ----

/**
 * Everything the approval hash binds, normalised for display. `known` is false when the row simply doesn't carry the
 * field (the calendar row projection omits selfReply / mediaVariants / replyTo): an unknown field is a HIDDEN field.
 * Suggestions have nothing bound yet (no saved post), but a requote's quoted URL is always shown.
 */
export function boundFields(row) {
  if (!row) return [];
  if (isSuggestion(row)) {
    const url = row.quotedUrl || row.url || null;
    return [{ key: 'quote', label: 'Quoting', known: true, present: !!url, value: url }];
  }
  const field = (key, label) => {
    // A boolean (post-status projects replyTo as true/false) says a target exists but not what it is: still hidden.
    const known = hasOwn(row, key) && typeof row[key] !== 'boolean';
    const value = known ? row[key] : undefined;
    const present = known && value != null && value !== false && !(typeof value === 'object' && !Object.keys(value).length);
    return { key, label, known, present, value: present ? value : null };
  };
  return [
    field('selfReply', 'Self-reply'),
    field('mediaVariants', 'Media variants'),
    field('replyTo', 'Reply / quote target'),
  ];
}

/** { ok, hidden: [labels] }: ok only when every bound field is visible to the operator. */
export function boundFieldsGate(row) {
  const hidden = boundFields(row).filter((f) => !f.known).map((f) => f.label);
  return { ok: hidden.length === 0, hidden };
}

export function boundFieldsNotice(gate) {
  if (!gate || gate.ok) return '';
  return `Approval also locks in ${gate.hidden.join(', ').toLowerCase()}, which this row doesn't include. Reload the full post before approving.`;
}

// ---- dirty tracking ----

/** Compare the draft (content + wall time) against the row. Time only counts as dirty when the row had/has a time field. */
export function dirtyState({ row, content, when, tz }) {
  const original = row?.content ?? row?.text ?? '';
  const contentDirty = String(content ?? '') !== String(original);
  const o = initialWhen(row, tz);
  const timeDirty = (when?.date || '') !== o.date || (when?.time || '') !== o.time;
  return { contentDirty, timeDirty, dirty: contentDirty || timeDirty };
}

// ---- action enablement ----

/**
 * What the footer may do right now. One Approve button:
 *   approveMode 'schedule' : the post has a publish time -> approve-and-schedule at it (needs >= 1 min ahead).
 *   approveMode 'approve'  : no time set (unplaced) -> calendar-approve only.
 *   suggestions            : calendar-suggestion-approve (saves a draft, approves; no time yet).
 * Save: update (content, + scheduledAt for an already-scheduled post whose time moved).
 */
export function actionState({ row, content, when, tz, now = Date.now(), busy = false, dirty = null } = {}) {
  const none = { canSave: false, canApprove: false, approveMode: 'approve', approveBlockedReason: '', iso: null, isFuture: false };
  if (!row) return none;
  const suggestion = isSuggestion(row);
  const locked = isLockedRow(row);
  const iso = whenToIso(when, tz);
  const isFuture = isFutureEnough(iso, now);
  const over = isOverLimit(content) || isBriefOverLimit(content);
  const empty = isEmptyText(content);
  const hasBrief = briefText(content).trim() !== '';
  const gate = boundFieldsGate(row);
  const d = dirty || dirtyState({ row, content, when, tz });
  const approved = isApprovedStatus(row);
  const scheduled = isScheduledStatus(row);
  const hasTime = !suggestion && !!(when?.date || when?.time);
  const approveMode = hasTime ? 'schedule' : 'approve';

  let approveBlockedReason = '';
  if (busy) approveBlockedReason = 'Working…';
  else if (locked) approveBlockedReason = 'This post can no longer be approved here.';
  else if (empty) approveBlockedReason = 'Write something first.';
  else if (isBriefOverLimit(content)) approveBlockedReason = `Internal video brief is over ${BRIEF_MAX_CHARS} characters.`;
  else if (over) approveBlockedReason = `Over ${MAX_CHARS} characters.`;
  else if (hasBrief) approveBlockedReason = 'Internal video brief still on this post: attach the video first.';
  else if (row.videoBriefMeta && row.videoBriefMeta.status !== 'rendered' && !row.mediaUrl && String(row.videoBrief || '').trim()) approveBlockedReason = 'Creative Brief not rendered yet: wait for the video, or clear the brief.';
  else if (!gate.ok) approveBlockedReason = boundFieldsNotice(gate);
  else if (suggestion && row.windowOpen === false) approveBlockedReason = 'The window for this one has closed.';
  else if (!suggestion && row.status === 'needs_review') approveBlockedReason = 'Needs review before it can be approved.';
  else if (approveMode === 'schedule') {
    if (!iso) approveBlockedReason = 'Set a publish date and time.';
    else if (!isFuture) approveBlockedReason = 'Pick a time at least a minute from now.';
    else if (scheduled && !d.contentDirty && !d.timeDirty) approveBlockedReason = 'Already scheduled at that time.';
  } else if (!suggestion && approved && !d.contentDirty) approveBlockedReason = 'Already approved.';
  const canApprove = !approveBlockedReason;

  const canSave = !busy && !suggestion && !locked && !empty && !over && d.dirty && !(scheduled && d.timeDirty && !isFuture);
  return { canSave, canApprove, approveMode, approveBlockedReason, iso, isFuture };
}

// ---- request builders (action + body for the existing routes; nothing new server-side) ----

/** `update` on /api/social-posting. */
export function buildSaveRequest({ row, content, iso, scheduledTimeChanged }) {
  const body = { action: 'update', postId: row.id, content, expectedRevision: row.revision ?? null };
  if (scheduledTimeChanged && iso) body.scheduledAt = iso;
  return { endpoint: 'social', body };
}

/** `calendar-approve` on /api/dashboard/quote-targets: saves edited copy at the checked revision, then approves (no time). */
export function buildApproveRequest({ row, content }) {
  return { endpoint: 'content', action: 'calendar-approve', body: { postId: row.id, content, expectedRevision: row.revision ?? null } };
}

/** `approve-and-schedule` on /api/social-posting: what Approve does for a post with a publish time. */
export function buildApproveScheduleRequest({ row, content, iso, planOverride = null }) {
  const body = { action: 'approve-and-schedule', postId: row.id, content, scheduledAt: iso, expectedRevision: row.revision ?? null };
  if (planOverride) body.planOverride = planOverride;
  return { endpoint: 'social', body };
}

/** `calendar-suggestion-approve` (suggestion / requote rows: not saved posts yet). Same id derivation as calendar-row-model. */
export function buildSuggestionApproveRequest({ row, content }) {
  const requote = row.kind === 'requote';
  const raw = (requote ? row.quoteTargetId : row.suggestionId) ?? String(row.id || '').replace(/^(suggestion|requote):/, '');
  return { endpoint: 'content', action: 'calendar-suggestion-approve', body: { kind: requote ? 'requote' : 'suggestion', id: raw, date: row.date || null, text: content } };
}

export const buildUnapproveRequest = (row) => ({ endpoint: 'content', action: 'calendar-unapprove', body: { postId: row.id, expectedRevision: row.revision ?? null } });
export const buildRejectRequest = (row) => ({ endpoint: 'social', body: { action: 'reject-draft', postId: row.id, expectedRevision: row.revision ?? null } });
/** Unschedule = update with an empty scheduledAt (what PostSheet does). */
export const buildUnscheduleRequest = (row) => ({ endpoint: 'social', body: { action: 'update', postId: row.id, content: row.content, scheduledAt: '', expectedRevision: row.revision ?? null } });
export const buildReconcileRequest = ({ row, outcome, platformId }) => ({ endpoint: 'social', body: { action: 'reconcile-post', postId: row.id, outcome, platformId: outcome === 'posted' ? (String(platformId || '').trim() || null) : null } });

// ---- Pass / Replace / Delete (one calendar-item-decide call for posts, suggestions and requotes) ----

const NOT_REMOVABLE_STATUSES = new Set(['posted', 'posting']);
export const DECISION_LABEL = { pass: 'Pass', replace: 'Replace', delete: 'Delete' };
export const DELETE_CONFIRM_TEXT = "Delete for good? This content won't be suggested again.";

/** Which decisions are enabled for this row. Posted / posting -> none; suggestions and requotes cannot be replaced. */
export function decideItems(row, { busy = false } = {}) {
  const off = { pass: false, replace: false, delete: false };
  if (!row) return off;
  const gone = NOT_REMOVABLE_STATUSES.has(row.status) || row.state === 'posted' || row.approval === 'posted';
  if (busy || gone) return off;
  const suggestion = isSuggestion(row);
  return { pass: true, replace: !suggestion, delete: true };
}

/** `calendar-item-decide` on /api/dashboard/quote-targets. Same id derivation as buildSuggestionApproveRequest. */
export function buildDecideRequest(row, decision) {
  let item;
  if (row?.kind === 'requote') {
    const targetId = row.quoteTargetId ?? String(row.id || '').replace(/^requote:/, '');
    item = { kind: 'requote', targetId, url: row.quotedUrl || row.url || null, date: row.date || null };
  } else if (isSuggestion(row)) {
    const suggestionId = row.suggestionId ?? String(row.id || '').replace(/^suggestion:/, '');
    item = { kind: 'suggestion', suggestionId, runId: row.runId ?? row.provenance?.runId ?? null, date: row.date || null };
  } else {
    item = { kind: 'post', postId: row?.id, expectedRevision: row?.revision ?? null };
  }
  return { endpoint: 'content', action: 'calendar-item-decide', body: { decision, item } };
}

/** Operator-facing line for a decide response. */
export function decideResultText(decision, result) {
  if (decision === 'pass') return 'Passed.';
  if (decision === 'delete') return 'Deleted.';
  const r = result?.replacement;
  if (!r || result?.note === 'no-eligible-item') return 'Passed. Nothing else fits this day.';
  const label = r.row?.title || r.row?.text || r.row?.content;
  return label ? `Replaced with ${String(label).slice(0, 60)}.` : 'Replaced.';
}

/** Id of the replacement row to focus on the calendar, or null. */
export const replacementRowId = (result) => {
  const r = result?.replacement;
  if (!r) return null;
  return r.postId || r.row?.id || (r.targetId ? `requote:${r.targetId}` : null);
};

// ---- More menu ----

/** Which More items exist for this row, and whether each is enabled. Labels per spec: Reject, Unschedule, Reconcile, Use high-res, Leave unapproved. */
export function moreItems(row, { busy = false, hasCall = true } = {}) {
  if (!row || isSuggestion(row)) return [];
  const held = row.state === 'held' || row.status === 'needs_review';
  const reviewable = ['draft', 'awaiting_approval', 'approved', 'needs_review'].includes(row.status) || ['pending', 'awaiting', 'approved', 'held'].includes(row.state);
  const base = busy || !hasCall;
  return [
    { id: 'reject', label: 'Reject', enabled: !base && (reviewable || held) },
    { id: 'unschedule', label: 'Unschedule', enabled: !base && isScheduledStatus(row) },
    { id: 'reconcile', label: 'Reconcile', enabled: !base && held },
    { id: 'hires', label: 'Use high-res', enabled: !base && String(row.packageId || '').startsWith('nas-') && ['draft', 'approved', 'awaiting_approval', 'scheduled'].includes(row.status) },
    { id: 'unapprove', label: 'Leave unapproved', enabled: !base && isApprovedStatus(row) },
  ];
}

// ---- results / errors ----

/** Normalise a thrown error from either call helper into { kind, message }. kind: conflict | forbidden | plan | error. */
export function classifyError(err) {
  const code = String(err?.code || err?.data?.code || '');
  const status = Number(err?.status || err?.data?.status || 0);
  const message = err?.message || 'Something went wrong.';
  if (code === 'revision-conflict' || (status === 409 && /changed|revision/i.test(message))) return { kind: 'conflict', message: CONFLICT_MESSAGE };
  if (status === 403 || code.startsWith('pilot-')) return { kind: 'forbidden', message: OWNER_ONLY_MESSAGE };
  if (code.startsWith('plan-')) return { kind: 'plan', code, message };
  return { kind: 'error', code, message };
}

/** Did a write take an approved/scheduled post back to draft (media/copy/self-reply change)? */
export function approvalVoided(before, after) {
  const was = isApprovedStatus(before) || isScheduledStatus(before);
  return was && !!after && (after.status === 'draft' || after.approval === 'unapproved') && !isApprovedStatus(after) && !isScheduledStatus(after);
}

/** Did the creative differ between two versions of a row? */
export const mediaChanged = (before, after) => (before?.mediaUrl ?? null) !== (after?.mediaUrl ?? null)
  || JSON.stringify(before?.mediaVariants ?? null) !== JSON.stringify(after?.mediaVariants ?? null);

/**
 * Merge a server response into the row the editor holds. `update`/`approve-and-schedule` return a raw social post;
 * calendar-approve returns { post, row }. Raw-post fields (selfReply, mediaVariants, replyTo) win, so bound fields become known.
 */
export function mergeServerPost(row, res) {
  const post = res?.post || null;
  const calRow = res?.row || null;
  const next = { ...row, ...(calRow || {}) };
  if (post) {
    for (const k of ['selfReply', 'mediaVariants', 'replyTo']) if (hasOwn(post, k)) next[k] = post[k];
    for (const k of ['status', 'revision', 'scheduledAt', 'content', 'mediaUrl', 'mediaType', 'posterUrl', 'reviewedAt', 'error', 'errorClass', 'videoBrief', 'videoBriefMeta']) if (hasOwn(post, k)) next[k] = post[k];
    if (!calRow && post.status) {
      next.state = ({ draft: 'pending', awaiting_approval: 'awaiting', needs_review: 'held', approved: 'approved', scheduled: 'scheduled', queued: 'scheduled', posted: 'posted', failed: 'failed' })[post.status] || next.state;
      next.approval = ({ pending: 'unapproved', awaiting: 'unapproved', held: 'held', approved: 'approved', scheduled: 'scheduled', posted: 'posted', failed: 'held' })[next.state] || next.approval;
    }
  }
  return next;
}

// ── Creative Brief errors in plain English (VideoBriefPanel) ─────────────────────────────────────────────────────
const BRIEF_ERR = {
  'daily-cap': 'Render-now limit reached for today (5). The brief stays approved; the scheduled run picks it up.',
  hold: 'The template contains HOLD, so it will not render.',
  'has-media': 'This post already has creative that was not made from a brief. Remove it to render a new video.',
  'video-disabled': 'Video rendering is switched off.',
  'howto-disabled': 'How-to video rendering is switched off.',
  'not-draft': 'Only drafts render and can be revised.',
  'author-cap': 'The daily limit for turning briefs into video requests was reached. Try again tomorrow.',
  'author-model-error': 'The video request could not be written just now. Try again in a minute.',
  'author-no-output': 'The video request came back empty. Try again.',
  'no-authored-request': 'Approve the brief first, so the video request is written. Then you can send feedback.',
  'revision-conflict': 'This post changed somewhere else. Reload it and try again.',
  'brief-changed': 'The brief changed while the video request was being written. Try again.',
  'request-missing': 'The video request for this draft could not be found.',
  'version-not-found': 'That version no longer exists.',
  'feedback-empty': 'Write what should change first.',
  'feedback-too-long': 'Feedback is limited to 2000 characters.',
  'invalid-brief:howto-prose-needs-request': 'This reads like a how-to written as prose. Approve it as a Creative Brief so the video request is written for you, or set a howto id.',
  'invalid-brief:after-campaign': 'The campaign window has ended for this post\'s date, so no video will render.',
};
const BRIEF_PREFIX_RE = /^(?:Creative Brief could not be turned into a video|The video could not be revised):\s*/;

/** One reason code from the server -> a sentence. Unknown codes are shown as is. */
export function friendlyBriefReason(code) {
  const c = String(code ?? '').trim();
  if (BRIEF_ERR[c]) return BRIEF_ERR[c];
  let m = /^unsupported:([^:]*):(.*)$/.exec(c);
  if (m) return `The video library cannot do this yet (${m[1].trim() || 'a shot'}: ${m[2].trim() || 'not available'}). Change that shot in the brief.`;
  m = /^art-missing:(.+)$/.exec(c);
  if (m) return `The artwork ${m[1]} is not in the video library. Use the standard end card or another art path.`;
  m = /^unknown-(panel|action|preset|host):(?:(\d+):)?(.+)$/.exec(c);
  if (m) return `${m[2] ? `Step ${m[2]}` : 'The brief'} uses ${m[1] === 'action' ? 'an' : 'a'} ${m[1] === 'panel' ? 'game scene' : m[1]} the video library does not have (${m[3]}). Pick one from the template's list.`;
  if (/^invalid-brief:/.test(c)) return `This brief cannot render (${c.slice('invalid-brief:'.length)}). Fix the Video brief line or the Creative Brief.`;
  return c;
}

/** A server message or reason list -> one readable string (the route's "...: a; b" error text is split back into reasons). */
export function friendlyBriefReasons(input) {
  if (!Array.isArray(input) && !BRIEF_PREFIX_RE.test(String(input ?? ''))) return friendlyBriefReason(input);
  const list = Array.isArray(input) ? input : String(input).replace(BRIEF_PREFIX_RE, '').split(/;\s*/);
  return list.map(friendlyBriefReason).filter(Boolean).join(' ');
}
