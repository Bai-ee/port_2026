// Track-list posts -> reply-targets candidate pool (`listPosts`).
//
// Source: dashboard_state/{clientId}.marketingBrief.listSignals, written by the
// local quote-target scan (byTrack[trackId].posts[]). Pure: no fs, no network.
//
// Each post is mapped to the shape the other pool entries use, then run through
// the caller's `enrich` (the route's withVelocity) so ageHours / velocityPerHour /
// replyWindowOpen are computed exactly like every other pool entry.
//
// Cap: LIST_REPLY_POOL_CAP posts, highest velocityPerHour first, to bound the
// reply-targets prompt size (posts without a parseable time sort last).

import { STALE_SCAN_HOURS } from '../../x-quote-targets/day-plan.js';

export const LIST_REPLY_POOL_CAP = 40;

function isFresh(listSignals, nowMs) {
  const t = Date.parse(listSignals?.generatedAt);
  return Number.isFinite(t) && nowMs - t <= STALE_SCAN_HOURS * 3_600_000;
}

function flattenPosts(listSignals) {
  const byTrack = listSignals?.byTrack;
  if (!byTrack || typeof byTrack !== 'object') return [];
  const out = [];
  for (const [trackId, entry] of Object.entries(byTrack)) {
    for (const p of Array.isArray(entry?.posts) ? entry.posts : []) {
      if (p && typeof p === 'object') out.push({ ...p, trackId: p.trackId || trackId });
    }
  }
  return out;
}

/** True when listSignals is fresh and holds at least one post. */
export function hasUsableListSignals(listSignals, { nowMs = Date.now() } = {}) {
  return isFresh(listSignals, nowMs) && flattenPosts(listSignals).length > 0;
}

/** Comparable id for a pool entry: explicit id, else the X status id in its url. */
export function postKey(it) {
  if (!it || typeof it !== 'object') return null;
  if (it.id != null && it.id !== '') return String(it.id);
  const m = typeof it.url === 'string' ? it.url.match(/status\/(\d+)/) : null;
  return m ? m[1] : null;
}

/** Ids already present anywhere in an assembled reply pool. */
export function collectPoolIds(pool) {
  const ids = new Set();
  const add = (it) => { const k = postKey(it); if (k) ids.add(k); };
  for (const h of Array.isArray(pool?.watchlistMentions) ? pool.watchlistMentions : []) {
    (h?.ownPosts || []).forEach(add);
    (h?.mentions || []).forEach(add);
  }
  for (const key of ['brandMentions', 'redditSignals', 'kolActivity']) {
    (Array.isArray(pool?.[key]) ? pool[key] : []).forEach(add);
  }
  return ids;
}

export function listPostsForReplyPool(listSignals, { nowMs = Date.now(), existingIds = new Set(), cap = LIST_REPLY_POOL_CAP, enrich } = {}) {
  if (!hasUsableListSignals(listSignals, { nowMs })) return [];
  const seen = new Set(existingIds);
  const mapped = [];
  for (const p of flattenPosts(listSignals)) {
    const key = postKey(p);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const likes = Number.isFinite(p.likes) ? p.likes : 0;
    const reposts = Number.isFinite(p.reposts) ? p.reposts : 0;
    const replies = Number.isFinite(p.replies) ? p.replies : 0;
    const item = {
      id: p.id,
      url: p.url,
      author: p.author,
      authorName: p.authorName,
      text: p.text,
      createdAt: p.createdAt,
      likes,
      reposts,
      replies,
      // Explicit so pickEngagement never folds the scan's ranking `score` in.
      engagementTotal: likes + reposts + replies,
      hasMedia: p.hasMedia,
      vein: p.vein,
      reasons: p.reasons,
      trackId: p.trackId,
      listId: p.listId,
      source: 'list',
    };
    mapped.push(typeof enrich === 'function' ? enrich(item, nowMs) : item);
  }
  mapped.sort((a, b) => (b.velocityPerHour ?? -1) - (a.velocityPerHour ?? -1));
  return mapped.slice(0, Math.max(0, cap));
}
