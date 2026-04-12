'use strict';

// runner.js — Free-tier intake pipeline orchestrator
//
// Sequence:
//   1. Validate and normalize the websiteUrl
//   2. Fetch site evidence (site-fetcher.js)
//   3. Run LLM synthesis (intake-synthesizer.js)
//   4. Normalize output to IntakePipelineResult (normalize.js)
//   5. Return the result — worker writes it to Firestore
//
// This module is the surface the Phase 3 worker calls via:
//   const { runIntakePipeline } = require('./features/scout-intake/runner');
//   const result = await runIntakePipeline({ clientId, clientConfig });
//
// IntakePipelineResult is shaped to be write-compatible with run-lifecycle.cjs
// (completeRun accepts it as-is; buildDashboardProjection will be extended to
// handle the new snapshot/signals/strategy fields).

const { fetchSiteEvidence } = require('./site-fetcher');
const { synthesizeSiteEvidence } = require('./intake-synthesizer');
const { normalizeIntakeResult } = require('./normalize');

// ── URL normalization ─────────────────────────────────────────────────────────

function normalizeWebsiteUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Run the free-tier intake pipeline for a client.
 *
 * @param {object} options
 * @param {string}      options.clientId        - Firestore client ID
 * @param {object|null} [options.clientConfig]  - client_configs/{clientId} doc from Firestore
 *                                                Must include sourceInputs.websiteUrl
 * @returns {Promise<IntakePipelineResult>}
 *
 * IntakePipelineResult shape:
 * {
 *   status: 'succeeded' | 'failed',
 *   pipelineType: 'free-tier-intake',
 *   pipelineRunId: string,
 *
 *   // Present on success:
 *   snapshot: { brandOverview, brandTone, visualIdentity },
 *   signals: { core },
 *   strategy: { postStrategy, contentAngles, opportunityMap },
 *   outputsPreview: { samplePost, sampleCaption },
 *   systemPreview: { modulesUnlocked, nextStep },
 *
 *   // run-lifecycle.cjs compatibility fields:
 *   scoutPriorityAction: string | null,
 *   content: { x_post: string } | null,
 *   contentOpportunities: array | null,
 *   guardianFlags: null,
 *   providerName: 'anthropic',
 *   runCostData: { model, inputTokens, outputTokens, estimatedCostUsd },
 *
 *   // Present on failure:
 *   error: string | null,
 *   failedStage: 'fetch' | 'synthesize' | 'normalize' | null,
 * }
 */
async function runIntakePipeline({ clientId, clientConfig = null, onProgress = null }) {
  const { randomUUID } = require('crypto');
  const pipelineRunId = randomUUID();
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] INTAKE: starting pipeline ${pipelineRunId} for ${clientId}`);

  // Convenience wrapper — non-fatal, never throws to pipeline
  const emitProgress = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, extra); } catch { /* ignore */ }
  };

  // ── Resolve websiteUrl ────────────────────────────────────────────────────
  const rawUrl =
    clientConfig?.sourceInputs?.websiteUrl ||
    clientConfig?.websiteUrl ||
    '';

  const websiteUrl = normalizeWebsiteUrl(rawUrl);

  if (!websiteUrl) {
    return {
      status: 'failed',
      pipelineType: 'free-tier-intake',
      pipelineRunId,
      error: `No valid websiteUrl found in client config for ${clientId}.`,
      failedStage: 'fetch',
      scoutPriorityAction: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      providerName: 'anthropic',
      runCostData: null,
    };
  }

  // ── Stage 1: Fetch site evidence ─────────────────────────────────────────
  // Emit initial fetch stage so frontend shows "connecting" immediately
  await emitProgress('fetch', `Connecting to ${websiteUrl}…`, { currentUrl: websiteUrl });
  console.log(`[${new Date().toISOString()}] INTAKE: fetching ${websiteUrl}...`);

  // Track pages as they arrive — emitted incrementally via onPageFetched
  const livePages = [];
  const onPageFetched = (type, url, pageEv) => {
    livePages.push({
      type,
      url,
      title: (pageEv.title || '').slice(0, 80),
      headline: (pageEv.h1?.[0] || '').slice(0, 80),
    });
    // Fire-and-forget per-page progress write
    emitProgress('fetch', `${type} page fetched`, {
      currentUrl: url,
      pagesFetched: livePages.length,
      pages: livePages.slice(),
    }).catch(() => {});
  };

  let evidence;
  try {
    evidence = await fetchSiteEvidence(websiteUrl, { onPageFetched });
    console.log(
      `[${new Date().toISOString()}] INTAKE: fetch complete — ${evidence.pages.length} pages, thin=${evidence.thin}`
    );
    // Final analyze emit — full compact page evidence for the terminal display
    const pageEvidence = evidence.pages.slice(0, 4).map((p) => ({
      type: p.type,
      url: p.url,
      title: (p.title || '').slice(0, 80),
      headline: (p.h1?.[0] || '').slice(0, 80),
      cta: (p.ctaTexts?.[0] || '').slice(0, 50),
      snippet: (p.metaDescription || p.bodyParagraphs?.[0] || '').slice(0, 100),
    }));

    await emitProgress('analyze', `${evidence.pages.length} page${evidence.pages.length !== 1 ? 's' : ''} crawled`, {
      currentUrl: websiteUrl,
      pagesFetched: evidence.pages.length,
      thin: evidence.thin,
      pages: pageEvidence,
    });
  } catch (err) {
    return {
      status: 'failed',
      pipelineType: 'free-tier-intake',
      pipelineRunId,
      error: `Site fetch threw: ${err.message}`,
      failedStage: 'fetch',
      scoutPriorityAction: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      providerName: 'anthropic',
      runCostData: null,
    };
  }

  // ── Stage 2: LLM synthesis ────────────────────────────────────────────────
  // 'synthesize' stage is emitted inside synthesizeSiteEvidence right before
  // the Anthropic API call fires — giving a real-time stage boundary.
  console.log(`[${new Date().toISOString()}] INTAKE: synthesizing...`);
  let synthesisResult;
  try {
    synthesisResult = await synthesizeSiteEvidence(evidence, {
      onProgress: () => emitProgress('synthesize', 'Running AI brand analysis…'),
    });
  } catch (err) {
    return {
      status: 'failed',
      pipelineType: 'free-tier-intake',
      pipelineRunId,
      error: `Synthesis threw: ${err.message}`,
      failedStage: 'synthesize',
      scoutPriorityAction: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      providerName: 'anthropic',
      runCostData: null,
    };
  }

  if (!synthesisResult.ok) {
    return {
      status: 'failed',
      pipelineType: 'free-tier-intake',
      pipelineRunId,
      error: synthesisResult.error || 'Synthesis returned no intake data.',
      failedStage: 'synthesize',
      scoutPriorityAction: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      providerName: 'anthropic',
      runCostData: synthesisResult.runCostData,
    };
  }

  console.log(
    `[${new Date().toISOString()}] INTAKE: synthesis complete — cost ~$${synthesisResult.runCostData?.estimatedCostUsd}`
  );

  // ── Stage 3: Normalize ────────────────────────────────────────────────────
  await emitProgress('normalize', 'Writing dashboard modules...');
  let normalized;
  try {
    normalized = normalizeIntakeResult(synthesisResult.intake, {
      clientId,
      websiteUrl,
      runCostData: synthesisResult.runCostData,
      pipelineRunId,
    });
  } catch (err) {
    return {
      status: 'failed',
      pipelineType: 'free-tier-intake',
      pipelineRunId,
      error: `Normalization threw: ${err.message}`,
      failedStage: 'normalize',
      scoutPriorityAction: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      providerName: 'anthropic',
      runCostData: synthesisResult.runCostData,
    };
  }

  console.log(`[${new Date().toISOString()}] INTAKE: pipeline ${pipelineRunId} succeeded.`);
  return normalized;
}

module.exports = { runIntakePipeline };
