'use strict';

// Lane 2 (phone/camera-roll upload) intake — worker side. The NAS worker
// (W3, a separate agent/repo) polls GET for UPLOADED objects, downloads them
// to a scratch dir, and reports progress back through PATCH. DELETE is the
// only path that ever removes the Firebase object, and only once the intake
// doc is ARCHIVED (i.e. the worker's own Arweave upload already succeeded
// for that sha256 — see docs/archive/INTAKE_CONTRACT.md § purge rule).
//
// D1 (master plan): nothing here ever writes the NAS. This module only talks
// to Firestore + the EditVideos-bridge Firebase Storage bucket.

const fb = require('./firebase-admin.cjs');
const { bridgeBucket } = require('./editvideos-bridge.cjs');
const {
  UPLOADED_STATE,
  FAILED_STATE,
  isValidWorkerTransition,
  isValidPurgeTransition,
  PURGED_STATE,
} = require('./archive-intake-transitions.cjs');

const COLLECTION = 'archive_intake';
const SIGNED_DOWNLOAD_TTL_MS = 30 * 60 * 1000;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

/**
 * GET /api/archive/worker/intake?workerId= handler — every UPLOADED intake
 * doc, each with a fresh signed GET URL for the worker to download.
 * workerId is required for symmetry with every other worker route/log line,
 * not as a claim filter — nothing is assigned to a worker until it PATCHes
 * that doc to CLAIMED.
 */
async function listUploadedForWorker({ workerId }) {
  if (!workerId) throw httpError('workerId is required.', 400);

  const snap = await fb.adminDb.collection(COLLECTION).where('state', '==', UPLOADED_STATE).limit(50).get();
  const items = await Promise.all(snap.docs.map(async (d) => {
    const x = d.data();
    let downloadUrl = null;
    try {
      const [url] = await bridgeBucket().file(x.storagePath).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_DOWNLOAD_TTL_MS,
      });
      downloadUrl = url;
    } catch {
      downloadUrl = null; // object may have raced to PURGED between the query and the sign call
    }
    return {
      intakeId: d.id,
      storagePath: x.storagePath,
      fileName: x.fileName || null,
      contentType: x.contentType || null,
      sizeBytes: Number(x.sizeBytes || 0),
      downloadUrl,
      createdAt: x.createdAt || null,
    };
  }));
  return items.filter((item) => item.downloadUrl);
}

/**
 * PATCH /api/archive/worker/intake handler — one validated state transition.
 * Never trusts the caller's claimed `fromState`; always re-reads the doc.
 */
async function applyWorkerTransition({ intakeId, workerId, state, sha256, contentAssetId, error }) {
  if (!intakeId) throw httpError('intakeId is required.', 400);
  if (!workerId) throw httpError('workerId is required.', 400);
  if (!state) throw httpError('state is required.', 400);

  const ref = fb.adminDb.collection(COLLECTION).doc(String(intakeId));
  const snap = await ref.get();
  if (!snap.exists) throw httpError('Intake record not found.', 404);
  const doc = snap.data();

  if (!isValidWorkerTransition(doc.state, state)) {
    throw httpError(`Illegal transition ${doc.state} -> ${state}.`, 409);
  }

  // Ownership: once a doc is claimed, only that worker may advance it
  // further (except reporting FAILED, which any worker may do so a crashed
  // claimant's job doesn't wedge the queue forever).
  if (doc.claimedBy && doc.claimedBy !== String(workerId) && state !== FAILED_STATE) {
    throw httpError(`Intake is claimed by a different worker (${doc.claimedBy}).`, 409);
  }

  if (state === FAILED_STATE && !error) {
    throw httpError('error is required when reporting FAILED.', 400);
  }
  if (state === 'HASHED' && !sha256 && !doc.sha256) {
    throw httpError('sha256 is required to transition to HASHED.', 400);
  }

  const patch = { state, updatedAt: fb.FieldValue.serverTimestamp() };
  if (state === 'CLAIMED') patch.claimedBy = String(workerId);
  if (sha256) patch.sha256 = String(sha256);
  if (contentAssetId) patch.contentAssetId = String(contentAssetId);
  if (state === FAILED_STATE) patch.error = String(error);
  else if (error === null) patch.error = null; // explicit clear, e.g. a later successful retry

  await ref.set(patch, { merge: true });
  return { intakeId, state };
}

/**
 * DELETE /api/archive/worker/intake handler — the only path that removes the
 * Firebase object. Requires state === ARCHIVED (the worker's own successful
 * Arweave upload already happened by the time it calls this) and ownership
 * by the claiming worker.
 */
async function purgeArchivedIntake({ intakeId, workerId }) {
  if (!intakeId) throw httpError('intakeId is required.', 400);
  if (!workerId) throw httpError('workerId is required.', 400);

  const ref = fb.adminDb.collection(COLLECTION).doc(String(intakeId));
  const snap = await ref.get();
  if (!snap.exists) throw httpError('Intake record not found.', 404);
  const doc = snap.data();

  if (!isValidPurgeTransition(doc.state)) {
    throw httpError(`Cannot purge from state ${doc.state}; only ARCHIVED may be purged.`, 409);
  }
  if (doc.claimedBy && doc.claimedBy !== String(workerId)) {
    throw httpError(`Intake is claimed by a different worker (${doc.claimedBy}).`, 409);
  }

  if (doc.storagePath) {
    await bridgeBucket().file(doc.storagePath).delete({ ignoreNotFound: true });
  }

  await ref.set({ state: PURGED_STATE, updatedAt: fb.FieldValue.serverTimestamp() }, { merge: true });
  return { intakeId, state: PURGED_STATE };
}

module.exports = {
  COLLECTION,
  listUploadedForWorker,
  applyWorkerTransition,
  purgeArchivedIntake,
};
