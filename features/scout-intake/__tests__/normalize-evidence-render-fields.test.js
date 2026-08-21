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
