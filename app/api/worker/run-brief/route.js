import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

// maxDuration replaces the vercel.json functions override for this route
export const maxDuration = 300;

const require = createRequire(import.meta.url);

/* Dev only: Next hot-reloads this ESM route, but Node's CJS require cache
   keeps stale copies of the pipeline modules — edits to runtime.js,
   strategy-roller, scribe, or the scout-intake modules don't take effect
   until a server restart. Evict the stateless pipeline modules so each
   route reload requires fresh copies. Stateful singletons (firebase-admin,
   auth, run-lifecycle) stay cached on purpose. */
if (process.env.NODE_ENV !== 'production') {
  const STALE_CJS = /features[\\/](not-the-rug-brief|scout-intake)[\\/]/;
  for (const key of Object.keys(require.cache)) {
    if (STALE_CJS.test(key)) delete require.cache[key];
  }
}

const _fb = require('../../../../api/_lib/firebase-admin.cjs');
const {
  buildAuthRequestShim,
  getHeaderValue,
  hasValidWorkerSecret,
  safeSecretEquals,
  verifyAdminRequest,
} = require('../../../../api/_lib/auth.cjs');
const {
  claimRun,
  completeRun,
  failRun,
  findStaleRunningRuns,
  findNextQueuedRun,
  requeueStaleRun,
  updateRunProgress,
  updateModuleState,
  appendRunEvent,
} = require('../../../../api/_lib/run-lifecycle.cjs');

// Lazy-loaded: avoids pulling the full pipeline at module init time
function getPipeline() {
  return require('../../../../features/not-the-rug-brief/runtime');
}

// Lazy-loaded: free-tier intake pipeline (fetch + synthesize, no web search)
function getIntakePipeline() {
  return require('../../../../features/scout-intake/runner');
}

// Lazy-loaded: brand identity generation utils (Phase 2)
function getScoutConfigUtils() {
  return {
    fetchSiteEvidence: require('../../../../features/scout-intake/site-fetcher').fetchSiteEvidence,
    ensureScoutConfig: require('../../../../features/scout-intake/scout-config-generator').ensureScoutConfig,
    buildUserContext: require('../../../../features/scout-intake/user-context').buildUserContext,
  };
}

function getMerger() {
  return require('../../../../features/scout-intake/brand-overview-merger');
}

function getBrandOverviewSynthesizer() {
  return require('../../../../features/scout-intake/brand-overview-synthesizer');
}

function getMarketingBriefConfigMerger() {
  return require('../../../../features/scout-intake/marketing-brief-config-merger');
}

function getModuleBriefBuilder() {
  return require('../../../../features/scout-intake/module-brief-builder');
}

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

async function triggerStudioRenderWorker(request) {
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('host') || 'localhost:3000';
  const workerUrl = `${proto}://${host}/api/worker/render-studio`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': process.env.WORKER_SECRET || '',
      },
      body: JSON.stringify({ source: 'run-brief-studio-video' }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.warn(`[WORKER] studio render worker trigger failed: ${response.status} ${detail.trim()}`);
    }
  } catch (err) {
    console.warn(`[WORKER] studio render worker trigger threw: ${err?.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function authorizeRequest(request) {
  if (hasValidWorkerSecret(buildAuthRequestShim(request))) return;
  if (hasValidCronSecret(request)) return;
  await verifyAdminRequest(buildAuthRequestShim(request));
}

function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = getHeaderValue(buildAuthRequestShim(request).headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

async function reclaimStaleRunsForSweep() {
  const staleRuns = await findStaleRunningRuns({ limit: 10 });
  const summary = { scanned: staleRuns.length, requeued: 0, errors: 0, runIds: [] };

  for (const run of staleRuns) {
    try {
      await requeueStaleRun(run.id);
      summary.requeued += 1;
      summary.runIds.push(run.id);
      await appendRunEvent(run.id, run.clientId, {
        stage: 'worker-sweep',
        progressLabel: 'Expired worker lease reclaimed; run queued for retry.',
      }).catch(() => {});
    } catch (err) {
      summary.errors += 1;
      console.warn(`[WORKER] stale reclaim failed for ${run.id}: ${err?.message}`);
    }
  }

  return summary;
}

async function handleRunBrief(request, { parseBody = true, source = 'worker' } = {}) {
  // Step 1 — Auth
  try {
    await authorizeRequest(request);
  } catch {
    return json({ error: 'Unauthorized.' }, 401);
  }

  // Step 2 — Parse body
  let runId = null;
  try {
    const body = parseBody ? await request.json().catch(() => ({})) : {};
    runId = body.runId ? String(body.runId).trim() : null;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  let sweep = null;

  // Step 3 — Resolve runId
  if (!runId) {
    try {
      sweep = await reclaimStaleRunsForSweep();
    } catch (err) {
      console.warn(`[WORKER] stale sweep failed before queue claim: ${err?.message}`);
      sweep = { scanned: 0, requeued: 0, errors: 1, runIds: [] };
    }

    const nextRun = await findNextQueuedRun();
    if (!nextRun) {
      return json({ ok: true, claimed: false, source, sweep, message: 'No queued runs found.' });
    }
    runId = nextRun.id;
  }

  // Step 4 — Claim the run (atomic transaction)
  let claimedRun;
  try {
    claimedRun = await claimRun(runId);
  } catch (err) {
    return json({ error: err.message, runId }, 409);
  }

  const { clientId, attempts } = claimedRun;
  console.log(`[${new Date().toISOString()}] WORKER: claimed run ${runId} for client ${clientId} (attempt ${attempts})`);
  if (source === 'cron-sweep') {
    await appendRunEvent(runId, clientId, {
      stage: 'worker-sweep',
      progressLabel: 'Background checker picked this up — generation is continuing.',
    }).catch(() => {});
  }

  // Chained follow-up runs fail soft: full error in brief_runs, but no
  // dashboard errorState / client downgrade — the primary intake succeeded.
  const isOnboardingChain = claimedRun.trigger === 'onboarding-chain';
  const markChainModuleFailed = async (message) => {
    try {
      await _fb.adminDb.collection('dashboard_state').doc(clientId).set(
        {
          modules: {
            'marketing-brief': {
              enabled: true,
              status: 'failed',
              lastRunId: runId,
              lastErrorMessage: message || 'Marketing brief run failed.',
            },
          },
          updatedAt: _fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      // status mirror is best-effort
    }
  };

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
    await failRun(runId, clientId, configErr, attempts, { soft: isOnboardingChain });
    if (isOnboardingChain) await markChainModuleFailed(configErr.message);
    return json({ error: 'Failed to load client config.', runId }, 500);
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
      const { FALLBACK_BRIEF_SITE } = require('../../../../api/_lib/brief-fallback.cjs');
      // ownSiteUrl = the client's real site (null for website-less signups).
      // assetSiteUrl = the site visual assets render from — own site, else the
      // run's fallback site (hitloop.agency templated). Brand/scout synthesis is
      // gated on ownSiteUrl so fallback content never pollutes brand data.
      const ownSiteUrl =
        clientConfig?.sourceInputs?.websiteUrl ||
        clientConfig?.websiteUrl ||
        null;
      const assetSiteUrl = ownSiteUrl || claimedRun.sourceUrl || FALLBACK_BRIEF_SITE;
      const websiteUrl = assetSiteUrl;

      const enabledModuleIds = Object.entries(clientConfig.moduleConfig)
        .filter(([, cfg]) => cfg?.enabled === true)
        .map(([id]) => id);

      // An executive-brief refresh compiles EVERY audit card — but only the
      // cheap/volatile modules rerun each call. The vision-LLM modules
      // (design-evaluation, style-guide) change only when the site changes,
      // so their last successful result is reused when younger than the
      // window and re-run only when stale or absent. Signup/reseed runs are
      // untouched: they run whatever the module config enables, all fresh.
      const FRESH_EVERY_BRIEF = ['multi-device-view', 'seo-performance', 'agent-readiness', 'social-preview'];
      const REUSE_IF_RECENT = ['design-evaluation', 'style-guide'];
      const REUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

      let moduleIdsToRun = enabledModuleIds;
      let reusedResults = [];
      if (claimedRun.trigger === 'creative-brief' || claimedRun.trigger === 'signup') {
        // Narrow Creative Brief run — only the deliverable asset modules. No
        // SEO / agent-readiness / design-eval, no brand/scout synthesis, and no
        // scout-brief chain. The studio video renders and the onboarding summary
        // is regenerated below. Signup uses this same minimal scope: a new client
        // only needs the Creative Brief deliverables; the heavier audit modules,
        // brand/scout synthesis, and the Daily Brief defer to a later run.
        moduleIdsToRun = ['multi-device-view', 'social-preview'];
      } else if (claimedRun.trigger === 'brief-refresh') {
        let storedModules = {};
        try {
          const dashSnap = await _fb.adminDb.collection('dashboard_state').doc(clientId).get();
          storedModules = dashSnap.exists ? dashSnap.data()?.modules || {} : {};
        } catch {
          // unreadable state → treat every vision module as stale and rerun
        }
        const isFreshEnough = (m) => {
          if (!m || m.status !== 'succeeded' || !m.result) return false;
          const t = m.lastSuccessAt;
          const ms = t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : null);
          return ms != null && (Date.now() - ms) < REUSE_WINDOW_MS;
        };
        const reusableIds = REUSE_IF_RECENT.filter((id) => isFreshEnough(storedModules[id]));
        reusedResults = reusableIds.map((id) => ({ cardId: id, ok: true, result: storedModules[id].result }));
        const staleVisionIds = REUSE_IF_RECENT.filter((id) => !reusableIds.includes(id));
        moduleIdsToRun = Array.from(new Set([...enabledModuleIds, ...FRESH_EVERY_BRIEF, ...staleVisionIds]));
      }

      const { results } = await runModules({
        clientId,
        runId,
        websiteUrl,
        moduleIds: moduleIdsToRun,
        onProgress,
      });
      // Per-stage LLM costs for this run — module skill calls now, scout-config
      // generation below. Rolled into providerUsage so ops pricing is accurate.
      const runStageCosts = results
        .filter((r) => r?.runCostData)
        .map((r) => ({ stage: r.cardId, ...r.runCostData }));
      // Fresh results only — reused modules keep their stored state/timestamps.
      await updateModuleState(clientId, results, runId);

      // Condense each module's findings into a per-module mini-brief. These
      // feed the Website Audit section of the executive brief and the Scribe
      // prompt of the chained scout-brief run. Deterministic — no LLM cost.
      try {
        const { buildModuleBriefs } = getModuleBriefBuilder();
        // Reused vision-module results flow into the brief alongside fresh
        // ones — the Creative Brief always carries design evaluation data.
        const reusedIdSet = new Set(reusedResults.map((r) => r.cardId));
        const moduleBriefs = buildModuleBriefs(
          [...results, ...reusedResults],
          { expectedIds: Array.from(new Set([...moduleIdsToRun, ...reusedIdSet])) }
        );
        for (const b of moduleBriefs) {
          if (reusedIdSet.has(b.moduleId) && b.status === 'ok') {
            b.summaryLine += ' (from the last successful audit)';
          }
        }
        if (moduleBriefs.length) {
          await _fb.adminDb.collection('dashboard_state').doc(clientId).set(
            {
              moduleBriefs: {
                items: moduleBriefs,
                generatedAtIso: new Date().toISOString(),
                runId,
              },
              updatedAt: _fb.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(`[WORKER] moduleBriefs written for ${clientId} — ${moduleBriefs.length} module(s)`);
        }
      } catch (mbErr) {
        console.warn(`[WORKER] moduleBriefs build non-fatal failure for ${clientId}: ${mbErr?.message}`);
      }

      // Generate brand identity + snapshot.brandOverview after modules complete
      // (non-fatal). Gated on the client's OWN site — website-less signups skip
      // this so the templated fallback site never seeds their brand data. The
      // narrow Creative Brief run AND signup also skip it: the Creative Brief is
      // the only deliverable on first run, so brand/scout synthesis (which feeds
      // the Daily Brief) defers to the first brief-refresh/reseed.
      if (ownSiteUrl && claimedRun.trigger !== 'creative-brief' && claimedRun.trigger !== 'signup') {
        let evidence = null;
        let scoutConfigResult = null;
        try {
          await onProgress('search-terms', 'Generating search terms + scout configuration…');
          const { fetchSiteEvidence, ensureScoutConfig, buildUserContext } = getScoutConfigUtils();
          evidence = await fetchSiteEvidence(websiteUrl);
          const userContext = buildUserContext(clientConfig);
          const clientName = clientConfig?.clientName || clientConfig?.sourceInputs?.clientName || null;
          scoutConfigResult = await ensureScoutConfig({
            clientId,
            clientName,
            intakeResult: { websiteUrl },
            userContext,
            evidence,
            websiteUrl,
            force: claimedRun.trigger === 'reseed',
          });
          console.log(`[WORKER] scoutConfig ensured for ${clientId}`);
          if (scoutConfigResult?.cost) {
            runStageCosts.push({ stage: 'scout-config', ...scoutConfigResult.cost });
          }

          // Flow the fresh audit into marketingBriefConfig (the card layer):
          // untouched groups refresh, user-touched groups merge-append.
          if (scoutConfigResult?.scoutConfig) {
            const { mergeMarketingBriefConfig } = getMarketingBriefConfigMerger();
            await mergeMarketingBriefConfig(clientId, scoutConfigResult.scoutConfig);
          }
          const capCount = scoutConfigResult?.scoutConfig?._meta?.capabilitiesActive?.length ?? 0;
          await onProgress('search-terms', `Search terms ready — ${capCount} capabilit${capCount === 1 ? 'y' : 'ies'} active.`);
        } catch (scoutErr) {
          console.warn(`[WORKER] scoutConfig generation non-fatal failure for ${clientId}: ${scoutErr?.message}`);
          await onProgress('search-terms', 'Search terms generation hit an issue — will refresh on next run.');
        }

        // Persist trimmed crawl evidence so Data Quality / Trust / Platform
        // Coverage cards refresh on recurring runs, not just first intake.
        if (evidence) {
          try {
            const { summarizeEvidencePages } = require('../../../../features/scout-intake/normalize');
            const evidenceSummary = summarizeEvidencePages(evidence);
            if (evidenceSummary) {
              await _fb.adminDb.collection('dashboard_state').doc(clientId).set(
                { evidence: evidenceSummary },
                { merge: true }
              );
            }
          } catch (evErr) {
            console.warn(`[WORKER] evidence summary write non-fatal failure for ${clientId}: ${evErr?.message}`);
          }
        }

        // Synthesize snapshot.brandOverview from site evidence (OG meta + page content).
        // Then merge with any user-saved content so manual edits are never overwritten.
        if (evidence) {
          try {
            const { synthesizeBrandOverview } = getBrandOverviewSynthesizer();
            const { mergeBrandOverview } = getMerger();
            const crawled = await synthesizeBrandOverview(evidence, scoutConfigResult?.scoutConfig || null);
            if (crawled) {
              const merged = await mergeBrandOverview(clientId, crawled);
              if (merged) {
                await _fb.adminDb.collection('dashboard_state').doc(clientId).update({
                  'snapshot.brandOverview': merged,
                });
                console.log(`[WORKER] snapshot.brandOverview written for ${clientId}: source=${merged.source}`);
              }
            }
          } catch (boErr) {
            console.warn(`[WORKER] brandOverview synthesis non-fatal failure for ${clientId}: ${boErr?.message}`);
          }
        }
      }

      // Studio motion mockup — render one cloud GPU video on onboarding so the
      // Creative Brief embeds it (brief-preview reads dash.studioCaptures). Runs
      // on first-run triggers only (signup/reseed); non-fatal and bounded so a
      // slow or unconfigured render never fails the intake. Routine
      // brief-refreshes skip it to avoid re-rendering the video every run.
      //
      // Render ONLY from the client's real site, never the hitloop fallback —
      // otherwise a website-less signup produces a hitloop video the card then
      // (correctly) rejects, so the card reads as "failed" with a junk asset on
      // file. When the client later adds their site, a reseed/creative-brief run
      // re-enters here with a real renderSiteUrl and queues the video then.
      const renderSiteUrl = ownSiteUrl
        || (claimedRun.sourceUrl && claimedRun.sourceUrl !== FALLBACK_BRIEF_SITE ? claimedRun.sourceUrl : null);
      if (renderSiteUrl && (claimedRun.trigger === 'signup' || claimedRun.trigger === 'reseed' || claimedRun.trigger === 'creative-brief')) {
        try {
          const renderJobs = require('../../../../api/_lib/studio-render-jobs.cjs');
          const { getSignupVideoRecipe } = require('../../../../api/_lib/signup-video-recipe.cjs');
          await onProgress('studio-video', 'Queueing your motion mockup…');
          const { jobId } = await renderJobs.createRenderJob({
            clientId,
            recipe: await getSignupVideoRecipe(renderSiteUrl),
            // Onboarding can fire signup + creative-brief runs seconds apart;
            // dedupe so the same site isn't rendered twice (double GPU cost).
            dedupeWindowMs: 15 * 60 * 1000,
          });
          // Mark the video as in-flight so the Video Promo card can show a
          // "Rendering…" state during the gap between the run finishing and the
          // async render landing in studioCaptures (cleared on success in
          // studio-render-core.appendCaptureRef; the card also ignores a stale
          // flag so a failed render recovers without a backend clear).
          await _fb.adminDb.collection('dashboard_state').doc(clientId).set({
            studioVideoPending: { jobId, sourceUrl: renderSiteUrl, queuedAt: new Date().toISOString() },
          }, { merge: true }).catch(() => {});
          await triggerStudioRenderWorker(request);
          console.log(`[WORKER] studio video queued for ${clientId} — ${jobId}`);
          await onProgress('studio-video', 'Motion mockup queued.');
        } catch (studioErr) {
          console.warn(`[WORKER] studio video queue threw (non-fatal) for ${clientId}: ${studioErr?.message}`);
        }
      } else if (!renderSiteUrl && (claimedRun.trigger === 'signup' || claimedRun.trigger === 'reseed' || claimedRun.trigger === 'creative-brief')) {
        console.log(`[WORKER] studio video skipped for ${clientId} — no real client site yet (fallback only)`);
      }

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
        runCostData: runStageCosts.length ? { stageCosts: runStageCosts } : null,
        ...(anyOk ? {} : { error: results.map((r) => r.errorMessage).filter(Boolean).join('; '), failedStage: 'module' }),
      };
    } else if (pipelineType === 'free-tier-intake') {
      const { runIntakePipeline } = getIntakePipeline();
      pipelineResult = await runIntakePipeline({ clientId, clientConfig, onProgress, runId });
    } else {
      const { runClientPipeline } = getPipeline();
      // Website-audit mini-briefs from the intake run — folded into the
      // executive brief so it covers the client's own site, not just signals.
      let moduleBriefs = null;
      try {
        const dashSnap = await _fb.adminDb.collection('dashboard_state').doc(clientId).get();
        moduleBriefs = dashSnap.exists ? dashSnap.data()?.moduleBriefs?.items || null : null;
      } catch {
        // non-fatal — brief runs without the audit context
      }
      const result = await runClientPipeline({ clientId, clientConfig, onProgress, moduleBriefs });
      // runClientPipeline does not stamp pipelineType; without it the dashboard
      // projection skips the marketingBrief/strategy30 block entirely.
      pipelineResult = { ...result, pipelineType: 'scout-brief' };
    }
  } catch (err) {
    console.error(`[WORKER] Pipeline threw for ${clientId}: ${err.message}`);
    const pipelineErr = new Error(err.message || 'Pipeline threw an unhandled error.');
    pipelineErr.stage = 'pipeline';
    await failRun(runId, clientId, pipelineErr, attempts, { soft: isOnboardingChain });
    if (isOnboardingChain) await markChainModuleFailed(pipelineErr.message);
    return json({ error: 'Pipeline execution failed.', runId }, 500);
  }

  // Step 7 — Brand overview merge (free-tier-intake only)
  // If the pipeline produced a brandOverview and the client has user-set content,
  // run a Haiku merge agent to reconcile crawl vs manual data before writing.
  // Non-fatal — any failure falls back to the raw crawl value.
  if (pipelineType === 'free-tier-intake' && pipelineResult.snapshot?.brandOverview) {
    try {
      const { mergeBrandOverview } = getMerger();
      const merged = await mergeBrandOverview(clientId, pipelineResult.snapshot.brandOverview);
      if (merged) {
        pipelineResult.snapshot.brandOverview = merged;
        console.log(`[WORKER] brandOverview merge complete for ${clientId}: source=${merged.source}`);
      }
    } catch (mergeErr) {
      console.warn(`[WORKER] brandOverview merge threw for ${clientId}: ${mergeErr.message}`);
    }
  }

  // Step 8 — Write result
  if (pipelineResult.status === 'failed') {
    const stageErr = new Error(pipelineResult.error || 'Pipeline returned failed status.');
    stageErr.stage = pipelineResult.failedStage || 'pipeline';
    await failRun(runId, clientId, stageErr, attempts, {
      artifactRefs: pipelineResult.artifactRefs,
      warnings: pipelineResult.warnings,
      soft: isOnboardingChain,
    });
    if (isOnboardingChain) await markChainModuleFailed(stageErr.message);
    console.log(`[WORKER] Run ${runId} failed at stage: ${stageErr.stage}`);
    return json({
      ok: false,
      runId,
      clientId,
      status: 'failed',
      failedStage: stageErr.stage,
    });
  }

  // Step 9 — Brief chain: a manual executive brief refresh ('brief-refresh') or
  // a website re-run ('reseed') hands off to a scout-brief run, so the executive
  // brief is composed from a fresh A→B pass: modules (screenshots, SEO, agent
  // readiness, design) → search terms → campaign → brief. Rerun module triggers
  // never chain. Signup does NOT chain: a new client only needs the Creative
  // Brief deliverables (mockups, studio video, onboarding summary), not the slow
  // scout market-intel scan that builds the Daily Brief — that defers to the
  // first brief-refresh/reseed (or a later daily run). Queue failure is
  // non-fatal: the intake already succeeded and the brief stays manual.
  // Queued BEFORE completeRun so no bootstrap poll can observe the intake
  // as succeeded without the chained run + queued module mark in place
  // (the worker self-trigger below is after()-deferred regardless).
  if (pipelineType === 'free-tier-intake' && (claimedRun.trigger === 'brief-refresh' || claimedRun.trigger === 'reseed')) {
    const chainSourceUrl =
      clientConfig?.sourceInputs?.websiteUrl || clientConfig?.websiteUrl || null;
    if (chainSourceUrl) {
      try {
        const chainRef = _fb.adminDb.collection('brief_runs').doc();
        const chainRunId = chainRef.id;
        const now = _fb.FieldValue.serverTimestamp();
        const chainPayload = {
          runId: chainRunId,
          id: chainRunId,
          clientId,
          requestedByUid: claimedRun.requestedByUid || null,
          trigger: 'onboarding-chain',
          source: 'system',
          status: 'queued',
          pipelineType: 'scout-brief',
          parentRunId: runId,
          attempts: 0,
          workerLease: null,
          startedAt: null,
          completedAt: null,
          error: null,
          summary: null,
          artifactRefs: [],
          providerUsage: null,
          moduleSnapshot: null,
          sourceUrl: chainSourceUrl,
          createdAt: now,
          updatedAt: now,
        };
        await Promise.all([
          chainRef.set(chainPayload),
          _fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(chainRunId).set(chainPayload),
          _fb.adminDb.collection('dashboard_state').doc(clientId).set(
            {
              modules: {
                'marketing-brief': { enabled: true, status: 'queued', lastRunId: chainRunId },
              },
              updatedAt: now,
            },
            { merge: true }
          ),
          appendRunEvent(runId, clientId, {
            stage: 'chain',
            progressLabel: 'Queued marketing brief + 30-day strategy run.',
          }).catch(() => {}),
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
              body: JSON.stringify({ runId: chainRunId }),
              cache: 'no-store',
            });
            if (!response.ok) {
              const detail = await response.text().catch(() => '');
              console.error(`[WORKER] onboarding chain trigger failed for ${clientId}: ${response.status} ${detail.trim()}`);
            }
          } catch (err) {
            console.warn(`[WORKER] onboarding chain trigger threw for ${clientId}: ${err?.message}`);
          }
        });
        console.log(`[${new Date().toISOString()}] WORKER: onboarding chain queued — scout-brief run ${chainRunId} for ${clientId}`);
      } catch (chainErr) {
        console.warn(`[WORKER] onboarding chain queue failed (non-fatal) for ${clientId}: ${chainErr?.message}`);
      }
    }
  }

  // Narrow Creative Brief: generate the onboarding (Creative Brief) summary
  // INLINE (awaited) before the run completes, so the cover paragraph is present
  // the moment the brief becomes viewable — not a deferred after() that lands
  // after the dashboard already rendered the brief (which then falls back to the
  // run headline). Evidence is available: moduleBriefs are written above and the
  // brand overview persists from the onboarding run. Signup runs this inline too
  // now that it no longer chains the scout-brief (whose deferred pass previously
  // generated this summary).
  if (claimedRun.trigger === 'creative-brief' || claimedRun.trigger === 'signup') {
    try {
      const { generateBriefSummaries } = await import('../../../../features/scout-intake/brief-summary-runner.mjs');
      await generateBriefSummaries({ clientId, runId, briefTypes: ['onboarding'] });
    } catch (err) {
      console.warn(`[WORKER] creative-brief summary non-fatal failure for ${clientId}: ${err?.message}`);
    }
  }

  await completeRun(runId, clientId, pipelineResult);
  console.log(`[${new Date().toISOString()}] WORKER: run ${runId} succeeded for ${clientId}`);

  // Step 10 — Per-brief cover summaries. A completed scout-brief run refreshes
  // the data behind every named brief, so regenerate all covers. Deferred:
  // reads dashboard_state AFTER completeRun's projection lands; failures only
  // mean the cover falls back to the run headline.
  if (pipelineType === 'scout-brief') {
    after(async () => {
      try {
        const { generateBriefSummaries } = await import('../../../../features/scout-intake/brief-summary-runner.mjs');
        await generateBriefSummaries({ clientId, runId });
      } catch (err) {
        console.warn(`[WORKER] brief summaries non-fatal failure for ${clientId}: ${err?.message}`);
      }
    });
  }

  return json({
    ok: true,
    runId,
    clientId,
    status: 'succeeded',
    source,
    sweep,
    pipelineRunId: pipelineResult.pipelineRunId,
  });
}

export async function GET(request) {
  return handleRunBrief(request, { parseBody: false, source: 'cron-sweep' });
}

export async function POST(request) {
  return handleRunBrief(request, { parseBody: true, source: 'worker' });
}
