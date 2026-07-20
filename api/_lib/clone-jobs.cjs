// clone-jobs.cjs — Job lifecycle for Site Recreate ("clone") runs.
//
// Sibling to media-jobs.cjs, same lease/backoff/reclaim mechanics, but no
// singleton queue lock: unlike the single-FFmpeg-worker media pipeline,
// site-clone jobs don't share an exclusive resource, so multiple jobs may run
// concurrently (Phase 2: admin-run CLI, one job at a time in practice; Phase 4:
// one Cloud Run instance per job). Each job's own transactional claim is what
// prevents a double-claim, not a global lock doc.
//
//   queued → processing → verifying → done
//                                   → failed
//
// One Firestore doc per job: clone_jobs/{jobId}
//
// See docs/plans/SITE-RECREATE-AUTOMATION-PLAN.md for the full pipeline +
// data model this module backs.

const { randomUUID } = require('crypto');
const realFb = require('./firebase-admin.cjs');

const COLLECTION = 'clone_jobs';

const LEASE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [30_000, 2 * 60_000, 8 * 60_000, 20 * 60_000];

const STATUSES = ['queued', 'processing', 'verifying', 'done', 'failed'];

// --- test seam -------------------------------------------------------------
let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

// --- create ------------------------------------------------------------------
/**
 * Create a clone job in `queued` state.
 * @param {object} args
 * @param {string} args.clientId          owning client (required)
 * @param {string} args.targetUrl         validated URL to recreate (required)
 * @param {boolean} args.ownershipAttested  user confirmed they own/control the site (required true)
 * @returns {Promise<{ jobId: string }>}
 */
async function createCloneJob({ clientId, targetUrl, ownershipAttested }) {
  if (!clientId) throw new Error('clientId is required to create a clone job.');
  if (!targetUrl) throw new Error('targetUrl is required to create a clone job.');
  if (ownershipAttested !== true) throw new Error('Ownership attestation is required.');

  const fb = ctx();
  const jobId = `clone_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    jobId,
    clientId,
    targetUrl: String(targetUrl).slice(0, 2000),
    platform: null,
    status: 'queued',
    ownershipAttested: true,
    attempts: 0,
    workerLease: null,
    nextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
    createdAtTs: fb.FieldValue.serverTimestamp(),
    nextAttemptAtTs: fb.FieldValue.serverTimestamp(),
    startedAt: null,
    completedAt: null,
    pages: [],
    assetCount: 0,
    totalBytes: 0,
    verifyReport: null,
    zip: null,
    preview: null,
    log: [],
    error: null,
  });
  return { jobId };
}

// --- lease helpers -----------------------------------------------------------
function isLeaseActive(job, nowMs = Date.now()) {
  if (!job || (job.status !== 'processing' && job.status !== 'verifying')) return false;
  const expires = Date.parse(job.workerLease?.leaseExpiresAt || '');
  return Number.isFinite(expires) && expires > nowMs;
}

function nextBackoffMs(attempts) {
  const index = Math.max(0, Math.min(BACKOFF_MS.length - 1, Number(attempts || 1) - 1));
  return BACKOFF_MS[index];
}

// --- claim ---------------------------------------------------------------
/**
 * Claim a specific job by id (the CLI's `--job <id>` path). Fails silently
 * (returns null) if the job is missing, foreign to this claim attempt is not
 * relevant here (no clientId scoping — worker-side), already actively leased,
 * or has exhausted its retry budget.
 */
async function claimCloneJob(jobId, { workerId = null } = {}) {
  if (!jobId) return null;
  const fb = ctx();
  const nowMs = Date.now();
  const lease = {
    workerId: workerId || `clone-worker-${nowMs}`,
    leasedAt: new Date(nowMs).toISOString(),
    leaseExpiresAt: new Date(nowMs + LEASE_TIMEOUT_MS).toISOString(),
  };

  let claimed = null;
  await fb.adminDb.runTransaction(async (tx) => {
    const ref = fb.adminDb.collection(COLLECTION).doc(jobId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const job = snap.data();

    const claimable = job.status === 'queued'
      || ((job.status === 'processing' || job.status === 'verifying') && !isLeaseActive(job, nowMs));
    if (!claimable) return;

    const attempts = Number(job.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) return;
    if (job.status === 'queued') {
      const next = job.nextAttemptAtTs?.toMillis
        ? job.nextAttemptAtTs.toMillis()
        : (job.nextAttemptAt ? Date.parse(job.nextAttemptAt) : 0);
      if (Number.isFinite(next) && next > nowMs) return;
    }

    tx.set(ref, {
      status: 'processing',
      attempts: fb.FieldValue.increment(1),
      workerLease: lease,
      startedAt: job.startedAt || lease.leasedAt,
      updatedAt: lease.leasedAt,
      error: null,
    }, { merge: true });
    claimed = { ...job, jobId, status: 'processing', attempts: attempts + 1, workerLease: lease };
  });

  return claimed;
}

/**
 * Claim the oldest runnable queued job across all clients (Phase 4 Cloud Run
 * poll path). Single equality query + in-memory filter/sort, orphan reclaim of
 * expired processing/verifying jobs — same shape as media-jobs' claimNext, but
 * no singleton lock since concurrent jobs don't contend for one resource.
 */
async function claimNextCloneJob({ workerId = null } = {}) {
  const fb = ctx();
  const nowMs = Date.now();

  const [queuedSnap, processingSnap, verifyingSnap] = await Promise.all([
    fb.adminDb.collection(COLLECTION).where('status', '==', 'queued').limit(50).get(),
    fb.adminDb.collection(COLLECTION).where('status', '==', 'processing').limit(50).get(),
    fb.adminDb.collection(COLLECTION).where('status', '==', 'verifying').limit(50).get(),
  ]);

  const queuedRunnable = queuedSnap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => {
      if (Number(data.attempts || 0) >= MAX_ATTEMPTS) return false;
      const next = data.nextAttemptAtTs?.toMillis
        ? data.nextAttemptAtTs.toMillis()
        : (data.nextAttemptAt ? Date.parse(data.nextAttemptAt) : 0);
      return !Number.isFinite(next) || next <= nowMs;
    });

  const orphaned = [...processingSnap.docs, ...verifyingSnap.docs]
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => {
      if (Number(data.attempts || 0) >= MAX_ATTEMPTS) return false;
      return !isLeaseActive(data, nowMs);
    });

  const runnable = [...queuedRunnable, ...orphaned]
    .sort((a, b) => String(a.data.createdAt || '').localeCompare(String(b.data.createdAt || '')));

  for (const candidate of runnable) {
    const claimed = await claimCloneJob(candidate.id, { workerId });
    if (claimed) return claimed;
  }
  return null;
}

/** Append a timestamped line to job.log[] — streams into the shared run terminal. */
async function appendJobLog(jobId, line) {
  if (!jobId || !line) return;
  const fb = ctx();
  const now = new Date().toISOString();
  await fb.adminDb.runTransaction(async (tx) => {
    const ref = fb.adminDb.collection(COLLECTION).doc(jobId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = Array.isArray(snap.data()?.log) ? snap.data().log : [];
    const next = [...current, { t: now, line: String(line).slice(0, 500) }].slice(-200);
    tx.set(ref, { log: next, updatedAt: now }, { merge: true });
  });
}

/** Merge-set arbitrary stage-result fields (platform, pages, assetCount, ...). */
async function updateJobFields(jobId, patch = {}) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    ...patch,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

/** Move a job into `verifying` (post-pipeline, pre-gate) without releasing the lease. */
async function markCloneJobVerifying(jobId) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'verifying',
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

// --- terminal transitions ---------------------------------------------------
/** Complete a job — store zip/preview/verify results. */
async function completeCloneJob(jobId, { zip = null, preview = null, verifyReport = null, assetCount = 0, totalBytes = 0, pages = [] } = {}) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'done',
    zip,
    preview,
    verifyReport,
    assetCount: Number(assetCount) || 0,
    totalBytes: Number(totalBytes) || 0,
    pages: Array.isArray(pages) ? pages : [],
    error: null,
    workerLease: null,
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

/** Mark a job failed. If a verify gate produced a report, attach it (data-driven tuning, no silent pass). */
async function failCloneJob(jobId, error, { verifyReport = null } = {}) {
  if (!jobId) return;
  const now = new Date().toISOString();
  await ctx().adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'failed',
    error: String(error?.message || error || 'Clone job failed.').slice(0, 500),
    ...(verifyReport ? { verifyReport } : {}),
    workerLease: null,
    completedAt: now,
    updatedAt: now,
  }, { merge: true }).catch(() => {});
}

/** Requeue with backoff, or fail terminally once the retry budget is spent. */
async function requeueCloneJob(jobId, error = null) {
  if (!jobId) return;
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return;
  const job = snap.data();
  const attempts = Number(job.attempts || 0);
  const now = new Date();
  if (attempts >= MAX_ATTEMPTS) {
    await failCloneJob(jobId, error || 'Clone job failed after retry budget was exhausted.');
    return { requeued: false, exhausted: true, nextAttemptAt: null };
  }
  const nextAt = new Date(now.getTime() + nextBackoffMs(attempts));
  await fb.adminDb.collection(COLLECTION).doc(jobId).set({
    status: 'queued',
    error: String(error?.message || error || 'Clone job will retry.').slice(0, 500),
    workerLease: null,
    nextAttemptAt: nextAt.toISOString(),
    nextAttemptAtTs: nextAt,
    completedAt: null,
    updatedAt: now.toISOString(),
  }, { merge: true });
  return { requeued: true, exhausted: false, nextAttemptAt: nextAt.toISOString() };
}

// --- reads -----------------------------------------------------------------
/** Fetch a single job, scoped to its owning client. Null if missing/foreign. */
async function getCloneJob(jobId, clientId) {
  if (!jobId) return null;
  const snap = await ctx().adminDb.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (clientId && data.clientId !== clientId) return null;
  return data;
}

/** List recent jobs for a client, newest first. */
async function listCloneJobs(clientId, { limit = 20 } = {}) {
  if (!clientId) return [];
  const snap = await ctx().adminDb
    .collection(COLLECTION)
    .where('clientId', '==', clientId)
    .orderBy('createdAtTs', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data());
}

module.exports = {
  createCloneJob,
  claimCloneJob,
  claimNextCloneJob,
  appendJobLog,
  updateJobFields,
  markCloneJobVerifying,
  completeCloneJob,
  failCloneJob,
  requeueCloneJob,
  getCloneJob,
  listCloneJobs,
  isLeaseActive,
  nextBackoffMs,
  __setTestContext,
  COLLECTION,
  MAX_ATTEMPTS,
  LEASE_TIMEOUT_MS,
  STATUSES,
};
