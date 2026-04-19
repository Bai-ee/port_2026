'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const {
  normalizeSourceSetting,
  psiSourceToDashboardSeoAudit,
  buildIntelligencePayload,
} = require('../../../api/_lib/intelligence-bootstrap-utils.cjs');

// ── normalizeSourceSetting ────────────────────────────────────────────────────

test('null input returns full defaults', () => {
  const s = normalizeSourceSetting(null);
  assert.strictEqual(s.enabled,       true);
  assert.strictEqual(s.refreshPolicy, 'manual');
});

test('undefined input returns full defaults', () => {
  const s = normalizeSourceSetting(undefined);
  assert.strictEqual(s.enabled,       true);
  assert.strictEqual(s.refreshPolicy, 'manual');
});

test('empty object fills in both defaults', () => {
  const s = normalizeSourceSetting({});
  assert.strictEqual(s.enabled,       true);
  assert.strictEqual(s.refreshPolicy, 'manual');
});

test('existing enabled=false is preserved', () => {
  const s = normalizeSourceSetting({ enabled: false });
  assert.strictEqual(s.enabled, false);
});

test('existing refreshPolicy is preserved', () => {
  const s = normalizeSourceSetting({ refreshPolicy: 'daily' });
  assert.strictEqual(s.refreshPolicy, 'daily');
});

test('full existing object is preserved as-is', () => {
  const s = normalizeSourceSetting({ enabled: true, refreshPolicy: 'weekly' });
  assert.deepStrictEqual(s, { enabled: true, refreshPolicy: 'weekly' });
});

// ── psiSourceToDashboardSeoAudit ──────────────────────────────────────────────

function makePsiSource(overrides) {
  return {
    id:       'pagespeed-insights',
    provider: 'google-pagespeed-v5',
    version:  '1.0.0',
    status:   'live',
    enabled:  true,
    fetchedAt: '2026-04-12T21:59:10Z',
    durationMs: 34200,
    cost: { usd: 0, quotaUnits: 1, model: null, inputTokens: null, outputTokens: null },
    summary: 'Mobile performance is poor, SEO is strong.',
    signals: ['Performance 44/100'],
    facts: {
      strategy:        'mobile',
      websiteUrl:      'https://example.com',
      scores:          { performance: 44, seo: 91 },
      coreWebVitals:   { lcp: { p75: 38300, category: 'SLOW' } },
      labCoreWebVitals: null,
      opportunities:   [{ id: 'opt1', title: 'Reduce JS', savingsMs: 1200 }],
      seoRedFlags:     [],
      a11yFailures:    [],
      bpFailures:      [],
      insights:        [],
      diagnostics:     [],
      thirdParties:    [],
      lighthouseMeta:  { lighthouseVersion: '11.0.0', totalDurationMs: 34200, warnings: [] },
      runtimeError:    null,
      diagnosticsContext: {
        inputUrl: 'https://example.com',
        resolvedUrl: 'https://www.example.com',
        redirectCount: 1,
        redirectChain: [{ status: 301, from: 'https://example.com', to: 'https://www.example.com' }],
        hostType: 'standard',
        httpStatus: 200,
        contentType: 'text/html; charset=utf-8',
        server: 'nginx',
        blockedBy: null,
        probeStatus: 'ok',
        probeErrorCode: null,
        probeError: null,
        failureCode: null,
        failureClass: null,
        failureReason: null,
        runtimeErrorCode: null,
        runtimeErrorMessage: null,
      },
      auditStatus:     'ok',
    },
    nextRefreshHint: 'manual',
    error: null,
    ...overrides,
  };
}

test('null source returns null', () => {
  assert.strictEqual(psiSourceToDashboardSeoAudit(null, 'https://x.com'), null);
});

test('live source returns mapped seoAudit', () => {
  const src    = makePsiSource();
  const result = psiSourceToDashboardSeoAudit(src, '');
  assert.strictEqual(result.status,    'ok');
  assert.strictEqual(result.fetchedAt, '2026-04-12T21:59:10Z');
  assert.deepStrictEqual(result.scores, { performance: 44, seo: 91 });
  assert.strictEqual(result.websiteUrl, 'https://example.com');
});

test('error source returns error stub', () => {
  const src    = makePsiSource({ status: 'error', error: 'rate limited', facts: {} });
  const result = psiSourceToDashboardSeoAudit(src, 'https://fallback.com');
  assert.strictEqual(result.status,    'error');
  assert.match(result.error,           /rate limited/);
  assert.strictEqual(result.scores,    null);
  assert.strictEqual(result.websiteUrl, 'https://fallback.com');
});

test('fallback websiteUrl used when facts.websiteUrl absent', () => {
  const src    = makePsiSource({ facts: { ...makePsiSource().facts, websiteUrl: '' } });
  const result = psiSourceToDashboardSeoAudit(src, 'https://fallback.com');
  assert.strictEqual(result.websiteUrl, 'https://fallback.com');
});

test('partial source (auditStatus=partial) is preserved', () => {
  const src    = makePsiSource({ facts: { ...makePsiSource().facts, auditStatus: 'partial', runtimeError: { code: 'NO_FCP', message: 'x' } } });
  const result = psiSourceToDashboardSeoAudit(src, '');
  assert.strictEqual(result.status,              'partial');
  assert.strictEqual(result.runtimeError?.code,  'NO_FCP');
});

test('meta is mapped from facts.lighthouseMeta', () => {
  const src    = makePsiSource();
  const result = psiSourceToDashboardSeoAudit(src, '');
  assert.ok(result.meta?.lighthouseVersion === '11.0.0');
});

test('diagnosticsContext is mapped from live source facts', () => {
  const src = makePsiSource();
  const result = psiSourceToDashboardSeoAudit(src, '');
  assert.strictEqual(result.diagnosticsContext?.resolvedUrl, 'https://www.example.com');
  assert.strictEqual(result.diagnosticsContext?.redirectCount, 1);
});

test('error source preserves diagnosticsContext for dashboard rendering', () => {
  const src = makePsiSource({
    status: 'error',
    error: 'timeout',
    facts: {
      websiteUrl: 'https://example.com',
      diagnosticsContext: {
        failureCode: 'timeout_origin_slow',
        failureClass: 'measurement',
        failureReason: 'The page was reachable, but the audit timed out before Lighthouse could finish rendering it.',
        resolvedUrl: 'https://example.com',
        hostType: 'standard',
        redirectCount: 0,
      },
    },
  });
  const result = psiSourceToDashboardSeoAudit(src, 'https://fallback.com');
  assert.strictEqual(result.status, 'error');
  assert.strictEqual(result.diagnosticsContext?.failureCode, 'timeout_origin_slow');
  assert.match(result.diagnosticsContext?.failureReason || '', /timed out/i);
});

// ── buildIntelligencePayload ──────────────────────────────────────────────────

test('empty sourceDocs produces empty sources', () => {
  const p = buildIntelligencePayload(null, [], '');
  assert.deepStrictEqual(p.sources,         {});
  assert.strictEqual(p.dashboardSeoAudit,   null);
  assert.strictEqual(p.psiSummary,          null);
  assert.strictEqual(p.master,              null);
});

test('psi source doc produces non-null dashboardSeoAudit', () => {
  const src = makePsiSource();
  const p   = buildIntelligencePayload(null, [src], 'https://example.com');
  assert.ok(p.dashboardSeoAudit !== null);
  assert.strictEqual(p.dashboardSeoAudit.status, 'ok');
});

test('psi error source produces error-stub dashboardSeoAudit', () => {
  const src = makePsiSource({ status: 'error', error: 'timeout', facts: {} });
  const p   = buildIntelligencePayload(null, [src], 'https://example.com');
  assert.strictEqual(p.dashboardSeoAudit.status, 'error');
});

test('psiSummary is extracted from psi source summary', () => {
  const src = makePsiSource();
  const p   = buildIntelligencePayload(null, [src], '');
  assert.strictEqual(p.psiSummary, src.summary);
});

test('psiSummary is null for error source', () => {
  const src = makePsiSource({ status: 'error', error: 'x', facts: {} });
  const p   = buildIntelligencePayload(null, [src], '');
  assert.strictEqual(p.psiSummary, null);
});

test('source settings are normalized from master', () => {
  const masterDoc = { sourceSettings: { 'pagespeed-insights': {} } };
  const src       = makePsiSource();
  const p         = buildIntelligencePayload(masterDoc, [src], '');
  assert.deepStrictEqual(p.sourceSettings['pagespeed-insights'], { enabled: true, refreshPolicy: 'manual' });
});

test('source settings with custom values are preserved', () => {
  const masterDoc = { sourceSettings: { 'pagespeed-insights': { enabled: false, refreshPolicy: 'daily' } } };
  const src       = makePsiSource();
  const p         = buildIntelligencePayload(masterDoc, [src], '');
  assert.deepStrictEqual(p.sourceSettings['pagespeed-insights'], { enabled: false, refreshPolicy: 'daily' });
});

test('sources map keyed by source id', () => {
  const src = makePsiSource();
  const p   = buildIntelligencePayload(null, [src], '');
  assert.ok('pagespeed-insights' in p.sources);
});
