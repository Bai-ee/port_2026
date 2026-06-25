'use strict';

// gbp-reputation.js — Analyzer adapter for the GBP Reputation card.
//
// Reads the raw GBP payload from sharedResults (or intake) and runs the
// deterministic features/gbp-reputation analyzer. Returns the standard
// analyzer envelope { status, confidence, signals, notes, runCostData }.
// No LLM, no I/O — Scribe handles human-facing copy downstream.

const { analyzeGbpReputation } = require('../../gbp-reputation/analyzer');

function resolvePayload({ card, sharedResults }) {
  // Preferred: explicit externalSignals bucket on sharedResults.
  const direct = sharedResults?.externalSignals?.googleBusinessProfile;
  if (direct) return direct;
  // Fallback: same path nested in the intake result (card.sourceField).
  const intake = sharedResults?.intake;
  if (intake?.externalSignals?.googleBusinessProfile) {
    return intake.externalSignals.googleBusinessProfile;
  }
  return null;
}

async function run({ card, sharedResults }) {
  const payload = resolvePayload({ card, sharedResults });

  if (!payload) {
    // No GBP data — degrade to setup-needed, but still emit a usable signal.
    const signals = analyzeGbpReputation(null);
    return {
      status: 'empty',
      confidence: 'low',
      signals,
      notes: 'Google Business Profile not connected — setup required.',
      runCostData: null,
    };
  }

  const signals = analyzeGbpReputation(payload);
  const connected = signals.connected === true;

  return {
    status: connected ? 'ok' : 'empty',
    confidence: connected
      ? (signals.riskLevel === 'urgent' ? 'high' : 'medium')
      : 'low',
    signals,
    notes: connected
      ? signals.priorityAction?.label || null
      : 'Google Business Profile not connected — setup required.',
    runCostData: null,
  };
}

module.exports = { run, resolvePayload };
