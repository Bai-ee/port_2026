// Pure builders for the Discogs -> X draft ingest. No firebase, no network.

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

/** Validate the draft request body. */
export function parseDraftRequest(body = {}) {
  const b = body || {};
  if (!isValidReleaseId(b.releaseId)) throw fail('releaseId must be a non-negative integer.');
  for (const f of ['discogsUrl', 'artist', 'title']) {
    if (typeof b[f] !== 'string' || !b[f].trim()) throw fail(`${f} is required.`);
  }
  if (!/^https:\/\/(www\.)?discogs\.com\//i.test(b.discogsUrl.trim())) throw fail('discogsUrl must be an https://discogs.com URL.');
  if (b.videoStoragePath !== buildStoragePath(b.releaseId, 'video')) throw fail('videoStoragePath does not match releaseId.');
  if (b.imageStoragePath !== buildStoragePath(b.releaseId, 'image')) throw fail('imageStoragePath does not match releaseId.');
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
  };
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
  };
}

export function packageId(releaseId) {
  return `discogs-${releaseId}`;
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
    entities: [req.artist, req.label].filter(Boolean),
    assetRefs: [...new Set([req.videoStoragePath, req.imageStoragePath, ...variantPaths(req.variants)])],
  };
}

/** Allowed usage-log modules for the worker. */
export function isAllowedUsageModule(m) {
  return typeof m === 'string' && m.startsWith('discogs-') && m.length <= 80;
}
