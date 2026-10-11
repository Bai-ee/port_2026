// Pure post-handoff presentation: status labels, action sets, exact-copy + metadata bundle, and the timezone
// helpers (Intl-based, DST-safe) shared by bot.js and scheduler.js. No I/O.

export const MAX_POST_CHARS = 280;
export const TERMINAL_STATUSES = new Set(['posted', 'rejected', 'posting']);
const UNAPPROVED = new Set(['draft', 'awaiting_approval']);
const APPROVED_SCHEDULED = new Set(['approved', 'scheduled', 'queued']);
const RETRYABLE = new Set(['failed', 'expired']);
const AMBIGUOUS = new Set(['server-error-ambiguous', 'network-ambiguous', 'unknown']);
const isV2 = (post) => Number(post?.lifecycleVersion) >= 2;

export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const toMs = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toMillis === 'function') return v.toMillis();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

// ── Timezone helpers ─────────────────────────────────────────────────────────
const fmtCache = new Map();
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

/** Local wall-clock parts of an instant in `tz`. */
export function localParts(ms, tz) {
  const o = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  const pad = (n) => String(n).padStart(2, '0');
  return { year: o.year, month: o.month, day: o.day, hour: o.hour % 24, minute: o.minute, dateKey: `${o.year}-${pad(o.month)}-${pad(o.day)}` };
}

export function tzOffsetMs(ms, tz) {
  const p = partsFormatter(tz).formatToParts(new Date(ms)).reduce((a, x) => (x.type === 'literal' ? a : { ...a, [x.type]: Number(x.value) }), {});
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Local wall time -> epoch ms. Returns null for a time that does not exist (spring-forward gap). */
export function localToMs({ year, month, day, hour, minute }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess - tzOffsetMs(guess, tz);
  ms = guess - tzOffsetMs(ms, tz); // second pass lands on the right side of a DST change
  const back = localParts(ms, tz);
  if (back.year !== year || back.month !== month || back.day !== day || back.hour !== hour || back.minute !== minute) return null;
  return ms;
}

export function addLocalDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** "Tue Oct 14, 3:30 PM CDT" */
export function localTime(v, tz) {
  const ms = toMs(v);
  if (ms == null) return 'no time set';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    .format(new Date(ms));
}

/** Same wall-clock time tomorrow in `tz` (DST-safe). */
export function tomorrowSameTime(ms, tz) {
  const p = localParts(ms, tz);
  return localToMs({ ...addLocalDays(p.dateKey, 1), hour: p.hour, minute: p.minute }, tz);
}

/**
 * Parse "HH:MM" (today) or "YYYY-MM-DD HH:MM" in the settings timezone.
 * @returns {{ok:true, ms:number, iso:string}|{ok:false, error:string}}
 */
export function parseLocalTime(text, tz, nowMs) {
  const s = String(text || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})$/);
  let spec;
  if (m) spec = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] };
  else if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) {
    const t = localParts(nowMs, tz);
    spec = { year: t.year, month: t.month, day: t.day, hour: +m[1], minute: +m[2] };
  } else return { ok: false, error: 'Send a time like 15:30 (today) or 2026-10-14 15:30.' };
  if (spec.hour > 23 || spec.minute > 59 || spec.month < 1 || spec.month > 12 || spec.day < 1 || spec.day > 31) return { ok: false, error: 'That is not a valid date or time.' };
  const ms = localToMs(spec, tz);
  if (ms == null) return { ok: false, error: 'That local time does not exist (clock change). Pick another time.' };
  if (ms <= nowMs) return { ok: false, error: `That time has already passed (${tz}). Send a future time.` };
  return { ok: true, ms, iso: new Date(ms).toISOString() };
}

export function inQuietHours(ms, tz, quiet) {
  if (!quiet?.enabled || quiet.start === quiet.end) return false;
  const h = localParts(ms, tz).hour;
  return quiet.start > quiet.end ? (h >= quiet.start || h < quiet.end) : (h >= quiet.start && h < quiet.end);
}

/** First instant at/after `ms` when quiet hours end. */
export function quietHoursEnd(ms, tz, quiet) {
  if (!inQuietHours(ms, tz, quiet)) return ms;
  const p = localParts(ms, tz);
  for (let i = 0; i < 3; i += 1) {
    const cand = localToMs({ ...addLocalDays(p.dateKey, i), hour: quiet.end, minute: 0 }, tz);
    if (cand != null && cand > ms) return cand;
  }
  return ms + 3600000;
}

// ── Labels & actions ─────────────────────────────────────────────────────────
export function statusLabel(post) {
  const s = post?.status;
  if (s === 'manual') return 'Posting manually';
  if (s === 'posted') return post.deliveryMode === 'manual' ? 'Posted (you reported)' : post.twitterId ? 'Posted (verified)' : 'Posted';
  return ({
    draft: 'Draft (not approved)', awaiting_approval: 'Awaiting your approval', approved: 'Approved', scheduled: 'Scheduled (approved)',
    queued: 'Queued to post', posting: 'Posting now', failed: 'Failed', needs_review: 'Needs review in HITLOOP', expired: 'Approval expired', rejected: 'Skipped',
  })[s] || String(s || 'unknown');
}

const isReply = (post) => !!(post?.replyTo && (post.replyTo.url || post.replyTo.author));

function actionIds(post) {
  const s = post?.status;
  if (isReply(post)) {
    if (s === 'manual') return ['posted-it', 'send-assets', 'release'];
    if (UNAPPROVED.has(s) || APPROVED_SCHEDULED.has(s) || RETRYABLE.has(s)) return ['post-myself', 'posted-it'];
    return [];
  }
  // Only buttons the shared services can actually apply for this status (a refused button would loop).
  if (s === 'manual') return ['posted-it', 'send-assets', 'release'];
  if (s === 'draft') return ['post-myself', 'revise', 'approve-schedule', 'approve-post-now', 'reschedule', 'skip'];
  // Approval-mode rows (email approval link) are approved through that flow; Telegram only offers the takeover.
  if (s === 'awaiting_approval') return ['post-myself'];
  if (APPROVED_SCHEDULED.has(s)) {
    // Legacy (pre-v2) scheduled rows keep their schedule on edit, so revising here would auto-post unreviewed copy.
    const legacyLive = !isV2(post) && s !== 'approved';
    return legacyLive ? ['post-myself', 'reschedule'] : ['post-myself', 'reschedule', 'revise'];
  }
  // A failed/expired post can only be posted by hand from here; an ambiguous failure may already be live on X.
  if (RETRYABLE.has(s)) return AMBIGUOUS.has(post.errorClass) ? [] : ['post-myself'];
  return []; // posted / rejected / posting / needs_review (reconcile in HITLOOP)
}

export function mediaOf(post) {
  if (!post?.mediaUrl) return null;
  const ct = String(post.mediaContentType || '');
  const video = post.mediaType === 'video' || ct.startsWith('video/');
  return { type: video ? 'video' : 'photo', url: post.mediaUrl };
}

/**
 * @param {{post:object, handle?:string, tz:string, now:number, mode?:'handoff'|'reminder'|'missed'|'failure'|'card', targetAt?:number|string, headline?:string}} a
 */
export function buildHandoffBundle({ post, handle, tz, now, mode = 'card', targetAt, headline }) {
  const t = toMs(targetAt) ?? toMs(post.scheduledAt) ?? toMs(post.proposedAt);
  const when = localTime(t, tz);
  const future = t != null && t > (toMs(now) ?? Date.now());
  const ids = actionIds(post).filter((id) => id !== 'approve-schedule' || future);
  const approvable = UNAPPROVED.has(post.status);
  const labels = {
    'post-myself': APPROVED_SCHEDULED.has(post.status) ? 'Post myself (take over)' : 'Post myself',
    revise: 'Revise copy', 'approve-schedule': `Approve & schedule ${when}`, 'approve-post-now': 'Approve & post now',
    // Scheduling an unapproved draft approves it, so the label says so.
    reschedule: post.status === 'draft' ? 'Approve & pick time' : 'Reschedule', skip: 'Skip', 'posted-it': "I've posted it", 'send-assets': 'Send assets', release: 'Release to HITLOOP',
  };
  const actions = ids.map((action) => ({
    action, label: labels[action],
    ...(action === 'approve-schedule' ? { params: { scheduledAt: new Date(t).toISOString() } } : {}),
  }));
  const head = headline || ({
    handoff: approvable ? 'Post needs your attention' : 'Post coming up', reminder: 'Reminder: scheduled post', missed: 'Missed: not sent',
    failure: 'Needs attention', card: 'Post',
  })[mode] || 'Post';
  const why = post.xStrategy?.reason || post.xStrategy?.why || post.why || post.engine || post.source || null;
  const lines = [
    `<b>${escapeHtml(head)}</b>`,
    `Account: ${handle ? `@${escapeHtml(String(handle).replace(/^@/, ''))}` : 'X'}`,
    `${mode === 'missed' ? 'Was due' : 'When'}: ${escapeHtml(when)} (${escapeHtml(tz)})`,
    `Status: ${escapeHtml(statusLabel(post))}`,
  ];
  if (mode === 'missed') lines.push('This was NOT sent. Reschedule it or take it over.');
  if (mode === 'reminder') lines.push('Already approved. HITLOOP will publish it; no action needed.');
  if (mode === 'failure' && post.error) lines.push(`Reason: ${escapeHtml(String(post.error).slice(0, 300))}`);
  if (why) lines.push(`Why: ${escapeHtml(String(why).slice(0, 160))}`);
  if (isReply(post) && post.replyTo.url) lines.push(`Reply target: ${escapeHtml(post.replyTo.url)}`);
  if (isReply(post)) lines.push('Replies are posted by you; HITLOOP does not auto-post them.');
  lines.push(`Revision ${post.revision ?? 0}`);
  lines.push(`<blockquote>${escapeHtml(post.content)}</blockquote>`);
  return {
    media: mediaOf(post), copyText: String(post.content ?? ''), metaHtml: lines.join('\n'), actions,
    targetAt: t != null ? new Date(t).toISOString() : null,
    replyTarget: isReply(post) ? post.replyTo.url || null : null,
  };
}
