// Rendered Videos -> ContentPackage adapter (Content Engine v2 master plan §5.2).
//
// Source: EditVideos `videos/{jobId}` docs (written by the worker on completion:
// artist, mixTitle, duration, fileSize, videoUrl, status, createdAt) plus the
// Hitloop `media_jobs` doc whose `editJobId` equals that jobId (look/filter).
//
// Pure: no fs, no network, no clock (caller passes `now`).
//
// RULES
// - Store the OBJECT PATH (`ev:videos/<file>.mp4`), never a signed URL: the
//   worker's URLs are 1-year signed links and the Studio re-signs on demand.
// - Rights reuse features/ue-content: owner artists are 'owned', everyone else
//   is 'never-public' (non-publishing) until the artist confirms.
// - `story` is always the placeholder; nothing here can reach a post unreviewed.
//
// AUTO-DAILY DETECTION (documented rule, see isAutoDailyRender):
//   The daily email render is the only job built from DAILY_EMAIL_VIDEO_PRODUCTION
//   (app/api/worker/pre-digest-video/route.js). Its fingerprint on the joined
//   media_jobs doc is: filter 'look_hard_bw_street_doc' AND (end logo
//   'mixtapes_white_square.png' OR a 6-segment manual video order). Matching ->
//   tag 'auto-daily'. A media_job exists but does not match -> 'deliberate'.
//   No media_job found (or too old to join) -> 'origin-unknown'.

import { normName, parseYear, cleanTitle, OWNER_ARTISTS } from '../ue-content/adapter.js';
import { normalizeFacets, buildSearchTokens, FACET_VERSION } from '../x-content-inventory/facets.js';

export const PLACEHOLDER_STORY = '[add your memory]';
export const DEFAULT_MIX_TITLE = 'Hitloop Video Remix';
export const DAILY_FILTER_KEY = 'look_hard_bw_street_doc';
export const DAILY_END_LOGO = 'mixtapes_white_square.png';
export const BUCKET_ID = 'ue';
export const EV_PREFIX = 'ev:';

const BAD_STATUS = new Set(['failed', 'deleted', 'error', 'cancelled', 'canceled']);

/** Firestore Timestamp | Date | ISO string | millis -> ISO string or null. */
export function toIso(v) {
  if (v == null) return null;
  let ms = null;
  if (typeof v?.toMillis === 'function') ms = v.toMillis();
  else if (typeof v?.toDate === 'function') ms = v.toDate().getTime();
  else if (typeof v?.seconds === 'number') ms = v.seconds * 1000;
  else if (v instanceof Date) ms = v.getTime();
  else if (typeof v === 'number') ms = v;
  else if (typeof v === 'string') ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Object path (`videos/x.mp4`) out of a stored signed/public URL, or null.
 * Handles storage.googleapis.com/<bucket>/<path>, <bucket>.storage.googleapis.com/<path>
 * and firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>. */
export function objectPathFromUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  let p;
  if (u.hostname === 'firebasestorage.googleapis.com') {
    const m = u.pathname.match(/\/o\/(.+)$/);
    p = m ? decodeURIComponent(m[1]) : null;
  } else if (u.hostname === 'storage.googleapis.com') {
    p = decodeURIComponent(u.pathname.replace(/^\/+/, '').split('/').slice(1).join('/'));
  } else if (u.hostname.endsWith('.storage.googleapis.com')) {
    p = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } else return null;
  return p && /^videos\/[^/].*\.(mp4|mov|m4v|webm)$/i.test(p) ? p : null;
}

/** Resolve the storage object path for a videos doc without ever keeping the URL. */
export function videoObjectPath(videoDoc = {}) {
  const name = videoDoc.fileName || videoDoc.metadata?.fileName;
  if (typeof name === 'string' && name.trim()) {
    const clean = name.trim().replace(/^\/+/, '');
    return clean.startsWith('videos/') ? clean : `videos/${clean}`;
  }
  return objectPathFromUrl(videoDoc.videoUrl);
}

/** Why a videos doc must not become a package, or null. */
export function exclusionReason(videoDoc) {
  if (!videoDoc || typeof videoDoc !== 'object') return 'not an object';
  const status = String(videoDoc.status ?? '').toLowerCase();
  if (status !== 'completed') return `status "${status || 'missing'}" (only completed renders)`;
  if (BAD_STATUS.has(status) || videoDoc.deleted === true || videoDoc.deletedAt) return 'deleted/failed';
  if (!videoObjectPath(videoDoc)) return 'no resolvable storage object path';
  return null;
}

/** media_jobs doc -> 'auto-daily' | 'deliberate' | 'origin-unknown'. */
export function renderOrigin(mediaJob) {
  if (!mediaJob) return 'origin-unknown';
  const full = mediaJob.recipeFull || {};
  const trimmed = mediaJob.recipe || {};
  const filter = full.filter?.key ?? (typeof trimmed.filter === 'string' ? trimmed.filter : null);
  const endLogo = full.logos?.end ?? null;
  const segments = Array.isArray(full.videoOrder) ? full.videoOrder.length : Number(trimmed.manualOrderSegments) || 0;
  const daily = filter === DAILY_FILTER_KEY && (endLogo === DAILY_END_LOGO || segments === 6);
  return daily ? 'auto-daily' : 'deliberate';
}
export const isAutoDailyRender = (mediaJob) => renderOrigin(mediaJob) === 'auto-daily';

/** Case/space/punctuation-insensitive artist lookup in the parsed artists.json. */
export function findUeArtist(ueArtists, artistName) {
  const key = normName(artistName);
  if (!key) return null;
  return (ueArtists || []).find((a) => normName(a.artistName) === key) || null;
}

function findUeMix(ueArtist, mixTitle) {
  const key = normName(cleanTitle(mixTitle));
  if (!key) return null;
  return (ueArtist?.mixes || []).find((m) => normName(cleanTitle(m.mixTitle)) === key) || null;
}

function formatDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
}

/**
 * @param {object} videoDoc  EditVideos videos/{jobId} doc (include `id`)
 * @param {{ mediaJob?: object, ueArtists?: object[], now?: number|Date,
 *           knownPosters?: Iterable<string> }} [ctx]
 * @returns {object|null} ContentPackage, or null when excluded
 */
export function renderedVideoToPackage(videoDoc, ctx = {}) {
  if (exclusionReason(videoDoc)) return null;
  const jobId = String(videoDoc.jobId || videoDoc.videoId || videoDoc.id || '').trim();
  if (!jobId) return null;

  const objectPath = videoObjectPath(videoDoc);
  const artist = String(videoDoc.artist ?? '').trim();
  const artistKnown = !!artist && artist.toLowerCase() !== 'random';
  const artistName = artistKnown ? artist : 'Unknown artist';
  const rawMix = String(videoDoc.mixTitle ?? '').trim();
  const mixKnown = !!rawMix && rawMix !== DEFAULT_MIX_TITLE;
  const mixTitle = mixKnown ? rawMix : 'Video Remix';

  const ueArtist = artistKnown ? findUeArtist(ctx.ueArtists, artist) : null;
  const ueMix = mixKnown ? findUeMix(ueArtist, rawMix) : null;
  const year = ueMix ? parseYear(ueMix.mixDateYear) : null;
  const genres = String(ueArtist?.artistGenre ?? '').split(/[,/]/).map((s) => s.trim()).filter(Boolean);

  const owned = artistKnown && OWNER_ARTISTS.map(normName).includes(normName(artist));
  const origin = renderOrigin(ctx.mediaJob);
  const renderedAt = toIso(videoDoc.createdAt);
  const nowIso = toIso(ctx.now ?? null);

  const hasPoster = !!videoDoc.posterPath || new Set(ctx.knownPosters || []).has(jobId);
  const posterRef = hasPoster ? `${EV_PREFIX}posters/${jobId}.jpg` : null;

  const tags = ['rendered-video', origin];
  if (!mixKnown) tags.push('mix-unknown');
  if (!artistKnown) tags.push('artist-unknown');
  if (!owned) tags.push('rights:third-party-unconfirmed');

  const dur = formatDuration(videoDoc.duration);
  const facts = [`Rendered video for ${artistName}${mixKnown ? `, "${mixTitle}"` : ''}${year ? ` (${year})` : ''}`];
  const bits = [];
  if (dur) bits.push(`runs ${dur}`);
  if (genres.length) bits.push(`genre tag: ${genres.join(', ')}`);
  if (renderedAt) bits.push(`rendered ${renderedAt.slice(0, 10)}`);
  const suggestedStory = `${facts[0]}.${bits.length ? ` ${bits.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : ''}`;

  const pkg = {
    id: `rv-${jobId}`,
    bucketId: BUCKET_ID,
    series: 'C4',
    engine: 'ue',
    pillar: 'made-this',
    title: `${artistName} – ${mixTitle}`,
    story: PLACEHOLDER_STORY,
    assetRefs: [`${EV_PREFIX}${objectPath}`],
    ...(posterRef ? { posterRef } : {}),
    mediaState: 'video',
    format: 'video',
    effort: 'ready',
    rights: owned ? 'owned' : 'never-public',
    approval: { state: owned ? 'none' : 'needed' },
    platforms: ['x'],
    cta: null,
    eraYear: year,
    eventDate: null,
    entities: artistKnown ? [artistName] : [],
    status: 'idea',
    lastPostedAt: null,
    postCount: 0,
    priority: 'evergreen',
    expiresAt: null,
    campaign: null,
    related: [],
    tags,
    source: { kind: 'rendered-video', externalId: jobId }, // no url key: validatePackage rejects null
    renderedAt,
    ...(nowIso ? { ingestedAt: nowIso } : {}),
    variants: { x: { suggestedStory } },
    facetVersion: FACET_VERSION,
  };
  pkg.facets = normalizeFacets({
    people: artistKnown ? [artistName] : [],
    genres,
    ...(year ? { eraYear: year } : {}),
    vibe: { kind: 'video' },
  });
  pkg.searchTokens = buildSearchTokens(pkg);
  return pkg;
}

/** Map a list; returns {packages, skipped:[{id,reason}]}. Later duplicates of one jobId are dropped. */
export function mapRenderedVideos(videoDocs, ctx = {}) {
  const packages = [];
  const skipped = [];
  const seen = new Set();
  for (const v of videoDocs || []) {
    const reason = exclusionReason(v);
    if (reason) { skipped.push({ id: v?.id ?? null, reason }); continue; }
    const mediaJob = ctx.mediaJobsByEditJobId?.get?.(String(v.jobId || v.id)) ?? ctx.mediaJob;
    const pkg = renderedVideoToPackage(v, { ...ctx, mediaJob });
    if (!pkg) { skipped.push({ id: v?.id ?? null, reason: 'unmappable' }); continue; }
    if (seen.has(pkg.id)) { skipped.push({ id: pkg.id, reason: 'duplicate jobId' }); continue; }
    seen.add(pkg.id);
    packages.push(pkg);
  }
  return { packages, skipped };
}
