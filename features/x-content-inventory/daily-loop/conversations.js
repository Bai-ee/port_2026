// Conversation intake: normalizing saved scan/search posts, scoring momentum,
// and grouping posts into narratives.
// Decides which conversations are live and how fast they are moving; never judges brand fit.
// Depends on config, text and time-ids only.

import { scoreQuoteTarget } from '../../x-quote-targets/rank.js';
import { CONVERSATION_MAX_AGE_HOURS } from './config.js';
import { tokenize } from './text.js';
import { stableHash } from './time-ids.js';

// --- conversations -----------------------------------------------------------

/** Normalize a saved watchlist candidate or a raw bird search result. */
export function normalizeConversationPost(raw = {}, source) {
  const author = raw.author?.username || raw.author || null;
  const id = String(raw.id || '');
  return {
    id,
    url: raw.url || (author && id ? `https://x.com/${author}/status/${id}` : null),
    author,
    text: String(raw.text || '').replace(/\s+/g, ' ').slice(0, 400),
    createdAt: raw.createdAt || null,
    likes: Number(raw.likes ?? raw.likeCount) || 0,
    reposts: Number(raw.reposts ?? raw.retweetCount) || 0,
    replies: Number(raw.replies ?? raw.replyCount) || 0,
    hasMedia: raw.hasMedia ?? (Array.isArray(raw.media) && raw.media.length > 0),
    vein: raw.vein || null,
    // Hot picks carry their lane window (design 36h, music 72h); absent = the default quote window.
    ...(Number(raw.windowHours) > 0 ? { windowHours: Number(raw.windowHours) } : {}),
    isReply: !!raw.inReplyToStatusId,
    source,
  };
}

function momentumOf(post, now) {
  const r = scoreQuoteTarget({
    createdAt: post.createdAt,
    likeCount: post.likes,
    retweetCount: post.reposts,
    replyCount: post.replies,
    media: post.hasMedia ? [{ type: 'photo' }] : [],
    author: { username: post.author },
    inReplyToStatusId: post.isReply ? 'x' : undefined,
  }, { now, windowHours: CONVERSATION_MAX_AGE_HOURS, minEngagement: 20 });
  return r;
}

export function conversationMomentum(m) {
  const velocity = Math.min(1, (m.velocity || 0) / 50);
  const reach = Math.min(1, Math.log10(Math.max(1, m.engagement || 0)) / 3);
  const fresh = Math.max(0, 1 - (m.ageHours || 0) / CONVERSATION_MAX_AGE_HOURS);
  return Number((0.6 * velocity + 0.25 * reach + 0.15 * fresh).toFixed(4));
}

/**
 * Group posts into narratives: two posts belong together when they share two
 * meaningful terms beyond the search term that found them. Simple and
 * explainable; a single post is a narrative of one.
 */
export function groupNarratives(posts = [], { now = Date.now() } = {}) {
  const live = posts
    .map((p) => ({ ...p, m: momentumOf(p, now) }))
    .filter((p) => p.m.ageHours != null && p.m.ageHours <= CONVERSATION_MAX_AGE_HOURS && p.m.score > 0);
  const terms = live.map((p) => new Set(tokenize(p.text)));
  const queryTerm = (p) => new Set(tokenize(String(p.source || '').replace(/^search:/, '')));
  const parent = live.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const skip = new Set([...queryTerm(live[i]), ...queryTerm(live[j])]);
      let shared = 0;
      for (const t of terms[i]) if (!skip.has(t) && terms[j].has(t)) shared += 1;
      if (shared >= 2) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  live.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  return [...groups.values()].map((group) => {
    group.sort((a, b) => conversationMomentum(b.m) - conversationMomentum(a.m));
    const anchor = group[0];
    const freq = new Map();
    for (const p of group) for (const t of new Set(tokenize(p.text))) freq.set(t, (freq.get(t) || 0) + 1);
    const label = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
    return {
      id: `n_${stableHash(group.map((p) => p.id).sort().join(','))}`,
      label,
      anchor,
      posts: group,
      text: group.map((p) => p.text).join(' \n '),
      momentum: {
        // Conversation momentum is velocity + reach + freshness. The quote-target
        // score (which also rewards media) is kept for the "reasons" line only.
        score: conversationMomentum(anchor.m),
        velocity: anchor.m.velocity,
        ageHours: anchor.m.ageHours,
        engagement: group.reduce((n, p) => n + p.m.engagement, 0),
        posts: group.length,
        reasons: anchor.m.reasons,
      },
      sources: [...new Set(group.map((p) => p.source))],
    };
  });
}

export function conversationPostsFrom({ scan, search }) {
  return [
    ...(scan?.candidates || []).map((c) => normalizeConversationPost(c, 'watchlist')),
    ...(search?.posts || []).map((p) => normalizeConversationPost(p, `search:${p.query || ''}`)),
  ].filter((p, i, a) => p.id && a.findIndex((q) => q.id === p.id) === i);
}
