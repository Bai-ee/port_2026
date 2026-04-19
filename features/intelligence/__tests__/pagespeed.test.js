'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const {
  seoAuditToSourceRecord,
  classifyHostType,
  classifyHostService,
  classifyHostingProvider,
  classifyPsiFailure,
  buildDiagnosticsContext,
} = require('../pagespeed');

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

test('classifyHostType detects decentralized gateway hosts', () => {
  assert.strictEqual(classifyHostType('arweave.net'), 'arweave-gateway');
  assert.strictEqual(classifyHostType('bafybeigdyrzt.ipfs.dweb.link'), 'ipfs-gateway');
  assert.strictEqual(classifyHostType('abcde.icp0.io'), 'icp-gateway');
  assert.strictEqual(classifyHostType('example.com'), 'standard');
});

test('classifyHostService returns precise decentralized platform labels', () => {
  assert.strictEqual(classifyHostService('arweave.net'), 'Arweave');
  assert.strictEqual(classifyHostService('bafybeigdyrzt.ipfs.dweb.link'), 'IPFS');
  assert.strictEqual(classifyHostService('abcde.icp0.io'), 'Internet Computer (ICP)');
  assert.strictEqual(classifyHostService('example.com'), null);
});

test('classifyHostingProvider detects mainstream platforms from hostname patterns', () => {
  const wix = classifyHostingProvider({ hostname: 'example.wixsite.com', headers: null });
  assert.strictEqual(wix.provider, 'Wix');
  assert.strictEqual(wix.providerKind, 'site-builder');
  assert.strictEqual(wix.providerConfidence, 'high');

  const vercel = classifyHostingProvider({ hostname: 'my-app.vercel.app', headers: null });
  assert.strictEqual(vercel.provider, 'Vercel');
  assert.strictEqual(vercel.providerKind, 'deployment-platform');
});

test('classifyHostingProvider detects mainstream platforms from response headers', () => {
  const headers = new Headers({
    'x-shopid': '12345',
    'server': 'cloudflare',
  });
  const provider = classifyHostingProvider({ hostname: 'www.example.com', headers });
  assert.strictEqual(provider.provider, 'Shopify');
  assert.strictEqual(provider.providerKind, 'commerce-platform');
  assert.strictEqual(provider.providerConfidence, 'high');
  assert.match(provider.providerEvidence.join(' '), /x-shopid/);
});

test('classifyPsiFailure prefers gateway classification when host is decentralized', () => {
  const failure = classifyPsiFailure({
    websiteUrl: 'https://arweave.net/abc',
    errorMessage: 'PSI HTTP 500',
    apiStatus: 500,
    probe: {
      hostType: 'arweave-gateway',
      redirectCount: 0,
      probeStatus: 'ok',
    },
  });
  assert.strictEqual(failure.failureCode, 'arweave_or_gateway_host');
  assert.strictEqual(failure.failureClass, 'measurement');
});

test('classifyPsiFailure names ICP hosting explicitly', () => {
  const failure = classifyPsiFailure({
    websiteUrl: 'https://abcde.icp0.io',
    errorMessage: 'PSI HTTP 500',
    apiStatus: 500,
    probe: {
      hostType: 'icp-gateway',
      hostService: 'Internet Computer (ICP)',
      redirectCount: 0,
      probeStatus: 'ok',
    },
  });
  assert.strictEqual(failure.failureCode, 'icp_or_gateway_host');
  assert.match(failure.failureReason, /Internet Computer \(ICP\)/);
});

test('error result stores structured diagnostics context', () => {
  const failure = {
    failureCode: 'forwarding_loop',
    failureClass: 'site',
    failureReason: 'The domain appears to redirect in a loop before reaching a crawlable page.',
  };
  const diagnosticsContext = buildDiagnosticsContext({
    websiteUrl: 'https://example.com',
    probe: {
      resolvedUrl: 'https://redirector.example.com',
      redirectCount: 2,
      redirectChain: [
        { status: 301, from: 'https://example.com', to: 'https://www.example.com' },
        { status: 302, from: 'https://www.example.com', to: 'https://redirector.example.com' },
      ],
      hostType: 'redirector-service',
      hostService: 'Redirector service',
      finalStatus: 302,
      probeStatus: 'error',
      probeErrorCode: 'forwarding_loop',
      probeError: 'Redirect loop detected during preflight probe.',
    },
    failure,
  });
  const rec = seoAuditToSourceRecord({
    ok: false,
    seoAudit: null,
    error: 'PSI audit failed',
    failure,
    diagnosticsContext,
  }, 'https://example.com', null);

  assert.strictEqual(rec.status, 'error');
  assert.strictEqual(rec.facts.failureCode, 'forwarding_loop');
  assert.strictEqual(rec.facts.failureClass, 'site');
  assert.match(rec.summary, /redirect in a loop/i);
  assert.strictEqual(rec.facts.diagnosticsContext.redirectCount, 2);
  assert.strictEqual(rec.facts.diagnosticsContext.hostType, 'redirector-service');
  assert.strictEqual(rec.facts.diagnosticsContext.hostService, 'Redirector service');
  assert.strictEqual(rec.facts.diagnosticsContext.hostingProvider, null);
});
