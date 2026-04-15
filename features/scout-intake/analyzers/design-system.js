'use strict';

// design-system.js — Thin analyzer over the already-extracted styleGuide.
//
// The heavy Sonnet extraction runs once in runner.js (Phase 1 wiring). This
// analyzer echoes that result into the card-scoped analyzer shape so Scribe
// can consume it uniformly. No additional LLM call.

async function run({ sharedResults }) {
  const styleGuide = sharedResults?.styleGuide || null;
  const runCostData = sharedResults?.styleGuideCost || null;

  if (!styleGuide) {
    return {
      status: 'empty',
      confidence: 'low',
      signals: null,
      notes: 'no design system extracted (site may be JS-rendered or thin on CSS)',
      runCostData,
    };
  }

  return {
    status: 'ok',
    confidence: styleGuide.confidence || 'medium',
    signals: { styleGuide },
    notes: styleGuide.summary || null,
    runCostData,
  };
}

module.exports = { run };
