'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { buildSynthesisPrompt } = require('../intake-synthesizer');

// Local reference copy of buildIntelligenceBriefing — tested in isolation
// (mirrors runner.js without pulling in the Firebase-dependent _store import)
function buildIntelligenceBriefing(master) {
  const bullets = master?.digest?.briefingBullets;
  if (!Array.isArray(bullets) || bullets.length === 0) return null;
  return [
    '=== SITE INTELLIGENCE BRIEFING ===',
    ...bullets.map((b) => `- ${b}`),
  ].join('\n');
}

// ── buildIntelligenceBriefing ─────────────────────────────────────────────────

test('null master returns null briefing', () => {
  assert.strictEqual(buildIntelligenceBriefing(null), null);
});

test('undefined master returns null briefing', () => {
  assert.strictEqual(buildIntelligenceBriefing(undefined), null);
});

test('master with no digest returns null', () => {
  assert.strictEqual(buildIntelligenceBriefing({}), null);
});

test('master with empty briefingBullets returns null', () => {
  assert.strictEqual(buildIntelligenceBriefing({ digest: { briefingBullets: [] } }), null);
});

test('master with non-array briefingBullets returns null', () => {
  assert.strictEqual(buildIntelligenceBriefing({ digest: { briefingBullets: null } }), null);
  assert.strictEqual(buildIntelligenceBriefing({ digest: { briefingBullets: 'string' } }), null);
});

test('single bullet produces correct briefing format', () => {
  const result = buildIntelligenceBriefing({
    digest: { briefingBullets: ['Performance 44/100 — mobile needs work'] },
  });
  assert.ok(result.includes('=== SITE INTELLIGENCE BRIEFING ==='));
  assert.ok(result.includes('- Performance 44/100 — mobile needs work'));
});

test('multiple bullets are all prefixed with -', () => {
  const result = buildIntelligenceBriefing({
    digest: { briefingBullets: ['Bullet one', 'Bullet two', 'Bullet three'] },
  });
  assert.ok(result.includes('- Bullet one'));
  assert.ok(result.includes('- Bullet two'));
  assert.ok(result.includes('- Bullet three'));
});

test('briefing starts with the header line', () => {
  const result = buildIntelligenceBriefing({
    digest: { briefingBullets: ['SEO: 91/100'] },
  });
  assert.ok(result.startsWith('=== SITE INTELLIGENCE BRIEFING ==='));
});

test('briefing output is deterministic for same input', () => {
  const master = { digest: { briefingBullets: ['A', 'B'] } };
  assert.strictEqual(buildIntelligenceBriefing(master), buildIntelligenceBriefing(master));
});

// ── injection gating logic ────────────────────────────────────────────────────

function shouldInject(master) {
  return master?.meta?.pipelineInjection === true;
}

test('pipelineInjection=false does not inject', () => {
  assert.strictEqual(shouldInject({ meta: { pipelineInjection: false } }), false);
});

test('pipelineInjection=true injects', () => {
  assert.strictEqual(shouldInject({ meta: { pipelineInjection: true } }), true);
});

test('missing meta does not inject', () => {
  assert.strictEqual(shouldInject({}), false);
});

test('null master does not inject', () => {
  assert.strictEqual(shouldInject(null), false);
});

test('pipelineInjection truthy non-boolean does not inject (strict check)', () => {
  // Must be exactly true, not just truthy
  assert.strictEqual(shouldInject({ meta: { pipelineInjection: 1 } }), false);
  assert.strictEqual(shouldInject({ meta: { pipelineInjection: 'true' } }), false);
});

// ── buildSynthesisPrompt — without injection ──────────────────────────────────

const EVIDENCE = 'WEBSITE: https://example.com\n--- HOME PAGE ---\nTitle: Test Site';

test('prompt without briefing contains WEBSITE EVIDENCE header', () => {
  const p = buildSynthesisPrompt(EVIDENCE);
  assert.ok(p.includes('WEBSITE EVIDENCE'));
  assert.ok(p.includes('================'));
});

test('prompt without briefing contains the evidence text', () => {
  const p = buildSynthesisPrompt(EVIDENCE);
  assert.ok(p.includes(EVIDENCE));
});

test('prompt without briefing does NOT contain ADDITIONAL INTELLIGENCE', () => {
  const p = buildSynthesisPrompt(EVIDENCE);
  assert.ok(!p.includes('ADDITIONAL INTELLIGENCE'));
});

test('prompt without briefing does NOT contain SITE INTELLIGENCE BRIEFING', () => {
  const p = buildSynthesisPrompt(EVIDENCE);
  assert.ok(!p.includes('SITE INTELLIGENCE BRIEFING'));
});

test('null briefing produces same output as omitted briefing', () => {
  assert.strictEqual(buildSynthesisPrompt(EVIDENCE), buildSynthesisPrompt(EVIDENCE, null));
});

// ── buildSynthesisPrompt — with injection ─────────────────────────────────────

const BRIEFING = '=== SITE INTELLIGENCE BRIEFING ===\n- Performance 44/100\n- SEO 91/100';

test('prompt with briefing contains ADDITIONAL INTELLIGENCE section', () => {
  const p = buildSynthesisPrompt(EVIDENCE, BRIEFING);
  assert.ok(p.includes('ADDITIONAL INTELLIGENCE'));
  assert.ok(p.includes('Additional intelligence gathered outside the crawl:'));
});

test('prompt with briefing contains the briefing content', () => {
  const p = buildSynthesisPrompt(EVIDENCE, BRIEFING);
  assert.ok(p.includes('Performance 44/100'));
  assert.ok(p.includes('SEO 91/100'));
});

test('prompt with briefing still contains WEBSITE EVIDENCE after the briefing', () => {
  const p = buildSynthesisPrompt(EVIDENCE, BRIEFING);
  const briefingPos = p.indexOf('ADDITIONAL INTELLIGENCE');
  const evidencePos = p.indexOf('WEBSITE EVIDENCE');
  assert.ok(briefingPos < evidencePos, 'briefing should appear before site evidence');
});

test('briefing section appears immediately before WEBSITE EVIDENCE', () => {
  const p = buildSynthesisPrompt(EVIDENCE, BRIEFING);
  // There should be nothing between the briefing block and WEBSITE EVIDENCE
  // other than the double newline separator
  const evidenceIdx = p.indexOf('WEBSITE EVIDENCE');
  const textBeforeEvidence = p.slice(0, evidenceIdx);
  assert.ok(textBeforeEvidence.includes(BRIEFING));
});

test('prompt with briefing still contains original evidence text', () => {
  const p = buildSynthesisPrompt(EVIDENCE, BRIEFING);
  assert.ok(p.includes(EVIDENCE));
});

// ── missing-intelligence non-fatal behavior ───────────────────────────────────

test('missing briefingBullets yields null — pipeline receives no injection', () => {
  const master = { meta: { pipelineInjection: true }, digest: {} };
  const briefing = buildIntelligenceBriefing(master);
  assert.strictEqual(briefing, null);
  // null briefing → prompt unchanged
  const p = buildSynthesisPrompt(EVIDENCE, briefing);
  assert.ok(!p.includes('ADDITIONAL INTELLIGENCE'));
});

test('null master yields null briefing — prompt unchanged', () => {
  const briefing = buildIntelligenceBriefing(null);
  assert.strictEqual(briefing, null);
  const p = buildSynthesisPrompt(EVIDENCE, briefing);
  assert.strictEqual(p, buildSynthesisPrompt(EVIDENCE));
});

test('empty bullets array yields null briefing — prompt unchanged', () => {
  const master = { meta: { pipelineInjection: true }, digest: { briefingBullets: [] } };
  const briefing = buildIntelligenceBriefing(master);
  assert.strictEqual(briefing, null);
  const p = buildSynthesisPrompt(EVIDENCE, briefing);
  assert.strictEqual(p, buildSynthesisPrompt(EVIDENCE));
});
