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

// ── clip freshness (age-weighted sampling, LRU reuse, wider job window) ─────

/** Small deterministic PRNG (mulberry32) for statistical tests. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.parse('2026-06-01T00:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

test('freshnessWeight: floor, half-life, missing and invalid timestamps', () => {
  const { FRESHNESS_WEIGHT_FLOOR: FLOOR, FRESHNESS_HALF_LIFE_DAYS: HL } = selector;
  assert.equal(FLOOR, 0.25);
  assert.equal(HL, 45);
  assert.ok(Math.abs(selector.freshnessWeight(daysAgo(0), NOW) - 1) < 1e-9);
  assert.ok(Math.abs(selector.freshnessWeight(daysAgo(45), NOW) - (FLOOR + (1 - FLOOR) / 2)) < 1e-9);
  assert.ok(Math.abs(selector.freshnessWeight(daysAgo(3650), NOW) - FLOOR) < 1e-6);
  assert.equal(selector.freshnessWeight(null, NOW), FLOOR);
  assert.equal(selector.freshnessWeight('not-a-date', NOW), FLOOR);
  // future timestamps clamp to age 0
  assert.ok(Math.abs(selector.freshnessWeight(daysAgo(-10), NOW) - 1) < 1e-9);
});

test('orderClipsFreshFirst: age-0 clip beats age-365 clip about 4:1 over 10k draws', () => {
  const rng = mulberry32(12345);
  const files = [
    { ...clip('new.mov'), timeCreated: daysAgo(0) },
    { ...clip('old.mov'), timeCreated: daysAgo(365) },
  ];
  let newFirst = 0;
  const draws = 10000;
  for (let i = 0; i < draws; i += 1) {
    if (selector.orderClipsFreshFirst(files, new Map(), rng, NOW)[0].name === 'new.mov') newFirst += 1;
  }
  // P(new first) = w_new / (w_new + w_old); w_old ~ 0.25 + 0.75*2^(-8.1) ~ 0.253.
  const ratio = newFirst / (draws - newFirst);
  assert.ok(ratio > 3.6 && ratio < 4.4, `ratio ${ratio.toFixed(2)} not near 4`);
});

test('orderClipsFreshFirst: missing timeCreated is weighted like an ancient clip', () => {
  const rng = mulberry32(777);
  const files = [
    { ...clip('new.mov'), timeCreated: daysAgo(0) },
    clip('unknown.mov'),
  ];
  let newFirst = 0;
  for (let i = 0; i < 10000; i += 1) {
    if (selector.orderClipsFreshFirst(files, new Map(), rng, NOW)[0].name === 'new.mov') newFirst += 1;
  }
  const ratio = newFirst / (10000 - newFirst);
  assert.ok(ratio > 3.6 && ratio < 4.4, `ratio ${ratio.toFixed(2)} not near 4`);
});

test('orderClipsFreshFirst: reused clips come last, least-recently-used first', () => {
  const files = [clip('a.mov'), clip('b.mov'), clip('c.mov'), clip('fresh.mov')];
  // b used by the newest job (0), a two jobs ago (2), c one job ago (1).
  const usage = new Map([['b.mov', 0], ['c.mov', 1], ['a.mov', 2]]);
  const out = selector.orderClipsFreshFirst(files, usage, mulberry32(1), NOW).map((f) => f.name);
  assert.deepEqual(out, ['fresh.mov', 'a.mov', 'c.mov', 'b.mov']);
});

test('buildVideoOrder: pool >= lookback*6 yields zero overlap with the recently-used set', async () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ ...clip(`c${i}.mov`), timeCreated: daysAgo(i) }));
  const jobs = Array.from({ length: 10 }, (_, j) => ({
    recipeFull: {
      sourceFolders: ['skyline'],
      videoOrder: Array.from({ length: 6 }, (_, k) => ({ segmentIndex: k, videoName: `c${j * 6 + k}.mov` })),
    },
  }));
  const used = new Set(jobs.flatMap((j) => j.recipeFull.videoOrder.map((o) => o.videoName)));
  assert.equal(used.size, 60);
  for (let seed = 1; seed <= 50; seed += 1) {
    const order = await selector.buildVideoOrder({
      clientId: 'c1', folder: 'skyline', files, segmentCount: 6, antiRepeatLookback: 10,
      rng: mulberry32(seed), now: NOW, deps: { listMediaJobs: async () => jobs },
    });
    for (const o of order) assert.ok(!used.has(o.videoName), `${o.videoName} reused (seed ${seed})`);
  }
});

test('listRecentClipUsage: records most recent use index per clip', async () => {
  const job = (names) => ({
    recipeFull: { sourceFolders: ['skyline'], videoOrder: names.map((videoName, segmentIndex) => ({ segmentIndex, videoName })) },
  });
  const listMediaJobs = async () => ([job(['a.mov', 'b.mov']), job(['b.mov', 'c.mov']), job(['d.mov'])]);
  const usage = await selector.listRecentClipUsage('c1', 'skyline', 2, { listMediaJobs });
  assert.deepEqual([...usage.entries()], [['a.mov', 0], ['b.mov', 0], ['c.mov', 1]]);
});

test('listRecentClipUsage: listMediaJobs limit = clamp(lookback*4, 20, 60)', async () => {
  const limits = [];
  const listMediaJobs = async (_c, opts) => { limits.push(opts.limit); return []; };
  for (const n of [1, 3, 10, 15, 100]) {
    await selector.listRecentClipUsage('c1', 'skyline', n, { listMediaJobs });
  }
  assert.deepEqual(limits, [20, 20, 40, 60, 60]);
});

test('eligibleClips/buildVideoOrder: names invalid for videoOrder are never picked and 6 still fill', async () => {
  const bad = ["it's.mov", 'clip–dash.mov', 'a..b.mov', 'café.mov', 'x/y.mov', 'back\\slash.mov'];
  const good = Array.from({ length: 8 }, (_, i) => clip(`ok ${i}.mov`));
  const files = [...bad.map((n) => clip(n)), ...good];
  assert.deepEqual(selector.eligibleClips(files, 0).map((f) => f.name), good.map((f) => f.name));
  for (let seed = 1; seed <= 20; seed += 1) {
    const order = await selector.buildVideoOrder({ clientId: 'c1', folder: 'skyline', files, segmentCount: 6, rng: mulberry32(seed), now: NOW });
    assert.equal(order.length, 6);
    for (const o of order) assert.ok(!bad.includes(o.videoName));
  }
});

test('non-finite injected now falls back to Date.now()', () => {
  const f = { ...clip('a.mov'), timeCreated: new Date().toISOString() };
  for (const bad of [NaN, undefined, 'x', Infinity]) {
    const w = selector.freshnessWeight(f.timeCreated, bad);
    assert.ok(Number.isFinite(w) && w > 0.99, `weight ${w} for now=${bad}`);
  }
});
