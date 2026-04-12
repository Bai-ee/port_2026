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
const { DATA_DIR } = require('./store');

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
 * @returns {Promise<object>} Normalized pipeline result (see shape below).
 */
async function runClientPipeline({ clientId, clientConfig = null, fresh = false }) {
  const pipelineRunId = randomUUID();
  const startedAt = new Date().toISOString();

  console.log(`[${startedAt}] RUNTIME: starting pipeline ${pipelineRunId} for ${clientId}`);

  // ── 1. Resolve runtime config ───────────────────────────────────────────────
  const config = loadRuntimeConfig(clientId, clientConfig);

  // ── 2. Initialize provider from config ─────────────────────────────────────
  const provider = initProvider(config.providerConfig || { defaultProvider: 'anthropic' });
  console.log(`[${new Date().toISOString()}] RUNTIME: provider — ${provider.providerName}`);

  // ── 3. Handle fresh flag ────────────────────────────────────────────────────
  if (fresh) {
    await deletePriorBrief(clientId);
  }

  // ── 4. Scout ─────────────────────────────────────────────────────────────────
  const brief = await runXScout(config);

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

  // ── 5. Scribe — brief passed directly, no filesystem coupling ───────────────
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
    startedAt,
    completedAt,
    providerName: provider.providerName,
    brief,
    content: scribeOutput.content,
    contentOpportunities: scribeOutput.contentOpportunities,
    guardianFlags: scribeOutput.guardianFlags,
    scoutPriorityAction: scribeOutput.scoutPriorityAction,
    runCostData: { stageCosts },
    artifactRefs: [
      { type: 'brief_json', path: path.join(DATA_DIR, 'briefs', clientId, 'latest.json') },
      { type: 'content_json', path: path.join(DATA_DIR, 'content', clientId, 'latest-content.json') },
    ],
  };
}

module.exports = { runClientPipeline };
