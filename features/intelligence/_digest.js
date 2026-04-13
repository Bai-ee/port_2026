'use strict';

// _digest.js — pure digest generation from source records
// Deterministic, deduped, token-capped. No I/O, no async.

const MAX_DIGEST_TOKENS = 2000;

// Rough token estimate: words * 1.3
function estimateTokens(str) {
  return Math.ceil(str.split(/\s+/).filter(Boolean).length * 1.3);
}

const POSITIVE_KEYWORDS = ['strong', 'good', 'fast', 'pass', 'excellent', 'great'];
const GAP_KEYWORDS      = ['missing', 'no ', 'lack', 'absent', 'not found', 'none'];
const RISK_KEYWORDS     = ['poor', 'slow', 'fail', 'error', 'broken', 'timeout', 'low '];

function matchesAny(str, keywords) {
  const lower = str.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Generate a digest from an array of source records.
 *
 * Determinism guarantee: given identical input (same sources, same signals), output
 * `briefingBullets`, `positives`, `gaps`, and `risks` are always identical.
 * `generatedAt` is the wall-clock time of the call and is excluded from determinism.
 *
 * @param {Array<{ id: string, enabled: boolean, signals: string[] }>} sources
 * @returns {{ briefingBullets: string[], positives: string[], gaps: string[], risks: string[], generatedAt: string, totalTokenEst: number }}
 */
function generateDigest(sources) {
  if (!Array.isArray(sources)) sources = [];

  // Stable order: sort by source id so output is independent of insertion order
  const sorted = [...sources]
    .filter((s) => s && s.enabled !== false)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const seen            = new Set();
  const briefingBullets = [];
  let   tokenCount      = 0;

  for (const src of sorted) {
    const signals = Array.isArray(src.signals) ? src.signals : [];
    for (const signal of signals) {
      if (typeof signal !== 'string' || !signal.trim()) continue;
      const normalized = signal.trim();
      if (seen.has(normalized)) continue;
      const est = estimateTokens(normalized);
      if (tokenCount + est > MAX_DIGEST_TOKENS) continue; // skip over-budget signals
      seen.add(normalized);
      briefingBullets.push(normalized);
      tokenCount += est;
    }
  }

  const positives = briefingBullets.filter((b) => matchesAny(b, POSITIVE_KEYWORDS));
  const gaps      = briefingBullets.filter((b) => matchesAny(b, GAP_KEYWORDS));
  const risks     = briefingBullets.filter((b) => matchesAny(b, RISK_KEYWORDS));

  return {
    briefingBullets,
    positives,
    gaps,
    risks,
    generatedAt:   new Date().toISOString(),
    totalTokenEst: tokenCount,
  };
}

module.exports = { generateDigest, MAX_DIGEST_TOKENS };
