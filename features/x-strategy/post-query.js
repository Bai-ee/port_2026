// Pure post query for the agent/MCP find_posts tool: normalizes social_posts rows (raw docs or the postStatusRow
// projection) into one flat shape with kind + links, and filters them. No I/O; `now` is injected.
//
// Where a quoted tweet URL can live (all handled by quotedUrlOf):
//   sourceRef {kind:'quote-target', url}          daily-fill quote drafts
//   sourceRef {suggestionType:'quote-*', opportunityUrl}   daily-loop quote suggestions
//   quoteTweetId / quoteOf / quoteTarget{url}     defensive: not written by current code
//   trailing x.com status URL in the text         quote-targets "draft-quote" drafts (caption + URL)
// Repost rows: kind 'repost' + repostOf {tweetId,url,author}. Replies: replyTo {url}.
// Published link: `permalink` (manual delivery) else https://x.com/i/status/<twitterId> (API publish).

import { ctDate } from '../x-content-inventory/month-calendar.js';
import { hasMemoryPlaceholder } from '../social-posting/self-reply.js';

export const POST_QUERY_KINDS = Object.freeze(['quote', 'repost', 'reply', 'original', 'any']);
export const FIND_POSTS_MAX = 50;
const TEXT_MAX = 200;
const STATUS_URL = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Canonical https://x.com/<handle>/status/<id> from a URL (any x/twitter form) or null. */
function canonicalStatusUrl(value) {
  const m = STATUS_URL.exec(String(value ?? ''));
  if (!m) return null;
  return m[1].toLowerCase() === 'i' ? `https://x.com/i/status/${m[2]}` : `https://x.com/${m[1]}/status/${m[2]}`;
}

function urlFromIdAndHandle(id, handle) {
  const clean = str(id);
  if (!clean || !/^\d{5,25}$/.test(clean)) return null;
  const h = str(handle)?.replace(/^@/, '');
  return h && /^[A-Za-z0-9_]{1,15}$/.test(h) ? `https://x.com/${h}/status/${clean}` : `https://x.com/i/status/${clean}`;
}

export function repostUrlOf(p) {
  if (!isPlain(p)) return null;
  if (p.kind !== 'repost' && !isPlain(p.repostOf)) return null;
  const r = isPlain(p.repostOf) ? p.repostOf : {};
  const direct = canonicalStatusUrl(r.url);
  if (direct && !direct.includes('/i/status/')) return direct;
  return urlFromIdAndHandle(r.tweetId || direct?.split('/').pop(), r.author) || direct; // upgrade an id-only URL when the author is known
}

/** The quoted tweet URL for a quote post, or null. Reposts and replies are never quotes. */
export function quotedUrlOf(p) {
  if (!isPlain(p) || p.kind === 'repost') return null;
  const ref = isPlain(p.sourceRef) ? p.sourceRef : {};
  if (ref.kind === 'quote-target') {
    const u = canonicalStatusUrl(ref.url) || urlFromIdAndHandle(ref.id, ref.handle);
    if (u) return u;
  }
  if (/^quote/.test(String(ref.suggestionType ?? ''))) {
    const u = canonicalStatusUrl(ref.opportunityUrl);
    if (u) return u;
  }
  const qt = isPlain(p.quoteTarget) ? p.quoteTarget : null;
  if (qt) { const u = canonicalStatusUrl(qt.url) || urlFromIdAndHandle(qt.id, qt.handle); if (u) return u; }
  if (typeof p.quoteOf === 'string') { const u = canonicalStatusUrl(p.quoteOf) || urlFromIdAndHandle(p.quoteOf, null); if (u) return u; }
  if (isPlain(p.quoteOf)) { const u = canonicalStatusUrl(p.quoteOf.url) || urlFromIdAndHandle(p.quoteOf.tweetId || p.quoteOf.id, p.quoteOf.author || p.quoteOf.handle); if (u) return u; }
  if (p.quoteTweetId) { const u = urlFromIdAndHandle(p.quoteTweetId, null); if (u) return u; }
  // Last carrier: a status URL at the end of the text (the quote-targets draft shape: caption + URL).
  if (!p.replyTo) {
    const text = String(p.content ?? p.text ?? '').trim();
    const m = /(https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/\d{5,25})[^\s]*$/i.exec(text);
    if (m) return canonicalStatusUrl(m[1]);
  }
  return null;
}

/** Permalink after publish: recorded permalink, else the id-only URL from the API-published tweet id. */
export function postedUrlOf(p) {
  if (!isPlain(p)) return null;
  const link = canonicalStatusUrl(p.permalink);
  if (link) return link;
  return p.status === 'posted' || p.postedAt ? urlFromIdAndHandle(p.twitterId, null) : null;
}

export function replyToUrlOf(p) {
  if (!isPlain(p) || !p.replyTo) return null;
  return isPlain(p.replyTo) ? canonicalStatusUrl(p.replyTo.url) : (str(p.replyToUrl) ? canonicalStatusUrl(p.replyToUrl) : null);
}

export function kindOf(p) {
  if (p?.kind === 'repost') return 'repost';
  if (p?.replyTo) return 'reply';
  return quotedUrlOf(p) ? 'quote' : 'original';
}

/** Link fields shared by find_posts rows and get_post. */
export function linkFieldsOf(p) {
  return { kind: kindOf(p), quotedUrl: quotedUrlOf(p), repostOfUrl: repostUrlOf(p), replyToUrl: replyToUrlOf(p), postedUrl: postedUrlOf(p) };
}

function dayOf(p) {
  const ms = Date.parse(p.scheduledAt || '');
  if (Number.isFinite(ms)) return ctDate(ms);
  return DAY_RE.test(String(p.reviewOn ?? '')) ? p.reviewOn : null;
}

function mediaSummary(p) {
  const hasMedia = !!(str(p.mediaUrl) || (isPlain(p.mediaVariants) && Object.keys(p.mediaVariants).length));
  return { hasMedia, type: hasMedia ? (str(p.mediaType) || (isPlain(p.mediaVariants?.video) ? 'video' : isPlain(p.mediaVariants?.image) ? 'image' : 'unknown')) : null };
}

/** One normalized row. `now` (ms) is used only for windowOpen. */
export function normalizePost(p, { now = Date.now() } = {}) {
  const links = linkFieldsOf(p);
  const exp = Date.parse(p.expiresAt || '');
  const isQuoteDraft = links.kind === 'quote' && !['posted', 'rejected'].includes(p.status);
  const ref = isPlain(p.sourceRef) ? p.sourceRef : {};
  return {
    id: str(p.id),
    status: str(p.status),
    ...links,
    day: dayOf(p),
    scheduledAt: str(p.scheduledAt),
    reviewOn: DAY_RE.test(String(p.reviewOn ?? '')) ? p.reviewOn : null,
    text: String(p.content ?? p.text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX),
    bucket: str(p.bucketId) || str(p.engine),
    track: str(ref.track) || str(ref.trackId),
    fillKind: str(p.fillKind),
    source: str(p.source),
    media: mediaSummary(p),
    needsStory: p.needsStory === true,
    expiresAt: str(p.expiresAt),
    windowOpen: isQuoteDraft && Number.isFinite(exp) ? exp > now : null,
    ...(hasMemoryPlaceholder(String(p.content ?? p.text ?? '')) ? { approveNote: 'approving removes the placeholder; it never blocks approval' } : {}),
  };
}

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim()).filter(Boolean);

/**
 * Filter + normalize. Filters: kind, status[], from/to (YYYY-MM-DD, inclusive; rows with no day never match a date
 * filter), bucket (bucket or track id), fillKind, hasMedia, needsStory, text (case-insensitive substring of the text
 * or any link), limit (<=50). Sorted by day (undated last) then id.
 * @returns {{total:number, returned:number, rows:object[]}}
 */
export function queryPosts(posts, filters = {}, { now = Date.now() } = {}) {
  const f = isPlain(filters) ? filters : {};
  const kind = POST_QUERY_KINDS.includes(f.kind) ? f.kind : 'any';
  const statuses = new Set(asList(f.status));
  const from = DAY_RE.test(String(f.from ?? '')) ? f.from : null;
  const to = DAY_RE.test(String(f.to ?? '')) ? f.to : null;
  const bucket = str(f.bucket) || str(f.track);
  const fillKind = str(f.fillKind);
  const needle = str(f.text)?.toLowerCase() ?? null;
  const limit = Math.min(FIND_POSTS_MAX, Math.max(1, Math.floor(Number(f.limit)) || 20));

  const rows = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!isPlain(p)) continue;
    const r = normalizePost(p, { now });
    if (kind !== 'any' && r.kind !== kind) continue;
    if (statuses.size && !statuses.has(r.status)) continue;
    if ((from || to) && !r.day) continue;
    if (from && r.day < from) continue;
    if (to && r.day > to) continue;
    if (bucket && r.bucket !== bucket && r.track !== bucket) continue;
    if (fillKind && r.fillKind !== fillKind) continue;
    if (typeof f.hasMedia === 'boolean' && r.media.hasMedia !== f.hasMedia) continue;
    if (typeof f.needsStory === 'boolean' && r.needsStory !== f.needsStory) continue;
    if (needle && !`${r.text} ${r.quotedUrl ?? ''} ${r.repostOfUrl ?? ''} ${r.replyToUrl ?? ''}`.toLowerCase().includes(needle)) continue;
    rows.push(r);
  }
  rows.sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999') || String(a.id).localeCompare(String(b.id)));
  return { total: rows.length, returned: Math.min(rows.length, limit), rows: rows.slice(0, limit) };
}

/** Counts per normalized kind over ALL posts (ignores filters). */
export function countByKind(posts, opts) {
  const out = { quote: 0, repost: 0, reply: 0, original: 0 };
  for (const p of Array.isArray(posts) ? posts : []) if (isPlain(p)) out[normalizePost(p, opts).kind] += 1;
  return out;
}
