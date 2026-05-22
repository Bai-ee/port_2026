import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkText, estimateTokens, normalizeWhitespace } from '../chunk.js';

test('normalizeWhitespace trims repeated spaces and newlines', () => {
  assert.equal(normalizeWhitespace('  Alpha   beta\n\n\nGamma\tDelta  '), 'Alpha beta\n\nGamma Delta');
});

test('estimateTokens returns zero for empty text and positive count for text', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('A useful paragraph for the knowledge base.') > 0);
});

test('chunkText creates overlapping bounded chunks', () => {
  const words = Array.from({ length: 1200 }, (_, i) => `word${i}`);
  const chunks = chunkText(words.join(' '), { targetTokens: 200, overlapTokens: 25, maxChars: 2000 });

  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].position, 0);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 2000));
  assert.ok(chunks.every((chunk) => chunk.tokenEstimate > 0));
});

test('chunkText returns empty array for blank text', () => {
  assert.deepEqual(chunkText('   \n\t  '), []);
});
