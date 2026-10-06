// Thumbnails + batch media URLs for content packages (Content Engine v2 §5b).
//
// STORAGE: Hitloop bucket, `content-thumbs/<clientId>/<id>.jpg`, 320px JPEG q70.
// DELIVERY: Firebase download-token URLs (the same pattern Discogs publish-staging
// uses). Unlike a v4 signed URL the token URL is STABLE across calls, so the
// browser cache and CDN keep working; the upload sets a 1-year Cache-Control.
// Thumb refs are paths, never URLs.
//
// Pure/DI: storage handles are passed in; sharp is imported lazily.

import { randomUUID } from 'node:crypto';

export const THUMB_PREFIX = 'content-thumbs';
export const THUMB_MAX_BYTES = 80 * 1024;
export const THUMB_MAX_INPUT_DIM = 480;
export const THUMB_LONG_EDGE = 320;
export const THUMB_QUALITY = 70;
export const MEDIA_URLS_MAX_IDS = 60;
export const MEDIA_KINDS = ['thumb', 'video', 'image'];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const CLIENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const DATA_URL_RE = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export function thumbPathFor(clientId, id) {
  if (!CLIENT_RE.test(String(clientId ?? ''))) throw Object.assign(new Error('Invalid clientId for thumb path.'), { status: 400 });
  if (!ID_RE.test(String(id ?? ''))) throw Object.assign(new Error('Invalid item id for thumb path.'), { status: 400 });
  return `${THUMB_PREFIX}/${clientId}/${id}.jpg`;
}

/** @returns {{ok:true, mime:string, buffer:Buffer}|{ok:false, error:string}} */
export function validateThumbDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return { ok: false, error: 'dataUrl is required.' };
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return { ok: false, error: 'dataUrl must be a base64 image/jpeg or image/webp data URL.' };
  const approx = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0);
  if (approx > THUMB_MAX_BYTES) return { ok: false, error: `Thumbnail is ${approx} bytes; limit is ${THUMB_MAX_BYTES}.` };
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > THUMB_MAX_BYTES) return { ok: false, error: 'Thumbnail size out of range.' };
  return { ok: true, mime: m[1], buffer };
}

/** Verify dimensions with sharp metadata, then re-encode to the canonical 320px JPEG q70. */
export async function makeThumbJpeg(buffer, { sharp, enforceMaxInput = true } = {}) {
  const sh = sharp || (await import('sharp')).default;
  let meta;
  try { meta = await sh(buffer).metadata(); } catch { throw Object.assign(new Error('Thumbnail is not a decodable image.'), { status: 400 }); }
  if (!meta.width || !meta.height) throw Object.assign(new Error('Thumbnail has no dimensions.'), { status: 400 });
  if (enforceMaxInput && (meta.width > THUMB_MAX_INPUT_DIM || meta.height > THUMB_MAX_INPUT_DIM)) {
    throw Object.assign(new Error(`Thumbnail ${meta.width}x${meta.height} exceeds ${THUMB_MAX_INPUT_DIM}px.`), { status: 400 });
  }
  return sh(buffer).rotate().resize({ width: THUMB_LONG_EDGE, height: THUMB_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true }).toBuffer();
}

export function buildDownloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/** Upload with a download token + long cache. Returns the stable URL. */
export async function uploadThumb(bucket, path, jpegBuffer) {
  const token = randomUUID();
  await bucket.file(path).save(jpegBuffer, {
    resumable: false,
    metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
  });
  return buildDownloadUrl(bucket.name, path, token);
}

/** Stable token URL for an existing object; mints a token when none exists. Null if missing. */
export async function tokenUrlFor(bucket, path) {
  const file = bucket.file(path);
  try {
    const [exists] = await file.exists();
    if (!exists) return null;
    const [meta] = await file.getMetadata();
    let token = String(meta?.metadata?.firebaseStorageDownloadTokens || '').split(',')[0].trim();
    if (!token) {
      token = randomUUID();
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }
    return buildDownloadUrl(bucket.name, path, token);
  } catch {
    return null;
  }
}

const EV_RE = /^ev:(.+)$/;
const evPath = (ref) => {
  const p = EV_RE.exec(String(ref ?? ''))?.[1] ?? '';
  return !p || p.startsWith('/') || p.split('/').includes('..') ? null : p;
};
const hitloopPath = (ref) => {
  const s = String(ref ?? '');
  return s.startsWith('publish-staging/') && !s.split('/').includes('..') ? s : null;
};
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

/**
 * Batch resolver behind the `media-urls` action.
 * deps: { hitloopBucket, signEv(path)->Promise<string|null> }
 * @returns {Promise<Record<string,{thumbUrl?:string,videoUrl?:string,imageUrl?:string}>>}
 */
export async function resolveMediaUrlsBatch(pkgs, kinds, deps, { concurrency = 10 } = {}) {
  const want = new Set(kinds);
  const out = {};
  const jobs = [];
  for (const pkg of pkgs) {
    if (!pkg?.id) continue;
    const entry = (out[pkg.id] = {});
    const refs = Array.isArray(pkg.assetRefs) ? pkg.assetRefs : [];
    if (want.has('thumb')) {
      if (pkg.thumbRef) jobs.push(async () => { const u = await tokenUrlFor(deps.hitloopBucket, pkg.thumbRef); if (u) entry.thumbUrl = u; });
      else if (evPath(pkg.posterRef)) jobs.push(async () => { const u = await deps.signEv(evPath(pkg.posterRef)); if (u) entry.thumbUrl = u; });
    }
    const resolve = async (ref) => {
      const e = evPath(ref);
      if (e) return deps.signEv(e);
      const h = hitloopPath(ref);
      return h ? tokenUrlFor(deps.hitloopBucket, h) : null;
    };
    if (want.has('video')) {
      const ref = refs.find((r) => VIDEO_EXT.test(String(r)) && (evPath(r) || hitloopPath(r)));
      if (ref) jobs.push(async () => { const u = await resolve(ref); if (u) entry.videoUrl = u; });
    }
    if (want.has('image')) {
      const ref = refs.find((r) => IMAGE_EXT.test(String(r)) && (evPath(r) || hitloopPath(r)));
      if (ref) jobs.push(async () => { const u = await resolve(ref); if (u) entry.imageUrl = u; });
    }
  }
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (i < jobs.length) await jobs[i++]();
  }));
  return out;
}
