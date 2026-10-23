// cross-post.js — which networks a scheduled post goes to, and the Instagram
// leg of delivery.
//
// One social_posts row carries `targets: { x, instagram }`. The X leg is the
// row's existing lifecycle (claim → publish → posted/failed), unchanged. The
// Instagram leg is a follow-on recorded on the same row as
// `instagramDelivery`, the same pattern as the X self-reply: it runs after the
// X leg and never turns a published X post into a failure.
//   - targets absent        -> X only (every row created before this existed)
//   - targets.x === false   -> Instagram is the row's ONLY leg; its outcome is
//                              the row's outcome (posted / failed / needs_review)
// Instagram publishing additionally requires platforms.js instagram.crossPost
// (or live), a connected account for the client (social_accounts), and media
// (Instagram has no text-only posts).

import { getPlatformDef } from './platforms.js';

export const DEFAULT_TARGETS = Object.freeze({ x: true, instagram: false });

/** Effective targets for a stored row (legacy rows = X only). */
export function postTargets(post) {
  const t = post?.targets;
  if (!t || typeof t !== 'object') return { ...DEFAULT_TARGETS };
  return { x: t.x !== false, instagram: t.instagram === true };
}

/** Parse a client-supplied targets object. Throws 400 on an empty selection. */
export function normalizeTargets(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('targets must be an object like { x: true, instagram: false }.'), { status: 400 });
  const out = { x: input.x === true, instagram: input.instagram === true };
  if (!out.x && !out.instagram) throw Object.assign(new Error('Pick at least one network (X or Instagram).'), { status: 400, code: 'no-targets' });
  return out;
}

/** Why Instagram cannot be a target for this row right now ('' = it can). Pure. */
export function instagramCrossPostEnabled() {
  const def = getPlatformDef('instagram');
  return def?.live === true || def?.crossPost === true;
}

export function instagramBlockReason(post, account, { live = instagramCrossPostEnabled() } = {}) {
  if (!live) return 'Instagram publishing is not live yet.';
  if (!account?.accessToken || !account?.userId) return 'Connect this client\'s Instagram account first (Social Accounts card).';
  if (account.expiresAt && account.expiresAt <= Date.now()) return 'This client\'s Instagram token expired. Reconnect it in the Social Accounts card.';
  if (!post?.mediaUrl) return 'Instagram needs an image or video. This post is text only.';
  if (post.kind === 'repost') return 'A repost cannot go to Instagram.';
  return '';
}

/** Adapter payload for the Instagram leg. Videos post as Reels, images as image posts. */
export function instagramPayloadFor(post, media) {
  const m = media || {};
  const type = String(m.mediaType || post?.mediaType || '').toLowerCase();
  const contentType = String(m.mediaContentType || post?.mediaContentType || '').toLowerCase();
  const isVideo = type === 'video' || type === 'gif' || contentType.startsWith('video/');
  return { mediaType: isVideo ? 'reel' : 'image', mediaUrl: m.mediaUrl || post?.mediaUrl || null, caption: String(post?.content || '') };
}

/**
 * Run the Instagram leg. Never throws: returns the delivery record to store.
 * deps: { getAccount(clientId), publish(payload, opts), media, now }
 *   status 'posted'       -> { mediaId, containerId, at }
 *   status 'skipped'      -> already posted earlier (idempotent re-run)
 *   status 'blocked'      -> preconditions failed; nothing was sent
 *   status 'failed'       -> Instagram rejected it before publishing; nothing is live
 *   status 'needs_review' -> publish outcome unknown; check the account before retrying
 */
export async function deliverInstagram(post, { getAccount, publish, media = null, now = () => new Date().toISOString(), live } = {}) {
  const prior = post?.instagramDelivery;
  if (prior?.status === 'posted' && prior.mediaId) return { ...prior, status: 'posted' };
  let account = null;
  try {
    account = await getAccount(post.clientId);
  } catch (err) {
    return { status: 'failed', error: `Could not read the Instagram account: ${err.message || err}`, at: now() };
  }
  const blocked = instagramBlockReason(post, account, live === undefined ? undefined : { live });
  if (blocked) return { status: 'blocked', error: blocked, at: now() };
  try {
    // allowNotLive: the crossPost switch (checked in instagramBlockReason) is this path's gate, not `live`.
    const out = await publish(instagramPayloadFor(post, media), { accessToken: account.accessToken, igUserId: account.userId, allowNotLive: true });
    return { status: 'posted', mediaId: out.instagramMediaId, containerId: out.containerId || null, username: account.username || null, at: now(), error: null };
  } catch (err) {
    return {
      status: err?.ambiguous ? 'needs_review' : 'failed',
      error: err?.ambiguous
        ? `Instagram publish outcome unknown (${err.message || 'no detail'}). Check @${account.username || 'the account'} before retrying.`
        : (err?.message || 'Instagram publish failed.'),
      errorCode: err?.code || null,
      at: now(),
    };
  }
}
