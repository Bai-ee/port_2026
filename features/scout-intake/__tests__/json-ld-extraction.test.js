'use strict';

// Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3): JSON-LD
// @type extraction. Pure regex + JSON.parse — no network, no DOM parser.

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractJsonLdTypes } = require('../site-fetcher.js');

test('single object with a plain @type', () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>`;
  assert.deepEqual(extractJsonLdTypes(html), ['Organization']);
});

test('@type as an array on one node', () => {
  const html = `<script type="application/ld+json">{"@type":["Product","Thing"]}</script>`;
  assert.deepEqual(extractJsonLdTypes(html).sort(), ['Product', 'Thing']);
});

test('top-level array of JSON-LD nodes', () => {
  const html = `<script type="application/ld+json">[{"@type":"Organization"},{"@type":"WebSite"}]</script>`;
  assert.deepEqual(extractJsonLdTypes(html).sort(), ['Organization', 'WebSite']);
});

test('@graph wrapper', () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"BreadcrumbList"}]}</script>`;
  assert.deepEqual(extractJsonLdTypes(html).sort(), ['BreadcrumbList', 'Organization']);
});

test('multiple script tags are all scanned, types deduplicated', () => {
  const html = `
    <script type="application/ld+json">{"@type":"Organization"}</script>
    <script type="application/ld+json">{"@type":"Organization"}</script>
    <script type="application/ld+json">{"@type":"WebPage"}</script>
  `;
  assert.deepEqual(extractJsonLdTypes(html).sort(), ['Organization', 'WebPage']);
});

test('malformed JSON in one block is skipped, valid blocks still contribute', () => {
  const html = `
    <script type="application/ld+json">{ this is not valid JSON }</script>
    <script type="application/ld+json">{"@type":"Organization"}</script>
  `;
  assert.deepEqual(extractJsonLdTypes(html), ['Organization']);
});

test('no JSON-LD script tags: empty array, no throw', () => {
  assert.deepEqual(extractJsonLdTypes('<html><body><h1>Hi</h1></body></html>'), []);
  assert.deepEqual(extractJsonLdTypes(''), []);
  assert.deepEqual(extractJsonLdTypes(null), []);
});

test('a script with no @type anywhere in it contributes nothing', () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","name":"Acme"}</script>`;
  assert.deepEqual(extractJsonLdTypes(html), []);
});

test('nested @graph inside an array entry is still walked', () => {
  const html = `<script type="application/ld+json">[{"@graph":[{"@type":"Organization"}]},{"@type":"WebSite"}]</script>`;
  assert.deepEqual(extractJsonLdTypes(html).sort(), ['Organization', 'WebSite']);
});
