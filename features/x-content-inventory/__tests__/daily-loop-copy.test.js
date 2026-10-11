import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuoteReactPrompt, quoteReactFallback, checkSuggestionText, buildContributionPrompt, fallbackCopy, guardTypeFor,
  buildQuoteCommentaryPrompt, quoteCommentaryFallback, QUOTE_REACT_MIN, QUOTE_REACT_MAX,
} from '../daily-loop/copy.js';

const POST = { id: '1', author: 'someone', text: 'Wireframe pass for the new identity system, spacing finally clicked' };
const SLOT = { letter: 'D', type: 'quote-react', lane: 'design' };
const sug = (extra = {}) => ({ type: 'quote', slot: SLOT, package: null, opportunity: { ...POST, url: 'https://x.com/someone/status/123' }, ...extra });

test('fallback: 30-65 chars, no link/hashtag, passes guard, does not echo the post', () => {
  const posts = [POST, { id: '2', text: 'a' }, { text: 'logo grid study' }, {}];
  for (const post of posts) {
    const t = quoteReactFallback({ post, slot: SLOT });
    assert.ok(t.length >= QUOTE_REACT_MIN && t.length <= QUOTE_REACT_MAX, t);
    assert.ok(!/https?:|#/.test(t));
    assert.ok(!String(post.text || 'zzzz').toLowerCase().includes(t.toLowerCase().replace(/\.$/, '')));
    assert.equal(checkSuggestionText(t, sug()).blocked, false);
  }
  assert.equal(quoteReactFallback({ post: POST }), quoteReactFallback({ post: POST }));
});

test('prompt: carries rules and post text, no package facts', () => {
  const r = buildQuoteReactPrompt({ post: POST, slot: SLOT });
  assert.equal(r.ok, true);
  assert.match(r.prompt, /30-65 characters/);
  assert.match(r.prompt, /No explanation/);
  assert.match(r.prompt, /No links/);
  assert.match(r.prompt, /No owned facts/);
  assert.ok(r.prompt.includes(POST.text));
  assert.ok(!/Verifiable facts|related item|Title:/.test(r.prompt));
  assert.equal(buildQuoteReactPrompt({ post: {} }).ok, false);
});

test('check: flags over-length, own link, guard hard block; allows trailing status url', () => {
  const s = sug();
  const ok = 'the detail on this is really well made.';
  assert.equal(checkSuggestionText(ok, s).blocked, false);
  assert.equal(checkSuggestionText(`${ok} https://x.com/someone/status/123`, s).blocked, false);
  const long = checkSuggestionText('this is a much longer take that explains everything about the whole thing', s);
  assert.equal(long.blocked, true);
  assert.ok(long.violations.some((v) => /over 68/.test(v)));
  assert.equal(checkSuggestionText('see https://example.com/a now', s).blocked, true);
  assert.equal(checkSuggestionText('nice #design', s).blocked, true);
  const casino = checkSuggestionText('pump it, 100x memecoin', s);
  assert.equal(casino.guard.hardBlock, true);
  assert.equal(casino.blocked, true);
});

test('routing: slot type selects the quote-react path; plain quotes unchanged', () => {
  assert.equal(guardTypeFor(sug()), 'quote-react');
  assert.equal(buildContributionPrompt({ suggestion: sug() }).ok, true);
  assert.ok(fallbackCopy(sug()).length >= QUOTE_REACT_MIN);
  const plain = { type: 'quote', package: null, opportunity: { text: 'x' } };
  assert.equal(buildContributionPrompt({ suggestion: plain }).ok, false);
  assert.equal(checkSuggestionText('x'.repeat(60), plain).blocked, false);
});

test('quote-react length: hard block outside 28-68, warning outside 30-65, clean inside', () => {
  const s = sug();
  const of = (n) => 'x'.repeat(n - 1) + '.';
  for (const n of [28, 29, 66, 68]) {
    const r = checkSuggestionText(of(n), s);
    assert.equal(r.blocked, false, String(n));
    assert.ok(r.warnings.some((w) => /best 30-65/.test(w)), `warn ${n}`);
  }
  for (const n of [30, 53, 65]) assert.ok(!checkSuggestionText(of(n), s).warnings.some((w) => /best 30-65/.test(w)), `clean ${n}`);
  for (const n of [27, 69]) assert.equal(checkSuggestionText(of(n), s).blocked, true, String(n));
  assert.equal(checkSuggestionText('clean work.', s).blocked, true);
});

// --- quote-commentary ---

const CSLOT = { letter: 'E', type: 'quote-commentary', lane: 'design' };
const csug = (extra = {}) => ({ type: 'quote', slot: CSLOT, package: null, opportunity: { ...POST, url: 'https://x.com/someone/status/123' }, ...extra });

test('commentary: own prompt, 1-2 sentences, no owned facts, fenced post; no post => refusal', () => {
  const r = buildContributionPrompt({ suggestion: csug() });
  assert.equal(r.ok, true);
  assert.match(r.prompt, /one or two sentences/i);
  assert.match(r.prompt, /No owned facts/);
  assert.ok(r.prompt.includes(POST.text));
  assert.ok(!/Verifiable facts|Title:|30-65/.test(r.prompt));
  assert.equal(buildQuoteCommentaryPrompt({ post: {} }).ok, false);
  assert.equal(guardTypeFor(csug()), 'quote-commentary');
});

test('commentary fallback: never contains owned facts, passes the check, does not repeat in a run', () => {
  const used = [];
  for (const id of ['1', '2', '3', '4']) {
    const t = quoteCommentaryFallback({ post: { id, text: POST.text }, slot: CSLOT, usedLines: used });
    assert.ok(t.length >= 60 && t.length <= 200, t);
    assert.ok(!/\b(i|we|my|our)\b|https?:|#|\d/i.test(t), t);
    const c = checkSuggestionText(t, csug());
    assert.equal(c.blocked, false, JSON.stringify(c));
    assert.ok(!used.includes(t));
    used.push(t);
  }
  assert.equal(quoteCommentaryFallback({ post: POST, slot: CSLOT, usedLines: used }), '');
  assert.equal(fallbackCopy(csug()), quoteCommentaryFallback({ post: csug().opportunity, slot: CSLOT }));
});

test('commentary check: blocks an owned-experience claim, own link and over-length', () => {
  const s = csug();
  assert.equal(checkSuggestionText('i built something just like this for a client last year, worth a look.', s).blocked, true);
  assert.equal(checkSuggestionText('in my experience this is exactly how the spacing should work out in the end.', s).blocked, true);
  assert.equal(checkSuggestionText('worth a slow look, see https://example.com/x for more of the same', s).blocked, true);
  assert.equal(checkSuggestionText('x'.repeat(201), s).blocked, true);
});
