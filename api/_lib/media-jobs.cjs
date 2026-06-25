// media-jobs.cjs — Job lifecycle for client media renders (FFmpeg "video remix")
//
// Sibling to studio-render-jobs.cjs, but for the EditVideos-derived media
// pipeline. FFmpeg / Arweave / large-file work runs in an EXTERNAL worker, not a
// Vercel function. This module only owns the durable job record + the single
// queue lease that feeds that worker serially.
//
//   queued → processing → done
//                       → failed
//
// One Firestore doc per job:
//   media_jobs/{jobId}
//
// Why a separate collection from render_jobs: remix jobs have a very different
// recipe shape (source folders, Arweave audio, filters/overlays/logos) and
// output semantics than Studio Render GPU jobs. See the plan at
// docs/plans/EDITVIDEOS_TO_HITLOOP_CARDS_PLAN.md.
//
// Storage paths produced by the worker are always client-scoped:
//   clients/{clientId}/media/source/{folder}/{file}
//   clients/{clientId}/media/generated/{jobId}.mp4
//
// The Firestore dependency is reached through ctx() so tests can inject an
// in-memory fake (see __setTestContext). In production it resolves to the real
// firebase-admin module.

const { randomUUID } = require('crypto');
const realFb = require('./firebase-admin.cjs');

const COLLECTION = 'media_jobs';
const LOCK_COLLECTION = 'media_queue_locks';
const MEDIA_LOCK_DOC = 'media_remix';

// Remix work (download sources + FFmpeg compose + upload) is heavier than a
// studio capture. Lease must outlive a worker pass but expire soon after so a
// killed worker's job is reclaimable without racing a still-running render.
const LEASE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [30_000, 2 * 60_000, 8 * 60_000, 20 * 60_000];

const JOB_TYPES = ['video-remix', 'arweave-archive', 'media-optimize'];

// --- test seam -------------------------------------------------------------
let _ctx = null;
/** Inject a fake { adminDb, FieldValue } for tests. Pass null to restore real. */
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

// --- recipe normalization --------------------------------------------------
function trimRecipeSummary(recipe = {}) {
  return {
    type: String(recipe?.type || 'video-remix').slice(0, 40),
    durationSeconds: Number(recipe?.output?.durationSeconds || recipe?.durationSeconds) || null,
    width: Number(recipe?.output?.width) || null,
    height: Number(recipe?.output?.height) || null,
    fps: Number(recipe?.output?.fps) || null,
    sourceFolders: Array.isArray(recipe?.sourceFolders)
      ? recipe.sourceFolders.slice(0, 25).map((f) => String(f).slice(0, 120))
      : [],
    filter: String(recipe?.filter?.key || '').slice(0, 80) || null,
    overlay: recipe?.overlay?.enabled ? String(recipe?.overlay?.effect || '').slice(0, 80) : null,
    arweaveAudio: recipe?.arweaveAudioUrl ? String(recipe.arweaveAudioUrl).slice(0, 400) : null,
    manualOrderSegments: Array.isArray(recipe?.videoOrder) ? recipe.videoOrder.length : 0,
  };
}

// --- create ----------------------------------------------------------------
/**
 * Create a media job in `queued` state.
 * @param {object} args
 * @param {string} args.clientId   owning client (required)
 * @param {string} [args.type]     one of JOB_TYPES (default 'video-remix')
 * @param {object} args.recipe     the render recipe (stored trimmed + full)
 * @returns {Promise<{ jobId: string }>}
 */
async function createMediaJob({ clientId, type = 'video-remix', recipe = {} }) {
  if (!clientId) throw new Error('clientId is required to create a media job.');
  if (!JOB_TYPES.includes(type)) throw new Error(`Unknown media job type: ${type}`);

  const fb = ctx();
  const jobId = `media_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    jobId,
    clientId,
    type,
    status: 'queued',
    recipe: trimRecipeSummary({ ...recipe, type }),
    recipeFull: recipe || null,
    output: null,
    error: null,
    attempts: 0,
    workerLease: null,
    nextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
    createdAtTs: fb.FieldValue.serverTimestamp(),
    nextAttemptAtTs: fb.FieldValue.serverTimestamp(),
    startedAt: null,
    completedAt: null,
  });
  return { jobId };
}

// --- lease helpers ---------------------------------------------------------
function isLeaseActive(job, nowMs = Date.now()) {
  if (!job || job.status !== 'processing') return false;
  const expires = Date.parse(job.workerLease?.leaseExpiresAt || '');
  return Number.isFinite(expires) && expires > nowMs;
}

function isQueueLeaseActive(lock, nowMs = Date.now()) {
  const expires = Date.parse(lock?.leaseExpiresAt || '');
  return Number.isFinite(expires) && expires > nowMs;
}

function nextBackoffMs(attempts) {
  const index = Math.max(0, Math.min(BACKOFF_MS.length - 1, Number(attempts || 1) - 1));
  return BACKOFF_MS[index];
}

function mediaLockRef() {
  return ctx().adminDb.collection(LOCK_COLLECTION).doc(MEDIA_LOCK_DOC);
}

async function clearMediaQueueLease(jobId) {
  if (!jobId) return;
  const fb = ctx();
  await fb.adminDb.runTransaction(async (tx) => {
    const ref = mediaLockRef();
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const lock = snap.data();
    if (lock?.jobId !== jobId) return;
    const now = new Date().toISOString();
    tx.set(ref, {
      jobId: null,
      workerId: null,
      leaseExpiresAt: null,
      releasedAt: now,
      updatedAt: now,
    }, { merge: true });
  }).catch(() => {});
}

// --- claim -----------------------------------------------------------------
/**
 * Claim the oldest runnable queued job if the singleton media lease is open.
 * Mirrors studio-render-jobs.claimNextRenderJob: single equality queries (no
 * composite index), in-memory sort, orphan reclaim of expired `processing`
 * jobs so a dead worker never freezes the queue.
 */
async function claimNextMediaJob({ workerId = null } = {}) {
  const fb = ctx();
  const nowMs = Date.now();

  const [queuedSnap, processingSnap0] = await Promise.all([
    fb.adminDb.collection(COLLECTION).where('status', '==', 'queued').limit(50).get(),
    fb.adminDb.collection(COLLECTION).where('status', '==', 'processing').limit(50).get(),
  ]);

  const queuedRunnable = queuedSnap.docs
    .map((doc) => ({ ref: doc.ref, id: doc.id, data: doc.data() }))
    .filter(({ data }) => {
      if (Number(data.attempts || 0) >= MAX_ATTEMPTS) return false;
      const next = data.nextAttemptAtTs?.toMillis
        ? data.nextAttemptAtTs.toMillis()
        : (data.nextAttemptAt ? Date.parse(data.nextAttemptAt) : 0);
      return !Number.isFinite(next) || next <= nowMs;
    });

  const orphaned = processingSnap0.docs
    .map((doc) => ({ ref: doc.ref, id: doc.id, data: doc.data() }))
    .filter(({ data }) => {
      if (Number(data.attempts || 0) >= MAX_ATTEMPTS) return false;
      return !isLeaseActive(data, nowMs);
    });

  const runnable = [...queuedRunnable, ...orphaned]
    .sort((a, b) => String(a.data.createdAt || '').localeCompare(String(b.data.createdAt || '')));

  if (!runnable.length) return null;

  const selected = runnable[0];
  const lease = {
    workerId: workerId || `media-worker-${nowMs}`,
    leasedAt: new Date(nowMs).toISOString(),
    leaseExpiresAt: new Date(nowMs + LEASE_TIMEOUT_MS).toISOString(),
  };

  let claimed = null;
  await fb.adminDb.runTransaction(async (tx) => {
    const lockRef = mediaLockRef();
    const [jobSnap, lockSnap, processingSnap] = await Promise.all([
      tx.get(selected.ref),
      tx.get(lockRef),
      tx.get(fb.adminDb.collection(COLLECTION).where('status', '==', 'processing').limit(20)),
    ]);
    if (lockSnap.exists && isQueueLeaseActive(lockSnap.data(), nowMs)) return;
    if (!jobSnap.exists) return;
    if (processingSnap.docs.some((doc) => doc.id !== selected.id && isLeaseActive(doc.data(), nowMs))) return;

    const job = jobSnap.data();
    const claimable = job.status === 'queued'
      || (job.status === 'processing' && !isLeaseActive(job, nowMs));
    if (!claimable) return;
    const attempts = Number(job.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) return;
    if (job.status === 'queued') {
      const next = job.nextAttemptAtTs?.toMillis
        ? job.nextAttemptAtTs.toMillis()
        : (job.nextAttemptAt ? Date.parse(job.nextAttemptAt) : 0);
      if (Number.isFinite(next) && next > nowMs) return;
    }

    tx.set(selected.ref, {
      status: 'processing',
      attempts: fb.FieldValue.increment(1),
      workerLease: lease,
      startedAt: job.startedAt || lease.leasedAt,
      updatedAt: lease.leasedAt,
      error: null,
    }, { merge: true });
    tx.set(lockRef, {
      jobId: selected.id,
      workerId: lease.workerId,
      leasedAt: lease.leasedAt,
      leaseExpiresAt: lease.leaseExpiresAt,
      updatedAt: lease.leasedAt,
    }, { merge: true });
    claimed = { ...job, jobId: selected.id, status: 'processing', attempts: attempts + 1, workerLease: lease };
  });

  return claimed;
}

/** Mark a claimed job as processing (worker heartbeat / explicit start). */
async function markMediaJobProcessing(jobId, lease = null) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'processing',
    workerLease: lease,
    startedAt: lease?.leasedAt || now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

// --- terminal transitions --------------------------------------------------
/**
 * Complete a job — store the normalized output capture ref (same shape the
 * dashboard appends to dashboard_state.mediaCaptures[]).
 */
async function completeMediaJob(jobId, output) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'done',
    output: output || null,
    error: null,
    workerLease: null,
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
  await clearMediaQueueLease(jobId);
}

/** Mark a job as failed with a sanitized message. */
async function failMediaJob(jobId, error) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'failed',
    error: String(error?.message || error || 'Media job failed.').slice(0, 500),
    workerLease: null,
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
  await clearMediaQueueLease(jobId);
}

/** Requeue with backoff, or fail terminally once the retry budget is spent. */
async function requeueMediaJob(jobId, error = null) {
  if (!jobId) return;
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return;
  const job = snap.data();
  const attempts = Number(job.attempts || 0);
  const now = new Date();
  if (attempts >= MAX_ATTEMPTS) {
    await failMediaJob(jobId, error || 'Media job failed after retry budget was exhausted.');
    return { requeued: false, exhausted: true, nextAttemptAt: null };
  }
  const nextAt = new Date(now.getTime() + nextBackoffMs(attempts));
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'queued',
    error: String(error?.message || error || 'Media job will retry.').slice(0, 500),
    workerLease: null,
    nextAttemptAt: nextAt.toISOString(),
    nextAttemptAtTs: nextAt,
    completedAt: null,
    updatedAt: now.toISOString(),
  }, { merge: true });
  await clearMediaQueueLease(jobId);
  return { requeued: true, exhausted: false, nextAttemptAt: nextAt.toISOString() };
}

// --- reads -----------------------------------------------------------------
/** Fetch a single job, scoped to its owning client. Null if missing/foreign. */
async function getMediaJob(jobId, clientId) {
  if (!jobId) return null;
  const snap = await ctx().adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (clientId && data.clientId !== clientId) return null;
  return data;
}

/**
 * Store the EditVideos cross-project job id on the media_jobs doc. This is the
 * join key the reconcile loop uses to read the live EditVideos render result.
 */
async function setMediaJobEditRef(jobId, editJobId) {
  if (!jobId || !editJobId) return;
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    editJobId: String(editJobId),
    updatedAt: new Date().toISOString(),
  }, { merge: true }).catch(() => {});
}

/**
 * List in-flight jobs (queued|processing) that carry an EditVideos `editJobId`,
 * across all clients, for the cron reconcile sweep. Two equality queries merged
 * in-memory so no composite index is needed. Newest-ish first.
 */
async function listInFlightMediaJobs(limit = 50) {
  const fb = ctx();
  const [queuedSnap, processingSnap] = await Promise.all([
    fb.adminDb.collection(COLLECTION).where('status', '==', 'queued').limit(limit).get(),
    fb.adminDb.collection(COLLECTION).where('status', '==', 'processing').limit(limit).get(),
  ]);
  const seen = new Set();
  const jobs = [];
  for (const snap of [...queuedSnap.docs, ...processingSnap.docs]) {
    const data = snap.data();
    if (!data?.editJobId) continue;
    if (seen.has(data.jobId)) continue;
    seen.add(data.jobId);
    jobs.push(data);
  }
  jobs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return jobs.slice(0, limit);
}

/** List recent jobs for a client, newest first. Optional type filter (in-memory). */
async function listMediaJobs(clientId, { type = null, limit = 20 } = {}) {
  if (!clientId) return [];
  const snap = await ctx().adminDb
    .collection(COLLECTION)
    .where('clientId', '==', clientId)
    .orderBy('createdAtTs', 'desc')
    .limit(limit)
    .get();
  let jobs = snap.docs.map((doc) => doc.data());
  if (type) jobs = jobs.filter((j) => j.type === type);
  return jobs;
}

module.exports = {
  createMediaJob,
  claimNextMediaJob,
  markMediaJobProcessing,
  completeMediaJob,
  failMediaJob,
  requeueMediaJob,
  getMediaJob,
  listMediaJobs,
  setMediaJobEditRef,
  listInFlightMediaJobs,
  trimRecipeSummary,
  isLeaseActive,
  nextBackoffMs,
  __setTestContext,
  COLLECTION,
  LOCK_COLLECTION,
  MEDIA_LOCK_DOC,
  MAX_ATTEMPTS,
  JOB_TYPES,
  LEASE_TIMEOUT_MS,
};
