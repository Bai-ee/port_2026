// Rank candidate posts for quote-reacting. Pure, deterministic, no network.
//
// A quote inherits the reading audience of the post it quotes, so the job here
// is to find posts that are *being read right now* — not posts that were
// popular once. That makes velocity (engagement per hour) the primary signal
// and raw totals a secondary one.
//
// This is deliberately NOT `scoreXPost`. That scores copy you are about to
// write; this scores someone else's post as a vehicle. They answer different
// questions, and `scoreXPost` has no model of borrowed reach at all.

import { VEIN_WEIGHTS, veinOf } from './watchlist.js';

/**
 * Hours a post stays worth quoting.
 *
 * ⚠️ NOT the 6h reply window. Measured across 216 real quote-reacts by the
 * model account: median target age **17.8h**, p75 24.4h, p90 36.7h — only 13%
 * were quoted within 6h. Replies need a live conversation; a quote only needs
 * a post still being read. A 6h window would discard 87% of what works.
 */
export const DEFAULT_WINDOW_HOURS = 36;

/** Below this, the post has no audience worth borrowing. */
export const MIN_ENGAGEMENT = 50;

export function ageHoursOf(createdAt, now = Date.now()) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 3_600_000);
}

/**
 * @param {object} post - { id, url, text, createdAt, likeCount, retweetCount,
 *                          replyCount, media[], author:{username}, quotedTweet? , inReplyToStatusId? }
 * @param {object} [opts] - { now, windowHours, minEngagement }
 * @returns {object} { score, velocity, ageHours, engagement, windowOpen, reasons[], penalties[] }
 */
export function scoreQuoteTarget(rawPost = {}, opts = {}) {
  // Same trap as rankQuoteTargets: a default parameter does not catch `null`,
  // and a null candidate is a real case from a partial scan.
  const post = rawPost && typeof rawPost === 'object' ? rawPost : {};
  const now = opts.now ?? Date.now();
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const minEngagement = opts.minEngagement ?? MIN_ENGAGEMENT;

  const likes = Number(post.likeCount) || 0;
  const reposts = Number(post.retweetCount) || 0;
  const replies = Number(post.replyCount) || 0;
  const engagement = likes + reposts + replies;

  const ageHours = ageHoursOf(post.createdAt, now);
  // An undatable post cannot be velocity-ranked; refuse rather than guess.
  if (ageHours == null) {
    return { score: 0, velocity: null, ageHours: null, engagement, windowOpen: false, reasons: [], penalties: ['no-timestamp'] };
  }

  const velocity = engagement / Math.max(0.25, ageHours);
  const windowOpen = ageHours <= windowHours;

  const reasons = [];
  const penalties = [];

  // --- velocity, the primary signal --------------------------------------
  // 200/h is roughly the model account's best observed quote targets; treat
  // that as "full marks" and scale linearly below it.
  const velocityScore = Math.min(1, velocity / 200);
  if (velocity >= 100) reasons.push(`climbing fast (${Math.round(velocity)}/h)`);
  else if (velocity >= 25) reasons.push(`moving (${Math.round(velocity)}/h)`);

  // --- absolute audience, secondary --------------------------------------
  const reachScore = Math.min(1, Math.log10(Math.max(1, engagement)) / 4); // 10k -> 1.0
  if (engagement >= 2000) reasons.push(`${engagement.toLocaleString('en-US')} engagements to borrow`);

  // --- freshness, deliberately light ---------------------------------------
  // His best quotes (>=200 likes) span 1.7h to 268h with a 20.5h median, so age
  // is a weak predictor once the post is inside the window. Velocity carries it.
  const freshScore = windowOpen ? Math.max(0, 1 - ageHours / windowHours) : 0;
  if (ageHours <= 3) reasons.push('very fresh');
  if (!windowOpen) penalties.push(`stale (${Math.round(ageHours)}h)`);

  // --- media: quote-reacts work on things people can look at -------------
  const hasMedia = Array.isArray(post.media) && post.media.length > 0;
  const isVideo = hasMedia && post.media.some((m) => m && (m.type === 'video' || m.type === 'animated_gif'));
  const mediaScore = isVideo ? 1 : hasMedia ? 0.85 : 0.15;
  if (isVideo) reasons.push('video');
  else if (hasMedia) reasons.push('image');
  else penalties.push('no media — little to react to');

  // --- vein ---------------------------------------------------------------
  const vein = veinOf(post.author?.username);
  const veinScore = vein ? (VEIN_WEIGHTS[vein] ?? 0.5) : 0.35;
  if (vein) reasons.push(vein);

  // --- disqualifiers ------------------------------------------------------
  if (engagement < minEngagement) penalties.push(`under ${minEngagement} engagements`);
  if (post.inReplyToStatusId) penalties.push('is a reply — quoting it buries the context');
  if (/^RT @/.test(String(post.text || ''))) penalties.push('is a retweet');

  const composite =
    velocityScore * 0.40 +
    reachScore * 0.22 +
    mediaScore * 0.20 +
    freshScore * 0.10 +
    veinScore * 0.08;

  // Hard zero rather than a low score: these are not judgement calls.
  const disqualified =
    engagement < minEngagement ||
    !!post.inReplyToStatusId ||
    /^RT @/.test(String(post.text || ''));

  return {
    score: disqualified ? 0 : Number(composite.toFixed(4)),
    velocity: Number(velocity.toFixed(1)),
    ageHours: Number(ageHours.toFixed(1)),
    engagement,
    windowOpen,
    vein,
    hasMedia,
    reasons,
    penalties,
  };
}

/**
 * Rank a flat list of posts, keeping the best per author so one hot account
 * cannot fill the whole slate.
 * @returns {object[]} scored posts, best first
 */
export function rankQuoteTargets(posts = [], opts = {}) {
  const perAuthor = opts.perAuthor ?? 1;
  const limit = opts.limit ?? 12;
  // A default parameter only covers `undefined`; a null feed is a real case
  // when an upstream scan returns nothing.
  if (!Array.isArray(posts)) return [];

  const scored = posts
    .map((p) => ({ post: p, ...scoreQuoteTarget(p, opts) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const seen = new Map();
  const out = [];
  for (const row of scored) {
    const author = String(row.post.author?.username || '').toLowerCase();
    const n = seen.get(author) || 0;
    if (n >= perAuthor) continue;
    seen.set(author, n + 1);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
