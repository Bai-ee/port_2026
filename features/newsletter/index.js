// index.js — Newsletter module entry point
//
// Pipeline: aggregator → Newsletter Scribe → Renderer → save
// Guardian will be wired in later as an optional QA gate.
//
// Usage:
//   const { runNewsletterPipeline } = require('../features/newsletter');
//   const result = await runNewsletterPipeline({ clientId: 'not-the-rug' });
//
// Or from the worker:
//   await runNewsletterPipeline({ clientId, clientConfig: firestoreDoc, brief });

require('../not-the-rug-brief/load-env');
const { randomUUID } = require('crypto');
const { initProvider } = require('../not-the-rug-brief/providers');
const { loadRuntimeConfig } = require('../not-the-rug-brief/config-loader');
const { requireClientConfig } = require('../not-the-rug-brief/clients');
const { runNewsletterScribe } = require('./newsletter-scribe');
const { renderNewsletterHtml } = require('./newsletter-renderer');
const { saveRenderedNewsletter } = require('./store');

/**
 * Run the Newsletter pipeline for a given client.
 *
 * aggregator → Newsletter Scribe → Renderer → save
 * Guardian will be inserted before Renderer when ready.
 *
 * @param {object} options
 * @param {string}      options.clientId       - The client to run for
 * @param {object|null} [options.clientConfig] - Firestore client_configs doc (null = use static registry)
 * @param {object|null} [options.brief]        - Scout brief passed directly (null = load from store)
 * @returns {Promise<object>} Normalized pipeline result
 */
async function runNewsletterPipeline({ clientId, clientConfig = null, brief = null }) {
  const pipelineRunId = randomUUID();
  const startedAt = new Date().toISOString();

  console.log(`[${startedAt}] NEWSLETTER: starting pipeline ${pipelineRunId} for ${clientId}`);

  // ── 1. Resolve runtime config ──────────────────────────────────────
  const config = loadRuntimeConfig(clientId, clientConfig);

  // Check if newsletter is enabled for this client
  if (config.newsletter?.enabled === false) {
    console.log(`[${startedAt}] NEWSLETTER: disabled for ${clientId} — skipping`);
    return {
      pipelineRunId,
      clientId,
      status: 'skipped',
      reason: 'newsletter_disabled',
      startedAt,
      completedAt: startedAt,
    };
  }

  // ── 2. Initialize provider ─────────────────────────────────────────
  const provider = initProvider(config.providerConfig || { defaultProvider: 'anthropic' });
  console.log(`[${new Date().toISOString()}] NEWSLETTER: provider — ${provider.providerName}`);

  // ── 3. Run Newsletter Scribe (includes aggregation) ────────────────
  const scribeOutput = await runNewsletterScribe(clientId, config, brief);

  if (scribeOutput.status === 'error') {
    const failedAt = new Date().toISOString();
    console.error(`[${failedAt}] NEWSLETTER: Scribe failed — ${scribeOutput.error}`);
    return {
      pipelineRunId,
      clientId,
      status: 'failed',
      failedStage: 'newsletter-scribe',
      error: scribeOutput.error,
      startedAt,
      completedAt: failedAt,
      providerName: provider.providerName,
      content: null,
      guardianFlags: null,
      runCostData: { stageCosts: [] },
    };
  }

  // ── 4. Guardian placeholder ─────────────────────────────────────────
  // const guardianVerdict = await runNewsletterGuardian(scribeOutput, clientId);
  // scribeOutput.guardianFlags = guardianVerdict;

  // ── 5. Render HTML email ──────────────────────────────────────────
  const resolvedConfig = config || requireClientConfig(clientId);
  let renderedHtml = null;
  try {
    renderedHtml = renderNewsletterHtml({
      content: scribeOutput.content,
      clientName: resolvedConfig.clientName || clientId,
      alertLevel: scribeOutput.scoutAlertLevel || 'QUIET',
      date: scribeOutput.timestamp || new Date(),
      config: resolvedConfig,
    });
    await saveRenderedNewsletter(clientId, renderedHtml);
    console.log(`[${new Date().toISOString()}] NEWSLETTER: rendered HTML saved for ${clientId}`);
  } catch (renderErr) {
    // Non-fatal — pipeline succeeds even if renderer fails
    console.warn(`[${new Date().toISOString()}] NEWSLETTER: renderer failed — ${renderErr.message}`);
  }

  const completedAt = new Date().toISOString();

  // ── 6. Aggregate costs ─────────────────────────────────────────────
  const stageCosts = [
    ...(scribeOutput.scribeStageCost ? [scribeOutput.scribeStageCost] : []),
    // guardianStageCost will be added here when Guardian is wired in
  ];

  console.log(`[${completedAt}] NEWSLETTER: pipeline ${pipelineRunId} completed successfully`);

  // ── 7. Return normalized result ────────────────────────────────────
  return {
    pipelineRunId,
    clientId,
    status: 'succeeded',
    startedAt,
    completedAt: completedAt,
    providerName: provider.providerName,
    content: scribeOutput.content,
    guardianFlags: scribeOutput.guardianFlags,
    scoutBriefTimestamp: scribeOutput.scoutBriefTimestamp,
    scoutAlertLevel: scribeOutput.scoutAlertLevel,
    scoutPriorityAction: scribeOutput.scoutPriorityAction,
    runCostData: { stageCosts },
    rawOutput: scribeOutput.rawOutput,
    hasRenderedHtml: !!renderedHtml,
  };
}

module.exports = { runNewsletterPipeline };
