'use strict';

// _aggregator.js — Pure aggregation function for multi-skill card outputs.
//
// Takes the per-skill SkillOutput map for one card and returns a single merged
// aggregate shape. No LLM call. No side effects.
//
// Used by runCardSkills in _runner.js (P3+).
// P4 will fill `recommendation` with a Scribe synthesis step.
//
// Aggregate shape:
// {
//   findings:       Finding[]   — merged, deduped by id, sorted by severity, capped at 8
//   gaps:           Gap[]       — union by ruleId; triggered:true wins
//   readiness:      'healthy' | 'partial' | 'critical'   — worst-of across skills
//   highlights:     string[]    — concat, case-insensitive dedupe, capped at 5
//   recommendation: null        — P4 fills this
// }

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const READINESS_ORDER = { critical: 2, partial: 1, healthy: 0 };

/**
 * Aggregate skill outputs for a single card.
 *
 * @param {{ [skillId: string]: SkillOutput }} skillsById
 * @returns {{ findings, gaps, readiness, highlights, recommendation }}
 */
function aggregateCardSkills(skillsById) {
  const allFindings  = [];
  const gapsByRuleId = {};
  let   worstReadiness = 'healthy';
  const allHighlights  = [];

  for (const output of Object.values(skillsById)) {
    if (!output || typeof output !== 'object') continue;

    // ── findings ──────────────────────────────────────────────────────────
    if (Array.isArray(output.findings)) {
      allFindings.push(...output.findings);
    }

    // ── gaps ─ union by ruleId; triggered:true wins ───────────────────────
    if (Array.isArray(output.gaps)) {
      for (const gap of output.gaps) {
        if (!gap?.ruleId) continue;
        const existing = gapsByRuleId[gap.ruleId];
        if (!existing || (!existing.triggered && gap.triggered)) {
          gapsByRuleId[gap.ruleId] = gap;
        }
      }
    }

    // ── readiness ─ worst-of ──────────────────────────────────────────────
    if (output.readiness && (READINESS_ORDER[output.readiness] ?? -1) > (READINESS_ORDER[worstReadiness] ?? -1)) {
      worstReadiness = output.readiness;
    }

    // ── highlights ────────────────────────────────────────────────────────
    if (Array.isArray(output.highlights)) {
      allHighlights.push(...output.highlights);
    }
  }

  // ── Dedupe findings by id (first occurrence wins), sort, cap at 8 ────────
  const seenIds = new Set();
  const dedupedFindings = [];
  for (const f of allFindings) {
    if (!f?.id || seenIds.has(f.id)) continue;
    seenIds.add(f.id);
    dedupedFindings.push(f);
  }
  dedupedFindings.sort((a, b) => {
    const aRank = SEVERITY_ORDER[a.severity] ?? 3;
    const bRank = SEVERITY_ORDER[b.severity] ?? 3;
    return aRank - bRank;
  });
  const findings = dedupedFindings.slice(0, 8);

  // ── Gaps as array ─────────────────────────────────────────────────────────
  const gaps = Object.values(gapsByRuleId);

  // ── Highlights: dedupe case-insensitive, cap at 5 ─────────────────────────
  const seenHL = new Set();
  const highlights = [];
  for (const h of allHighlights) {
    if (typeof h !== 'string' || !h.trim()) continue;
    const key = h.trim().toLowerCase();
    if (seenHL.has(key)) continue;
    seenHL.add(key);
    highlights.push(h.trim());
    if (highlights.length >= 5) break;
  }

  return {
    findings,
    gaps,
    readiness:      worstReadiness,
    highlights,
    recommendation: null,   // P4 fills this
  };
}

module.exports = { aggregateCardSkills };
