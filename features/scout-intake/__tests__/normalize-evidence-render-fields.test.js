'use strict';

// Phase 1 rendered fallback (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md):
// summarizeEvidencePages() is the boundary that trims fetchSiteEvidence()
// output for Firestore. Its per-page whitelist used to silently drop any
// field not explicitly listed — so the new renderMode/renderedVia/
// renderFailed/staticView flags site-fetcher.js now sets would have been lost
// on write without this extension. Existing fields must stay byte-identical.

const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeEvidencePages } = require('../normalize');

const BASE_PAGE = {
  url: 'https://example.com/',
  type: 'homepage',
  title: 'Example',
  h1: ['Hello'],
  h2: [],
  navLabels: ['Home'],
  ctaTexts: ['Sign up'],
  bodyParagraphs: ['Some real body copy here.'],
  socialLinks: ['https://x.com/example'],
  contactClues: [],
};

test('a page with no render fields defaults to renderMode "static" and null render fields', () => {
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: false, pages: [BASE_PAGE] });
  const page = out.pages[0];
  assert.equal(page.renderMode, 'static');
  assert.equal(page.renderedVia, null);
  assert.equal(page.renderFailed, null);
  assert.equal(page.staticView, null);
  // Existing fields are untouched.
  assert.equal(page.title, 'Example');
  assert.deepEqual(page.h1, ['Hello']);
  assert.deepEqual(page.ctaTexts, ['Sign up']);
});

test('renderFailed is carried through for a static page where a render was attempted and did not help', () => {
  const page = { ...BASE_PAGE, renderMode: 'static', renderFailed: 'browserless_disabled' };
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: true, pages: [page] });
  assert.equal(out.pages[0].renderMode, 'static');
  assert.equal(out.pages[0].renderFailed, 'browserless_disabled');
});

test('a rendered-fallback page carries renderedVia and a trimmed staticView (siteMeta included, no raw HTML)', () => {
  const page = {
    ...BASE_PAGE,
    title: 'Example — Rendered Title',
    h1: ['Rendered H1'],
    siteMeta: { title: 'Rendered OG Title', description: 'Rendered description' },
    renderMode: 'rendered-fallback',
    renderedVia: 'browserless',
    staticView: {
      title: 'Example',
      h1: [],
      h2: [],
      navLabels: [],
      ctaTexts: [],
      bodyParagraphs: [],
      socialLinks: [],
      contactClues: [],
      siteMeta: { title: 'Example' },
      _rawHtml: '<html>should never survive summarization</html>',
    },
  };
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: false, pages: [page] });
  const summarized = out.pages[0];

  assert.equal(summarized.renderMode, 'rendered-fallback');
  assert.equal(summarized.renderedVia, 'browserless');
  assert.equal(summarized.renderFailed, null);
  // Primary fields reflect the RENDERED read.
  assert.equal(summarized.title, 'Example — Rendered Title');
  assert.deepEqual(summarized.h1, ['Rendered H1']);

  assert.ok(summarized.staticView, 'staticView must survive summarization');
  assert.equal(summarized.staticView.title, 'Example');
  assert.equal(summarized.staticView.siteMeta.title, 'Example');
  assert.equal(summarized.staticView._rawHtml, undefined, 'raw HTML must never be persisted, including inside staticView');
});

test('a page with no evidence.pages still returns null (unchanged behavior)', () => {
  assert.equal(summarizeEvidencePages(null), null);
  assert.equal(summarizeEvidencePages({ pages: [] }), null);
});

// ── Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3) ──────────

test('jsonLdTypes and crawlerParity pass through summarization on a rendered-fallback page', () => {
  const page = {
    ...BASE_PAGE,
    jsonLdTypes: ['Organization', 'WebSite'],
    renderMode: 'rendered-fallback',
    renderedVia: 'browserless',
    crawlerParity: {
      title: { static: 'Example', rendered: 'Example — Rendered', match: false },
      metaDescription: { static: '', rendered: 'A rendered description', match: false },
      socialMetaTags: { static: [], rendered: ['og:title'], match: false },
      h1: { static: [], rendered: ['Hello'], match: false },
      ctaTexts: { static: [], rendered: ['Sign up'], match: false },
      bodyWordCount: { static: 0, rendered: 12, match: false },
    },
  };
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: false, pages: [page] });
  const summarized = out.pages[0];

  assert.deepEqual(summarized.jsonLdTypes, ['Organization', 'WebSite']);
  assert.ok(summarized.crawlerParity, 'crawlerParity must survive summarization');
  assert.equal(summarized.crawlerParity.title.static, 'Example');
  assert.equal(summarized.crawlerParity.title.rendered, 'Example — Rendered');
  assert.equal(summarized.crawlerParity.bodyWordCount.rendered, 12);
});

test('a page with no jsonLdTypes/crawlerParity defaults to [] and null (unchanged-behavior page)', () => {
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: false, pages: [BASE_PAGE] });
  const page = out.pages[0];
  assert.deepEqual(page.jsonLdTypes, []);
  assert.equal(page.crawlerParity, null);
});

test('a page never rendered (renderMode static, no renderFailed) carries crawlerParity: null through summarization', () => {
  const page = { ...BASE_PAGE, renderMode: 'static', crawlerParity: null };
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: false, pages: [page] });
  assert.equal(out.pages[0].crawlerParity, null);
});

test('the run-level coverage manifest passes through summarization, whitelisted to known keys', () => {
  const evidence = {
    url: 'https://example.com/',
    fetchedAt: 't',
    thin: false,
    pages: [BASE_PAGE],
    coverage: {
      pageCrawl: { status: 'ran', reason: null },
      renderedFallback: { status: 'skipped', reason: 'no page required a rendered fallback' },
      metaExtraction: { status: 'ran', reason: null },
      jsonLd: { status: 'ran', reason: null },
      ogImageInspection: { status: 'skipped', reason: 'no_og_image' },
      robotsSitemapProbe: { status: 'skipped', reason: 'runs as a separate agent-readiness module' },
      screenshots: { status: 'skipped', reason: 'screenshot capture runs as a separate parallel task' },
      unexpectedExtraKey: { status: 'ran', reason: null }, // must be dropped, not a known coverage key
    },
  };
  const out = summarizeEvidencePages(evidence);
  assert.ok(out.coverage);
  assert.equal(out.coverage.pageCrawl.status, 'ran');
  assert.equal(out.coverage.renderedFallback.status, 'skipped');
  assert.equal(out.coverage.ogImageInspection.reason, 'no_og_image');
  assert.equal(out.coverage.unexpectedExtraKey, undefined, 'unknown coverage keys must not be persisted');
});

test('evidence with no coverage object (pre-Phase-2 shape) summarizes with coverage: null', () => {
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: false, pages: [BASE_PAGE] });
  assert.equal(out.coverage, null);
});

test('raw HTML is still never persisted anywhere, including alongside the new Phase 2 fields', () => {
  const page = {
    ...BASE_PAGE,
    jsonLdTypes: ['Organization'],
    _rawHtml: '<html>top-level raw html must never survive</html>',
    renderMode: 'rendered-fallback',
    renderedVia: 'browserless',
    crawlerParity: {
      title: { static: 'a', rendered: 'b', match: false },
      metaDescription: { static: '', rendered: '', match: true },
      socialMetaTags: { static: [], rendered: [], match: true },
      h1: { static: [], rendered: [], match: true },
      ctaTexts: { static: [], rendered: [], match: true },
      bodyWordCount: { static: 0, rendered: 0, match: true },
    },
    staticView: {
      title: 'Example',
      h1: [], h2: [], navLabels: [], ctaTexts: [], bodyParagraphs: [], socialLinks: [], contactClues: [],
      jsonLdTypes: ['Organization'],
      _rawHtml: '<html>static view raw html must never survive either</html>',
    },
  };
  const out = summarizeEvidencePages({ url: 'https://example.com/', fetchedAt: 't', thin: false, pages: [page] });
  const summarized = JSON.stringify(out);
  assert.ok(!summarized.includes('_rawHtml'), 'the literal key _rawHtml must never appear in summarized output');
  assert.ok(!summarized.includes('must never survive'), 'no raw HTML content must leak through, at any nesting level');
});
