'use strict';

// extractCtaTexts — the old keyword-whitelist gate captured only generic
// marketing verbs, so product-specific primary CTAs ("Mine", "Play Game",
// "Connect Wallet") were dropped and a footer newsletter "Subscribe" was
// reported as the site's only CTA.

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractCtaTexts } = require('../site-fetcher.js');

test('captures product-specific CTAs the keyword whitelist missed', () => {
  const html = `
    <a role="button" aria-label="Mine - enter the Lucky Pick mine" class="hero"><h1>MINE</h1></a>
    <button class="wallet">Connect Wallet</button>
    <a href="/stake" class="btn">Stake now</a>
  `;
  const ctas = extractCtaTexts(html);
  assert.ok(ctas.includes('Connect Wallet'), `expected Connect Wallet in ${JSON.stringify(ctas)}`);
  assert.ok(ctas.includes('Stake now'), `expected Stake now in ${JSON.stringify(ctas)}`);
  assert.ok(ctas.includes('MINE'), `expected MINE in ${JSON.stringify(ctas)}`);
});

test('falls back to aria-label when the anchor wraps a whole hero block', () => {
  const html = `
    <a role="button" aria-label="Play Game - enter Valdara" class="tile">
      <h1>PLAY GAME</h1>
      <p>GATHER. CRAFT. BUILD YOUR TOWN. BATTLE MONSTERS. RAID RIVALS. AND MUCH MORE BEYOND.</p>
    </a>
  `;
  assert.deepEqual(extractCtaTexts(html), ['Play Game - enter Valdara']);
});

test('keeps icon-only conversion links via aria-label', () => {
  const html = '<a href="/pre-mine" aria-label="Join the Pre-Mine"><img alt="button"></a>';
  assert.deepEqual(extractCtaTexts(html), ['Join the Pre-Mine']);
});

test('ranks CTA wording + CTA markup ahead of markup alone', () => {
  const html = `
    <a class="btn">Docs</a>
    <a class="btn">Get started</a>
  `;
  assert.deepEqual(extractCtaTexts(html), ['Get started', 'Docs']);
});

test('ignores plain links, bare URLs and duplicates', () => {
  const html = `
    <a href="/about">Our story</a>
    <a href="/blog/post">https://example.com/blog/post</a>
    <a href="/signup" class="btn">Sign up</a>
    <a href="/signup" class="btn">Sign up</a>
  `;
  assert.deepEqual(extractCtaTexts(html), ['Sign up']);
});

test('returns empty for a client-rendered page with no static markup', () => {
  const html = '<html><head><title>App</title></head><body><div id="root"></div></body></html>';
  assert.deepEqual(extractCtaTexts(html), []);
});

test('caps results', () => {
  const html = Array.from({ length: 20 }, (_, i) => `<button>Start ${i}</button>`).join('');
  assert.equal(extractCtaTexts(html).length, 6);
});
