// creative-brief-media.js — send a Creative Brief's storyboard frames (one album) or its attached video to the owner's Telegram.
//
// OWNER RULE (2026-11-21): CQ storyboard images and videos go to Telegram. Target: the post's own client binding; else, for a
// verified admin requester only, that admin's own binding (admins already see every client). Never any other binding.
// Delivery is one outbox item per part ('frames' | 'video'), each ONE Telegram call (sendMediaGroup / sendVideo), so a retry
// never resends half a delivery. The payload holds ids + the expected storyboard/video version, never URLs: the post is
// re-read at send time and the media URLs come from it. The route sends immediately after winning the item's claim; the
// dispatch cron retries what is left queued.

import { TERMINAL_STATUSES } from './handoff.js';

export const CBM_KIND = 'creative-brief-media';
export const FRAMES_MAX = 10;
const CAPTION_MAX = 1024;
const VIDEO_TIMEOUT_MS = 60_000;
const ALBUM_TIMEOUT_MS = 45_000;

const str = (v) => (v == null ? '' : String(v));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Which chat gets it: { binding, fallback } or null. requesterIsAdmin must come from verified auth. */
export async function resolveCreativeBriefTarget({ store, db, clientId, requesterUid = null, requesterIsAdmin = false }) {
  const own = await store.getActiveBindingForClient(db, clientId);
  if (own) return { binding: own, fallback: false };
  if (!requesterIsAdmin || !requesterUid) return null;
  const mine = (await store.listActiveBindings(db)).find((b) => str(b.uid) === str(requesterUid));
  return mine ? { binding: mine, fallback: true } : null;
}

/** The version a part was asked for: a later change supersedes the item instead of sending something else. */
export function expectOf(post, part) {
  if (part === 'frames') return { storyboardUpdatedAt: post?.videoBriefMeta?.storyboard?.updatedAt || null };
  return { outlineHash: post?.mediaMetadata?.outlineHash || null, storagePath: post?.mediaStoragePath || null };
}

export const dedupKeyOf = (post, part) => (part === 'frames'
  ? `cbm:frames:${post.id}:${expectOf(post, 'frames').storyboardUpdatedAt}`
  : `cbm:video:${post.id}:${expectOf(post, 'video').outlineHash}:${expectOf(post, 'video').storagePath}`);

/** Pure: may this part still be sent for this post, and what exactly. { ok, reason?, plan? } */
export function planCreativeBriefMedia(post, payload) {
  if (!post) return { ok: false, reason: 'post-gone' };
  if (TERMINAL_STATUSES.has(post.status)) return { ok: false, reason: `post-${post.status}` };
  const title = str(post.videoBriefMeta?.v2?.title).trim() || 'Creative Brief';
  const day = str(post.reviewOn).trim();
  const head = `${title}${day ? ` · ${day}` : ''}`;
  const want = payload?.expect || {};
  if (payload?.part === 'frames') {
    const sb = post.videoBriefMeta?.storyboard;
    if (!sb || str(sb.updatedAt) !== str(want.storyboardUpdatedAt)) return { ok: false, reason: 'storyboard-changed' };
    const frames = (Array.isArray(sb.frames) ? sb.frames : []).filter((f) => /^https:\/\//i.test(str(f?.url))).slice(0, FRAMES_MAX);
    if (!frames.length) return { ok: false, reason: 'no-frames' };
    const items = frames.map((f, i) => {
      const line = `Frame ${i + 1} · ${str(f.label)}${f.note ? ` — ${str(f.note)}` : ''}`;
      const caption = i === 0 ? `Storyboard: ${head} (${sb.status || 'ready'})\n${line}` : line;
      return { type: 'photo', media: str(f.url), caption: clip(caption, CAPTION_MAX) };
    });
    return { ok: true, plan: { part: 'frames', items } };
  }
  if (payload?.part === 'video') {
    const { outlineHash, storagePath } = expectOf(post, 'video');
    if (!post.mediaUrl || post.mediaType !== 'video' || outlineHash !== want.outlineHash || storagePath !== want.storagePath) return { ok: false, reason: 'video-changed' };
    return { ok: true, plan: { part: 'video', url: post.mediaUrl, caption: clip(`Video: ${head}\nDownload: ${post.mediaUrl}`, CAPTION_MAX) } };
  }
  return { ok: false, reason: 'unknown-part' };
}

/** One Telegram call per part. A video Telegram cannot fetch (bad-request: too big / unreachable) becomes a link message;
 *  timeouts / network / rate limits are rethrown (ambiguous or retryable: a fallback there would double-deliver). */
export async function deliverCreativeBriefMedia(transport, chatId, plan) {
  if (plan.part === 'frames') {
    if (plan.items.length === 1) {
      const m = await transport.sendPhoto(chatId, plan.items[0].media, { caption: plan.items[0].caption, timeout: ALBUM_TIMEOUT_MS });
      return [m?.message_id].filter(Boolean);
    }
    const res = await transport.sendMediaGroup(chatId, plan.items, { timeout: ALBUM_TIMEOUT_MS });
    return (Array.isArray(res) ? res : []).map((m) => m?.message_id).filter(Boolean);
  }
  try {
    const m = await transport.sendVideo(chatId, plan.url, { caption: plan.caption, timeout: VIDEO_TIMEOUT_MS });
    return [m?.message_id].filter(Boolean);
  } catch (err) {
    if (err?.code !== 'bad-request') throw err;
    const m = await transport.sendMessage(chatId, plan.caption, { disablePreview: false });
    return [m?.message_id].filter(Boolean);
  }
}

/** Drain-side re-checks for an item of this kind (binding re-read by the caller). Returns a supersede reason or null. */
export function cbmBindingProblem(item, binding) {
  const p = item.payload || {};
  if (binding.bindingVersion !== p.bindingVersion) return 'binding-changed';
  if (p.postClientId !== item.clientId && str(binding.uid) !== str(p.requestedByUid)) return 'binding-changed';
  return null;
}

/**
 * Queue one part and send it now. deps: { db, store, transport, readPost(clientId, postId), now }.
 * Returns { status: 'sent'|'queued'|'already-sent'|'no-chat'|'paused'|'skipped', reason?, fallback? }. Never throws for a
 * Telegram failure: the item stays queued and the dispatch cron retries it.
 */
export async function sendCreativeBriefPart(deps, { clientId, post, part, requesterUid, requesterIsAdmin, honorPause = false }) {
  const { db, store, transport } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const target = await resolveCreativeBriefTarget({ store, db, clientId, requesterUid, requesterIsAdmin });
  if (!target) return { status: 'no-chat', reason: 'No Telegram chat is linked for this client or for you.' };
  const { binding } = target;
  const payload = { kind: CBM_KIND, part, postClientId: clientId, postId: post.id, requestedByUid: requesterUid || null, bindingVersion: binding.bindingVersion, honorPause, expect: expectOf(post, part) };
  const first = planCreativeBriefMedia(post, payload);
  if (!first.ok) return { status: 'skipped', reason: first.reason };
  if (honorPause) {
    const settings = await store.getSettings(db, binding.clientId);
    if (settings?.notificationsPaused) return { status: 'paused', reason: 'Telegram notifications are paused.' };
  }
  const { duplicate, id } = await store.enqueueMessage(db, { clientId: binding.clientId, chatId: binding.chatId, dedupKey: dedupKeyOf(post, part), kind: CBM_KIND, payload, now });
  if (duplicate) return { status: 'already-sent', fallback: target.fallback };
  const claimed = await store.claimOutboxItem(db, id, { workerId: 'creative-brief-media', now });
  if (!claimed) return { status: 'queued', fallback: target.fallback }; // the cron got it first: it sends it
  try {
    const fresh = await deps.readPost(clientId, post.id);
    const plan = planCreativeBriefMedia(fresh, payload);
    if (!plan.ok) { await store.supersedeOutbox(db, id, { reason: plan.reason, now }); return { status: 'skipped', reason: plan.reason }; }
    const messageIds = await deliverCreativeBriefMedia(transport, binding.chatId, plan.plan);
    await store.completeOutbox(db, id, { messageIds, now });
    return { status: 'sent', fallback: target.fallback };
  } catch (error) {
    if (error?.code === 'forbidden' || error?.code === 'bad-request') { await store.failOutbox(db, id, { error, now }); return { status: 'skipped', reason: String(error?.description || error?.message || 'Telegram refused it.').slice(0, 200) }; }
    await store.retryOutbox(db, id, { retryAfterSec: error?.retryAfter, error, now });
    return { status: 'queued', reason: 'Telegram did not answer in time; it will retry.', fallback: target.fallback };
  }
}
