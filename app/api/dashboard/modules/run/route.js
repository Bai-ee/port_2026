import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 300;

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { runModules } = require('../../../../../features/scout-intake/runner');
const {
  updateModuleState,
  appendRunEvent,
  completeRun,
  failRun,
} = require('../../../../../api/_lib/run-lifecycle.cjs');

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

/**
 * POST /api/dashboard/modules/run
 *
 * Runs one or more card modules for the signed-in user.
 * Already-succeeded modules are skipped unless force=true.
 * Only enabled modules (per moduleConfig) may be run.
 *
 * Creates a brief_runs doc and emits progress events so the dashboard
 * terminal can observe and replay the run lifecycle.
 *
 * Body: { cardIds: string[], force?: boolean }
 * Response: { ok, runId, queuedModules, skippedModules, results }
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) return json({ error: 'No user record.' }, 404);
  const clientId = userSnap.data()?.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  let cardIds, force, moduleOptions;
  try {
    const body = await request.json();
    cardIds = Array.isArray(body.cardIds) ? body.cardIds : [];
    force = Boolean(body.force);
    moduleOptions = body.moduleOptions && typeof body.moduleOptions === 'object' ? body.moduleOptions : {};
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (cardIds.length === 0) {
    return json({ error: 'cardIds must be a non-empty array.' }, 400);
  }

  const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  if (!configSnap.exists) return json({ error: 'No client config.' }, 404);
  const configData = configSnap.data();
  const websiteUrl = configData?.sourceInputs?.websiteUrl || configData?.websiteUrl || null;
  if (!websiteUrl) return json({ error: 'No websiteUrl in client config.' }, 400);

  // P2: enforce moduleConfig.enabled server-side — reject disabled cards
  const moduleConfig = configData?.moduleConfig || null;
  const disabledCards = cardIds.filter((cardId) => {
    if (!moduleConfig) return false; // legacy client with no config — allow
    return moduleConfig[cardId]?.enabled !== true;
  });
  if (disabledCards.length > 0) {
    return json({ error: `Module(s) not enabled: ${disabledCards.join(', ')}. Enable the module first.` }, 403);
  }

  // Filter out already-succeeded modules unless force=true
  const dashSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  const currentModules = dashSnap.exists ? (dashSnap.data()?.modules || {}) : {};

  const skippedModules = [];
  const moduleIds = cardIds.filter((cardId) => {
    if (!force && currentModules[cardId]?.status === 'succeeded') {
      skippedModules.push(cardId);
      return false;
    }
    return true;
  });

  if (moduleIds.length === 0) {
    return json({
      ok: true,
      runId: null,
      queuedModules: [],
      skippedModules,
      results: [],
      message: 'All requested modules already succeeded. Pass force=true to rerun.',
    });
  }

  // P1: create a brief_runs doc so the terminal lifecycle (latestRunId,
  // events stream, recentRuns) works the same as the worker-initiated path.
  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const now = fb.FieldValue.serverTimestamp();
  const runPayload = {
    runId,
    id: runId,
    clientId,
    requestedByUid: decoded.uid,
    trigger: 'module-enable',
    source: 'user',
    status: 'running',
    pipelineType: 'module-run',
    moduleIds,
    attempts: 1,
    workerLease: null,
    startedAt: now,
    completedAt: null,
    error: null,
    summary: null,
    artifactRefs: [],
    providerUsage: null,
    moduleSnapshot: null,
    sourceUrl: websiteUrl,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    runRef.set(runPayload),
    fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId).set(runPayload),
    // Advance client + dashboard_state so the UI enters the "running" state
    fb.adminDb.collection('clients').doc(clientId).set(
      { latestRunId: runId, latestRunStatus: 'running', updatedAt: now },
      { merge: true }
    ),
    fb.adminDb.collection('dashboard_state').doc(clientId).set(
      { latestRunId: runId, latestRunStatus: 'running', provisioningState: null, errorState: null, updatedAt: now },
      { merge: true }
    ),
  ]);

  // Emit start events so the terminal shows module-specific stages
  for (const moduleId of moduleIds) {
    await appendRunEvent(runId, clientId, {
      stage: moduleId,
      progressLabel: `Starting ${moduleId}…`,
    }).catch(() => {});
  }

  // Resolve per-module options. For multi-device-view, a mockup-only retry
  // (skipScreenshots=true) needs the existing viewport screenshot refs so the
  // module can hand them straight to the mockup composer.
  const moduleOptionsById = {};
  for (const mid of moduleIds) {
    const opts = moduleOptions?.[mid] ? { ...moduleOptions[mid] } : {};
    if (mid === 'multi-device-view' && opts.skipScreenshots) {
      const artifactsMap = dashSnap.exists ? (dashSnap.data()?.artifacts || {}) : {};
      const hs = artifactsMap.homepageScreenshots || {};
      const refs = Object.values(hs).filter(Boolean);
      if (refs.length > 0) {
        opts.existingScreenshotRefs = refs;
      } else {
        // No viewport screenshots available — fall back to a full run.
        opts.skipScreenshots = false;
      }
    }
    moduleOptionsById[mid] = opts;
  }

  let results;
  try {
    ({ results } = await runModules({ clientId, runId, websiteUrl, moduleIds, moduleOptionsById }));
  } catch (err) {
    const runErr = new Error(err.message || 'Module execution threw.');
    runErr.stage = 'module';
    await failRun(runId, clientId, runErr, 1);
    return json({ error: 'Module execution failed.', runId }, 500);
  }

  // Emit per-module completion events for terminal replay
  for (const r of results) {
    await appendRunEvent(runId, clientId, {
      stage: r.ok ? 'progress' : 'error',
      progressLabel: r.ok
        ? `${r.cardId} complete`
        : `${r.cardId} failed: ${r.errorMessage || 'unknown error'}`,
    }).catch(() => {});
  }

  await updateModuleState(clientId, results, runId);

  // Complete or fail the run so latestRunStatus flips to succeeded/failed
  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
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
    const minimalResult = {
      pipelineType: 'module-run',
      pipelineRunId: runId,
      artifactRefs,
      warnings,
      scoutPriorityAction: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      providerName: null,
      runCostData: null,
    };
    await completeRun(runId, clientId, minimalResult);
  } else {
    const allErrors = results.map((r) => r.errorMessage).filter(Boolean).join('; ');
    const runErr = new Error(allErrors || 'All modules failed.');
    runErr.stage = 'module';
    await failRun(runId, clientId, runErr, 1);
  }

  return json({
    ok: anyOk,
    runId,
    queuedModules: moduleIds,
    skippedModules,
    results,
  });
}
