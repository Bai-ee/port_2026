import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuoteReactPrompt, quoteReactFallback, checkSuggestionText, buildContributionPrompt, fallbackCopy, guardTypeFor,
} from '../daily-loop/copy.js';

const POST = { id: '1', author: 'someone', text: 'Wireframe pass for the new identity system, spacing finally clicked' };
const SLOT = { letter: 'D', type: 'quote-react', lane: 'design' };
const sug = (extra = {}) => ({ type: 'quote', slot: SLOT, package: null, opportunity: { ...POST, url: 'https://x.com/someone/status/123' }, ...extra });

test('fallback: <50 chars, no link/hashtag, passes guard, does not echo the post', () => {
  const posts = [POST, { id: '2', text: 'a' }, { text: 'logo grid study' }, {}];
  for (const post of posts) {
    const t = quoteReactFallback({ post, slot: SLOT });
    assert.ok(t.length < 50);
    assert.ok(!/https?:|#/.test(t));
    assert.ok(!String(post.text || 'zzzz').toLowerCase().includes(t.toLowerCase().replace(/\.$/, '')));
    assert.equal(checkSuggestionText(t, sug()).blocked, false);
  }
  assert.equal(quoteReactFallback({ post: POST }), quoteReactFallback({ post: POST }));
});

test('prompt: carries rules and post text, no package facts', () => {
  const r = buildQuoteReactPrompt({ post: POST, slot: SLOT });
  assert.equal(r.ok, true);
  assert.match(r.prompt, /Under 50 characters/);
  assert.match(r.prompt, /No explanation/);
  assert.match(r.prompt, /No links/);
  assert.match(r.prompt, /No owned facts/);
  assert.ok(r.prompt.includes(POST.text));
  assert.ok(!/Verifiable facts|related item|Title:/.test(r.prompt));
  assert.equal(buildQuoteReactPrompt({ post: {} }).ok, false);
});

test('check: flags over-length, own link, guard hard block; allows trailing status url', () => {
  const s = sug();
  assert.equal(checkSuggestionText('clean work.', s).blocked, false);
  assert.equal(checkSuggestionText('clean work. https://x.com/someone/status/123', s).blocked, false);
  const long = checkSuggestionText('this is a much longer take that explains everything', s);
  assert.equal(long.blocked, true);
  assert.ok(long.violations.some((v) => /over 49/.test(v)));
  assert.equal(checkSuggestionText('see https://example.com/a now', s).blocked, true);
  assert.equal(checkSuggestionText('nice #design', s).blocked, true);
  const casino = checkSuggestionText('pump it, 100x memecoin', s);
  assert.equal(casino.guard.hardBlock, true);
  assert.equal(casino.blocked, true);
});

test('routing: slot type selects the quote-react path; plain quotes unchanged', () => {
  assert.equal(guardTypeFor(sug()), 'quote-react');
  assert.equal(buildContributionPrompt({ suggestion: sug() }).ok, true);
  assert.ok(fallbackCopy(sug()).length < 50);
  const plain = { type: 'quote', package: null, opportunity: { text: 'x' } };
  assert.equal(buildContributionPrompt({ suggestion: plain }).ok, false);
  assert.equal(checkSuggestionText('x'.repeat(60), plain).blocked, false);
});
