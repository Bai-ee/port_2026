'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { seoAuditToSourceRecord } = require('../pagespeed');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function goodSeoAudit(overrides) {
  return {
    fetchedAt:  '2026-04-12T21:59:10Z',
    websiteUrl: 'https://example.com',
    scores: { performance: 44, seo: 91, accessibility: 88, bestPractices: 88 },
    coreWebVitals: {
      lcp:  { p75: 38300, category: 'SLOW' },
      inp:  { p75: 200,   category: 'FAST' },
      cls:  { p75: 0.01,  category: 'FAST' },
      ttfb: { p75: 1200 },
    },
    labCoreWebVitals: null,
    opportunities: [
      { id: 'unused-javascript', title: 'Reduce unused JavaScript', savingsMs: 1200 },
    ],
    seoRedFlags:  [],
    a11yFailures: [],
    bpFailures:   [],
    insights:     [{ id: 'render-blocking-resources', label: 'Render-blocking', value: '0.5 s', score: 0.5 }],
    diagnostics:  [{ id: 'dom-size', label: 'DOM nodes', value: '1234' }],
    thirdParties: [{ entity: 'Google Analytics', blockingMs: 100, sizeFormatted: '45 KB' }],
    meta: { lighthouseVersion: '11.0.0', fetchTime: '2026-04-12T21:59:10Z', totalDurationMs: 34200, warnings: [] },
    status:       'ok',
    runtimeError: null,
    error:        null,
    ...overrides,
  };
}

function okPsiResult(seoAuditOverrides) {
  return { ok: true, seoAudit: goodSeoAudit(seoAuditOverrides), error: null };
}

function errorPsiResult(msg) {
  return { ok: false, seoAudit: null, error: msg || 'fetch failed' };
}

// ── seoAuditToSourceRecord ────────────────────────────────────────────────────

test('ok result produces a live SourceRecord', () => {
  const rec = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', 34200);
  assert.strictEqual(rec.id,       'pagespeed-insights');
  assert.strictEqual(rec.provider, 'google-pagespeed-v5');
  assert.strictEqual(rec.status,   'live');
  assert.strictEqual(rec.enabled,  true);
  assert.strictEqual(rec.error,    null);
});

test('error result produces an error SourceRecord', () => {
  const rec = seoAuditToSourceRecord(errorPsiResult('PSI HTTP 429'), 'https://example.com', null);
  assert.strictEqual(rec.status,         'error');
  assert.match(rec.error,                /429/);
  assert.strictEqual(rec.signals.length, 0);
});

test('facts contains all required PSI sub-objects', () => {
  const rec = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', 34200);
  const f   = rec.facts;
  assert.ok(f.scores,           'facts.scores');
  assert.ok(f.coreWebVitals,    'facts.coreWebVitals');
  assert.ok(f.opportunities,    'facts.opportunities');
  assert.ok(Array.isArray(f.seoRedFlags),  'facts.seoRedFlags');
  assert.ok(Array.isArray(f.a11yFailures), 'facts.a11yFailures');
  assert.ok(Array.isArray(f.bpFailures),   'facts.bpFailures');
  assert.ok(f.lighthouseMeta,   'facts.lighthouseMeta');
  assert.strictEqual(f.strategy, 'mobile');
});

test('facts.auditStatus preserves ok | partial distinction', () => {
  const okRec   = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', null);
  assert.strictEqual(okRec.facts.auditStatus, 'ok');

  const partialRec = seoAuditToSourceRecord(
    okPsiResult({ status: 'partial', runtimeError: { code: 'NO_FCP', message: 'no first contentful paint' } }),
    'https://example.com',
    null
  );
  assert.strictEqual(partialRec.status,             'live');   // SourceRecord maps partial → live
  assert.strictEqual(partialRec.facts.auditStatus,  'partial');
  assert.ok(partialRec.facts.runtimeError?.code === 'NO_FCP');
});

test('durationMs is taken from meta.totalDurationMs when present', () => {
  const rec = seoAuditToSourceRecord(okPsiResult({ meta: { totalDurationMs: 34200, warnings: [] } }), 'https://example.com', 99999);
  assert.strictEqual(rec.durationMs, 34200);
});

test('durationMs falls back to provided value when meta absent', () => {
  const rec = seoAuditToSourceRecord(okPsiResult({ meta: null }), 'https://example.com', 12345);
  assert.strictEqual(rec.durationMs, 12345);
});

test('cost is always zero-usd for PSI (free API)', () => {
  const rec = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', null);
  assert.strictEqual(rec.cost.usd,        0);
  assert.strictEqual(rec.cost.quotaUnits, 1);
  assert.strictEqual(rec.cost.model,      null);
});

test('signals array is non-empty for a good audit', () => {
  const rec = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', null);
  assert.ok(rec.signals.length > 0);
});

test('signals include score facts', () => {
  const rec     = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', null);
  const joined  = rec.signals.join('\n');
  assert.match(joined, /performance score 44/);
  assert.match(joined, /SEO score 91/);
});

test('signals include top fix from opportunities', () => {
  const rec    = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', null);
  const joined = rec.signals.join('\n');
  assert.match(joined, /Reduce unused JavaScript/);
});

test('summary is a non-empty string for a good audit', () => {
  const rec = seoAuditToSourceRecord(okPsiResult(), 'https://example.com', null);
  assert.ok(typeof rec.summary === 'string' && rec.summary.length > 10);
});

test('summary mentions partial for runtimeError audits', () => {
  const rec = seoAuditToSourceRecord(
    okPsiResult({ status: 'partial', runtimeError: { code: 'NO_FCP', message: 'x' } }),
    'https://example.com',
    null
  );
  assert.match(rec.summary.toLowerCase(), /partial/);
});

test('error SourceRecord has facts with websiteUrl', () => {
  const rec = seoAuditToSourceRecord(errorPsiResult(), 'https://example.com', null);
  assert.strictEqual(rec.facts.websiteUrl, 'https://example.com');
});

