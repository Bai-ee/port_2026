// fresh-creative.js — pick a FRESH creative for a post: never one any post already uses, never an old one.
//
// OWNER RULE (2026-11-16): when a post's creative is changed (or the daily video needs one), pull a fresh random
// creative from the bucket. Do not recycle old creative or creative that is on another post.
//
//   video renders (Video Remix captures, dashboard_state/{assetClient}.mediaCaptures type 'video_remix'):
//     today's newest unused render first; otherwise a random unused render from the last FRESH_DAYS days.
//   library items (x_content_packages with staged media):
//     a random unused item from the post's bucket, newest FRESH_DAYS days first, then any never-used item.
//
// "Used" = the media is on ANY social_posts row of the client (any status), or the item backs any post.
// Pure: callers pass the rows; nothing here reads or writes.

export const FRESH_DAYS = 21;
const DAY_MS = 86_400_000;

const ms = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
const pickRandom = (list, rand = Math.random) => (list.length ? list[Math.floor(rand() * list.length) % list.length] : null);

/** Media urls / storage refs / item ids already on a post of this client. */
export function usedCreative(posts) {
  const urls = new Set();
  const refs = new Set();
  const packageIds = new Set();
  for (const p of Array.isArray(posts) ? posts : []) {
    if (p?.mediaUrl) urls.add(p.mediaUrl);
    if (p?.mediaStoragePath) refs.add(p.mediaStoragePath);
    if (p?.packageId) packageIds.add(p.packageId);
  }
  return { urls, refs, packageIds };
}

/**
 * A fresh Video Remix render. captures: dashboard_state mediaCaptures. todayKey: 'YYYY-MM-DD' (UTC, digest day).
 * Returns { capture, reason: 'today' | 'random-recent' } or null when every recent render is already on a post.
 */
export function pickFreshRender(captures, used, { nowMs = Date.now(), todayKey = null, freshDays = FRESH_DAYS, rand = Math.random } = {}) {
  const since = nowMs - freshDays * DAY_MS;
  const usable = (Array.isArray(captures) ? captures : [])
    .filter((c) => c?.type === 'video_remix' && c.downloadUrl && !used?.urls?.has(c.downloadUrl) && ms(c.createdAt) >= since)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const today = todayKey ? usable.find((c) => String(c.createdAt || '').slice(0, 10) === todayKey) : null;
  if (today) return { capture: today, reason: 'today' };
  const capture = pickRandom(usable, rand);
  return capture ? { capture, reason: 'random-recent' } : null;
}

/**
 * A fresh library item for a post: same bucket when the post has one, with media (hasMedia(pkg)), not rejected or
 * never-public, never used by a post. Recent items (createdAt within freshDays) first. Returns the item or null.
 */
export function pickFreshItem(packages, used, { bucketId = null, excludeId = null, hasMedia, nowMs = Date.now(), freshDays = FRESH_DAYS, rand = Math.random } = {}) {
  const since = nowMs - freshDays * DAY_MS;
  const pool = (Array.isArray(packages) ? packages : []).filter((p) => p?.id
    && p.id !== excludeId
    && (!bucketId || p.bucketId === bucketId)
    && p.rights !== 'never-public'
    && p.status !== 'rejected'
    && !used?.packageIds?.has(p.id)
    && (typeof hasMedia === 'function' ? hasMedia(p) : true));
  const recent = pool.filter((p) => ms(p.createdAt) >= since);
  return pickRandom(recent.length ? recent : pool, rand);
}

/** The post patch for a render capture (same fields the daily digest writes). */
export function renderMediaPatch(capture, assetClientId) {
  return {
    mediaUrl: capture.downloadUrl,
    mediaType: 'video',
    mediaContentType: 'video/mp4',
    mediaJobId: capture.jobId || null,
    mediaAssetClientId: assetClientId || null,
    mediaMetadata: {
      ...(capture.createdWith || {}),
      sourceFolders: Array.isArray(capture.sourceFolders) ? capture.sourceFolders : [],
      duration: capture.durationSeconds || capture.createdWith?.duration || 30,
    },
  };
}

// A Video Remix render post: the daily video, a render-job post, or a rendered-video library item (rv-*).
export const isRenderPost = (post) => Boolean(post?.mediaJobId || String(post?.source || '').startsWith('daily-video:')
  || String(post?.packageId || '').startsWith('rv-')
  || (post?.mediaType === 'video' && post?.mediaMetadata && (post.mediaMetadata.artist || post.mediaMetadata.mix)));
// A record post's creative IS that record (its copy names it): another item's media would mislabel it.
const isRecordPost = (post) => String(post?.packageId || '').startsWith('discogs-') || post?.source === 'discogs-ingest';

/**
 * Change one post's creative to a fresh one (owner rule above). deps (all injected):
 *   getPost(postId) -> post|null, readPosts() -> client's posts (all statuses),
 *   readCaptures() -> { captures, assetClientId }      Video Remix renders this client publishes
 *   readPackages() -> library items, pickMediaRef(pkg) -> {ref,...}|null, pickMedia(pkg) -> media patch|null
 *   swapPostMedia(postId, patch) -> false | { approvalVoided }, rowOf(postId) -> row|null
 *   copyFor(createdWith) -> post text for a render (the client's mix format) | null
 * Render posts get a render; other posts get a library item from their bucket. Never throws for expected refusals.
 */
export async function changeToFreshCreative(deps, { postId, rand = Math.random, nowMs = Date.now() } = {}) {
  const fail = (status, error, code) => ({ ok: false, status, error, code });
  const post = postId ? await deps.getPost(postId) : null;
  if (!post) return fail(404, `No post ${postId || ''}.`.trim(), 'not-found');
  const used = usedCreative(await deps.readPosts());
  let patch;
  let picked;
  if (isRenderPost(post)) {
    const { captures, assetClientId } = (await deps.readCaptures()) || {};
    const hit = pickFreshRender(captures, used, { nowMs, rand });
    if (!hit) return fail(409, 'No fresh video: every render from the last 3 weeks is already on a post. Render a new one first.', 'no-fresh-render');
    patch = renderMediaPatch(hit.capture, assetClientId);
    const text = deps.copyFor ? deps.copyFor(hit.capture.createdWith || {}) : null;
    if (text && text !== 'Video Remix') patch.content = text;
    picked = { kind: 'render', createdAt: hit.capture.createdAt || null, jobId: hit.capture.jobId || null };
  } else if (isRecordPost(post)) {
    return fail(409, 'A record post shows its own record. Re-shoot or re-stage that record to change its video.', 'record-post');
  } else {
    const pkgs = (await deps.readPackages()) || [];
    const bucketId = post.bucketId || pkgs.find((p) => p.id === post.packageId)?.bucketId || null;
    const hasMedia = (p) => { const m = deps.pickMediaRef(p); return Boolean(m && !used.refs.has(m.ref)); };
    const item = pickFreshItem(pkgs, used, { bucketId, excludeId: post.packageId, hasMedia, nowMs, rand });
    if (!item) return fail(409, `No fresh creative left${bucketId ? ' in this bucket' : ''}: every item with media is already on a post.`, 'no-fresh-item');
    const media = await deps.pickMedia(item);
    if (!media) return fail(409, 'The picked item has no usable media yet.', 'needs-staging');
    patch = { ...media }; // the post keeps its item; mediaStoragePath marks this media as used
    picked = { kind: 'item', packageId: item.id, title: item.title || null };
  }
  const swapped = await deps.swapPostMedia(post.id, patch);
  if (!swapped) return fail(409, 'The post changed or can no longer be edited.', 'post-conflict');
  return { ok: true, picked, approvalVoided: swapped.approvalVoided === true, row: (await deps.rowOf(post.id)) || null };
}
