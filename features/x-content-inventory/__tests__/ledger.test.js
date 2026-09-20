import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPostLedger, rankingBasis, winnerThreshold, assetFatigue,
  pickResurrectionCandidates, MIN_RESURRECTION_AGE_DAYS, RESURRECTION_COOLDOWN_DAYS,
} from '../ledger.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const corpus = JSON.parse(readFileSync(path.join(REPO, 'docs/audits/bai-ee-x-corpus.json'), 'utf8'));

const TODAY = Date.parse('2026-09-20T12:00:00Z');
const daysAgo = (n) => new Date(TODAY - n * 86_400_000).toISOString();

const post = (over = {}) => ({
  id: String(Math.random()), type: 'original-showcase', utc: daysAgo(60),
  text: 't', media: 'video', likes: 10, engagement: 10, views: 500, assetRefs: [], ...over,
});

test('retweets never enter the ledger', () => {
  const entries = buildPostLedger([post({ type: 'retweet' }), post()]);
  assert.equal(entries.length, 1);
});

test('ranking basis prefers views when coverage is high, falls back to likes', () => {
  assert.equal(rankingBasis([post(), post(), post()]), 'views');
  assert.equal(rankingBasis([post({ views: null }), post({ views: null }), post()]), 'likes');
});

test('a missing view count is not treated as zero views', () => {
  // Silently coercing null to 0 would drag the threshold down and let quiet
  // posts through as "winners".
  const entries = buildPostLedger([post({ views: undefined })]);
  assert.equal(entries[0].views, null);
});

test('resurrection excludes replies, self-quotes and quote-reacts', () => {
  const entries = buildPostLedger([
    post({ id: 'a', type: 'reply', views: 9000 }),
    post({ id: 'b', type: 'self-quote', views: 9000 }),
    post({ id: 'c', type: 'quote-react', views: 9000 }),
    post({ id: 'd', type: 'original-showcase', views: 9000 }),
  ]);
  const picks = pickResurrectionCandidates(entries, { today: TODAY });
  assert.deepEqual(picks.map((p) => p.post.id), ['d']);
});

test('resurrection respects the age floor and the cooldown', () => {
  const tooNew = buildPostLedger([post({ id: 'new', utc: daysAgo(MIN_RESURRECTION_AGE_DAYS - 1) })]);
  assert.equal(pickResurrectionCandidates(tooNew, { today: TODAY }).length, 0);

  const ok = buildPostLedger([post({ id: 'ok', utc: daysAgo(60) })]);
  assert.equal(pickResurrectionCandidates(ok, { today: TODAY }).length, 1);

  const recentlyUsed = { ok: daysAgo(RESURRECTION_COOLDOWN_DAYS - 10) };
  assert.equal(pickResurrectionCandidates(ok, { today: TODAY, resurrected: recentlyUsed }).length, 0);
});

test('assetFatigue keeps the most recent post per artifact', () => {
  const entries = buildPostLedger([
    post({ id: '1', utc: daysAgo(90), assetRefs: ['sha-a'] }),
    post({ id: '2', utc: daysAgo(10), assetRefs: ['sha-a'] }),
  ]);
  const fatigue = assetFatigue(entries);
  assert.equal(fatigue['sha-a'].postCount, 2);
  assert.equal(fatigue['sha-a'].lastPostedAt, daysAgo(10));
});

test('against the real corpus, view-ranking surfaces the two documented breakouts', () => {
  // Regression guard on the fix that made this module useful: ranking these 84
  // posts by LIKES buries the 4,712-view and 1,870-view posts under a 4-like
  // post that 60 people saw. Reach is what a self-quote borrows against.
  const entries = buildPostLedger(corpus);
  assert.equal(rankingBasis(entries), 'views', 'this corpus has backfilled views');
  assert.ok(winnerThreshold(entries) > 100);

  // Anchored to the corpus's own last post so the test does not rot with time.
  const newest = Math.max(...entries.map((e) => Date.parse(e.utc)).filter(Number.isFinite));
  const picks = pickResurrectionCandidates(entries, { today: newest + 40 * 86_400_000, limit: 3 });
  const top = picks.map((p) => p.views);
  assert.ok(top.includes(4712), `expected the 4,712-view post in the top 3, got ${top.join(', ')}`);
  assert.ok(top.includes(1870), `expected the 1,870-view post in the top 3, got ${top.join(', ')}`);
});
