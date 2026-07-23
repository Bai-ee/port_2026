'use strict';

// studio-glb-assets.cjs — GLB asset library for the Studio Elements GLB
// import phase (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md "GLB
// import and asset safety"). Uploads go directly browser -> Storage via a
// v4 signed PUT URL (never proxied through this Vercel function — the plan
// explicitly requires this); this module mints those URLs, then on confirm
// downloads the (small, size-capped) object ONCE to validate it and record
// an immutable Firestore asset doc. Firestore/Storage dependencies are
// reached through ctx() so tests can inject a fake, mirroring media-
// assets.cjs's own test seam — see api/_lib/__tests__/studio-glb-assets.
// test.js for exactly what is and isn't unit-tested here (the pure
// binary/JSON parsing and validation logic is; live Storage/Firestore calls
// are not, same convention as editvideos-bridge.cjs).

const { randomUUID } = require('crypto');
const realFb = require('./firebase-admin.cjs');

const COLLECTION = 'studio_glb_assets';
const GLB_MAGIC = 0x46546c67; // 'glTF', little-endian
const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON', little-endian
const SIGNED_UPLOAD_TTL_MS = 15 * 60 * 1000;
const SIGNED_READ_TTL_MS = 60 * 60 * 1000; // list/confirm always mint a FRESH one — never persisted, so expiry is a non-issue
const CORS_CACHE_TTL_MS = 5 * 60 * 1000;

// "Optimized" per the plan's own framing (not a raw/unoptimized-asset dump)
// — deliberately smaller than this repo's video caps (editvideos-bridge.cjs
// MAX_VIDEO_UPLOAD_BYTES). Count caps are a first, deliberately generous
// pass (a decorative Studio hero element, not a game-engine asset budget) —
// not scientifically tuned, easy to revisit once real uploads are observed.
const MAX_GLB_UPLOAD_BYTES = 25 * 1024 * 1024;
const SAFETY_CAPS = {
  maxNodes: 500,
  maxMeshes: 200,
  maxMaterials: 100,
  maxTextures: 50,
  maxAnimations: 20,
  maxTriangles: 500_000,
};

// --- test seam ---------------------------------------------------------------
let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

// --- pure helpers (firebase-free, unit-testable) ------------------------------

function sanitizeFileName(name) {
  const base = String(name || 'asset.glb').split('/').pop().split('\\').pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'asset.glb';
  return cleaned.toLowerCase().endsWith('.glb') ? cleaned : `${cleaned}.glb`;
}

function storagePathForAsset(assetId, fileName) {
  return `studio-glb-assets/${assetId}/${sanitizeFileName(fileName)}`;
}

/**
 * True only if `path` sits inside the exact `studio-glb-assets/<assetId>/`
 * namespace for the GIVEN assetId — confirmUpload's binding check, so a
 * caller can't point confirm at some other asset's (or an entirely
 * unrelated) Storage object using a spoofed storagePath.
 */
function isPathWithinAssetNamespace(assetId, path) {
  const id = String(assetId || '');
  const p = String(path || '');
  if (!id || !p) return false;
  const prefix = `studio-glb-assets/${id}/`;
  return p.startsWith(prefix) && p.length > prefix.length;
}

/**
 * Parse a binary GLB's 12-byte header + first (JSON) chunk. Throws a
 * descriptive error on anything that isn't well-formed binary glTF 2.0 —
 * never returns a best-effort partial parse. Deliberately does not decode
 * the BIN chunk (chunk 2) at all — every check this module needs (node/
 * mesh/material/texture/animation counts, self-containment) lives entirely
 * in the JSON chunk.
 */
function parseGLBJson(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) throw new Error('File is too small to be a valid .glb.');
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Not a binary glTF (.glb) file — missing the glTF magic header.');
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported glTF binary version ${version} — only version 2 is accepted.`);
  const totalLength = buffer.readUInt32LE(8);
  // Exact match, not just "doesn't exceed" — a declared length SHORTER than
  // the actual bytes would let trailing, unvalidated data ride along past
  // every check below (nothing here reads past `totalLength`, so extra
  // bytes after it are otherwise invisible to this validator entirely).
  if (totalLength !== buffer.length) throw new Error('Declared file length does not match the actual uploaded byte count — truncated, corrupt, or has trailing bytes.');
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  if (chunkType !== JSON_CHUNK_TYPE) throw new Error('First chunk is not JSON — malformed .glb.');
  // Bounded against the DECLARED total length (now proven == buffer.length
  // above), not a separately-trusted buffer.length — every chunk read stays
  // within the boundary the header itself declares.
  if (20 + chunkLength > totalLength) throw new Error('JSON chunk length exceeds the declared file bounds — truncated or corrupt upload.');
  const jsonText = buffer.toString('utf8', 20, 20 + chunkLength);
  let json;
  try {
    json = JSON.parse(jsonText);
  } catch {
    throw new Error('JSON chunk is not valid JSON — malformed .glb.');
  }
  if (!json || typeof json !== 'object') throw new Error('JSON chunk did not parse to an object — malformed .glb.');
  return json;
}

/**
 * Reject a purported self-contained GLB that actually references external
 * network/file resources: every buffer/image must be embedded (no `.uri`,
 * i.e. binary-chunk-backed) or a `data:` URI — an `http(s)://` or bare
 * relative-path `.uri` (expecting a sibling file the browser would have to
 * fetch separately) is rejected. Returns a description string on the FIRST
 * violation found, or null if the asset is genuinely self-contained.
 */
function findExternalUriViolation(json) {
  const isExternal = (uri) => typeof uri === 'string' && uri.length > 0 && !uri.startsWith('data:');
  for (const buf of (Array.isArray(json.buffers) ? json.buffers : [])) {
    if (isExternal(buf?.uri)) return `a buffer references an external URI (${buf.uri})`;
  }
  for (const img of (Array.isArray(json.images) ? json.images : [])) {
    if (isExternal(img?.uri)) return `an image references an external URI (${img.uri})`;
  }
  return null;
}

// glTF primitive draw modes (spec §5.24.4) — only these two produce
// triangles; POINTS/LINES/LINE_LOOP/LINE_STRIP contribute none. `mode`
// defaults to 4 (TRIANGLES) when omitted, per spec.
const GLTF_MODE_TRIANGLES = 4;
const GLTF_MODE_TRIANGLE_STRIP = 5;
const GLTF_MODE_TRIANGLE_FAN = 6;

/**
 * Triangle count for ONE primitive, mode-aware. TRIANGLES: floor(count/3).
 * TRIANGLE_STRIP/TRIANGLE_FAN: count-2 (each vertex past the first two adds
 * one triangle), floored at 0 for a degenerate 0/1/2-vertex primitive.
 * Everything else (points/lines) contributes zero — inventing a triangle
 * count for a non-triangle primitive would be worse than under-counting.
 * Still an estimate (indices/POSITION accessor count, not degenerate/
 * duplicate-aware), documented as such, not a GPU-exact count.
 */
function triangleCountForPrimitive(prim, accessors) {
  const mode = Number.isInteger(prim.mode) ? prim.mode : GLTF_MODE_TRIANGLES;
  const accessorIndex = Number.isInteger(prim.indices) ? prim.indices : prim.attributes?.POSITION;
  const count = Number.isInteger(accessorIndex) ? (accessors[accessorIndex]?.count || 0) : 0;
  if (mode === GLTF_MODE_TRIANGLES) return Math.floor(count / 3);
  if (mode === GLTF_MODE_TRIANGLE_STRIP || mode === GLTF_MODE_TRIANGLE_FAN) return Math.max(0, count - 2);
  return 0;
}

/**
 * Cheap topology counts straight from the glTF JSON chunk — no full mesh
 * decode.
 */
function countGLBStats(json) {
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  let triangleEstimate = 0;
  meshes.forEach((mesh) => {
    (Array.isArray(mesh.primitives) ? mesh.primitives : []).forEach((prim) => {
      triangleEstimate += triangleCountForPrimitive(prim, accessors);
    });
  });
  const animations = Array.isArray(json.animations) ? json.animations : [];
  return {
    nodeCount: Array.isArray(json.nodes) ? json.nodes.length : 0,
    meshCount: meshes.length,
    materialCount: Array.isArray(json.materials) ? json.materials.length : 0,
    textureCount: Array.isArray(json.textures) ? json.textures.length : 0,
    animationCount: animations.length,
    animationNames: animations.map((a, i) => String(a?.name || `Animation ${i + 1}`)),
    triangleEstimate,
  };
}

/**
 * Full safety validation: byte size, well-formedness, self-containment,
 * and every count cap. Throws a single descriptive Error on the FIRST
 * violation found — never a partial/best-effort accept. Returns the
 * counted stats on success.
 *
 * Known, documented gap (not silently glossed over): texture PIXEL
 * dimensions are not inspected — doing so would require decoding image
 * bytes (PNG/JPEG/KTX2 header parsing), out of scope for this first
 * slice. Texture COUNT is enforced; texture SIZE is not yet.
 */
function validateGLBSafety(buffer, { maxBytes = MAX_GLB_UPLOAD_BYTES, caps = SAFETY_CAPS } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('No file bytes to validate.');
  if (buffer.length > maxBytes) {
    throw new Error(`File is ${(buffer.length / 1024 / 1024).toFixed(1)}MB — the limit is ${(maxBytes / 1024 / 1024).toFixed(0)}MB. Compress with Draco/Meshopt and re-export.`);
  }
  const json = parseGLBJson(buffer);
  const externalViolation = findExternalUriViolation(json);
  if (externalViolation) throw new Error(`Not self-contained — ${externalViolation}. Re-export with textures/buffers embedded.`);
  const stats = countGLBStats(json);
  if (stats.nodeCount > caps.maxNodes) throw new Error(`${stats.nodeCount} nodes exceeds the ${caps.maxNodes} cap.`);
  if (stats.meshCount > caps.maxMeshes) throw new Error(`${stats.meshCount} meshes exceeds the ${caps.maxMeshes} cap.`);
  if (stats.materialCount > caps.maxMaterials) throw new Error(`${stats.materialCount} materials exceeds the ${caps.maxMaterials} cap.`);
  if (stats.textureCount > caps.maxTextures) throw new Error(`${stats.textureCount} textures exceeds the ${caps.maxTextures} cap.`);
  if (stats.animationCount > caps.maxAnimations) throw new Error(`${stats.animationCount} animations exceeds the ${caps.maxAnimations} cap.`);
  if (stats.triangleEstimate > caps.maxTriangles) throw new Error(`~${stats.triangleEstimate.toLocaleString()} triangles exceeds the ${caps.maxTriangles.toLocaleString()} cap.`);
  return stats;
}

// --- Storage/Firestore (real Firebase — not unit-tested here, see file header) ---

function bucket() { return ctx().adminStorage.bucket(); }

let _corsCache = { at: 0, ok: false };
/**
 * Same additive, idempotent, cached pattern as editvideos-bridge.cjs's
 * ensureUploadCors — merges a rule into the bucket's EXISTING cors array,
 * never replaces it. Required for the LIVE PREVIEW to work at all: without
 * it, the browser's GLTFLoader fetch() of a signed read URL is blocked by
 * the browser's own cross-origin policy before any of our code runs.
 */
async function ensureStudioBucketCors() {
  const now = Date.now();
  if (_corsCache.ok && now - _corsCache.at < CORS_CACHE_TTL_MS) return;
  const b = bucket();
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').trim().replace(/\/$/, '');
  const origins = Array.from(new Set(['http://localhost:3000', 'http://localhost:3001', siteUrl, vercelUrl].filter(Boolean)));
  const desiredRule = {
    origin: origins,
    method: ['OPTIONS', 'PUT', 'GET', 'HEAD'],
    responseHeader: ['Content-Type', 'Content-Length', 'x-goog-resumable'],
    maxAgeSeconds: 3600,
  };
  const [metadata] = await b.getMetadata();
  const currentCors = Array.isArray(metadata?.cors) ? metadata.cors : [];
  const covers = currentCors.some((rule) => {
    const ruleOrigins = Array.isArray(rule?.origin) ? rule.origin : [];
    const methods = Array.isArray(rule?.method) ? rule.method.map((m) => String(m).toUpperCase()) : [];
    return origins.every((o) => ruleOrigins.includes(o) || ruleOrigins.includes('*')) && ['GET', 'PUT'].every((m) => methods.includes(m));
  });
  if (!covers) await b.setMetadata({ cors: [...currentCors, desiredRule] });
  _corsCache = { at: now, ok: true };
}

/** Mint a v4 signed PUT URL for a brand-new asset id. No Firestore doc is written yet — an upload that's never confirmed leaves no library entry. */
async function createUploadUrl({ fileName, sizeBytes }) {
  const size = Number(sizeBytes) || 0;
  if (size <= 0) throw new Error('sizeBytes is required.');
  if (size > MAX_GLB_UPLOAD_BYTES) throw new Error(`File is ${(size / 1024 / 1024).toFixed(1)}MB — the limit is ${(MAX_GLB_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB.`);
  await ensureStudioBucketCors();
  const assetId = randomUUID();
  const storagePath = storagePathForAsset(assetId, fileName);
  const [uploadUrl] = await bucket().file(storagePath).getSignedUrl({
    version: 'v4', action: 'write', expires: Date.now() + SIGNED_UPLOAD_TTL_MS, contentType: 'model/gltf-binary',
  });
  return {
    assetId, storagePath, uploadUrl, method: 'PUT', headers: { 'content-type': 'model/gltf-binary' },
    expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_MS).toISOString(),
  };
}

/**
 * Confirms a completed upload: binds the client-supplied storagePath to the
 * given assetId's own namespace (rejects anything outside
 * `studio-glb-assets/<assetId>/…` — a client can't point confirm at a
 * different asset's or an unrelated object), checks the REAL object size
 * from Storage metadata BEFORE downloading anything (a client-declared
 * sizeBytes at request-upload time is advisory only — nothing about a
 * signed PUT URL enforces the uploaded object's actual length), and only
 * then downloads — pinned to the exact object `generation` just checked, so
 * a write that replaces the object between the metadata check and the
 * download can't slip a different, unchecked payload through. Only a
 * successful validation writes the immutable Firestore asset doc; any
 * rejection (oversized, malformed, unsafe) deletes the Storage object
 * rather than leaving an invalid, un-indexed orphan behind.
 */
async function confirmUpload({ assetId, storagePath, fileName }) {
  const id = String(assetId || '');
  const path = String(storagePath || '');
  if (!id || !path) throw new Error('assetId and storagePath are required.');
  if (!isPathWithinAssetNamespace(id, path)) {
    throw new Error('storagePath does not belong to the given assetId.');
  }
  const file = bucket().file(path);
  const [metadata] = await file.getMetadata().catch(() => [null]);
  if (!metadata) throw new Error('Uploaded object not found — the upload may have failed, been removed, or expired.');
  const actualSize = Number(metadata.size) || 0;
  if (actualSize > MAX_GLB_UPLOAD_BYTES) {
    await file.delete().catch(() => {});
    throw new Error(`Uploaded object is ${(actualSize / 1024 / 1024).toFixed(1)}MB — exceeds the ${(MAX_GLB_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB limit. Rejected before download.`);
  }
  const [buffer] = await file.download({ generation: metadata.generation });
  let stats;
  try {
    stats = validateGLBSafety(buffer);
  } catch (err) {
    await file.delete().catch(() => {});
    throw err;
  }
  const doc = {
    assetId: id,
    fileName: sanitizeFileName(fileName),
    storagePath: path,
    sizeBytes: buffer.length,
    ...stats,
    createdAt: new Date().toISOString(),
  };
  await ctx().adminDb.collection(COLLECTION).doc(id).set(doc);
  return doc;
}

async function mintReadUrl(storagePath) {
  const [url] = await bucket().file(storagePath).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + SIGNED_READ_TTL_MS });
  return url;
}

/** Most-recent-first, capped. Every entry gets a FRESH signed read URL minted at request time — nothing expiry-sensitive is ever persisted. */
async function listAssets({ limit = 50 } = {}) {
  await ensureStudioBucketCors();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const snap = await ctx().adminDb.collection(COLLECTION).orderBy('createdAt', 'desc').limit(safeLimit).get();
  const docs = snap.docs.map((d) => d.data());
  return Promise.all(docs.map(async (doc) => ({ ...doc, readUrl: await mintReadUrl(doc.storagePath) })));
}

async function deleteAsset(assetId) {
  const id = String(assetId || '');
  if (!id) throw new Error('assetId is required.');
  const ref = ctx().adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;
  if (data?.storagePath) await bucket().file(data.storagePath).delete().catch(() => {});
  await ref.delete();
  return { assetId: id };
}

module.exports = {
  MAX_GLB_UPLOAD_BYTES,
  SAFETY_CAPS,
  sanitizeFileName,
  storagePathForAsset,
  isPathWithinAssetNamespace,
  parseGLBJson,
  findExternalUriViolation,
  triangleCountForPrimitive,
  countGLBStats,
  validateGLBSafety,
  createUploadUrl,
  confirmUpload,
  listAssets,
  deleteAsset,
  __setTestContext,
  COLLECTION,
};
