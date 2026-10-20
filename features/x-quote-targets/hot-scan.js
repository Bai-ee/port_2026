// Hot quote scan: pure core (discovery -> breakout -> momentum -> picks). No I/O, no clock unless `now` is passed.
// The Mac script (scripts/x-content/hot-quote-scan.mjs) fetches with bird and calls the judge; everything decidable lives here.
// Stored at dashboard_state/{clientId}.marketingBrief.hotQuotes (see buildHotQuotesPayload).

import { scoreQuoteTarget, ageHoursOf } from './rank.js';
import {
  HOT_PICKS_PER_REFRESH, LANE_MIX, QUOTES_PER_DAY, OWNER_TIMEZONE, LANE_WINDOW_HOURS, DESIGN_MIN_ENGAGEMENT,
  MUSIC_MIN_ENGAGEMENT, MUSIC_BREAKOUT_MULTIPLE, MUSIC_SEARCH_MIN_ENGAGEMENT, SHOWN_HISTORY_DAYS,
  SNAPSHOT_MAX_AGE_HOURS, SNAPSHOT_MAX, HOT_QUERIES, JUDGE,
} from './hot-config.js';

export const HOT_LANES = Object.freeze(['design', 'music']);
const HOUR = 3_600_000;
const MOMENTUM_FACTOR = Object.freeze({ climbing: 1, new: 0.9, flat: 0.6, fading: 0.3 });

const engagementOf = (p) => (Number(p?.likeCount) || 0) + (Number(p?.retweetCount) || 0) + (Number(p?.replyCount) || 0);
const isVideo = (p) => (p?.media || []).some((m) => m && (m.type === 'video' || m.type === 'animated_gif'));
const hasMedia = (p) => Array.isArray(p?.media) && p.media.length > 0;

export function median(nums) {
  const a = (nums || []).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Search queries for a lane with `{since}` filled (UTC date, `windowHours` back). */
export function expandQueries(lane, now = Date.now(), queries = HOT_QUERIES) {
  const since = new Date(now - (LANE_WINDOW_HOURS[lane] ?? 36) * HOUR).toISOString().slice(0, 10);
  return (queries[lane] || []).map((q) => q.replace('{since}', since));
}

/** Median engagement of an account's recent ORIGINAL posts (no replies / RTs), from one user-tweets fetch. */
export function accountMedianEngagement(posts, { excludeId } = {}) {
  return median((posts || [])
    .filter((p) => p && !p.inReplyToStatusId && !/^RT @/.test(String(p.text || '')) && p.id !== excludeId)
    .map(engagementOf));
}

/**
 * Breakout test + score for one post in one lane. `accountMedian` is set only for posts that came from an account fetch.
 * @returns {{qualifies:boolean, score:number, ageHours:number|null, engagement:number, velocity:number|null, multiple:number|null, reasons:string[]}}
 */
export function scoreHotPost(post, lane, { now = Date.now(), accountMedian = null } = {}) {
  const windowHours = LANE_WINDOW_HOURS[lane];
  const engagement = engagementOf(post);
  const ageHours = ageHoursOf(post?.createdAt, now);
  const base = { qualifies: false, score: 0, ageHours, engagement, velocity: null, multiple: null, reasons: [] };
  if (ageHours == null || ageHours > windowHours) return base;
  if (!hasMedia(post)) return { ...base, reasons: ['no media'] };
  if (post.inReplyToStatusId || /^RT @/.test(String(post.text || ''))) return base;

  if (lane === 'design') {
    const s = scoreQuoteTarget(post, { now, windowHours, minEngagement: DESIGN_MIN_ENGAGEMENT });
    return { ...base, qualifies: s.score > 0 && s.windowOpen, score: s.score, velocity: s.velocity, reasons: s.reasons };
  }

  // music: relative breakout against the account's own median (search hits must clear an absolute floor instead)
  const velocity = engagement / Math.max(0.25, ageHours);
  const reasons = [];
  let multiple = null;
  let breakout;
  if (accountMedian != null) {
    multiple = engagement / Math.max(1, accountMedian);
    breakout = multiple >= MUSIC_BREAKOUT_MULTIPLE && engagement >= MUSIC_MIN_ENGAGEMENT;
    if (breakout) reasons.push(`${Math.round(multiple)}x this account's usual`);
  } else {
    breakout = engagement >= MUSIC_SEARCH_MIN_ENGAGEMENT;
    if (breakout) reasons.push(`${engagement} engagements from search`);
  }
  if (!breakout) return { ...base, velocity: Number(velocity.toFixed(1)), multiple };
  const strength = multiple != null ? Math.min(1, multiple / 20) : Math.min(1, engagement / 500);
  const score = 0.5 * strength + 0.3 * Math.min(1, velocity / 30) + 0.2 * (isVideo(post) ? 1 : 0.85);
  if (isVideo(post)) reasons.push('video');
  return { ...base, qualifies: true, score: Number(score.toFixed(4)), velocity: Number(velocity.toFixed(1)), multiple, reasons };
}

const firstMedia = (post) => {
  const m = (post.media || []).find((x) => x && typeof x.url === 'string' && /^https:\/\//.test(x.url));
  return m ? { mediaUrl: m.url.slice(0, 500), mediaType: m.type === 'video' || m.type === 'animated_gif' ? 'video' : 'image' } : {};
};

/**
 * Candidates for one lane from pooled posts. `sources` maps post id -> { via: 'search'|'account', accountMedian?, note? }.
 * De-duplicated by id, never includes `excludeIds` (owner posts, already shown), sorted best first.
 */
export function buildCandidates(lane, entries, { now = Date.now(), excludeIds = new Set(), ownHandle = '' } = {}) {
  const seen = new Set();
  const out = [];
  for (const { post, via = 'search', accountMedian = null } of entries || []) {
    if (!post?.id || seen.has(post.id) || excludeIds.has(post.id)) continue;
    const author = post.author?.username || '';
    if (!author || author.toLowerCase() === String(ownHandle).toLowerCase()) continue;
    seen.add(post.id);
    const s = scoreHotPost(post, lane, { now, accountMedian });
    if (!s.qualifies) continue;
    out.push({
      id: post.id,
      lane,
      windowHours: LANE_WINDOW_HOURS[lane],
      via,
      url: `https://x.com/${author}/status/${post.id}`,
      author,
      authorName: post.author?.name || null,
      text: String(post.text || '').replace(/\s+/g, ' ').slice(0, 400),
      createdAt: post.createdAt || null,
      ageHours: s.ageHours == null ? null : Number(s.ageHours.toFixed(1)),
      likes: post.likeCount ?? 0,
      reposts: post.retweetCount ?? 0,
      replies: post.replyCount ?? 0,
      engagement: s.engagement,
      velocity: s.velocity,
      multiple: s.multiple == null ? null : Number(s.multiple.toFixed(1)),
      score: s.score,
      reasons: s.reasons,
      hasVideo: isVideo(post),
      ...firstMedia(post),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * climbing | flat | fading | new. Compares the engagement gained since the previous snapshot with the post's own
 * average pace (engagement / age). First sighting (or snapshot too fresh to compare) = 'new'.
 */
export function momentumOf(prev, cur, now = Date.now()) {
  const prevAt = Date.parse(prev?.at || '');
  if (!Number.isFinite(prevAt) || !Number.isFinite(prev?.engagement)) return 'new';
  const hours = (now - prevAt) / HOUR;
  if (hours < 0.5) return 'new';
  const age = Math.max(0.25, Number(cur?.ageHours) || 0);
  const avgRate = cur.engagement / age;
  const recentRate = Math.max(0, cur.engagement - prev.engagement) / hours;
  if (avgRate <= 0) return 'flat';
  if (recentRate >= 0.7 * avgRate) return 'climbing';
  if (recentRate <= 0.25 * avgRate) return 'fading';
  return 'flat';
}

/** Snapshot map after this run: prior entries (still young) + the posts just read, newest wins, capped. */
export function updateSnapshots(prior, candidates, now = Date.now()) {
  const next = {};
  for (const [id, s] of Object.entries(prior || {})) {
    if (now - Date.parse(s?.at || '') <= SNAPSHOT_MAX_AGE_HOURS * HOUR) next[id] = s;
  }
  for (const c of candidates || []) next[c.id] = { at: new Date(now).toISOString(), engagement: c.engagement };
  return Object.fromEntries(Object.entries(next).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, SNAPSHOT_MAX));
}

/** Drop shown-history entries older than the retention window. */
export function pruneShown(shown, now = Date.now(), days = SHOWN_HISTORY_DAYS) {
  return Object.fromEntries(Object.entries(shown || {}).filter(([, v]) => now - Date.parse(v?.shownAt || '') <= days * 24 * HOUR));
}

/**
 * Choose the refresh's picks from judged candidates.
 * @param {object[]} judged  candidates with { fit, angle, why, reject?, momentum }
 * @returns {{design:object[], music:object[], all:object[]}}  lane-grouped + flat, rank order; fewer than `total` when too few pass.
 */
export function selectPicks(judged, { shownIds = new Set(), total = HOT_PICKS_PER_REFRESH, mix = LANE_MIX, threshold = JUDGE.threshold } = {}) {
  const eligible = (judged || [])
    .filter((c) => !c.reject && c.angle && c.angle !== 'none' && c.fit >= threshold && !shownIds.has(c.id))
    .map((c) => ({ ...c, rank: Number((c.fit * (MOMENTUM_FACTOR[c.momentum] ?? 0.9) * (0.5 + 0.5 * Math.min(1, c.score))).toFixed(4)) }))
    .sort((a, b) => b.rank - a.rank);

  const chosen = [];
  const take = (c) => { chosen.push(c); return true; };
  for (const lane of HOT_LANES) {
    eligible.filter((c) => c.lane === lane).slice(0, mix[lane] ?? 0).forEach(take);
  }
  // fill what a short lane left from the best remaining (either lane), never past `total`, never padding
  for (const c of eligible) {
    if (chosen.length >= total) break;
    if (!chosen.includes(c)) take(c);
  }
  const all = chosen.slice(0, total).sort((a, b) => b.rank - a.rank);
  return { design: all.filter((c) => c.lane === 'design'), music: all.filter((c) => c.lane === 'music'), all };
}

/** Shape of one stored pick (also the shown-history payload). */
export function toPick(c, now = Date.now()) {
  return {
    id: c.id, lane: c.lane, windowHours: c.windowHours, url: c.url, author: c.author, authorName: c.authorName, text: c.text, createdAt: c.createdAt,
    ageHours: c.ageHours, likes: c.likes, reposts: c.reposts, replies: c.replies, engagement: c.engagement, velocity: c.velocity,
    ...(c.mediaUrl ? { mediaUrl: c.mediaUrl, mediaType: c.mediaType } : {}),
    momentum: c.momentum, fit: c.fit, angle: c.angle, why: c.why, rank: c.rank, shownAt: new Date(now).toISOString(),
  };
}

/** CT calendar day (YYYY-MM-DD) of a timestamp. */
export function localDay(ms, tz = OWNER_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Owner quote-tweets posted today (CT) among his recent bird `user-tweets` rows. */
export function countQuotesToday(tweets, now = Date.now(), tz = OWNER_TIMEZONE) {
  const today = localDay(now, tz);
  return (tweets || []).filter((t) => t?.quotedTweet && !t.inReplyToStatusId && Number.isFinite(Date.parse(t.createdAt)) && localDay(Date.parse(t.createdAt), tz) === today).length;
}

/** Ids of posts the owner has already quote-tweeted (from his recent timeline): never suggested again. */
export const alreadyQuotedIds = (tweets) => new Set((tweets || []).map((t) => t?.quotedTweet?.id).filter(Boolean).map(String));

export const quotesLeftToday = (postedToday) => Math.max(0, QUOTES_PER_DAY - (Number(postedToday) || 0));

/** The stored marketingBrief.hotQuotes document. */
export function buildHotQuotesPayload({ scannedAt, picks, postedToday, costUsd, notes = [], shown, snapshots, rotation, stats = {} }) {
  return {
    scannedAt,
    picks: { design: picks.design, music: picks.music },
    quotesPostedToday: postedToday,
    quotesLeftToday: quotesLeftToday(postedToday),
    costUsd: Number((costUsd || 0).toFixed(5)),
    notes,
    stats,
    shown,
    snapshots,
    rotation,
  };
}
