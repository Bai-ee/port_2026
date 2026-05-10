// Lead Gen — Readiness Comparison
// Runs AI Agent Readiness on the preview URL and produces a before/after diff
// vs. the onboard baseline. The delta is the pitch: "22 → 91 (+69 points)."
// Server-only. Requires: ANTHROPIC_API_KEY (via agent-readiness module).

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runAgentReadinessModule } = require('../scout-intake/modules/agent-readiness');

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export async function runReadinessComparison({ prospect, previewUrl }) {
  if (!previewUrl) throw new Error('previewUrl is required');

  // Run agent readiness on the new preview site
  const raw = await runAgentReadinessModule({
    websiteUrl: previewUrl,
    onProgress: null,
  }).catch(err => ({
    ok: false,
    status: 'failed',
    errorCode: 'ar_threw',
    errorMessage: err.message,
    result: null,
    warningCodes: [],
  }));

  const afterAr = raw?.result?.agentReadiness || {};
  const beforeAr = prospect?.onboard?.agentReadiness || {};

  const beforeScore = beforeAr.score ?? null;
  const afterScore  = afterAr.score  ?? null;

  // Finding diff: resolved = in before but not in after (fixed)
  //               new      = in after but not in before (regressions — shouldn't happen for a clean site)
  const beforeFindings = Array.isArray(beforeAr.findings) ? beforeAr.findings : [];
  const afterFindings  = Array.isArray(afterAr.findings)  ? afterAr.findings  : [];

  function findingId(f) {
    return typeof f === 'string' ? f : (f?.id || f?.message || JSON.stringify(f));
  }

  const beforeIds = new Set(beforeFindings.map(findingId));
  const afterIds  = new Set(afterFindings.map(findingId));

  const resolvedFindings = beforeFindings.filter(f => !afterIds.has(findingId(f)));
  const newFindings      = afterFindings.filter(f => !beforeIds.has(findingId(f)));

  const comparison = {
    before: {
      score:    beforeScore,
      verdict:  beforeAr.verdict  || null,
      findings: beforeFindings,
    },
    after: {
      score:    afterScore,
      verdict:  afterAr.verdict  || null,
      findings: afterFindings,
      status:   raw.status,
    },
    improvement:       afterScore !== null && beforeScore !== null ? afterScore - beforeScore : null,
    resolvedFindings,
    newFindings,
    comparedAt:        new Date().toISOString(),
    previewUrl,
  };

  return comparison;
}

// ─── FORMATTED SUMMARY ───────────────────────────────────────────────────────
// Returns a human-readable string for logging / dashboard display.

export function formatComparison(comparison) {
  const { before, after, improvement, resolvedFindings, newFindings } = comparison;
  const lines = [
    'AI AGENT READINESS',
    `  Before: ${before.score ?? '?'}/100 — ${before.verdict ?? 'unknown'}`,
    `  After:  ${after.score  ?? '?'}/100 — ${after.verdict  ?? 'unknown'}`,
    `  Improvement: ${improvement !== null ? (improvement >= 0 ? '+' : '') + improvement + ' points' : 'N/A'}`,
  ];
  if (resolvedFindings.length) {
    lines.push('  ✓ Resolved:');
    resolvedFindings.slice(0, 6).forEach(f => lines.push(`    · ${typeof f === 'string' ? f : (f.message || f.id)}`));
  }
  if (newFindings.length) {
    lines.push('  ⚠ Remaining:');
    newFindings.slice(0, 4).forEach(f => lines.push(`    · ${typeof f === 'string' ? f : (f.message || f.id)}`));
  }
  return lines.join('\n');
}
