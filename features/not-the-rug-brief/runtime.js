// runtime.js — Generic client pipeline entrypoint
//
// This is the surface the Phase 3 worker will call.
//
// Accepts a clientId and an optional Firestore client_config document, then:
//   1. Resolves the runtime config (static registry or Firestore-derived)
//   2. Initializes the provider from config
//   3. Runs Scout then passes the brief directly to Scribe (no filesystem coupling)
//   4. Returns a normalized result the worker can write to brief_runs + dashboard_state
//
// Local dev usage (static registry):
//   const { runClientPipeline } = require('./runtime');
//   await runClientPipeline({ clientId: 'not-the-rug' });
//
// Production worker usage (Firestore-derived config):
//   await runClientPipeline({ clientId, clientConfig: firestoreDoc });

require('./load-env');
const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const { initProvider } = require('./providers');
const { loadRuntimeConfig } = require('./config-loader');
const { runXScout } = require('./xscout');
const { runScribe } = require('./scribe');
const { DATA_DIR } = require('./store.cjs');

/**
 * Delete the prior brief file so Scout treats the next run as a first run.
 * Non-fatal: missing file is silently ignored.
 */
async function deletePriorBrief(clientId) {
  const latestPath = path.join(DATA_DIR, 'briefs', clientId, 'latest.json');
  try {
    await fs.unlink(latestPath);
    console.log(`[${new Date().toISOString()}] RUNTIME: --fresh: deleted prior brief for ${clientId}`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Run the full Scout → Scribe pipeline for a given client.
 *
 * @param {object} options
 * @param {string}      options.clientId       - The client to run for.
 * @param {object|null} [options.clientConfig] - Firestore client_configs doc.
 *                                               Pass null to use the static registry (local dev).
 * @param {boolean}     [options.fresh]        - Delete prior brief before running Scout.
 * @param {function}    [options.onProgress]   - async (stage, label) telemetry callback.
 *                                               Stages: scout, strategy, scribe.
 * @param {Array|null}  [options.moduleBriefs] - per-module website-audit mini-briefs
 *                                               from the intake run (dashboard_state.moduleBriefs.items).
 * @param {string|null} [options.scope]        - run a slice for an individual agent brief:
 *                                               null/'full' → Scout → news → strategy → Scribe (default);
 *                                               'marketing-director' → Scout + news only (today's post,
 *                                               guardian, and 30-day campaign keep stored values);
 *                                               'social-media-manager' → strategy + Scribe only, reusing
 *                                               the stored scout brief (priorScoutBrief required).
 * @param {object|null} [options.priorScoutBrief] - stored marketingBrief.scoutBrief, required for
 *                                               the 'social-media-manager' scope.
 * @returns {Promise<object>} Normalized pipeline result (see shape below).
 */
async function runClientPipeline({ clientId, clientConfig = null, fresh = false, onProgress = null, moduleBriefs = null, scope = null, priorScoutBrief = null }) {
  const pipelineRunId = randomUUID();
  const startedAt = new Date().toISOString();

  // Telemetry only — a progress write failure must never block the pipeline.
  const emitProgress = async (stage, label) => {
    if (typeof onProgress !== 'function') return;
    try { await onProgress(stage, label); } catch { /* non-fatal */ }
  };

  console.log(`[${startedAt}] RUNTIME: starting pipeline ${pipelineRunId} for ${clientId}`);

  // ── 1. Resolve runtime config ───────────────────────────────────────────────
  const config = loadRuntimeConfig(clientId, clientConfig);
  try {
    const kb = await import('../knowledge-base/pipeline-context.js');
    const query = kb.buildKnowledgeBaseRuntimeQuery({
      intent: 'marketing brief offer positioning ICP messaging claims brand voice content angles',
      websiteUrl: config.websiteUrl || clientConfig?.sourceInputs?.websiteUrl || clientConfig?.websiteUrl || '',
      clientName: config.clientName || clientConfig?.displayName || clientConfig?.companyName || '',
      brandOverview: clientConfig?.snapshot?.brandOverview || null,
      sourceInputs: clientConfig?.sourceInputs || {},
    });
    const knowledgeBaseContext = await kb.getKnowledgeBaseRuntimeContext({
      clientId,
      query,
      topK: 5,
      charCap: 3400,
    });
    if (knowledgeBaseContext.available) {
      config.knowledgeBaseContext = knowledgeBaseContext;
      console.log(`[${new Date().toISOString()}] RUNTIME: knowledge base context loaded — ${knowledgeBaseContext.sources.length} source(s)`);
    }
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] RUNTIME: knowledge base context skipped — ${err.message}`);
  }

  // ── 1a. Client Brain context (curated brand/positioning/voice layer) ─────────
  // Toggle: marketingBriefConfig.includeClientBrain (default ON). Mirrors the KB
  // context attach — Scribe folds config.clientBrainContext into the analysis.
  // Only an APPROVED brain feeds it (loadClientBrainContext requireApproved=true).
  try {
    const includeBrain = clientConfig?.marketingBriefConfig?.includeClientBrain !== false;
    if (includeBrain) {
      const { loadClientBrainContext } = require('../client-brain/store.cjs');
      const block = await loadClientBrainContext(clientId, { maxChars: 2400 });
      if (block) {
        config.clientBrainContext = { available: true, block };
        console.log(`[${new Date().toISOString()}] RUNTIME: client brain context loaded (${block.length} chars)`);
      }
    }
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] RUNTIME: client brain context skipped — ${err.message}`);
  }

  // ── 1b. Conversation intake context ─────────────────────────────────────────
  // The Marketing Director's pasted team-conversation dump is parsed into tagged
  // items and stored on the same client_configs doc, so it arrives via the
  // clientConfig param — no extra Firestore read. Mirror knowledgeBaseContext:
  // attach a prompt-ready block onto config for Scribe to fold in.
  try {
    const intakeItems = Array.isArray(clientConfig?.conversationIntake?.items)
      ? clientConfig.conversationIntake.items
      : [];
    if (intakeItems.length) {
      const block = intakeItems
        .slice(0, 20)
        .map((item, i) => {
          const type = String(item?.type || 'brief').toUpperCase();
          const summary = String(item?.summary || '').trim();
          const relevance = String(item?.relevance || '').trim();
          const quote = String(item?.sourceQuote || '').trim();
          return `${i + 1}. [${type}] ${summary}${relevance ? ` — ${relevance}` : ''}${quote ? ` (heard: "${quote}")` : ''}`;
        })
        .join('\n');
      config.conversationContext = {
        available: true,
        block,
        itemCount: intakeItems.length,
        digestedAtIso: clientConfig.conversationIntake?.digestedAtIso || null,
      };
      console.log(`[${new Date().toISOString()}] RUNTIME: conversation intake context loaded — ${intakeItems.length} item(s)`);
    }
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] RUNTIME: conversation intake context skipped — ${err.message}`);
  }

  // ── 1c. Website audit context ────────────────────────────────────────────────
  // Per-module mini-briefs from the intake run (SEO/perf, agent readiness,
  // device rendering, social metadata, design). Folded into Scribe so the
  // executive brief speaks to the client's own site, not just market signals.
  try {
    if (Array.isArray(moduleBriefs) && moduleBriefs.length) {
      const { buildWebsiteAuditPromptBlock } = require('../scout-intake/module-brief-builder');
      const block = buildWebsiteAuditPromptBlock(moduleBriefs);
      if (block) {
        config.websiteAuditContext = { available: true, block, moduleCount: moduleBriefs.length };
        console.log(`[${new Date().toISOString()}] RUNTIME: website audit context loaded — ${moduleBriefs.length} module brief(s)`);
      }
    }
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] RUNTIME: website audit context skipped — ${err.message}`);
  }

  // ── 2. Initialize provider from config ─────────────────────────────────────
  const provider = initProvider(config.providerConfig || { defaultProvider: 'anthropic' });
  console.log(`[${new Date().toISOString()}] RUNTIME: provider — ${provider.providerName}`);

  // ── 3. Handle fresh flag ────────────────────────────────────────────────────
  if (fresh) {
    await deletePriorBrief(clientId);
  }

  // ── 4. Scout ─────────────────────────────────────────────────────────────────
  // 'social-media-manager' scope reuses the stored scout brief instead of a
  // fresh search sweep — the strategy roller and Scribe only need signals as
  // context, and the Marketing Director sections keep their stored values.
  let brief;
  if (scope === 'social-media-manager') {
    if (!priorScoutBrief?.agentData) {
      return {
        pipelineRunId,
        clientId,
        status: 'failed',
        failedStage: 'scout',
        error: 'No stored scout brief to reuse — run the Executive Daily Brief (or Marketing Director) first.',
        startedAt,
        completedAt: new Date().toISOString(),
        providerName: provider.providerName,
        brief: null,
        content: null,
        guardianFlags: null,
        runCostData: { stageCosts: [] },
        artifactRefs: [],
      };
    }
    await emitProgress('scout', 'Reusing stored market signals (scoped run)…');
    brief = {
      status: 'ok',
      timestamp: priorScoutBrief.timestamp || null,
      humanBrief: priorScoutBrief.humanBrief || null,
      delta: priorScoutBrief.delta || null,
      agentData: priorScoutBrief.agentData,
      stageCosts: [],
      scoutReused: true,
    };
  } else {
    await emitProgress('scout', 'Scanning web + X + reddit for market signals…');
    brief = await runXScout(config);
  }

  if (brief.status === 'error') {
    const completedAt = new Date().toISOString();
    console.error(`[${completedAt}] RUNTIME: Scout failed — ${brief.error}`);
    return {
      pipelineRunId,
      clientId,
      status: 'failed',
      failedStage: 'scout',
      error: brief.error,
      startedAt,
      completedAt,
      providerName: provider.providerName,
      brief: null,
      content: null,
      guardianFlags: null,
      runCostData: { stageCosts: brief.stageCosts || [] },
      artifactRefs: [
        { type: 'brief_json', path: path.join(DATA_DIR, 'briefs', clientId, 'latest.json') },
      ],
    };
  }

  // ── 4b. News monitor (Phase 1, Tier A) ───────────────────────────────────────
  // Augment Scout's brandMentions with broad news coverage from GDELT (free).
  // Best-effort: failures never block the brief. Skipped when the scout brief
  // was reused — no fresh signals to augment.
  try {
    if (brief.scoutReused) throw new Error('scout brief reused — skipping news fetch');
    const { fetchBrandNews } = require('./news-monitor');
    const newsItems = await fetchBrandNews({
      brandName: config.clientName,
      brandKeywords: config.brandKeywords,
      lookbackDays: config.scout?.freshnessDays || 1,
    });
    if (newsItems.length) {
      brief.agentData = brief.agentData || {};
      const existing = Array.isArray(brief.agentData.brandMentions) ? brief.agentData.brandMentions : [];
      const seen = new Set(existing.map((m) => String(m?.url || '').trim()).filter(Boolean));
      const fresh = newsItems.filter((m) => m.url && !seen.has(m.url)).slice(0, 20);
      brief.agentData.brandMentions = [...existing, ...fresh];
      console.log(`[${new Date().toISOString()}] RUNTIME: news monitor added ${fresh.length} brand mention(s) from GDELT`);
    }
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] RUNTIME: news monitor skipped — ${err.message}`);
  }

  // ── 4d. Marketing Director scope — fresh signals are the whole job. Today's
  // post, guardian flags, and the 30-day campaign keep their stored values
  // (the projection merges only the keys this result carries). ───────────────
  if (scope === 'marketing-director') {
    const completedAtScoped = new Date().toISOString();
    console.log(`[${completedAtScoped}] RUNTIME: pipeline ${pipelineRunId} completed (scope=marketing-director, scout only)`);
    return {
      pipelineRunId,
      clientId,
      status: 'succeeded',
      scope,
      startedAt,
      completedAt: completedAtScoped,
      providerName: provider.providerName,
      brief,
      strategy30: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      scoutPriorityAction: null,
      knowledgeBase: null,
      runCostData: { stageCosts: brief.stageCosts || [] },
      artifactRefs: [
        { type: 'brief_json', path: path.join(DATA_DIR, 'briefs', clientId, 'latest.json') },
      ],
    };
  }

  // ── 4c. Strategy roller — revise the rolling 30-day post strategy ────────────
  // Uses yesterday's plan (memory) + today's signals; Scribe receives the result
  // as context so the strategy rolls up into the Executive Daily Brief.
  let strategy30 = null;
  await emitProgress('strategy', 'Building 30-day social media campaign…');
  try {
    const { rollStrategy, buildScribeBlock } = require('./strategy-roller');
    strategy30 = await rollStrategy({ clientId, config, brief, provider });
    if (strategy30) {
      config.strategy30Block = buildScribeBlock(strategy30);
      console.log(`[${new Date().toISOString()}] RUNTIME: strategy roller — ${strategy30.days.length} day(s), notes: ${strategy30.revisionNotes.slice(0, 80)}`);
    }
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] RUNTIME: strategy roller skipped — ${err.message}`);
  }

  // ── 5. Scribe — brief passed directly, no filesystem coupling ───────────────
  await emitProgress('scribe', "Drafting today's post + composing executive brief…");
  const scribeOutput = await runScribe(clientId, config, brief);
  const completedAt = new Date().toISOString();

  if (scribeOutput.status === 'error') {
    console.error(`[${completedAt}] RUNTIME: Scribe failed — ${scribeOutput.error}`);
    return {
      pipelineRunId,
      clientId,
      status: 'failed',
      failedStage: 'scribe',
      error: scribeOutput.error,
      startedAt,
      completedAt,
      providerName: provider.providerName,
      brief,
      content: null,
      guardianFlags: null,
      runCostData: { stageCosts: brief.stageCosts || [] },
      artifactRefs: [
        { type: 'brief_json', path: path.join(DATA_DIR, 'briefs', clientId, 'latest.json') },
      ],
    };
  }

  // ── 6. Aggregate costs ───────────────────────────────────────────────────────
  const stageCosts = [
    ...(brief.stageCosts || []),
    ...(scribeOutput.scribeStageCost ? [scribeOutput.scribeStageCost] : []),
    ...(scribeOutput.guardianStageCost ? [scribeOutput.guardianStageCost] : []),
  ];

  console.log(`[${completedAt}] RUNTIME: pipeline ${pipelineRunId} completed successfully`);

  // ── 7. Return normalized result ──────────────────────────────────────────────
  // Phase 3 worker will read this and write to brief_runs/{runId} + dashboard_state/{clientId}.
  // artifactRefs are local filesystem paths for local dev.
  // The worker will replace these with Firestore/Storage references in Phase 3.
  return {
    pipelineRunId,
    clientId,
    status: 'succeeded',
    scope: scope || null,
    startedAt,
    completedAt,
    providerName: provider.providerName,
    brief,
    strategy30,
    content: scribeOutput.content,
    contentOpportunities: scribeOutput.contentOpportunities,
    guardianFlags: scribeOutput.guardianFlags,
    scoutPriorityAction: scribeOutput.scoutPriorityAction,
    knowledgeBase: config.knowledgeBaseContext?.available
      ? {
          sources: config.knowledgeBaseContext.sources,
          injectedAtIso: new Date().toISOString(),
        }
      : null,
    runCostData: { stageCosts },
    artifactRefs: [
      { type: 'brief_json', path: path.join(DATA_DIR, 'briefs', clientId, 'latest.json') },
      { type: 'content_json', path: path.join(DATA_DIR, 'content', clientId, 'latest-content.json') },
    ],
  };
}

module.exports = { runClientPipeline };
