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
const { normalizeIntakeResult, synthesizeStyleGuide } = require('./normalize');
const { extractDesignSystem } = require('./design-system-extractor');
const { buildUserContext } = require('./user-context');
const { runAnalyzers } = require('./analyzers');
const { runScribe } = require('./scribe');
const { runCardSkills, buildSourcePayloads } = require('./skills/_runner');
const { ensureScoutConfig } = require('./scout-config-generator');
const { persistWebsiteScreenshotArtifact, persistBriefPdfArtifact } = require('../../api/_lib/browserless.cjs');
const { renderBriefHtml } = require('./brief-renderer');
const { generateWebsiteMockupArtifact } = require('../../api/_lib/device-mockup.cjs');
const { getMaster } = require('../intelligence/_store');

// ── Intelligence briefing ─────────────────────────────────────────────────────

/**
 * Build an injected briefing string from stored intelligence digest.
 * Returns null when there are no briefing bullets to inject.
 * Pure — no Firestore access.
 */
function buildIntelligenceBriefing(master) {
  const bullets = master?.digest?.briefingBullets;
  if (!Array.isArray(bullets) || bullets.length === 0) return null;
  return [
    '=== SITE INTELLIGENCE BRIEFING ===',
    ...bullets.map((b) => `- ${b}`),
  ].join('\n');
}

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
async function runIntakePipeline({ clientId, clientConfig = null, onProgress = null, runId = null }) {
  const { randomUUID } = require('crypto');
  const pipelineRunId = randomUUID();
  const executionRunId = runId || pipelineRunId;
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

  // Build compact userContext from onboarding survey answers. Null when the
  // user has no meaningful answers stored — consumers branch on presence.
  const userContext = buildUserContext(clientConfig);
  if (userContext) {
    console.log(
      `[${new Date().toISOString()}] INTAKE: userContext — ${userContext._meta.answeredCount} answer${userContext._meta.answeredCount !== 1 ? 's' : ''} merged`
    );
  }

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
      artifactRefs: [],
      warnings: [],
    };
  }

  const screenshotTask = (async () => {
    await emitProgress('capture', 'Capturing homepage screenshot…', { currentUrl: websiteUrl });
    return persistWebsiteScreenshotArtifact({
      clientId,
      runId: executionRunId,
      websiteUrl,
    });
  })();

  const resolveScreenshotOutcome = async () => {
    const artifactRefs = [];
    const warnings = [];
    const screenshotResult = await screenshotTask.catch((err) => ({
      ok: false,
      warning: {
        type: 'warning',
        code: 'website_screenshot_failed',
        message: `Website screenshot capture failed: ${err.message}`,
        stage: 'capture',
      },
    }));

    if (screenshotResult?.ok) {
      if (Array.isArray(screenshotResult.artifactRefs) && screenshotResult.artifactRefs.length > 0) {
        artifactRefs.push(...screenshotResult.artifactRefs);
      } else if (screenshotResult.artifactRef) {
        artifactRefs.push(screenshotResult.artifactRef);
      }
      if (Array.isArray(screenshotResult.warnings) && screenshotResult.warnings.length > 0) {
        warnings.push(...screenshotResult.warnings);
      }
    } else if (screenshotResult?.warning) {
      warnings.push(screenshotResult.warning);
    }

    return { artifactRefs, warnings };
  };

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
  let fetchWarning = null;
  try {
    evidence = await fetchSiteEvidence(websiteUrl, { onPageFetched });
    console.log(
      `[${new Date().toISOString()}] INTAKE: fetch complete — ${evidence.pages.length} pages, thin=${evidence.thin}`
    );
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
    // Fetch failed — degrade to empty evidence so downstream stages can
    // still produce a (thin) dashboard rather than a dead run.
    evidence = { url: websiteUrl, fetchedAt: new Date().toISOString(), pages: [], warnings: [`Fetch failed: ${err.message}`], thin: true };
    fetchWarning = {
      type: 'warning',
      code: 'fetch_failed',
      message: `Site fetch failed (non-fatal): ${err.message}. Dashboard will be thin.`,
      stage: 'fetch',
    };
    await emitProgress('fetch', `Fetch failed — continuing with limited data`, { currentUrl: websiteUrl }).catch(() => {});
  }

  const { artifactRefs, warnings } = await resolveScreenshotOutcome();
  if (fetchWarning) warnings.push(fetchWarning);

  // ── Opt-in intelligence injection ────────────────────────────────────────
  // Read stored intelligence master for this client. If pipelineInjection is
  // enabled, build a briefing string from the stored digest. Non-fatal: any
  // failure here omits injection and lets the pipeline continue unchanged.
  let intelligenceBriefing = null;
  try {
    const master = await getMaster(clientId);
    if (master?.meta?.pipelineInjection === true) {
      intelligenceBriefing = buildIntelligenceBriefing(master);
      if (intelligenceBriefing) {
        console.log(`[${new Date().toISOString()}] INTAKE: intelligence injection enabled for ${clientId}`);
      }
    }
  } catch (err) {
    console.warn(`[INTAKE] intelligence read failed (non-fatal): ${err.message}`);
  }

  // ── Stage 2: LLM synthesis + design system extraction (parallel) ─────────
  // Both hit Anthropic and are independent — run concurrently to cut wall time.
  // Design system extraction is non-fatal: any failure becomes a warning and
  // the styleGuide field is left null for dashboard fallback.
  console.log(`[${new Date().toISOString()}] INTAKE: synthesizing + extracting design system...`);

  const styleGuideTask = extractDesignSystem(evidence, {
    onProgress: () => emitProgress('styleguide', 'Extracting design system…'),
  }).catch((err) => ({ ok: false, designSystem: null, runCostData: null, error: err.message }));

  let synthesisResult;
  try {
    synthesisResult = await synthesizeSiteEvidence(evidence, {
      onProgress: () => emitProgress('synthesize', 'Running AI brand analysis…'),
      intelligenceBriefing,
    });
  } catch (err) {
    synthesisResult = { ok: false, intake: null, runCostData: null, error: err.message };
    warnings.push({
      type: 'warning',
      code: 'synthesize_failed',
      message: `Synthesis threw (non-fatal): ${err.message}. Dashboard cards that depend on AI analysis will show "work needed."`,
      stage: 'synthesize',
    });
    await emitProgress('synthesize', `AI analysis failed — continuing with available data`).catch(() => {});
  }

  if (!synthesisResult.ok) {
    if (!synthesisResult.intake) {
      synthesisResult.intake = null;
      warnings.push({
        type: 'warning',
        code: 'synthesize_empty',
        message: `Synthesis returned no intake data (non-fatal): ${synthesisResult.error || 'unknown'}. Dashboard will be thin.`,
        stage: 'synthesize',
      });
    }
  }

  console.log(
    `[${new Date().toISOString()}] INTAKE: synthesis complete — cost ~$${synthesisResult.runCostData?.estimatedCostUsd}`
  );

  // ── Stage 3: Compose device mockup ───────────────────────────────────────
  if (artifactRefs.some((artifact) => artifact?.type === 'website_homepage_screenshot')) {
    await emitProgress('compose', 'Generating multi-device mockup…', {
      currentUrl: websiteUrl,
      screenshotVariants: artifactRefs
        .filter((artifact) => artifact?.type === 'website_homepage_screenshot')
        .map((artifact) => artifact.variant)
        .filter(Boolean),
    });

    const mockupResult = await generateWebsiteMockupArtifact({
      clientId,
      runId: executionRunId,
      websiteUrl,
      screenshotArtifactRefs: artifactRefs,
    });

    if (mockupResult?.ok && mockupResult.artifactRef) {
      artifactRefs.push(mockupResult.artifactRef);
    } else if (mockupResult?.warning) {
      warnings.push(mockupResult.warning);
    }
  }

  // ── Resolve design system (started in parallel with synth) ──────────────
  // Haiku summary fires only if extraction returned a design system object.
  let styleGuide = null;
  let styleGuideCost = null;
  try {
    const dsResult = await styleGuideTask;
    styleGuideCost = dsResult?.runCostData || null;
    if (dsResult?.ok && dsResult.designSystem) {
      styleGuide = await synthesizeStyleGuide(dsResult.designSystem);
      console.log(
        `[${new Date().toISOString()}] INTAKE: style guide extracted — cost ~$${dsResult.runCostData?.estimatedCostUsd}`
      );
    } else if (dsResult?.error) {
      warnings.push({
        type: 'warning',
        code: 'style_guide_extraction_failed',
        message: `Style guide extraction failed: ${dsResult.error}`,
        stage: 'styleguide',
      });
    }
  } catch (err) {
    warnings.push({
      type: 'warning',
      code: 'style_guide_extraction_threw',
      message: `Style guide extraction threw: ${err.message}`,
      stage: 'styleguide',
    });
  }

  // ── Stage 4: Normalize ────────────────────────────────────────────────────
  await emitProgress('normalize', 'Writing dashboard modules...');

  // Pull siteMeta from homepage evidence — extracted by site-fetcher, never in LLM output.
  const siteMeta = evidence.pages.find((p) => p.type === 'homepage')?.siteMeta || null;

  // ── Fan out per-card analyzers ──────────────────────────────────────────
  // Heavy work (synth + design-system) already ran above. Analyzers read from
  // sharedResults and produce per-card status / confidence / signals for Scribe.
  const tier = (clientConfig?.tier === 'paid') ? 'paid' : 'free';
  const sharedResults = {
    intake: synthesisResult.intake,
    styleGuide,
    styleGuideCost,
    siteMeta,
    pagespeed: null, // wired in a later phase
  };

  let analyzerResults = null;
  try {
    analyzerResults = await runAnalyzers({ sharedResults, userContext, evidence, tier });
  } catch (err) {
    warnings.push({
      type: 'warning',
      code: 'analyzers_threw',
      message: `Analyzer fan-out threw: ${err.message}`,
      stage: 'analyze',
    });
  }

  // ── Scout enrichment config — generate once per client ─────────────────
  // Produces a clients.js-shape config (brand keywords, competitors,
  // category terms, reddit subreddits, weather/reviews/instagram when
  // applicable, plus the 5-query search plan). Cached at
  // client_configs/{id}.scoutConfig after first write. Non-fatal.
  //
  // Scouts DO NOT run here yet — this phase just persists the config so
  // admin can review. Phase E wires the actual external scout calls.
  let scoutConfig = null;
  try {
    await emitProgress('scout-config', 'Generating scout enrichment config…');
    const res = await ensureScoutConfig({
      clientId,
      clientName: clientConfig?.displayName
        || clientConfig?.companyName
        || synthesisResult.intake?.snapshot?.brandOverview?.headline
        || null,
      intakeResult: synthesisResult.intake,
      userContext,
      evidence,
      websiteUrl,   // synth's intake object doesn't carry this; pass explicitly
    });
    if (res?.scoutConfig) {
      scoutConfig = res.scoutConfig;
      console.log(
        `[${new Date().toISOString()}] INTAKE: scoutConfig ${res.created ? 'generated' : 'loaded from cache'} — ${scoutConfig._meta?.capabilitiesActive?.length ?? 0} capabilities active${res.cost ? `, cost ~$${res.cost.estimatedCostUsd}` : ''}`
      );
    }
    if (res?.error) {
      warnings.push({
        type: 'warning',
        code: 'scout_config_failed',
        message: `Scout config: ${res.error}`,
        stage: 'scout-config',
      });
    }
  } catch (err) {
    warnings.push({
      type: 'warning',
      code: 'scout_config_threw',
      message: `Scout config threw: ${err.message}`,
      stage: 'scout-config',
    });
  }

  // ── Analyzer skill step ─────────────────────────────────────────────────
  // Gated behind SCOUT_ANALYZER_SKILLS_ENABLED. When unset, this block is a
  // no-op and the pipeline runs the pre-P1 path byte-for-byte identically.
  // Skill failures are non-fatal: each failure pushes a warning and the card
  // falls back to existing analyzer.impl signals at Scribe time.
  let analyzerOutputs = {};
  if (process.env.SCOUT_ANALYZER_SKILLS_ENABLED) {
    await emitProgress('skills', 'Running analyzer skills…');
    try {
      // Strip _rawHtml from evidence pages before handing to skills.
      // _rawHtml is ephemeral (stripped by normalize.js before Firestore write)
      // but it's still on the evidence at this stage and can push prompts
      // well over the 200K token limit. Skills only need the extracted
      // structured fields, not the raw HTML source.
      const evidenceForSkills = evidence && Array.isArray(evidence.pages)
        ? {
            ...evidence,
            pages: evidence.pages.map((p) => {
              const { _rawHtml, ...rest } = p || {};
              return rest;
            }),
          }
        : evidence;

      const sourcePayloads = buildSourcePayloads({
        intake:      synthesisResult.intake,
        styleGuide,
        siteMeta,
        evidence:    evidenceForSkills,
        pagespeed:   sharedResults.pagespeed,
        scoutConfig,
        userContext,
      });
      analyzerOutputs = await runCardSkills({ tier, sourcePayloads, warnings });
      console.log(
        `[${new Date().toISOString()}] INTAKE: analyzer skills complete — ${Object.keys(analyzerOutputs).length} card(s) produced output`
      );
    } catch (err) {
      warnings.push({
        type: 'warning',
        code: 'skills_threw',
        message: `Analyzer skills threw: ${err.message}`,
        stage: 'skills',
      });
    }
  }

  // ── Scribe pass — per-card copy + brief doc ─────────────────────────────
  // Haiku call; reads analyzer signals only (no raw HTML). Non-fatal: on
  // failure we continue with scribe=null; dashboard falls back to the raw
  // intake fields still present in the result.
  let scribeResult = null;
  try {
    scribeResult = await runScribe({
      analyzerResults,
      userContext,
      websiteUrl,
      onProgress: () => emitProgress('scribe', 'Writing card copy + brief…'),
    });
    if (scribeResult?.ok) {
      console.log(
        `[${new Date().toISOString()}] INTAKE: scribe complete — ${Object.keys(scribeResult.cards || {}).length} cards, cost ~$${scribeResult.runCostData?.estimatedCostUsd}`
      );
    } else if (scribeResult?.error) {
      warnings.push({
        type: 'warning',
        code: 'scribe_failed',
        message: `Scribe: ${scribeResult.error}`,
        stage: 'scribe',
      });
    }
  } catch (err) {
    warnings.push({
      type: 'warning',
      code: 'scribe_threw',
      message: `Scribe threw: ${err.message}`,
      stage: 'scribe',
    });
  }

  // ── Brief render + PDF artifact ─────────────────────────────────────────
  // Only runs when scribe succeeded. Renders a self-contained HTML document
  // (also usable as email body) and posts it to browserless /pdf. Non-fatal:
  // failure leaves briefHtml present but no PDF artifact.
  let briefHtml = null;
  if (scribeResult?.ok && scribeResult.brief) {
    try {
      const mockupArtifact = artifactRefs.find((a) => a?.type === 'website_homepage_device_mockup') || null;
      const intake = synthesisResult.intake || {};
      const runMeta = {
        pagesFetched: Array.isArray(evidence?.pages) ? evidence.pages.length : 0,
        pageTypes:    Array.isArray(evidence?.pages) ? evidence.pages.map((p) => p.type).filter(Boolean) : [],
        thin:         Boolean(evidence?.thin),
        warningCount: Array.isArray(warnings) ? warnings.length : 0,
        costs: {
          synth:      synthesisResult?.runCostData?.estimatedCostUsd ?? null,
          styleGuide: styleGuideCost?.estimatedCostUsd ?? null,
          scribe:     scribeResult?.runCostData?.estimatedCostUsd ?? null,
        },
      };
      briefHtml = renderBriefHtml({
        brief: scribeResult.brief,
        scribeCards: scribeResult.cards || {},
        snapshot: intake.snapshot || null,
        signals: intake.signals || null,
        strategy: intake.strategy || null,
        outputsPreview: intake.outputsPreview || null,
        siteMeta,
        styleGuide,
        mockupUrl: mockupArtifact?.downloadUrl || null,
        userContext,
        runMeta,
        websiteUrl,
        clientId,
        generatedAt: new Date().toISOString(),
        tier,
      });
    } catch (err) {
      warnings.push({
        type: 'warning',
        code: 'brief_render_failed',
        message: `Brief HTML render failed: ${err.message}`,
        stage: 'brief',
      });
    }

    if (briefHtml) {
      await emitProgress('brief', 'Rendering brief PDF…');
      const pdfResult = await persistBriefPdfArtifact({
        clientId,
        runId: executionRunId,
        html: briefHtml,
      });

      if (pdfResult?.ok && pdfResult.artifactRef) {
        artifactRefs.push(pdfResult.artifactRef);
      } else if (pdfResult?.warning) {
        warnings.push(pdfResult.warning);
      }
    }
  }

  let normalized;
  try {
    normalized = normalizeIntakeResult(synthesisResult.intake, {
      clientId,
      websiteUrl,
      runCostData: synthesisResult.runCostData,
      pipelineRunId,
      artifactRefs,
      warnings,
      siteMeta,
      styleGuide,
      styleGuideCost,
      userContext,
      analyzerResults,
      analyzerOutputs,
      scribeResult,
      briefHtml,
      scoutConfig,
      tier,
    });
  } catch (err) {
    // Normalize failed — build a minimal result so the dashboard still
    // renders with whatever data we have. Cards will show "work needed."
    warnings.push({
      type: 'warning',
      code: 'normalize_failed',
      message: `Normalization failed (non-fatal): ${err.message}. Dashboard may be incomplete.`,
      stage: 'normalize',
    });
    normalized = {
      status: 'succeeded',
      pipelineType: 'free-tier-intake',
      pipelineRunId,
      scoutPriorityAction: null,
      content: null,
      contentOpportunities: null,
      guardianFlags: null,
      providerName: 'anthropic',
      runCostData: synthesisResult?.runCostData || null,
      artifactRefs,
      warnings,
      snapshot: synthesisResult?.intake?.snapshot || null,
      signals: synthesisResult?.intake?.signals || null,
      strategy: synthesisResult?.intake?.strategy || null,
      outputsPreview: synthesisResult?.intake?.outputsPreview || null,
      systemPreview: synthesisResult?.intake?.systemPreview || null,
      siteMeta,
      analyzerOutputs: analyzerOutputs && Object.keys(analyzerOutputs).length > 0 ? analyzerOutputs : null,
    };
  }

  console.log(`[${new Date().toISOString()}] INTAKE: pipeline ${pipelineRunId} ${normalized.status === 'succeeded' ? 'succeeded' : 'completed with warnings'}.`);
  return normalized;
}

module.exports = { runIntakePipeline, buildIntelligenceBriefing };
