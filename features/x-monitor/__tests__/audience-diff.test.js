import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chunkUsers,
  compactUser,
  diffRosters,
  engagementRate,
  flattenRoster,
  postMetricDeltas,
  snapshotDeltas,
  snapshotSeries,
} from '../audience-diff.js';

const user = (id, extra = {}) => ({ id, username: `u${id}`, name: `User ${id}`, ...extra });
const roster = (...ids) => new Map(ids.map((id) => [String(id), user(String(id))]));

test('first sync is a baseline — it never reports 500 followers as 500 gains', () => {
  const diff = diffRosters(new Map(), roster(1, 2, 3));
  assert.equal(diff.baseline, true);
  assert.deepEqual(diff.gained, []);
  assert.deepEqual(diff.lost, []);
});

test('reports who arrived and who left between two complete rosters', () => {
  const diff = diffRosters(roster(1, 2, 3), roster(2, 3, 4));
  assert.deepEqual(diff.gained.map((u) => u.id), ['4']);
  assert.deepEqual(diff.lost.map((u) => u.id), ['1']);
  assert.equal(diff.lossesSuppressed, false);
});

test('a truncated fetch cannot manufacture unfollows', () => {
  // 1000 of 3000 followers came back. Without the guard, 2000 people who were
  // simply never fetched would be written to the timeline as unfollows.
  const diff = diffRosters(roster(1, 2, 3), roster(1, 4), { nextComplete: false });
  assert.deepEqual(diff.lost, []);
  assert.equal(diff.lossesSuppressed, true);
  assert.deepEqual(diff.gained.map((u) => u.id), ['4'], 'new arrivals are still real');
});

test('an incomplete stored roster also suppresses losses on the next sync', () => {
  const diff = diffRosters(roster(1, 2), roster(1, 2, 3), { prevComplete: false });
  assert.equal(diff.lossesSuppressed, true);
});

test('roster chunking round-trips through storage shape', () => {
  const users = Array.from({ length: 950 }, (_, i) => user(String(i)));
  const chunks = chunkUsers(users, 400);
  assert.deepEqual(chunks.map((c) => c.users.length), [400, 400, 150]);
  assert.equal(flattenRoster(chunks).size, 950);
});

test('compactUser keeps only the fields the audience panel renders', () => {
  const compact = compactUser({
    id: 7,
    username: 'someone',
    name: 'Some One',
    profile_image_url: 'https://x/img.jpg',
    description: 'x'.repeat(400),
    public_metrics: { followers_count: 12, following_count: 3, tweet_count: 44 },
  });
  assert.equal(compact.id, '7');
  assert.equal(compact.followers, 12);
  assert.equal(compact.bio.length, 220, 'bio is clamped so a roster chunk stays under 1MB');
});

test('snapshot deltas return null for a window with no old-enough snapshot', () => {
  const snapshots = [
    { date: '2026-09-01', followers: 100, following: 50, posts: 10 },
    { date: '2026-09-08', followers: 140, following: 52, posts: 18 },
  ];
  const out = snapshotDeltas(snapshots, [1, 7, 30]);
  assert.equal(out.latest.date, '2026-09-08');
  assert.equal(out.windows[7].followers, 40);
  assert.equal(out.windows[30], null, 'unknown must read as unknown, not zero');
});

test('series marks the first point as unknown net change', () => {
  const series = snapshotSeries([
    { date: '2026-09-02', followers: 120 },
    { date: '2026-09-01', followers: 100 },
  ]);
  assert.deepEqual(series.map((p) => p.date), ['2026-09-01', '2026-09-02']);
  assert.equal(series[0].net, null);
  assert.equal(series[1].net, 20);
});

test('engagement rate is null without impressions', () => {
  assert.equal(engagementRate({ likes: 5, retweets: 1 }), null);
  assert.equal(engagementRate({ likes: 5, retweets: 5, impressions: 1000 }), 0.01);
});

test('post deltas compare the two newest history entries', () => {
  const out = postMetricDeltas([
    { at: 1, likes: 2, impressions: 100 },
    { at: 2, likes: 5, impressions: 400 },
  ]);
  assert.equal(out.deltas.likes, 3);
  assert.equal(out.deltas.impressions, 300);
  assert.equal(postMetricDeltas([{ at: 1, likes: 2 }]), null);
});
