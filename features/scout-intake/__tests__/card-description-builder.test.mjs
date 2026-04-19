import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_ANALYZER_SOURCE_MAP,
  resolveAnalyzerSource,
  buildCardDescription,
  isAuditFailureGap,
} from '../card-description-builder.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

function agg(overrides = {}) {
  return { readiness: 'healthy', findings: [], gaps: [], highlights: [], ...overrides };
}

function finding(severity, label, detail = '') {
  return { id: `${severity}-${label.slice(0, 10).replace(/\s/g, '-')}`, severity, label, detail, citation: '' };
}

function gap(ruleId, triggered = true, evidence = '') {
  return { ruleId, triggered, evidence };
}

// ── resolveAnalyzerSource — legacy alias pinning ──────────────────────────────

describe('resolveAnalyzerSource — legacy alias resolution', () => {
  test('returns direct aggregate when card id matches key directly', () => {
    const ag = agg({ readiness: 'healthy' });
    assert.equal(resolveAnalyzerSource('seo-performance', { 'seo-performance': { aggregate: ag } }), ag);
  });

  test('returns legacy flat skill output when aggregate wrapper is absent', () => {
    const flat = agg({ readiness: 'partial' });
    assert.equal(resolveAnalyzerSource('seo-performance', { 'seo-performance': flat }), flat);
  });

  test('social-preview falls back to brand-tone when own key absent', () => {
    const ag = agg({ readiness: 'critical' });
    assert.equal(resolveAnalyzerSource('social-preview', { 'brand-tone': { aggregate: ag } }), ag);
  });

  test('social-preview prefers own key over brand-tone', () => {
    const own = agg({ readiness: 'healthy' });
    const bt  = agg({ readiness: 'critical' });
    assert.equal(resolveAnalyzerSource('social-preview', { 'social-preview': { aggregate: own }, 'brand-tone': { aggregate: bt } }), own);
  });

  test('multi-device-view falls back to intake-terminal', () => {
    const ag = agg({ readiness: 'partial' });
    assert.equal(resolveAnalyzerSource('multi-device-view', { 'intake-terminal': { aggregate: ag } }), ag);
  });

  test('multi-device-view prefers own key over intake-terminal', () => {
    const own = agg({ readiness: 'healthy' });
    assert.equal(resolveAnalyzerSource('multi-device-view', { 'multi-device-view': { aggregate: own }, 'intake-terminal': { aggregate: {} } }), own);
  });

  test('seo-performance falls back to site-performance', () => {
    const ag = agg({ readiness: 'partial' });
    assert.equal(resolveAnalyzerSource('seo-performance', { 'site-performance': { aggregate: ag } }), ag);
  });

  test('brand-voice falls back to brand-tone', () => {
    const ag = agg();
    assert.equal(resolveAnalyzerSource('brand-voice', { 'brand-tone': { aggregate: ag } }), ag);
  });

  test('returns null when no matching source key found', () => {
    assert.equal(resolveAnalyzerSource('social-preview', {}), null);
    assert.equal(resolveAnalyzerSource('social-preview', null), null);
  });

  test('returns null for unknown card id with empty outputs', () => {
    assert.equal(resolveAnalyzerSource('unknown-card', {}), null);
  });

  test('unmapped card falls through to direct key lookup', () => {
    const ag = agg();
    assert.equal(resolveAnalyzerSource('some-new-card', { 'some-new-card': { aggregate: ag } }), ag);
  });

  test('fallback aliases also support legacy flat skill output', () => {
    const flat = agg({ readiness: 'critical' });
    assert.equal(resolveAnalyzerSource('social-preview', { 'brand-tone': flat }), flat);
  });
});

// ── buildCardDescription — output shape ───────────────────────────────────────

describe('buildCardDescription — output shape', () => {
  test('returns null description when aggregate is null', () => {
    const r = buildCardDescription('seo-performance', null);
    assert.equal(r.description, null);
    assert.equal(r.dominantSignal, null);
  });

  test('returns status matching aggregate.readiness', () => {
    const r = buildCardDescription('seo-performance', agg({ readiness: 'critical' }));
    assert.equal(r.status, 'critical');
  });

  test('debug object contains cardId and selectedSignalId', () => {
    const r = buildCardDescription('seo-performance', agg({ readiness: 'healthy', highlights: ['Good title tags'] }));
    assert.equal(r.debug.cardId, 'seo-performance');
    assert.ok('selectedSignalId' in r.debug);
  });

  test('description is a non-empty string when signal found', () => {
    const r = buildCardDescription('seo-performance', agg({
      readiness: 'critical',
      findings:  [finding('critical', 'LCP too slow', 'Page takes 5s to load.')],
    }));
    assert.ok(typeof r.description === 'string' && r.description.length > 0);
  });
});

// ── seo-performance ───────────────────────────────────────────────────────────

describe('buildCardDescription — seo-performance', () => {
  test('critical finding → description includes the finding label', () => {
    const r = buildCardDescription('seo-performance', agg({
      readiness: 'critical',
      findings:  [finding('critical', 'LCP too slow', 'Page takes 5s to load.')],
    }));
    assert.match(r.description, /largest contentful paint is too slow/i);
    assert.equal(r.dominantSignal.type, 'issue');
    assert.ok(r.dominantSignal.id, 'signal id must be set');
  });

  test('critical finding description includes action CTA', () => {
    const r = buildCardDescription('seo-performance', agg({
      readiness: 'critical',
      findings:  [finding('critical', 'Missing meta description', '')],
    }));
    assert.match(r.description, /re-run the audit/i);
  });

  test('warning finding selected when no critical', () => {
    const r = buildCardDescription('seo-performance', agg({
      readiness: 'partial',
      findings:  [finding('warning', 'Meta description absent', '')],
    }));
    assert.equal(r.dominantSignal.type, 'issue');
    assert.match(r.description, /meta description/i);
  });

  test('strength selected when readiness is healthy', () => {
    const r = buildCardDescription('seo-performance', agg({
      readiness:  'healthy',
      highlights: ['Strong title tags across all pages'],
    }));
    assert.equal(r.dominantSignal.type, 'strength');
    assert.ok(r.description.includes('Strong title tags'));
    assert.ok(r.description.includes('No critical issues found'));
  });

  test('audit-failure gap is NOT selected as dominant signal', () => {
    const r = buildCardDescription('seo-performance', agg({
      readiness:  'partial',
      gaps:       [gap('psi-data-unavailable')],
      highlights: ['Good mobile score'],
    }));
    assert.notEqual(r.dominantSignal?.id, 'psi-data-unavailable');
    assert.equal(r.dominantSignal?.type, 'strength');
  });
});

// ── social-preview ────────────────────────────────────────────────────────────

describe('buildCardDescription — social-preview', () => {
  test('ogImage false → og-image-missing signal', () => {
    const r = buildCardDescription('social-preview', agg({ readiness: 'critical' }), { ogImage: false });
    assert.equal(r.dominantSignal.id, 'og-image-missing');
    assert.ok(r.description.includes('og:image') || r.description.includes('image'));
  });

  test('og-image-missing description mentions thumbnail/clicks impact', () => {
    const r = buildCardDescription('social-preview', agg({ readiness: 'critical' }), { ogImage: false });
    assert.ok(r.description.toLowerCase().includes('click') || r.description.toLowerCase().includes('thumbnail'));
  });

  test('missing ogTitle → og-meta-missing signal', () => {
    const r = buildCardDescription('social-preview', agg({ readiness: 'partial' }), {
      ogImage: true, ogTitle: null, ogDescription: 'Some desc',
    });
    assert.equal(r.dominantSignal.id, 'og-meta-missing');
    assert.ok(r.description.includes('title'));
  });

  test('missing ogDescription → og-meta-missing signal', () => {
    const r = buildCardDescription('social-preview', agg({ readiness: 'partial' }), {
      ogImage: true, ogTitle: 'My Site', ogDescription: null,
    });
    assert.equal(r.dominantSignal.id, 'og-meta-missing');
    assert.ok(r.description.includes('description'));
  });

  test('all meta present → social-complete strength signal', () => {
    const r = buildCardDescription('social-preview', agg({ readiness: 'healthy' }), {
      ogImage: true, ogTitle: 'My Site', ogDescription: 'Great site',
      canonical: 'https://example.com', favicon: true,
      siteName: 'My Site',
      ogImageAlt: 'Homepage preview',
      themeColor: '#ffffff',
    });
    assert.equal(r.dominantSignal.id, 'social-complete');
    assert.equal(r.dominantSignal.type, 'strength');
  });

  test('missing canonical falls back to og-surface-missing', () => {
    const r = buildCardDescription('social-preview', agg({ readiness: 'partial' }), {
      ogImage: true, ogTitle: 'My Site', ogDescription: 'Great',
      canonical: null, favicon: true,
    });
    assert.equal(r.dominantSignal.id, 'og-surface-missing');
  });

  test('secondary social metadata gaps produce a branded-surface warning', () => {
    const r = buildCardDescription('social-preview', agg({ readiness: 'partial' }), {
      ogImage: true,
      ogTitle: 'My Site',
      ogDescription: 'Great site',
      canonical: 'https://example.com',
      favicon: true,
      siteName: null,
      ogImageAlt: null,
      themeColor: '#ffffff',
    });
    assert.equal(r.dominantSignal.id, 'social-branding-thin');
    assert.match(r.description, /branded preview surface is still thin/i);
  });
});

// ── multi-device-view ─────────────────────────────────────────────────────────

describe('buildCardDescription — multi-device-view', () => {
  test('captureDone false → capture-failed signal', () => {
    const r = buildCardDescription('multi-device-view', agg({ readiness: 'critical' }), { captureDone: false });
    assert.equal(r.dominantSignal.id, 'capture-failed');
    assert.equal(r.dominantSignal.type, 'audit-state');
  });

  test('capture-failed description mentions retry', () => {
    const r = buildCardDescription('multi-device-view', agg({ readiness: 'critical' }), { captureDone: false });
    assert.ok(r.description.toLowerCase().includes('re-run') || r.description.toLowerCase().includes('retry'));
  });

  test('captureDone true + healthy → device-healthy strength', () => {
    const r = buildCardDescription('multi-device-view', agg({ readiness: 'healthy' }), {
      captureDone: true,
      screenshotCount: 3,
      variantCount: 3,
      hasDesktop: true,
      hasTablet: true,
      hasMobile: true,
    });
    assert.equal(r.dominantSignal.id, 'device-healthy');
    assert.equal(r.dominantSignal.type, 'strength');
  });

  test('partial screenshot coverage explains missing device evidence', () => {
    const r = buildCardDescription('multi-device-view', agg({ readiness: 'partial' }), {
      captureDone: true,
      screenshotCount: 2,
      variantCount: 3,
      hasDesktop: true,
      hasTablet: false,
      hasMobile: true,
      hasMockup: true,
    });
    assert.equal(r.dominantSignal.id, 'device-coverage-partial');
    assert.match(r.description, /2 of 3 device views/i);
  });

  test('mockup without underlying screenshots is treated as partial evidence', () => {
    const r = buildCardDescription('multi-device-view', agg({ readiness: 'partial' }), {
      captureDone: true,
      screenshotCount: 0,
      variantCount: 3,
      hasDesktop: false,
      hasTablet: false,
      hasMobile: false,
      hasMockup: true,
    });
    assert.equal(r.dominantSignal.id, 'mockup-only');
    assert.match(r.description, /detailed screen captures are still missing/i);
  });
});

// ── brief ─────────────────────────────────────────────────────────────────────

describe('buildCardDescription — brief', () => {
  test('hasBrief false → brief-thin issue signal', () => {
    const r = buildCardDescription('brief', agg({ readiness: 'critical' }), { hasBrief: false });
    assert.equal(r.dominantSignal.id, 'brief-thin');
    assert.ok(r.description.includes('onboarding') || r.description.includes('brief') || r.description.includes('thin'));
  });

  test('hasBrief false description mentions completing onboarding', () => {
    const r = buildCardDescription('brief', agg({ readiness: 'critical' }), { hasBrief: false });
    assert.ok(r.description.toLowerCase().includes('onboarding') || r.description.toLowerCase().includes('complete'));
  });

  test('hasBrief true + healthy → brief-strength signal', () => {
    const r = buildCardDescription('brief', agg({ readiness: 'healthy', highlights: ['Clear value proposition'] }), { hasBrief: true });
    assert.equal(r.dominantSignal.id, 'brief-strength');
    assert.equal(r.dominantSignal.type, 'strength');
  });
});

// ── business-model ────────────────────────────────────────────────────────────

describe('buildCardDescription — business-model', () => {
  test('hasModel false → model-unclear issue signal', () => {
    const r = buildCardDescription('business-model', agg({ readiness: 'critical' }), { hasModel: false });
    assert.equal(r.dominantSignal.id, 'model-unclear');
    assert.ok(r.description.toLowerCase().includes('model') || r.description.toLowerCase().includes('pricing'));
  });

  test('hasModel true with label → model-resolved strength signal', () => {
    const r = buildCardDescription('business-model', agg({ readiness: 'healthy' }), {
      hasModel: true, modelLabel: 'SaaS subscription',
    });
    assert.equal(r.dominantSignal.id, 'model-resolved');
    assert.ok(r.description.includes('SaaS subscription'));
  });
});

describe('buildCardDescription — style-guide', () => {
  test('missing core brand tokens → style-guide-thin issue signal', () => {
    const r = buildCardDescription('style-guide', agg({ readiness: 'critical' }), {
      headingFont: null,
      bodyFont: null,
      primaryColor: null,
      neutralColor: null,
    });
    assert.equal(r.dominantSignal.id, 'style-guide-thin');
    assert.match(r.description, /usable brand system did not come through/i);
  });

  test('style-guide copy sanitizes raw internal token ids', () => {
    const r = buildCardDescription('style-guide', agg({
      readiness: 'critical',
      findings: [{ id: 'style', severity: 'critical', label: 'Body system mismatch', detail: 'Body system assigns _Montserrat_06ab3 to an inconsistent body typeface.' }],
    }), {
      headingFont: null,
      bodyFont: null,
      primaryColor: null,
      neutralColor: null,
    });
    assert.doesNotMatch(r.description, /_Montserrat_06ab3/i);
    assert.match(r.description, /Montserrat/i);
  });

  test('partial token coverage → style-guide-partial issue signal', () => {
    const r = buildCardDescription('style-guide', agg({ readiness: 'partial' }), {
      headingFont: 'Geist',
      bodyFont: null,
      primaryColor: '#111111',
      neutralColor: null,
    });
    assert.equal(r.dominantSignal.id, 'style-guide-partial');
    assert.match(r.description, /2 of 4 core brand tokens/i);
  });

  test('complete token coverage → style-guide-ready strength signal', () => {
    const r = buildCardDescription('style-guide', agg({ readiness: 'healthy' }), {
      headingFont: 'Geist',
      bodyFont: 'Geist Sans',
      primaryColor: '#111111',
      neutralColor: '#f5f5f5',
    });
    assert.equal(r.dominantSignal.id, 'style-guide-ready');
    assert.match(r.description, /4 of 4 key areas/i);
  });
});

// ── industry ──────────────────────────────────────────────────────────────────

describe('buildCardDescription — industry', () => {
  test('hasCategory false → industry-unknown issue signal', () => {
    const r = buildCardDescription('industry', agg({ readiness: 'critical' }), { hasCategory: false });
    assert.equal(r.dominantSignal.id, 'industry-unknown');
    assert.ok(r.description.toLowerCase().includes('category') || r.description.toLowerCase().includes('vertical'));
  });

  test('category without audience or positioning → industry-thin issue signal', () => {
    const r = buildCardDescription('industry', agg({ readiness: 'partial' }), {
      hasCategory: true,
      categoryLabel: 'Legal Services',
      targetAudience: null,
      positioning: null,
    });
    assert.equal(r.dominantSignal.id, 'industry-thin');
    assert.match(r.description, /buyer or positioning context is still thin/i);
  });

  test('hasCategory true with label → industry-resolved strength signal', () => {
    const r = buildCardDescription('industry', agg({ readiness: 'healthy' }), {
      hasCategory: true,
      categoryLabel: 'Legal Services',
      targetAudience: 'small law firms',
      positioning: 'compliance-first intake platform',
    });
    assert.equal(r.dominantSignal.id, 'industry-resolved');
    assert.ok(r.description.includes('Legal Services'));
  });
});

describe('buildCardDescription — priority-signal', () => {
  test('missing next step → priority-missing issue signal', () => {
    const r = buildCardDescription('priority-signal', agg({ readiness: 'critical' }), {
      hasPriority: false,
      focusLabel: null,
      channelLabel: null,
    });
    assert.equal(r.dominantSignal.id, 'priority-missing');
    assert.match(r.description, /No validated next step/i);
  });

  test('next step without channel → partial priority-ready signal', () => {
    const r = buildCardDescription('priority-signal', agg({ readiness: 'partial' }), {
      hasPriority: true,
      focusLabel: 'Fix conversion CTA clarity',
      channelLabel: null,
    });
    assert.equal(r.dominantSignal.id, 'priority-ready');
    assert.equal(r.dominantSignal.readiness, 'partial');
    assert.match(r.description, /execution channel is still broad/i);
  });

  test('next step with channel → healthy priority-ready signal', () => {
    const r = buildCardDescription('priority-signal', agg({ readiness: 'healthy' }), {
      hasPriority: true,
      focusLabel: 'Fix conversion CTA clarity',
      channelLabel: 'landing page · email',
    });
    assert.equal(r.dominantSignal.id, 'priority-ready');
    assert.equal(r.dominantSignal.readiness, 'healthy');
    assert.match(r.description, /landing page · email/i);
  });
});

// ── visibility-snapshot ───────────────────────────────────────────────────────

describe('buildCardDescription — visibility-snapshot', () => {
  test('critical status + low score → visibility-low issue signal', () => {
    const r = buildCardDescription('visibility-snapshot', agg({ readiness: 'critical' }), { score: 22, letterGrade: 'F' });
    assert.equal(r.dominantSignal.id, 'visibility-low');
    assert.ok(r.description.includes('22'));
    assert.ok(r.description.includes('F'));
  });

  test('low score (<40) without critical status → visibility-low', () => {
    const r = buildCardDescription('visibility-snapshot', agg({ readiness: 'partial' }), { score: 35, letterGrade: 'D' });
    assert.equal(r.dominantSignal.id, 'visibility-low');
  });

  test('partial status + mid score → visibility-partial issue signal', () => {
    const r = buildCardDescription('visibility-snapshot', agg({ readiness: 'partial' }), { score: 55, letterGrade: 'C' });
    assert.equal(r.dominantSignal.id, 'visibility-partial');
    assert.ok(r.description.includes('55'));
  });

  test('healthy status + high score → visibility-strength signal', () => {
    const r = buildCardDescription('visibility-snapshot', agg({ readiness: 'healthy' }), { score: 82, letterGrade: 'B' });
    assert.equal(r.dominantSignal.id, 'visibility-strength');
    assert.equal(r.dominantSignal.type, 'strength');
    assert.ok(r.description.includes('82'));
  });
});

// ── renderDescription — sentence formatting ───────────────────────────────────

describe('renderDescription — sentence formatting', () => {
  test('description ends with a period', () => {
    const r = buildCardDescription('seo-performance', agg({
      readiness: 'critical',
      findings:  [finding('critical', 'LCP too slow', 'Page takes 5s.')],
    }));
    assert.ok(r.description.endsWith('.'));
  });

  test('null signal returns null description', () => {
    const r = buildCardDescription('unknown-card', agg({ readiness: 'healthy' }));
    assert.equal(r.description, null);
  });
});

// ── isAuditFailureGap alignment with scribe.js ───────────────────────────────

describe('isAuditFailureGap — pattern coverage', () => {
  const auditFailureIds = [
    'psi-data-unavailable', 'fetch-failed', 'synthesize-failed',
    'ai-seo-audit-failed', 'audit-incomplete', 'screenshot-failed', 'audit-timeout',
  ];

  for (const ruleId of auditFailureIds) {
    test(`'${ruleId}' is classified as an audit failure`, () => {
      assert.ok(isAuditFailureGap(ruleId));
    });
  }

  for (const ruleId of ['missing-meta', 'slow-lcp', 'no-canonical', 'og-image-absent']) {
    test(`'${ruleId}' is NOT classified as an audit failure`, () => {
      assert.ok(!isAuditFailureGap(ruleId));
    });
  }

  test('audit-failure gaps are not selected as dominant signal over real highlights', () => {
    for (const ruleId of auditFailureIds) {
      const r = buildCardDescription('seo-performance', agg({
        readiness:  'partial',
        gaps:       [gap(ruleId)],
        highlights: ['Something real'],
      }));
      assert.notEqual(r.dominantSignal?.id, ruleId);
      assert.equal(r.dominantSignal?.type, 'strength');
    }
  });
});
