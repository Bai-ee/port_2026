'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSearchTerms } = require('../search-term-normalizer');

test('REGRESSION (clairecalls 2026-08-20): a prose paragraph + comma-split fragments yield no junk terms', () => {
  // Exactly the malformed categoryTerms found in prod: the LLM's paragraph,
  // comma-shredded by the old String().split path.
  const malformed = [
    'scheduled outbound phone calls for daily reflection journaling habit failure and abandonment voice-first journaling for people who cannot or will not type AI memory and continuity across conversations notification fatigue and reminder blindness therapy homework and reflection between sessions hands-free reflection while driving',
    'walking',
    'or commuting checking in on a parent or someone who lives alone AI conversation privacy',
    'call recording',
    'and data retention',
  ];
  const out = normalizeSearchTerms(malformed);
  // The paragraph and the long fragments are prose → dropped. The short,
  // legitimately searchable pieces survive with their splitting artifacts
  // ("and "/"or ") stripped.
  assert.deepEqual(out, ['walking', 'call recording', 'data retention']);
});

test('an ARRAY whose entries contain commas is split per-entry (the String(array) shredder is gone)', () => {
  const out = normalizeSearchTerms(['voice journaling, audio journaling', 'journaling app']);
  assert.deepEqual(out, ['voice journaling', 'audio journaling', 'journaling app']);
});

test('newline/comma/semicolon-joined string input splits into clean terms', () => {
  const out = normalizeSearchTerms('voice journaling\naudio journaling; AI companion, check-in call');
  assert.deepEqual(out, ['voice journaling', 'audio journaling', 'AI companion', 'check-in call']);
});

test('terms longer than 4 words or 40 chars are prose and are dropped', () => {
  const out = normalizeSearchTerms([
    'journaling app',                                        // keep
    'five whole words is too many',                          // > 4 words → drop
    'a-single-hyphenated-term-that-runs-far-past-forty-chars', // > 40 chars → drop
  ]);
  assert.deepEqual(out, ['journaling app']);
});

test('dedupes case-insensitively, strips leading conjunctions/articles, caps at max', () => {
  const out = normalizeSearchTerms(
    ['AI journaling', 'ai journaling', 'or AI journaling', 'the journaling habit', 'a', 'b', 'c'],
    { max: 3 },
  );
  assert.deepEqual(out, ['AI journaling', 'journaling habit', 'a']);
});

test('null/undefined/empty input returns an empty list, never throws', () => {
  assert.deepEqual(normalizeSearchTerms(null), []);
  assert.deepEqual(normalizeSearchTerms(undefined), []);
  assert.deepEqual(normalizeSearchTerms([]), []);
  assert.deepEqual(normalizeSearchTerms(''), []);
  assert.deepEqual(normalizeSearchTerms([null, undefined, '  ']), []);
});
