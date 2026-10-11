// Instagram export adapter (JSON flavor + Meta HTML flavor). Allowlist only:
//  JSON: posts_N.json, stories.json, reels.json (under content/ or your_instagram_activity/media/) + legacy root media.json.
//  HTML: your_instagram_activity/media/{posts_N,posts,stories,reels,reposts,archived_posts,igtv_videos,profile_photos,other_content}.html
//        + your_instagram_activity/events/your_events.html.
// Messages, comments, likes, saved, ads, connections, followers are never opened. Pure given the reader.
// HTML times carry no timezone: they are converted from `tz` (default America/Chicago, like the Facebook adapter)
// and marked tsConfidence 'medium' (pass tz:'UTC' for 'high').
import { createHash } from 'node:crypto';
import { parseFbDate, unescapeHtml, DEFAULT_TZ } from './facebook.js';

export const ADAPTER = 'instagram';

const DIRS = ['content', 'your_instagram_activity/media'];
const LEGACY = 'media.json';

/**
 * Repair UTF-8 bytes that were decoded as latin-1 ("â\u0080\u0099" -> "’").
 * Only changes the string when every char is <= 0xFF AND the bytes are valid UTF-8; else returns it unchanged.
 */
export function fixMojibake(s) {
  if (typeof s !== 'string' || !/[\u0080-ÿ]/.test(s)) return s;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return s;
  try {
    const bytes = Buffer.from(s, 'latin1');
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Buffer.from(fixed, 'utf8').equals(bytes) ? fixed : s;
  } catch {
    return s;
  }
}

function postFiles(reader) {
  const out = [];
  for (const d of DIRS) {
    for (const n of reader.list(d)) if (/^posts_\d+\.json$/i.test(n)) out.push(`${d}/${n}`);
  }
  return out.sort();
}
const named = (reader, name) => DIRS.map((d) => `${d}/${name}`).filter((f) => reader.exists(f));

const HTML_DIR = 'your_instagram_activity/media';
const EVENTS_FILE = 'your_instagram_activity/events/your_events.html';
const HTML_PAGES = [
  // [file regex or name, kind, tsSource, audience, form]
  { re: /^posts_\d+\.html$/i, kind: 'post', src: 'instagram-posts-html', audience: 'public', form: 'flat' },
  { re: /^posts\.html$/i, kind: 'post', src: 'instagram-posts-html', audience: 'public', form: 'table' },
  { re: /^archived_posts\.html$/i, kind: 'post', src: 'instagram-archived-posts-html', audience: 'public', form: 'flat' },
  { re: /^stories\.html$/i, kind: 'story', src: 'instagram-stories-html', audience: 'unknown', form: 'flat' },
  { re: /^reels\.html$/i, kind: 'reel', src: 'instagram-reels-html', audience: 'public', form: 'flat' },
  { re: /^igtv_videos\.html$/i, kind: 'post', src: 'instagram-igtv-html', audience: 'public', form: 'flat' },
  { re: /^profile_photos\.html$/i, kind: 'media', src: 'instagram-profile-photos-html', audience: 'public', form: 'flat' },
  { re: /^other_content\.html$/i, kind: 'post', src: 'instagram-other-content-html', audience: 'public', form: 'table' },
  { re: /^reposts\.html$/i, kind: 'post', src: 'instagram-reposts-html', audience: 'public', form: 'repost' },
];
const htmlFiles = (reader) => {
  const names = reader.list(HTML_DIR);
  const out = [];
  for (const spec of HTML_PAGES) for (const n of names.filter((x) => spec.re.test(x)).sort()) out.push({ ...spec, file: `${HTML_DIR}/${n}` });
  return out;
};
const hasHtml = (reader) => reader.exists(`${HTML_DIR}/posts_1.html`) || reader.exists(`${HTML_DIR}/stories.html`) || reader.exists(`${HTML_DIR}/reels.html`);

export function detect(reader) {
  if (!reader) return false;
  if (hasHtml(reader)) return true;
  if (postFiles(reader).length) return true;
  if (named(reader, 'stories.json').length || named(reader, 'reels.json').length) return true;
  return reader.exists(LEGACY) && /"(photos|videos|stories)"/.test((reader.read(LEGACY) || '').slice(0, 4000));
}

const isoFromSeconds = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString() : null;
};

/** EXIF "2018:09:03 12:34:56" (no zone; read as UTC literal) or ISO -> ISO, else null. */
function exifIso(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function mediaItem(m) {
  const relPath = String(m?.uri ?? m?.path ?? '');
  if (!relPath) return null;
  const item = { type: /\.(mp4|mov|m4v|webm)$/i.test(relPath) ? 'video' : 'image', relPath };
  const meta = m.media_metadata || {};
  const exif = [...(meta.photo_metadata?.exif_data || []), ...(meta.video_metadata?.exif_data || [])];
  for (const x of exif) {
    const t = exifIso(x?.date_time_original);
    if (t) { item.takenAt = t; break; }
  }
  return item;
}

/** Build one entry from a `{media:[…], title?, creation_timestamp?}` block. */
function fromBlock(block, ctx) {
  const items = Array.isArray(block?.media) ? block.media : block && block.uri ? [block] : [];
  const ts = isoFromSeconds(block?.creation_timestamp) || isoFromSeconds(items.find((m) => m?.creation_timestamp)?.creation_timestamp);
  if (!ts) return { skip: 'no-timestamp' };
  const media = items.map(mediaItem).filter(Boolean);
  const caption = fixMojibake(String(block.title || items.find((m) => m?.title)?.title || '')).trim();
  if (!media.length && !caption) return { skip: 'empty' };
  const seconds = block.creation_timestamp ?? items.find((m) => m?.creation_timestamp)?.creation_timestamp;
  return {
    entry: {
      platform: 'instagram', account: ctx.account, platformId: `${seconds}:${media[0]?.relPath || ''}`,
      kind: ctx.kind, ts, tsKind: 'posted', tsSource: ctx.tsSource, tsConfidence: 'high',
      text: caption, media, audience: ctx.audience,
      source: { archive: ctx.archiveName, file: ctx.file },
    },
  };
}


// ---------- HTML flavor ----------

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const BOX_RE = /\buiBoxWhite\b/;
const FOOTER_RE = /<div class="[^"]*\b_a6-o\b[^"]*">([^<]*)<\/div>/g;
const MEDIA_SRC_RE = /<(?:img|video)\b[^>]*?\bsrc="([^"]+)"/gi;
const IG_URL_RE = /href="(https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?[^"]*)"/i;

/** Top-level `uiBoxWhite` blocks directly under <main>, as inner HTML strings. */
function topBlocks(html) {
  const start = html.indexOf('<main');
  const src = start >= 0 ? html.slice(start) : html;
  const out = [];
  const re = /<div\b[^>]*>|<\/div>/g;
  let depth = 0;
  let from = -1;
  let m;
  while ((m = re.exec(src))) {
    if (m[0] === '</div>') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && from >= 0) { out.push(src.slice(from, m.index)); from = -1; }
    } else {
      if (depth === 0) { if (!BOX_RE.test(m[0])) continue; from = m.index + m[0].length; }
      depth++;
    }
  }
  return out;
}

const textOf = (frag) => unescapeHtml(String(frag || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\r/g, '').trim();

/** Last footer date string of a block (the item's own timestamp), or ''. */
function footerDate(block) {
  let last = '';
  for (const m of block.matchAll(FOOTER_RE)) last = m[1];
  return unescapeHtml(last).trim();
}

function mediaSrcs(block) {
  const seen = new Set();
  const out = [];
  for (const m of block.matchAll(MEDIA_SRC_RE)) {
    const rel = unescapeHtml(m[1]).trim();
    if (!rel || /^(data:|https?:|\/\/)/i.test(rel) || seen.has(rel)) continue;
    seen.add(rel);
    out.push({ type: /\.(mp4|mov|m4v|webm)$/i.test(rel) ? 'video' : 'image', relPath: rel });
  }
  return out;
}

/** `<div class="_a6-q">Label</div><div><div class="_a6-q">Value</div></div>` pairs, first occurrence wins. */
function pairLabels(block) {
  const out = {};
  for (const m of block.matchAll(/<div class="_a6-q">([^<]{1,60})<\/div><div>\s*<div class="_a6-q">([\s\S]*?)<\/div>/g)) {
    const k = unescapeHtml(m[1]).trim();
    if (k && !(k in out)) out[k] = textOf(m[2]);
  }
  return out;
}

/** `<td class="_a6_q">Label</td><td class="_2piu _a6_r">Value</td>` rows, first occurrence wins. */
function rowLabels(block) {
  const out = {};
  for (const m of block.matchAll(/<td class="_a6_q">([^<]{1,60})<\/td><td class="[^"]*_a6_r">([\s\S]*?)<\/td>/g)) {
    const k = unescapeHtml(m[1]).trim();
    if (k && !(k in out)) out[k] = textOf(m[2]);
  }
  return out;
}

const taggedNames = (v) => String(v || '').split(/,\s*(?=[^,()]+\s*\()/).map((x) => x.replace(/\s*\(.*$/, '').trim()).filter(Boolean);

/** One block -> html item { title, date, media, labels, tagged } (no timezone applied yet). */
function readBlock(block, form) {
  const inner = block.replace(/^\s+/, '');
  let title = '';
  let own = block;
  if (form === 'flat') {
    const h = inner.match(/^<h2\b[^>]*>([\s\S]*?)<\/h2>/);
    title = h ? textOf(h[1]) : '';
  } else {
    // table form: the item's own rows come before the first nested <h2> (Media / Hashtags / Owner sub-boxes).
    const cut = block.search(/<h2\b/);
    own = cut >= 0 ? block.slice(0, cut) : block;
    title = rowLabels(own).Caption || '';
  }
  const labels = { ...rowLabels(own), ...pairLabels(block) };
  return { title, date: footerDate(block), media: mediaSrcs(block), labels, tagged: taggedNames(labels['Tagged users']) };
}

function htmlMediaEntry(item, spec, ctx) {
  const ts = parseFbDate(item.date, ctx.tz);
  if (!ts) return { skip: 'no-timestamp' };
  const text = fixMojibake(item.title).trim();
  if (!item.media.length && !text) return { skip: 'empty' };
  const place = fixMojibake(item.labels.Location || item.labels.Place || '').trim();
  const album = fixMojibake(item.labels.Album || '').trim();
  const platformId = item.media.length
    ? `html:${spec.kind}:${item.media[0].relPath}`
    : `html:${spec.kind}:${item.date}:${sha1(text).slice(0, 10)}`;
  return {
    mediaKey: item.media.map((m) => m.relPath),
    entry: {
      platform: 'instagram', account: ctx.account, platformId,
      kind: spec.kind, ts, tsKind: 'posted', tsSource: spec.src, tsConfidence: ctx.confidence,
      text, media: item.media, audience: spec.audience,
      ...(item.tagged.length ? { peopleTagged: item.tagged } : {}),
      ...(place ? { place } : {}),
      ...(album ? { album } : {}),
      source: { archive: ctx.archiveName, file: spec.file },
    },
  };
}

/** Reposts: only the pointer to someone else's post and the repost time. NEVER their words. */
function htmlRepostEntry(block, spec, ctx) {
  const ts = parseFbDate(footerDate(block), ctx.tz);
  if (!ts) return { skip: 'no-timestamp' };
  const u = block.match(IG_URL_RE);
  const url = u ? unescapeHtml(u[1]) : '';
  const shortcode = u ? u[2] : '';
  return {
    entry: {
      platform: 'instagram', account: ctx.account,
      platformId: `html:repost:${shortcode || `${footerDate(block)}:${sha1(block).slice(0, 10)}`}`,
      kind: 'post', ts, tsKind: 'posted', tsSource: spec.src, tsConfidence: ctx.confidence,
      text: '', media: [], audience: spec.audience,
      relation: { type: 'repost', ...(shortcode ? { targetId: shortcode } : {}) },
      ...(url ? { permalink: url } : {}),
      source: { archive: ctx.archiveName, file: spec.file },
    },
  };
}

function htmlEventEntry(block, ctx) {
  const labels = rowLabels(block);
  const name = fixMojibake(labels['Event Name'] || '').trim();
  const start = parseFbDate(labels['Start Time'], ctx.tz);
  if (!name) return { skip: 'empty' };
  if (!start) return { skip: 'no-timestamp' };
  const desc = fixMojibake(labels.Description || '').trim();
  return {
    entry: {
      platform: 'instagram', account: ctx.account, platformId: `html:event:${labels['Start Time']}:${sha1(name).slice(0, 10)}`,
      kind: 'event', ts: start, tsKind: 'event', tsSource: 'instagram-events-html', tsConfidence: ctx.confidence,
      text: desc ? `${name}\n${desc}` : name, media: [], audience: 'public',
      source: { archive: ctx.archiveName, file: EVENTS_FILE },
    },
  };
}

const asList = (data, key) => (Array.isArray(data) ? data : Array.isArray(data?.[key]) ? data[key] : []);

export function parse({ reader, account, archiveName, tz = DEFAULT_TZ } = {}) {
  const warnings = [];
  const skipped = {};
  const skip = (r) => { skipped[r] = (skipped[r] || 0) + 1; };
  const entries = [];
  const seen = new Set();
  let mediaMissing = 0;
  const mediaDirPresent = reader.isDir('media');
  const seenMedia = new Set();

  const push = (r) => {
    if (r.skip) return skip(r.skip);
    const e = r.entry;
    const key = `${e.kind}|${e.platformId}`;
    if (seen.has(key)) return skip('duplicate');
    seen.add(key);
    for (const m of e.media) if (!mediaDirPresent || !reader.exists(m.relPath)) mediaMissing++;
    entries.push(e);
  };
  const load = (file) => {
    const src = reader.read(file);
    if (src == null) { warnings.push(`${file}: unreadable`); return null; }
    try { return JSON.parse(src); } catch (e) { warnings.push(`${file}: bad JSON (${e.message})`); return null; }
  };
  const base = (file, kind, tsSource, audience) => ({ account, archiveName, file, kind, tsSource, audience });

  for (const file of postFiles(reader)) {
    const data = load(file);
    if (data == null) continue;
    for (const b of asList(data, 'posts')) push(fromBlock(b, base(file, 'post', 'instagram-posts-json', 'public')));
  }
  for (const file of named(reader, 'stories.json')) {
    const data = load(file);
    if (data == null) continue;
    for (const s of asList(data, 'ig_stories')) push(fromBlock(s, base(file, 'story', 'instagram-stories-json', 'unknown')));
  }
  for (const file of named(reader, 'reels.json')) {
    const data = load(file);
    if (data == null) continue;
    for (const r of asList(data, 'ig_reels_media')) push(fromBlock(r, base(file, 'reel', 'instagram-reels-json', 'public')));
  }
  if (reader.exists(LEGACY)) {
    const data = load(LEGACY);
    if (data && typeof data === 'object') {
      const legacy = [['photos', 'post', 'instagram-media-json', 'public'], ['videos', 'post', 'instagram-media-json', 'public'], ['stories', 'story', 'instagram-media-json', 'unknown']];
      for (const [key, kind, tsSource, audience] of legacy) {
        for (const it of Array.isArray(data[key]) ? data[key] : []) {
          const ms = Date.parse(it?.taken_at || '');
          if (!it?.path || !Number.isFinite(ms)) { skip(it?.path ? 'no-timestamp' : 'empty'); continue; }
          const ts = new Date(ms).toISOString();
          const relPath = String(it.path);
          push({
            entry: {
              platform: 'instagram', account, platformId: `${Math.floor(ms / 1000)}:${relPath}`,
              kind, ts, tsKind: 'posted', tsSource, tsConfidence: 'high',
              text: fixMojibake(String(it.caption || '')).trim(),
              media: [{ type: key === 'videos' || /\.(mp4|mov|m4v|webm)$/i.test(relPath) ? 'video' : 'image', relPath }],
              audience, source: { archive: archiveName, file: LEGACY },
            },
          });
        }
      }
    }
  }

  // ---- HTML flavor ----
  const confidence = tz === 'UTC' ? 'high' : 'medium';
  const hctx = { account, archiveName, tz, confidence };
  const htmlPages = {};
  for (const spec of htmlFiles(reader)) {
    const src = reader.read(spec.file);
    if (src == null) { warnings.push(`${spec.file}: unreadable`); continue; }
    const blocks = topBlocks(src);
    htmlPages[spec.file] = blocks.length;
    for (const block of blocks) {
      if (spec.form === 'repost') { push(htmlRepostEntry(block, spec, hctx)); continue; }
      const r = htmlMediaEntry(readBlock(block, spec.form), spec, hctx);
      // The same item can appear in several pages (posts_1 / posts / archived): first page wins, matched by media.
      if (r.entry && spec.kind === 'post' && r.mediaKey.length) {
        if (r.mediaKey.some((k) => seenMedia.has(k))) { skip('duplicate'); continue; }
        for (const k of r.mediaKey) seenMedia.add(k);
      }
      push(r);
    }
  }
  if (reader.exists(EVENTS_FILE)) {
    const src = reader.read(EVENTS_FILE);
    if (src == null) warnings.push(`${EVENTS_FILE}: unreadable`);
    else {
      const blocks = topBlocks(src);
      htmlPages[EVENTS_FILE] = blocks.length;
      for (const block of blocks) push(htmlEventEntry(block, hctx));
    }
  }
  if (Object.keys(htmlPages).length && tz !== 'UTC') warnings.push(`HTML timestamps have no timezone; assumed ${tz} (tsConfidence medium)`);
  if (!entries.length && !warnings.length) warnings.push('no Instagram content files found');

  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.kind + a.platformId < b.kind + b.platformId ? -1 : 1));
  const byKind = {};
  let withMedia = 0;
  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    if (e.media.length) withMedia++;
  }
  return { entries, stats: { entries: entries.length, byKind, withMedia, skipped, mediaMissing, ...(Object.keys(htmlPages).length ? { htmlPages } : {}) }, warnings };
}
