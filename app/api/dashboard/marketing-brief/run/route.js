import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 300;

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { claimRun, completeRun, failRun, appendRunEvent } = require('../../../../../api/_lib/run-lifecycle.cjs');

function getPipeline() {
  return require('../../../../../features/not-the-rug-brief/runtime');
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

const BRIEF_RUN_SCOPES = new Set(['marketing-director', 'social-media-manager']);

export async function POST(request) {
  let decoded, context;
  try {
    ({ decoded, context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  // Scoped runs (individual agent briefs) skip the intake A→B chain and run
  // an inline pipeline slice — fresh signals (marketing-director) or fresh
  // strategy + today's post (social-media-manager).
  let scope = null;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.scope) {
      if (!BRIEF_RUN_SCOPES.has(body.scope)) {
        return json({ error: `Unknown brief run scope: ${body.scope}` }, 400);
      }
      scope = body.scope;
    }
  } catch { /* empty body — full run */ }

  const configSnap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  if (!configSnap.exists) return json({ error: 'No client config.' }, 404);
  const clientConfig = configSnap.data() || {};

  // The social scope reuses the stored scout brief — require one up front so
  // the user gets a clear message instead of a failed run.
  let priorScoutBrief = null;
  if (scope === 'social-media-manager') {
    const dashSnap = await fb.adminDb.collection('dashboard_state').doc(context.clientId).get();
    priorScoutBrief = dashSnap.exists ? (dashSnap.data()?.marketingBrief?.scoutBrief || null) : null;
    if (!priorScoutBrief?.agentData) {
      return json({ error: 'No stored market signals yet — run the Executive Daily Brief (or Marketing Director) first.' }, 409);
    }
  }

  // Fresh A→B pass: clients with a website + module config get a full
  // intake run first (fresh screenshots, SEO, agent readiness, design,
  // search terms), which the worker then chains into the scout-brief run.
  // The executive brief always compiles from data captured this call.
  // Idea-only clients (no URL) fall through to the inline scout-brief below.
  // Scoped runs always take the inline path — no intake chain.
  const refreshUrl = clientConfig?.sourceInputs?.websiteUrl || clientConfig?.websiteUrl || null;
  if (refreshUrl && !scope) {
    // Legacy clients provisioned before module configs existed: seed the
    // default set so the worker's modular branch (and moduleBriefs) runs.
    if (!clientConfig.moduleConfig) {
      const { getDefaultModuleConfig } = require('../../../../../features/scout-intake/module-registry');
      await fb.adminDb.collection('client_configs').doc(context.clientId).set(
        { moduleConfig: getDefaultModuleConfig(), updatedAt: fb.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    const intakeRef = fb.adminDb.collection('brief_runs').doc();
    const intakeRunId = intakeRef.id;
    const queuedAt = fb.FieldValue.serverTimestamp();
    const intakePayload = {
      runId: intakeRunId,
      id: intakeRunId,
      clientId: context.clientId,
      requestedByUid: decoded.uid,
      trigger: 'brief-refresh',
      source: 'user',
      status: 'queued',
      pipelineType: 'free-tier-intake',
      attempts: 0,
      workerLease: null,
      startedAt: null,
      completedAt: null,
      error: null,
      summary: null,
      artifactRefs: [],
      providerUsage: null,
      moduleSnapshot: null,
      sourceUrl: refreshUrl,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    };
    await Promise.all([
      intakeRef.set(intakePayload),
      fb.adminDb.collection('clients').doc(context.clientId).collection('brief_runs').doc(intakeRunId).set(intakePayload),
      fb.adminDb.collection('clients').doc(context.clientId).set(
        { latestRunId: intakeRunId, latestRunStatus: 'queued', updatedAt: queuedAt },
        { merge: true }
      ),
      fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
        {
          latestRunId: intakeRunId,
          latestRunStatus: 'queued',
          modules: {
            'marketing-brief': { enabled: true, status: 'queued', lastRunId: intakeRunId },
          },
          updatedAt: queuedAt,
          errorState: null,
        },
        { merge: true }
      ),
    ]);

    const proto = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const workerUrl = `${proto}://${host}/api/worker/run-brief`;
    after(async () => {
      try {
        const response = await fetch(workerUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-worker-secret': process.env.WORKER_SECRET || '',
          },
          body: JSON.stringify({ runId: intakeRunId }),
          cache: 'no-store',
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          console.error(`[MARKETING-BRIEF] brief-refresh worker trigger failed for ${context.clientId}: ${response.status} ${detail.trim()}`);
        }
      } catch (err) {
        console.warn(`[MARKETING-BRIEF] brief-refresh worker trigger threw for ${context.clientId}: ${err?.message}`);
      }
    });

    return json({ ok: true, runId: intakeRunId, queued: true, chained: true });
  }

  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const now = fb.FieldValue.serverTimestamp();
  const payload = {
    runId,
    id: runId,
    clientId: context.clientId,
    requestedByUid: decoded.uid,
    trigger: scope ? `brief-scope-${scope}` : 'marketing-brief-card',
    source: 'user',
    status: 'queued',
    pipelineType: 'scout-brief',
    scope: scope || null,
    attempts: 0,
    workerLease: null,
    startedAt: null,
    completedAt: null,
    error: null,
    summary: null,
    artifactRefs: [],
    providerUsage: null,
    moduleSnapshot: null,
    sourceUrl: clientConfig?.sourceInputs?.websiteUrl || clientConfig?.websiteUrl || null,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    runRef.set(payload),
    fb.adminDb.collection('clients').doc(context.clientId).collection('brief_runs').doc(runId).set(payload),
    fb.adminDb.collection('clients').doc(context.clientId).set(
      { latestRunId: runId, latestRunStatus: 'queued', updatedAt: now },
      { merge: true }
    ),
    fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
      {
        latestRunId: runId,
        latestRunStatus: 'queued',
        modules: {
          'marketing-brief': {
            enabled: true,
            status: 'queued',
            lastRunId: runId,
          },
        },
        updatedAt: now,
        errorState: null,
      },
      { merge: true }
    ),
  ]);

  let claimedRun;
  try {
    claimedRun = await claimRun(runId);
    await fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
      {
        latestRunStatus: 'running',
        modules: {
          'marketing-brief': {
            enabled: true,
            status: 'running',
            lastRunId: runId,
          },
        },
        updatedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await appendRunEvent(runId, context.clientId, {
      stage: 'marketing-brief',
      progressLabel: scope === 'marketing-director'
        ? 'Starting scoped run — fresh market signals (Scout only)…'
        : scope === 'social-media-manager'
          ? "Starting scoped run — 30-day campaign + today's post…"
          : 'Starting Scout → Scribe → Guardian marketing brief...',
    }).catch(() => {});
  } catch (err) {
    return json({ error: err.message || 'Could not claim marketing brief run.', runId }, 409);
  }

  try {
    const { runClientPipeline } = getPipeline();
    const result = await runClientPipeline({ clientId: context.clientId, clientConfig, scope, priorScoutBrief });
    if (result.status === 'failed') {
      const pipelineErr = new Error(result.error || 'Marketing brief pipeline failed.');
      pipelineErr.stage = result.failedStage || 'pipeline';
      await failRun(runId, context.clientId, pipelineErr, claimedRun.attempts, {
        artifactRefs: result.artifactRefs,
        warnings: result.warnings,
      });
      await fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
        {
          modules: {
            'marketing-brief': {
              enabled: true,
              status: 'failed',
              lastRunId: runId,
              lastErrorMessage: pipelineErr.message,
            },
          },
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return json({ ok: false, runId, status: 'failed', failedStage: pipelineErr.stage }, 500);
    }

    await completeRun(runId, context.clientId, { ...result, pipelineType: 'scout-brief' });

    // Per-brief cover summaries — scoped runs refresh only the briefs whose
    // sections changed; a full inline run refreshes every cover. Deferred:
    // reads dashboard_state AFTER completeRun's projection lands; non-fatal.
    const summaryTypes = scope ? [scope, 'executive-daily'] : undefined;
    after(async () => {
      try {
        const { generateBriefSummaries } = await import('../../../../../features/scout-intake/brief-summary-runner.mjs');
        await generateBriefSummaries({ clientId: context.clientId, runId, briefTypes: summaryTypes });
      } catch (err) {
        console.warn(`[MARKETING-BRIEF] brief summaries non-fatal failure for ${context.clientId}: ${err?.message}`);
      }
    });

    return json({ ok: true, runId, status: 'succeeded' });
  } catch (err) {
    const pipelineErr = new Error(err.message || 'Marketing brief pipeline threw.');
    pipelineErr.stage = 'pipeline';
    await failRun(runId, context.clientId, pipelineErr, claimedRun.attempts);
    await fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
      {
        modules: {
          'marketing-brief': {
            enabled: true,
            status: 'failed',
            lastRunId: runId,
            lastErrorMessage: pipelineErr.message,
          },
        },
        updatedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return json({ error: 'Marketing brief execution failed.', runId }, 500);
  }
}
