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
const { collectRedditSignals, collectInstagramSignals, collectXMarketTalkSignals, filterRelevantSignals } = require('../../../../features/intelligence/_platform-signals.js');
const { searchReddit: scSearchReddit, searchInstagram: scSearchInstagram, redditQueriesFromCustomRows: scRedditQueries, hasApiKey: scHasApiKey } = require('../../../../features/scout-intake/external-scouts/scrapecreators-client.js');
const { refreshOpportunitySignals } = require('../../../../features/scout-intake/opportunity-signals-search.js');

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

function buildRedditAnalysisContent(marketingBrief = {}, nowMs = Date.now(), relevance = null) {
  const redditSignals = collectRedditSignals(marketingBrief, { relevance }).map((it) => addVelocity(it, nowMs));
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

function buildXMarketTalkContent(marketingBrief = {}, nowMs = Date.now()) {
  const xMarketTalkSignals = collectXMarketTalkSignals(marketingBrief).map((it) => addVelocity(it, nowMs));
  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: 'marketingBrief.reportSnapshot.platformTests.xMarketTalk',
    xMarketTalkSignals,
    dataQuality: {
      itemsAvailable: xMarketTalkSignals.length,
      note: xMarketTalkSignals.length
        ? 'Analyze only these supplied X posts. They are search results for the brand handle and brand keywords — treat them as what the market is saying, not as the brand\'s own posts.'
        : 'No X market-talk posts are currently available in stored Market Insights data.',
    },
  };
}

function buildInstagramAnalysisContent(marketingBrief = {}, nowMs = Date.now(), relevance = null) {
  const instagramSignals = collectInstagramSignals(marketingBrief, { relevance }).map((it) => addVelocity(it, nowMs));
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
  // Only ids with a REGISTERED runner — moduleConfig can carry enabled flags
  // for custom cards (a stray autoEnable once flipped site-recreate on, which
  // has no runner and failed every nightly module run until filtered here).
  const { knownModuleIds } = getIntakeRunner();
  const runnable = new Set(knownModuleIds());
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
  ])).filter((id) => runnable.has(id));
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

/** Brand/category terms for the relevance guard, from the client's Market Signals
 *  config. Returns null when no brand terms are configured, which leaves the
 *  collect*Signals call unfiltered (previous behavior). */
async function loadRelevanceTerms(clientId) {
  try {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const mbc = (snap.exists ? (snap.data() || {}) : {}).marketingBriefConfig || {};
    const brandTerms = [
      ...(Array.isArray(mbc.brandKeywords) ? mbc.brandKeywords : []),
      String(mbc.brandName || '').trim(),
    ].filter(Boolean);
    if (!brandTerms.length) return null;
    return { brandTerms, categoryTerms: Array.isArray(mbc.categoryTerms) ? mbc.categoryTerms : [] };
  } catch {
    return null;
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
    const relevance = await loadRelevanceTerms(clientId);
    const redditSignals = collectRedditSignals(marketingBrief, { relevance });
    if (!redditSignals.length) return { ok: false, skipped: true, reason: 'no-reddit-signals' };

    const generatedAt = new Date().toISOString();
    const content = buildRedditAnalysisContent(marketingBrief, Date.now(), relevance);
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

/** Runs the x-market-talk recipe over the stored X search results and persists
 *  reportSnapshot.xMarketTalkAnalysis for the email's "Market Talk on X" section.
 *  Reads only already-stored posts — no X API spend happens here (the paid search
 *  is refreshXMarketTalk, in the signals phase). Never throws. */
async function refreshXMarketTalkAnalysis(clientId) {
  if (!clientId) return { ok: false, skipped: true };
  try {
    const platformState = await getMarketInsightPlatformState(clientId);
    if (platformState?.platformAvailability?.x === false) {
      return { ok: false, skipped: true, reason: 'x-disabled' };
    }
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    const marketingBrief = snap.exists ? (snap.data()?.marketingBrief || {}) : {};
    const signals = collectXMarketTalkSignals(marketingBrief);
    if (!signals.length) return { ok: false, skipped: true, reason: 'no-x-market-talk' };

    const generatedAt = new Date().toISOString();
    const content = buildXMarketTalkContent(marketingBrief, Date.now());
    const contextParts = [];
    try {
      const voiceCtx = await loadClientBrainContext(clientId, { useFor: 'copy', maxChars: 1600 });
      if (voiceCtx) contextParts.push(voiceCtx);
    } catch { /* non-fatal */ }
    const result = await runAnalysisRecipe({ recipeId: 'x-market-talk', content, context: contextParts.join('\n\n') });
    await logRecipeUsage({ clientId, recipeId: 'x-market-talk', result });
    if (result?.analysis) {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        { marketingBrief: { reportSnapshot: { xMarketTalkAnalysis: { text: result.analysis, generatedAt } } } },
        { merge: true }
      );
    }
    logInfo('pre_digest_x_market_talk_analysis', { clientId, ok: result.ok, costUsd: result.costUsd, signals: signals.length });
    return { ok: result.ok, recipeId: 'x-market-talk', costUsd: result.costUsd, signals: signals.length };
  } catch (err) {
    logError('pre_digest_x_market_talk_analysis_failed', { clientId, error: err.message });
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
    const relevance = await loadRelevanceTerms(clientId);
    const instagramSignals = collectInstagramSignals(marketingBrief, { relevance });
    if (!instagramSignals.length) return { ok: false, skipped: true, reason: 'no-instagram-signals' };

    const generatedAt = new Date().toISOString();
    const content = buildInstagramAnalysisContent(marketingBrief, Date.now(), relevance);
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

/** Run the opportunity-signals recipe over the stored search pool (written by
 *  refreshOpportunitySignals below) and persist reportSnapshot.opportunitySignalsAnalysis.
 *  Skips cleanly (no LLM cost) when the feature is disabled or no items were found —
 *  disabled clients pay no extra search or analyzer cost. Non-blocking: never throws. */
async function refreshOpportunitySignalsAnalysis(clientId) {
  if (!clientId) return { ok: false, skipped: true };
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const cfg = cfgSnap.exists ? (cfgSnap.data()?.marketingBriefConfig?.opportunitySignals || null) : null;
    if (!cfg?.enabled) return { ok: false, skipped: true, reason: 'disabled' };

    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    const marketingBrief = snap.exists ? (snap.data()?.marketingBrief || {}) : {};
    const opportunitySignals = marketingBrief?.opportunitySignals || null;
    if (!opportunitySignals?.items?.length) return { ok: false, skipped: true, reason: 'no-opportunity-items' };

    const generatedAt = new Date().toISOString();
    const contextParts = [];
    try {
      const posSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
      const pos = posSnap.exists ? posSnap.data()?.scoutConfig?.positioningContext : null;
      if (pos) contextParts.push(typeof pos === 'string' ? pos : JSON.stringify(pos));
    } catch { /* non-fatal */ }
    try {
      const voiceCtx = await loadClientBrainContext(clientId, { useFor: 'copy', maxChars: 1600 });
      if (voiceCtx) contextParts.push(voiceCtx);
    } catch { /* non-fatal */ }
    const result = await runAnalysisRecipe({ recipeId: 'opportunity-signals', content: opportunitySignals, context: contextParts.join('\n\n') });
    await logRecipeUsage({ clientId, recipeId: 'opportunity-signals', result });
    if (result?.analysis) {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        { marketingBrief: { reportSnapshot: { opportunitySignalsAnalysis: { text: result.analysis, generatedAt } } } },
        { merge: true }
      );
    }
    logInfo('pre_digest_opportunity_signals_analysis', { clientId, ok: result.ok, costUsd: result.costUsd, items: opportunitySignals.items.length });
    return { ok: result.ok, recipeId: 'opportunity-signals', costUsd: result.costUsd, items: opportunitySignals.items.length };
  } catch (err) {
    logError('pre_digest_opportunity_signals_analysis_failed', { clientId, error: err.message });
    return { ok: false, error: err.message };
  }
}

/** Pull fresh Reddit + Instagram signals via the direct ScrapeCreators Node client
 *  and persist them to reportSnapshot.platformTests. This is the PRODUCTION source
 *  for those platforms — the last30days subprocess can't run on Vercel, so this
 *  Vercel-native HTTP client is what populates Reddit/Instagram for the cron. Runs
 *  before the analysis/reply steps so collect*Signals see fresh data. Never throws. */
/** X "market talk" — a brand SEARCH (the client's own handle + brand keywords),
 *  distinct from the watchlist handle timelines. Answers "who is talking about us
 *  on X right now", and lands in its own `platformTests.xMarketTalk` slot.
 *
 *  ⚠️ SPEND GATE. There is no ScrapeCreators X search endpoint, so this is the
 *  PAID X API (`searchXPosts`), billed per call and invisible to the Operating
 *  Cost card — see docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md. It runs
 *  ONLY when the caller passes allowX, which only the interactive Generate & Send
 *  does; the daily cron passes nothing and therefore never spends here. Queries
 *  are capped at 3 to bound the per-send cost. Never throws. */
async function refreshXMarketTalk(clientId, { brandXHandle = '', brandKeywords = [], categoryTerms = [] } = {}) {
  const handle = String(brandXHandle || '').replace(/^@+/, '').trim();
  // Persist WHY this ran or didn't. Previously a failure was logged and thrown
  // away, so the email's empty state could only say "run Generate & Send" —
  // which read as user error when the real cause was the X API returning 402
  // Payment Required on every call. Hobby keeps runtime logs ~1h, so the log
  // line was gone before anyone looked.
  const saveStatus = async (status) => {
    if (!clientId) return;
    try {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set({
        marketingBrief: { reportSnapshot: { platformStatus: { xMarketTalk: {
          ...status,
          at: new Date().toISOString(),
        } } } },
      }, { merge: true });
    } catch { /* status telemetry only — never fail the refresh on it */ }
  };
  if (!clientId || !handle) {
    await saveStatus({ ok: false, reason: 'no-x-handle' });
    return { ok: false, skipped: true, reason: 'no-x-handle' };
  }
  try {
    const platformState = await getMarketInsightPlatformState(clientId);
    if (platformState?.platformAvailability?.x === false) {
      await saveStatus({ ok: false, reason: 'x-disabled' });
      return { ok: false, skipped: true, reason: 'x-disabled' };
    }
    const { searchXPosts } = await import('../../../../features/social-posting/twitter-service.js');
    // Handle first (the "who is talking about us" query), then the most
    // distinctive brand keywords. Capped at 3 — each is a paid API call.
    const keywords = Array.isArray(brandKeywords) ? brandKeywords : [];
    const queries = [...new Set([`@${handle}`, ...keywords.map((k) => String(k || '').trim())].filter(Boolean))].slice(0, 3);
    const collected = [];
    const errors = [];
    const results = await Promise.all(queries.map((q) => searchXPosts(q, { limit: 10 })));
    results.forEach((r, i) => {
      if (!r?.ok) { errors.push(`${queries[i]}: ${r?.error || 'failed'}`); return; }
      collected.push(...(r.items || []));
    });
    if (!collected.length) {
      // 402 = the X API refused on billing (credit-based, see
      // X-API-AND-PROFILE-OPERATIONS.md). Flagged distinctly because it is an
      // account state the admin must fix, not a "no results" finding.
      const billing = errors.some((e) => /\b402\b/.test(e));
      const reason = errors.length ? `x-search-failed: ${errors[0]}` : 'no-x-results';
      await saveStatus({ ok: false, reason, billing, detail: errors[0] || null, queries });
      return { ok: false, skipped: true, reason, billing, queries };
    }
    const brandTerms = [...keywords, handle].filter(Boolean);
    const relevant = filterRelevantSignals(collected, { brandTerms, categoryTerms });
    const dropped = collected.length - relevant.length;
    await fb.adminDb.collection('dashboard_state').doc(clientId).set({
      marketingBrief: { reportSnapshot: { platformTests: { xMarketTalk: JSON.parse(JSON.stringify({
        items: relevant.slice(0, 20),
        count: relevant.length,
        costUsd: 0, // X API spend is credit-based and not reported per call
        ms: null,
        meta: {
          source: 'X API · search (market talk)',
          queriesTried: queries,
          warnings: errors,
          relevanceFiltered: dropped > 0 ? { kept: relevant.length, dropped } : null,
        },
        generatedAt: new Date().toISOString(),
      })) } } },
      updatedAt: fb.FieldValue.serverTimestamp(),
    }, { merge: true });
    logInfo('pre_digest_x_market_talk', { clientId, queries: queries.length, kept: relevant.length, dropped });
    await saveStatus({ ok: true, kept: relevant.length, dropped, queries });
    return { ok: true, kept: relevant.length, dropped, queries };
  } catch (err) {
    logError('pre_digest_x_market_talk_failed', { clientId, error: err.message });
    await saveStatus({ ok: false, reason: 'x-search-threw', detail: err.message });
    return { ok: false, error: err.message };
  }
}

async function refreshPlatformSignals(clientId, { allowX = false } = {}) {
  if (!clientId || !scHasApiKey()) return { ok: false, skipped: true, reason: 'no-key' };
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const mbc = (cfgSnap.exists ? (cfgSnap.data() || {}) : {}).marketingBriefConfig || {};
    const sources = new Set((Array.isArray(mbc.sourcePlatforms) ? mbc.sourcePlatforms : []).map((s) => String(s || '').toLowerCase()));
    const brand = String(mbc.brandName || '').replace(/^["']+|["']+$/g, '').trim();
    const cats = Array.isArray(mbc.categoryTerms) ? mbc.categoryTerms.filter(Boolean) : [];
    // Relevance guard. The query set is intentionally broad (brand row + category
    // rows), so raw results mix real brand signal with generic category chatter.
    // Filter BEFORE persisting: every reader of platformTests treats stored items
    // as already-relevant, and this keeps off-topic threads out of the analyzers,
    // the email sections, and the brief in one place. Brand terms come from
    // brandKeywords (falling back to brandName) — see filterRelevantSignals for
    // the "never empty a section" safety valves.
    const brandTerms = [
      ...(Array.isArray(mbc.brandKeywords) ? mbc.brandKeywords : []),
      brand,
    ].filter(Boolean);
    const persist = async (platform, items, meta) => {
      const relevant = filterRelevantSignals(items || [], { brandTerms, categoryTerms: cats });
      const dropped = (items || []).length - relevant.length;
      if (dropped > 0) logInfo('pre_digest_platform_signals_filtered', { clientId, platform, kept: relevant.length, dropped });
      const entry = JSON.parse(JSON.stringify({
        items: relevant.slice(0, 20), count: relevant.length, costUsd: 0, ms: null,
        meta: { ...(meta || {}), relevanceFiltered: dropped > 0 ? { kept: relevant.length, dropped } : null },
        generatedAt: new Date().toISOString(),
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
    // Paid X search — opt-in per call, so the cron never spends. See refreshXMarketTalk.
    if (allowX && sources.has('x')) {
      const xr = await refreshXMarketTalk(clientId, {
        brandXHandle: mbc.brandXHandle,
        brandKeywords: Array.isArray(mbc.brandKeywords) ? mbc.brandKeywords : [],
        categoryTerms: cats,
      });
      out.xMarketTalk = xr.ok ? xr.kept : `skip:${xr.reason || xr.error}`;
    }
    logInfo('pre_digest_platform_signals', { clientId, ...out });
    return { ok: true, ...out };
  } catch (err) {
    logError('pre_digest_platform_signals_failed', { clientId, error: err.message });
    return { ok: false, error: err.message };
  }
}

/** Refresh one client's scout brief + watchlist timelines + strategy plan.
 *  Sequential (strategy reads fresh scout). Never throws. */
export async function refreshDigestClient(clientId, { freshnessToken = '', force = false, source = 'cron-scheduled', actorUid = null, include = {}, briefLinkMode = 'fresh', phase = 'all', allowX = false } = {}) {
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
  const [modules, scout, watchlist, platformSignals, opportunitySignalsRefresh] = await Promise.all([
    !wantModules ? phaseSkip() : (creativeWanted
      ? refreshSiteCreativeModules(clientId, freshnessToken, { source, actorUid })
      : Promise.resolve({ ok: true, skipped: true, reason: 'creative-sections-off' })),
    wantSignals ? refreshScoutBrief(clientId, { force, source, actorUid }) : phaseSkip(),
    wantSignals ? refreshWatchlist(clientId) : phaseSkip(),
    // Reddit/Instagram via the direct ScrapeCreators client → platformTests.
    // Runs here so it completes before the analysis/reply steps read collect*Signals.
    // This is what makes Reddit/IG populate in PRODUCTION (last30days can't run there).
    wantSignals ? refreshPlatformSignals(clientId, { allowX }) : phaseSkip(),
    // Opportunity Signals search (public buying-signal scan) — its own client
    // toggle gate, own reddit/instagram search, own stored pool. See
    // docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md.
    wantSignals ? refreshOpportunitySignals(clientId) : phaseSkip(),
  ]);
  const [strategy, replyTargets, redditAnalysis, instagramAnalysis, xMarketTalkAnalysis, opportunitySignalsAnalysis] = await Promise.all([
    wantAnalysis ? refreshStrategyPlan(clientId) : phaseSkip(),
    wantAnalysis ? refreshReplyTargets(clientId) : phaseSkip(), // needs fresh watchlist timelines already written above
    wantAnalysis ? refreshRedditAnalysis(clientId) : phaseSkip(),
    wantAnalysis ? refreshInstagramAnalysis(clientId) : phaseSkip(),
    wantAnalysis ? refreshXMarketTalkAnalysis(clientId) : phaseSkip(),
    wantAnalysis ? refreshOpportunitySignalsAnalysis(clientId) : phaseSkip(), // needs fresh opportunitySignals pool already written above
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
    xMarketTalkAnalysisOk: Boolean(xMarketTalkAnalysis?.ok),
    opportunitySignalsAnalysisOk: Boolean(opportunitySignalsAnalysis?.ok),
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
    platformSignals,
    strategy,
    replyTargets,
    redditAnalysis,
    instagramAnalysis,
    xMarketTalkAnalysis,
    opportunitySignalsRefresh,
    opportunitySignalsAnalysis,
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
  // allowX=1 opts THIS call into the paid X search (refreshXMarketTalk). Only the
  // interactive Generate & Send sets it; the scheduled cron sends no params, so
  // the cron can never spend X credits. See X-API-AND-PROFILE-OPERATIONS.md.
  const allowX = url.searchParams.get('allowX') === '1';
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
      // Opt-in only: the daily crawl runs for every client whose Email Digest
      // card has the daily toggle on — NOT a global includeClientIds fan-out.
      await digestConfig.ensureDailyOptInMigration(homeClientId);
      // Enrolled clients ONLY. Home used to be prepended unconditionally, so a
      // home client with its own toggle OFF still ran a full paid scout every
      // day (and, being first, consumed the budget that the clients who WERE
      // enrolled needed). Home is included here exactly when it is enrolled.
      // Least-recently-refreshed first so a short run rotates instead of always
      // serving the same client.
      clientIds = await digestConfig.listCronEnrolledClientIdsByStaleness('refresh');
    }
  } catch (err) {
    logError('pre_digest_refresh_client_resolve_error', { error: err.message });
    return json({ error: `Could not resolve digest home client: ${err.message}` }, 500);
  }
  if (!homeClientId) return json({ error: 'No digest home client configured.' }, 404);

  logInfo('pre_digest_refresh_start', { clientId: homeClientId, clients: clientIds.length });

  // ── Multi-client dispatch ──────────────────────────────────────────────────
  // A full refresh for ONE client can alone exceed this function's 300s ceiling
  // (scout + watchlist + strategy + recipes + summaries). Running the enrolled
  // clients in-process therefore meant client #1 consumed the whole budget and
  // the rest were dropped by a silent `break` — enrolled clients went unrefreshed
  // for weeks. Instead the scheduled run re-enters this same route once per
  // client with ?clientId=, concurrently: each client gets its OWN 300s
  // invocation and the parent only waits. The explicit-clientId path below is
  // the single-client worker and is unchanged.
  if (!requestedClientId && clientIds.length > 0) {
    const headers = { 'cache-control': 'no-store' };
    if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
    else if (process.env.WORKER_SECRET) headers['x-worker-secret'] = process.env.WORKER_SECRET;
    // Re-enter the SAME deployment this run is executing on, never a fixed alias.
    const selfOrigin = url.origin;

    const refreshOne = async (clientId) => {
      const target = new URL('/api/worker/pre-digest-refresh', selfOrigin);
      url.searchParams.forEach((value, key) => {
        if (key !== 'clientId') target.searchParams.set(key, value);
      });
      target.searchParams.set('clientId', clientId);
      let entry;
      try {
        const res = await fetch(target.toString(), { headers, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        entry = { clientId, status: res.status, ok: res.ok && body?.ok !== false, reason: body?.error || null, ...body };
      } catch (err) {
        entry = { clientId, ok: false, reason: err.message };
      }
      await digestConfig.stampCronRun(clientId, 'refresh', entry);
      logInfo('pre_digest_refresh_client_done', { clientId, ok: entry.ok, status: entry.status || null, reason: entry.reason || null });
      return entry;
    };

    const DISPATCH_CONCURRENCY = 3;
    const dispatched = [];
    const droppedIds = [];
    for (let i = 0; i < clientIds.length; i += DISPATCH_CONCURRENCY) {
      if (dispatched.length > 0 && Date.now() - startedAtMs > REFRESH_RESPONSE_BUDGET_MS) {
        droppedIds.push(...clientIds.slice(i));
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      const wave = await Promise.all(clientIds.slice(i, i + DISPATCH_CONCURRENCY).map(refreshOne));
      dispatched.push(...wave);
    }
    if (droppedIds.length) {
      logError('pre_digest_refresh_budget_exhausted', {
        completed: dispatched.length,
        total: clientIds.length,
        droppedIds,
        elapsedMs: Date.now() - startedAtMs,
      });
      await Promise.all(droppedIds.map((clientId) => {
        const entry = { clientId, ok: false, skipped: true, reason: 'Refresh budget exhausted before this client ran.' };
        dispatched.push(entry);
        return digestConfig.stampCronRun(clientId, 'refresh', entry);
      }));
    }
    const dispatchComplete = droppedIds.length === 0;
    const dispatchOk = dispatchComplete && dispatched.every((entry) => entry.ok);
    logInfo('pre_digest_refresh_done', {
      dispatcher: true, clients: clientIds.length, completed: dispatched.length - droppedIds.length,
      dropped: droppedIds.length, ok: dispatchOk,
    });
    return json({
      ok: dispatchOk, dispatcher: true, clientIds, complete: dispatchComplete,
      dropped: droppedIds, results: dispatched,
    }, dispatchOk ? 200 : 207);
  }

  // Use the single refresh path (scout → watchlist → strategy) so the scheduled
  // cron and manual Generate & Send produce identical fresh data — including
  // followed-handle timelines — and can never drift apart again.
  const results = [];
  for (const clientId of clientIds) {
    // eslint-disable-next-line no-await-in-loop
    // Per-client digest config: each client's OWN include toggles + brief-link
    // mode gate its expensive compute (see cost gate in refreshDigestClient) —
    // never another client's config. Defaults apply when the client has no doc.
    // eslint-disable-next-line no-await-in-loop
    const clientCfg = await digestConfig.getDigestConfig(clientId).catch(() => null);
    // Paid X brand search on the UNATTENDED cron is per-client opt-in
    // (digest_config.dailyXSearch, default false). An interactive Generate &
    // Send passes ?allowX=1 and always runs it. Kept per-client rather than a
    // global flag so enrolling another client can never silently start
    // spending X credits on a schedule. Cost: ≤3 search calls per client/day.
    const clientAllowX = allowX || clientCfg?.dailyXSearch === true;
    const result = await refreshDigestClient(clientId, { freshnessToken, force: forceScout, source: triggerSource, actorUid, include: clientCfg?.include || {}, briefLinkMode: clientCfg?.briefLinkMode || 'fresh', phase, allowX: clientAllowX });
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
