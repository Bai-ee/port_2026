import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeCorpus } from '../summarize.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const loadCorpus = (name) => JSON.parse(readFileSync(path.join(REPO, 'docs/audits', name), 'utf8'));

// The two real corpora are the regression baseline. Every figure asserted
// against them below was derived by hand during the original research and is
// quoted in docs/source-of-truth/X-GROWTH-SYSTEM.md or the built dashboard —
// if a refactor moves one of these numbers, the analysis changed, not just the
// code.
const seb = summarizeCorpus(loadCorpus('seb-design-x-corpus.json'), { handle: 'seb__design' });
const baiee = summarizeCorpus(loadCorpus('bai-ee-x-corpus.json'), { handle: 'bai_ee' });

const post = (over = {}) => ({
  id: String(Math.random()),
  dateLocal: '2026-09-01',
  hourLocal: 10,
  type: 'original-text',
  media: 'none',
  topics: [],
  chars: 50,
  likes: 10,
  reposts: 0,
  replies: 0,
  views: 1000,
  ...over,
});

test('reproduces the measured cadence of both real accounts', () => {
  assert.equal(seb.cadence.postsPerActiveDay, 11.85);
  assert.equal(seb.cadence.postsPerOccupiedHour, 1.96);
  assert.equal(baiee.cadence.postsPerOccupiedHour, 1.31);
  // The finding that killed the "spread your posts out" advice: the model
  // account is denser per occupied hour, and 73% of its posts share an hour.
  assert.ok(seb.cadence.postsPerOccupiedHour > baiee.cadence.postsPerOccupiedHour);
  assert.equal(seb.cadence.shareInMultiHour, 73.27);
  assert.equal(seb.cadence.busiestHour, 11);
});

test('reproduces the measured composition split', () => {
  assert.equal(seb.authoredShare, 77.11);
  assert.equal(baiee.authoredShare, 34.15);
  assert.equal(seb.byType['self-quote'].avgLikes, 60.8);
  assert.equal(seb.byType['quote-react'].n, 183);
});

test('video out-performs image inside the same post type', () => {
  // 3.4x, measured within original-showcase so the post type cannot be
  // credited to the medium.
  const showcase = seb.mediaWithinType['original-showcase'];
  const ratio = showcase.video.avgLikes / showcase.image.avgLikes;
  assert.ok(ratio > 3.3 && ratio < 3.5, `expected ~3.4x, got ${ratio}`);
});

test('the strongest type by lift is the account\'s own, not the benchmark\'s', () => {
  // bai_ee's best authored type is original-showcase; seb's is self-quote.
  const bestOf = (block) => Object.entries(block.byType)
    .filter(([, v]) => v.n >= 8)
    .sort((a, b) => b[1].lift - a[1].lift)[0][0];
  assert.equal(bestOf(baiee), 'original-showcase');
  assert.equal(bestOf(seb), 'self-quote');
});

test('retweets count for cadence but never for performance', () => {
  const posts = [
    post({ type: 'retweet', likes: 0, views: null }),
    post({ type: 'retweet', likes: 0, views: null }),
    post({ type: 'original-showcase', likes: 10 }),
  ];
  const block = summarizeCorpus(posts, { handle: 'x' });
  assert.equal(block.posts, 3);
  assert.equal(block.authoredPosts, 1);
  assert.equal(block.retweets, 2);
  // The retweets must not drag the average toward zero — otherwise "post less"
  // reads as a strategy.
  assert.equal(block.base.avgLikes, 10);
  assert.equal(block.byType.retweet, undefined);
  assert.equal(block.byType['original-showcase'].share, 100);
});

test('replies and retweets are excluded from stranger-eligible share', () => {
  const block = summarizeCorpus([
    post({ type: 'retweet' }),
    post({ type: 'reply' }),
    post({ type: 'original-text' }),
    post({ type: 'quote-react' }),
  ], { handle: 'x' });
  assert.equal(block.strangerEligibleShare, 50);
});

test('lift is relative to the account\'s own average, so scale cancels', () => {
  const small = summarizeCorpus([
    post({ type: 'original-showcase', likes: 20 }),
    post({ type: 'original-text', likes: 10 }),
  ], { handle: 'small' });
  const large = summarizeCorpus([
    post({ type: 'original-showcase', likes: 20000 }),
    post({ type: 'original-text', likes: 10000 }),
  ], { handle: 'large' });
  assert.equal(small.byType['original-showcase'].lift, large.byType['original-showcase'].lift);
});

test('pooled engagement rate ignores posts with no views rather than scoring them zero', () => {
  const block = summarizeCorpus([
    post({ likes: 10, views: 1000 }),
    post({ likes: 0, views: null }),
  ], { handle: 'x' });
  assert.equal(block.base.pooledER, 1);
  assert.equal(block.base.viewsCoverage, 0.5);
});

test('view coverage is reported so a biased sample can be caught', () => {
  // seb's views were backfilled for the top-liked posts plus controls. That
  // makes his ER figures unusable for comparison and is why lift uses likes.
  assert.ok(seb.base.viewsCoverage < 0.3, 'seb view coverage is a known partial sample');
  assert.equal(baiee.base.viewsCoverage, 1);
  assert.equal(seb.base.liftBasis, 'avgLikes');
});

test('the copy-length band comes from the top quartile, not from everything', () => {
  const posts = [
    ...Array.from({ length: 8 }, () => post({ type: 'quote-react', chars: 40, likes: 100 })),
    ...Array.from({ length: 24 }, () => post({ type: 'quote-react', chars: 400, likes: 1 })),
  ];
  const block = summarizeCorpus(posts, { handle: 'x' });
  assert.equal(block.lengthByType['quote-react'].median, 400, 'overall median is dragged by the long flops');
  assert.equal(block.lengthByType['quote-react'].topQuartile.median, 40, 'the band tracks what actually worked');
});

test('the real quote-react band sits near the measured 45-char median', () => {
  const band = seb.lengthByType['quote-react'].topQuartile;
  assert.ok(band.median >= 40 && band.median <= 50, `expected ~45, got ${band.median}`);
  assert.ok(band.p10 < band.median && band.median < band.p90);
});

test('malformed rows are dropped, not defaulted', () => {
  const block = summarizeCorpus([
    post({ likes: 10 }),
    { type: 'original-text' },            // no date, no likes
    { dateLocal: '2026-09-01', likes: 5 }, // no type
    null,
    'nonsense',
  ], { handle: 'x' });
  assert.equal(block.posts, 1);
  assert.equal(block.dropped, 4);
  assert.equal(block.base.avgLikes, 10, 'a row with a missing like count must not read as a flop');
});

test('never throws on empty or junk input', () => {
  for (const input of [[], null, undefined, 'x', 42, {}]) {
    const block = summarizeCorpus(input, { handle: 'x' });
    assert.equal(block.posts, 0);
    assert.equal(block.cadence.postsPerActiveDay, null);
  }
});
