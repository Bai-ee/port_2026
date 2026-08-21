'use strict';

// Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3): the
// coverage manifest — L4/L5 made durable. Every planned check recorded as
// ran/skipped/failed(+reason) on evidence.coverage, so Phase 3's coverage
// manifest section always has an honest input, and nothing this run could
// not see is silently absent.

const test = require('node:test');
const assert = require('node:assert/strict');

const safeFetchLib = require('../../../api/_lib/safe-fetch.cjs');
const originalSafeFetch = safeFetchLib.safeFetch;
const originalValidateUrl = safeFetchLib.validateUrl;

let responses = {};
let blockUrl = false;
safeFetchLib.validateUrl = async () => {
  if (blockUrl) throw new Error('SSRF_BLOCKED: test');
};
safeFetchLib.safeFetch = async (url) => {
  const r = responses[url];
  if (!r) return new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(r.html, { status: r.status || 200, headers: { 'content-type': 'text/html' } });
};

test.after(() => {
  safeFetchLib.safeFetch = originalSafeFetch;
  safeFetchLib.validateUrl = originalValidateUrl;
});

const { fetchSiteEvidence } = require('../site-fetcher.js');

const HOME_URL = 'https://example.com/';
const noOgImageFetch = async () => ({ ok: false, reason: 'not_mocked_in_this_test' });

const SPA_SHELL_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>MyApp</title></head>
<body><div id="root"></div></body></html>`;

const RENDERED_HOME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>MyApp — Track Your Habits</title>
<meta property="og:image" content="https://myapp.example/og.png"></head>
<body><h1>Build habits that stick</h1>
<p>MyApp helps thousands of people build lasting habits through daily tracking and reminders that keep you motivated every single day of the week.</p>
</body></html>`;

const RICH_STATIC_HOME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Acme Studio</title></head>
<body>
<h1>Brand and web design for ambitious founders</h1>
<p>Acme Studio has been building brands, websites, and campaigns for growth-stage companies since 2016, with a small senior team that ships fast and communicates clearly.</p>
</body></html>`;

test('signup-narrow shape: no overrides passed — robotsSitemapProbe + screenshots default to skipped', async () => {
  responses = { [HOME_URL]: { html: RICH_STATIC_HOME_HTML } };
  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered: async () => ({ ok: false }), fetchImage: noOgImageFetch });

  assert.equal(evidence.coverage.pageCrawl.status, 'ran');
  assert.equal(evidence.coverage.renderedFallback.status, 'skipped');
  assert.equal(evidence.coverage.metaExtraction.status, 'ran');
  assert.equal(evidence.coverage.jsonLd.status, 'ran');
  assert.equal(evidence.coverage.ogImageInspection.status, 'skipped');
  assert.equal(evidence.coverage.ogImageInspection.reason, 'no_og_image');
  assert.equal(evidence.coverage.robotsSitemapProbe.status, 'skipped');
  assert.ok(/agent-readiness/.test(evidence.coverage.robotsSitemapProbe.reason));
  assert.equal(evidence.coverage.screenshots.status, 'skipped');
  assert.ok(/parallel task/.test(evidence.coverage.screenshots.reason));
});

test('full-crawl shape: caller-supplied coverageOverrides for robotsSitemapProbe + screenshots are honored', async () => {
  responses = { [HOME_URL]: { html: RICH_STATIC_HOME_HTML } };
  const evidence = await fetchSiteEvidence(HOME_URL, {
    fetchRendered: async () => ({ ok: false }),
    fetchImage: noOgImageFetch,
    coverageOverrides: {
      robotsSitemapProbe: { status: 'ran', reason: null },
      screenshots: { status: 'failed', reason: 'browserless_unavailable' },
    },
  });

  assert.equal(evidence.coverage.robotsSitemapProbe.status, 'ran');
  assert.equal(evidence.coverage.robotsSitemapProbe.reason, null);
  assert.equal(evidence.coverage.screenshots.status, 'failed');
  assert.equal(evidence.coverage.screenshots.reason, 'browserless_unavailable');
});

test('pageCrawl failed: SSRF-blocked URL — everything downstream reads skipped, coverage never throws', async () => {
  blockUrl = true;
  try {
    const evidence = await fetchSiteEvidence('https://blocked.example.com/', { fetchImage: noOgImageFetch });
    assert.equal(evidence.coverage.pageCrawl.status, 'failed');
    assert.equal(evidence.coverage.renderedFallback.status, 'skipped');
    assert.equal(evidence.coverage.metaExtraction.status, 'skipped');
    assert.equal(evidence.coverage.jsonLd.status, 'skipped');
    assert.equal(evidence.coverage.ogImageInspection.status, 'skipped');
  } finally {
    blockUrl = false;
  }
});

test('pageCrawl failed: homepage fetch 404s — coverage.pageCrawl is failed with a reason, rest skipped', async () => {
  responses = {}; // no matching response → safeFetch fake returns 404
  const evidence = await fetchSiteEvidence(HOME_URL, { fetchImage: noOgImageFetch });
  assert.equal(evidence.coverage.pageCrawl.status, 'failed');
  assert.ok(evidence.coverage.pageCrawl.reason, 'a failure reason must be recorded');
  assert.equal(evidence.coverage.ogImageInspection.status, 'skipped');
});

test('renderedFallback ran: a successful render is reflected as ran', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  const evidence = await fetchSiteEvidence(HOME_URL, {
    fetchRendered: async () => ({ ok: true, html: RENDERED_HOME_HTML, bytes: RENDERED_HOME_HTML.length }),
    fetchImage: noOgImageFetch,
  });
  assert.equal(evidence.coverage.renderedFallback.status, 'ran');
  assert.equal(evidence.coverage.renderedFallback.reason, null);
});

test('renderedFallback failed: a render was needed and attempted but never succeeded', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  const evidence = await fetchSiteEvidence(HOME_URL, {
    fetchRendered: async () => ({ ok: false, reason: 'browserless_disabled' }),
    fetchImage: noOgImageFetch,
  });
  assert.equal(evidence.coverage.renderedFallback.status, 'failed');
  assert.ok(/browserless_disabled/.test(evidence.coverage.renderedFallback.reason));
});

test('ogImageInspection ran: a real og:image resolves and gets inspected', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  const fetchImage = async () => ({ ok: true, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' });
  const evidence = await fetchSiteEvidence(HOME_URL, {
    fetchRendered: async () => ({ ok: true, html: RENDERED_HOME_HTML, bytes: RENDERED_HOME_HTML.length }),
    fetchImage,
  });
  // Undecodable 4-byte buffer still counts as 'ran' (bytes/contentType recorded).
  assert.equal(evidence.coverage.ogImageInspection.status, 'ran');
  const home = evidence.pages.find((p) => p.type === 'homepage');
  assert.ok(home.siteMeta.ogImageArtifact, 'ogImageArtifact must be attached to the winning siteMeta');
  assert.equal(home.siteMeta.ogImageArtifact.contentType, 'image/png');
});

test('ogImageInspection failed: og:image resolves but the fetch fails', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  const fetchImage = async () => ({ ok: false, reason: 'timeout' });
  const evidence = await fetchSiteEvidence(HOME_URL, {
    fetchRendered: async () => ({ ok: true, html: RENDERED_HOME_HTML, bytes: RENDERED_HOME_HTML.length }),
    fetchImage,
  });
  assert.equal(evidence.coverage.ogImageInspection.status, 'failed');
  assert.equal(evidence.coverage.ogImageInspection.reason, 'timeout');
  const home = evidence.pages.find((p) => p.type === 'homepage');
  assert.equal(home.siteMeta.ogImageArtifact, undefined, 'no artifact recorded when the inspection failed');
});
