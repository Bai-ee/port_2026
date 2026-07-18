'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { redditQueriesFromCustomRows } = require('../external-scouts/scrapecreators-client.js');

// Reddit queries must come from the operator's Custom Query rows
// (marketingBriefConfig.searches), brand-first, capped at 4 (1 credit each),
// with site: operators stripped. No usable rows → brand + first 2 category terms.

describe('redditQueriesFromCustomRows', () => {
  test('custom rows drive the queries, brand-first, capped at 4', () => {
    const out = redditQueriesFromCustomRows({
      brand: 'Not The Rug',
      categoryTerms: ['memecoin', 'solana'],
      searches: [
        { label: 'A', query: 'rug pull recovery' },
        { label: 'B', query: 'solana memecoin drama' },
        { label: 'C', query: 'crypto exit scam stories' },
        { label: 'D', query: 'degen trading losses' },
      ],
    });
    assert.deepEqual(out, ['Not The Rug', 'rug pull recovery', 'solana memecoin drama', 'crypto exit scam stories']);
  });

  test('no custom rows → brand + first 2 category terms (legacy behavior)', () => {
    const out = redditQueriesFromCustomRows({
      brand: 'Not The Rug',
      categoryTerms: ['memecoin', 'solana', 'defi'],
      searches: [],
    });
    assert.deepEqual(out, ['Not The Rug', 'memecoin', 'solana']);
  });

  test('missing searches (undefined) falls back the same way', () => {
    const out = redditQueriesFromCustomRows({ brand: 'Acme', categoryTerms: ['widgets'] });
    assert.deepEqual(out, ['Acme', 'widgets']);
  });

  test('site: operators are stripped — site:reddit.com rows finally work', () => {
    const out = redditQueriesFromCustomRows({
      brand: 'Acme',
      searches: [{ label: 'R', query: 'site:reddit.com "dog walker" williamsburg' }],
    });
    assert.deepEqual(out, ['Acme', '"dog walker" williamsburg']);
  });

  test('a row that is ONLY a site: operator is dropped, triggering fallback', () => {
    const out = redditQueriesFromCustomRows({
      brand: 'Acme',
      categoryTerms: ['widgets'],
      searches: [{ label: 'R', query: 'site:reddit.com' }],
    });
    assert.deepEqual(out, ['Acme', 'widgets']);
  });

  test('OR clusters stay one query string (one credit)', () => {
    const out = redditQueriesFromCustomRows({
      brand: 'Acme',
      searches: [{ label: 'A', query: 'rug pull OR exit scam' }],
    });
    assert.deepEqual(out, ['Acme', 'rug pull OR exit scam']);
  });

  test('quoted brand is cleaned and deduped against an identical custom row', () => {
    const out = redditQueriesFromCustomRows({
      brand: '"Acme"',
      searches: [{ label: 'A', query: 'Acme' }, { label: 'B', query: 'widgets' }],
    });
    assert.deepEqual(out, ['Acme', 'widgets']);
  });

  test('junk rows (under 2 alphanumeric chars) are dropped', () => {
    const out = redditQueriesFromCustomRows({
      brand: 'Acme',
      categoryTerms: ['widgets'],
      searches: [{ query: '@' }, { query: '  ' }, { query: null }],
    });
    assert.deepEqual(out, ['Acme', 'widgets']);
  });

  test('empty brand does not emit an empty query', () => {
    const out = redditQueriesFromCustomRows({
      brand: '',
      searches: [{ query: 'rug pull recovery' }],
    });
    assert.deepEqual(out, ['rug pull recovery']);
  });
});
