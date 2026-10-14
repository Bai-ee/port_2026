// Repost (retweet) support. A social_posts row with kind:'repost' carries the
// target tweet in `repostOf` and publishes through the X adapter's repost call
// instead of creating a tweet. Its `content` is a display label only and is
// never sent to X. Pure helpers, no I/O.

const STATUS_URL = /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i;
const TWEET_ID = /^\d{5,25}$/;

// Accepts a tweet id or an x.com / twitter.com status URL. null when neither.
export function parseTweetRef(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (TWEET_ID.test(raw)) return { tweetId: raw, url: `https://x.com/i/status/${raw}`, author: null };
  const m = raw.match(STATUS_URL);
  if (!m) return null;
  const author = m[1].toLowerCase() === 'i' ? null : m[1];
  return { tweetId: m[2], url: author ? `https://x.com/${author}/status/${m[2]}` : `https://x.com/i/status/${m[2]}`, author };
}

export function sanitizeRepostOf(value) {
  if (!value || typeof value !== 'object') return null;
  const ref = parseTweetRef(value.tweetId || value.url);
  if (!ref) return null;
  const author = String(value.author || ref.author || '').replace(/^@/, '').slice(0, 15);
  const text = String(value.text || '').trim().slice(0, 600);
  return { tweetId: ref.tweetId, url: ref.url, author: author || null, text: text || null };
}

// The row's display content. Kept non-empty so every existing content check
// (required, 280 max, placeholder guard, approval hash) applies unchanged.
export function repostLabel(repostOf) {
  if (!repostOf?.url) return '';
  return `Repost ${repostOf.author ? `@${repostOf.author} ` : ''}${repostOf.url}`;
}
