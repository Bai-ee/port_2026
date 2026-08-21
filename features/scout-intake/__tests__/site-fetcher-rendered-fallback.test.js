'use strict';

// Phase 1 rendered fallback (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md):
// a client-rendered site used to be read as static HTML and reported as an
// empty "black box". site-fetcher.js now detects a thin/SPA-shell page and
// retries it via a Browserless rendered fetch, keeping the static read
// alongside the rendered one so nothing that a crawler sees is discarded.
//
// No real network/DNS/Firestore calls: safeFetch + validateUrl are swapped
// for in-memory fakes (site-fetcher.js destructures them at require time, so
// the swap below — done BEFORE requiring site-fetcher.js — is captured by its
// module-level const bindings; `node --test` runs each test file in its own
// process, so this never leaks into other test files), and the Browserless
// render itself is always the `fetchRendered` DI seam site-fetcher.js exposes
// for exactly this purpose — the real `api/_lib/browserless.cjs` client is
// never invoked.

const test = require('node:test');
const assert = require('node:assert/strict');

const safeFetchLib = require('../../../api/_lib/safe-fetch.cjs');
const originalSafeFetch = safeFetchLib.safeFetch;
const originalValidateUrl = safeFetchLib.validateUrl;

let responses = {};
safeFetchLib.validateUrl = async () => {};
safeFetchLib.safeFetch = async (url) => {
  const r = responses[url];
  if (!r) return new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(r.html, { status: r.status || 200, headers: { 'content-type': 'text/html' } });
};

test.after(() => {
  safeFetchLib.safeFetch = originalSafeFetch;
  safeFetchLib.validateUrl = originalValidateUrl;
});

// Required AFTER the monkeypatch above so site-fetcher.js's top-level
// `const { safeFetch, validateUrl: _ssrfValidate } = require(...)` captures
// the fakes.
const {
  fetchSiteEvidence,
  looksLikeSpaShell,
  isPageThin,
  attemptRenderedFallback,
  MAX_RENDERED_FETCHES_PER_RUN,
} = require('../site-fetcher.js');

const HOME_URL = 'https://example.com/';

// Phase 2 added an og:image artifact inspection (site-fetcher.js `fetchImage`
// DI seam) that runs whenever siteMeta.ogImage resolves — every fixture below
// sets an og:image, so every fetchSiteEvidence() call here must mock it. This
// file's own tests are about the Phase 1 rendered-fallback behavior, not
// og-image inspection, so the mock always reports "skipped" and never touches
// the network.
const noOgImageFetch = async () => ({ ok: false, reason: 'not_mocked_in_this_test' });

const SPA_SHELL_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>MyApp</title></head>
<body>
<div id="root"></div>
<script src="/static/js/main.abc123.js"></script>
</body>
</html>`;

const RENDERED_HOME_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MyApp — Track Your Habits</title>
<meta name="description" content="MyApp helps you build better habits every day.">
<meta property="og:title" content="MyApp — Build Better Habits">
<meta property="og:description" content="The habit tracker that actually works.">
<meta property="og:image" content="https://myapp.example/og.png">
</head>
<body>
<nav><a href="/pricing">Pricing</a><a href="/about">About</a></nav>
<h1>Build habits that stick</h1>
<h2>Track daily progress</h2>
<p>MyApp helps thousands of people build lasting habits through daily tracking, reminders, and streaks that keep you motivated every single day of the week, no matter how busy things get at work or at home.</p>
<a class="btn" href="/signup">Get Started</a>
</body>
</html>`;

const RICH_STATIC_HOME_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Acme Studio — Brand & Web Design</title>
<meta name="description" content="Acme Studio designs brands and websites for ambitious founders.">
<meta property="og:title" content="Acme Studio">
<meta property="og:description" content="Brand and web design for ambitious founders.">
<meta property="og:image" content="https://acmestudio.example/og.png">
</head>
<body>
<nav><a href="/work">Work</a><a href="/team">Team</a></nav>
<h1>Brand and web design for ambitious founders</h1>
<h2>Full-service creative studio</h2>
<p>Acme Studio has been building brands, websites, and campaigns for growth-stage companies since 2016, with a small senior team that ships fast and communicates clearly at every step of the engagement.</p>
<p>We pair strategy with craft: every project starts with a positioning workshop, moves through a tight design sprint, and ends with a fully built, production-ready site handed off with documentation.</p>
<a class="btn" href="/contact">Book a call</a>
<a href="https://twitter.com/acmestudio">Twitter</a>
</body>
</html>`;

test('SPA shell homepage: rendered fallback fires, evidence populated, top-level thin becomes false', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  let calls = 0;
  const fetchRendered = async ({ url, variant }) => {
    calls += 1;
    assert.equal(url, HOME_URL);
    assert.equal(variant?.id, 'scout-intake-site-fetch');
    return { ok: true, html: RENDERED_HOME_HTML, bytes: RENDERED_HOME_HTML.length, durationMs: 42 };
  };

  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered, fetchImage: noOgImageFetch });

  assert.equal(calls, 1, 'Browserless render must be attempted exactly once for the homepage');
  assert.equal(evidence.thin, false, 'rendered content clears the thin flag');
  assert.equal(evidence.pages.length, 1);

  const home = evidence.pages[0];
  assert.equal(home.renderMode, 'rendered-fallback');
  assert.equal(home.renderedVia, 'browserless');
  assert.equal(home.renderFailed, undefined);
  assert.deepEqual(home.h1, ['Build habits that stick']);
  assert.ok(home.bodyParagraphs.length > 0, 'rendered body copy must be captured');
  assert.equal(home.title, 'MyApp — Track Your Habits', 'top-level title reflects the RENDERED <title> tag');

  // Fixed the all-✗ social checklist: siteMeta now reads from the rendered DOM.
  assert.equal(home.siteMeta.title, 'MyApp — Build Better Habits');
  assert.equal(home.siteMeta.description, 'The habit tracker that actually works.');
  assert.equal(home.siteMeta.ogImage, 'https://myapp.example/og.png');

  // Static read preserved, not discarded.
  assert.ok(home.staticView, 'staticView must be preserved when a render replaces primary fields');
  assert.equal(home.staticView.title, 'MyApp');
  assert.deepEqual(home.staticView.h1, []);
  assert.equal(home.staticView.siteMeta.title, 'MyApp', 'static siteMeta falls back to the <title> tag — no og tags in the shell');

  assert.ok(
    evidence.warnings.some((w) => /JS-rendered/.test(w) && /Browserless rendered fallback succeeded/.test(w)),
    `expected a rendered-fallback-succeeded warning, got: ${JSON.stringify(evidence.warnings)}`
  );
});

test('Browserless unavailable: honest degrade — thin stays true, renderFailed named, no crash', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  const fetchRendered = async () => ({ ok: false, reason: 'browserless_disabled', durationMs: 0 });

  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered, fetchImage: noOgImageFetch });

  assert.equal(evidence.thin, true, 'a failed render must not fake non-thin content');
  const home = evidence.pages[0];
  assert.equal(home.renderMode, 'static');
  assert.equal(home.renderFailed, 'browserless_disabled');
  assert.equal(home.renderedVia, undefined);
  assert.equal(home.title, 'MyApp', 'static extraction is untouched when the render fails');
  assert.ok(
    evidence.warnings.some((w) => /Browserless render did not succeed/.test(w)),
    `expected a render-failed warning, got: ${JSON.stringify(evidence.warnings)}`
  );
  assert.ok(
    evidence.warnings.some((w) => /Very little static content detected/.test(w)),
    'the original thin-content warning must still fire — this is a genuine degrade, not a silent one'
  );
});

test('static-rich site: no Browserless call, evidence matches the static extraction exactly', async () => {
  responses = { [HOME_URL]: { html: RICH_STATIC_HOME_HTML } };
  let calls = 0;
  const fetchRendered = async () => { calls += 1; throw new Error('must never be called for a rich static site'); };

  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered, fetchImage: noOgImageFetch });

  assert.equal(calls, 0, 'a rich static homepage must never trigger a rendered fallback');
  assert.equal(evidence.thin, false);

  const home = evidence.pages[0];
  assert.equal(home.renderMode, 'static');
  assert.equal(home.renderFailed, undefined);
  assert.equal(home.renderedVia, undefined);
  assert.equal(home.staticView, undefined, 'no staticView is stored when nothing was rendered');
  assert.equal(home.title, 'Acme Studio — Brand & Web Design');
  assert.deepEqual(home.h1, ['Brand and web design for ambitious founders']);
  assert.deepEqual(home.h2, ['Full-service creative studio']);
  assert.equal(home.bodyParagraphs.length, 2);
  assert.deepEqual(home.ctaTexts, ['Book a call']);
  assert.deepEqual(home.socialLinks, ['https://twitter.com/acmestudio']);
  assert.equal(home.siteMeta.title, 'Acme Studio');
  assert.equal(home.siteMeta.ogImage, 'https://acmestudio.example/og.png');
});

test('per-run render cap: the 5th candidate page is denied without ever calling fetchRendered', async () => {
  let calls = 0;
  const fetchRendered = async () => {
    calls += 1;
    return { ok: true, html: RENDERED_HOME_HTML, bytes: RENDERED_HOME_HTML.length, durationMs: 1 };
  };
  const renderBudget = { remaining: MAX_RENDERED_FETCHES_PER_RUN };
  const warnings = [];

  const makeThinPage = (n) => ({
    url: `https://example.com/page-${n}`,
    type: `page-${n}`,
    title: '', metaDescription: '', h1: [], h2: [], navLabels: [], ctaTexts: [],
    bodyParagraphs: [], socialLinks: [], contactClues: [],
  });

  const results = [];
  for (let i = 0; i < 5; i += 1) {
    const pageEvidence = makeThinPage(i);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await attemptRenderedFallback({
      pageEvidence,
      rawHtml: SPA_SHELL_HTML,
      url: pageEvidence.url,
      type: pageEvidence.type,
      renderBudget,
      fetchRendered,
      warnings,
    });
    results.push(outcome);
  }

  assert.equal(calls, MAX_RENDERED_FETCHES_PER_RUN, `expected exactly ${MAX_RENDERED_FETCHES_PER_RUN} Browserless calls, got ${calls}`);
  for (let i = 0; i < MAX_RENDERED_FETCHES_PER_RUN; i += 1) {
    assert.equal(results[i].renderMode, 'rendered-fallback', `page ${i} should have rendered within budget`);
  }
  const denied = results[MAX_RENDERED_FETCHES_PER_RUN];
  assert.equal(denied.renderMode, 'static');
  assert.equal(denied.renderFailed, 'render_cap_reached');
  assert.ok(warnings.some((w) => /rendered-fetch cap.*already reached/.test(w)), `expected a cap-reached warning, got: ${JSON.stringify(warnings)}`);
});

const RICH_HOME_WITH_PRICING_LINK_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Acme Studio</title></head>
<body>
<nav><a href="/pricing">Pricing</a></nav>
<h1>Brand and web design for ambitious founders</h1>
<h2>Full-service creative studio</h2>
<p>Acme Studio has been building brands, websites, and campaigns for growth-stage companies since 2016, with a small senior team that ships fast and communicates clearly at every step of the engagement.</p>
</body>
</html>`;

test('additional pages: only the thin discovered page renders, the rich homepage never does', async () => {
  const pricingUrl = 'https://example.com/pricing';
  responses = {
    [HOME_URL]: { html: RICH_HOME_WITH_PRICING_LINK_HTML },
    [pricingUrl]: { html: SPA_SHELL_HTML },
  };
  const calledUrls = [];
  const fetchRendered = async ({ url }) => {
    calledUrls.push(url);
    return { ok: true, html: RENDERED_HOME_HTML, bytes: RENDERED_HOME_HTML.length, durationMs: 1 };
  };

  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered, fetchImage: noOgImageFetch });

  assert.deepEqual(calledUrls, [pricingUrl], 'only the thin pricing page should trigger a render — the rich homepage must not');
  const home = evidence.pages.find((p) => p.type === 'homepage');
  const pricing = evidence.pages.find((p) => p.type === 'pricing');
  assert.equal(home.renderMode, 'static');
  assert.ok(pricing, 'the discovered pricing page must be present');
  assert.equal(pricing.renderMode, 'rendered-fallback');
});

// ── Pure decision helpers ───────────────────────────────────────────────────

test('looksLikeSpaShell: empty hydration root under 10KB is a shell; a populated root or a large doc is not', () => {
  assert.equal(looksLikeSpaShell(SPA_SHELL_HTML), true);
  assert.equal(looksLikeSpaShell('<div id="root"><h1>Real content</h1></div>'), false);
  assert.equal(looksLikeSpaShell(null), false);
  assert.equal(looksLikeSpaShell(''), false);
  const bigShell = `<div id="root"></div>${'x'.repeat(11 * 1024)}`;
  assert.equal(looksLikeSpaShell(bigShell), false, 'a document over the byte cap is not treated as a shell');
});

test('isPageThin: mirrors the THIN_CONTENT_THRESHOLD measure used for the run-level flag', () => {
  assert.equal(isPageThin({ h1: [], h2: [], bodyParagraphs: [] }), true);
  assert.equal(isPageThin({ h1: ['x'.repeat(250)], h2: [], bodyParagraphs: [] }), false);
});
