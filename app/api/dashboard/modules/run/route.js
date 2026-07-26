import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Keep this on the shared 120s Fluid configuration so Vercel can bundle the
// API surface within Hobby's per-deployment function limit. Typical module run:
//   fetch 2–5s · PSI 30–45s · AI SEO 2–5s · skill 5–10s · writes <1s
// Usually fits; edge cases may truncate. For Pro/Enterprise, raise as needed.
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { runModules, knownModuleIds } = require('../../../../../features/scout-intake/runner');
const {
  updateModuleState,
  appendRunEvent,
  completeRun,
  failRun,
} = require('../../../../../api/_lib/run-lifecycle.cjs');
const { narrateDqCard } = require('../../../../../features/intelligence/_dq-narrator.js');
const { buildModuleBriefs } = require('../../../../../features/scout-intake/module-brief-builder.js');

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

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return json({ error: err.message || 'Forbidden.' }, err.status || 403);
  }
  if (!context.userProfile) return json({ error: 'No user record.' }, 404);
  const clientId = context.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  let cardIds, force, moduleOptions, autoEnable;
  try {
    const body = await request.json();
    cardIds = Array.isArray(body.cardIds) ? body.cardIds : [];
    force = Boolean(body.force);
    moduleOptions = body.moduleOptions && typeof body.moduleOptions === 'object' ? body.moduleOptions : {};
    autoEnable = Boolean(body.autoEnable);
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (cardIds.length === 0) {
    return json({ error: 'cardIds must be a non-empty array.' }, 400);
  }

  // Guard: only card ids with a REGISTERED runner may enter the pipeline.
  // Custom cards (site-recreate, copywriter, …) have their own routes; letting
  // one in here creates a failed brief_run + a persistent dashboard errorState
  // toast ("Initial setup encountered an issue") — bit us when a stray
  // autoEnable click flipped moduleConfig['site-recreate'].enabled=true and
  // every subsequent bulk run failed. Reject BEFORE any autoEnable flip.
  const known = new Set(knownModuleIds());
  const unknownCards = cardIds.filter((cardId) => !known.has(cardId));
  if (unknownCards.length > 0) {
    return json({ error: `Not a runnable module: ${unknownCards.join(', ')}.` }, 400);
  }

  const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  if (!configSnap.exists) return json({ error: 'No client config.' }, 404);
  const configData = configSnap.data();
  const websiteUrl = configData?.sourceInputs?.websiteUrl || configData?.websiteUrl || null;
  if (!websiteUrl) return json({ error: 'No websiteUrl in client config.' }, 400);

  // P2: enforce moduleConfig.enabled server-side — reject disabled cards
  // unless autoEnable=true, in which case we flip them on in-place before
  // running. This lets first-run cards (Social Preview RUN click, etc.) use
  // the same single-call path as reruns.
  const moduleConfig = configData?.moduleConfig || null;
  const disabledCards = cardIds.filter((cardId) => {
    if (!moduleConfig) return false;
    return moduleConfig[cardId]?.enabled !== true;
  });
  if (disabledCards.length > 0) {
    if (!autoEnable) {
      return json({ error: `Module(s) not enabled: ${disabledCards.join(', ')}. Enable the module first.` }, 403);
    }
    // Use .update() so dot-path keys are interpreted as nested field paths.
    // set({...}, { merge: true }) treats "a.b.c" as a literal top-level key.
    const clientConfigPatch = { updatedAt: fb.FieldValue.serverTimestamp() };
    const dashboardStatePatch = { updatedAt: fb.FieldValue.serverTimestamp() };
    for (const cardId of disabledCards) {
      clientConfigPatch[`moduleConfig.${cardId}.enabled`] = true;
      dashboardStatePatch[`modules.${cardId}.enabled`] = true;
    }
    await fb.adminDb.collection('client_configs').doc(clientId).update(clientConfigPatch);
    await fb.adminDb.collection('dashboard_state').doc(clientId).update(dashboardStatePatch);
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

  // Stream in-module progress events into brief_runs/{runId}/events so the
  // dashboard terminal shows each stage (fetch, capture, compose, normalize)
  // instead of only the start + completion markers appended from this route.
  const onProgress = async (stage, label, extra = {}) => {
    try {
      await appendRunEvent(runId, clientId, {
        stage: stage || 'progress',
        progressLabel: label || '',
        ...(extra || {}),
      });
    } catch { /* non-fatal */ }
  };

  let results;
  try {
    ({ results } = await runModules({ clientId, runId, websiteUrl, moduleIds, moduleOptionsById, onProgress }));
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

  // Upsert per-module mini-briefs so an individually run brief (Creative,
  // Performance) rolls straight into the executive brief. Only the modules
  // that ran are replaced — every other module's stored section is kept,
  // so partial runs never detract from the full report.
  try {
    const freshBriefs = buildModuleBriefs(results, { expectedIds: moduleIds });
    if (freshBriefs.length) {
      const stateRef = fb.adminDb.collection('dashboard_state').doc(clientId);
      const stateSnap = await stateRef.get();
      const existing = stateSnap.exists ? (stateSnap.data()?.moduleBriefs?.items || []) : [];
      const freshIds = new Set(freshBriefs.map((b) => b.moduleId));
      const merged = [...existing.filter((b) => b?.moduleId && !freshIds.has(b.moduleId)), ...freshBriefs];
      await stateRef.set(
        {
          moduleBriefs: {
            items: merged,
            generatedAtIso: new Date().toISOString(),
            runId,
          },
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (mbErr) {
    console.warn('[modules/run] moduleBriefs upsert non-fatal:', mbErr?.message);
  }

  // Blocking: generate AI description for the Data Stream card before responding.
  // Must complete before the client re-fetches bootstrap so the description lands
  // in moduleState on the very next load. Haiku adds ~1–2s — acceptable on a 15s run.
  if (results.some((r) => r.ok)) {
    try {
      console.log('[dq-narrator] starting description generation for', clientId);
      const freshSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
      const freshModules = freshSnap.exists ? (freshSnap.data()?.modules || {}) : {};
      console.log('[dq-narrator] module keys:', Object.keys(freshModules));
      const aiDescription = await narrateDqCard(freshModules, { clientId });
      console.log('[dq-narrator] description result:', aiDescription);
      if (aiDescription) {
        await fb.adminDb.collection('dashboard_state').doc(clientId).update({
          'modules.audit-summary.aiDescription': aiDescription,
          'modules.audit-summary.aiDescriptionUpdatedAt': fb.FieldValue.serverTimestamp(),
        });
        console.log('[dq-narrator] written to Firestore');
      }
    } catch (err) {
      console.warn('[run/route] dq-narrator failed (non-fatal):', err.message, err.stack);
    }
  }

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
    // Per-module LLM costs (skill runs) roll up into the run's providerUsage
    // so the ops dashboard prices Creative/Website brief runs accurately.
    const stageCosts = results
      .filter((r) => r?.runCostData)
      .map((r) => ({ stage: r.cardId, ...r.runCostData }));
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
      runCostData: stageCosts.length ? { stageCosts } : null,
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
