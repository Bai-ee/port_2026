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
  let clientRunRef = null;
  let claimUpdate = null;

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

    claimUpdate = {
      status: 'running',
      attempts: fb.FieldValue.increment(1),
      startedAt: fb.FieldValue.serverTimestamp(),
      updatedAt: fb.FieldValue.serverTimestamp(),
      workerLease: { workerId, leasedAt, leaseExpiresAt },
    };

    tx.update(runRef, claimUpdate);

    // Mirror the claim to the client-scoped run doc so bootstrap reads
    // (clients/{clientId}/brief_runs) see status: 'running' in real time.
    // Without this, the dashboard terminal stays on the queued branch for the
    // entire run and only flips to succeeded when completeRun writes both docs.
    if (run.clientId) {
      clientRunRef = fb.adminDb
        .collection('clients').doc(run.clientId)
        .collection('brief_runs').doc(runId);
      tx.set(clientRunRef, claimUpdate, { merge: true });
    }
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
  const artifactRefs = Array.isArray(pipelineResult.artifactRefs) ? pipelineResult.artifactRefs : [];
  const homepageScreenshots = artifactRefs.filter((artifact) => artifact?.type === 'website_homepage_screenshot');
  const homepageScreenshot =
    homepageScreenshots.find((artifact) => artifact?.variant === 'desktop') ||
    homepageScreenshots[0] ||
    null;
  const homepageDeviceMockup =
    artifactRefs.find((artifact) => artifact?.type === 'website_homepage_device_mockup') || null;
  const briefPdf =
    artifactRefs.find((artifact) => artifact?.type === 'brief_pdf') || null;

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

  const base = {
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

  if (homepageScreenshot) {
    base.artifacts = {
      homepageScreenshot,
      homepageScreenshots: Object.fromEntries(
        homepageScreenshots
          .filter((artifact) => artifact?.variant)
          .map((artifact) => [artifact.variant, artifact])
      ),
    };
  }
  if (homepageDeviceMockup) {
    base.artifacts = {
      ...(base.artifacts || {}),
      homepageDeviceMockup,
    };
  }
  if (briefPdf) {
    base.artifacts = {
      ...(base.artifacts || {}),
      briefPdf,
    };
  }

  // Merge free-tier intake modules when present (pipelineType: 'free-tier-intake')
  if (pipelineResult.pipelineType === 'free-tier-intake') {
    if (pipelineResult.snapshot) base.snapshot = pipelineResult.snapshot;
    if (pipelineResult.signals) base.signals = pipelineResult.signals;
    if (pipelineResult.strategy) base.strategy = pipelineResult.strategy;
    if (pipelineResult.outputsPreview) base.outputsPreview = pipelineResult.outputsPreview;
    if (pipelineResult.systemPreview) base.systemPreview = pipelineResult.systemPreview;
    if (pipelineResult.siteMeta) base.siteMeta = pipelineResult.siteMeta;
    if (pipelineResult.analyzerOutputs) base.analyzerOutputs = pipelineResult.analyzerOutputs;
    // Phase-4 Scribe output: per-card short/expanded copy + brief sections.
    // Dashboard consumes scribe.cards[cardId] to override static copy.
    if (pipelineResult.scribe && pipelineResult.scribe.cards) {
      base.scribe = {
        cards: pipelineResult.scribe.cards,
        brief: pipelineResult.scribe.brief || null,
      };
    }
  }

  return base;
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

  // Stale-write guard: if the run was cancelled while the pipeline was executing,
  // skip the dashboard projection write entirely. The cancelled state is authoritative.
  const runSnap = await runRef.get();
  if (runSnap.exists && runSnap.data()?.status === 'cancelled') {
    console.log(`[completeRun] Run ${runId} was cancelled mid-flight — dashboard write skipped.`);
    return;
  }

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
    artifactRefs: Array.isArray(pipelineResult.artifactRefs) ? pipelineResult.artifactRefs : [],
    warnings: Array.isArray(pipelineResult.warnings) ? pipelineResult.warnings : [],
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
    appendRunEvent(runId, clientId, {
      stage: 'progress',
      progressLabel: 'Pipeline succeeded — dashboard data ready.',
    }).catch(() => {}),
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
async function failRun(runId, clientId, error, attempts, details = {}) {
  const runRef = fb.adminDb.collection('brief_runs').doc(runId);
  const clientRunRef = fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  const clientRef = fb.adminDb.collection('clients').doc(clientId);
  const now = fb.FieldValue.serverTimestamp();
  const failedAt = new Date().toISOString();

  const isExhausted = attempts >= MAX_ATTEMPTS;
  const artifactRefs = Array.isArray(details.artifactRefs) ? details.artifactRefs : [];
  const homepageScreenshots = artifactRefs.filter((artifact) => artifact?.type === 'website_homepage_screenshot');
  const homepageScreenshot =
    homepageScreenshots.find((artifact) => artifact?.variant === 'desktop') ||
    homepageScreenshots[0] ||
    null;
  const homepageDeviceMockup =
    artifactRefs.find((artifact) => artifact?.type === 'website_homepage_device_mockup') || null;

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
    artifactRefs,
    warnings: Array.isArray(details.warnings) ? details.warnings : [],
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

  if (homepageScreenshot) {
    dashboardUpdate.artifacts = {
      homepageScreenshot,
      homepageScreenshots: Object.fromEntries(
        homepageScreenshots
          .filter((artifact) => artifact?.variant)
          .map((artifact) => [artifact.variant, artifact])
      ),
    };
  }
  if (homepageDeviceMockup) {
    dashboardUpdate.artifacts = {
      ...(dashboardUpdate.artifacts || {}),
      homepageDeviceMockup,
    };
  }

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
    appendRunEvent(runId, clientId, {
      stage: 'error',
      progressLabel: `Pipeline failed: ${error?.message || String(error)}`.slice(0, 500),
    }).catch(() => {}),
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

// ── Cancel ────────────────────────────────────────────────────────────────────

/**
 * Cancel an active (queued or running) intake run.
 *
 * Sets run status to 'cancelled' atomically. Resets dashboard_state so the
 * frontend unlocks the website input (latestRunStatus: 'cancelled' → isRunActive = false).
 *
 * Safe to call while a worker is mid-pipeline: completeRun checks for 'cancelled'
 * before writing the dashboard projection, so stale writes are prevented.
 *
 * @param {string} runId
 * @param {string} clientId
 */
async function cancelRun(runId, clientId) {
  const runRef = fb.adminDb.collection('brief_runs').doc(runId);
  const clientRunRef = fb.adminDb
    .collection('clients').doc(clientId)
    .collection('brief_runs').doc(runId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  const clientRef = fb.adminDb.collection('clients').doc(clientId);
  const now = fb.FieldValue.serverTimestamp();
  const cancelledAt = new Date().toISOString();

  // Atomic status transition — only cancel if currently queued or running
  await fb.adminDb.runTransaction(async (tx) => {
    const runDoc = await tx.get(runRef);
    if (!runDoc.exists) throw new Error(`Run ${runId} not found.`);
    const run = runDoc.data();
    if (!['queued', 'running'].includes(run.status)) {
      throw new Error(`Run ${runId} cannot be cancelled — status is "${run.status}".`);
    }
    tx.update(runRef, {
      status: 'cancelled',
      cancelledAt: now,
      workerLease: null,
      updatedAt: now,
    });
  });

  // Mirror + reset dashboard in parallel (non-transactional — acceptable here)
  await Promise.all([
    clientRunRef.set(
      { status: 'cancelled', cancelledAt: now, workerLease: null, updatedAt: now },
      { merge: true }
    ),
    dashboardStateRef.set(
      {
        latestRunStatus: 'cancelled',
        provisioningState: null,
        errorState: null,
        updatedAt: now,
      },
      { merge: true }
    ),
    clientRef.set(
      { latestRunStatus: 'cancelled', status: 'provisioning', updatedAt: now },
      { merge: true }
    ),
  ]);

  return { runId, clientId, status: 'cancelled', cancelledAt };
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

// ── Progress update ───────────────────────────────────────────────────────────

/**
 * Write lightweight progress fields to a running brief_run.
 * Non-atomic: fire-and-forget from the worker. Never throws to the caller.
 *
 * @param {string} runId
 * @param {string} clientId
 * @param {object} progress - { stage, progressLabel, currentUrl?, pagesFetched?, ... }
 */
async function updateRunProgress(runId, clientId, progress) {
  const now = fb.FieldValue.serverTimestamp();
  const update = {
    progress: { ...progress, updatedAt: now },
    updatedAt: now,
  };
  await Promise.all([
    fb.adminDb.collection('brief_runs').doc(runId).set(update, { merge: true }),
    fb.adminDb
      .collection('clients').doc(clientId)
      .collection('brief_runs').doc(runId)
      .set(update, { merge: true }),
    // Append to per-run events subcollection so the dashboard terminal can
    // stream real progress as it happens. Non-fatal — any error is swallowed
    // to keep pipeline progress writes non-blocking.
    appendRunEvent(runId, clientId, progress).catch(() => {}),
  ]);
}

/**
 * Append a single progress event to clients/{clientId}/brief_runs/{runId}/events.
 * Ordered by createdAt server timestamp. Used by the dashboard to stream
 * real-time terminal lines during a pipeline run.
 */
async function appendRunEvent(runId, clientId, progress = {}) {
  const now = fb.FieldValue.serverTimestamp();
  const { stage, progressLabel, ...extra } = progress;
  const event = {
    stage:     stage         || 'progress',
    label:     progressLabel || '',
    extra:     extra && Object.keys(extra).length > 0 ? extra : null,
    createdAt: now,
  };
  await fb.adminDb
    .collection('clients').doc(clientId)
    .collection('brief_runs').doc(runId)
    .collection('events')
    .add(event);
}

module.exports = {
  MAX_ATTEMPTS,
  LEASE_TIMEOUT_MS,
  claimRun,
  completeRun,
  failRun,
  cancelRun,
  requeueStaleRun,
  requeueRun,
  findNextQueuedRun,
  updateRunProgress,
  appendRunEvent,
};
