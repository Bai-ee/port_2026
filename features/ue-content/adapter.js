// Underground Existence -> ContentPackage adapter (Active Content System §3e).
//
// Pure: no fs, no network, no clock. Callers pass in the parsed `artists.json`
// records, an index of local artist videos and (optionally) parsed mix reviews.
//
// DESIGN RULES
// - One package per VERIFIED-PLAYABLE distinct audio file. Anything matching a
//   known record defect is skipped with a reason, never "fixed" by guessing.
// - `story` is always the placeholder '[add your memory]'. The matcher refuses
//   placeholders, so nothing here can reach a post until Bryan writes the story.
//   `variants.x.suggestedStory` is a factual starting point built only from
//   record metadata and a short, attributed review excerpt.
// - Nothing in the output may carry wallet, deploy or gateway internals. The
//   audio txid appears ONLY in `source.externalId`.

import { createHash } from 'node:crypto';

export const PLACEHOLDER_STORY = '[add your memory]';
export const SITE_BASE = 'https://undergroundexistence.info';
export const OWNER_ARTISTS = ['BAI-EE']; // normalized below; add aliases only when the data shows them

const TXID_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Known record defects (docs/audits/integrity-2026-10-04). Keyed by artist
 * + txid because the same txid is legitimately fine under the other artist.
 * `*` in the artist slot matches any artist.
 */
export const KNOWN_DEFECTS = [
  { artist: 'BERNARD BADIE', txid: 'pk_RLPfAbytba0bMwTh4u5Xx2Bz1Sw-SeW-dZ8T0SMg', reason: 'shared txid: that file is Blue Jay Studio409, not Bernard Badie' },
  { artist: 'CHICAGO SKYWAY', txid: '5lOnZSh458XC-wk1xTkLimE-L-g0vnKejInB834VAEA', reason: 'shared txid between For Hakim and Little White Earbuds Mix; owner listen needed' },
  { artist: 'JEVON JACKSON', txid: '26lgzySQrL0NGDnPiHvpA89UFK15x4JxF_YLo0jDI1Y', reason: 'wrong file: points at the Live Mic solo, not Frankie Vega B2B Jevon Jackson' },
];

export function normName(s) {
  return String(s ?? '').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

/** Last path segment / subdomain-path txid of an Arweave-style URL, or the raw value. */
export function extractTxid(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  const seg = s.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop() || '';
  return seg;
}

/** Duration string -> minutes-ish number, or null when empty/zero/unparseable.
 * A bare number is read as minutes; "H:MM" / "MM:SS" are ambiguous, so this
 * only answers "is it non-zero", with a coarse magnitude for flagging. */
export function parseDuration(d) {
  const s = String(d ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) || null;
  const m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  if (parts.every((n) => n === 0)) return null;
  // m:ss reading (the site's default): first number = minutes.
  return parts.length === 3 ? parts[0] * 60 + parts[1] : parts[0] + parts[1] / 60;
}

/** '09 / '01' / 6/24 / 7/18/25 / 2024h / Circe '95 / Circa 2009 / 20?? -> year or null. */
export function parseYear(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /\?\?/.test(s)) return null;
  let m = s.match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  if (m) return Number(m[1]);
  m = s.match(/'(\d{2})'?/) || s.match(/\/(\d{2})$/);
  if (m) { const n = Number(m[1]); return n > 30 ? 1900 + n : 2000 + n; }
  return null;
}

export function cleanTitle(t) {
  return String(t ?? '').replace(/\s*\?\?+\s*$/, '').trim();
}

export function stableId(txid) {
  return `ue-${createHash('sha1').update(String(txid)).digest('hex').slice(0, 12)}`;
}

/** Build { normalizedArtist -> relative video path } from a file listing.
 * Accepts names like ACIDMAN_video_123.mp4, RED_EYE_video_.., BAI-EE_30s.mp4;
 * ignores numeric-only ids, "random", copies ("... 2.mp4") and non-video files. */
export function buildVideoIndex(filenames, dir = 'undergroundEx') {
  const idx = {};
  for (const f of filenames) {
    if (!/\.mp4$/i.test(f) || / \d+\.mp4$/i.test(f)) continue;
    const m = f.match(/^(.+?)_(?:video_\d+|30s)\.mp4$/i);
    if (!m) continue;
    const key = normName(m[1]);
    if (key === 'RANDOM') continue;
    // prefer the "_video_" render over a bare _30s clip when both exist
    if (!idx[key] || /_video_/i.test(f)) idx[key] = `${dir}/${f}`;
  }
  return idx;
}

/** Attributed review excerpt for a mix, or null. Matches artist + title only. */
export function findReviewExcerpt(reviews, artistName, mixTitle, maxLen = 220) {
  const a = normName(artistName);
  const t = normName(cleanTitle(mixTitle));
  const r = (reviews || []).find((x) => normName(x.artist) === a && normName(x.title) === t);
  if (!r || typeof r.review !== 'string') return null;
  const body = r.review
    .replace(/^\s*Write \d+ words about\s*/i, '')
    .replace(/^\s*["“][^"”\n]*["”]\s*/, '')
    .trim();
  const first = body.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? body;
  const text = first.replace(/\s+/g, ' ').trim();
  if (text.length < 20) return null;
  const clipped = text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
  return { text: clipped, by: r.author || r.artist };
}

/** Why a record cannot become a package, or null if it is verified-playable. */
export function playabilityIssue(mix, artist) {
  const txid = extractTxid(mix?.mixArweaveURL);
  if (!txid) return 'missing txid';
  if (!TXID_RE.test(txid)) return `truncated/invalid txid (${txid.length} chars)`;
  const defect = KNOWN_DEFECTS.find((d) => d.txid === txid && normName(d.artist) === normName(artist?.artistName));
  if (defect) return `known defect: ${defect.reason}`;
  if (parseDuration(mix?.mixDuration) === null) return `empty/0:00 duration ("${mix?.mixDuration ?? ''}")`;
  return null;
}

function isOwner(artistName) {
  return OWNER_ARTISTS.map(normName).includes(normName(artistName));
}

function suggestedStory({ artistName, title, year, duration, genre, review }) {
  const bits = [`Underground Existence archive: ${artistName}, "${title}"`];
  if (year) bits[0] += ` (${year})`;
  bits[0] += '.';
  const facts = [];
  if (duration) facts.push(`listed at ${duration}`);
  if (genre) facts.push(`genre tag: ${genre}`);
  facts.push('hosted permanently on Arweave');
  bits.push(`${facts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()));
  if (review) bits.push(`${review.by} wrote: "${review.text}"`);
  return bits.join(' ');
}

/**
 * @param {object} mix    artists.json mix record
 * @param {object} artist artists.json artist record
 * @param {{ videoIndex?: object, reviews?: object[], siteBase?: string }} [ctx]
 * @returns {object} ContentPackage (never throws on playable input)
 */
export function mixToPackage(mix, artist, ctx = {}) {
  const txid = extractTxid(mix.mixArweaveURL);
  const artistName = artist.artistName;
  const title = cleanTitle(mix.mixTitle);
  const year = parseYear(mix.mixDateYear);
  const video = ctx.videoIndex?.[normName(artistName)] ?? null;
  const owned = isOwner(artistName);
  const siteBase = ctx.siteBase || SITE_BASE;
  const url = artist.artistFilename ? `${siteBase}/${artist.artistFilename}` : siteBase;
  const review = findReviewExcerpt(ctx.reviews, artistName, title);

  const thumb = mix.renderImageMeta?.storagePath || mix.mixImageMeta?.storagePath || null;
  const assetRefs = [video, thumb].filter(Boolean);

  const tags = ['ue-mix'];
  if (!owned) tags.push('rights:third-party-unconfirmed');
  if (year === null) tags.push('year-unknown');
  if (mix.mixTitle !== title) tags.push('title-cleaned');
  const mins = parseDuration(mix.mixDuration);
  if (mins !== null && mins < 10) tags.push('duration-unverified');

  const xVariant = {
    suggestedStory: suggestedStory({
      artistName, title, year, duration: mix.mixDuration, genre: artist.artistGenre, review,
    }),
  };
  if (!owned) {
    xVariant.rightsNote = 'Third-party artist. Blocked (never-public) until the artist confirms; set rights to cleared and approval to approved after.';
  }

  return {
    id: stableId(txid),
    series: 'C4',
    engine: 'ue',
    // made-this: UE is a platform Bryan built and runs; the archive is his
    // curation work. 'was-there' stays reserved for flyers and event memory.
    pillar: 'made-this',
    title: `${artistName} – ${title}${year ? ` (${year})` : ''}`,
    story: PLACEHOLDER_STORY,
    assetRefs,
    mediaState: video ? 'video' : 'still',
    format: video ? 'video' : 'still',
    effort: video ? 'ready' : '10-min',
    rights: owned ? 'owned' : 'never-public',
    approval: { state: owned ? 'none' : 'needed' },
    platforms: ['x'],
    cta: url,
    eraYear: year,
    eventDate: null,
    entities: [artistName, 'Underground Existence'],
    status: 'idea',
    lastPostedAt: null,
    postCount: 0,
    priority: 'evergreen',
    expiresAt: null,
    campaign: null,
    related: [],
    tags,
    source: { kind: 'ue', externalId: txid, url },
    variants: { x: xVariant },
  };
}

/**
 * Map a whole artists.json. Cross-listed audio (same txid under several
 * records, e.g. the Viva Acid mirrors) yields ONE package, from the first
 * record seen; the rest are skipped as duplicates so one set never posts twice.
 * @returns {{ packages: object[], skipped: {artist,title,reason}[] }}
 */
export function mapArtists(artists, ctx = {}) {
  const packages = [];
  const skipped = [];
  const seen = new Map(); // txid -> first artist
  for (const artist of artists || []) {
    for (const mix of artist.mixes || []) {
      const issue = playabilityIssue(mix, artist);
      const base = { artist: artist.artistName, title: mix.mixTitle };
      if (issue) { skipped.push({ ...base, reason: issue }); continue; }
      const txid = extractTxid(mix.mixArweaveURL);
      if (seen.has(txid)) {
        skipped.push({ ...base, reason: `duplicate audio (cross-listing of ${seen.get(txid)})` });
        continue;
      }
      seen.set(txid, artist.artistName);
      packages.push(mixToPackage(mix, artist, ctx));
    }
  }
  return { packages, skipped };
}
