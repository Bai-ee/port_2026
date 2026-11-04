// copy-format.js — THE post copy for a library item, every client, every draft path (owner rule, 2026-11-03).
//
// Copy is the item's own facts, one per line, then the series hashtag. Nothing else: no "[add your memory]" or other
// placeholder, no suggested lines, no em/en-dash styling, no story. Whatever facts the item has go into the shape;
// a missing fact drops its line.
//
//   mix (rendered video)        Discogs record
//   Chicago Skyway              Glenn Underground, Cei-Bei
//   Chubby Podcast              House Music Will Never Die
//   #mixtapesfromchi            1996 - CAJ 261
//                               #baieesdiscogs
//
// Any other item: its title lines, then where and when (no hashtag).
// Discogs facts come from `pkg.release` ({ artists, title, year, catno }, stamped from the stored Discogs release by
// scripts/discogs/stamp-release-copy.mjs); without it the item title ("Artist – Title") and eraYear stand in.

export const POST_MAX = 280;
export const MIX_HASHTAG = '#mixtapesfromchi';
export const DISCOGS_HASHTAG = '#baieesdiscogs';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LINE_MAX = 120;

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const PLACEHOLDER_RE = /\[(add|insert|your)[^\]]*\]/i;

/** One clean line: no placeholder, no em/en-dash styling, single spaces. '' when nothing real is left. */
export function cleanLine(v) {
  const s = str(v).replace(PLACEHOLDER_RE, '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '');
  if (!s || /^(todo|tbd|n\/a|none)$/i.test(s)) return '';
  return s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1).trimEnd()}…` : s;
}

/** "A – B" / "A — B" / "A - B" / "A · B" (spaced) => ['A', 'B']; an unspaced hyphen (V-Day, Cei-Bei) is part of a word. */
export const titleLines = (title) => str(title).split(/\s+[–—·-]\s+/).map(cleanLine).filter(Boolean);
const SHORT_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/** Discogs artist name without its disambiguation suffix ("Cei-Bei (2)") or name-variation star. */
const artistName = (a) => cleanLine(str(typeof a === 'object' ? a?.name : a).replace(/\s*\(\d+\)$/, '').replace(/\*$/, ''));

/** Which template an item gets: 'discogs' | 'mix' | 'item'. */
export function copyKind(pkg) {
  const kind = pkg?.source?.kind;
  const id = String(pkg?.id || '');
  if (kind === 'discogs' || id.startsWith('discogs-')) return 'discogs';
  if (kind === 'rendered-video' || id.startsWith('rv-')) return 'mix';
  return 'item';
}

function discogsLines(pkg) {
  const r = pkg?.release && typeof pkg.release === 'object' ? pkg.release : {};
  const fallback = titleLines(pkg?.title);
  const artists = (Array.isArray(r.artists) ? r.artists.map(artistName).filter(Boolean) : []).join(', ')
    || (fallback.length > 1 ? fallback[0] : '');
  const title = cleanLine(r.title) || (fallback.length > 1 ? fallback.slice(1).join(', ') : fallback[0] || '');
  const yearN = Number(r.year || pkg?.eraYear || pkg?.facets?.eraYear);
  const year = Number.isInteger(yearN) && yearN > 0 ? String(yearN) : '';
  const catno = cleanLine(r.catno);
  return [artists, title, [year, /^none$/i.test(catno) ? '' : catno].filter(Boolean).join(' - '), DISCOGS_HASHTAG];
}

function itemLines(pkg) {
  const f = pkg?.facets || {};
  const lines = titleLines(pkg?.title || (Array.isArray(f.partyNames) ? f.partyNames[0] : ''));
  const where = cleanLine((Array.isArray(f.venues) && f.venues[0]) || (Array.isArray(f.cities) && f.cities[0]) || '');
  if (where && !lines.some((l) => l.toLowerCase().includes(where.toLowerCase()))) lines.push(where);
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(pkg?.humanEdits?.eventDate ?? f.eventDate ?? pkg?.eventDate));
  // One date line: the event date written out, in place of a short date already in the title (12/17/14).
  const out = day ? lines.filter((l) => !SHORT_DATE_RE.test(l)) : lines;
  if (day) out.push(`${MONTHS[Number(day[2]) - 1]} ${Number(day[3])}, ${day[1]}`);
  return out;
}

/** Pure. The post copy for one library item (see header). Always <= POST_MAX; '' only for an item with no facts. */
export function formatPostCopy(pkg) {
  const kind = copyKind(pkg);
  const raw = kind === 'discogs' ? discogsLines(pkg)
    : kind === 'mix' ? [...titleLines(pkg?.title), MIX_HASHTAG]
      : itemLines(pkg);
  const lines = raw.map(cleanLine).filter(Boolean);
  if (!lines.length || (lines.length === 1 && lines[0].startsWith('#'))) {
    const id = cleanLine(pkg?.id);
    if (id) lines.unshift(id);
  }
  // Over the limit: shorten the longest non-hashtag line until it fits.
  let text = lines.join('\n');
  while (text.length > POST_MAX) {
    const i = lines.reduce((best, l, j) => (!l.startsWith('#') && l.length > (lines[best]?.length ?? -1) ? j : best), -1);
    if (i < 0 || lines[i].length <= 10) return text.slice(0, POST_MAX);
    lines[i] = `${lines[i].slice(0, lines[i].length - (text.length - POST_MAX) - 2).trimEnd()}…`;
    text = lines.join('\n');
  }
  return text;
}
