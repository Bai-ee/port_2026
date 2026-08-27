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
const { logInfo, logWarn } = require('./observability.cjs');
const { notifyDashboardFailure } = require('./dashboard-failure-notification.cjs');

const MAX_ATTEMPTS = 3;
const LEASE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — stale lease window for admin reclaim

// --- test seam (failRun and its client-visible event write) ------------------
// The lifecycle's production behavior remains on `fb`; failRun and the
// appendRunEvent helper it calls use `ctx()` so their incident/security
// contract is testable against the shared fake Firestore.
let _testCtx = null;
function __setTestContext(ctx) { _testCtx = ctx; }
function ctx() { return _testCtx || fb; }

// ── Dashboard-creation-failure classification ───────────────────────────────
// See docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md — client-safe
// category + copy for a hard-gated incident. Conservative fallback:
// anything unrecognized lands in 'processing' rather than guessing wrong.
const PUBLIC_FAILURE_COPY = {
  website_address: 'We could not validate the website address.',
  website_access: 'We could not reach the website to build your dashboard.',
  website_rendering: 'We could not read the website well enough to create the dashboard.',
  processing: 'We hit a problem while creating your dashboard.',
};

function classifyPublicFailure(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const stage = String(error?.stage || '').toLowerCase();
  const haystack = `${stage} ${message}`;

  let publicStage = 'processing';
  if (/invalid url|invalid website|malformed url|bad hostname|invalid hostname/.test(haystack)) {
    publicStage = 'website_address';
  } else if (/screenshot|browserless|playwright|puppeteer|render/.test(haystack)) {
    publicStage = 'website_rendering';
  } else if (/enotfound|econnrefused|econnreset|etimedout|timed out|timeout|\bdns\b|refused|unreachable|fetch failed|\b4\d\d\b|\b5\d\d\b|connection/.test(haystack)) {
    publicStage = 'website_access';
  }

  return { publicStage, publicMessage: PUBLIC_FAILURE_COPY[publicStage] };
}

// Deterministic support reference — same runId always yields the same code,
// so a retry/requeue of the primary run (same doc id) keeps one stable code
// the client can reference across sessions.
function buildIncidentPublicCode(runId) {
  let hash = 0;
  const str = String(runId || '');
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  const code = hash.toString(36).toUpperCase().padStart(6, '0').slice(-6);
  return `HIT-${code}`;
}

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
    latestRunId: runId,
    latestRunStatus: 'succeeded',
    updatedAt: fb.FieldValue.serverTimestamp(),
    provisioningState: null,
    errorState: null,
  };
  // Only write content fields when the run actually produced them — an empty
  // run must not wipe a content angle or insight from a richer prior run.
  if (scoutPriorityAction) base.headline = scoutPriorityAction;
  if (summaryCards.length > 0) base.summaryCards = summaryCards;
  if (latestInsights.length > 0) base.latestInsights = latestInsights;

  if (pipelineResult.pipelineType === 'scout-brief') {
    // Rolling 30-day post strategy — only overwrite when the run produced one.
    if (pipelineResult.strategy30) base.strategy30 = pipelineResult.strategy30;
    const scope = pipelineResult.scope || null;
    if (scope === 'marketing-director') {
      // Scoped run: only fresh scout signals. Omit content/guardian keys so
      // the recursive Firestore merge keeps the stored today's-post, guardian
      // flags, and contentOpportunities from the last full run.
      base.marketingBrief = {
        status: 'generated',
        scoutBrief: pipelineResult.brief ? {
          timestamp: pipelineResult.brief.timestamp || null,
          humanBrief: pipelineResult.brief.humanBrief || null,
          delta: pipelineResult.brief.delta || null,
          agentData: pipelineResult.brief.agentData || null,
        } : {},
        providerName: pipelineResult.providerName || null,
        generatedAtIso: new Date().toISOString(),
      };
    } else if (scope === 'social-media-manager') {
      // Scoped run: fresh strategy + today's post; the stored scout brief
      // (market/competitor/local signals) stays untouched.
      base.marketingBrief = {
        status: 'generated',
        headline: scoutPriorityAction || null,
        content: content || null,
        contentOpportunities: contentOpportunities || [],
        guardianFlags: pipelineResult.guardianFlags || null,
        providerName: pipelineResult.providerName || null,
        generatedAtIso: new Date().toISOString(),
      };
    } else {
      base.marketingBrief = {
        status: 'generated',
        headline: scoutPriorityAction || null,
        scoutBrief: pipelineResult.brief ? {
          timestamp: pipelineResult.brief.timestamp || null,
          humanBrief: pipelineResult.brief.humanBrief || null,
          delta: pipelineResult.brief.delta || null,
          agentData: pipelineResult.brief.agentData || null,
        } : null,
        content: content || null,
        contentOpportunities: contentOpportunities || [],
        guardianFlags: pipelineResult.guardianFlags || null,
        providerName: pipelineResult.providerName || null,
        knowledgeBaseSources: Array.isArray(pipelineResult.knowledgeBase?.sources)
          ? pipelineResult.knowledgeBase.sources
          : [],
        generatedAtIso: new Date().toISOString(),
      };
    }
    if (pipelineResult.knowledgeBase) {
      base.knowledgeBase = pipelineResult.knowledgeBase;
    }
    base.modules = {
      'marketing-brief': {
        enabled: true,
        status: 'succeeded',
        lastRunId: runId,
        lastSuccessAt: fb.FieldValue.serverTimestamp(),
      },
    };
  }

  // Only emit artifact sub-keys when the current run actually produced content
  // for them. Setting an empty map would overwrite existing values on merge
  // (e.g. a mockup-only retry would wipe previously-stored full-page refs).
  if (homepageScreenshot) {
    base.artifacts = { ...(base.artifacts || {}), homepageScreenshot };
  }
  if (homepageScreenshots.length > 0) {
    const viewport = homepageScreenshots.filter((a) => a?.variant && !a.variant.endsWith('-full'));
    const fullPage = homepageScreenshots.filter((a) => a?.variant && a.variant.endsWith('-full'));
    if (viewport.length > 0) {
      base.artifacts = {
        ...(base.artifacts || {}),
        homepageScreenshots: Object.fromEntries(viewport.map((a) => [a.variant, a])),
      };
    }
    if (fullPage.length > 0) {
      base.artifacts = {
        ...(base.artifacts || {}),
        fullPageScreenshots: Object.fromEntries(fullPage.map((a) => [a.variant, a])),
      };
    }
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
    // Only overwrite strategy when the new run produced meaningful content.
    // An empty strategy object (no angles, no opportunities) should never
    // blank out Posting Rules data from a prior richer run.
    const newStrategy = pipelineResult.strategy;
    const newStrategyHasContent = Boolean(
      newStrategy &&
      (
        (Array.isArray(newStrategy.contentAngles) && newStrategy.contentAngles.some((a) => a?.angle)) ||
        (Array.isArray(newStrategy.opportunityMap) && newStrategy.opportunityMap.length > 0) ||
        newStrategy.postStrategy?.approach
      )
    );
    if (newStrategyHasContent) base.strategy = newStrategy;
    if (pipelineResult.outputsPreview) base.outputsPreview = pipelineResult.outputsPreview;
    if (pipelineResult.systemPreview) base.systemPreview = pipelineResult.systemPreview;
    if (pipelineResult.siteMeta) base.siteMeta = pipelineResult.siteMeta;
    // Trimmed crawl evidence (normalize.js summarizeEvidencePages) — feeds the
    // Data Quality SITE EVIDENCE rows and Trust/Platform Coverage cards.
    if (pipelineResult.evidence) base.evidence = pipelineResult.evidence;
    if (pipelineResult.analyzerOutputs) base.analyzerOutputs = pipelineResult.analyzerOutputs;
    // skillDocs — per-skill downloadable doc (html + markdown), surfaced on DATA tab.
    if (pipelineResult.skillDocs && Object.keys(pipelineResult.skillDocs).length > 0) {
      base.artifacts = {
        ...(base.artifacts || {}),
        skillDocs: pipelineResult.skillDocs,
      };
    }
    // Phase-4 Scribe output: per-card short/expanded copy + brief sections.
    // Dashboard consumes scribe.cards[cardId] to override static copy.
    if (pipelineResult.scribe && pipelineResult.scribe.cards) {
      base.scribe = {
        cards: pipelineResult.scribe.cards,
        brief: pipelineResult.scribe.brief || null,
        seoGuardian: pipelineResult.scribe.seoGuardian || null,
      };
    }
  }

  return base;
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    logInfo('run_complete_skipped_cancelled', { clientId, runId });
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
 * Internal error detail is always written to brief_runs (admin-visible via
 * Admin SDK). dashboard_state only ever receives sanitized copy — never
 * internal detail — and only in three of four cases:
 *
 * - Soft mode (details.soft = true): no errorState, no client downgrade.
 *   Used for chained follow-up runs (e.g. onboarding-chain scout-brief)
 *   whose failure must not error-screen a client whose primary run succeeded.
 * - The client's PRIMARY dashboard-creation run (pipelineType:
 *   'free-tier-intake', trigger: 'signup') with retries remaining:
 *   dashboard_state.errorState.retryPending = true, client stays 'provisioning'.
 * - That same primary run once attempts are exhausted: a hard-gated
 *   support incident — errorState.kind = 'dashboard_creation_failed',
 *   status: 'open', client downgraded to 'error'. See
 *   docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md.
 * - Anything else (module runs, a reseed on an already-provisioned client):
 *   the run/latestRunStatus is recorded as failed, but no errorState is
 *   written and client.status is left untouched — an established client
 *   never loses dashboard access because a later run failed.
 *
 * @param {string} runId
 * @param {string} clientId
 * @param {Error|object} error
 * @param {number} attempts - current attempt count (post-increment from claimRun)
 */
async function failRun(runId, clientId, error, attempts, details = {}) {
  const soft = details.soft === true;
  const store = ctx();
  const runRef = store.adminDb.collection('brief_runs').doc(runId);
  const clientRunRef = store.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId);
  const dashboardStateRef = store.adminDb.collection('dashboard_state').doc(clientId);
  const clientRef = store.adminDb.collection('clients').doc(clientId);
  const now = store.FieldValue.serverTimestamp();
  const failedAt = new Date().toISOString();

  // Stale-write guard: an admin requeue or a duplicate/late worker may have
  // already moved this run past 'running' (queued again, cancelled, or —
  // in a race — already succeeded). Only a run this caller still sees as
  // 'running' is theirs to fail; anything else is a stale finish that must
  // not clobber a newer state (mirrors completeRun's cancelled-only guard,
  // but broader — a requeue never routes through 'cancelled').
  const runSnap = await runRef.get();
  const runData = runSnap.exists ? (runSnap.data() || {}) : {};
  const priorStatus = runSnap.exists ? runData.status : null;
  if (priorStatus && priorStatus !== 'running') {
    logWarn('run_fail_skipped_stale', { clientId, runId, priorStatus });
    return;
  }

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

  // Hard-gate only the client's PRIMARY dashboard-creation run — the
  // signup-triggered free-tier-intake run created by queueInitialBriefRun
  // (deterministic id `${clientId}-signup`, trigger: 'signup'). A reseed/
  // refresh of an already-provisioned client's intake (trigger: 'reseed')
  // and every module run (pipelineType: 'module-run') must never lock an
  // established client out of their existing dashboard.
  const isPrimaryCreationRun = runData.pipelineType === 'free-tier-intake' && runData.trigger === 'signup';
  // Gate on the run identity alone, not on `isExhausted`: nothing in this
  // codebase auto-retries a 'failed' run (attempts only advances when an
  // admin calls requeueRun, api/_lib/run-lifecycle.cjs requeueRun — the
  // sole call site is app/api/admin/requeue/route.js). Requiring exhaustion
  // here would mean the incident/alert — the thing meant to prompt that
  // admin's first look — could only ever fire after the admin had already
  // manually retried the same run twice on their own.
  const hard = !soft && isPrimaryCreationRun;

  // Sanitized error for dashboard — no internal detail exposed to end users.
  let dashboardUpdate;
  if (hard) {
    const { publicStage, publicMessage } = classifyPublicFailure(error);
    const publicCode = buildIncidentPublicCode(runId);
    logWarn('dashboard_creation_failed', { clientId, runId, publicCode, publicStage });
    dashboardUpdate = {
      clientId,
      latestRunId: runId,
      latestRunStatus: 'failed',
      updatedAt: now,
      errorState: {
        kind: 'dashboard_creation_failed',
        status: 'open',
        incidentId: runId,
        runId,
        failedAt,
        publicCode,
        publicStage,
        publicMessage,
        // Backwards-compatible alias during rollout — migrate UI reads to
        // publicMessage, then drop this (see the plan's Data contract note).
        message: publicMessage,
        notification: { attemptedAt: null, status: 'not_configured' },
        resolvedAt: null,
        resolvedBy: null,
      },
    };
  } else if (soft) {
    // Chained follow-up runs (e.g. onboarding-chain scout-brief) fail soft:
    // full error in brief_runs, but no dashboard errorState / client
    // downgrade — the primary intake already succeeded.
    dashboardUpdate = { clientId, updatedAt: now };
  } else {
    // Module run or reseed of an established client: record the failed run
    // for run-tracking UI, but never manufacture a client-facing errorState
    // — that field is reserved for the primary dashboard-creation incident.
    dashboardUpdate = { clientId, latestRunId: runId, latestRunStatus: 'failed', updatedAt: now };
  }

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

  const clientUpdate = hard
    ? { latestRunId: runId, latestRunStatus: 'failed', status: 'error', updatedAt: now }
    : soft
      ? { updatedAt: now }
      // Module run or reseed on an established client: never touch
      // client.status — the client's existing dashboard stays active.
      : { latestRunId: runId, latestRunStatus: 'failed', updatedAt: now };

  await Promise.all([
    runRef.set(runUpdate, { merge: true }),
    clientRunRef.set(runUpdate, { merge: true }),
    dashboardStateRef.set(dashboardUpdate, { merge: true }),
    clientRef.set(clientUpdate, { merge: true }),
    appendRunEvent(runId, clientId, {
      stage: 'error',
      // Run events are client-readable. Keep raw diagnostics exclusively in
      // brief_runs (Admin SDK only), including after an admin manually clears
      // a dashboard-creation gate and the historical terminal becomes visible.
      progressLabel: hard
        ? `Dashboard setup could not be completed: ${dashboardUpdate.errorState.publicMessage} (${dashboardUpdate.errorState.publicCode})`
        : soft
          ? 'Brief generation hit an issue — retry from the Executive Daily Brief card.'
          : 'Pipeline failed. Please try again or contact support if the problem continues.',
    }).catch(() => {}),
  ]);

  // Phase 2: best-effort, idempotent alert to Bryan — strictly AFTER the
  // incident above is durably written, and never allowed to affect it. Any
  // outcome here only updates errorState.notification in a follow-up write;
  // it can never re-open, block, or fail the write that already committed.
  if (hard) {
    await notifyHardFailure({ clientId, errorState: dashboardUpdate.errorState, internalError: runUpdate.error, dashboardStateRef, store });
  }
}

// Reads the client doc for notification context (company/owner/site), sends
// the alert, then writes the real delivery status back onto the SAME
// incident. Writes the FULL errorState object with `notification` overridden
// — a bare `{errorState: {notification}}` merge would replace the whole
// errorState map (Firestore's merge:true is shallow at the top level; a
// nested object VALUE is replaced wholesale, not deep-merged), wiping out
// kind/status/incidentId/publicCode/etc. Wrapped so a throw here can never
// propagate out of failRun — see the contract note atop
// dashboard-failure-notification.cjs.
async function notifyHardFailure({ clientId, errorState, internalError, dashboardStateRef, store }) {
  const { runId, publicCode, publicStage, failedAt } = errorState;
  try {
    const clientSnap = await store.adminDb.collection('clients').doc(clientId).get();
    const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
    const notification = await notifyDashboardFailure({
      clientId,
      runId,
      publicCode,
      publicStage,
      failedAt,
      companyName: clientData.companyName || null,
      ownerEmail: clientData.ownerEmail || null,
      websiteUrl: clientData.websiteUrl || null,
      internalError,
    });
    await dashboardStateRef.set({ errorState: { ...errorState, notification } }, { merge: true });
  } catch (err) {
    logWarn('dashboard_failure_notify_wiring_threw', { clientId, runId, error: err?.message || String(err) });
  }
}

// ── Requeue stale ─────────────────────────────────────────────────────────────

/**
 * Reset a stale `running` run back to `queued` so a worker can reclaim it.
 *
 * Used when a worker crashes or times out without writing a final state.
 * Used by the run-brief cron backstop and exposed for admin control plane use.
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

/**
 * Find running runs whose worker lease has expired.
 *
 * Intentionally avoids an orderBy on workerLease.leaseExpiresAt so the backstop
 * can run without a new composite index. The result set should be tiny in normal
 * production because only active/stuck runs have status=running.
 */
async function findStaleRunningRuns({ limit = 25, nowMs = Date.now() } = {}) {
  const snapshot = await fb.adminDb
    .collection('brief_runs')
    .where('status', '==', 'running')
    .limit(Math.max(1, Math.min(Number(limit) || 25, 100)))
    .get();

  const stale = [];
  snapshot.forEach((doc) => {
    const run = doc.data() || {};
    if ((run.attempts || 0) >= MAX_ATTEMPTS) return;

    const leaseExpiresAtMs = timestampToMillis(run.workerLease?.leaseExpiresAt);
    const startedAtMs = timestampToMillis(run.startedAt) || timestampToMillis(run.updatedAt);
    const leaseExpired = leaseExpiresAtMs != null && leaseExpiresAtMs <= nowMs;
    const missingLeaseExpired = leaseExpiresAtMs == null
      && startedAtMs != null
      && nowMs - startedAtMs >= LEASE_TIMEOUT_MS;

    if (leaseExpired || missingLeaseExpired) {
      stale.push({ id: doc.id, ...run });
    }
  });

  return stale.sort((a, b) => {
    const aCreated = timestampToMillis(a.createdAt) || 0;
    const bCreated = timestampToMillis(b.createdAt) || 0;
    return aCreated - bCreated;
  });
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
  const store = ctx();
  const now = store.FieldValue.serverTimestamp();
  const { stage, progressLabel, ...extra } = progress;
  const event = {
    stage:     stage         || 'progress',
    label:     progressLabel || '',
    extra:     extra && Object.keys(extra).length > 0 ? extra : null,
    createdAt: now,
  };
  await store.adminDb
    .collection('clients').doc(clientId)
    .collection('brief_runs').doc(runId)
    .collection('events')
    .add(event);
}

// ── Module state update ───────────────────────────────────────────────────────

function deepSet(target, path, value) {
  if (!target || !Array.isArray(path) || path.length === 0) return target;
  let node = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!node[key] || typeof node[key] !== 'object' || Array.isArray(node[key])) {
      node[key] = {};
    }
    node = node[key];
  }
  node[path[path.length - 1]] = value;
  return target;
}

function projectScreenshotArtifacts(update, artifactRefs = []) {
  const homepageScreenshots = artifactRefs.filter((artifact) => artifact?.type === 'website_homepage_screenshot');
  const homepageScreenshot =
    homepageScreenshots.find((artifact) => artifact?.variant === 'desktop') ||
    homepageScreenshots[0] ||
    null;
  const homepageDeviceMockup =
    artifactRefs.find((artifact) => artifact?.type === 'website_homepage_device_mockup') || null;

  if (homepageScreenshot) {
    const viewportScreenshots = homepageScreenshots.filter((artifact) => artifact?.variant && !artifact.variant.endsWith('-full'));
    const fullPageScreenshots = homepageScreenshots.filter((artifact) => artifact?.variant && artifact.variant.endsWith('-full'));
    deepSet(update, ['artifacts', 'homepageScreenshot'], homepageScreenshot);
    if (viewportScreenshots.length > 0) {
      deepSet(update, ['artifacts', 'homepageScreenshots'], Object.fromEntries(
        viewportScreenshots
          .filter((artifact) => artifact?.variant)
          .map((artifact) => [artifact.variant, artifact])
      ));
    }
    if (fullPageScreenshots.length > 0) {
      deepSet(update, ['artifacts', 'fullPageScreenshots'], Object.fromEntries(
        fullPageScreenshots
          .filter((artifact) => artifact?.variant)
          .map((artifact) => [artifact.variant, artifact])
      ));
    }
  }

  if (homepageDeviceMockup) {
    deepSet(update, ['artifacts', 'homepageDeviceMockup'], homepageDeviceMockup);
  }
}

// snapshotPatch accumulates dot-notation field paths for snapshot.* writes.
// These are written via ref.update() rather than ref.set(merge:true) to avoid
// Firestore's top-level-only merge replacing the entire snapshot map and wiping
// unrelated fields like snapshot.brandOverview.
function projectModuleResult(update, result, snapshotPatch) {
  // Trimmed crawl evidence rides on the social-preview envelope — that module
  // is the page fetch on the narrow Creative Brief run. Projected before the ok
  // gate: a crawl that succeeded but found no meta tags still proves what the
  // page says, and the Creative Brief needs that to tell "the site lacks this"
  // apart from "we never read the page".
  if (result?.siteEvidence) deepSet(update, ['evidence'], result.siteEvidence);

  if (!result?.ok) return;

  if (result.cardId === 'multi-device-view') {
    projectScreenshotArtifacts(update, result.artifacts || []);
    return;
  }

  if (result.cardId === 'social-preview' && result.result?.siteMeta) {
    const siteMeta = result.result.siteMeta;
    deepSet(update, ['siteMeta'], siteMeta);
    deepSet(update, ['onboard', 'socialPreview'], {
      status: result.status || 'succeeded',
      siteMeta,
      warnings: result.warningCodes || [],
    });
    return;
  }

  if (result.cardId === 'style-guide') {
    if (result.result?.styleGuide) {
      // Brand Snapshot card reads snapshot.visualIdentity.styleGuide.
      snapshotPatch['snapshot.visualIdentity.styleGuide'] = result.result.styleGuide;
    }
    return;
  }

  if (result.cardId === 'design-evaluation') {
    if (result.result?.styleGuide) {
      // Keep the shared brand snapshot in sync so subsequent cards reuse it.
      snapshotPatch['snapshot.visualIdentity.styleGuide'] = result.result.styleGuide;
    }
    if (result.result?.analyzerOutput) {
      deepSet(update, ['analyzerOutputs', 'design-evaluation'], result.result.analyzerOutput);
    }
    return;
  }

  if (result.cardId === 'agent-readiness') {
    const arSkills = {};
    if (result.result?.agentReadiness) {
      arSkills['agent-readiness'] = result.result.agentReadiness;
      deepSet(update, ['analyzerOutputs', 'agent-readiness', 'skills', 'agent-readiness'], result.result.agentReadiness);
    }
    if (result.result?.aiSeoAudit) {
      arSkills['ai-seo-audit'] = result.result.aiSeoAudit;
      deepSet(update, ['analyzerOutputs', 'agent-readiness', 'skills', 'ai-seo-audit'], result.result.aiSeoAudit);
    }
    // Compute aggregate so the dashboard card pill reflects worst-of readiness
    // across the agent-readiness probe + AI SEO skill.
    if (Object.keys(arSkills).length > 0) {
      const { aggregateCardSkills } = require('../../features/scout-intake/skills/_aggregator');
      const aggregate = aggregateCardSkills(arSkills);
      deepSet(update, ['analyzerOutputs', 'agent-readiness', 'aggregate'], aggregate);
    }
    return;
  }

  if (result.cardId === 'seo-performance') {
    if (result.result?.pagespeed) {
      // result.result.pagespeed is a pagespeed-insights SourceRecord
      // (status: 'live', facts: { scores, auditStatus: 'ok' }). The dashboard
      // reads a flattened shape (status: 'ok', scores, coreWebVitals, …) so
      // we must translate before writing — otherwise hasSeoAuditData stays
      // false and the card renders 'Audit queued — results pending'.
      const { psiSourceToDashboardSeoAudit } = require('./intelligence-bootstrap-utils.cjs');
      const dashboardShape = psiSourceToDashboardSeoAudit(
        result.result.pagespeed,
        result.result.pagespeed?.facts?.websiteUrl || ''
      );
      if (dashboardShape) {
        deepSet(update, ['seoAudit'], dashboardShape);
      }
    }
    // Skill output + downloadable doc from the chained seo-depth-audit skill.
    if (result.result?.skillOutput && result.result?.skillId) {
      deepSet(update, ['analyzerOutputs', 'seo-performance', 'skills', result.result.skillId], result.result.skillOutput);
    }
    if (result.result?.skillAggregate) {
      deepSet(update, ['analyzerOutputs', 'seo-performance', 'aggregate'], result.result.skillAggregate);
    }
    if (result.result?.skillDoc && result.result?.skillId) {
      const doc = result.result.skillDoc;
      deepSet(update, ['artifacts', 'skillDocs', result.result.skillId], {
        type:     'skill-doc',
        skillId:  result.result.skillId,
        cardId:   'seo-performance',
        title:    doc.title,
        filename: doc.filename,
        markdown: doc.markdown,
        html:     doc.html,
        runAt:    result.result.skillOutput?.runAt || new Date().toISOString(),
        siteUrl:  result.result.pagespeed?.facts?.websiteUrl || null,
      });
    }
  }
}

/**
 * Persist per-card module results to dashboard_state/{clientId}.
 *
 * snapshot.* fields are written via ref.update() with dot-notation paths so
 * Firestore only touches the specific leaf fields — not the whole snapshot map.
 * All other fields use ref.set(merge:true) as before.
 *
 * @param {string}   clientId
 * @param {object[]} moduleResults  - array of card result objects from runModules()
 * @param {string}   runId
 */
async function updateModuleState(clientId, moduleResults, runId) {
  if (!Array.isArray(moduleResults) || moduleResults.length === 0) return;

  const now = fb.FieldValue.serverTimestamp();
  const update = { updatedAt: now };
  const snapshotPatch = {};

  for (const r of moduleResults) {
    const cardId = r.cardId;
    if (!cardId) continue;

    deepSet(update, ['modules', cardId, 'status'], r.status || (r.ok ? 'succeeded' : 'failed'));
    deepSet(update, ['modules', cardId, 'lastAttemptRunId'], runId);
    deepSet(update, ['modules', cardId, 'lastAttemptAt'], now);
    deepSet(update, ['modules', cardId, 'warningCodes'], r.warningCodes || []);
    deepSet(update, ['modules', cardId, 'warnings'], Array.isArray(r.warnings)
      ? r.warnings.map((w) => ({
          code: w?.code || 'unknown',
          message: w?.message || '',
          stage: w?.stage || null,
          detail: w?.detail || null,
        }))
      : []);

    if (r.ok) {
      deepSet(update, ['modules', cardId, 'lastSuccessfulRunId'], runId);
      deepSet(update, ['modules', cardId, 'lastSuccessAt'], now);
      deepSet(update, ['modules', cardId, 'lastErrorCode'], null);
      deepSet(update, ['modules', cardId, 'lastErrorMessage'], null);
      if (r.result) {
        deepSet(update, ['modules', cardId, 'result'], r.result);
      }
    } else {
      deepSet(update, ['modules', cardId, 'lastErrorCode'], r.errorCode || 'unknown');
      deepSet(update, ['modules', cardId, 'lastErrorMessage'], r.errorMessage || null);
    }

    projectModuleResult(update, r, snapshotPatch);
  }

  const ref = fb.adminDb.collection('dashboard_state').doc(clientId);
  await ref.set(update, { merge: true });

  if (Object.keys(snapshotPatch).length > 0) {
    await ref.update(snapshotPatch);
  }
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
  findStaleRunningRuns,
  findNextQueuedRun,
  updateRunProgress,
  appendRunEvent,
  updateModuleState,
  __setTestContext,
  classifyPublicFailure,
  buildIncidentPublicCode,
};
