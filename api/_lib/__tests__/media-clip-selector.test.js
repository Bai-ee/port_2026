'use strict';

const test = require('node:test');
const assert = require('node:assert');
const selector = require('../media-clip-selector.cjs');

const clip = (name, size = 10 * 1024 * 1024, kind = 'video') => ({ name, size, kind });

/** Deterministic rng cycling a fixed sequence, so shuffles are reproducible. */
function seededRng(seq) {
  let i = 0;
  return () => seq[i++ % seq.length];
}

test('eligibleClips: drops non-video and under-size files', () => {
  const files = [
    clip('a.mov'),
    clip('small.mov', 1024),
    clip('image.jpg', 10 * 1024 * 1024, 'image'),
    { name: 'no-kind.mov', size: 10 * 1024 * 1024 },
    clip('b.mov'),
  ];
  const out = selector.eligibleClips(files, 5 * 1024 * 1024);
  assert.deepEqual(out.map((f) => f.name), ['a.mov', 'b.mov']);
});

test('eligibleClips: non-array input returns empty', () => {
  assert.deepEqual(selector.eligibleClips(null, 0), []);
  assert.deepEqual(selector.eligibleClips(undefined, 0), []);
});

test('shuffled: preserves membership and does not mutate input', () => {
  const input = [1, 2, 3, 4, 5];
  const out = selector.shuffled(input, seededRng([0.1, 0.9, 0.4, 0.7, 0.2]));
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});

test('orderClipsFreshFirst: unused clips all rank ahead of recently used ones', () => {
  const files = [clip('used1.mov'), clip('fresh1.mov'), clip('used2.mov'), clip('fresh2.mov')];
  const recent = new Set(['used1.mov', 'used2.mov']);
  const out = selector.orderClipsFreshFirst(files, recent, seededRng([0.5]));
  const names = out.map((f) => f.name);
  assert.equal(names.length, 4);
  // Both fresh clips must appear before either reused clip.
  assert.ok(Math.max(names.indexOf('fresh1.mov'), names.indexOf('fresh2.mov'))
    < Math.min(names.indexOf('used1.mov'), names.indexOf('used2.mov')));
});

test('buildVideoOrder: returns null when the folder cannot fill the order', async () => {
  const order = await selector.buildVideoOrder({
    clientId: 'c1', folder: 'skyline', files: [clip('a.mov'), clip('b.mov')], segmentCount: 6,
  });
  assert.equal(order, null);
});

test('buildVideoOrder: pins exactly segmentCount contiguous segment indexes', async () => {
  const files = Array.from({ length: 20 }, (_, i) => clip(`c${i}.mov`));
  const order = await selector.buildVideoOrder({
    clientId: 'c1', folder: 'skyline', files, segmentCount: 6, rng: seededRng([0.3, 0.8, 0.1]),
  });
  assert.equal(order.length, 6);
  assert.deepEqual(order.map((o) => o.segmentIndex), [0, 1, 2, 3, 4, 5]);
  assert.equal(new Set(order.map((o) => o.videoName)).size, 6, 'no duplicate clips within one render');
});

test('buildVideoOrder: anti-repeat excludes clips from recent jobs when the pool allows', async () => {
  const files = Array.from({ length: 12 }, (_, i) => clip(`c${i}.mov`));
  const recentNames = ['c0.mov', 'c1.mov', 'c2.mov', 'c3.mov', 'c4.mov', 'c5.mov'];
  const listMediaJobs = async () => ([{
    type: 'video-remix',
    recipeFull: {
      sourceFolders: ['skyline'],
      videoOrder: recentNames.map((videoName, segmentIndex) => ({ segmentIndex, videoName })),
    },
  }]);

  const order = await selector.buildVideoOrder({
    clientId: 'c1',
    folder: 'skyline',
    files,
    segmentCount: 6,
    antiRepeatLookback: 3,
    deps: { listMediaJobs },
  });

  const picked = order.map((o) => o.videoName);
  assert.equal(picked.length, 6);
  // 12 clips, 6 of them just used -> the 6 unused ones must be chosen, zero overlap.
  for (const name of picked) assert.ok(!recentNames.includes(name), `${name} was reused despite a fresh pool`);
});

test('buildVideoOrder: ignores recent jobs from a different folder', async () => {
  const files = Array.from({ length: 6 }, (_, i) => clip(`c${i}.mov`));
  const listMediaJobs = async () => ([{
    type: 'video-remix',
    recipeFull: {
      sourceFolders: ['neighborhood'], // different folder — must not constrain skyline
      videoOrder: [{ segmentIndex: 0, videoName: 'c0.mov' }],
    },
  }]);
  const order = await selector.buildVideoOrder({
    clientId: 'c1', folder: 'skyline', files, segmentCount: 6, antiRepeatLookback: 3, deps: { listMediaJobs },
  });
  assert.equal(order.length, 6, 'all six clips remain available');
});

test('buildVideoOrder: a failing job read degrades to a plain shuffle instead of throwing', async () => {
  const files = Array.from({ length: 8 }, (_, i) => clip(`c${i}.mov`));
  const listMediaJobs = async () => { throw new Error('firestore down'); };
  const order = await selector.buildVideoOrder({
    clientId: 'c1', folder: 'skyline', files, segmentCount: 6, antiRepeatLookback: 3, deps: { listMediaJobs },
  });
  assert.equal(order.length, 6);
});

test('listRecentlyUsedClipNames: no clientId or no lookback yields an empty set', async () => {
  const listMediaJobs = async () => { throw new Error('should not be called'); };
  assert.equal((await selector.listRecentlyUsedClipNames(null, 'skyline', 3, { listMediaJobs })).size, 0);
  assert.equal((await selector.listRecentlyUsedClipNames('c1', 'skyline', 0, { listMediaJobs })).size, 0);
});

test('listRecentlyUsedClipNames: honors the lookback depth', async () => {
  const job = (names) => ({
    recipeFull: { sourceFolders: ['skyline'], videoOrder: names.map((videoName, segmentIndex) => ({ segmentIndex, videoName })) },
  });
  const listMediaJobs = async () => ([job(['a.mov']), job(['b.mov']), job(['c.mov'])]);
  const used = await selector.listRecentlyUsedClipNames('c1', 'skyline', 2, { listMediaJobs });
  assert.deepEqual([...used].sort(), ['a.mov', 'b.mov'], 'only the two most recent jobs count');
});
