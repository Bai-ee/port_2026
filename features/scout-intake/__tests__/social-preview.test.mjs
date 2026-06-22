import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeSiteMeta } = require('../modules/social-preview.js');

test('normalizeSiteMeta preserves canonical fields and fills legacy OG aliases', () => {
  const siteMeta = normalizeSiteMeta({
    title: 'Not The Rug',
    description: 'Brooklyn dog walking service.',
    canonical: 'https://nottherug.com/',
    ogImage: null,
  });

  assert.equal(siteMeta.title, 'Not The Rug');
  assert.equal(siteMeta.description, 'Brooklyn dog walking service.');
  assert.equal(siteMeta.ogTitle, 'Not The Rug');
  assert.equal(siteMeta.ogDescription, 'Brooklyn dog walking service.');
  assert.equal(siteMeta.canonical, 'https://nottherug.com/');
  assert.equal(siteMeta.ogImage, null);
});

test('normalizeSiteMeta keeps explicit OG aliases when present', () => {
  const siteMeta = normalizeSiteMeta({
    title: 'Fallback title',
    description: 'Fallback description.',
    ogTitle: 'Explicit OG title',
    ogDescription: 'Explicit OG description.',
  });

  assert.equal(siteMeta.title, 'Fallback title');
  assert.equal(siteMeta.description, 'Fallback description.');
  assert.equal(siteMeta.ogTitle, 'Explicit OG title');
  assert.equal(siteMeta.ogDescription, 'Explicit OG description.');
});
