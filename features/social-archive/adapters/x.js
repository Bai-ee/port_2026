// X (Twitter) archive adapter. Reads ONLY an allowlist of archive paths:
//   data/tweets.js, data/tweet.js, data/js/tweets/*.js, data/account.js,
//   and the listings of data/tweets_media | data/tweet_media.
// DMs, likes, ads, etc. are never opened. Pure given the reader. No eval/vm: JSON.parse only.
export const ADAPTER = 'x-archive';

const TWEET_FILES = ['data/tweets.js', 'data/tweet.js'];
const GRAILBIRD_DIR = 'data/js/tweets';
const MEDIA_DIRS = ['data/tweets_media', 'data/tweet_media'];
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function grailbirdFiles(reader) {
  return reader.list(GRAILBIRD_DIR).filter((n) => /\.js$/i.test(n)).sort().map((n) => `${GRAILBIRD_DIR}/${n}`);
}

export function detect(reader) {
  if (!reader) return false;
  if (TWEET_FILES.some((f) => reader.exists(f))) return true;
  return grailbirdFiles(reader).length > 0;
}

/** Strip `window.YTD.tweets.part0 = ` / `Grailbird.data.tweets_2018_10 = ` and JSON.parse the array. */
export function parseJsAssignment(src) {
  const text = String(src ?? '');
  const eq = text.indexOf('=');
  const start = text.indexOf('[', eq >= 0 ? eq : 0);
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('no JSON array found');
  const value = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error('not an array');
  return value;
}

/** "Wed Oct 10 20:19:24 +0000 2018" or "2018-10-10 20:19:24 +0000" -> ISO UTC, or null. */
export function parseTweetDate(s) {
  const v = String(s ?? '').trim();
  let m = v.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/);
  let parts;
  if (m && MONTHS[m[1]] !== undefined) parts = [+m[7], MONTHS[m[1]], +m[2], +m[3], +m[4], +m[5], m[6]];
  else {
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2}) ?(Z|[+-]\d{4})$/);
    if (!m) return null;
    parts = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] === 'Z' ? '+0000' : m[7]];
  }
  const [y, mo, d, h, mi, se, off] = parts;
  const sign = off[0] === '-' ? -1 : 1;
  const offMin = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5)));
  const ms = Date.UTC(y, mo, d, h, mi, se) - offMin * 60000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const decodeEntities = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function tweetText(t) {
  let text = String(t.full_text ?? t.text ?? '');
  const urls = Array.isArray(t.entities?.urls) ? t.entities.urls : [];
  for (const u of urls) {
    if (u?.url) text = text.split(u.url).join(u.expanded_url || u.url);
  }
  const mediaEnts = [...(t.extended_entities?.media || []), ...(t.entities?.media || [])];
  for (const m of mediaEnts) if (m?.url) text = text.split(m.url).join('');
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').trim();
}

function mediaIndex(reader) {
  const byId = new Map();
  for (const dir of MEDIA_DIRS) {
    for (const name of reader.list(dir)) {
      const i = name.indexOf('-');
      if (i <= 0) continue;
      const id = name.slice(0, i);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(`${dir}/${name}`);
    }
  }
  for (const list of byId.values()) list.sort();
  return byId;
}

const mediaType = (rel) => (/\.(mp4|mov|m4v|webm)$/i.test(rel) ? 'video' : 'image');

function readHandle(reader, warnings) {
  const src = reader.read('data/account.js');
  if (src == null) return '';
  try {
    const row = parseJsAssignment(src)[0]?.account;
    const h = String(row?.username || '').replace(/^@/, '');
    return /^[A-Za-z0-9_]{1,30}$/.test(h) ? h : '';
  } catch (e) {
    warnings.push(`data/account.js: ${e.message}`);
    return '';
  }
}

export function parse({ reader, account, archiveName } = {}) {
  const warnings = [];
  const skipped = {};
  const skip = (r) => { skipped[r] = (skipped[r] || 0) + 1; };
  const entries = [];
  const seen = new Set();
  const handle = readHandle(reader, warnings);
  const media = mediaIndex(reader);
  const files = [...TWEET_FILES.filter((f) => reader.exists(f)), ...grailbirdFiles(reader)];
  if (!files.length) warnings.push('no tweet files found');

  for (const file of files) {
    let rows;
    try {
      const src = reader.read(file);
      if (src == null) { warnings.push(`${file}: unreadable`); continue; }
      rows = parseJsAssignment(src);
    } catch (e) {
      warnings.push(`${file}: ${e.message}`);
      continue;
    }
    for (const row of rows) {
      const t = row && typeof row === 'object' ? (row.tweet && typeof row.tweet === 'object' ? row.tweet : row) : null;
      const id = t ? String(t.id_str ?? t.id ?? '') : '';
      if (!id) { skip('no-id'); continue; }
      if (seen.has(id)) { skip('duplicate'); continue; }
      const ts = parseTweetDate(t.created_at);
      if (!ts) { skip('bad-created-at'); continue; }
      seen.add(id);

      const raw = String(t.full_text ?? t.text ?? '');
      const isRetweet = raw.startsWith('RT @');
      const base = {
        platform: 'x', account, platformId: id, kind: 'post', ts,
        tsKind: 'posted', tsSource: 'x-tweets-js', tsConfidence: 'high',
        audience: 'public', media: [],
        source: { archive: archiveName, file },
      };
      if (handle) base.permalink = `https://x.com/${handle}/status/${id}`;
      if (isRetweet) {
        // Someone else's words: store nothing but the fact of the repost.
        entries.push({ ...base, text: '', relation: { type: 'repost' } });
        continue;
      }
      const entry = { ...base, text: tweetText(t) };
      if (t.lang && t.lang !== 'und') entry.lang = t.lang;
      const replyTo = t.in_reply_to_status_id_str || t.in_reply_to_status_id;
      const quoted = t.quoted_status_id_str || t.quoted_status_id;
      if (replyTo) entry.relation = { type: 'reply', targetId: String(replyTo) };
      else if (t.is_quote_status === true || quoted) entry.relation = { type: 'quote', ...(quoted ? { targetId: String(quoted) } : {}) };
      const likes = Number(t.favorite_count);
      const reposts = Number(t.retweet_count);
      const eng = {};
      if (Number.isFinite(likes)) eng.likes = likes;
      if (Number.isFinite(reposts)) eng.reposts = reposts;
      if (Object.keys(eng).length) entry.engagement = eng;
      entry.media = (media.get(id) || []).map((relPath) => ({ type: mediaType(relPath), relPath }));
      entries.push(entry);
    }
  }

  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.platformId < b.platformId ? -1 : 1));
  const byKind = {};
  let withMedia = 0;
  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    if (e.media.length) withMedia++;
  }
  return { entries, stats: { entries: entries.length, byKind, withMedia, skipped }, warnings };
}
