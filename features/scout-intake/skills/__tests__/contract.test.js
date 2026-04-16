'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { validateSkillOutput } = require('../_output-contract');

// ── Invalid top-level types ────────────────────────────────────────────────────

test('null output is invalid', () => {
  const { valid, errors } = validateSkillOutput(null);
  assert.strictEqual(valid, false);
  assert.ok(errors.length > 0);
});

test('non-object output is invalid', () => {
  const { valid } = validateSkillOutput('string');
  assert.strictEqual(valid, false);
});

// ── Missing required fields ───────────────────────────────────────────────────

test('missing skillId is flagged', () => {
  const { valid, errors } = validateSkillOutput({ skillVersion: 1, runAt: 'x', findings: [], gaps: [], readiness: 'healthy', highlights: [], metadata: { model: 'm', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } });
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('skillId')));
});

test('missing skillVersion is flagged', () => {
  const { valid, errors } = validateSkillOutput({ skillId: 'x', runAt: 'x', findings: [], gaps: [], readiness: 'healthy', highlights: [], metadata: { model: 'm', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } });
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('skillVersion')));
});

test('missing runAt is flagged', () => {
  const { valid, errors } = validateSkillOutput({ skillId: 'x', skillVersion: 1, findings: [], gaps: [], readiness: 'healthy', highlights: [], metadata: { model: 'm', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } });
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('runAt')));
});

// ── findings validation ───────────────────────────────────────────────────────

test('findings must be array', () => {
  const base = validBase();
  base.findings = null;
  const { valid, errors } = validateSkillOutput(base);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('findings')));
});

test('finding with invalid severity is flagged', () => {
  const base = validBase();
  base.findings = [{ id: 'f1', severity: 'unknown', label: 'L', detail: 'D', citation: 'C' }];
  const { valid, errors } = validateSkillOutput(base);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('severity')));
});

test('finding missing id is flagged', () => {
  const base = validBase();
  base.findings = [{ severity: 'info', label: 'L', detail: 'D', citation: 'C' }];
  const { valid, errors } = validateSkillOutput(base);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('.id')));
});

// ── gaps validation ───────────────────────────────────────────────────────────

test('gap with non-boolean triggered is flagged', () => {
  const base = validBase();
  base.gaps = [{ ruleId: 'r1', triggered: 'yes', evidence: 'e' }];
  const { valid, errors } = validateSkillOutput(base);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('triggered')));
});

// ── readiness validation ──────────────────────────────────────────────────────

test('invalid readiness value is flagged', () => {
  const base = validBase();
  base.readiness = 'unknown';
  const { valid, errors } = validateSkillOutput(base);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('readiness')));
});

test('all valid readiness values pass', () => {
  for (const r of ['healthy', 'partial', 'critical']) {
    const base = validBase();
    base.readiness = r;
    const { valid } = validateSkillOutput(base);
    assert.strictEqual(valid, true, `readiness '${r}' should be valid`);
  }
});

// ── metadata validation ───────────────────────────────────────────────────────

test('missing metadata is flagged', () => {
  const base = validBase();
  delete base.metadata;
  const { valid, errors } = validateSkillOutput(base);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('metadata')));
});

test('metadata with non-number estimatedCostUsd is flagged', () => {
  const base = validBase();
  base.metadata.estimatedCostUsd = '0.001';
  const { valid, errors } = validateSkillOutput(base);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes('estimatedCostUsd')));
});

// ── Happy path ────────────────────────────────────────────────────────────────

test('valid minimal output passes', () => {
  const { valid } = validateSkillOutput(validBase());
  assert.strictEqual(valid, true);
});

test('valid output with findings and gaps passes', () => {
  const base = validBase();
  base.findings = [{
    id: 'perf-low', severity: 'critical', label: 'Low performance', detail: 'Score is 42.', citation: 'intel.pagespeed.scores.performance = 42',
  }];
  base.gaps = [{ ruleId: 'pagespeed-performance-critical', triggered: true, evidence: 'score = 42 < 50' }];
  base.readiness = 'critical';
  base.highlights = ['Performance score 42 — below threshold'];
  const { valid } = validateSkillOutput(base);
  assert.strictEqual(valid, true);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function validBase() {
  return {
    skillId:      'seo-depth-audit',
    skillVersion: 1,
    runAt:        new Date().toISOString(),
    findings:     [],
    gaps:         [],
    readiness:    'healthy',
    highlights:   [],
    metadata: {
      model:            'claude-haiku-4-5-20251001',
      inputTokens:      500,
      outputTokens:     200,
      estimatedCostUsd: 0.0015,
    },
  };
}
