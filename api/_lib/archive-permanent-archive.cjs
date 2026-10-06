'use strict';

// Permanent Archive orchestration (W7a) — docs/archive/PERMANENT_ARCHIVE_CONTRACT.md.
//
// Owner-locked direction: no per-asset approval click, no collection form.
// Once an asset is documented (hashed, TwelveLabs evidence READY, six Jev
// decisions present) this module auto-enqueues its permanent Arweave
// upload, builds & versions its archive-record JSON, and rebuilds the
// collection manifest — all via UPLOAD_JSON commands the worker executes
// (the Arweave wallet lives only on the worker; HITLOOP never uploads bytes
// itself). Humans review AFTER, as corrections that mint a new record
// version, never as a gate.
//
// Every exported function here is the real logic behind the thin route
// wrappers (app/api/archive/worker/assets, .../commands/worker,
// app/api/archive/review, app/api/archive/arweave/collection,
// app/api/archive/approved) — same pattern as archive-worker-intake.cjs.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('crypto');

const fb = require('./firebase-admin.cjs');
const { buildArchiveRecord, resolveDecisionValue, basename } = require('./archive-record.cjs');
const { buildCollectionManifestV11 } = require('./archive-manifest.cjs');
const { estimateArchiveCostLive } = require('./archive-arweave.cjs');

const IN_FLIGHT_STATES = ['QUEUED', 'CLAIMED', 'RUNNING'];
const UPLOAD_ACTIVE_STATES = ['QUEUED', 'CLAIMED', 'RUNNING', 'COMPLETE'];
const JUNK_NAME_RE = /(^|[\\/])(\._[^\\/]+|\.DS_Store)$/i;

// ── collection identity (shared contract §E) ────────────────────────────

/** id = slug of the job's relativePath (lowercase, non-alnum -> '-', trimmed; '.' root -> 'root'). */
function slugifyCollectionId(relativePath) {
  const trimmed = String(relativePath == null ? '.' : relativePath).trim();
  if (trimmed === '.' || trimmed === '') return 'root';
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'root';
}

/** title = the last path segment, as-is. */
function collectionTitleFromPath(relativePath) {
  const trimmed = String(relativePath == null ? '.' : relativePath).trim();
  if (trimmed === '.' || trimmed === '') return 'root';
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : trimmed;
}

/**
 * jobId -> the PROCESS_COLLECTION command that carries it -> relativePath -> collection id/title.
 * The worker's asset-sync payload only carries `collectionJobId`; the command
 * doc gets `jobId` set by the generic commands/worker PATCH (CLAIMED onward).
 */
async function resolveCollectionForJob({ collectionJobId }) {
  if (!collectionJobId) return null;
  const snap = await fb.adminDb.collection('archive_commands')
    .where('type', '==', 'PROCESS_COLLECTION')
    .where('jobId', '==', String(collectionJobId))
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc) return null;
  const relativePath = doc.data().relativePath || '.';
  return { id: slugifyCollectionId(relativePath), title: collectionTitleFromPath(relativePath), relativePath };
}

// ── kill switch (W-A, docs/plans/ARCHIVE-NAS-STAGING-MASTER-PLAN-2026-09-20.md §3c) ─
//
// After the first automatic Arweave batch ran the wallet dry (3 uploads
// FAILED 402), the owner locked a new rule: NO automatic Arweave upload,
// ever, until an explicit per-collection approval (built later in W-C).
// `archive_settings/permanence.autoUpload` is that switch — missing doc or
// missing field reads as `false` (fail closed), same pattern as the
// existing `archive_settings/viewer` doc read in deployViewerIfChanged.
async function readPermanenceSettings() {
  const snap = await fb.adminDb.collection('archive_settings').doc('permanence').get();
  const data = snap.exists ? snap.data() : null;
  return { autoUpload: data?.autoUpload === true };
}

// ── auto-enqueue on documentation (item 1) ──────────────────────────────

function isJunkPath(p) {
  return JUNK_NAME_RE.test(String(p || ''));
}

const EXT_CONTENT_TYPES = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo', webm: 'video/webm', mkv: 'video/x-matroska',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf',
};

function guessContentType({ archiveName, mediaType }) {
  const ext = String(archiveName || '').split('.').pop()?.toLowerCase();
  if (ext && EXT_CONTENT_TYPES[ext]) return EXT_CONTENT_TYPES[ext];
  const mt = String(mediaType || '').toLowerCase();
  if (mt.startsWith('video')) return 'video/mp4';
  if (mt.startsWith('image')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function hasActiveUploadCommand(contentAssetId) {
  const snap = await fb.adminDb.collection('archive_commands')
    .where('type', '==', 'UPLOAD_ASSET_ARWEAVE')
    .where('contentAssetId', '==', String(contentAssetId))
    .get();
  return snap.docs.some((d) => UPLOAD_ACTIVE_STATES.includes(d.data().state));
}

/**
 * Auto-enqueue UPLOAD_ASSET_ARWEAVE once an asset is "documented": >=1 READY
 * observation, >=6 decisions, and at least one non-junk (not `._*`/.DS_Store)
 * source location. Idempotent — a second call for the same asset while a
 * command is QUEUED/CLAIMED/RUNNING/COMPLETE is a no-op.
 *
 * Kill switch (W-A): even when every "documented" condition above is met,
 * this never enqueues unless BOTH (1) `archive_settings/permanence.autoUpload
 * === true` and (2) this specific asset's `archive_review.state ===
 * 'ARWEAVE_APPROVED'` — a state only W-C's per-collection approval flow
 * writes. The flag alone is not enough: it is the global kill switch, while
 * ARWEAVE_APPROVED is the per-asset owner sign-off it gates access to. Until
 * W-C ships, no caller ever sets that state, so this function is a
 * structural no-op regardless of the flag.
 *
 * Returns the new commandId on a real enqueue, `null` for the pre-existing
 * "not documented yet" / "already in flight" no-ops (unchanged, so the only
 * caller's `Boolean(commandId)` check keeps working), or a structured
 * `{enqueued:false, skipped:<reason>}` object when blocked by the kill
 * switch — distinct from the other no-ops because these mean the asset IS
 * ready and would have enqueued before this workstream.
 */
async function autoEnqueueArchiveUpload({ workerId, sourceId, reviewId, collectionId, sourcePaths, archiveName, mediaType, sha256, observations, decisions }) {
  const cleanPaths = (sourcePaths || []).filter((p) => !isJunkPath(p));
  if (!cleanPaths.length) return null;
  const hasReadyObservation = (observations || []).some((o) => String(o?.status || '').toUpperCase() === 'READY');
  if (!hasReadyObservation) return null;
  if (!Array.isArray(decisions) || decisions.length < 6) return null;
  if (!workerId || !sourceId || !reviewId || !sha256) return null;
  if (await hasActiveUploadCommand(reviewId)) return null;

  const { autoUpload } = await readPermanenceSettings();
  if (!autoUpload) {
    console.info(`[archive-permanent-archive] auto-upload off — skipping UPLOAD_ASSET_ARWEAVE enqueue for asset ${reviewId} (collection ${collectionId || 'unknown'})`);
    return { enqueued: false, skipped: 'auto-upload-off' };
  }
  const reviewSnap = await fb.adminDb.collection('archive_review').doc(String(reviewId)).get();
  const reviewState = reviewSnap.exists ? reviewSnap.data().state : null;
  if (reviewState !== 'ARWEAVE_APPROVED') {
    console.info(`[archive-permanent-archive] asset ${reviewId} (collection ${collectionId || 'unknown'}) not ARWEAVE_APPROVED (state=${reviewState || 'none'}) — skipping enqueue`);
    return { enqueued: false, skipped: 'not-approved' };
  }

  const relativePath = cleanPaths[0];
  const name = basename(archiveName) || basename(relativePath) || String(reviewId);
  const id = randomUUID();
  await fb.adminDb.collection('archive_commands').doc(id).set({
    id, type: 'UPLOAD_ASSET_ARWEAVE', workerId: String(workerId), sourceId: String(sourceId),
    relativePath: String(relativePath), contentAssetId: String(reviewId),
    collectionId: collectionId ? String(collectionId) : null, archiveName: name,
    contentType: guessContentType({ archiveName: name, mediaType }), expectedSha256: String(sha256),
    state: 'QUEUED', approved: true, createdAt: fb.FieldValue.serverTimestamp(), updatedAt: fb.FieldValue.serverTimestamp(),
  });
  return id;
}

// ── UPLOAD_JSON command plumbing (shared contract §A/§B) ────────────────

function buildUploadJsonTags({ kind, contentType, version, collectionId, sha256, previousTx }) {
  const tags = [
    { name: 'App-Name', value: 'HITLOOP-Archive' },
    { name: 'Archive-Schema', value: '1.1' },
    { name: 'Record-Type', value: kind },
    { name: 'Content-Type', value: contentType },
    { name: 'Version', value: String(version) },
  ];
  if (collectionId) tags.push({ name: 'Collection-ID', value: String(collectionId) });
  if (kind === 'archive-record' && sha256) tags.push({ name: 'Asset-SHA-256', value: String(sha256) });
  if (previousTx) tags.push({ name: 'Previous-Tx', value: String(previousTx) });
  return tags;
}

async function enqueueUploadJsonCommand({ workerId, kind, fileName, contentType, payload, tags, refs }) {
  const id = randomUUID();
  await fb.adminDb.collection('archive_commands').doc(id).set({
    id, type: 'UPLOAD_JSON', workerId: String(workerId), kind, fileName, contentType, payload,
    tags: tags || [], refs: refs || {}, state: 'QUEUED',
    createdAt: fb.FieldValue.serverTimestamp(), updatedAt: fb.FieldValue.serverTimestamp(),
  });
  return id;
}

async function hasActiveArchiveRecordCommand(contentAssetId) {
  const snap = await fb.adminDb.collection('archive_commands')
    .where('type', '==', 'UPLOAD_JSON')
    .where('refs.contentAssetId', '==', String(contentAssetId))
    .get();
  return snap.docs.some((d) => d.data().kind === 'archive-record' && IN_FLIGHT_STATES.includes(d.data().state));
}

async function pickAnyWorkerId() {
  const snap = await fb.adminDb.collection('archive_workers').get();
  if (!snap.docs.length) return null;
  const sorted = [...snap.docs].sort((a, b) => Date.parse(b.data().lastHeartbeatAt || 0) - Date.parse(a.data().lastHeartbeatAt || 0));
  return sorted[0].id;
}

async function pickWorkerIdForCollection(collectionId) {
  if (!collectionId) return pickAnyWorkerId();
  const snap = await fb.adminDb.collection('archive_commands')
    .where('type', '==', 'UPLOAD_ASSET_ARWEAVE')
    .where('collectionId', '==', String(collectionId))
    .get();
  const complete = snap.docs.filter((d) => d.data().state === 'COMPLETE');
  if (complete.length) return complete[complete.length - 1].data().workerId;
  if (snap.docs.length) return snap.docs[snap.docs.length - 1].data().workerId;
  return pickAnyWorkerId();
}

// ── archive-record versioning (item 2) ──────────────────────────────────

/**
 * Build & enqueue the next archive-record JSON version for an asset, once it
 * has a permanent original. No-op (returns null) when: no review doc, no
 * permanent original yet, or a record command is already in flight — in the
 * in-flight case the record doc is marked `dirty:true` so the COMPLETE
 * handler picks the change up as the *next* version once the in-flight one lands.
 */
async function enqueueNextRecordVersionIfNeeded({ contentAssetId, workerId }) {
  if (!contentAssetId) return null;
  const reviewSnap = await fb.adminDb.collection('archive_review').doc(String(contentAssetId)).get();
  if (!reviewSnap.exists) return null;
  const review = reviewSnap.data();

  const uploadsSnap = await fb.adminDb.collection('archive_uploads')
    .where('kind', '==', 'original')
    .where('contentAssetId', '==', String(contentAssetId))
    .limit(1)
    .get();
  const upload = uploadsSnap.docs[0]?.data();
  if (!upload) return null; // not archived yet — nothing to version

  // Kill switch (W-A): a new archive-record JSON is itself an Arweave
  // upload. Block it here too, after the "not archived yet" checks above so
  // those keep returning bare `null` (an existing behavior a caller may
  // still be relying on), but before touching the in-flight/dirty debounce.
  const { autoUpload } = await readPermanenceSettings();
  if (!autoUpload) {
    console.info(`[archive-permanent-archive] auto-upload off — skipping archive-record enqueue for asset ${contentAssetId}`);
    return { enqueued: false, skipped: 'auto-upload-off' };
  }

  const recordRef = fb.adminDb.collection('archive_records').doc(String(contentAssetId));
  const recordSnap = await recordRef.get();
  const existing = recordSnap.exists ? recordSnap.data() : null;

  if (await hasActiveArchiveRecordCommand(contentAssetId)) {
    await recordRef.set({ dirty: true, updatedAt: fb.FieldValue.serverTimestamp() }, { merge: true });
    return null;
  }

  const nextVersion = (existing?.version || 0) + 1;
  const previousTransactionId = existing?.transactionId || null;
  const record = buildArchiveRecord({ review, upload, version: nextVersion, previousTransactionId });
  const chosenWorkerId = workerId || upload.workerId || review.workerId;
  if (!chosenWorkerId) return null;

  const commandId = await enqueueUploadJsonCommand({
    workerId: chosenWorkerId, kind: 'archive-record',
    fileName: `${contentAssetId}-record-v${nextVersion}.json`, contentType: 'application/json', payload: record,
    tags: buildUploadJsonTags({ kind: 'archive-record', contentType: 'application/json', version: nextVersion, collectionId: record.collection.id, sha256: record.asset.sha256, previousTx: previousTransactionId }),
    refs: { contentAssetId: String(contentAssetId), collectionId: record.collection.id || null, version: nextVersion, previousTransactionId },
  });
  return { commandId, version: nextVersion };
}

// ── manifest rebuild (item 3) ────────────────────────────────────────────

/**
 * Rebuild + enqueue the next manifest version for a collection. The caller
 * (maybeRebuildManifest, or the manual fallback) is responsible for the
 * in-flight/dirty debounce gating; this function itself is responsible for
 * the kill switch (see top of function). Returns the new commandId, `null`
 * when there is nothing archived yet for this collection or no worker is
 * available, or `{enqueued:false, skipped:'auto-upload-off'}` when blocked
 * by the kill switch.
 */
async function rebuildManifest(collectionId, workerId) {
  if (!collectionId) return null;
  // Kill switch (W-A): the manifest JSON is itself an Arweave upload. This is
  // the single chokepoint both the automatic path (maybeRebuildManifest) and
  // the manual admin fallback (rebuildManifestManual) enqueue through, so
  // gating here covers both consistently.
  const { autoUpload } = await readPermanenceSettings();
  if (!autoUpload) {
    console.info(`[archive-permanent-archive] auto-upload off — skipping manifest rebuild for collection ${collectionId}`);
    return { enqueued: false, skipped: 'auto-upload-off' };
  }
  const [existingDoc, reviewSnap, uploadsSnap, recordsSnap] = await Promise.all([
    fb.adminDb.collection('archive_collections').doc(String(collectionId)).get(),
    fb.adminDb.collection('archive_review').where('collectionId', '==', String(collectionId)).get(),
    fb.adminDb.collection('archive_uploads').where('kind', '==', 'original').where('collectionId', '==', String(collectionId)).get(),
    fb.adminDb.collection('archive_records').where('collectionId', '==', String(collectionId)).get(),
  ]);
  const existing = existingDoc.exists ? existingDoc.data() : null;
  const uploadsByAsset = new Map(uploadsSnap.docs.map((d) => [d.data().contentAssetId, d.data()]));
  const recordsByAsset = new Map(recordsSnap.docs.map((d) => [d.id, d.data()]));

  const title = existing?.title
    || reviewSnap.docs.find((d) => d.data().collectionTitle)?.data()?.collectionTitle
    || collectionId;

  const rows = [];
  for (const doc of reviewSnap.docs) {
    const review = doc.data();
    const upload = uploadsByAsset.get(doc.id);
    if (!upload) continue; // not archived yet — leave it out of this manifest version
    const record = recordsByAsset.get(doc.id);
    const decisions = (review.decisions || []).map((d) => ({
      id: d.id || d.question, question: d.question || null, value: resolveDecisionValue(d, review.humanConfirmations || {}),
    }));
    rows.push({
      id: doc.id,
      sha256: upload.sha256 || review.sha256 || null,
      sizeBytes: upload.sizeBytes ?? review.sizeBytes ?? null,
      mediaType: review.mediaType || null,
      contentType: upload.contentType || null,
      archiveName: basename(upload.archiveName || review.archiveName) || doc.id,
      originalTransactionId: upload.transactionId,
      originalUrl: upload.arweaveUrl || `https://arweave.net/${upload.transactionId}`,
      recordTransactionId: record?.transactionId || null,
      recordVersion: record?.version || null,
      decisions,
    });
  }
  if (!rows.length) return null;

  const viewerSnap = await fb.adminDb.collection('archive_settings').doc('viewer').get();
  const viewerTransactionId = viewerSnap.exists ? (viewerSnap.data().transactionId || null) : null;

  const nextVersion = (existing?.manifestVersion || 0) + 1;
  const manifest = buildCollectionManifestV11({
    collection: { id: collectionId, title },
    version: nextVersion,
    previousManifestTransactionId: existing?.manifestTransactionId || null,
    assets: rows,
    viewerTransactionId,
  });

  const chosenWorkerId = workerId || await pickWorkerIdForCollection(collectionId);
  if (!chosenWorkerId) return null;

  return enqueueUploadJsonCommand({
    workerId: chosenWorkerId, kind: 'collection-manifest',
    fileName: `${collectionId}-manifest-v${nextVersion}.json`, contentType: 'application/json', payload: manifest,
    tags: buildUploadJsonTags({ kind: 'collection-manifest', contentType: 'application/json', version: nextVersion, collectionId }),
    refs: { collectionId: String(collectionId), version: nextVersion, previousTransactionId: existing?.manifestTransactionId || null, assetCount: rows.length, uploadedCount: rows.length, title },
  });
}

/**
 * The gate: only rebuild when the collection has no UPLOAD_ASSET_ARWEAVE or
 * archive-record UPLOAD_JSON commands still QUEUED/CLAIMED/RUNNING. If a
 * collection-manifest command is itself already in flight, mark the
 * collection dirty instead of double-enqueueing — its own COMPLETE handler
 * re-checks dirty and rebuilds again.
 */
async function maybeRebuildManifest(collectionId, workerId) {
  if (!collectionId) return null;
  const uploadsSnap = await fb.adminDb.collection('archive_commands')
    .where('type', '==', 'UPLOAD_ASSET_ARWEAVE').where('collectionId', '==', String(collectionId)).get();
  if (uploadsSnap.docs.some((d) => IN_FLIGHT_STATES.includes(d.data().state))) return null;

  const jsonSnap = await fb.adminDb.collection('archive_commands')
    .where('type', '==', 'UPLOAD_JSON').where('refs.collectionId', '==', String(collectionId)).get();
  const recordActive = jsonSnap.docs.some((d) => d.data().kind === 'archive-record' && IN_FLIGHT_STATES.includes(d.data().state));
  if (recordActive) return null;

  const manifestActive = jsonSnap.docs.some((d) => d.data().kind === 'collection-manifest' && IN_FLIGHT_STATES.includes(d.data().state));
  if (manifestActive) {
    await fb.adminDb.collection('archive_collections').doc(String(collectionId)).set({ dirty: true, updatedAt: fb.FieldValue.serverTimestamp() }, { merge: true });
    return null;
  }

  return rebuildManifest(collectionId, workerId);
}

/**
 * Admin-triggered fallback (arweave/collection POST {action:'rebuild-manifest'})
 * — bypasses the in-flight gate, but NOT the kill switch. This is a user
 * click (not an automatic path), so instead of the soft `{enqueued:false,
 * skipped:...}` shape used elsewhere in this file, it returns a plain
 * `{ok:false, reason:'auto-upload-off'}` the route hands straight back as
 * JSON (200, not an error) so the page can render an honest "blocked"
 * status rather than treating a truthy response as a queued command.
 */
async function rebuildManifestManual({ collectionId }) {
  if (!collectionId) throw Object.assign(new Error('collectionId required'), { status: 400 });
  const { autoUpload } = await readPermanenceSettings();
  if (!autoUpload) {
    console.info(`[archive-permanent-archive] auto-upload off — rebuild-manifest (manual) blocked for collection ${collectionId}`);
    return { ok: false, reason: 'auto-upload-off' };
  }
  const workerId = await pickWorkerIdForCollection(collectionId);
  if (!workerId) throw Object.assign(new Error('No registered worker available to upload the manifest'), { status: 503 });
  const commandId = await rebuildManifest(collectionId, workerId);
  if (!commandId) throw Object.assign(new Error('Nothing archived yet for this collection'), { status: 409 });
  return { commandId };
}

// ── command COMPLETE dispatch (items 1-3) ────────────────────────────────

async function handleUploadAssetArweaveComplete({ command, result }) {
  if (!result?.transactionId || !result?.contentAssetId) return null;
  await fb.adminDb.collection('archive_uploads').doc(result.transactionId).set({
    kind: 'original', state: 'UPLOADED', transactionId: result.transactionId, contentAssetId: result.contentAssetId,
    arweaveUrl: result.arweaveUrl || null, sizeBytes: result.sizeBytes || null,
    collectionId: result.collectionId || command.collectionId || null, archiveName: result.archiveName || null,
    sha256: result.sha256 || null, contentType: result.contentType || null, sourceId: result.sourceId || null,
    relativePath: result.relativePath || null, workerId: command.workerId || null,
    updatedAt: fb.FieldValue.serverTimestamp(), createdAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  return enqueueNextRecordVersionIfNeeded({ contentAssetId: result.contentAssetId, workerId: command.workerId });
}

async function handleArchiveRecordJsonComplete({ command, result }) {
  const contentAssetId = command.refs?.contentAssetId;
  if (!contentAssetId || !result?.transactionId) return null;
  const version = command.refs?.version || 1;
  const collectionId = command.refs?.collectionId || null;

  const recordRef = fb.adminDb.collection('archive_records').doc(String(contentAssetId));
  const beforeSnap = await recordRef.get();
  const wasDirty = beforeSnap.exists && !!beforeSnap.data().dirty;

  await recordRef.set({
    version, transactionId: result.transactionId, previousTransactionId: command.refs?.previousTransactionId || null,
    arweaveUrl: result.arweaveUrl || null, collectionId, dirty: false,
    updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  await fb.adminDb.collection('archive_review').doc(String(contentAssetId)).set({
    recordTransactionId: result.transactionId, recordVersion: version, updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  if (wasDirty) await enqueueNextRecordVersionIfNeeded({ contentAssetId, workerId: command.workerId });
  await maybeRebuildManifest(collectionId, command.workerId);
  return { contentAssetId, version };
}

async function handleCollectionManifestJsonComplete({ command, result }) {
  const collectionId = command.refs?.collectionId;
  if (!collectionId || !result?.transactionId) return null;
  const version = command.refs?.version || 1;

  const collRef = fb.adminDb.collection('archive_collections').doc(String(collectionId));
  const beforeSnap = await collRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() : null;
  const wasDirty = !!before?.dirty;

  await collRef.set({
    manifestVersion: version, manifestTransactionId: result.transactionId,
    previousManifestTransactionId: command.refs?.previousTransactionId || null,
    manifestUrl: result.arweaveUrl || null,
    assetCount: command.refs?.assetCount ?? before?.assetCount ?? null,
    uploadedCount: command.refs?.uploadedCount ?? before?.uploadedCount ?? null,
    title: command.refs?.title || before?.title || null,
    state: 'ARCHIVED', dirty: false, updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  if (wasDirty) await maybeRebuildManifest(collectionId, command.workerId);
  return { collectionId, version };
}

async function handleViewerJsonComplete({ command, result }) {
  if (!result?.transactionId) return null;
  await fb.adminDb.collection('archive_settings').doc('viewer').set({
    transactionId: result.transactionId, arweaveUrl: result.arweaveUrl || null,
    uploadedAt: fb.FieldValue.serverTimestamp(), sha256: command.refs?.sha256 || null,
  }, { merge: true });
  return { transactionId: result.transactionId };
}

async function handleUploadJsonComplete({ command, result }) {
  const kind = result?.kind || command.kind;
  if (kind === 'archive-record') return handleArchiveRecordJsonComplete({ command, result });
  if (kind === 'collection-manifest') return handleCollectionManifestJsonComplete({ command, result });
  if (kind === 'viewer') return handleViewerJsonComplete({ command, result });
  return null;
}

/** Entry point for the commands/worker PATCH route's COMPLETE branch. */
async function handleCommandComplete({ command, result }) {
  if (!command || !result) return null;
  if (command.type === 'UPLOAD_ASSET_ARWEAVE') return handleUploadAssetArweaveComplete({ command, result });
  if (command.type === 'UPLOAD_JSON') return handleUploadJsonComplete({ command, result });
  return null;
}

// ── review corrections -> next version (item 2, called from review PATCH) ─

async function appendReviewCorrection({ id, decisionId, value, actor }) {
  if (!id || !decisionId || value === undefined || value === null) {
    throw Object.assign(new Error('id, decisionId and value required'), { status: 400 });
  }
  const ref = fb.adminDb.collection('archive_review').doc(String(id));
  const existing = await ref.get();
  if (!existing.exists) throw Object.assign(new Error('Review item not found'), { status: 404 });
  const data = existing.data();

  const previousValue = Object.prototype.hasOwnProperty.call(data.humanConfirmations || {}, decisionId)
    ? data.humanConfirmations[decisionId]
    : null;
  const confirmations = { ...(data.humanConfirmations || {}), [decisionId]: value };
  const required = (data.decisions || []).map((d) => d.id || d.question);
  const complete = required.length > 0 && required.every((key) => Object.prototype.hasOwnProperty.call(confirmations, key));
  const correction = { decisionId, previousValue, value, actor: actor || null, at: new Date().toISOString() };
  const corrections = [...(data.humanCorrections || []), correction];

  await ref.set({
    state: complete ? 'CONFIRMED' : 'REVIEW_PENDING', humanConfirmations: confirmations, humanCorrections: corrections,
    humanDecision: { decisionId, value }, confirmedAt: complete ? fb.FieldValue.serverTimestamp() : null,
    updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  let recordVersionQueued = null;
  try {
    // archive_review is keyed by contentAssetId, so `id` here is that same id.
    const queued = await enqueueNextRecordVersionIfNeeded({ contentAssetId: id });
    if (queued) recordVersionQueued = queued.version;
  } catch {
    // Best-effort: a re-version failure must never block saving the human correction.
    recordVersionQueued = null;
  }
  return { ok: true, state: complete ? 'CONFIRMED' : 'REVIEW_PENDING', recordVersionQueued };
}

// ── viewer deploy (item 4) ───────────────────────────────────────────────

/**
 * Admin-triggered (arweave/collection POST {action:'deploy-viewer'}) — a
 * user click, not an automatic path, but the viewer HTML upload is still a
 * real Arweave spend, so it is gated by the same kill switch. Mirrors
 * rebuildManifestManual's `{ok:false, reason:...}` shape for the same
 * reason: the route hands this straight back as 200 JSON.
 */
async function deployViewerIfChanged() {
  const { autoUpload } = await readPermanenceSettings();
  if (!autoUpload) {
    console.info('[archive-permanent-archive] auto-upload off — viewer deploy blocked');
    return { ok: false, reason: 'auto-upload-off' };
  }
  const filePath = path.resolve(process.cwd(), 'public/archive-viewer/index.html');
  const html = fs.readFileSync(filePath, 'utf8');
  const sha256 = crypto.createHash('sha256').update(html).digest('hex');

  const settingsRef = fb.adminDb.collection('archive_settings').doc('viewer');
  const settingsSnap = await settingsRef.get();
  const existing = settingsSnap.exists ? settingsSnap.data() : null;
  if (existing?.sha256 === sha256) {
    return { skipped: true, reason: 'unchanged', sha256, transactionId: existing.transactionId || null, arweaveUrl: existing.arweaveUrl || null };
  }

  const workerId = await pickAnyWorkerId();
  if (!workerId) throw Object.assign(new Error('No registered worker available to deploy the viewer'), { status: 503 });

  const commandId = await enqueueUploadJsonCommand({
    workerId, kind: 'viewer', fileName: 'archive-viewer-index.html', contentType: 'text/html', payload: html,
    tags: buildUploadJsonTags({ kind: 'viewer', contentType: 'text/html', version: 1 }),
    refs: { sha256 },
  });
  return { skipped: false, commandId, sha256 };
}

// ── page summary (item 6, approved/route.js ?summary=1) ─────────────────

async function getPermanentArchiveSummary() {
  const [collectionsSnap, reviewSnap, uploadsSnap, recordsSnap, commandsSnap, viewerSnap, permanence] = await Promise.all([
    fb.adminDb.collection('archive_collections').get(),
    fb.adminDb.collection('archive_review').get(),
    fb.adminDb.collection('archive_uploads').where('kind', '==', 'original').get(),
    fb.adminDb.collection('archive_records').get(),
    fb.adminDb.collection('archive_commands').get(),
    fb.adminDb.collection('archive_settings').doc('viewer').get(),
    readPermanenceSettings(),
  ]);

  const viewer = viewerSnap.exists ? viewerSnap.data() : null;
  const byCollection = new Map();
  function bucket(id, title) {
    if (!id) return null;
    if (!byCollection.has(id)) {
      byCollection.set(id, {
        id, title: title || id, documented: 0, uploading: 0, uploaded: 0, failed: 0,
        uploadedBytes: 0, recordVersionsTotal: 0,
        manifestVersion: null, manifestTransactionId: null, manifestUrl: null, assetCount: null,
      });
    }
    const b = byCollection.get(id);
    if (title && b.title === b.id) b.title = title;
    return b;
  }

  for (const doc of collectionsSnap.docs) {
    const d = doc.data();
    const b = bucket(doc.id, d.title);
    if (!b) continue;
    b.manifestVersion = d.manifestVersion || null;
    b.manifestTransactionId = d.manifestTransactionId || null;
    b.manifestUrl = d.manifestUrl || null;
    b.assetCount = d.assetCount ?? null;
  }
  for (const doc of reviewSnap.docs) {
    const d = doc.data();
    const b = bucket(d.collectionId, d.collectionTitle);
    if (!b) continue;
    if (Array.isArray(d.decisions) && d.decisions.length >= 6) b.documented += 1;
  }
  for (const doc of uploadsSnap.docs) {
    const d = doc.data();
    const b = bucket(d.collectionId);
    if (!b) continue;
    b.uploaded += 1;
    b.uploadedBytes += Number(d.sizeBytes || 0);
  }
  for (const doc of recordsSnap.docs) {
    const d = doc.data();
    const b = bucket(d.collectionId);
    if (!b) continue;
    b.recordVersionsTotal += Number(d.version || 0);
  }
  for (const doc of commandsSnap.docs) {
    const d = doc.data();
    const collectionId = d.collectionId || d.refs?.collectionId;
    const b = bucket(collectionId);
    if (!b) continue;
    if (d.type === 'UPLOAD_ASSET_ARWEAVE') {
      if (IN_FLIGHT_STATES.includes(d.state)) b.uploading += 1;
      if (d.state === 'FAILED') b.failed += 1;
    } else if (d.type === 'UPLOAD_JSON' && d.kind === 'archive-record' && d.state === 'FAILED') {
      b.failed += 1;
    }
  }

  const collections = (await Promise.all([...byCollection.values()].map(async (b) => ({
      ...b,
      // Live Turbo quote (cached 10 min); falls back to the legacy estimate
      // with isLiveQuote:false so the page can label it honestly.
      cost: await estimateArchiveCostLive(b.uploadedBytes),
      viewerUrl: viewer?.transactionId
        ? `https://arweave.net/${viewer.transactionId}${b.manifestTransactionId ? `?manifest=${b.manifestTransactionId}` : ''}`
        : `/archive-viewer/index.html${b.manifestTransactionId ? `?manifest=${b.manifestTransactionId}` : ''}`,
    }))))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));

  return {
    collections,
    viewer: viewer ? { transactionId: viewer.transactionId || null, arweaveUrl: viewer.arweaveUrl || null, sha256: viewer.sha256 || null } : null,
    permanence,
  };
}

module.exports = {
  IN_FLIGHT_STATES,
  UPLOAD_ACTIVE_STATES,
  readPermanenceSettings,
  isJunkPath,
  guessContentType,
  slugifyCollectionId,
  collectionTitleFromPath,
  resolveCollectionForJob,
  autoEnqueueArchiveUpload,
  buildUploadJsonTags,
  enqueueUploadJsonCommand,
  enqueueNextRecordVersionIfNeeded,
  handleCommandComplete,
  appendReviewCorrection,
  maybeRebuildManifest,
  rebuildManifest,
  rebuildManifestManual,
  deployViewerIfChanged,
  getPermanentArchiveSummary,
  pickAnyWorkerId,
  pickWorkerIdForCollection,
};
