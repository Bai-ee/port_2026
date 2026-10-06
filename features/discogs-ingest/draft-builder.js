// Pure builders for the Discogs -> X draft ingest. No firebase, no network.

import { GEAR_ALIASES, normalizeFacets, normalizeTerm } from '../x-content-inventory/facets.js';

export const MEMORY_PLACEHOLDER_LINE = '[add your memory]';
export const DISCOGS_SOURCE = 'discogs-ingest';
export const DISCOGS_PACKAGE_SERIES = 'C1';
export const DISCOGS_PACKAGE_PILLAR = 'found-this'; // SERIES.C1.pillar in x-content-inventory/categories.js

const KIND_RULES = {
  video: { contentType: 'video/mp4', ext: 'mp4' },
  image: { contentType: 'image/jpeg', ext: 'jpg' },
};

export const VARIANTS = ['9x16', '1x1'];

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function isValidReleaseId(v) {
  return Number.isInteger(v) && v >= 0 && v <= 2_000_000_000;
}

/** Validate an upload-url request body. Returns { releaseId, kind, contentType, storagePath }. */
export function parseUploadUrlRequest(body = {}) {
  const { releaseId, kind, contentType, variant } = body || {};
  if (!isValidReleaseId(releaseId)) throw fail('releaseId must be a non-negative integer.');
  const rule = KIND_RULES[kind];
  if (!rule) throw fail("kind must be 'video' or 'image'.");
  if (contentType !== rule.contentType) throw fail(`contentType for ${kind} must be ${rule.contentType}.`);
  if (variant != null && !VARIANTS.includes(variant)) throw fail("variant must be '9x16' or '1x1'.");
  return { releaseId, kind, contentType, variant: variant ?? null, storagePath: buildStoragePath(releaseId, kind, variant ?? null) };
}

export function buildStoragePath(releaseId, kind, variant = null) {
  return `publish-staging/discogs/${releaseId}/${kind}${variant ? `-${variant}` : ''}.${KIND_RULES[kind].ext}`;
}

/** Validate optional draft `variants`; each path must be the canonical variant path for this release. */
export function parseVariants(releaseId, input) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw fail('variants must be an object.');
  const out = {};
  for (const kind of Object.keys(input)) {
    if (!KIND_RULES[kind]) throw fail(`variants.${kind}: unknown kind.`);
    const group = input[kind];
    if (group == null) continue;
    if (typeof group !== 'object' || Array.isArray(group)) throw fail(`variants.${kind} must be an object.`);
    for (const variant of Object.keys(group)) {
      if (!VARIANTS.includes(variant)) throw fail(`variants.${kind}.${variant}: unknown variant.`);
      const path = group[variant];
      if (path == null) continue;
      if (path !== buildStoragePath(releaseId, kind, variant)) {
        throw fail(`variants.${kind}.${variant} must be ${buildStoragePath(releaseId, kind, variant)}.`);
      }
      (out[kind] ||= {})[variant] = path;
    }
  }
  return out;
}

/** Flat, de-duplicated list of variant storage paths. */
export function variantPaths(variants) {
  return [...new Set(Object.values(variants || {}).flatMap((g) => Object.values(g || {})))];
}

/** { video: {'9x16': path}, ... } + a path->url lookup  ->  mediaVariants with { storagePath, url }. */
export function buildMediaVariants(variants, urlByPath) {
  const out = {};
  for (const [kind, group] of Object.entries(variants || {})) {
    for (const [variant, storagePath] of Object.entries(group || {})) {
      (out[kind] ||= {})[variant] = { storagePath, url: urlByPath[storagePath] };
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * True when existing post text is still the untouched builder output: ends with the
 * exact placeholder line after a blank line, and has only the lines the builder emits
 * (head with ' – ', optional meta line). Any human edit breaks this shape.
 */
export function isBuilderContent(content) {
  if (typeof content !== 'string') return false;
  const lines = content.split('\n');
  if (lines.length < 3 || lines.length > 5) return false;
  if (lines[lines.length - 1] !== MEMORY_PLACEHOLDER_LINE || lines[lines.length - 2] !== '') return false;
  return lines[0].includes(' – ') && lines.slice(1, -2).every((l) => l.trim() !== '');
}

/**
 * Owner story from builder-shaped content: line 1 `Artist – Title`, optional line 2
 * meta (`Label · Catno · Year`), then the story. Null when the shape is not
 * recognised, the story is empty, or the placeholder is still present.
 */
export function extractStory(content) {
  if (typeof content !== 'string') return null;
  if (content.toLowerCase().includes(MEMORY_PLACEHOLDER_LINE)) return null;
  const lines = content.split('\n');
  let i = 0;
  const next = () => { while (i < lines.length && lines[i].trim() === '') i += 1; };
  next();
  if (i >= lines.length || !lines[i].includes(' – ')) return null;
  i += 1;
  next();
  // Meta line: present only when it uses the builder's ' · ' separator and is followed by more text.
  if (i < lines.length && lines[i].includes(' · ')) i += 1;
  const story = lines.slice(i).join('\n').trim();
  return story || null;
}

/**
 * Decide what a post edit means for the Discogs story. Pure.
 * Returns null (not a Discogs post / nothing to do) or
 * { postPatch, packagePatch } where packagePatch is null when the package is untouched.
 */
export function storySyncPlan(post, newContent, pkg = null) {
  const releaseId = post?.sourceRef?.releaseId;
  if (post?.source !== DISCOGS_SOURCE || !isValidReleaseId(releaseId)) return null;
  const story = extractStory(newContent);
  if (!story) {
    return { postPatch: post.needsStory === true ? null : { needsStory: true }, packagePatch: null };
  }
  const packagePatch = { id: packageId(releaseId), story };
  if (!pkg || pkg.status === 'idea') packagePatch.status = 'drafted';
  const unchanged = pkg && pkg.story === story && !packagePatch.status;
  return {
    postPatch: post.needsStory === false ? null : { needsStory: false },
    packagePatch: unchanged ? null : packagePatch,
  };
}

/** Validate the draft request body. */
export function parseDraftRequest(body = {}) {
  const b = body || {};
  if (!isValidReleaseId(b.releaseId)) throw fail('releaseId must be a non-negative integer.');
  for (const f of ['discogsUrl', 'artist', 'title']) {
    if (typeof b[f] !== 'string' || !b[f].trim()) throw fail(`${f} is required.`);
  }
  if (!/^https:\/\/(www\.)?discogs\.com\//i.test(b.discogsUrl.trim())) throw fail('discogsUrl must be an https://discogs.com URL.');
  // The post/self-reply media may be the legacy single file or one of the variants (the worker sends the X aspect).
  const allowed = (kind) => [null, '9x16', '1x1'].map((v) => buildStoragePath(b.releaseId, kind, v));
  if (!allowed('video').includes(b.videoStoragePath)) throw fail('videoStoragePath does not match releaseId.');
  if (!allowed('image').includes(b.imageStoragePath)) throw fail('imageStoragePath does not match releaseId.');
  const s = (v) => (v == null ? '' : String(v).trim());
  const year = b.year == null || s(b.year) === '' ? null : s(b.year);
  return {
    releaseId: b.releaseId,
    discogsUrl: b.discogsUrl.trim(),
    artist: s(b.artist),
    title: s(b.title),
    label: s(b.label),
    catno: s(b.catno),
    year,
    videoStoragePath: b.videoStoragePath,
    imageStoragePath: b.imageStoragePath,
    variants: parseVariants(b.releaseId, b.variants),
    files: {
      images: Array.isArray(b.files?.images) ? b.files.images.map(String) : [],
      videos: Array.isArray(b.files?.videos) ? b.files.videos.map(String) : [],
    },
    clip: b.clip && typeof b.clip === 'object' ? b.clip : null,
    // Optional facet inputs (Content Engine v2). Unknown/invalid values are dropped, never rejected.
    artists: cleanList(b.artists),
    genres: cleanList(b.genres),
    styles: cleanList(b.styles),
    formats: cleanList(b.formats),
    country: s(b.country).slice(0, 80),
    tracklist: cleanList(
      Array.isArray(b.tracklist) ? b.tracklist.map((t) => (t && typeof t === 'object' ? t.title : t)) : null,
      { max: 60, len: 200 },
    ),
  };
}

/** Optional string[]: trimmed, non-empty, de-duplicated, bounded. Anything else -> []. */
function cleanList(v, { max = 30, len = 80 } = {}) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const t = x.trim().slice(0, len);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Gear only when a style names it outright (canonical name or a letter+digit alias); never guessed from bare numbers. */
export function detectGear(texts) {
  const hay = ` ${normalizeTerm((texts || []).join(' | '))} `;
  const found = [];
  for (const [canon, aliases] of Object.entries(GEAR_ALIASES)) {
    const names = [canon, ...aliases].map(normalizeTerm).filter((n) => /[a-z]/.test(n) && /\d/.test(n));
    if (names.some((n) => new RegExp(`[^a-z0-9]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(hay))) found.push(canon);
  }
  return found;
}

/**
 * Machine-derived facets from the request (no humanEdits; those live beside facets and win at read time).
 * Only emits what the request actually carries.
 */
export function buildDiscogsFacets(req) {
  const yearNum = req.year && /^\d{4}$/.test(req.year) ? Number(req.year) : null;
  const people = req.artists?.length ? req.artists : [req.artist];
  return normalizeFacets({
    people,
    labels: [req.label].filter(Boolean),
    eraYear: yearNum,
    genres: [...(req.genres || []), ...(req.styles || [])],
    gear: detectGear(req.styles),
    vibe: { kind: 'record' },
  });
}

/** Post text, always <= 280 chars (artist/title line is shortened if needed). */
export function buildPostText({ artist, title, label, catno, year }) {
  const meta = [label, catno, year].filter(Boolean).join(' · ');
  const tail = `${meta ? `\n${meta}` : ''}\n\n${MEMORY_PLACEHOLDER_LINE}`;
  let head = `${artist} – ${title}`;
  const room = 280 - tail.length;
  if (head.length > room) head = `${head.slice(0, Math.max(1, room - 1)).trimEnd()}…`;
  return `${head}${tail}`;
}

export function buildSelfReply({ discogsUrl, imageUrl, imageStoragePath }) {
  return {
    text: `On Discogs: ${discogsUrl}`,
    mediaUrl: imageUrl,
    mediaType: 'image',
    mediaContentType: 'image/jpeg',
    mediaStoragePath: imageStoragePath,
  };
}

/** Fields for a NEW social_posts draft (passed to createSocialPost). */
export function buildDraftPayload(req, { videoUrl, imageUrl, mediaVariants = null }) {
  return {
    content: buildPostText(req),
    status: 'draft',
    scheduledAt: null,
    source: DISCOGS_SOURCE,
    sourceRef: { releaseId: req.releaseId, discogsUrl: req.discogsUrl, catno: req.catno },
    mediaUrl: videoUrl,
    mediaType: 'video',
    mediaContentType: 'video/mp4',
    mediaStoragePath: req.videoStoragePath,
    selfReply: buildSelfReply({ discogsUrl: req.discogsUrl, imageUrl, imageStoragePath: req.imageStoragePath }),
    needsStory: true,
    packageId: packageId(req.releaseId),
    engine: 'record',
    ...(mediaVariants ? { mediaVariants } : {}),
  };
}

/** Media-only patch applied to an EXISTING draft (never touches human-edited text/status). */
export function buildDraftMediaPatch(req, { videoUrl, imageUrl, mediaVariants = null }) {
  const p = buildDraftPayload(req, { videoUrl, imageUrl, mediaVariants });
  return {
    ...(mediaVariants ? { mediaVariants } : {}),
    mediaUrl: p.mediaUrl,
    mediaType: p.mediaType,
    mediaContentType: p.mediaContentType,
    mediaStoragePath: p.mediaStoragePath,
    selfReply: p.selfReply,
    sourceRef: p.sourceRef,
    packageId: p.packageId,
    engine: p.engine,
  };
}

/** Trimmed, NFKC, whitespace-collapsed, lowercase, de-duplicated: matches match.js entityKeys so cooldown lines up. */
export function normalizeEntities(list) {
  const out = [];
  for (const e of list) {
    const k = String(e ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export function packageId(releaseId) {
  return `discogs-${releaseId}`;
}

/** Lowercase, single-spaced tag text. */
export function normalizeTag(v) {
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Join key written to social_posts so ACS can write publish results back to the package. */
export function packageIdPatch(releaseId) {
  return { packageId: packageId(releaseId) };
}

/**
 * Active Content System additive fields (ACS plan 3a). Only fields derivable from the
 * Discogs request; variants are included only when variant paths exist.
 */
export function buildAcsFields(req) {
  const tags = [...new Set([req.label, req.artist, req.year].map(normalizeTag).filter(Boolean))];
  const channel = (aspect, kind) => req.variants?.[kind]?.[aspect];
  const x = { aspect: '1x1', video: channel('1x1', 'video'), image: channel('1x1', 'image') };
  const ig = { aspect: '9x16', video: channel('9x16', 'video'), image: channel('9x16', 'image') };
  const hasPaths = (v) => Boolean(v.video || v.image);
  const variants = {};
  if (hasPaths(x)) variants.x = x;
  if (hasPaths(ig)) variants.instagram = ig;
  return {
    engine: 'record',
    source: { kind: 'discogs', externalId: String(req.releaseId), url: req.discogsUrl },
    priority: 'evergreen',
    format: 'video',
    tags,
    related: [],
    approval: { state: 'none' },
    ...(Object.keys(variants).length ? { variants } : {}),
  };
}

/** Existing (human/ACS-set) values win; only missing (undefined/null) fields are filled. */
export function mergeMissing(existing, fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (existing?.[k] === undefined || existing?.[k] === null) out[k] = v;
  }
  return out;
}

/** Same keys as `fields`, but a stored (non-null) value wins over the derived one. */
export function preferExisting(existing, fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = existing?.[k] ?? v;
  return out;
}

/** ContentPackage row for the X content inventory. `existing` = a stored row, whose human-set story/status win. */
export function buildContentPackage(req, existing = null) {
  const yearNum = req.year && /^\d{4}$/.test(req.year) ? Number(req.year) : null;
  return {
    id: packageId(req.releaseId),
    series: DISCOGS_PACKAGE_SERIES,
    pillar: DISCOGS_PACKAGE_PILLAR,
    title: `${req.artist} – ${req.title}`,
    story: existing?.story ?? '',
    status: existing?.status ?? 'idea',
    mediaState: 'video',
    effort: existing?.effort ?? '10-min',
    rights: existing?.rights ?? 'owned',
    platforms: ['x'],
    cta: req.discogsUrl,
    eraYear: yearNum,
    entities: normalizeEntities([req.artist, req.label]),
    // Machine facets. A newer request refreshes the keys it carries; keys it lacks keep their stored value.
    // humanEdits is never written here (owner edits win at read time via effectiveFacets).
    facets: { ...(existing?.facets || {}), ...buildDiscogsFacets(req) },
    // engine/source/priority/format/tags/variants/approval come from buildAcsFields below.
    // Written by the ledger when the post publishes; never reset by a re-ingest.
    lastPostedAt: existing?.lastPostedAt ?? null,
    assetRefs: [...new Set([req.videoStoragePath, req.imageStoragePath, ...variantPaths(req.variants)])],
    ...preferExisting(existing, buildAcsFields(req)),
  };
}

/** Allowed usage-log modules for the worker. */
export function isAllowedUsageModule(m) {
  return typeof m === 'string' && m.startsWith('discogs-') && m.length <= 80;
}
