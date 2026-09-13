// Raw timeline objects -> normalized corpus rows.
//
// This is the row shape everything downstream assumes (summarize.js,
// compare.js, derive-watchlist.js) and it used to exist twice, once per
// research script, with a hardcoded handle in each. One copy, parameterized,
// so the client's corpus and the benchmark's are built by identical code —
// otherwise a comparison measures the difference between two normalizers.
//
// Pure: no fs, no network, no clock.

import { tagTopics, tagLanes } from './taxonomy.js';

/** A quote whose caption is longer than this is commentary, not a reaction.
 * Measured boundary from the original research: short captions ride the quoted
 * post's subject, long ones assert something of their own, and the two behave
 * differently enough to be separate types. */
export const QUOTE_REACT_MAX_CHARS = 90;

function str(v) {
  return typeof v === 'string' ? v : '';
}

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Classify a post. `handle` is needed to tell a self-quote (promoting your own
 * earlier post) from quoting someone else — a different play entirely. */
export function classifyType(raw, handle) {
  if (/^RT @/.test(str(raw?.text))) return 'retweet';
  if (raw?.inReplyToStatusId) return 'reply';
  if (raw?.quotedTweet) {
    const quotedAuthor = str(raw.quotedTweet?.author?.username).toLowerCase();
    if (quotedAuthor && quotedAuthor === str(handle).toLowerCase()) return 'self-quote';
    return str(raw.text).length <= QUOTE_REACT_MAX_CHARS ? 'quote-react' : 'quote-commentary';
  }
  return (Array.isArray(raw?.media) && raw.media.length) ? 'original-showcase' : 'original-text';
}

export function mediaKind(raw) {
  const media = Array.isArray(raw?.media) ? raw.media : [];
  if (!media.length) return 'none';
  const kinds = new Set(media.map((m) => m?.type));
  if (kinds.has('video')) return 'video';
  if (kinds.has('animated_gif')) return 'gif';
  return 'image';
}

/**
 * Normalize one raw post.
 *
 * @param {object} raw - a timeline object (bird / ScrapeCreators shape)
 * @param {object} opts
 * @param {string} opts.handle - the account the timeline belongs to
 * @param {number} [opts.tzOffsetHours=0] - offset applied to derive local
 *   date/hour. ⚠️ Local, per account: two accounts in different zones cannot
 *   have their clock hours compared, only the shape of their occupancy.
 * @param {string[]} [opts.lanes] - client lane vocabulary, tagged separately
 * @param {Record<string, number>} [opts.views] - id -> view count, when views
 *   were backfilled separately (they are not on the timeline itself)
 * @returns {object|null} a corpus row, or null if the post cannot be placed
 */
export function normalizeTweet(raw, opts = {}) {
  const handle = str(opts.handle).replace(/^@+/, '');
  const id = str(raw?.id ?? raw?.id_str);
  const createdAt = raw?.createdAt ?? raw?.created_at;
  const utcMs = Date.parse(createdAt);
  // A post with no id or no parseable timestamp is dropped rather than
  // defaulted: a row placed on the wrong day corrupts cadence, which is the
  // headline metric.
  if (!id || !Number.isFinite(utcMs)) return null;

  const tz = Number(opts.tzOffsetHours);
  const offset = Number.isFinite(tz) ? tz : 0;
  const local = new Date(utcMs + offset * 3_600_000);
  const text = str(raw?.text);
  const quotedText = str(raw?.quotedTweet?.text);
  const quotedAuthor = str(raw?.quotedTweet?.author?.username) || null;

  const likes = int(raw?.likeCount ?? raw?.favorite_count);
  const reposts = int(raw?.retweetCount ?? raw?.retweet_count);
  const replies = int(raw?.replyCount ?? raw?.reply_count);
  const rawViews = raw?.viewCount ?? raw?.views ?? opts.views?.[id];
  const views = Number.isFinite(Number(rawViews)) ? Number(rawViews) : null;
  const engagement = likes + reposts + replies;

  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    utc: new Date(utcMs).toISOString(),
    dateLocal: local.toISOString().slice(0, 10),
    timeLocal: local.toISOString().slice(11, 16),
    hourLocal: local.getUTCHours(),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][local.getUTCDay()],
    type: classifyType(raw, handle),
    media: mediaKind(raw),
    hasLink: /https?:\/\/(?!t\.co\/\w+$)/i.test(text),
    topics: tagTopics(text, { quotedText }),
    lanes: tagLanes(`${text} ${quotedText}`, opts.lanes),
    chars: text.length,
    lines: text.split('\n').length,
    text,
    likes,
    reposts,
    replies,
    views,
    engagement,
    engagementRate: views ? engagement / views : null,
    quotedAuthor,
    quotedText: quotedText || null,
    conversationId: str(raw?.conversationId) || id,
  };
}

/**
 * Normalize a whole timeline, newest first, de-duplicated by id.
 *
 * @param {object[]} raws
 * @param {object} opts - same as normalizeTweet, plus:
 * @param {string} [opts.since] - ISO date; posts older than this are dropped
 * @returns {{rows: object[], dropped: number}}
 */
export function normalizeTimeline(raws, opts = {}) {
  const list = Array.isArray(raws) ? raws : [];
  const sinceMs = opts.since ? Date.parse(opts.since) : null;
  const seen = new Set();
  const rows = [];
  let dropped = 0;

  for (const raw of list) {
    const row = normalizeTweet(raw, opts);
    if (!row) { dropped += 1; continue; }
    if (seen.has(row.id)) { dropped += 1; continue; }
    if (Number.isFinite(sinceMs) && Date.parse(row.utc) < sinceMs) { dropped += 1; continue; }
    seen.add(row.id);
    rows.push(row);
  }

  rows.sort((a, b) => (a.utc < b.utc ? 1 : -1));
  return { rows, dropped };
}
