'use strict';

// scrapecreators-client.js — direct Node client for ScrapeCreators Reddit + Instagram.
//
// Prod-safe: runs natively on Vercel (plain HTTPS, no Python subprocess). This calls
// the SAME api.scrapecreators.com endpoints the last30days Python skill calls under
// the hood, so results are consistent — it just removes the local-only wrapper so
// Reddit/Instagram work identically in dev and production.
//
// Auth: SCRAPECREATORS_API_KEY (Vercel env). Dev fallback reads the last30days skill's
// ~/.config/last30days/.env so local dev works without duplicating the secret.
//
// Output: normalized signal items in the { title, url, summary, tag } shape scout-test
// uses (+ subreddit/author/engagement/publishedAt), so collectRedditSignals /
// collectInstagramSignals + the analyzers consume them unchanged.

const SC_BASE = 'https://api.scrapecreators.com';
const DEFAULT_TIMEOUT_MS = 20_000;

let _cachedKey; // resolve once per process
function getApiKey() {
  if (_cachedKey !== undefined) return _cachedKey;
  let key = process.env.SCRAPECREATORS_API_KEY || '';
  if (!key) {
    // Dev fallback — the skill stores the key in ~/.config/last30days/.env. In prod
    // the env var is set (Vercel), so this branch never runs there.
    try {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const envPath = path.join(process.env.LAST30DAYS_HOME || os.homedir(), '.config', 'last30days', '.env');
      const raw = fs.readFileSync(envPath, 'utf8');
      const m = raw.match(/^\s*SCRAPECREATORS_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) key = m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* no fallback available */ }
  }
  _cachedKey = key;
  return key;
}

function hasApiKey() {
  return Boolean(getApiKey());
}

async function scGet(endpoint, params) {
  const key = getApiKey();
  if (!key) return { ok: false, status: 0, error: 'SCRAPECREATORS_API_KEY not set', data: null };
  const qs = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v != null && v !== '')
  ).toString();
  const url = `${SC_BASE}${endpoint}${qs ? `?${qs}` : ''}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'x-api-key': key, 'User-Agent': 'HitloopScout/1.0' }, signal: controller.signal });
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 160); } catch { /* ignore */ }
      return { ok: false, status: res.status, error: `ScrapeCreators ${res.status}${res.status === 402 ? ' (out of credits)' : ''}${body ? `: ${body}` : ''}`, data: null };
    }
    return { ok: true, status: 200, data: await res.json() };
  } catch (err) {
    return { ok: false, status: 0, error: err.name === 'AbortError' ? 'ScrapeCreators request timed out' : err.message, data: null };
  } finally {
    clearTimeout(t);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const str = (v) => String(v == null ? '' : v).trim();
const firstLine = (v, n = 90) => { const s = str(v).replace(/\s+/g, ' '); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
// Epoch (seconds) → ISO, guarded: bad/non-numeric timestamps return null instead of throwing.
function epochToIso(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function subredditName(v) {
  if (v && typeof v === 'object') return str(v.name || v.display_name || v.title || '');
  return str(v).replace(/^\/?r\//i, '');
}
function ownerName(v) {
  if (v && typeof v === 'object') return str(v.username || v.handle || v.name || '');
  return str(v);
}
function dedupeByUrl(items, limit) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = (it.url || `${it.title}|${it.summary}`).toLowerCase();
    if (!k.trim() || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Reddit ─────────────────────────────────────────────────────────────────
function normalizeRedditPost(post) {
  const permalink = str(post.permalink);
  let url = permalink ? `https://www.reddit.com${permalink}` : str(post.url);
  if (url && !/reddit\.com/i.test(url)) url = '';
  const sub = subredditName(post.subreddit);
  const published = post.created_at || epochToIso(post.created_utc);
  return {
    title: str(post.title) || 'Reddit thread',
    url,
    summary: str(post.selftext).slice(0, 400),
    tag: sub || 'reddit',
    subreddit: sub,
    signalType: 'search',
    author: str(post.author),
    engagement: { score: post.score ?? post.ups ?? post.votes ?? 0, comments: post.num_comments ?? 0 },
    publishedAt: published || null,
    source: 'scrapecreators-reddit',
  };
}

/** Search Reddit for a set of queries (each = 1 credit). Merged + deduped. */
async function searchReddit({ queries = [], limit = 12, timeframe = 'month', sort = 'relevance', maxQueries = 4 } = {}) {
  const terms = [...new Set((Array.isArray(queries) ? queries : []).map(str).filter((q) => q.replace(/[^a-z0-9]/gi, '').length >= 2))].slice(0, maxQueries);
  if (!terms.length) return { ok: false, items: [], error: 'no reddit queries', meta: { source: 'ScrapeCreators (Reddit)' } };
  const collected = [];
  const errors = [];
  for (const query of terms) {
    // eslint-disable-next-line no-await-in-loop
    const r = await scGet('/v1/reddit/search', { query, sort, timeframe });
    if (!r.ok) { errors.push(r.error); continue; }
    const posts = (r.data && (r.data.posts || r.data.data)) || [];
    for (const p of posts) collected.push(normalizeRedditPost(p));
  }
  const items = dedupeByUrl(collected.filter((it) => it.title), limit);
  if (!items.length && errors.length) return { ok: false, items: [], error: errors[0], meta: { source: 'ScrapeCreators (Reddit)', queriesTried: terms } };
  return { ok: true, items, meta: { source: 'ScrapeCreators (Reddit)', queriesTried: terms, warnings: errors } };
}

// ─── Instagram ────────────────────────────────────────────────────────────────
function normalizeReel(raw) {
  const capObj = raw.caption;
  const text = (capObj && typeof capObj === 'object') ? str(capObj.text) : (str(capObj) || str(raw.desc) || str(raw.text));
  const shortcode = str(raw.shortcode || raw.code);
  let url = str(raw.url);
  if (!url && shortcode) url = `https://www.instagram.com/reel/${shortcode}`;
  const author = ownerName(raw.owner || raw.user);
  return {
    title: firstLine(text) || (author ? `@${author} reel` : 'Instagram reel'),
    url,
    summary: text.slice(0, 400),
    tag: author ? `@${author}` : 'instagram',
    subreddit: author ? `@${author}` : 'instagram', // render-compat: analyzer/schema uses `subreddit` as the account label
    signalType: 'search',
    author,
    engagement: { views: raw.video_play_count || raw.video_view_count || raw.play_count || 0, likes: raw.like_count || 0, comments: raw.comment_count || 0 },
    publishedAt: epochToIso(raw.taken_at) || (raw.date || null),
    source: 'scrapecreators-instagram',
  };
}

/** Search Instagram: topic queries (reels/search) + watched creator reels. Merged + deduped. */
async function searchInstagram({ queries = [], creators = [], limit = 12, maxQueries = 2, maxCreators = 6 } = {}) {
  const terms = [...new Set((Array.isArray(queries) ? queries : []).map(str).filter((q) => q.replace(/[^a-z0-9]/gi, '').length >= 2))].slice(0, maxQueries);
  const handles = [...new Set((Array.isArray(creators) ? creators : []).map((h) => str(h).replace(/^@+/, '')).filter((h) => h.length >= 2))].slice(0, maxCreators);
  if (!terms.length && !handles.length) return { ok: false, items: [], error: 'no instagram queries or creators', meta: { source: 'ScrapeCreators (Instagram)' } };
  const collected = [];
  const errors = [];
  for (const query of terms) {
    // eslint-disable-next-line no-await-in-loop
    const r = await scGet('/v2/instagram/reels/search', { query });
    if (!r.ok) { errors.push(r.error); continue; }
    const reels = (r.data && (r.data.reels || r.data.items || r.data.data)) || [];
    for (const reel of reels) collected.push(normalizeReel(reel));
  }
  for (const handle of handles) {
    // eslint-disable-next-line no-await-in-loop
    const r = await scGet('/v1/instagram/user/reels', { handle });
    if (!r.ok) { errors.push(r.error); continue; }
    const reels = (r.data && (r.data.items || r.data.reels || r.data.data)) || [];
    for (const reel of reels) collected.push(normalizeReel(reel));
  }
  const items = dedupeByUrl(collected.filter((it) => it.title), limit);
  if (!items.length && errors.length) return { ok: false, items: [], error: errors[0], meta: { source: 'ScrapeCreators (Instagram)', queriesTried: terms, creators: handles } };
  return { ok: true, items, meta: { source: 'ScrapeCreators (Instagram)', queriesTried: terms, creators: handles, warnings: errors } };
}

module.exports = { searchReddit, searchInstagram, hasApiKey };
