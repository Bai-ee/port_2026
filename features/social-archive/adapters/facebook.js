// Facebook HTML export adapter (Page or personal). See ../CONTRACT.md.
//
// Reads ONLY an allowlist: posts/*posts*.html, photos_and_videos/album/*.html, events/events.html.
// DMs, ads, comments, device data and every other folder are never opened.
// The HTML is class-obfuscated, so parsing is structural: the export wraps each item in a
// `uiBoxWhite` block, the item's own timestamp is the last date-only <div> in the block, and
// media are local `photos_and_videos/...` paths (data: URIs and CDN thumbnails are ignored).
import { createHash } from 'node:crypto';

export const ADAPTER = 'facebook-html';
export const DEFAULT_TZ = 'America/Chicago';

const TS_SOURCE = { post: 'facebook-posts-html', album: 'facebook-album-html', event: 'facebook-events-html' };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const DATE_SRC = `${MONTH_RE} \\d{1,2}, \\d{4}(?:,| at)? \\d{1,2}:\\d{2}\\s*[AP]M`;
const DATE_ONLY_DIV_RE = new RegExp(`<div[^>]*>\\s*(?:<a [^>]*>)?\\s*(${DATE_SRC})\\s*(?:</a>)?\\s*</div>`, 'gi');
const DATE_RE = new RegExp(DATE_SRC, 'i');
const BLOCK_RE = /<div class="[^"]*\buiBoxWhite\b[^"]*">/g;
const MEDIA_EXT_RE = /\.(jpe?g|png|gif|webp|heic|mp4|mov|m4v|webm)$/i;

// ---------- small helpers ----------

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export function unescapeHtml(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch { return m; }
  });
}

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** Wall-clock time in `tz` -> ISO UTC string (DST-aware, no dependency). */
export function zonedToUtcIso({ y, mo, d, h, mi }, tz = DEFAULT_TZ) {
  const wall = Date.UTC(y, mo, d, h, mi, 0);
  let utc = wall - tzOffsetMs(wall, tz);
  const off2 = tzOffsetMs(utc, tz);
  utc = wall - off2;
  return new Date(utc).toISOString();
}

/** 'Apr 18, 2018, 11:47 AM' -> ISO UTC (assumes `tz`), or null. */
export function parseFbDate(str, tz = DEFAULT_TZ) {
  const m = String(str || '').match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})(?:,| at)? (\d{1,2}):(\d{2})\s*([AP])M/i);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo === undefined) return null;
  let h = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'P') h += 12;
  try { return zonedToUtcIso({ y: Number(m[3]), mo, d: Number(m[2]), h, mi: Number(m[5]) }, tz); } catch { return null; }
}

function htmlToLines(html) {
  const text = unescapeHtml(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|p|tr|li|table|h\d)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  ).replace(/\r/g, '');
  return text.split('\n').map((l) => l.replace(/[ \t  ]+/g, ' ').trim());
}

const cleanMentions = (s) => s.replace(/@\[\d+:\d+:((?:\\.|[^\]\\])*)\]/g, (_, n) => n.replace(/\\(.)/g, '$1'));

function joinLines(lines) {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const COORDS_RE = /\s*\(-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\)\s*$/;

/**
 * Facebook appends check-in/tag lines ("You tagged …", "Place: …", "Address: …")
 * to a post body. They are metadata, not the owner's words: move them to
 * `place` / `peopleTagged` so `text` (voice, Posted copy) is only what was written.
 */
export function splitFbMeta(lines) {
  const kept = [];
  let place = '';
  const peopleTagged = [];
  for (const l of lines) {
    const tagged = /^You tagged (.+)$/i.exec(l);
    if (tagged) {
      for (const n of cleanMentions(tagged[1]).split(/,\s*|\s+and\s+/)) if (n.trim()) peopleTagged.push(n.trim());
      continue;
    }
    if (/^Place:/i.test(l)) { place = place || l.replace(/^Place:\s*/i, '').replace(COORDS_RE, '').trim(); continue; }
    if (/^Address:/i.test(l)) continue;
    kept.push(l);
  }
  return { lines: kept, place, peopleTagged };
}

const metaFields = ({ place, peopleTagged }) => ({
  ...(place ? { place } : {}),
  ...(peopleTagged.length ? { peopleTagged } : {}),
});

function splitBlocks(html) {
  const marks = [...html.matchAll(BLOCK_RE)];
  return marks.map((m, i) => html.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : html.length));
}

/** Items's own timestamp = the last date-only <div>. Returns { dateStr, index } or null. */
function lastDateDiv(block) {
  let last = null;
  for (const m of block.matchAll(DATE_ONLY_DIV_RE)) last = { dateStr: m[1], index: m.index };
  return last;
}

function splitTitle(block) {
  const m = block.match(/^\s*<div class="[^"]*">([^<]*)<\/div>(?=\s*<div)/);
  return m ? { title: unescapeHtml(m[1]).trim(), rest: block.slice(m[0].length) } : { title: '', rest: block };
}

function extractMedia(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const raw = unescapeHtml(m[1]).trim();
    if (!raw.startsWith('photos_and_videos/') || raw.startsWith('photos_and_videos/thumbnails/')) continue;
    if (raw.split('/').includes('..') || !MEDIA_EXT_RE.test(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push({ type: /\.(mp4|mov|m4v|webm)$/i.test(raw) ? 'video' : 'image', relPath: raw });
  }
  return out;
}

const dayKey = (iso) => iso.slice(0, 10);

// ---------- adapter ----------

const htmlFiles = (reader, dir, re = /\.html?$/i) => reader.list(dir).filter((n) => re.test(n)).sort();

export function detect(reader) {
  if (!reader) return false;
  if (reader.exists('your_instagram_activity') || reader.exists('content') || reader.exists('data')) return false;
  return htmlFiles(reader, 'posts', /posts[^/]*\.html?$/i).length > 0
    || htmlFiles(reader, 'photos_and_videos/album').length > 0
    || reader.exists('events/events.html');
}

export function parse({ reader, account, archiveName, tz = DEFAULT_TZ } = {}) {
  const entries = [];
  const warnings = [];
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const ids = new Set();
  const push = (e) => {
    if (ids.has(e.platformId)) { skip('duplicate-platformId'); return; }
    ids.add(e.platformId);
    entries.push(e);
  };
  const isPage = reader.exists('page_profile_information');
  const audience = isPage ? 'public' : 'unknown';
  const tsConfidence = tz === 'UTC' ? 'high' : 'medium';
  const base = { platform: 'facebook', account, audience, tsConfidence, source: { archive: archiveName } };
  const toIso = (s) => parseFbDate(s, tz);

  // --- posts ---
  const postFiles = htmlFiles(reader, 'posts', /posts[^/]*\.html?$/i);
  if (!postFiles.length) warnings.push('no posts/*posts*.html found');
  const postMediaDays = new Set();
  for (const f of postFiles) {
    const file = `posts/${f}`;
    const html = reader.read(file);
    if (html == null) { warnings.push(`unreadable: ${file}`); continue; }
    for (const block of splitBlocks(html)) {
      const dt = lastDateDiv(block);
      const ts = dt && toIso(dt.dateStr);
      if (!ts) { skip('post-no-timestamp'); continue; }
      const { rest } = splitTitle(block.slice(0, dt.index));
      const media = extractMedia(rest);
      const body = rest.replace(/<table[\s\S]*?<\/table>/gi, '').replace(/<video[\s\S]*?<\/video>/gi, '');
      const lines = htmlToLines(body)
        .filter((l) => !/^Updated /.test(l) || !DATE_RE.test(l))
        .filter((l) => !/^Upload IP Address/i.test(l));
      // platformId hashes the RAW text so ids stay stable across adapter changes.
      const rawText = cleanMentions(joinLines(lines));
      const meta = splitFbMeta(lines);
      const text = cleanMentions(joinLines(meta.lines));
      if (!rawText && !media.length) { skip('post-empty'); continue; }
      push({
        ...base, kind: 'post', ts, tsKind: 'posted', tsSource: TS_SOURCE.post, text, media, ...metaFields(meta),
        platformId: `post:${sha1(`${ts}|${rawText.slice(0, 80)}|${media[0]?.relPath || ''}`)}`,
        source: { archive: archiveName, file },
      });
      for (const m of media) postMediaDays.add(`${m.relPath}|${dayKey(ts)}`);
    }
  }

  // --- albums ---
  for (const f of htmlFiles(reader, 'photos_and_videos/album')) {
    const file = `photos_and_videos/album/${f}`;
    const html = reader.read(file);
    if (html == null) { warnings.push(`unreadable: ${file}`); continue; }
    const headerTitle = (html.match(/<div class="_3b0d">([^<]*)<\/div>/) || [])[1];
    for (const block of splitBlocks(html)) {
      const dt = lastDateDiv(block);
      const ts = dt && toIso(dt.dateStr);
      if (!ts) { skip('album-no-timestamp'); continue; }
      const { title, rest } = splitTitle(block.slice(0, dt.index));
      const media = extractMedia(rest).slice(0, 1);
      if (!media.length) { skip('album-no-media'); continue; }
      if (postMediaDays.has(`${media[0].relPath}|${dayKey(ts)}`)) { skip('album-photo-carried-by-post'); continue; }
      const meta = splitFbMeta(htmlToLines(rest.replace(/<table[\s\S]*?<\/table>/gi, '').replace(/<video[\s\S]*?<\/video>/gi, ''))
        .filter((l) => !/^Upload IP Address/i.test(l)));
      const caption = cleanMentions(joinLines(meta.lines));
      const album = unescapeHtml(title || headerTitle || '').trim();
      push({
        ...base, kind: 'media', ts, tsKind: 'posted', tsSource: TS_SOURCE.album, text: caption, media, ...metaFields(meta),
        ...(album ? { album } : {}),
        platformId: `album:${f}:${media[0].relPath}`,
        source: { archive: archiveName, file },
      });
    }
  }

  // --- events ---
  const evFile = 'events/events.html';
  const evHtml = reader.read(evFile);
  if (evHtml == null) warnings.push(`missing: ${evFile}`);
  else {
    for (const block of splitBlocks(evHtml)) {
      const footer = lastDateDiv(block); // the event's creation time, never its start
      const lines = htmlToLines((footer ? block.slice(0, footer.index) : block).replace(/<table[\s\S]*?<\/table>/gi, ''));
      const placeLine = lines.find((l) => /^Place:/i.test(l));
      const dateIdx = lines.findIndex((l) => DATE_RE.test(l) && /^(?:From |Starts? )?[A-Za-z]{3}/.test(l) && l.length < 120);
      if (!placeLine && dateIdx < 0) { skip('event-not-an-event'); continue; }
      const ts = dateIdx >= 0 ? toIso(lines[dateIdx]) : null;
      if (!ts) { skip('event-no-start'); continue; }
      const place = placeLine
        ? placeLine.replace(/^Place:\s*/i, '').replace(/\s*\(-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\)\s*$/, '').trim()
        : '';
      const desc = lines.slice(dateIdx + 1);
      const nameLine = desc.find((l) => /[\p{L}\p{N}]/u.test(l) && !/^[-=_\s]+$/.test(l));
      const name = nameLine ? nameLine.replace(/^[/\s•|-]+|[/\s•|-]+$/g, '').slice(0, 120) : '';
      const text = cleanMentions(joinLines(desc));
      push({
        ...base, kind: 'event', ts, tsKind: 'event', tsSource: TS_SOURCE.event, text, media: [],
        ...(place ? { place } : {}),
        platformId: `event:${sha1(`${ts}|${place}|${name}`)}`,
        source: { archive: archiveName, file: evFile },
      });
    }
  }

  const byKind = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  return {
    entries,
    stats: { entries: entries.length, byKind, withMedia: entries.filter((e) => e.media.length).length, skipped },
    warnings,
  };
}
