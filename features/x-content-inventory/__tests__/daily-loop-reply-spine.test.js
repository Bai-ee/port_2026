// Reply slot without an owned item: fills from a live on-brand narrative, and its copy
// never claims personal experience. Real fixture shapes; MODEST_ON_BRAND is INVENTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectForSlots } from '../daily-loop/select.js';
import { conversationPostsFrom, normalizeConversationPost } from '../daily-loop/conversations.js';
import { buildContributionPrompt, fallbackCopy, checkSuggestionText } from '../daily-loop/copy.js';
import { OWNER_CLIENT_IDS } from '../daily-loop/config.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-real-shapes.json', import.meta.url), 'utf8'));
const NOW = Date.parse(FX.now);
const slot = (letter, type) => ({ letter, type, lane: null, pillar: null, timeCT: null, startsAt: null, manual: false });
const MODEST_ON_BRAND = normalizeConversationPost({
  id: 'invented-1', author: 'chicagoheads', text: 'Glenn Underground and Cei-Bei, House Music Will Never Die. Still the one.',
  createdAt: new Date(NOW - 2 * 3_600_000).toISOString(), likeCount: 60, retweetCount: 5, replyCount: 8,
}, 'search:glenn');
const glenn = FX.packages.filter((p) => /Glenn/.test(p.title));
const run = (over) => selectForSlots({ clientId: OWNER_CLIENT_IDS[0], localDate: '2026-10-10', now: NOW, candidates: [], ...over });

// The only matching item is spent on the showcase slot, so the reply has no owned item left.
const packageless = () => run({
  packages: glenn, conversationPosts: [MODEST_ON_BRAND],
  slots: [slot('B', 'original-showcase'), slot('R', 'reply')],
  matchedSlots: [{ slot: 'B', packageId: glenn[0].id, matchScore: 1, matchReason: 'never posted' }],
}).suggestions.find((s) => s.slot.letter === 'R');

test('a reply fills from a live on-brand narrative with no owned item', () => {
  const s = packageless();
  assert.ok(s, 'reply slot filled');
  assert.equal(s.package, null);
  assert.equal(s.why.content, 'none required — conversation reply');
  assert.equal(s.opportunity.id, 'invented-1');
});

test('a matching unused owned item is an optional note, not required', () => {
  const s = run({ packages: glenn, conversationPosts: [MODEST_ON_BRAND], slots: [slot('R', 'reply')] }).suggestions[0];
  assert.equal(s.package.id, glenn[0].id);
  assert.match(s.why.content, /^optional: /);
});

test('a reply with no live narrative still gaps with the fill-reply reason', () => {
  const r = run({ packages: glenn, conversationPosts: [], slots: [slot('R', 'reply')] });
  assert.equal(r.suggestions.length, 0);
  assert.match(r.gaps.find((g) => g.code === 'slot-unfilled:R').message, /no live conversation to reply to/);
});

test('package-less reply: no fallback copy, and the prompt forbids experience and owned facts', () => {
  const s = packageless();
  assert.equal(fallbackCopy(s), '');
  const p = buildContributionPrompt({ suggestion: s });
  assert.equal(p.ok, true);
  assert.match(p.prompt, /No first-person claims of experience/);
  assert.match(p.prompt, /No owned facts/);
  assert.match(p.prompt, /general observation or a question/);
  assert.doesNotMatch(p.prompt, /Title:/);
});

test('check flags first-person experience claims on a package-less reply only', () => {
  const s = packageless();
  for (const t of ['I built this exact thing last year.', 'when I shipped mine it broke', 'we shipped one like it', 'in my experience this holds', 'I remember that night']) {
    const c = checkSuggestionText(t, s);
    assert.equal(c.blocked, true, t);
    assert.ok(c.violations.some((v) => /experience claim/.test(v)), t);
  }
  for (const t of ['that record still holds up.', 'what made the second pressing different?', 'building things takes time']) {
    assert.equal(checkSuggestionText(t, s).violations.some((v) => /experience claim/.test(v)), false, t);
  }
  const withPkg = run({ packages: glenn, conversationPosts: [MODEST_ON_BRAND], slots: [slot('R', 'reply')] }).suggestions[0];
  assert.equal(checkSuggestionText('when I shipped the flyer scan it was this one', withPkg).violations.some((v) => /experience claim/.test(v)), false);
});
