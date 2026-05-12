import { NextResponse } from 'next/server';
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

export async function POST(request) {
  let decoded, context;
  try {
    ({ decoded, context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const configSnap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  if (!configSnap.exists) return json({ error: 'No client config.' }, 404);
  const clientConfig = configSnap.data() || {};

  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const now = fb.FieldValue.serverTimestamp();
  const payload = {
    runId,
    id: runId,
    clientId: context.clientId,
    requestedByUid: decoded.uid,
    trigger: 'marketing-brief-card',
    source: 'user',
    status: 'queued',
    pipelineType: 'scout-brief',
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
      progressLabel: 'Starting Scout → Scribe → Guardian marketing brief...',
    }).catch(() => {});
  } catch (err) {
    return json({ error: err.message || 'Could not claim marketing brief run.', runId }, 409);
  }

  try {
    const { runClientPipeline } = getPipeline();
    const result = await runClientPipeline({ clientId: context.clientId, clientConfig });
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
