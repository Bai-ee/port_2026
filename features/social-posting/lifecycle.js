// Pure lifecycle rules for `social_posts`. No I/O: twitter-service.js feeds these the rows/packages it already reads.
//
// Compatibility: rows without `lifecycleVersion` behave exactly as before at publish time. Rows created through
// the shared producers set `lifecycleVersion: 2` and get the stricter rules (approval invalidation on any
// material edit, clearance/reply/expiry recheck at delivery). Schedule-time guards (reply, clearance,
// package collision) apply to every row because they only refuse a NEW scheduling action.

import { createHash } from 'node:crypto';

export const LIFECYCLE_VERSION = 2;

/** Statuses in which a row still represents live intent to post (or an unresolved delivery). */
export const OPEN_STATUSES = Object.freeze(['draft', 'approved', 'awaiting_approval', 'scheduled', 'queued', 'posting', 'needs_review', 'manual']);
/** Statuses that occupy the queue: another copy of the same package must not be scheduled alongside. */
// needs_review is excluded: it is parked (never claimable), so it must not wedge the package forever.
// manual = the owner took delivery over (Telegram "Post myself"): never claimed by the sweeper, but it still holds
// its package and slot so the same material can't be scheduled again while the owner is posting it.
export const PENDING_STATUSES = Object.freeze(['awaiting_approval', 'scheduled', 'queued', 'posting', 'manual']);
/** Statuses from which the owner may take delivery over manually (atomic claim; the sweeper never claims `manual`). */
export const MANUAL_CLAIMABLE_STATUSES = Object.freeze(['draft', 'approved', 'awaiting_approval', 'scheduled', 'queued', 'expired', 'failed']);

export const RETRY_MAX_ATTEMPTS = 3;
/** Pending = queued for delivery, including a failed row that the next sweep will retry (429 / pre-send network). */
export const isPendingRow = (r) => Boolean(r) && (PENDING_STATUSES.includes(r.status)
  || (r.status === 'failed' && r.retryable === true && (Number(r.attempts) || 0) < RETRY_MAX_ATTEMPTS));

export const isV2 = (post) => Number(post?.lifecycleVersion) >= LIFECYCLE_VERSION;

/**
 * Package clearance = "can this material be used at all?". Distinct from post approval ("may this exact copy go out?").
 * A missing package is allowed (matches today's behaviour); the caller fails closed when the lookup itself throws.
 */
export function packageClearance(pkg) {
  if (!pkg) return { ok: true };
  if (pkg.rights === 'never-public') return { ok: false, code: 'clearance-revoked', reason: 'Package rights are never-public.' };
  // Only explicit revocation blocks. `approval.state:'needed'` stays the post-approval gate's business
  // (assertSchedulable), so an already-approved post for such a package keeps working as before.
  if (pkg.approval?.state === 'rejected') return { ok: false, code: 'clearance-revoked', reason: 'Package approval was rejected.' };
  return { ok: true };
}

/** A reply row carries a target; threaded delivery is unsupported, so it must never go out as a standalone original. */
export function replyBlock(post) {
  const t = post?.replyTo;
  if (!t || typeof t !== 'object') return { ok: true };
  if (!(t.url || t.author || t.text)) return { ok: true };
  return { ok: false, code: 'reply-threading-unsupported', reason: 'This is a reply to another post; threaded replies are not supported yet, so it cannot be scheduled or published as a standalone post.' };
}

/** Another open copy of the same package (never the row itself) blocks scheduling a second one. */
export function findPackageCollision(rows, { packageId, selfId = null }) {
  if (!packageId) return null;
  return (rows || []).find((r) => r && r.id !== selfId && r.packageId === packageId && isPendingRow(r)) || null;
}

/** ISO string or epoch ms -> ms (NaN when unreadable). */
export const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v || ''));

/** Hash of exactly what would be published: approval binds to this. */
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));

export function contentHash(post) {
  return createHash('sha1').update(stable([
    post?.content ?? '', post?.selfReply ?? null, post?.mediaUrl ?? null, post?.mediaVariants ?? null, post?.replyTo ?? null,
  ])).digest('hex').slice(0, 16);
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Did an edit change what would be published? Text, first self-reply, media, or reply target. */
export function isMaterialEdit(before, after) {
  return before.content !== after.content
    || !sameJson(before.selfReply, after.selfReply)
    || before.mediaUrl !== after.mediaUrl
    || !sameJson(before.mediaVariants, after.mediaVariants)
    || !sameJson(before.replyTo, after.replyTo);
}

/** v2 rows only: statuses whose approval a material edit voids (awaiting_approval is exempt: the approver is editing that exact copy). */
export const APPROVAL_VOID_STATUSES = Object.freeze(['approved', 'scheduled', 'queued']);

/**
 * Delivery-time recheck for v2 rows. Returns null when the row may go out, else { code, reason } and the
 * caller parks the row as needs_review WITHOUT calling the platform.
 */
export function deliveryBlock(post, { pkg = null, now = Date.now() } = {}) {
  if (!isV2(post)) return null;
  const reply = replyBlock(post);
  if (!reply.ok) return reply;
  // Approval binds the exact copy/media/reply target: anything changed since approval must be re-approved.
  if (post.approvedHash && post.approvedHash !== contentHash(post)) {
    return { ok: false, code: 'approval-stale', reason: 'The post changed after it was approved; approve it again.' };
  }
  const clearance = packageClearance(pkg);
  if (!clearance.ok) return clearance;
  const expires = post.expiresAt || pkg?.expiresAt;
  if (expires && Number.isFinite(toMs(expires)) && toMs(expires) <= now) {
    return { ok: false, code: 'opportunity-expired', reason: `The window for this post closed at ${new Date(toMs(expires)).toISOString()}.` };
  }
  return null;
}
