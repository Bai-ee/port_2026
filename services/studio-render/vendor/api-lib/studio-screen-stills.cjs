// studio-screen-stills.cjs — Slice F2 (STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md): the immutable, content-addressed device-screen still.
//
// Codex's F2 contract, implemented here end to end:
//   - captured/uploaded screen content is converted into a durable,
//     content-hashed Storage object BEFORE job submission via the
//     direct-upload flow (startDeviceScreenStillUpload mints a tenant-
//     scoped signed WRITE URL, the browser PUTs the bytes to Storage,
//     finalizeDeviceScreenStillUpload validates/hashes/promotes them —
//     image bytes never ride a Vercel JSON body, and this module never
//     fetches a URL, ever; pinDeviceScreenStill is the internal/test
//     byte-level core only, no route accepts it);
//   - MIME type is sniffed from the actual bytes (magic numbers — the
//     caller's claimed content type is never trusted), dimensions are
//     parsed from the real image headers, and byte size is capped;
//   - the object lives under the OWNING client's own prefix
//     (studio-screen-stills/<clientId>/<sha256>.<ext>) — existence checks
//     and downloads are clientId-scoped, so one tenant can never reference
//     another tenant's still even with a known hash;
//   - the recipe carries only the sanitized reference
//     ({sha256, ext, width, height, bytes}) — never a raw path/URL;
//   - the render worker downloads the object to a LOCAL file before frame
//     zero (downloadDeviceScreenStill); a missing/failed object rejects
//     the render through the existing fenced path — a pinned screen is
//     never silently rendered blank.
//
// Same DI seam (__setTestContext) as proof-render-artifacts.cjs.

const crypto = require('crypto');
const realFb = require('./firebase-admin.cjs');

const PREFIX = 'studio-screen-stills';
// Temporary direct-upload staging area (Codex F2 transport correction —
// Vercel Functions cap request bodies at 4.5MB, so image BYTES can never
// ride a JSON body: the browser uploads straight to Storage via a signed
// URL minted by startDeviceScreenStillUpload, then the authenticated
// finalize step downloads/sniffs/hashes the temp object server-side and
// writes the canonical content-addressed still). Temp objects are deleted
// best-effort on finalize (success OR failure); a bucket lifecycle rule on
// this prefix (age ≥ 1 day) is the authoritative backstop — same Phase 7
// gate as every other lifecycle rule.
const TMP_PREFIX = 'studio-screen-stills-tmp';
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;
const MAX_STILL_BYTES = 8 * 1024 * 1024; // full-page captures are big; 8MB covers browserless full-page PNGs with headroom
const MIN_DIMENSION = 16;
const MAX_DIMENSION = 8192; // full-page desktop captures are TALL (3 screens+); bounded, not viewport-bounded
// Decoded-pixel budget (Codex: "a maximum decoded pixel count, not only
// independent 8192×8192 bounds") — 8192×8192 would decode to a 256MB RGBA
// buffer; 32MP caps the worst case at ~128MB while still clearing every
// real full-page capture (1920-wide × 8192-tall ≈ 15.7MP) comfortably.
const MAX_TOTAL_PIXELS = 32 * 1024 * 1024;
const ALLOWED_EXTS = ['png', 'jpg', 'webp'];
// Per-client quotas (Codex: "per-client upload rate/storage quotas") —
// enforced in ONE Firestore transaction at finalize time, same day-keyed
// quota-doc pattern as studio-device-capture.cjs. Stored-bytes counts only
// NEW canonical objects (a re-pin of identical bytes is free — content
// addressing makes it a no-op).
const QUOTA_COLLECTION = 'studio_screen_still_quota';
// Per-(tenant, content-hash) asset LEDGER — the transactional source of
// truth for "is this asset new to this client" (Codex F2b P1 correction:
// deciding newness from a Storage exists() check OUTSIDE the transaction
// let two concurrent finalizations of identical content both see
// not-stored and double-charge bytesTotal; a tx.get on this ledger doc
// means exactly ONE transaction ever reserves the bytes).
const ASSET_COLLECTION = 'studio_screen_still_assets';
const PER_CLIENT_DAILY_PINS = 40;
const PER_CLIENT_MAX_STORED_BYTES = 256 * 1024 * 1024;

let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }
function bucket() { return ctx().adminStorage.bucket(); }

const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Sniffs type + parses dimensions from the REAL bytes — magic numbers, then
 * the format's own header fields. Returns { ext, width, height } or throws
 * a 400. Deliberately dependency-free: PNG IHDR is fixed-offset; JPEG needs
 * a SOF-marker scan; WebP covers the VP8 (lossy), VP8L (lossless), and VP8X
 * (extended) header layouts.
 */
function parseImageBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) throw httpError('Screen still is not a readable image.', 400);
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at offsets 16/20.
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: FF D8, scan markers for SOF0/1/2 (C0/C1/C2) — height/width big-endian at +5/+7.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { ext: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    throw httpError('JPEG screen still has no readable size header.', 400);
  }
  // WebP: RIFF....WEBP, then VP8 /VP8L/VP8X chunk.
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
      return { ext: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b0 = buf[21]; const b1 = buf[22]; const b2 = buf[23]; const b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { ext: 'webp', width, height };
    }
    if (chunk === 'VP8X') {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { ext: 'webp', width, height };
    }
  }
  throw httpError('Screen still must be a PNG, JPEG, or WebP image (checked by content, not by claimed type).', 400);
}

function stillStoragePath(clientId, sha256, ext) {
  const safeClient = String(clientId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeClient) throw httpError('clientId is required.', 400);
  return `${PREFIX}/${safeClient}/${sha256}.${ext}`;
}

/** Shape-validates a recipe-carried still reference. Returns the sanitized {sha256, ext, width, height, bytes} or null. */
function sanitizeScreenStillRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sha256 = typeof raw.sha256 === 'string' && /^[0-9a-f]{64}$/.test(raw.sha256) ? raw.sha256 : null;
  const ext = ALLOWED_EXTS.includes(raw.ext) ? raw.ext : null;
  const okDim = (v) => Number.isInteger(v) && v >= MIN_DIMENSION && v <= MAX_DIMENSION;
  const okBytes = Number.isInteger(raw.bytes) && raw.bytes > 0 && raw.bytes <= MAX_STILL_BYTES;
  if (!sha256 || !ext || !okDim(raw.width) || !okDim(raw.height) || !okBytes) return null;
  if (raw.width * raw.height > MAX_TOTAL_PIXELS) return null; // same decoded-pixel budget as the byte-level validator
  return { sha256, ext, width: raw.width, height: raw.height, bytes: raw.bytes };
}

/** Validates + hashes raw BYTES into the canonical reference shape (no Storage access) — the shared core of finalize. */
function validateStillBytes(buf) {
  if (buf.length > MAX_STILL_BYTES) {
    throw httpError(`Screen still exceeds the ${Math.round(MAX_STILL_BYTES / 1024 / 1024)}MB limit (got ${buf.length} bytes).`, 400);
  }
  const { ext, width, height } = parseImageBytes(buf);
  if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw httpError(`Screen still dimensions ${width}x${height} are outside the allowed ${MIN_DIMENSION}..${MAX_DIMENSION} range.`, 400);
  }
  if (width * height > MAX_TOTAL_PIXELS) {
    throw httpError(`Screen still decodes to ${width * height} pixels — over the ${MAX_TOTAL_PIXELS} pixel budget. Reduce the capture size.`, 400);
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { sha256, ext, width, height, bytes: buf.length };
}

function utcDayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function tmpStoragePath(clientId, tempId) {
  const safeClient = String(clientId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeClient) throw httpError('clientId is required.', 400);
  if (!/^[a-f0-9-]{36}$/.test(String(tempId))) throw httpError('Invalid tempId.', 400);
  return `${TMP_PREFIX}/${safeClient}/${tempId}`;
}

/**
 * Step 1 of the direct-upload pin flow: mints a short-lived, tenant-scoped
 * signed WRITE URL for a temporary staging object. The browser PUTs the
 * image bytes straight to Storage (never through a Vercel function body —
 * the 4.5MB request cap makes that impossible for real captures). Nothing
 * is trusted from this step: finalize re-reads the actual uploaded bytes.
 */
async function startDeviceScreenStillUpload({ clientId, contentType, bytes }) {
  if (!clientId) throw httpError('clientId is required.', 400);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
    throw httpError('contentType must be image/png, image/jpeg, or image/webp.', 400);
  }
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_STILL_BYTES) {
    throw httpError(`bytes must be a positive integer no larger than ${MAX_STILL_BYTES}.`, 400);
  }
  const tempId = crypto.randomUUID();
  const tempPath = tmpStoragePath(clientId, tempId);
  const [uploadUrl] = await bucket().file(tempPath).getSignedUrl({
    version: 'v4', action: 'write', expires: Date.now() + UPLOAD_URL_TTL_MS, contentType,
  });
  return { tempId, uploadUrl, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString() };
}

/**
 * Step 2: downloads the temp object THIS client staged, validates the real
 * bytes (sniffed MIME, header dims, byte + decoded-pixel budgets), enforces
 * the per-client daily-pin and stored-bytes quotas in one transaction, and
 * writes the canonical content-addressed still. The temp object is deleted
 * best-effort whether finalize succeeds or fails.
 */
async function finalizeDeviceScreenStillUpload({ clientId, tempId, now = Date.now() }) {
  const tempPath = tmpStoragePath(clientId, tempId);
  const tempFile = bucket().file(tempPath);
  try {
    let buf;
    try {
      [buf] = await tempFile.download();
    } catch {
      throw httpError('No uploaded object found for this tempId — upload the image bytes to the signed URL first (or the upload window expired).', 400);
    }
    const ref = validateStillBytes(buf);
    const objectPath = stillStoragePath(clientId, ref.sha256, ref.ext);

    // Quota + asset-ledger transaction (Codex F2b P1 correction — see
    // ASSET_COLLECTION's own comment): "is this asset new to this client"
    // is decided by a tx.get on the per-(tenant, hash) ledger doc INSIDE
    // the same transaction that charges the quota, so two concurrent
    // finalizations of identical content serialize — exactly one reserves
    // the bytes; the other sees the ledger entry and charges only its pin.
    // The pin COUNT always increments (rate limit); stored BYTES only for
    // a genuinely new asset (content addressing makes duplicate pins free).
    const fb = ctx();
    const day = utcDayKey(now);
    const safeClient = String(clientId).replace(/[^a-zA-Z0-9_-]/g, '');
    const quotaRef = fb.adminDb.collection(QUOTA_COLLECTION).doc(safeClient);
    const assetRef = fb.adminDb.collection(ASSET_COLLECTION).doc(`${safeClient}__${ref.sha256}`);
    let reservedNewAsset = false;
    await fb.adminDb.runTransaction(async (tx) => {
      const [quotaSnap, assetSnap] = await Promise.all([tx.get(quotaRef), tx.get(assetRef)]);
      const data = quotaSnap.exists ? quotaSnap.data() : {};
      const isNewAsset = !assetSnap.exists;
      const pins = data.day === day ? Number(data.pins || 0) : 0;
      const bytesTotal = Number(data.bytesTotal || 0);
      if (pins + 1 > PER_CLIENT_DAILY_PINS) {
        throw httpError(`Daily screen-pin limit reached (${PER_CLIENT_DAILY_PINS}/day). Try again tomorrow.`, 429);
      }
      const nextBytes = bytesTotal + (isNewAsset ? ref.bytes : 0);
      if (nextBytes > PER_CLIENT_MAX_STORED_BYTES) {
        throw httpError('Screen-still storage quota reached for this client.', 429);
      }
      tx.set(quotaRef, { day, pins: pins + 1, bytesTotal: nextBytes, updatedAt: new Date(now).toISOString() }, { merge: true });
      if (isNewAsset) {
        tx.set(assetRef, {
          clientId: safeClient, sha256: ref.sha256, ext: ref.ext,
          width: ref.width, height: ref.height, bytes: ref.bytes,
          createdAt: new Date(now).toISOString(),
        });
      }
      reservedNewAsset = isNewAsset;
    });

    // Object write AFTER the reservation — and healed defensively: if the
    // ledger says the asset exists but the object is somehow gone, rewrite
    // it (idempotent content-addressed save; never a second byte charge).
    if (reservedNewAsset) {
      await bucket().file(objectPath).save(buf, { contentType: CONTENT_TYPES[ref.ext] });
    } else {
      const [objectExists] = await bucket().file(objectPath).exists();
      if (!objectExists) await bucket().file(objectPath).save(buf, { contentType: CONTENT_TYPES[ref.ext] });
    }
    return ref;
  } finally {
    await tempFile.delete({ ignoreNotFound: true }).catch(() => {});
  }
}

/**
 * Internal/test byte-level pin (the original data-URL path's core, kept for
 * the finalize step above and for tests — the ROUTE no longer accepts bytes
 * in a JSON body; see startDeviceScreenStillUpload).
 */
async function pinDeviceScreenStill({ clientId, dataUrl, buffer }) {
  if (!clientId) throw httpError('clientId is required.', 400);
  let buf = buffer;
  if (!buf) {
    if (typeof dataUrl !== 'string') throw httpError('dataUrl or buffer is required.', 400);
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw httpError('dataUrl must be a base64 data: URL of type image/png, image/jpeg, or image/webp.', 400);
    buf = Buffer.from(m[2], 'base64');
  }
  const ref = validateStillBytes(buf);
  await bucket().file(stillStoragePath(clientId, ref.sha256, ref.ext)).save(buf, { contentType: CONTENT_TYPES[ref.ext] });
  return ref;
}

/** clientId-scoped existence check — the job-creation gate. A foreign client's hash resolves under ITS OWN prefix and therefore never finds another tenant's object. */
async function deviceScreenStillExists({ clientId, still }) {
  const ref = sanitizeScreenStillRef(still);
  if (!ref) return false;
  const [exists] = await bucket().file(stillStoragePath(clientId, ref.sha256, ref.ext)).exists();
  return Boolean(exists);
}

/**
 * Downloads the still to `destPath` (a local file the render page will load
 * with zero network) and re-verifies the content hash — a corrupted or
 * substituted object fails loudly BEFORE any frame is captured, never after.
 */
async function downloadDeviceScreenStill({ clientId, still, destPath }) {
  const ref = sanitizeScreenStillRef(still);
  if (!ref) throw httpError('Invalid screen-still reference.', 400);
  const [buf] = await bucket().file(stillStoragePath(clientId, ref.sha256, ref.ext)).download();
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (actual !== ref.sha256) {
    throw httpError('Screen-still content hash mismatch — the stored object does not match the pinned reference.', 500);
  }
  const { writeFile } = require('node:fs/promises');
  await writeFile(destPath, buf);
  return { bytes: buf.length };
}

module.exports = {
  PREFIX,
  TMP_PREFIX,
  MAX_STILL_BYTES,
  MIN_DIMENSION,
  MAX_DIMENSION,
  MAX_TOTAL_PIXELS,
  PER_CLIENT_DAILY_PINS,
  PER_CLIENT_MAX_STORED_BYTES,
  QUOTA_COLLECTION,
  ASSET_COLLECTION,
  ALLOWED_EXTS,
  parseImageBytes,
  sanitizeScreenStillRef,
  stillStoragePath,
  startDeviceScreenStillUpload,
  finalizeDeviceScreenStillUpload,
  pinDeviceScreenStill,
  deviceScreenStillExists,
  downloadDeviceScreenStill,
  __setTestContext,
};
