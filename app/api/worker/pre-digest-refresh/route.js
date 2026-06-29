import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Refreshes the digest home client's intelligence BEFORE the daily-digest cron
// reads it, so the emailed Executive Brief links to a fresh daily stand-up.
//
// Two sequential refreshes (ordering matters — strategy reads fresh scout):
//   1. Marketing Brief, marketing-director scope = Scout-only signals (~$0.10).
//      Mirrors the dashboard scoped-run inline path (the queue worker ignores
//      scope, so a cheap Scout-only run only exists inline) — claimRun →
//      runClientPipeline → completeRun, where completeRun's projection persists
//      marketingBrief.scoutBrief.agentData to dashboard_state.
//   2. Strategy Builder generate → strategyBuilder.lastPlan (post-of-day +
//      30-day calendar) via the shared generateStrategyPlan core.
//
// The Email Digest stays a read-only aggregator; this worker is the refresher.
// Scheduled ahead of the digest in vercel.json. Each refresh is independent —
// one failing never blocks the other or the email (which shows last-good data).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { buildAuthRequestShim, getHeaderValue, safeSecretEquals, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { claimRun, completeRun, failRun, appendRunEvent, updateModuleState } = require('../../../../api/_lib/run-lifecycle.cjs');
const { logError, logInfo } = require('../../../../api/_lib/observability.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const { runWatchlistPull } = require('../../../../features/scout-intake/watchlist-pull');
const { buildModuleBriefs } = require('../../../../features/scout-intake/module-brief-builder.js');
const { getDefaultModuleConfig } = require('../../../../features/scout-intake/module-registry');
const { FALLBACK_BRIEF_SITE } = require('../../../../api/_lib/brief-fallback.cjs');

import { generateStrategyPlan } from '../../../../features/strategy-builder/generate-plan.js';
import { generateBriefSummaries } from '../../../../features/scout-intake/brief-summary-runner.mjs';

function getPipeline() {
  return require('../../../../features/not-the-rug-brief/runtime');
}

function getIntakeRunner() {
  return require('../../../../features/scout-intake/runner');
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Vercel cron sends CRON_SECRET as a Bearer token. Mirrors the daily-digest
 *  cron auth: fail closed in production when the secret is unset. */
function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
      return false;
    }
    return true; // allow in dev/preview for convenience
  }
  const provided = getHeaderValue(request.headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

/** Scout-only marketing brief refresh for one client. Returns a status object;
 *  never throws — failures are reported so strategy generation still proceeds. */
async function refreshScoutBrief(clientId) {
  let clientConfig;
  try {
    const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    if (!configSnap.exists) return { ok: false, error: 'No client config.' };
    clientConfig = configSnap.data() || {};
  } catch (err) {
    return { ok: false, error: `client_configs read failed: ${err.message}` };
  }

  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const now = fb.FieldValue.serverTimestamp();
  const payload = {
    runId,
    id: runId,
    clientId,
    requestedByUid: null,
    trigger: 'pre-digest-refresh',
    source: 'cron',
    status: 'queued',
    pipelineType: 'scout-brief',
    scope: 'marketing-director',
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

  try {
    await Promise.all([
      runRef.set(payload),
      fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId).set(payload),
    ]);
  } catch (err) {
    return { ok: false, error: `run doc create failed: ${err.message}` };
  }

  let claimedRun;
  try {
    claimedRun = await claimRun(runId);
    await appendRunEvent(runId, clientId, {
      stage: 'marketing-brief',
      progressLabel: 'Pre-digest refresh — fresh market signals (Scout only)…',
    }).catch(() => {});
  } catch (err) {
    return { ok: false, runId, error: `claimRun failed: ${err.message}` };
  }

  try {
    const { runClientPipeline } = getPipeline();
    const result = await runClientPipeline({
      clientId,
      clientConfig,
      scope: 'marketing-director',
      priorScoutBrief: null,
    });
    if (result.status === 'failed') {
      const pipelineErr = new Error(result.error || 'Marketing brief pipeline failed.');
      pipelineErr.stage = result.failedStage || 'pipeline';
      await failRun(runId, clientId, pipelineErr, claimedRun.attempts, {
        artifactRefs: result.artifactRefs,
        warnings: result.warnings,
      });
      return { ok: false, runId, error: pipelineErr.message, stage: pipelineErr.stage };
    }
    await completeRun(runId, clientId, { ...result, pipelineType: 'scout-brief' });
    return { ok: true, runId };
  } catch (err) {
    const pipelineErr = new Error(err.message || 'Marketing brief pipeline threw.');
    pipelineErr.stage = 'pipeline';
    try {
      await failRun(runId, clientId, pipelineErr, claimedRun.attempts, {});
    } catch { /* failRun best-effort */ }
    return { ok: false, runId, error: pipelineErr.message };
  }
}

/** Regenerate strategyBuilder.lastPlan from the persisted visible config, using
 *  the scout data just refreshed above. */
async function refreshStrategyPlan(clientId) {
  let storedConfig = {};
  try {
    const dsSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    storedConfig = dsSnap.exists ? (dsSnap.data()?.strategyBuilder?.config || {}) : {};
  } catch (err) {
    return { ok: false, error: `dashboard_state read failed: ${err.message}` };
  }
  try {
    const result = await generateStrategyPlan({ clientId, clientConfig: storedConfig });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Refresh website/creative module facts so the Executive Brief's site,
 *  performance, and creative sections are captured in this run. */
async function refreshSiteCreativeModules(clientId, freshnessToken = '') {
  let clientConfig;
  try {
    const configRef = fb.adminDb.collection('client_configs').doc(clientId);
    const configSnap = await configRef.get();
    if (!configSnap.exists) return { ok: false, error: 'No client config.' };
    clientConfig = configSnap.data() || {};
    if (!clientConfig.moduleConfig) {
      clientConfig.moduleConfig = getDefaultModuleConfig();
      await configRef.set({ moduleConfig: clientConfig.moduleConfig, updatedAt: fb.FieldValue.serverTimestamp() }, { merge: true });
    }
  } catch (err) {
    return { ok: false, error: `client config/module config failed: ${err.message}` };
  }

  const ownSiteUrl = clientConfig?.sourceInputs?.websiteUrl || clientConfig?.websiteUrl || null;
  const websiteUrl = ownSiteUrl || FALLBACK_BRIEF_SITE;
  const moduleIds = Array.from(new Set([
    ...Object.entries(clientConfig.moduleConfig || {})
      .filter(([, cfg]) => cfg?.enabled === true)
      .map(([id]) => id),
    'multi-device-view',
    'seo-performance',
    'agent-readiness',
    'social-preview',
    'style-guide',
    'design-evaluation',
  ]));
  if (!moduleIds.length) return { ok: false, error: 'no modules configured' };

  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const now = fb.FieldValue.serverTimestamp();
  const payload = {
    runId,
    id: runId,
    clientId,
    requestedByUid: null,
    trigger: 'pre-digest-modules',
    source: 'cron',
    status: 'running',
    pipelineType: 'module-run',
    moduleIds,
    freshnessToken: freshnessToken || null,
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

  try {
    await Promise.all([
      runRef.set(payload),
      fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId).set(payload),
    ]);
  } catch (err) {
    return { ok: false, runId, error: `module run doc create failed: ${err.message}` };
  }

  const onProgress = async (stage, label, extra = {}) => {
    try {
      await appendRunEvent(runId, clientId, {
        stage: stage || 'progress',
        progressLabel: label || '',
        ...(extra || {}),
      });
    } catch { /* non-fatal */ }
  };

  try {
    const { runModules } = getIntakeRunner();
    const { results } = await runModules({ clientId, runId, websiteUrl, moduleIds, onProgress });
    await updateModuleState(clientId, results, runId);
    const moduleBriefs = buildModuleBriefs(results, { expectedIds: moduleIds });
    if (moduleBriefs.length) {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        {
          moduleBriefs: {
            items: moduleBriefs,
            generatedAtIso: new Date().toISOString(),
            runId,
          },
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    const anyOk = results.some((r) => r.ok);
    const artifactRefs = results.flatMap((r) => Array.isArray(r.artifacts) ? r.artifacts : []);
    const warnings = results.flatMap((r) => Array.isArray(r.warnings) ? r.warnings : []);
    const stageCosts = results.filter((r) => r?.runCostData).map((r) => ({ stage: r.cardId, ...r.runCostData }));
    if (anyOk) {
      await completeRun(runId, clientId, {
        pipelineType: 'module-run',
        pipelineRunId: runId,
        artifactRefs,
        warnings,
        runCostData: stageCosts.length ? { stageCosts } : null,
      });
      return {
        ok: true,
        runId,
        modules: results.map((r) => ({ moduleId: r.cardId, ok: Boolean(r.ok), error: r.errorMessage || null })),
        generatedAt: new Date().toISOString(),
      };
    }
    const err = new Error(results.map((r) => r.errorMessage).filter(Boolean).join('; ') || 'all modules failed');
    err.stage = 'module';
    await failRun(runId, clientId, err, 1);
    return { ok: false, runId, error: err.message };
  } catch (err) {
    const runErr = new Error(err.message || 'module refresh threw');
    runErr.stage = 'module';
    try { await failRun(runId, clientId, runErr, 1); } catch { /* best effort */ }
    return { ok: false, runId, error: runErr.message };
  }
}

/** Regenerate brief cover/final-analysis summaries after fresh facts land. */
async function refreshBriefSummaries(clientId, runId = null) {
  try {
    const result = await generateBriefSummaries({
      clientId,
      runId,
      briefTypes: ['executive-daily', 'onboarding'],
    });
    return result.ok
      ? { ok: true, written: result.written || [] }
      : { ok: false, error: (result.failed || []).length ? `summary failed: ${result.failed.join(', ')}` : 'summary generation failed' };
  } catch (err) {
    return { ok: false, error: err.message || 'summary generation threw' };
  }
}

/** Refresh the followed-handle X timelines so the digest's watchlist renders
 *  fresh activity (the scout doesn't pull X, so without this the follows go
 *  stale / empty). Best-effort: the X pull can be flaky and never blocks the
 *  email — buildWatchlist falls back to whatever timelines already exist. */
async function refreshWatchlist(clientId) {
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const clientConfig = cfgSnap.exists ? cfgSnap.data() : {};
    if (!(clientConfig?.marketingBriefConfig?.kols || []).length) return { ok: false, skipped: 'no-kols' };
    const result = await runWatchlistPull({ clientId, clientConfig, detail: true });
    if (!result?.ok) return { ok: false, error: result?.error || 'pull failed' };
    const generatedAt = new Date().toISOString();
    const compactItem = (it) => ({
      author: it.author || '', text: String(it.text || '').slice(0, 600), url: it.url || '',
      likes: it.likes || 0, replies: it.replies || 0, reposts: it.reposts || 0, publishedAt: it.publishedAt || null,
    });
    const handles = (result.handles || [])
      .filter((h) => (h.ownPosts?.length || h.mentions?.length))
      .map((h) => ({
        handle: h.handle, engagementTotal: h.engagementTotal || 0,
        ownPosts: (h.ownPosts || []).slice(0, 8).map(compactItem),
        mentions: (h.mentions || []).slice(0, 12).map(compactItem),
      }));
    const patch = { marketingBrief: { watchlistTimelines: { handles, spotlight: result.spotlight || null, detail: true, generatedAt } } };
    if (result?.analysis?.text) patch.marketingBrief.reportSnapshot = { watchlistAnalysis: { text: result.analysis.text, generatedAt } };
    await fb.adminDb.collection('dashboard_state').doc(clientId).set(patch, { merge: true });
    logInfo('pre_digest_watchlist_refresh', { clientId, handles: handles.length });
    return { ok: true, handles: handles.length };
  } catch (err) {
    logError('pre_digest_watchlist_refresh_failed', { clientId, error: err.message });
    return { ok: false, error: err.message };
  }
}

/** Refresh one client's scout brief + watchlist timelines + strategy plan.
 *  Sequential (strategy reads fresh scout). Never throws. */
export async function refreshDigestClient(clientId, { freshnessToken = '' } = {}) {
  if (!clientId) return { ok: false, error: 'no clientId' };
  const [modules, scout, watchlist] = await Promise.all([
    refreshSiteCreativeModules(clientId, freshnessToken),
    refreshScoutBrief(clientId),
    refreshWatchlist(clientId),
  ]);
  const strategy = await refreshStrategyPlan(clientId);
  const briefSummaries = await refreshBriefSummaries(clientId, scout?.runId || modules?.runId || null);
  const digestFreshness = {
    token: freshnessToken || null,
    generatedAt: new Date().toISOString(),
    modulesGeneratedAt: modules?.generatedAt || null,
    scoutRunId: scout?.runId || null,
    moduleRunId: modules?.runId || null,
    strategyOk: Boolean(strategy?.ok),
    summaries: briefSummaries?.written || [],
  };
  await fb.adminDb.collection('dashboard_state').doc(clientId).set(
    { digestFreshness, updatedAt: fb.FieldValue.serverTimestamp() },
    { merge: true }
  ).catch(() => {});
  const watchlistWarning = !watchlist.ok && !watchlist.skipped
    ? (watchlist.error || 'watchlist pull failed')
    : null;
  return {
    ok: modules.ok && scout.ok && strategy.ok && briefSummaries.ok,
    clientId,
    modules,
    scout,
    watchlist,
    strategy,
    executiveSummary: briefSummaries,
    digestFreshness,
    warnings: watchlistWarning ? [{ source: 'watchlist', message: watchlistWarning }] : [],
  };
}

async function handle(request) {
  const startedAtMs = Date.now();
  const REFRESH_RESPONSE_BUDGET_MS = 270_000;
  const url = new URL(request.url);
  const requestedClientId = String(url.searchParams.get('clientId') || '').trim();
  const freshnessToken = String(url.searchParams.get('freshnessToken') || '').trim().slice(0, 160);
  const cronOk = hasValidCronSecret(request);
  let adminOk = false;
  if (!cronOk) {
    try {
      await verifyAdminRequest(buildAuthRequestShim(request));
      adminOk = true;
    } catch {
      adminOk = false;
    }
  }
  if (!cronOk && !adminOk) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  let homeClientId = null;
  let clientIds = [];
  try {
    const configClientId = await digestConfig.resolveDigestClientId();
    const cfg = await digestConfig.getDigestConfig(configClientId);
    homeClientId = cfg.homeClientId || configClientId;
    const configuredClientIds = [...new Set([homeClientId, ...(cfg.includeClientIds || [])].filter(Boolean))];
    if (requestedClientId) {
      if (!configuredClientIds.includes(requestedClientId)) {
        return json({ error: `Client ${requestedClientId} is not part of the digest config.` }, 400);
      }
      clientIds = [requestedClientId];
    } else {
      clientIds = configuredClientIds;
    }
  } catch (err) {
    logError('pre_digest_refresh_client_resolve_error', { error: err.message });
    return json({ error: `Could not resolve digest home client: ${err.message}` }, 500);
  }
  if (!homeClientId) return json({ error: 'No digest home client configured.' }, 404);

  logInfo('pre_digest_refresh_start', { clientId: homeClientId, clients: clientIds.length });

  // Use the single refresh path (scout → watchlist → strategy) so the scheduled
  // cron and manual Generate & Send produce identical fresh data — including
  // followed-handle timelines — and can never drift apart again.
  const results = [];
  for (const clientId of clientIds) {
    if (!requestedClientId && results.length > 0 && Date.now() - startedAtMs > REFRESH_RESPONSE_BUDGET_MS) {
      logError('pre_digest_refresh_budget_exhausted', {
        clientId: homeClientId,
        completed: results.length,
        total: clientIds.length,
        elapsedMs: Date.now() - startedAtMs,
      });
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    const result = await refreshDigestClient(clientId, { freshnessToken });
    results.push(result);
    logInfo('pre_digest_refresh_client_done', {
      clientId,
      modulesOk: result.modules?.ok,
      scoutOk: result.scout?.ok,
      watchlistOk: result.watchlist?.ok,
      watchlistWarning: result.warnings?.find((warning) => warning.source === 'watchlist')?.message,
      strategyOk: result.strategy?.ok,
      executiveSummaryOk: result.executiveSummary?.ok,
      ok: result.ok,
    });
  }
  const complete = results.length === clientIds.length;
  const ok = complete && results.every((result) => result.ok);
  const primary = results.find((result) => result.clientId === homeClientId) || results[0] || null;
  logInfo('pre_digest_refresh_done', { clientId: homeClientId, requestedClientId: requestedClientId || null, completed: results.length, clients: clientIds.length, ok });

  return json({
    ok,
    clientId: homeClientId,
    requestedClientId: requestedClientId || null,
    clientIds,
    complete,
    results,
    modules: primary?.modules || null,
    scout: primary?.scout || null,
    watchlist: primary?.watchlist || null,
    strategy: primary?.strategy || null,
    executiveSummary: primary?.executiveSummary || null,
    digestFreshness: primary?.digestFreshness || null,
  }, ok ? 200 : 207);
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
