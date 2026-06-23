// studio-render-jobs.cjs — Job lifecycle for Mockup Studio video renders
//
// Gives the (currently synchronous) Cloud Run render a durable job record so a
// video can be "queued to render", tracked through status, and paired with a
// social post downstream.
//
//   queued → rendering → done
//                      → failed
//
// One Firestore doc per job:
//   render_jobs/{jobId}
//
// Fields:
//   clientId      owning client
//   status        queued | rendering | done | failed
//   recipe        trimmed render recipe summary (labels only — not the raw body)
//   postId        optional social-post id this render is paired with (null until paired)
//   capture       studio_video ref written on completion (same shape as studioCaptures[])
//   error         sanitized error string on failure
//   createdAt / updatedAt / startedAt / completedAt   ISO strings + server timestamp
//
// The render worker claims queued docs with a single active lease so Cloud Run's
// one-GPU service is fed serially instead of receiving competing requests.

const { randomUUID } = require('crypto');
const fb = require('./firebase-admin.cjs');

const COLLECTION = 'render_jobs';
const LOCK_COLLECTION = 'render_queue_locks';
const STUDIO_LOCK_DOC = 'studio_render';
const LEASE_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 90_000, 3 * 60_000, 8 * 60_000, 15 * 60_000];

function trimRecipeSummary(recipe = {}) {
  return {
    url: String(recipe?.url || '').slice(0, 400),
    preset: String(recipe?.preset || '').slice(0, 80) || null,
    viewport: String(recipe?.device?.viewport || 'desktop').slice(0, 40),
    backdrop: String(recipe?.device?.backdrop || '').slice(0, 40) || null,
    seconds: Number(recipe?.output?.seconds) || null,
    fps: Number(recipe?.output?.fps) || null,
  };
}

/**
 * Create a render job in `queued` state.
 * @param {object} args
 * @param {string} args.clientId
 * @param {object} args.recipe   - the render recipe (stored trimmed)
 * @param {string} [args.postId] - social post id to pair this render with
 * @returns {Promise<{ jobId: string }>}
 */
async function createRenderJob({ clientId, recipe, postId = null }) {
  if (!clientId) throw new Error('clientId is required to create a render job.');
  const jobId = `render_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    jobId,
    clientId,
    status: 'queued',
    recipe: trimRecipeSummary(recipe),
    recipeFull: recipe || null,
    postId: postId || null,
    capture: null,
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

async function markRenderJobRendering(jobId, lease = null) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'rendering',
    workerLease: lease,
    startedAt: lease?.leasedAt || now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

function isLeaseActive(job, nowMs = Date.now()) {
  if (!job || job.status !== 'rendering') return false;
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

function studioLockRef() {
  return fb.adminDb.collection(LOCK_COLLECTION).doc(STUDIO_LOCK_DOC);
}

async function clearStudioQueueLease(jobId) {
  if (!jobId) return;
  await fb.adminDb.runTransaction(async (tx) => {
    const ref = studioLockRef();
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const lock = snap.data();
    if (lock?.jobId !== jobId) return;
    tx.set(ref, {
      jobId: null,
      workerId: null,
      leaseExpiresAt: null,
      releasedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }).catch(() => {});
}

/**
 * Claim the oldest runnable queued job if the singleton render lease is open.
 * Query ordering is intentionally simple to avoid requiring a new composite
 * index; candidates are sorted in memory after a small bounded read.
 */
async function claimNextRenderJob({ workerId = null } = {}) {
  const nowMs = Date.now();

  const candidatesSnap = await fb.adminDb
    .collection(COLLECTION)
    .where('status', '==', 'queued')
    .limit(50)
    .get();

  const runnable = candidatesSnap.docs
    .map((doc) => ({ ref: doc.ref, id: doc.id, data: doc.data() }))
    .filter(({ data }) => {
      const attempts = Number(data.attempts || 0);
      if (attempts >= MAX_ATTEMPTS) return false;
      const next = data.nextAttemptAtTs?.toMillis
        ? data.nextAttemptAtTs.toMillis()
        : (data.nextAttemptAt ? Date.parse(data.nextAttemptAt) : 0);
      return !Number.isFinite(next) || next <= nowMs;
    })
    .sort((a, b) => String(a.data.createdAt || '').localeCompare(String(b.data.createdAt || '')));

  if (!runnable.length) return null;

  const selected = runnable[0];
  const lease = {
    workerId: workerId || `studio-worker-${nowMs}`,
    leasedAt: new Date(nowMs).toISOString(),
    leaseExpiresAt: new Date(nowMs + LEASE_TIMEOUT_MS).toISOString(),
  };

  let claimed = null;
  await fb.adminDb.runTransaction(async (tx) => {
    const lockRef = studioLockRef();
    const [jobSnap, lockSnap, renderingSnap] = await Promise.all([
      tx.get(selected.ref),
      tx.get(lockRef),
      tx.get(
        fb.adminDb
          .collection(COLLECTION)
          .where('status', '==', 'rendering')
          .limit(20)
      ),
    ]);
    if (lockSnap.exists && isQueueLeaseActive(lockSnap.data(), nowMs)) return;
    if (!jobSnap.exists) return;
    if (renderingSnap.docs.some((doc) => doc.id !== selected.id && isLeaseActive(doc.data(), nowMs))) return;

    const job = jobSnap.data();
    if (job.status !== 'queued') return;
    const attempts = Number(job.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) return;
    const next = job.nextAttemptAtTs?.toMillis
      ? job.nextAttemptAtTs.toMillis()
      : (job.nextAttemptAt ? Date.parse(job.nextAttemptAt) : 0);
    if (Number.isFinite(next) && next > nowMs) return;

    tx.set(selected.ref, {
      status: 'rendering',
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
    claimed = { id: selected.id, ...job, status: 'rendering', attempts: attempts + 1, workerLease: lease };
  });

  return claimed;
}

/**
 * Complete a job — store the resulting studio_video capture ref.
 * @param {string} jobId
 * @param {object} capture - the capture ref appended to studioCaptures[]
 */
async function completeRenderJob(jobId, capture) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'done',
    capture: capture || null,
    error: null,
    workerLease: null,
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
  await clearStudioQueueLease(jobId);
}

/** Mark a job as failed with a sanitized message. */
async function failRenderJob(jobId, error) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'failed',
    error: String(error?.message || error || 'Render failed.').slice(0, 500),
    workerLease: null,
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
  await clearStudioQueueLease(jobId);
}

async function requeueRenderJob(jobId, error = null) {
  if (!jobId) return;
  const snap = await fb.adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return;
  const job = snap.data();
  const attempts = Number(job.attempts || 0);
  const now = new Date();
  if (attempts >= MAX_ATTEMPTS) {
    await failRenderJob(jobId, error || 'Render failed after retry budget was exhausted.');
    return { requeued: false, exhausted: true, nextAttemptAt: null };
  }
  const nextAt = new Date(now.getTime() + nextBackoffMs(attempts));
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'queued',
    error: String(error?.message || error || 'Render will retry.').slice(0, 500),
    workerLease: null,
    nextAttemptAt: nextAt.toISOString(),
    nextAttemptAtTs: nextAt,
    completedAt: null,
    updatedAt: now.toISOString(),
  }, { merge: true });
  await clearStudioQueueLease(jobId);
  return { requeued: true, exhausted: false, nextAttemptAt: nextAt.toISOString() };
}

/** Pair (or re-pair) a job with a social post id. */
async function linkRenderJobToPost(jobId, postId) {
  if (!jobId) return;
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    postId: postId || null,
    updatedAt: new Date().toISOString(),
  }, { merge: true }).catch(() => {});
}

/** Fetch a single job, scoped to its owning client. Returns null if missing/foreign. */
async function getRenderJob(jobId, clientId) {
  if (!jobId) return null;
  const snap = await fb.adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (clientId && data.clientId !== clientId) return null;
  return data;
}

/** List recent jobs for a client, newest first. */
async function listRenderJobs(clientId, limit = 20) {
  if (!clientId) return [];
  const snap = await fb.adminDb
    .collection(COLLECTION)
    .where('clientId', '==', clientId)
    .orderBy('createdAtTs', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data());
}

module.exports = {
  createRenderJob,
  claimNextRenderJob,
  markRenderJobRendering,
  completeRenderJob,
  failRenderJob,
  requeueRenderJob,
  linkRenderJobToPost,
  getRenderJob,
  listRenderJobs,
  MAX_ATTEMPTS,
};
