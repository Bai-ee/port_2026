'use strict';

// Lane 2 (phone/camera-roll upload) intake — HITLOOP/browser side. Mints the
// signed PUT URL a phone uploads directly to (never proxies the bytes
// through a Vercel function — see VERCEL-HOBBY-DEPLOYMENT.md), then confirms
// the object actually landed before flipping the intake doc to UPLOADED.
// Firebase is a transient inbox (D3 in the master plan): the worker
// (archive-worker-intake.cjs) is the only thing that ever deletes the object,
// and only after a confirmed Arweave upload.
//
// See docs/archive/INTAKE_CONTRACT.md for the full field/route contract.

const { randomUUID } = require('crypto');
const fb = require('./firebase-admin.cjs');
const { bridgeBucket, ensureUploadCors } = require('./editvideos-bridge.cjs');
const {
  PENDING_UPLOAD_STATE,
  UPLOADED_STATE,
  isValidBrowserUploadConfirm,
  isAllowedIntakeContentType,
  maxBytesForContentType,
  sanitizeIntakeFileName,
} = require('./archive-intake-transitions.cjs');

const COLLECTION = 'archive_intake';
const SIGNED_UPLOAD_TTL_MS = 15 * 60 * 1000; // matches editvideos-bridge.cjs createUploadSession

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function storagePathFor(intakeId, safeFileName) {
  return `archive-intake/${intakeId}/${safeFileName}`;
}

/**
 * POST /api/archive/intake body handler.
 * @returns {{intakeId, uploadUrl, method:'PUT', contentType, storagePath}}
 */
async function createIntake({ fileName, contentType, sizeBytes, createdBy }) {
  if (!isAllowedIntakeContentType(contentType)) {
    throw httpError('contentType must be image/* or video/*.', 400);
  }
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    throw httpError('sizeBytes must be a positive number.', 400);
  }
  const cap = maxBytesForContentType(contentType);
  if (size > cap) {
    throw httpError(`File is larger than the ${Math.round(cap / (1024 * 1024))}MB intake limit.`, 400);
  }

  const safeFileName = sanitizeIntakeFileName(fileName);
  const intakeId = randomUUID();
  const storagePath = storagePathFor(intakeId, safeFileName);

  try {
    await ensureUploadCors();
  } catch (err) {
    throw httpError(`Could not configure intake upload CORS: ${err?.message || err}`, 503);
  }

  const [uploadUrl] = await bridgeBucket().file(storagePath).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + SIGNED_UPLOAD_TTL_MS,
    contentType,
  });

  await fb.adminDb.collection(COLLECTION).doc(intakeId).set({
    state: PENDING_UPLOAD_STATE,
    storagePath,
    fileName: String(fileName || '').slice(0, 256),
    contentType: String(contentType),
    sizeBytes: size,
    sha256: null,
    contentAssetId: null,
    createdBy: createdBy || null,
    claimedBy: null,
    error: null,
    createdAt: fb.FieldValue.serverTimestamp(),
    updatedAt: fb.FieldValue.serverTimestamp(),
  });

  return { intakeId, uploadUrl, method: 'PUT', contentType, storagePath };
}

/**
 * PATCH /api/archive/intake body handler. The browser may only ever confirm
 * an upload — no other state is reachable from this route.
 * @returns {{intakeId, state:'UPLOADED'}}
 */
async function markUploaded({ intakeId, sizeBytes }) {
  if (!intakeId) throw httpError('intakeId is required.', 400);

  const ref = fb.adminDb.collection(COLLECTION).doc(String(intakeId));
  const snap = await ref.get();
  if (!snap.exists) throw httpError('Intake record not found.', 404);
  const doc = snap.data();

  if (!isValidBrowserUploadConfirm(doc.state)) {
    throw httpError(`Cannot confirm upload from state ${doc.state}.`, 409);
  }
  if (doc.state === UPLOADED_STATE) {
    return { intakeId, state: UPLOADED_STATE }; // idempotent — already confirmed
  }

  const file = bridgeBucket().file(doc.storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw httpError('Upload object was not found in storage yet. Try again once the upload finishes.', 409);
  }

  // Prefer the byte count Storage actually recorded; fall back to whatever
  // the browser reported so the field is never left empty.
  let actualSize = Number(sizeBytes) || doc.sizeBytes || 0;
  try {
    const [metadata] = await file.getMetadata();
    if (metadata?.size != null) actualSize = Number(metadata.size);
  } catch {
    // Non-fatal — the fake/local bucket in tests has no getMetadata(); real
    // Storage always has it, and existence was already verified above.
  }

  await ref.set({
    state: UPLOADED_STATE,
    sizeBytes: actualSize,
    updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { intakeId, state: UPLOADED_STATE };
}

/**
 * GET /api/archive/intake?limit= handler — recent intake docs, newest first.
 */
async function listRecentIntake({ limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const snap = await fb.adminDb.collection(COLLECTION).orderBy('createdAt', 'desc').limit(safeLimit).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      state: x.state,
      fileName: x.fileName || null,
      contentType: x.contentType || null,
      sizeBytes: Number(x.sizeBytes || 0),
      sha256: x.sha256 || null,
      contentAssetId: x.contentAssetId || null,
      claimedBy: x.claimedBy || null,
      error: x.error || null,
      createdAt: x.createdAt || null,
      updatedAt: x.updatedAt || null,
    };
  });
}

module.exports = {
  COLLECTION,
  createIntake,
  markUploaded,
  listRecentIntake,
};
