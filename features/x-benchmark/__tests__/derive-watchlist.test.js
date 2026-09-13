import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveWatchlist, mergeWatchlist, COVERAGE_TARGET, MAX_ACCOUNTS } from '../derive-watchlist.js';
import { WATCHLIST } from '../../x-quote-targets/watchlist.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sebRows = JSON.parse(readFileSync(path.join(REPO, 'docs/audits/seb-design-x-corpus.json'), 'utf8'));
const derived = deriveWatchlist(sebRows, { ownHandle: 'seb__design' });

const row = (over = {}) => ({
  id: String(Math.random()),
  dateLocal: '2026-09-01',
  hourLocal: 10,
  type: 'quote-react',
  media: 'none',
  topics: ['editorial-typography'],
  chars: 40,
  likes: 10,
  text: 'nice',
  quotedAuthor: 'someone',
  quotedText: 'a swiss poster',
  ...over,
});

test('reproduces the hand-derived list: 31 accounts covering 80%', () => {
  // The original list was read off this corpus by hand and cut at "31 accounts
  // cover 80% of quote-derived likes". The rule, run as code, lands in the
  // same place — which is the evidence that it WAS a rule and not taste.
  assert.equal(derived.accounts.length, 31);
  assert.ok(derived.meta.coverageAchieved >= COVERAGE_TARGET);
  assert.ok(derived.meta.coverageAchieved < 0.82, 'must cut just past the target, not well beyond it');
  assert.equal(derived.meta.candidatesConsidered, 266);
});

test('the top targets match the ones the research identified', () => {
  const top = derived.accounts.slice(0, 2).map((a) => a.handle);
  // rare_jpg produced the benchmark's single best post; interiorsuckerr is its
  // most-quoted account.
  assert.deepEqual(top, ['rare_jpg', 'interiorsuckerr']);
});

test('almost every derived account is on the hand-written list', () => {
  const hand = new Set(WATCHLIST.map((w) => w.handle.toLowerCase()));
  const overlap = derived.accounts.filter((a) => hand.has(a.handle.toLowerCase()));
  assert.ok(overlap.length >= 29, `expected ~30 of 31 to match, got ${overlap.length}`);
});

test('the account being analyzed is never its own quote target', () => {
  assert.ok(!derived.accounts.some((a) => a.handle.toLowerCase() === 'seb__design'));
});

test('the vein describes what the target posts, not the caption around it', () => {
  const rows = [
    row({ quotedAuthor: 'typeguy', quotedText: 'a swiss grid poster, editorial layout', text: 'holy 1000 followers lets goo', topics: ['growth-milestone'] }),
    row({ quotedAuthor: 'typeguy', quotedText: 'another typeface specimen', text: 'thank you all', topics: ['growth-milestone'] }),
  ];
  const { accounts } = deriveWatchlist(rows);
  assert.equal(accounts[0].vein, 'editorial-typography', 'the caption\'s subject must not leak into the target\'s vein');
});

test('quotes count for more than retweets', () => {
  const rows = [
    row({ quotedAuthor: 'quoted', likes: 0 }),
    ...Array.from({ length: 4 }, () => row({ type: 'retweet', text: 'RT @retweeted: hello', quotedAuthor: null })),
  ];
  const { accounts } = deriveWatchlist(rows);
  assert.equal(accounts[0].handle, 'quoted', 'a considered quote outranks four taps');
});

test('a retweet target is read out of the RT prefix', () => {
  const { accounts } = deriveWatchlist([row({ type: 'retweet', text: 'RT @archivist: old poster', quotedAuthor: null })]);
  assert.equal(accounts[0].handle, 'archivist');
  assert.equal(accounts[0].retweets, 1);
  assert.equal(accounts[0].likesEarned, 0, 'a retweet earns the retweeter nothing measurable');
});

test('the list is capped however flat the distribution', () => {
  const rows = Array.from({ length: 300 }, (_, i) => row({ quotedAuthor: `acct${i}`, likes: 10 }));
  const { accounts } = deriveWatchlist(rows);
  assert.ok(accounts.length <= MAX_ACCOUNTS, 'a 200-account list would be unscannable under rate limits');
});

test('a corpus with no likes still returns a frequency-ordered list, and says so', () => {
  const rows = [
    row({ quotedAuthor: 'a', likes: 0 }),
    row({ quotedAuthor: 'a', likes: 0 }),
    row({ quotedAuthor: 'b', likes: 0 }),
  ];
  const { accounts, meta } = deriveWatchlist(rows);
  assert.equal(meta.likesWeighted, false);
  assert.equal(accounts[0].handle, 'a');
});

test('ordering is deterministic when weights tie', () => {
  const rows = ['b', 'a', 'c'].map((h) => row({ quotedAuthor: h, likes: 5 }));
  const first = deriveWatchlist(rows).accounts.map((a) => a.handle);
  const second = deriveWatchlist([...rows].reverse()).accounts.map((a) => a.handle);
  assert.deepEqual(first, second);
});

test('curated entries survive a derived list and are marked unproven', () => {
  // A client's own lanes are not in the benchmark's corpus by definition.
  const merged = mergeWatchlist(
    [{ handle: 'rare_jpg', vein: 'japanese-asian-design', likesEarned: 100 }],
    [{ handle: 'threejs', vein: 'motion' }, { handle: 'rare_jpg', note: 'best source' }],
  );
  const threejs = merged.find((m) => m.handle === 'threejs');
  assert.equal(threejs.unproven, true);
  assert.equal(threejs.source, 'curated');
  const rare = merged.find((m) => m.handle === 'rare_jpg');
  assert.equal(rare.source, 'derived');
  assert.equal(rare.likesEarned, 100, 'a curated note must not overwrite a measurement');
  assert.equal(rare.note, 'best source');
});

test('never throws on junk', () => {
  for (const input of [null, 'x', 42, [null, 'x', {}]]) {
    const out = deriveWatchlist(input);
    assert.ok(Array.isArray(out.accounts));
  }
  assert.deepEqual(mergeWatchlist(null, null), []);
});
