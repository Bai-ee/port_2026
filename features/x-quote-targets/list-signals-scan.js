// Pure helpers for the local list-signals scan (Track Lists -> Daily Signals, P2).
// No fs, no network, no clock: `now` is always injected. The scan script owns all I/O.

import { STALE_SCAN_HOURS } from './day-plan.js';

export const LIST_SIGNALS_METHOD = 'bird list-timeline (local, free)';

/**
 * Flatten tracks to a fetch list. A list id attached to two tracks belongs to the FIRST track only.
 * @param {object[]} tracks normalized tracks (tracksOf)
 * @returns {{id:string,label:string,trackId:string}[]}
 */
export function collectTrackLists(tracks) {
  const seen = new Set();
  const out = [];
  for (const track of Array.isArray(tracks) ? tracks : []) {
    for (const list of Array.isArray(track?.lists) ? track.lists : []) {
      const id = String(list?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: list.label || `List ${id}`, trackId: track.id });
    }
  }
  return out;
}

/**
 * The ONE ranked-row -> candidate mapping. Handle candidates and list candidates both use it,
 * so the handle shape stays byte-identical to what the scan wrote before lists existed.
 */
export function toCandidate(r) {
  return {
    id: r.post.id,
    url: r.post.author?.username && r.post.id ? `https://x.com/${r.post.author.username}/status/${r.post.id}` : null,
    author: r.post.author?.username || null,
    authorName: r.post.author?.name || null,
    text: String(r.post.text || '').replace(/\s+/g, ' ').slice(0, 280),
    createdAt: r.post.createdAt || null,
    ageHours: r.ageHours,
    likes: r.post.likeCount ?? 0,
    reposts: r.post.retweetCount ?? 0,
    replies: r.post.replyCount ?? 0,
    engagement: r.engagement,
    velocity: r.velocity,
    windowOpen: r.windowOpen,
    vein: r.vein,
    hasMedia: r.hasMedia,
    score: r.score,
    reasons: r.reasons,
  };
}

/** A list candidate = the quote-target candidate + trackId/listId/source; vein is the track id. */
export function toListCandidate(r, { trackId, listId }) {
  return { ...toCandidate(r), vein: trackId, trackId, listId, source: 'list' };
}

/**
 * Trim one list's mapped candidates at write time.
 * Rule: drop posts older than windowHours; order by score (highest first); keep at most maxPerList;
 * no single author may exceed maxAuthorShare of the KEPT set. Greedy, so the cap per author is fixed
 * up front: max(1, floor(maxAuthorShare * min(maxPerList, eligibleCount))). Skipped posts from a
 * capped author are passed over and the next-best post from another author takes the slot.
 */
export function trimListPosts(candidates, { now, windowHours = 36, maxPerList = 30, maxAuthorShare = 0.4 } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => {
      const t = typeof c?.createdAt === 'string' ? Date.parse(c.createdAt) : NaN;
      const ageH = Number.isFinite(t) ? (nowMs - t) / 3_600_000 : Number(c?.ageHours);
      return Number.isFinite(ageH) && ageH <= windowHours;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const cap = Math.max(1, Math.floor(maxAuthorShare * Math.min(maxPerList, eligible.length)));
  const perAuthor = new Map();
  const kept = [];
  for (const c of eligible) {
    if (kept.length >= maxPerList) break;
    const key = String(c.author || '').toLowerCase();
    const n = perAuthor.get(key) || 0;
    if (n >= cap) continue;
    perAuthor.set(key, n + 1);
    kept.push(c);
  }
  return kept;
}

/** Contract shape of dashboard_state/{clientId}.marketingBrief.listSignals. */
export function buildListSignalsPayload({ generatedAt, byTrack }) {
  return { generatedAt, method: LIST_SIGNALS_METHOD, byTrack: byTrack && typeof byTrack === 'object' ? byTrack : {} };
}

/** Missing/invalid generatedAt, or older than STALE_SCAN_HOURS, is stale. */
export function isListSignalsStale(listSignals, now) {
  const g = listSignals?.generatedAt;
  const t = typeof g === 'string' ? Date.parse(g) : NaN;
  if (!Number.isFinite(t)) return true;
  return now - t > STALE_SCAN_HOURS * 3_600_000;
}
