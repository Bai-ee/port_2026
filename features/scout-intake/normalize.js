'use strict';

// normalize.js — Maps LLM synthesis output to the IntakePipelineResult contract
//
// This is the boundary between what the LLM returns and what the worker writes
// to Firestore. Keeps run-lifecycle.cjs compatibility while adding the new
// snapshot/signals/strategy fields.
//
// Also provides backward-compatible shims so buildDashboardProjection in
// run-lifecycle.cjs continues to work without changes. The extended projection
// in run-lifecycle.cjs will add the new fields on top.

// ── Safe accessors ─────────────────────────────────────────────────────────────

function str(val, fallback = '') {
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function arr(val) {
  return Array.isArray(val) ? val : [];
}

// ── Compat shims — maps new intake fields to run-lifecycle.cjs field names ────

/**
 * Derive scoutPriorityAction from the intake payload.
 * run-lifecycle.cjs uses this as the dashboard headline.
 */
function deriveScoutPriorityAction(intake) {
  return (
    str(intake?.strategy?.postStrategy?.approach) ||
    str(intake?.snapshot?.brandOverview?.positioning) ||
    str(intake?.snapshot?.brandOverview?.headline) ||
    null
  );
}

/**
 * Derive a content object that run-lifecycle.cjs's buildDashboardProjection
 * can read for summaryCards.
 */
function deriveContent(intake) {
  const post = str(intake?.outputsPreview?.samplePost);
  const caption = str(intake?.outputsPreview?.sampleCaption);
  if (!post && !caption) return null;
  return {
    x_post: post || null,
    content_angle: str(intake?.strategy?.contentAngles?.[0]?.angle) || null,
    ...(caption ? { caption } : {}),
  };
}

/**
 * Map opportunityMap to the contentOpportunities shape expected by
 * buildDashboardProjection (latestInsights).
 */
function deriveContentOpportunities(intake) {
  return arr(intake?.strategy?.opportunityMap).map((item) => ({
    topic: str(item.opportunity),
    whyNow: str(item.why),
    priority: item.priority || 'medium',
    format: null,
  }));
}

// ── Main normalizer ───────────────────────────────────────────────────────────

/**
 * Normalize raw intake data into an IntakePipelineResult.
 *
 * @param {object} intake - Raw output from intake-synthesizer.js
 * @param {object} meta   - { clientId, websiteUrl, runCostData, pipelineRunId }
 * @returns {IntakePipelineResult}
 */
function normalizeIntakeResult(intake, { clientId, websiteUrl, runCostData, pipelineRunId }) {
  if (!intake || typeof intake !== 'object') {
    throw new Error('normalizeIntakeResult: intake must be a non-null object');
  }

  const snapshot = intake.snapshot || {};
  const signals = intake.signals || {};
  const strategy = intake.strategy || {};
  const outputsPreview = intake.outputsPreview || {};
  const systemPreview = intake.systemPreview || {};

  return {
    // Identity
    status: 'succeeded',
    pipelineType: 'free-tier-intake',
    pipelineRunId,

    // ── Free-tier dashboard modules ─────────────────────────────────────────

    snapshot: {
      brandOverview: {
        headline: str(snapshot.brandOverview?.headline),
        summary: str(snapshot.brandOverview?.summary),
        industry: str(snapshot.brandOverview?.industry),
        businessModel: str(snapshot.brandOverview?.businessModel),
        targetAudience: str(snapshot.brandOverview?.targetAudience),
        positioning: str(snapshot.brandOverview?.positioning),
      },
      brandTone: {
        primary: str(snapshot.brandTone?.primary),
        secondary: str(snapshot.brandTone?.secondary),
        tags: arr(snapshot.brandTone?.tags).filter(Boolean),
        writingStyle: str(snapshot.brandTone?.writingStyle),
      },
      visualIdentity: {
        summary: str(snapshot.visualIdentity?.summary),
        colorPalette: str(snapshot.visualIdentity?.colorPalette),
        styleNotes: str(snapshot.visualIdentity?.styleNotes),
      },
    },

    signals: {
      core: arr(signals.core).map((s) => ({
        label: str(s.label),
        summary: str(s.summary),
        source: str(s.source, 'website'),
        relevance: ['high', 'medium', 'low'].includes(s.relevance) ? s.relevance : 'medium',
      })),
    },

    strategy: {
      postStrategy: {
        approach: str(strategy.postStrategy?.approach),
        frequency: str(strategy.postStrategy?.frequency),
        formats: arr(strategy.postStrategy?.formats).filter(Boolean),
      },
      contentAngles: arr(strategy.contentAngles).map((a) => ({
        angle: str(a.angle),
        rationale: str(a.rationale),
        format: str(a.format),
      })),
      opportunityMap: arr(strategy.opportunityMap).map((o) => ({
        opportunity: str(o.opportunity),
        why: str(o.why),
        priority: ['high', 'medium', 'low'].includes(o.priority) ? o.priority : 'medium',
      })),
    },

    outputsPreview: {
      samplePost: str(outputsPreview.samplePost),
      sampleCaption: str(outputsPreview.sampleCaption),
    },

    systemPreview: {
      modulesUnlocked: arr(systemPreview.modulesUnlocked).filter(Boolean).length > 0
        ? arr(systemPreview.modulesUnlocked).filter(Boolean)
        : ['Brand Overview', 'Brand Tone', 'Visual Identity', 'Signals', 'Post Strategy'],
      nextStep: str(systemPreview.nextStep),
    },

    // ── run-lifecycle.cjs compatibility shims ───────────────────────────────
    // These let buildDashboardProjection work without changes in Phase 4.
    // The extended projection in run-lifecycle.cjs will merge the new fields on top.

    scoutPriorityAction: deriveScoutPriorityAction(intake),
    content: deriveContent(intake),
    contentOpportunities: deriveContentOpportunities(intake),
    guardianFlags: null,

    // ── Cost + provider metadata ────────────────────────────────────────────
    providerName: 'anthropic',
    runCostData: runCostData || null,
  };
}

module.exports = { normalizeIntakeResult };
