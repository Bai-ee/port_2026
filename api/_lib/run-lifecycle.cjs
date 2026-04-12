// run-lifecycle.cjs — Run state machine for brief_runs
//
// Manages all status transitions for brief_runs documents:
//
//   queued → running → succeeded
//                    → failed
//
// All writes are idempotent-safe and go to both:
//   - brief_runs/{runId}                         (global admin-visible)
//   - clients/{clientId}/brief_runs/{runId}      (client-scoped, read by bootstrap)
//
// dashboard_state/{clientId} is updated only on succeeded or failed —
// never from provisioning or mid-run state.
//
// Firestore composite index required:
//   Collection: brief_runs
//   Fields: status ASC, createdAt ASC
//   (needed for findNextQueuedRun)

const fb = require('./firebase-admin.cjs');

const MAX_ATTEMPTS = 3;
const LEASE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — stale lease window for admin reclaim

// ── Claim ─────────────────────────────────────────────────────────────────────

/**
 * Atomically claim a queued run for execution.
 *
 * Uses a Firestore transaction to ensure exactly one worker can claim a run.
 * Throws if the run is not in `queued` state or has exhausted max attempts.
 *
 * @param {string} runId
 * @returns {object} The run data as it existed before claiming (with clientId, etc.)
 */
async function claimRun(runId) {
  const runRef = fb.adminDb.collection('brief_runs').doc(runId);
  let capturedRunData = null;

  await fb.adminDb.runTransaction(async (tx) => {
    const runDoc = await tx.get(runRef);

    if (!runDoc.exists) {
      throw new Error(`Run ${runId} not found.`);
    }

    const run = runDoc.data();

    if (run.status !== 'queued') {
      throw new Error(`Run ${runId} cannot be claimed — status is "${run.status}" (expected "queued").`);
    }

    if ((run.attempts || 0) >= MAX_ATTEMPTS) {
      throw new Error(`Run ${runId} has exhausted max attempts (${MAX_ATTEMPTS}).`);
    }

    capturedRunData = run;

    const workerId = `vercel-worker-${Date.now()}`;
    const leasedAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + LEASE_TIMEOUT_MS).toISOString();

    tx.update(runRef, {
      status: 'running',
      attempts: fb.FieldValue.increment(1),
      startedAt: fb.FieldValue.serverTimestamp(),
      updatedAt: fb.FieldValue.serverTimestamp(),
      workerLease: { workerId, leasedAt, leaseExpiresAt },
    });
  });

  return {
    ...capturedRunData,
    status: 'running',
    attempts: (capturedRunData.attempts || 0) + 1,
  };
}

// ── Complete ──────────────────────────────────────────────────────────────────

/**
 * Build the normalized dashboard_state projection from pipeline output.
 * Keeps the dashboard decoupled from raw pipeline internals.
 */
function buildDashboardProjection(clientId, pipelineResult, runId) {
  const { scoutPriorityAction, content, contentOpportunities } = pipelineResult;

  // Build summaryCards from available content fields
  const summaryCards = [];
  if (content) {
    const postField = content.x_post || content.primary_post || content.post || null;
    const angleField = content.content_angle || content.angle || null;
    const threadField = content.x_thread_opener || content.thread_opener || null;

    if (postField) {
      summaryCards.push({ type: 'content_post', label: 'Draft Post', value: postField });
    }
    if (angleField) {
      summaryCards.push({ type: 'content_angle', label: 'Content Angle', value: angleField });
    }
    if (threadField) {
      summaryCards.push({ type: 'thread_opener', label: 'Thread Opener', value: threadField });
    }
  }

  const latestInsights = Array.isArray(contentOpportunities)
    ? contentOpportunities.slice(0, 5).map((op) => ({
        topic: op.topic || op.title || '',
        whyNow: op.whyNow || op.why_now || '',
        priority: op.priority || 'medium',
        format: op.format || null,
      }))
    : [];

  return {
    clientId,
    status: 'active',
    headline: scoutPriorityAction || null,
    summaryCards,
    latestInsights,
    latestRunId: runId,
    latestRunStatus: 'succeeded',
    updatedAt: fb.FieldValue.serverTimestamp(),
    provisioningState: null,
    errorState: null,
  };
}

/**
 * Mark a run as succeeded and write normalized output to Firestore.
 *
 * Writes to:
 *   - brief_runs/{runId}
 *   - clients/{clientId}/brief_runs/{runId}
 *   - dashboard_state/{clientId}
 *   - clients/{clientId} (latestRunId, status → active)
 *
 * @param {string} runId
 * @param {string} clientId
 * @param {object} pipelineResult - normalized output from runClientPipeline
 */
async function completeRun(runId, clientId, pipelineResult) {
  const runRef = fb.adminDb.collection('brief_runs').doc(runId);
  const clientRunRef = fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  const clientRef = fb.adminDb.collection('clients').doc(clientId);
  const now = fb.FieldValue.serverTimestamp();

  // Stored in brief_runs — full admin-visible output.
  // moduleSnapshot intentionally excludes the raw brief (could be very large).
  const runUpdate = {
    status: 'succeeded',
    completedAt: now,
    updatedAt: now,
    error: null,
    workerLease: null,
    summary: {
      headline: pipelineResult.scoutPriorityAction || null,
      providerName: pipelineResult.providerName || null,
      contentFieldCount: pipelineResult.content
        ? Object.keys(pipelineResult.content).length
        : 0,
    },
    providerUsage: pipelineResult.runCostData || null,
    moduleSnapshot: {
      content: pipelineResult.content || null,
      guardianFlags: pipelineResult.guardianFlags || null,
      contentOpportunities: pipelineResult.contentOpportunities || null,
      scoutPriorityAction: pipelineResult.scoutPriorityAction || null,
    },
  };

  const dashboardProjection = buildDashboardProjection(clientId, pipelineResult, runId);

  await Promise.all([
    runRef.set(runUpdate, { merge: true }),
    clientRunRef.set(runUpdate, { merge: true }),
    dashboardStateRef.set(dashboardProjection, { merge: true }),
    clientRef.set(
      {
        status: 'active',
        latestRunId: runId,
        latestRunStatus: 'succeeded',
        onboardingStatus: 'complete',
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);
}

// ── Fail ──────────────────────────────────────────────────────────────────────

/**
 * Mark a run as failed.
 *
 * Internal error detail is written to brief_runs (admin-visible via Admin SDK).
 * dashboard_state receives only a sanitized error message — never internal detail.
 *
 * If attempts < MAX_ATTEMPTS, dashboard_state.errorState.retryPending = true so
 * Phase 5 admin UI can surface "retry available" without exposing the actual error.
 *
 * @param {string} runId
 * @param {string} clientId
 * @param {Error|object} error
 * @param {number} attempts - current attempt count (post-increment from claimRun)
 */
async function failRun(runId, clientId, error, attempts) {
  const runRef = fb.adminDb.collection('brief_runs').doc(runId);
  const clientRunRef = fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  const clientRef = fb.adminDb.collection('clients').doc(clientId);
  const now = fb.FieldValue.serverTimestamp();
  const failedAt = new Date().toISOString();

  const isExhausted = attempts >= MAX_ATTEMPTS;

  // Full error detail — stored in brief_runs, accessible only via Admin SDK.
  // Firestore rules block client reads of brief_runs.
  const runUpdate = {
    status: 'failed',
    completedAt: now,
    updatedAt: now,
    workerLease: null,
    error: {
      message: error?.message || String(error),
      stage: error?.stage || 'unknown',
      failedAt,
      attempts,
      exhausted: isExhausted,
    },
  };

  // Sanitized error for dashboard — no internal detail exposed to end users.
  const dashboardUpdate = {
    clientId,
    latestRunId: runId,
    latestRunStatus: 'failed',
    updatedAt: now,
    errorState: {
      message: 'Initial setup encountered an issue. Our team has been notified.',
      failedAt,
      retryPending: !isExhausted,
    },
  };

  const clientUpdate = {
    latestRunId: runId,
    latestRunStatus: 'failed',
    // Keep provisioning status unless fully exhausted — admin may retry
    status: isExhausted ? 'error' : 'provisioning',
    updatedAt: now,
  };

  await Promise.all([
    runRef.set(runUpdate, { merge: true }),
    clientRunRef.set(runUpdate, { merge: true }),
    dashboardStateRef.set(dashboardUpdate, { merge: true }),
    clientRef.set(clientUpdate, { merge: true }),
  ]);
}

// ── Requeue stale ─────────────────────────────────────────────────────────────

/**
 * Reset a stale `running` run back to `queued` so a worker can reclaim it.
 *
 * Used when a worker crashes or times out without writing a final state.
 * Exposed here for Phase 5 admin control plane use — not called automatically.
 *
 * Throws if:
 *   - run is not in `running` state
 *   - run has exhausted max attempts
 *
 * @param {string} runId
 */
async function requeueStaleRun(runId) {
  const runRef = fb.adminDb.collection('brief_runs').doc(runId);
  const clientRunRef = await (async () => {
    const doc = await runRef.get();
    if (!doc.exists) throw new Error(`Run ${runId} not found.`);
    const clientId = doc.data().clientId;
    return fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId);
  })();

  await fb.adminDb.runTransaction(async (tx) => {
    const runDoc = await tx.get(runRef);

    if (!runDoc.exists) {
      throw new Error(`Run ${runId} not found.`);
    }

    const run = runDoc.data();

    if (run.status !== 'running') {
      throw new Error(`Run ${runId} cannot be requeued — status is "${run.status}" (expected "running").`);
    }

    if ((run.attempts || 0) >= MAX_ATTEMPTS) {
      throw new Error(`Run ${runId} has exhausted max attempts (${MAX_ATTEMPTS}) — cannot requeue.`);
    }

    tx.update(runRef, {
      status: 'queued',
      workerLease: null,
      updatedAt: fb.FieldValue.serverTimestamp(),
    });
  });

  // Mirror to subcollection (not transactional — acceptable for stale reclaim)
  await clientRunRef.set(
    { status: 'queued', workerLease: null, updatedAt: fb.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// ── Admin requeue ─────────────────────────────────────────────────────────────

/**
 * Admin requeue — move a `failed` or stale `running` run back to `queued`.
 *
 * Resets `attempts` to 0 so the run gets a fresh MAX_ATTEMPTS budget.
 * Clears `dashboard_state.errorState` so the user no longer sees the error banner.
 * Updates `clients/{clientId}.status` back to `provisioning` if it was `error`.
 *
 * Unlike requeueStaleRun, this works for both `failed` and `running` states,
 * and is the intended path for admin-initiated retries.
 *
 * @param {string} runId
 * @returns {Promise<{ runId, clientId, status: 'queued' }>}
 */
async function requeueRun(runId) {
  const runRef = fb.adminDb.collection('brief_runs').doc(runId);

  // Read run first to get clientId (before transaction)
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new Error(`Run ${runId} not found.`);
  const clientId = runSnap.data().clientId;

  const clientRunRef = fb.adminDb
    .collection('clients').doc(clientId)
    .collection('brief_runs').doc(runId);

  // Atomic transition: failed|running → queued
  await fb.adminDb.runTransaction(async (tx) => {
    const runDoc = await tx.get(runRef);
    if (!runDoc.exists) throw new Error(`Run ${runId} not found.`);
    const run = runDoc.data();

    if (!['failed', 'running'].includes(run.status)) {
      throw new Error(`Run ${runId} cannot be requeued — status is "${run.status}".`);
    }

    tx.update(runRef, {
      status: 'queued',
      attempts: 0,           // Admin override — fresh attempt budget
      workerLease: null,
      error: null,
      startedAt: null,
      completedAt: null,
      updatedAt: fb.FieldValue.serverTimestamp(),
    });
  });

  const now = fb.FieldValue.serverTimestamp();

  // Sync subcollection + clear dashboard errorState in parallel
  await Promise.all([
    clientRunRef.set(
      {
        status: 'queued',
        attempts: 0,
        workerLease: null,
        error: null,
        updatedAt: now,
      },
      { merge: true }
    ),
    fb.adminDb.collection('dashboard_state').doc(clientId).set(
      {
        latestRunStatus: 'queued',
        errorState: null,
        updatedAt: now,
      },
      { merge: true }
    ),
    fb.adminDb.collection('clients').doc(clientId).set(
      {
        latestRunStatus: 'queued',
        status: 'provisioning',  // Un-error the client record
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);

  return { runId, clientId, status: 'queued' };
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Find the oldest queued run across all clients.
 *
 * Requires composite index: brief_runs — status ASC, createdAt ASC.
 *
 * @returns {object|null} Run data with `id`, or null if queue is empty.
 */
async function findNextQueuedRun() {
  const snapshot = await fb.adminDb
    .collection('brief_runs')
    .where('status', '==', 'queued')
    .orderBy('createdAt', 'asc')
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

module.exports = {
  MAX_ATTEMPTS,
  LEASE_TIMEOUT_MS,
  claimRun,
  completeRun,
  failRun,
  requeueStaleRun,
  requeueRun,
  findNextQueuedRun,
};
