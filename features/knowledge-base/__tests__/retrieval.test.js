import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExcerpt,
  clampTopK,
  extractMatchedTerms,
  formatKnowledgeContext,
  inferSectionTitle,
  relevanceLabel,
} from '../retrieval.js';
import {
  buildKnowledgeBaseRuntimeQuery,
  summarizeKnowledgeSources,
} from '../pipeline-context.js';

test('clampTopK defaults and clamps to supported range', () => {
  assert.equal(clampTopK(undefined), 5);
  assert.equal(clampTopK(0), 1);
  assert.equal(clampTopK(99), 10);
  assert.equal(clampTopK(3), 3);
});

test('formatKnowledgeContext formats source-labelled chunks under cap', () => {
  const result = formatKnowledgeContext([
    { sourceTitle: 'Whitepaper', text: 'A precise product claim.' },
    { sourceUrl: 'https://example.com', text: 'A second useful excerpt.' },
  ], 500);

  assert.match(result, /\[1\] Whitepaper: A precise product claim\./);
  assert.match(result, /\[2\] https:\/\/example\.com: A second useful excerpt\./);
});

test('formatKnowledgeContext hard-caps long context', () => {
  const result = formatKnowledgeContext([
    { sourceTitle: 'Long doc', text: 'x'.repeat(2000) },
  ], 600);

  assert.ok(result.length <= 603);
  assert.ok(result.endsWith('...'));
});

test('inferSectionTitle extracts markdown-ish headings from compact chunks', () => {
  const title = inferSectionTitle('# Fast Poker Docs > Source: https://example.com --- ## What is Fast Poker Fast Poker is on-chain poker.');
  assert.match(title, /What is Fast Poker/);
});

test('extractMatchedTerms returns query terms found in chunk text', () => {
  const terms = extractMatchedTerms({
    query: 'what is fast poker latency',
    text: 'Fast Poker is on-chain poker with low latency gameplay.',
  });
  assert.deepEqual(terms, ['fast', 'poker', 'latency']);
});

test('buildExcerpt caps long excerpts', () => {
  const excerpt = buildExcerpt('x'.repeat(1200), 300);
  assert.ok(excerpt.length <= 303);
  assert.ok(excerpt.endsWith('...'));
});

test('relevanceLabel describes distance bands', () => {
  assert.equal(relevanceLabel(0.2), 'very close match');
  assert.equal(relevanceLabel(0.38), 'close match');
  assert.equal(relevanceLabel(0.55), 'related context');
});

test('buildKnowledgeBaseRuntimeQuery composes card-specific context', () => {
  const query = buildKnowledgeBaseRuntimeQuery({
    intent: 'business model',
    websiteUrl: 'https://example.com',
    clientName: 'Example Co',
    brandOverview: {
      industry: 'on-chain poker',
      businessModel: 'rake and venue fees',
    },
    sourceInputs: {
      ideaDescription: 'Provably fair fast poker.',
    },
  });

  assert.match(query, /business model/);
  assert.match(query, /Example Co/);
  assert.match(query, /on-chain poker/);
  assert.match(query, /rake and venue fees/);
});

test('summarizeKnowledgeSources returns compact source citations', () => {
  const sources = summarizeKnowledgeSources([
    {
      id: 'chunk-1',
      itemId: 'item-1',
      sourceTitle: 'Whitepaper',
      sectionTitle: 'Business Model',
      sourceType: 'pdf',
      sourceUrl: 'https://example.com/whitepaper.pdf',
      relevanceLabel: 'close match',
      distance: 0.4,
    },
  ]);

  assert.deepEqual(sources[0], {
    index: 1,
    itemId: 'item-1',
    chunkId: 'chunk-1',
    title: 'Whitepaper',
    sectionTitle: 'Business Model',
    sourceType: 'pdf',
    sourceUrl: 'https://example.com/whitepaper.pdf',
    relevance: 'close match',
    distance: 0.4,
  });
});
