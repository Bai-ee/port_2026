'use strict';

// Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3): crawler
// parity — static (what a non-rendering crawler receives) vs rendered (what
// a human sees). Only ever computed when both raw HTMLs were in hand this
// run (a successful rendered-fallback); never persisted as raw HTML, only
// the derived diff.
//
// Same DI pattern as site-fetcher-rendered-fallback.test.js: safeFetch/
// validateUrl are swapped for in-memory fakes BEFORE site-fetcher.js is
// required, so its module-level `const { safeFetch, validateUrl }` bindings
// capture the fakes. node --test isolates this per-file.

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

const { fetchSiteEvidence, computeCrawlerParity } = require('../site-fetcher.js');

const HOME_URL = 'https://example.com/';
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
</head>
<body>
<nav><a href="/work">Work</a><a href="/team">Team</a></nav>
<h1>Brand and web design for ambitious founders</h1>
<h2>Full-service creative studio</h2>
<p>Acme Studio has been building brands, websites, and campaigns for growth-stage companies since 2016, with a small senior team that ships fast and communicates clearly at every step of the engagement.</p>
<p>We pair strategy with craft: every project starts with a positioning workshop, moves through a tight design sprint, and ends with a fully built, production-ready site handed off with documentation.</p>
<a class="btn" href="/contact">Book a call</a>
</body>
</html>`;

test('SPA-with-fallback fixture: crawlerParity is present and correctly diffs static vs rendered', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  const fetchRendered = async () => ({ ok: true, html: RENDERED_HOME_HTML, bytes: RENDERED_HOME_HTML.length, durationMs: 5 });

  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered, fetchImage: noOgImageFetch });
  const home = evidence.pages[0];

  assert.equal(home.renderMode, 'rendered-fallback');
  assert.ok(home.crawlerParity, 'a successful rendered-fallback page must carry crawlerParity');

  const cp = home.crawlerParity;
  assert.equal(cp.title.static, 'MyApp');
  assert.equal(cp.title.rendered, 'MyApp — Track Your Habits');
  assert.equal(cp.title.match, false);

  assert.equal(cp.metaDescription.static, '');
  assert.equal(cp.metaDescription.rendered, 'MyApp helps you build better habits every day.');
  assert.equal(cp.metaDescription.match, false);

  assert.deepEqual(cp.socialMetaTags.static, []);
  assert.deepEqual(cp.socialMetaTags.rendered, ['og:description', 'og:title']);
  assert.equal(cp.socialMetaTags.match, false);

  assert.deepEqual(cp.h1.static, []);
  assert.deepEqual(cp.h1.rendered, ['Build habits that stick']);
  assert.equal(cp.h1.match, false);

  // "Pricing" also qualifies (conversion-shaped href /pricing), ranked below
  // "Get Started" (word + btn-class match) — see extractCtaTexts' rank order.
  assert.deepEqual(cp.ctaTexts.static, []);
  assert.deepEqual(cp.ctaTexts.rendered, ['Get Started', 'Pricing']);
  assert.equal(cp.ctaTexts.match, false);

  assert.equal(cp.bodyWordCount.static, 0);
  assert.ok(cp.bodyWordCount.rendered > 0);
  assert.equal(cp.bodyWordCount.match, false);
});

test('static-rich fixture: crawlerParity is null (nothing to diff against — never rendered)', async () => {
  responses = { [HOME_URL]: { html: RICH_STATIC_HOME_HTML } };
  const fetchRendered = async () => { throw new Error('must never be called for a rich static site'); };

  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered, fetchImage: noOgImageFetch });
  const home = evidence.pages[0];

  assert.equal(home.renderMode, 'static');
  assert.equal(home.crawlerParity, null, 'a page never rendered has no second view to diff against');
});

test('render attempted but failed: crawlerParity stays null (only one view exists)', async () => {
  responses = { [HOME_URL]: { html: SPA_SHELL_HTML } };
  const fetchRendered = async () => ({ ok: false, reason: 'browserless_disabled' });

  const evidence = await fetchSiteEvidence(HOME_URL, { fetchRendered, fetchImage: noOgImageFetch });
  const home = evidence.pages[0];

  assert.equal(home.renderMode, 'static');
  assert.equal(home.renderFailed, 'browserless_disabled');
  assert.equal(home.crawlerParity, null);
});

test('computeCrawlerParity (pure): matching fields report match:true', () => {
  const same = { title: 'Same Title', metaDescription: 'Same desc', h1: ['H1'], ctaTexts: ['Go'], bodyParagraphs: ['one two three'] };
  const html = '<meta property="og:title" content="x">';
  const cp = computeCrawlerParity(same, html, same, html);
  assert.equal(cp.title.match, true);
  assert.equal(cp.metaDescription.match, true);
  assert.equal(cp.h1.match, true);
  assert.equal(cp.ctaTexts.match, true);
  assert.equal(cp.bodyWordCount.match, true);
  assert.equal(cp.socialMetaTags.match, true);
});

test('computeCrawlerParity (pure): social meta tag SET comparison ignores order', () => {
  const evidence = { title: '', metaDescription: '', h1: [], ctaTexts: [], bodyParagraphs: [] };
  const htmlA = '<meta property="og:title" content="a"><meta property="og:description" content="b">';
  const htmlB = '<meta property="og:description" content="b2"><meta property="og:title" content="a2">';
  const cp = computeCrawlerParity(evidence, htmlA, evidence, htmlB);
  assert.equal(cp.socialMetaTags.match, true, 'same tag NAMES present regardless of order or value');
});
