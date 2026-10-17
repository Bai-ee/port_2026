// X API v2 tweet -> the bird timeline-object shape that normalizeTimeline (features/x-benchmark/normalize-corpus.js) consumes.
// Pure. Going through the SAME normalizer as the bird path is what guarantees the corpus rows are identical in keys/types:
// this module only reshapes the raw payload, it never builds a row itself.
//
// bird shape used downstream: { id, text, createdAt, likeCount, retweetCount, replyCount, viewCount, conversationId,
//   inReplyToStatusId, quotedTweet:{id,text,author:{username}}, media:[{type}], author:{username,name} }.

/** X API text is HTML-escaped (&amp; &lt; &gt;); bird returns it decoded. */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * @param {object} t  X API tweet ({id,text,created_at,public_metrics,referenced_tweets,attachments,conversation_id,author_id})
 * @param {{includesTweets?:Map|object, users?:Map|object, media?:Map|object, author?:{username:string,name?:string}}} [ctx]
 *   includes lookups by id / media_key / user id; `author` is the timeline owner (every post of a user timeline).
 */
export function xApiTweetToBird(t, ctx = {}) {
  if (!t || typeof t !== 'object') return null;
  const get = (m, k) => (m instanceof Map ? m.get(k) : m?.[k]);
  const refs = Array.isArray(t.referenced_tweets) ? t.referenced_tweets : [];
  const replied = refs.find((r) => r?.type === 'replied_to');
  const quotedRef = refs.find((r) => r?.type === 'quoted');
  const m = t.public_metrics || {};
  const authorOf = (id) => get(ctx.users, id);

  const out = {
    id: String(t.id ?? ''),
    text: decodeEntities(t.text),
    createdAt: t.created_at,
    likeCount: finite(m.like_count) ?? 0,
    retweetCount: finite(m.retweet_count) ?? 0,
    replyCount: finite(m.reply_count) ?? 0,
    conversationId: t.conversation_id ? String(t.conversation_id) : String(t.id ?? ''),
  };
  // Only set when present: normalizeTweet maps a missing view count to null, but Number(null) would be 0.
  const views = finite(m.impression_count);
  if (views !== undefined) out.viewCount = views;
  if (replied?.id) out.inReplyToStatusId = String(replied.id);
  if (quotedRef?.id) {
    const q = get(ctx.includesTweets, quotedRef.id);
    const qa = q ? authorOf(q.author_id) : null;
    out.quotedTweet = { id: String(quotedRef.id), text: decodeEntities(q?.text), author: { username: qa?.username || '' } };
  }
  const keys = Array.isArray(t.attachments?.media_keys) ? t.attachments.media_keys : [];
  const media = keys.map((k) => get(ctx.media, k)).filter(Boolean).map((x) => ({ type: x.type }));
  // A media key whose include did not come back is still media (type unknown -> 'image' via mediaKind).
  out.media = media.length ? media : keys.map(() => ({ type: 'photo' }));
  const a = ctx.author || authorOf(t.author_id);
  if (a?.username) out.author = { username: a.username, ...(a.name ? { name: a.name } : {}) };
  return out;
}

/** Index a v2 `includes` block ({tweets,users,media}) into lookup Maps. */
export function indexIncludes(includes) {
  const by = (list, key) => new Map((Array.isArray(list) ? list : []).filter((x) => x && x[key] != null).map((x) => [String(x[key]), x]));
  return { includesTweets: by(includes?.tweets, 'id'), users: by(includes?.users, 'id'), media: by(includes?.media, 'media_key') };
}

/** Map a whole v2 timeline page ({data:[tweets], includes}) to bird objects. */
export function mapXApiPage(page, { author } = {}) {
  const idx = indexIncludes(page?.includes);
  return (Array.isArray(page?.data) ? page.data : []).map((t) => xApiTweetToBird(t, { ...idx, ...(author ? { author } : {}) })).filter(Boolean);
}
