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
const { getMarketInsightPlatformState } = require('../../../../features/intelligence/_market-insight-platform-state.js');
const { runAnalysisRecipe } = require('../../../../features/intelligence/analysis-recipes/run-recipe.js');
const { getRecipe } = require('../../../../features/intelligence/analysis-recipes/recipes.js');
const { loadClientBrainContext } = require('../../../../features/client-brain/store.cjs');
const { logUsage } = require('../../../../api/_lib/usage-logger.cjs');
const { runWatchlistPull } = require('../../../../features/scout-intake/watchlist-pull');
const { buildModuleBriefs } = require('../../../../features/scout-intake/module-brief-builder.js');
const { getDefaultModuleConfig } = require('../../../../features/scout-intake/module-registry');
const { FALLBACK_BRIEF_SITE } = require('../../../../api/_lib/brief-fallback.cjs');
const { collectRedditSignals, collectInstagramSignals } = require('../../../../features/intelligence/_platform-signals.js');
const { searchReddit: scSearchReddit, searchInstagram: scSearchInstagram, redditQueriesFromCustomRows: scRedditQueries, hasApiKey: scHasApiKey } = require('../../../../features/scout-intake/external-scouts/scrapecreators-client.js');

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

function addVelocity(it, nowMs) {
  if (!it || typeof it !== 'object') return it;
  const published = it.publishedAt || it.createdAt || it.date || it.timestamp || null;
  const ts = published ? Date.parse(published) : NaN;
  if (!Number.isFinite(ts)) return it;
  const ageHours = Math.max(0, (nowMs - ts) / 3_600_000);
  const eng = (it.likes || 0) + (it.retweets || 0) + (it.reposts || 0) + (it.replies || 0) + (it.comments || 0) + (it.upvotes || 0) + (it.score || 0) + (it.engagement || 0);
  return {
    ...it,
    ageHours: Math.round(ageHours * 10) / 10,
    velocityPerHour: Math.round((eng / Math.max(ageHours, 0.5)) * 10) / 10,
    replyWindowOpen: ageHours <= 6,
  };
}

function buildRedditAnalysisContent(marketingBrief = {}, nowMs = Date.now()) {
  const redditSignals = collectRedditSignals(marketingBrief).map((it) => addVelocity(it, nowMs));
  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: 'marketingBrief.scoutBrief.agentData.redditSignals + marketingBrief.reportSnapshot.platformTests.reddit',
    redditSignals,
    dataQuality: {
      itemsAvailable: redditSignals.length,
      note: redditSignals.length
        ? 'Analyze only these supplied Reddit signals. Missing engagement or timestamps means freshness is unknown.'
        : 'No Reddit signals are currently available in stored Market Insights data.',
    },
  };
}

function buildInstagramAnalysisContent(marketingBrief = {}, nowMs = Date.now()) {
  const instagramSignals = collectInstagramSignals(marketingBrief).map((it) => addVelocity(it, nowMs));
  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: 'marketingBrief.scoutBrief.agentData.instagramSignals + marketingBrief.reportSnapshot.platformTests.instagram',
    instagramSignals,
    dataQuality: {
      itemsAvailable: instagramSignals.length,
      note: instagramSignals.length
        ? 'Analyze only these supplied Instagram signals. Missing engagement or timestamps means freshness is unknown.'
        : 'No Instagram signals are currently available in stored Market Insights data.',
    },
  };
}

async function logRecipeUsage({ clientId, recipeId, result, interactive = false }) {
  if (!result?.costUsd) return;
  const recipe = getRecipe(recipeId);
  await logUsage({
    module: 'market-insights',
    action: `analysis.${recipeId}`,
    provider: 'anthropic',
    model: recipe?.model || 'claude-sonnet-4-5-20250929',
    costUsd: result.costUsd,
    clientId,
    metadata: { recipeId, interactive },
  }).catch(() => {});
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

// How fresh a scout brief must be to skip a re-run. The daily cron fires ~24h
// apart so it always refreshes; this only suppresses redundant full-scout runs
// from repeated manual digest tests within the same window (the main cost
// spike). Pass force=1 to the worker to override.
const SCOUT_FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Scout-only marketing brief refresh for one client. Returns a status object;
 *  never throws — failures are reported so strategy generation still proceeds.
 *  Skips the run (no LLM/web_search cost) when a successful scout brief is newer
 *  than SCOUT_FRESH_WINDOW_MS, unless force is set. */
async function refreshScoutBrief(clientId, { force = false, source = 'cron-scheduled', actorUid = null } = {}) {
  let clientConfig;
  try {
    const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    if (!configSnap.exists) return { ok: false, error: 'No client config.' };
    clientConfig = configSnap.data() || {};
  } catch (err) {
    return { ok: false, error: `client_configs read failed: ${err.message}` };
  }

  if (!force) {
    try {
      const dsSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
      const mb = dsSnap.exists ? (dsSnap.data()?.marketingBrief || {}) : {};
      const stampMs = Date.parse(mb.generatedAtIso || mb?.scoutBrief?.timestamp || '');
      if (Number.isFinite(stampMs)) {
        const ageMs = Date.now() - stampMs;
        if (ageMs >= 0 && ageMs < SCOUT_FRESH_WINDOW_MS) {
          const ageMinutes = Math.round(ageMs / 60000);
          logInfo('pre_digest_scout_skip_fresh', { clientId, ageMinutes });
          return { ok: true, skipped: 'fresh', ageMinutes };
        }
      }
    } catch { /* freshness read failed — fall through and refresh */ }
  }

  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const now = fb.FieldValue.serverTimestamp();
  const payload = {
    runId,
    id: runId,
    clientId,
    requestedByUid: actorUid,
    trigger: 'pre-digest-refresh',
    source,
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
async function refreshSiteCreativeModules(clientId, freshnessToken = '', { source = 'cron-scheduled', actorUid = null } = {}) {
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
    requestedByUid: actorUid,
    trigger: 'pre-digest-modules',
    source,
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

/** Run the reply-targets recipe over fresh watchlist + signal data and persist
 *  the result to marketingBrief.reportSnapshot.digestRecipes so the email digest
 *  can read it without re-running LLM calls. Non-blocking: never throws. */
async function refreshReplyTargets(clientId) {
  if (!clientId) return { ok: false, skipped: true };
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    const marketingBrief = snap.exists ? (snap.data()?.marketingBrief || {}) : {};
    const agentData = marketingBrief?.scoutBrief?.agentData || null;
    const watchlistTimelines = marketingBrief?.watchlistTimelines || null;
    const redditSignals = collectRedditSignals(marketingBrief);
    const instagramSignals = collectInstagramSignals(marketingBrief);
    if (!agentData && !watchlistTimelines && !redditSignals.length && !instagramSignals.length) return { ok: false, skipped: true, error: 'no signal data' };
    const nowMs = Date.now();
    const replyPool = {
      generatedAt: new Date(nowMs).toISOString(),
      replyWindowHours: 6,
      watchlistMentions: (Array.isArray(watchlistTimelines?.handles) ? watchlistTimelines.handles : []).map((h) => ({
        ...h,
        ownPosts: Array.isArray(h?.ownPosts) ? h.ownPosts.map((it) => addVelocity(it, nowMs)) : [],
        mentions: Array.isArray(h?.mentions) ? h.mentions.map((it) => addVelocity(it, nowMs)) : [],
      })),
      brandMentions: (Array.isArray(agentData?.brandMentions) ? agentData.brandMentions : []).map((it) => addVelocity(it, nowMs)),
      redditSignals: redditSignals.map((it) => addVelocity(it, nowMs)),
      instagramSignals: instagramSignals.map((it) => addVelocity(it, nowMs)),
      kolActivity: (Array.isArray(agentData?.kolActivity) ? agentData.kolActivity : []).map((it) => addVelocity(it, nowMs)),
    };
    const contextParts = [];
    try {
      const voiceCtx = await loadClientBrainContext(clientId, { useFor: 'copy', maxChars: 2000 });
      if (voiceCtx) contextParts.push(voiceCtx);
    } catch { /* non-fatal */ }
    const context = contextParts.join('\n\n');
    const generatedAt = new Date().toISOString();
    const result = await runAnalysisRecipe({ recipeId: 'reply-targets', content: replyPool, context });
    const stampedResult = {
      ...result,
      generatedAt,
      inputGeneratedAt: replyPool.generatedAt,
      sourceFreshness: {
        scout: marketingBrief?.scoutBrief?.timestamp || marketingBrief?.generatedAtIso || null,
        watchlist: watchlistTimelines?.generatedAt || null,
      },
    };
    await logRecipeUsage({ clientId, recipeId: 'reply-targets', result });
    await fb.adminDb.collection('dashboard_state').doc(clientId).set(
      { marketingBrief: { reportSnapshot: { digestRecipes: [stampedResult] } } },
      { merge: true }
    );
    logInfo('pre_digest_reply_targets', { clientId, ok: result.ok, costUsd: result.costUsd, generatedAt });
    return { ok: result.ok, recipeId: 'reply-targets', costUsd: result.costUsd, generatedAt };
  } catch (err) {
    logError('pre_digest_reply_targets_failed', { clientId, error: err.message });
    return { ok: false, error: err.message };
  }
}

/** Run the Reddit platform analysis over stored redditSignals and persist it to
 *  marketingBrief.reportSnapshot.redditAnalysis so email/brief renderers can read
 *  it without re-running LLM calls. Non-blocking: never throws. */
async function refreshRedditAnalysis(clientId) {
  if (!clientId) return { ok: false, skipped: true };
  try {
    const platformState = await getMarketInsightPlatformState(clientId);
    if (platformState?.platformAvailability?.reddit === false) {
      return { ok: false, skipped: true, reason: 'reddit-disabled' };
    }
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    const marketingBrief = snap.exists ? (snap.data()?.marketingBrief || {}) : {};
    const redditSignals = collectRedditSignals(marketingBrief);
    if (!redditSignals.length) return { ok: false, skipped: true, reason: 'no-reddit-signals' };

    const generatedAt = new Date().toISOString();
    const content = buildRedditAnalysisContent(marketingBrief, Date.now());
    const contextParts = [];
    try {
      const voiceCtx = await loadClientBrainContext(clientId, { useFor: 'copy', maxChars: 1600 });
      if (voiceCtx) contextParts.push(voiceCtx);
    } catch { /* non-fatal */ }
    const result = await runAnalysisRecipe({ recipeId: 'reddit-analysis', content, context: contextParts.join('\n\n') });
    await logRecipeUsage({ clientId, recipeId: 'reddit-analysis', result });
    if (result?.analysis) {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        { marketingBrief: { reportSnapshot: { redditAnalysis: { text: result.analysis, generatedAt } } } },
        { merge: true }
      );
    }
    logInfo('pre_digest_reddit_analysis', { clientId, ok: result.ok, costUsd: result.costUsd, signals: redditSignals.length });
    return { ok: result.ok, recipeId: 'reddit-analysis', costUsd: result.costUsd, signals: redditSignals.length };
  } catch (err) {
    logError('pre_digest_reddit_analysis_failed', { clientId, error: err.message });
    return { ok: false, error: err.message };
  }
}

/** Instagram mirror of refreshRedditAnalysis. Runs the instagram-analysis recipe
 *  over stored instagramSignals and persists reportSnapshot.instagramAnalysis. */
async function refreshInstagramAnalysis(clientId) {
  if (!clientId) return { ok: false, skipped: true };
  try {
    const platformState = await getMarketInsightPlatformState(clientId);
    if (platformState?.platformAvailability?.instagram === false) {
      return { ok: false, skipped: true, reason: 'instagram-disabled' };
    }
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    const marketingBrief = snap.exists ? (snap.data()?.marketingBrief || {}) : {};
    const instagramSignals = collectInstagramSignals(marketingBrief);
    if (!instagramSignals.length) return { ok: false, skipped: true, reason: 'no-instagram-signals' };

    const generatedAt = new Date().toISOString();
    const content = buildInstagramAnalysisContent(marketingBrief, Date.now());
    const contextParts = [];
    try {
      const voiceCtx = await loadClientBrainContext(clientId, { useFor: 'copy', maxChars: 1600 });
      if (voiceCtx) contextParts.push(voiceCtx);
    } catch { /* non-fatal */ }
    const result = await runAnalysisRecipe({ recipeId: 'instagram-analysis', content, context: contextParts.join('\n\n') });
    await logRecipeUsage({ clientId, recipeId: 'instagram-analysis', result });
    if (result?.analysis) {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        { marketingBrief: { reportSnapshot: { instagramAnalysis: { text: result.analysis, generatedAt } } } },
        { merge: true }
      );
    }
    logInfo('pre_digest_instagram_analysis', { clientId, ok: result.ok, costUsd: result.costUsd, signals: instagramSignals.length });
    return { ok: result.ok, recipeId: 'instagram-analysis', costUsd: result.costUsd, signals: instagramSignals.length };
  } catch (err) {
    logError('pre_digest_instagram_analysis_failed', { clientId, error: err.message });
    return { ok: false, error: err.message };
  }
}

/** Pull fresh Reddit + Instagram signals via the direct ScrapeCreators Node client
 *  and persist them to reportSnapshot.platformTests. This is the PRODUCTION source
 *  for those platforms — the last30days subprocess can't run on Vercel, so this
 *  Vercel-native HTTP client is what populates Reddit/Instagram for the cron. Runs
 *  before the analysis/reply steps so collect*Signals see fresh data. Never throws. */
async function refreshPlatformSignals(clientId) {
  if (!clientId || !scHasApiKey()) return { ok: false, skipped: true, reason: 'no-key' };
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const mbc = (cfgSnap.exists ? (cfgSnap.data() || {}) : {}).marketingBriefConfig || {};
    const sources = new Set((Array.isArray(mbc.sourcePlatforms) ? mbc.sourcePlatforms : []).map((s) => String(s || '').toLowerCase()));
    const brand = String(mbc.brandName || '').replace(/^["']+|["']+$/g, '').trim();
    const cats = Array.isArray(mbc.categoryTerms) ? mbc.categoryTerms.filter(Boolean) : [];
    const persist = async (platform, items, meta) => {
      const entry = JSON.parse(JSON.stringify({
        items: (items || []).slice(0, 20), count: (items || []).length, costUsd: 0, ms: null,
        meta: meta || null, generatedAt: new Date().toISOString(),
      }));
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        { marketingBrief: { reportSnapshot: { platformTests: { [platform]: entry } } }, updatedAt: fb.FieldValue.serverTimestamp() },
        { merge: true }
      );
    };
    const creators = (Array.isArray(mbc.instagramHandles) ? mbc.instagramHandles : []).map((h) => String(h || '').replace(/^@+/, '')).filter((h) => h.length >= 2);
    // Reddit + Instagram pulled concurrently (each already runs its own queries
    // concurrently) so this whole step is ~one slow HTTP call, not the sum.
    const [r, ig] = await Promise.all([
      sources.has('reddit') ? scSearchReddit({ queries: scRedditQueries({ brand, categoryTerms: cats, searches: mbc.searches }), limit: 12 }) : Promise.resolve(null),
      sources.has('instagram') ? scSearchInstagram({ queries: [brand, ...cats.slice(0, 1)].filter(Boolean), creators, limit: 12 }) : Promise.resolve(null),
    ]);
    const out = {};
    if (r) { if (r.ok && r.items.length) await persist('reddit', r.items, r.meta); out.reddit = r.ok ? r.items.length : `err:${r.error}`; }
    if (ig) { if (ig.ok && ig.items.length) await persist('instagram', ig.items, ig.meta); out.instagram = ig.ok ? ig.items.length : `err:${ig.error}`; }
    logInfo('pre_digest_platform_signals', { clientId, ...out });
    return { ok: true, ...out };
  } catch (err) {
    logError('pre_digest_platform_signals_failed', { clientId, error: err.message });
    return { ok: false, error: err.message };
  }
}

/** Refresh one client's scout brief + watchlist timelines + strategy plan.
 *  Sequential (strategy reads fresh scout). Never throws. */
export async function refreshDigestClient(clientId, { freshnessToken = '', force = false, source = 'cron-scheduled', actorUid = null, include = {}, briefLinkMode = 'fresh', phase = 'all' } = {}) {
  if (!clientId) return { ok: false, error: 'no clientId' };
  // Phases: the FULL refresh (~5-6 min for a cold client) exceeds Vercel's 300s
  // function ceiling, so the interactive Run & Send calls this route three times —
  // phase=modules | signals | analysis — each comfortably under the limit. Steps
  // outside the requested phase resolve to { ok:true, skipped:'other-phase' } so
  // the ok/sendable math is unchanged. No phase (the cron) = everything, as before.
  const wantModules = phase === 'all' || phase === 'modules';
  const wantSignals = phase === 'all' || phase === 'signals';
  const wantAnalysis = phase === 'all' || phase === 'analysis';
  const phaseSkip = () => Promise.resolve({ ok: true, skipped: true, reason: 'other-phase' });
  // Cost gate: only refresh the expensive brief compute a send will actually
  // use. A fresh brief page (briefLinkMode 'fresh' + link shown) renders creative
  // modules + executive summary, so those must run even when their own email
  // sections are off. Otherwise each step is gated on the toggles that consume
  // it — hidden creative/exec sections no longer pay the render/LLM cost.
  const freshBriefWanted = include.execBriefLink !== false && briefLinkMode === 'fresh';
  const creativeWanted = freshBriefWanted
    || include.creativeBrief !== false
    || include.videoPromo !== false
    || include.videoPosts !== false;
  const execSummaryWanted = freshBriefWanted || include.execSummary !== false;
  const [modules, scout, watchlist, platformSignals] = await Promise.all([
    !wantModules ? phaseSkip() : (creativeWanted
      ? refreshSiteCreativeModules(clientId, freshnessToken, { source, actorUid })
      : Promise.resolve({ ok: true, skipped: true, reason: 'creative-sections-off' })),
    wantSignals ? refreshScoutBrief(clientId, { force, source, actorUid }) : phaseSkip(),
    wantSignals ? refreshWatchlist(clientId) : phaseSkip(),
    // Reddit/Instagram via the direct ScrapeCreators client → platformTests.
    // Runs here so it completes before the analysis/reply steps read collect*Signals.
    // This is what makes Reddit/IG populate in PRODUCTION (last30days can't run there).
    wantSignals ? refreshPlatformSignals(clientId) : phaseSkip(),
  ]);
  const [strategy, replyTargets, redditAnalysis, instagramAnalysis] = await Promise.all([
    wantAnalysis ? refreshStrategyPlan(clientId) : phaseSkip(),
    wantAnalysis ? refreshReplyTargets(clientId) : phaseSkip(), // needs fresh watchlist timelines already written above
    wantAnalysis ? refreshRedditAnalysis(clientId) : phaseSkip(),
    wantAnalysis ? refreshInstagramAnalysis(clientId) : phaseSkip(),
  ]);
  const briefSummaries = !wantAnalysis
    ? { ok: true, skipped: true, reason: 'other-phase' }
    : (execSummaryWanted
      ? await refreshBriefSummaries(clientId, scout?.runId || modules?.runId || null)
      : { ok: true, skipped: true, reason: 'exec-summary-off' });
  // digestFreshness records the completed refresh — written by the final phase
  // (analysis) or the unphased run, so partial phases don't stamp a full refresh.
  const digestFreshness = {
    token: freshnessToken || null,
    generatedAt: new Date().toISOString(),
    modulesGeneratedAt: modules?.generatedAt || null,
    scoutRunId: scout?.runId || null,
    moduleRunId: modules?.runId || null,
    strategyOk: Boolean(strategy?.ok),
    summaries: briefSummaries?.written || [],
    redditAnalysisOk: Boolean(redditAnalysis?.ok),
    instagramAnalysisOk: Boolean(instagramAnalysis?.ok),
  };
  if (wantAnalysis) {
    await fb.adminDb.collection('dashboard_state').doc(clientId).set(
      { digestFreshness, updatedAt: fb.FieldValue.serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  }
  const watchlistWarning = !watchlist.ok && !watchlist.skipped
    ? (watchlist.error || 'watchlist pull failed')
    : null;
  return {
    // ok = every step clean (for logging/telemetry). sendable = the CORE content a
    // worthwhile email needs (fresh scout signals + an executive summary). Creative
    // modules, strategy (30-day plan / suggested posts — opt-in, default OFF), and
    // watchlist are BONUS: if they fail, their sections show an empty-state, so they
    // must NOT block the send. The send gate uses `sendable`, not `ok` — otherwise a
    // client merely missing a category (strategy fails) kills an otherwise-good email.
    ok: modules.ok && scout.ok && strategy.ok && briefSummaries.ok,
    sendable: scout.ok && briefSummaries.ok,
    phase,
    clientId,
    modules,
    scout,
    watchlist,
    strategy,
    replyTargets,
    redditAnalysis,
    instagramAnalysis,
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
  // force=1 (or forceScout=1) bypasses the scout freshness skip — use when you
  // explicitly want a fresh full scout (the daily cron sends no params, so it
  // gets the cost-saving skip when a brief is already <6h old).
  const forceScout = url.searchParams.get('force') === '1' || url.searchParams.get('forceScout') === '1';
  // phase=modules|signals|analysis splits the refresh across three sub-300s
  // requests (the interactive Run & Send path). No/invalid phase = full refresh.
  const rawPhase = String(url.searchParams.get('phase') || '').trim().toLowerCase();
  const phase = ['modules', 'signals', 'analysis'].includes(rawPhase) ? rawPhase : 'all';
  const cronOk = hasValidCronSecret(request);
  let adminOk = false;
  let actorUid = null;
  if (!cronOk) {
    try {
      const decoded = await verifyAdminRequest(buildAuthRequestShim(request));
      adminOk = true;
      actorUid = decoded?.uid || null;
    } catch {
      adminOk = false;
    }
  }
  if (!cronOk && !adminOk) {
    return json({ error: 'Unauthorized.' }, 401);
  }
  // Who fired this run — distinguishes the Vercel scheduled cron (valid
  // CRON_SECRET) from a manual admin call, so the Operating Cost card can show
  // attribution instead of everything reading "cron". Threaded into each run doc.
  const triggerSource = cronOk ? 'cron-scheduled' : 'manual-admin';

  let homeClientId = null;
  let clientIds = [];
  try {
    if (requestedClientId) {
      // Explicit admin target (Run & Send / per-client refresh) — scope EVERYTHING
      // to that client: it is its own home client. Allow any client, even one not
      // enrolled in the daily cron. Never fall back to the env-resolved admin
      // client here — that was the cross-client contamination path (a nottherug
      // send refreshing with hitloop's digest config).
      homeClientId = requestedClientId;
      clientIds = [requestedClientId];
    } else {
      const configClientId = await digestConfig.resolveDigestClientId();
      const cfg = await digestConfig.getDigestConfig(configClientId);
      homeClientId = cfg.homeClientId || configClientId;
      // Opt-in only: the daily crawl runs for the home client plus every client
      // whose Email Digest card has the daily toggle on — NOT a global
      // includeClientIds fan-out. The one-time migration turns legacy daily-on
      // configs OFF (except home) so this set starts as just the home client.
      await digestConfig.ensureDailyOptInMigration(homeClientId);
      const enrolledIds = await digestConfig.listCronEnrolledClientIds();
      clientIds = [...new Set([homeClientId, ...enrolledIds].filter(Boolean))];
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
    // Per-client digest config: each client's OWN include toggles + brief-link
    // mode gate its expensive compute (see cost gate in refreshDigestClient) —
    // never another client's config. Defaults apply when the client has no doc.
    // eslint-disable-next-line no-await-in-loop
    const clientCfg = await digestConfig.getDigestConfig(clientId).catch(() => null);
    const result = await refreshDigestClient(clientId, { freshnessToken, force: forceScout, source: triggerSource, actorUid, include: clientCfg?.include || {}, briefLinkMode: clientCfg?.briefLinkMode || 'fresh', phase });
    results.push(result);
    logInfo('pre_digest_refresh_client_done', {
      clientId,
      modulesOk: result.modules?.ok,
      modulesSkipped: result.modules?.skipped || false,
      scoutOk: result.scout?.ok,
      watchlistOk: result.watchlist?.ok,
      watchlistWarning: result.warnings?.find((warning) => warning.source === 'watchlist')?.message,
      strategyOk: result.strategy?.ok,
      executiveSummaryOk: result.executiveSummary?.ok,
      executiveSummarySkipped: result.executiveSummary?.skipped || false,
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
