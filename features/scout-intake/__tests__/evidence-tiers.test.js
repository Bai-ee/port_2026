'use strict';

// Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3): evidence
// tiers derived mechanically from a page's own capture facts. Pure — no I/O.

const test = require('node:test');
const assert = require('node:assert/strict');

const { TIER, PAGE_FIELDS, HEURISTIC_FIELDS, fieldTier, pageTiers, evidenceTiers } = require('../evidence-tiers.js');

const CONTENT_FIELDS = PAGE_FIELDS.filter((f) => !HEURISTIC_FIELDS.has(f));

test('rendered-fallback page: content fields tier A, heuristic fields tier C', () => {
  const page = { renderMode: 'rendered-fallback', renderedVia: 'browserless' };
  const tiers = pageTiers(page);
  for (const f of CONTENT_FIELDS) assert.equal(tiers[f], TIER.RENDERED, `${f} should be A`);
  for (const f of HEURISTIC_FIELDS) assert.equal(tiers[f], TIER.HEURISTIC, `${f} should be C`);
});

test('static-ok page (no renderFailed): content fields tier B, heuristic fields tier C', () => {
  const page = { renderMode: 'static' };
  const tiers = pageTiers(page);
  for (const f of CONTENT_FIELDS) assert.equal(tiers[f], TIER.STATIC, `${f} should be B`);
  for (const f of HEURISTIC_FIELDS) assert.equal(tiers[f], TIER.HEURISTIC, `${f} should be C`);
});

test('static page with a renderFailed reason: ALL fields tier X — content is unproven relative to what a render would show', () => {
  for (const reason of ['browserless_unavailable', 'no_improvement', 'render_cap_reached', 'browserless_disabled']) {
    const page = { renderMode: 'static', renderFailed: reason };
    const tiers = pageTiers(page);
    for (const f of PAGE_FIELDS) assert.equal(tiers[f], TIER.NOT_RUN, `${f} should be X when renderFailed=${reason}`);
  }
});

test('missing / null / unknown renderMode: all fields tier X', () => {
  assert.deepEqual(Object.values(pageTiers(null)), PAGE_FIELDS.map(() => TIER.NOT_RUN));
  assert.deepEqual(Object.values(pageTiers(undefined)), PAGE_FIELDS.map(() => TIER.NOT_RUN));
  assert.deepEqual(Object.values(pageTiers({})), PAGE_FIELDS.map(() => TIER.NOT_RUN));
  assert.deepEqual(Object.values(pageTiers({ renderMode: 'something-unrecognized' })), PAGE_FIELDS.map(() => TIER.NOT_RUN));
});

test('fieldTier is field-and-page scoped — same page, different field name, correct tier per field', () => {
  const rendered = { renderMode: 'rendered-fallback' };
  assert.equal(fieldTier('title', rendered), TIER.RENDERED);
  assert.equal(fieldTier('ctaTexts', rendered), TIER.HEURISTIC);
  assert.equal(fieldTier('contactClues', rendered), TIER.HEURISTIC);

  const staticOk = { renderMode: 'static' };
  assert.equal(fieldTier('h1', staticOk), TIER.STATIC);
  assert.equal(fieldTier('ctaTexts', staticOk), TIER.HEURISTIC);
});

test('evidenceTiers: tiers every page in a SiteEvidence-shaped object', () => {
  const evidence = {
    pages: [
      { url: 'https://example.com/', type: 'homepage', renderMode: 'rendered-fallback' },
      { url: 'https://example.com/about', type: 'about', renderMode: 'static' },
      { url: 'https://example.com/pricing', type: 'pricing', renderMode: 'static', renderFailed: 'browserless_unavailable' },
    ],
  };
  const result = evidenceTiers(evidence);
  assert.equal(result.length, 3);
  assert.equal(result[0].type, 'homepage');
  assert.equal(result[0].tiers.title, TIER.RENDERED);
  assert.equal(result[1].type, 'about');
  assert.equal(result[1].tiers.title, TIER.STATIC);
  assert.equal(result[2].type, 'pricing');
  assert.equal(result[2].tiers.title, TIER.NOT_RUN);
});

test('evidenceTiers: no pages / malformed evidence returns an empty array, never throws', () => {
  assert.deepEqual(evidenceTiers(null), []);
  assert.deepEqual(evidenceTiers({}), []);
  assert.deepEqual(evidenceTiers({ pages: [] }), []);
});
