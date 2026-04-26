'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scoreDimension, overallScore, verdictFor } = require('../agent-ready/scoring');
const { runDiscoverability } = require('../agent-ready/checks/discoverability');
const { runAccessibility } = require('../agent-ready/checks/accessibility');
const { runBotAccess } = require('../agent-ready/checks/bot-access');
const { runCapabilities } = require('../agent-ready/checks/capabilities');
const { runAgentReady } = require('../agent-ready/index');
const { FIX_LIBRARY } = require('../agent-ready/fix-library');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PASS_ROBOTS = {
  ok: true, status: 200, headers: {},
  body: 'User-agent: *\nAllow: /\n# Content-Signal: ai-training=disallow, ai-inference=allow\nSitemap: https://example.com/sitemap.xml',
  error: null,
};

const FAIL_ROBOTS = { ok: false, status: 404, headers: {}, body: '', error: null };

const PASS_SITEMAP = { ok: true, status: 200, headers: {}, body: '<?xml version="1.0"?><urlset/>', error: null };
const FAIL_SITEMAP = { ok: false, status: 404, headers: {}, body: '', error: null };

const PASS_HOMEPAGE_HEADERS = {
  ok: true, status: 200,
  headers: { link: '</sitemap.xml>; rel="sitemap"' },
  body: '', error: null,
};
const FAIL_HOMEPAGE_HEADERS = { ok: true, status: 200, headers: {}, body: '', error: null };

const PASS_API_CATALOG = { ok: true, status: 200, headers: {}, body: '{"apis":[]}', error: null };
const FAIL_API_CATALOG = { ok: false, status: 404, headers: {}, body: '', error: null };

const PASS_LLMS_TXT = { ok: true, status: 200, headers: {}, body: '# Site\n> Description', error: null };
const FAIL_LLMS_TXT = { ok: false, status: 404, headers: {}, body: '', error: null };

const PASS_MARKDOWN_NEG = {
  ok: true, status: 200,
  headers: { 'content-type': 'text/markdown; charset=utf-8' },
  body: '# Title\nBody text.',
  error: null,
};
const FAIL_MARKDOWN_NEG = {
  ok: true, status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: '<html><body>Hello</body></html>',
  error: null,
};

const PASS_HOMEPAGE_HTML = '<html><head><script type="application/ld+json">{"@context":"https://schema.org"}</script></head></html>';
const FAIL_HOMEPAGE_HTML = '<html><head></head><body>No structured data</body></html>';

const PASS_SIGNATURE_PROBE = { ok: true, status: 200, headers: {}, body: '', error: null };
const FAIL_SIGNATURE_PROBE = { ok: false, status: 403, headers: {}, body: '', error: null };

const PASS_MCP_JSON = { ok: true, status: 200, headers: {}, body: '{"mcpVersion":"1.0","servers":[]}', error: null };
const FAIL_MCP_JSON = { ok: false, status: 404, headers: {}, body: '', error: null };

const PASS_AGENT_SKILLS = { ok: true, status: 200, headers: {}, body: '{"schemaVersion":"1.0","skills":[]}', error: null };
const FAIL_AGENT_SKILLS = { ok: false, status: 404, headers: {}, body: '', error: null };

const PASS_X402 = { ok: false, status: 402, headers: { 'www-authenticate': 'x402 realm="payment"' }, body: '', error: null };
const FAIL_X402 = { ok: true, status: 200, headers: {}, body: '', error: null };

const PASS_OAUTH = { ok: true, status: 200, headers: {}, body: '{"issuer":"https://example.com","authorization_endpoint":"https://example.com/oauth/authorize"}', error: null };
const FAIL_OAUTH = { ok: false, status: 404, headers: {}, body: '', error: null };

const ALL_PASS_PROBES = {
  robotsTxt:           PASS_ROBOTS,
  sitemapXml:          PASS_SITEMAP,
  homepageHeaders:     PASS_HOMEPAGE_HEADERS,
  apiCatalog:          PASS_API_CATALOG,
  llmsTxt:             PASS_LLMS_TXT,
  markdownNegotiation: PASS_MARKDOWN_NEG,
  homepageHtml:        PASS_HOMEPAGE_HTML,
  signatureAgentProbe: PASS_SIGNATURE_PROBE,
  mcpJson:             PASS_MCP_JSON,
  agentSkills:         PASS_AGENT_SKILLS,
  x402Probe:           PASS_X402,
  oauthDiscovery:      PASS_OAUTH,
};

const ALL_FAIL_PROBES = {
  robotsTxt:           FAIL_ROBOTS,
  sitemapXml:          FAIL_SITEMAP,
  homepageHeaders:     FAIL_HOMEPAGE_HEADERS,
  apiCatalog:          FAIL_API_CATALOG,
  llmsTxt:             FAIL_LLMS_TXT,
  markdownNegotiation: FAIL_MARKDOWN_NEG,
  homepageHtml:        FAIL_HOMEPAGE_HTML,
  signatureAgentProbe: FAIL_SIGNATURE_PROBE,
  mcpJson:             FAIL_MCP_JSON,
  agentSkills:         FAIL_AGENT_SKILLS,
  x402Probe:           FAIL_X402,
  oauthDiscovery:      FAIL_OAUTH,
};

// ── scoring.js tests ──────────────────────────────────────────────────────────

describe('scoring', () => {
  test('scoreDimension: all pass returns 100', () => {
    const checks = [
      { status: 'pass', weight: 2 },
      { status: 'pass', weight: 3 },
    ];
    assert.equal(scoreDimension(checks), 100);
  });

  test('scoreDimension: all fail returns 0', () => {
    const checks = [
      { status: 'fail', weight: 2 },
      { status: 'fail', weight: 1 },
    ];
    assert.equal(scoreDimension(checks), 0);
  });

  test('scoreDimension: na counts as fail (no signal = not ready)', () => {
    const checks = [{ status: 'na', weight: 2 }];
    assert.equal(scoreDimension(checks), 0);
  });

  test('scoreDimension: empty checks returns null', () => {
    assert.equal(scoreDimension([]), null);
  });

  test('scoreDimension: mixed pass/fail weighted correctly', () => {
    const checks = [
      { status: 'pass', weight: 3 },
      { status: 'fail', weight: 1 },
    ];
    assert.equal(scoreDimension(checks), 75); // 3/(3+1) = 75%
  });

  test('scoreDimension: na in mix counts toward denominator', () => {
    const checks = [
      { status: 'pass', weight: 2 },
      { status: 'na',   weight: 2 },
    ];
    assert.equal(scoreDimension(checks), 50); // 2/4 = 50%
  });

  test('overallScore: averages dimension scores', () => {
    assert.equal(overallScore({ a: 100, b: 0, c: 50, d: 50 }), 50);
  });

  test('overallScore: ignores null dimensions', () => {
    assert.equal(overallScore({ a: 100, b: null }), 100);
  });

  test('overallScore: empty returns 0', () => {
    assert.equal(overallScore({}), 0);
  });

  test('verdictFor: ≥80 = Agent-ready', () => {
    assert.equal(verdictFor(80), 'Agent-ready');
    assert.equal(verdictFor(100), 'Agent-ready');
  });

  test('verdictFor: 50–79 = Partially ready', () => {
    assert.equal(verdictFor(50), 'Partially ready');
    assert.equal(verdictFor(79), 'Partially ready');
  });

  test('verdictFor: <50 = Not agent-ready', () => {
    assert.equal(verdictFor(0), 'Not agent-ready');
    assert.equal(verdictFor(49), 'Not agent-ready');
  });
});

// ── discoverability checks ────────────────────────────────────────────────────

describe('discoverability checks', () => {
  test('all pass', () => {
    const checks = runDiscoverability(ALL_PASS_PROBES);
    for (const c of checks) {
      assert.equal(c.status, 'pass', `Expected pass for ${c.id}`);
    }
  });

  test('all fail', () => {
    const checks = runDiscoverability(ALL_FAIL_PROBES);
    for (const c of checks) {
      assert.notEqual(c.status, 'pass', `Expected non-pass for ${c.id}`);
    }
  });

  test('robots-txt-present fails on 404', () => {
    const checks = runDiscoverability({ ...ALL_PASS_PROBES, robotsTxt: FAIL_ROBOTS });
    const c = checks.find((x) => x.id === 'robots-txt-present');
    assert.equal(c.status, 'fail');
    assert.equal(c.fixId, 'add-robots-txt');
  });

  test('robots-txt-parseable is na when robots returns 404', () => {
    const checks = runDiscoverability({ ...ALL_PASS_PROBES, robotsTxt: FAIL_ROBOTS });
    const c = checks.find((x) => x.id === 'robots-txt-parseable');
    assert.equal(c.status, 'na');
  });

  test('link-header-sitemap fails when Link header absent', () => {
    const checks = runDiscoverability({ ...ALL_PASS_PROBES, homepageHeaders: FAIL_HOMEPAGE_HEADERS });
    const c = checks.find((x) => x.id === 'link-header-sitemap');
    assert.equal(c.status, 'fail');
    assert.equal(c.fixId, 'add-link-header-sitemap');
  });
});

// ── accessibility checks ──────────────────────────────────────────────────────

describe('accessibility checks', () => {
  test('all pass', () => {
    const checks = runAccessibility(ALL_PASS_PROBES);
    for (const c of checks) {
      assert.equal(c.status, 'pass', `Expected pass for ${c.id}`);
    }
  });

  test('llms-txt-present fails on 404', () => {
    const checks = runAccessibility({ ...ALL_PASS_PROBES, llmsTxt: FAIL_LLMS_TXT });
    const c = checks.find((x) => x.id === 'llms-txt-present');
    assert.equal(c.status, 'fail');
    assert.equal(c.fixId, 'add-llms-txt');
  });

  test('markdown-content-negotiation fails when HTML returned', () => {
    const checks = runAccessibility({ ...ALL_PASS_PROBES, markdownNegotiation: FAIL_MARKDOWN_NEG });
    const c = checks.find((x) => x.id === 'markdown-content-negotiation');
    assert.equal(c.status, 'fail');
  });

  test('structured-data-present detects JSON-LD', () => {
    const checks = runAccessibility({ ...ALL_PASS_PROBES, homepageHtml: PASS_HOMEPAGE_HTML });
    const c = checks.find((x) => x.id === 'structured-data-present');
    assert.equal(c.status, 'pass');
  });

  test('structured-data-present fails when no JSON-LD', () => {
    const checks = runAccessibility({ ...ALL_PASS_PROBES, homepageHtml: FAIL_HOMEPAGE_HTML });
    const c = checks.find((x) => x.id === 'structured-data-present');
    assert.equal(c.status, 'fail');
    assert.equal(c.fixId, 'add-structured-data');
  });
});

// ── bot-access checks ─────────────────────────────────────────────────────────

describe('botAccess checks', () => {
  test('all pass', () => {
    const checks = runBotAccess(ALL_PASS_PROBES);
    for (const c of checks) {
      assert.equal(c.status, 'pass', `Expected pass for ${c.id}`);
    }
  });

  test('robots-content-signal fails when directive absent', () => {
    const noSignal = { ...PASS_ROBOTS, body: 'User-agent: *\nAllow: /\n' };
    const checks = runBotAccess({ ...ALL_PASS_PROBES, robotsTxt: noSignal });
    const c = checks.find((x) => x.id === 'robots-content-signal');
    assert.equal(c.status, 'fail');
  });

  test('web-bot-auth-supported is na on network error', () => {
    const checks = runBotAccess({ ...ALL_PASS_PROBES, signatureAgentProbe: { ok: false, status: 0, headers: {}, body: '', error: 'timeout' } });
    const c = checks.find((x) => x.id === 'web-bot-auth-supported');
    assert.equal(c.status, 'na');
  });
});

// ── capabilities checks ───────────────────────────────────────────────────────

describe('capabilities checks', () => {
  test('all pass', () => {
    const checks = runCapabilities(ALL_PASS_PROBES);
    for (const c of checks) {
      assert.equal(c.status, 'pass', `Expected pass for ${c.id}`);
    }
  });

  test('mcp-discovery fails on 404', () => {
    const checks = runCapabilities({ ...ALL_PASS_PROBES, mcpJson: FAIL_MCP_JSON });
    const c = checks.find((x) => x.id === 'mcp-discovery');
    assert.equal(c.status, 'fail');
    assert.equal(c.fixId, 'add-mcp-discovery');
  });

  test('x402-payment-supported passes on 402 + x402 header', () => {
    const checks = runCapabilities(ALL_PASS_PROBES);
    const c = checks.find((x) => x.id === 'x402-payment-supported');
    assert.equal(c.status, 'pass');
  });

  test('x402-payment-supported fails on 200', () => {
    const checks = runCapabilities({ ...ALL_PASS_PROBES, x402Probe: FAIL_X402 });
    const c = checks.find((x) => x.id === 'x402-payment-supported');
    assert.equal(c.status, 'fail');
  });

  test('oauth-discovery fails on 404', () => {
    const checks = runCapabilities({ ...ALL_PASS_PROBES, oauthDiscovery: FAIL_OAUTH });
    const c = checks.find((x) => x.id === 'oauth-discovery');
    assert.equal(c.status, 'fail');
  });
});

// ── runAgentReady integration ─────────────────────────────────────────────────

describe('runAgentReady', () => {
  test('all-pass fixture returns score=100 and Agent-ready verdict', async () => {
    const result = await runAgentReady({
      websiteUrl: 'https://example.com',
      _probes: ALL_PASS_PROBES,
    });
    assert.equal(result.ok, true);
    assert.equal(result.score, 100);
    assert.equal(result.verdict, 'Agent-ready');
    assert.ok(Array.isArray(result.checks));
    assert.ok(Array.isArray(result.findings));
    assert.ok(Array.isArray(result.highlights));
  });

  test('all-fail fixture returns score=0 and Not agent-ready verdict', async () => {
    const result = await runAgentReady({
      websiteUrl: 'https://example.com',
      _probes: ALL_FAIL_PROBES,
    });
    assert.equal(result.ok, true);
    assert.equal(result.score, 0);
    assert.equal(result.verdict, 'Not agent-ready');
    assert.ok(result.findings.length > 0);
  });

  test('result has all required top-level keys', async () => {
    const result = await runAgentReady({ websiteUrl: 'https://example.com', _probes: ALL_PASS_PROBES });
    for (const key of ['ok', 'score', 'dimensions', 'verdict', 'checks', 'findings', 'highlights']) {
      assert.ok(key in result, `Missing key: ${key}`);
    }
  });

  test('dimensions object has all four keys', async () => {
    const result = await runAgentReady({ websiteUrl: 'https://example.com', _probes: ALL_PASS_PROBES });
    for (const dim of ['discoverability', 'accessibility', 'botAccess', 'capabilities']) {
      assert.ok(dim in result.dimensions, `Missing dimension: ${dim}`);
    }
  });

  test('findings reference valid fixIds from FIX_LIBRARY', async () => {
    const result = await runAgentReady({ websiteUrl: 'https://example.com', _probes: ALL_FAIL_PROBES });
    for (const finding of result.findings) {
      const check = result.checks.find((c) => c.id === finding.id);
      if (check?.fixId) {
        assert.ok(check.fixId in FIX_LIBRARY, `fixId "${check.fixId}" not in FIX_LIBRARY`);
      }
    }
  });
});

// ── fix-library completeness ──────────────────────────────────────────────────

describe('fix-library', () => {
  test('every fix entry has required fields', () => {
    for (const [key, entry] of Object.entries(FIX_LIBRARY)) {
      assert.ok(entry.title, `${key}: missing title`);
      assert.ok(entry.why, `${key}: missing why`);
      assert.ok(entry.prompt, `${key}: missing prompt`);
      assert.ok(entry.snippet, `${key}: missing snippet`);
    }
  });
});
