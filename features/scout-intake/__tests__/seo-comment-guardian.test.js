'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSeoFactPack,
  buildDeterministicSeoComment,
  validateSeoGuardianComment,
  runSeoCommentGuardian,
} = require('../seo-comment-guardian');
const { buildCardDescription } = require('../card-description-builder');

function makePagespeed(overrides = {}) {
  return {
    status: 'live',
    facts: {
      auditStatus: 'ok',
      scores: { performance: 59, seo: 92, accessibility: 92, bestPractices: 100 },
      coreWebVitals: null,
      labCoreWebVitals: {
        lcp: { p75: 10100, category: 'SLOW', source: 'lab' },
        cls: { p75: 0.19, category: 'AVERAGE', source: 'lab' },
      },
      opportunities: [{ title: 'Reduce unused JavaScript', savingsMs: 150 }],
      seoRedFlags: [{ id: 'link-text' }],
      lighthouseMeta: {
        requestedUrl: 'https://www.vivaacid.com/',
        finalUrl: 'https://www.vivaacid.com/',
      },
      diagnosticsContext: {
        inputUrl: 'https://www.vivaacid.com/',
        resolvedUrl: 'https://www.vivaacid.com/',
        hostType: 'standard',
        hostService: null,
        hostingProvider: 'Wix',
        providerKind: 'site-builder',
        providerConfidence: 'high',
        providerEvidence: ['server header reports pepyaka'],
        server: 'Pepyaka',
        redirectCount: 0,
      },
      ...overrides,
    },
  };
}

function makeAiSeo(overrides = {}) {
  return {
    aiVisibility: { score: 68, letterGrade: 'C' },
    rawSignals: {
      schema: { types: ['WebSite', 'LocalBusiness'] },
      llmsTxt: { found: true },
      technical: {
        canonical: 'https://www.vivaacid.com',
        metaDescription: 'Viva Adcid House - Events, News and Education.',
      },
      robotsAi: { blockedBots: [{ name: 'PetalBot' }] },
    },
    ...overrides,
  };
}

function makeAggregate(overrides = {}) {
  return {
    readiness: 'critical',
    findings: [
      { severity: 'critical', label: 'PageSpeed audit timed out — performance data unavailable', detail: '' },
      { severity: 'critical', label: "Meta description rendered with typo ('Adcid' vs 'Acid')", detail: '' },
      { severity: 'warning', label: '10 H1 tags on homepage — poor semantic structure', detail: '' },
    ],
    gaps: [
      { ruleId: 'faq-schema-missing', triggered: true, evidence: 'No FAQPage schema detected' },
    ],
    highlights: ['PageSpeed audit timed out — performance data unavailable'],
    ...overrides,
  };
}

describe('buildSeoFactPack', () => {
  test('filters stale timeout findings when final PSI payload is ok', () => {
    const factPack = buildSeoFactPack({
      websiteUrl: 'https://www.vivaacid.com/',
      pagespeed: makePagespeed(),
      aiSeoAudit: makeAiSeo(),
      seoAggregate: makeAggregate(),
      warnings: [{ stage: 'psi', code: 'pagespeed_failed_timeout_origin_slow', message: 'timed out earlier' }],
      businessModel: 'events and media',
    });

    assert.equal(factPack.psi.auditStatus, 'ok');
    assert.ok(factPack.psi.hasScores);
    assert.equal(factPack.delivery.hostingProvider, 'Wix');
    assert.equal(factPack.delivery.providerConfidence, 'high');
    assert.equal(factPack.analyzer.topIssues[0]?.label, "Meta description rendered with typo ('Adcid' vs 'Acid')");
    assert.ok(!factPack.analyzer.highlights.some((h) => /timed out/i.test(h)));
  });
});

describe('validateSeoGuardianComment', () => {
  test('rejects timeout claim when PSI payload is ok', () => {
    const factPack = buildSeoFactPack({
      websiteUrl: 'https://www.vivaacid.com/',
      pagespeed: makePagespeed(),
      aiSeoAudit: makeAiSeo(),
      seoAggregate: makeAggregate(),
    });
    const errors = validateSeoGuardianComment(factPack, {
      short: 'Wix site timed out before Lighthouse could finish.',
      expanded: "Performance measurement was blocked this run — Lighthouse hit a timeout on your origin server, so we couldn't capture PageSpeed scores or Core Web Vitals data. This site is built on Wix.",
      recommendation: '',
    });
    assert.ok(errors.includes('claims_psi_failed_while_final_payload_is_ok'));
  });

  test('rejects missing-schema claim when schema types exist', () => {
    const factPack = buildSeoFactPack({
      websiteUrl: 'https://www.vivaacid.com/',
      pagespeed: makePagespeed(),
      aiSeoAudit: makeAiSeo(),
      seoAggregate: makeAggregate(),
    });
    const errors = validateSeoGuardianComment(factPack, {
      short: 'Wix site has no schema at all.',
      expanded: 'This site is built on Wix. You are missing schema markup entirely and have no structured data on the page.',
      recommendation: '',
    });
    assert.ok(errors.includes('claims_schema_missing_when_schema_exists'));
  });
});

describe('buildDeterministicSeoComment', () => {
  test('returns aligned short and expanded copy with provider context and real issues', () => {
    const factPack = buildSeoFactPack({
      websiteUrl: 'https://www.vivaacid.com/',
      pagespeed: makePagespeed(),
      aiSeoAudit: makeAiSeo({
        rawSignals: {
          schema: { types: ['WebSite', 'LocalBusiness'] },
          llmsTxt: { found: true },
          technical: {
            canonical: 'https://www.vivaacid.com',
            metaDescription: 'Viva Adcid House - Events, News and Education.',
          },
          robotsAi: { blockedBots: [] },
        },
      }),
      seoAggregate: makeAggregate(),
      businessModel: 'events and media',
    });
    const comment = buildDeterministicSeoComment(factPack);
    const canonical = buildCardDescription('seo-performance', factPack.analyzer.aggregate, {
      auditStatus: factPack.psi.auditStatus,
      failureCode: factPack.psi.failureCode,
      failureReason: factPack.psi.failureReason,
      resolvedUrl: factPack.psi.finalUrl,
      inputUrl: factPack.psi.requestedUrl,
      requestedUrl: factPack.psi.requestedUrl,
      finalUrl: factPack.psi.finalUrl,
      displayedUrl: factPack.psi.finalUrl,
      hostType: factPack.delivery.hostType,
      hostService: factPack.delivery.hostService,
      redirectCount: factPack.delivery.redirectCount,
      performanceScore: factPack.psi.scores?.performance ?? null,
      seoScore: factPack.psi.scores?.seo ?? null,
      lcpSeconds: factPack.psi.lcpSeconds ?? null,
      lcpMs: factPack.psi.lcpMs ?? null,
      lcpSource: factPack.psi.lcpSource || null,
      aiVisibilityScore: factPack.aiSeo.score ?? null,
      aiVisibilityGrade: factPack.aiSeo.grade || null,
      aiSectionSchemaScore: factPack.aiSeo.sections?.schema?.score ?? null,
      aiSectionEntityScore: factPack.aiSeo.sections?.entity?.score ?? null,
      aiBotsBlocked: factPack.aiSeo.botsBlocked || [],
      wikidataEntity: factPack.aiSeo.wikidataEntity || null,
      metaDescriptionPresent: true,
      canonicalPresent: true,
      schemaTypesCount: factPack.aiSeo.schemaTypes.length,
      llmsTxtFound: factPack.aiSeo.llmsTxtFound,
    });
    assert.ok(comment.short);
    assert.ok(comment.short.length <= 140);
    assert.ok(comment.short.startsWith(canonical.dominantSignal.finding));
    assert.match(comment.short, /10\.1 seconds/i);
    assert.match(comment.expanded, /Wix/i);
    assert.match(comment.expanded, /10\.1 seconds/i);
    assert.match(comment.recommendation, /re-run the audit/i);
    assert.doesNotMatch(comment.recommendation, /start by reduce/i);
  });

  test('uses raw PSI LCP value when aggregate wording is stale', () => {
    const pagespeed = makePagespeed({
      scores: { performance: 57, seo: 92, accessibility: 92, bestPractices: 100 },
      labCoreWebVitals: {
        lcp: { p75: 8400, category: 'SLOW', source: 'lab' },
        cls: { p75: 0.19, category: 'AVERAGE', source: 'lab' },
      },
    });
    const aggregate = makeAggregate({
      readiness: 'partial',
      findings: [
        { severity: 'warning', label: 'Largest Contentful Paint slow', detail: 'LCP lab measurement is 11.9 seconds (p75).' },
      ],
      highlights: [],
    });
    const factPack = buildSeoFactPack({
      websiteUrl: 'https://www.vivaacid.com/',
      pagespeed,
      aiSeoAudit: makeAiSeo({
        rawSignals: {
          schema: { types: ['WebSite', 'LocalBusiness'] },
          llmsTxt: { found: true },
          technical: {
            canonical: 'https://www.vivaacid.com',
            metaDescription: 'Viva Adcid House - Events, News and Education.',
          },
          robotsAi: { blockedBots: [] },
        },
      }),
      seoAggregate: aggregate,
      businessModel: 'events and media',
    });
    const comment = buildDeterministicSeoComment(factPack);
    assert.match(comment.short, /8\.4 seconds/i);
    assert.doesNotMatch(comment.short, /11\.9 seconds/i);
  });

  test('AI-specific gaps lead the short comment when they are more distinctive than performance', () => {
    const factPack = buildSeoFactPack({
      websiteUrl: 'https://www.vivaacid.com/',
      pagespeed: makePagespeed({
        scores: { performance: 75, seo: 100, accessibility: 100, bestPractices: 100 },
        labCoreWebVitals: {
          lcp: { p75: 5400, category: 'SLOW', source: 'lab' },
          cls: { p75: 0.0, category: 'FAST', source: 'lab' },
        },
      }),
      aiSeoAudit: makeAiSeo({
        aiVisibility: { score: 58, letterGrade: 'D' },
        rawSignals: {
          schema: { types: ['WebSite', 'LocalBusiness'] },
          llmsTxt: { found: false },
          technical: {
            canonical: 'https://www.vivaacid.com',
            metaDescription: 'Viva Adcid House - Events, News and Education.',
          },
          robotsAi: { blockedBots: [] },
          entity: {},
        },
      }),
      seoAggregate: makeAggregate({
        readiness: 'partial',
        findings: [{ severity: 'warning', label: 'Largest Contentful Paint slow', detail: 'LCP lab measurement is 5.4 seconds (p75).' }],
        highlights: [],
      }),
      businessModel: 'events and media',
    });
    const comment = buildDeterministicSeoComment(factPack);
    assert.match(comment.short, /AI discovery signals are incomplete/i);
    assert.match(comment.short, /llms\.txt/i);
  });
});

describe('runSeoCommentGuardian', () => {
  test('always returns deterministic fact-locked copy', async () => {
    const result = await runSeoCommentGuardian({
      websiteUrl: 'https://www.vivaacid.com/',
      pagespeed: makePagespeed(),
      aiSeoAudit: makeAiSeo(),
      seoAggregate: makeAggregate(),
      businessModel: 'events and media',
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, 'deterministic');
    assert.ok(result.card?.short);
    assert.ok(result.card?.expanded);
    assert.equal(result.runCostData, null);
  });
});
