import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// maxDuration replaces the vercel.json functions override for this route
export const maxDuration = 300;

const require = createRequire(import.meta.url);
const _fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const {
  claimRun,
  completeRun,
  failRun,
  findNextQueuedRun,
  updateRunProgress,
  updateModuleState,
} = require('../../../../api/_lib/run-lifecycle.cjs');

// Lazy-loaded: avoids pulling the full pipeline at module init time
function getPipeline() {
  return require('../../../../features/not-the-rug-brief/runtime');
}

// Lazy-loaded: free-tier intake pipeline (fetch + synthesize, no web search)
function getIntakePipeline() {
  return require('../../../../features/scout-intake/runner');
}

const WORKER_SECRET = process.env.WORKER_SECRET;

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function hasValidWorkerSecret(request) {
  if (!WORKER_SECRET) return false;
  return request.headers.get('x-worker-secret') === WORKER_SECRET;
}

async function authorizeRequest(request) {
  if (hasValidWorkerSecret(request)) return;
  await verifyAdminRequest(makeReqShim(request));
}

export async function POST(request) {
  // Step 1 — Auth
  try {
    await authorizeRequest(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Step 2 — Parse body
  let runId = null;
  try {
    const body = await request.json().catch(() => ({}));
    runId = body.runId || null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // Step 3 — Resolve runId
  if (!runId) {
    const nextRun = await findNextQueuedRun();
    if (!nextRun) {
      return NextResponse.json({ ok: true, message: 'No queued runs found.' });
    }
    runId = nextRun.id;
  }

  // Step 4 — Claim the run (atomic transaction)
  let claimedRun;
  try {
    claimedRun = await claimRun(runId);
  } catch (err) {
    return NextResponse.json({ error: err.message, runId }, { status: 409 });
  }

  const { clientId, attempts } = claimedRun;
  console.log(`[${new Date().toISOString()}] WORKER: claimed run ${runId} for client ${clientId} (attempt ${attempts})`);

  // Step 5 — Load client_config
  let clientConfig;
  try {
    const configDoc = await _fb.adminDb.collection('client_configs').doc(clientId).get();
    if (!configDoc.exists) {
      throw new Error(`client_configs/${clientId} not found.`);
    }
    clientConfig = configDoc.data();
  } catch (err) {
    console.error(`[WORKER] Config load failed for ${clientId}: ${err.message}`);
    const configErr = new Error(`Config load failed: ${err.message}`);
    configErr.stage = 'config';
    await failRun(runId, clientId, configErr, attempts);
    return NextResponse.json({ error: 'Failed to load client config.', runId }, { status: 500 });
  }

  // Step 6 — Execute pipeline (route by pipelineType)
  const pipelineType = claimedRun.pipelineType || 'scout-brief';
  console.log(`[${new Date().toISOString()}] WORKER: pipelineType=${pipelineType} for ${clientId}`);

  // Progress callback — writes stage telemetry to the run doc; non-fatal
  const onProgress = async (stage, label, extra = {}) => {
    try {
      await updateRunProgress(runId, clientId, { stage, progressLabel: label, ...extra });
    } catch {
      // never block the pipeline on a telemetry write failure
    }
  };

  let pipelineResult;
  try {
    if (pipelineType === 'free-tier-intake' && clientConfig?.moduleConfig) {
      // Modular client — run only enabled modules instead of the full legacy pipeline.
      // moduleConfig presence is the signal that this is a post-Phase-A provisioned client.
      const { runModules } = getIntakePipeline();
      const websiteUrl =
        clientConfig?.sourceInputs?.websiteUrl ||
        clientConfig?.websiteUrl ||
        null;

      const enabledModuleIds = Object.entries(clientConfig.moduleConfig)
        .filter(([, cfg]) => cfg?.enabled === true)
        .map(([id]) => id);

      const { results } = await runModules({
        clientId,
        runId,
        websiteUrl,
        moduleIds: enabledModuleIds,
        onProgress,
      });
      await updateModuleState(clientId, results, runId);

      const anyOk = results.some((r) => r.ok);
      const artifactRefs = results.flatMap((r) => Array.isArray(r.artifacts) ? r.artifacts : []);
      const warnings = results.flatMap((r) => {
        if (Array.isArray(r.warnings) && r.warnings.length > 0) {
          return r.warnings.map((w) => ({
            type: w?.type || 'warning',
            code: w?.code || 'unknown',
            message: w?.message || '',
            stage: w?.stage || null,
            detail: w?.detail || null,
            moduleId: r.cardId || null,
          }));
        }
        return Array.isArray(r.warningCodes)
          ? r.warningCodes.map((code) => ({ type: 'warning', code, moduleId: r.cardId || null }))
          : [];
      });
      pipelineResult = {
        status: anyOk ? 'succeeded' : 'failed',
        pipelineType: 'free-tier-intake',
        pipelineRunId: runId,
        artifactRefs,
        warnings,
        scoutPriorityAction: null,
        content: null,
        contentOpportunities: null,
        guardianFlags: null,
        providerName: null,
        runCostData: null,
        ...(anyOk ? {} : { error: results.map((r) => r.errorMessage).filter(Boolean).join('; '), failedStage: 'module' }),
      };
    } else if (pipelineType === 'free-tier-intake') {
      const { runIntakePipeline } = getIntakePipeline();
      pipelineResult = await runIntakePipeline({ clientId, clientConfig, onProgress, runId });
    } else {
      const { runClientPipeline } = getPipeline();
      pipelineResult = await runClientPipeline({ clientId, clientConfig });
    }
  } catch (err) {
    console.error(`[WORKER] Pipeline threw for ${clientId}: ${err.message}`);
    const pipelineErr = new Error(err.message || 'Pipeline threw an unhandled error.');
    pipelineErr.stage = 'pipeline';
    await failRun(runId, clientId, pipelineErr, attempts);
    return NextResponse.json({ error: 'Pipeline execution failed.', runId }, { status: 500 });
  }

  // Step 7 — Write result
  if (pipelineResult.status === 'failed') {
    const stageErr = new Error(pipelineResult.error || 'Pipeline returned failed status.');
    stageErr.stage = pipelineResult.failedStage || 'pipeline';
    await failRun(runId, clientId, stageErr, attempts, {
      artifactRefs: pipelineResult.artifactRefs,
      warnings: pipelineResult.warnings,
    });
    console.log(`[WORKER] Run ${runId} failed at stage: ${stageErr.stage}`);
    return NextResponse.json({
      ok: false,
      runId,
      clientId,
      status: 'failed',
      failedStage: stageErr.stage,
    });
  }

  await completeRun(runId, clientId, pipelineResult);
  console.log(`[${new Date().toISOString()}] WORKER: run ${runId} succeeded for ${clientId}`);
  return NextResponse.json({
    ok: true,
    runId,
    clientId,
    status: 'succeeded',
    pipelineRunId: pipelineResult.pipelineRunId,
  });
}
