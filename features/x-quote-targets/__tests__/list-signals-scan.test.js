import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTrackLists, trimListPosts, toCandidate, toListCandidate, buildListSignalsPayload, isListSignalsStale,
} from '../list-signals-scan.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
const cand = (id, author, score, hoursAgo = 1) => ({ id, author, score, createdAt: iso(hoursAgo), ageHours: hoursAgo });

test('collectTrackLists dedupes a list across tracks to the first track', () => {
  const out = collectTrackLists([
    { id: 'design', lists: [{ id: '1', label: 'A' }, { id: '2', label: 'B' }] },
    { id: 'music', lists: [{ id: '2', label: 'B2' }, { id: '3', label: 'C' }] },
    { id: 'none' },
  ]);
  assert.deepEqual(out, [
    { id: '1', label: 'A', trackId: 'design' },
    { id: '2', label: 'B', trackId: 'design' },
    { id: '3', label: 'C', trackId: 'music' },
  ]);
  assert.deepEqual(collectTrackLists(null), []);
});

test('trimListPosts drops posts older than 36h', () => {
  const out = trimListPosts([cand('a', 'u1', 1, 5), cand('b', 'u2', 2, 40)], { now: NOW });
  assert.deepEqual(out.map((c) => c.id), ['a']);
});

test('trimListPosts caps at 30 and orders by score', () => {
  const many = Array.from({ length: 50 }, (_, i) => cand(`p${i}`, `u${i}`, i));
  const out = trimListPosts(many, { now: NOW });
  assert.equal(out.length, 30);
  assert.equal(out[0].id, 'p49');
  assert.ok(out.every((c, i) => i === 0 || out[i - 1].score >= c.score));
});

test('trimListPosts caps one author at 40% of the kept set', () => {
  const posts = [
    ...Array.from({ length: 20 }, (_, i) => cand(`x${i}`, 'loud', 100 - i)),
    ...Array.from({ length: 20 }, (_, i) => cand(`y${i}`, `u${i}`, 10 - i * 0.1)),
  ];
  const out = trimListPosts(posts, { now: NOW });
  assert.equal(out.length, 30);
  assert.equal(out.filter((c) => c.author === 'loud').length, 12);
});

test('trimListPosts small sets: cap is at least 1 per author', () => {
  const out = trimListPosts([cand('a', 'u', 3), cand('b', 'u', 2), cand('c', 'v', 1)], { now: NOW });
  assert.deepEqual(out.map((c) => c.id), ['a', 'c']);
  assert.equal(trimListPosts([cand('a', 'u', 1), cand('b', 'u', 2)], { now: NOW }).length, 1);
  assert.deepEqual(trimListPosts(null, { now: NOW }), []);
});

const row = {
  post: { id: '9', text: 'hi   there', createdAt: iso(2), likeCount: 5, retweetCount: 1, replyCount: 2, author: { username: 'bob', name: 'Bob' } },
  ageHours: 2, engagement: 8, velocity: 4, windowOpen: true, vein: 'x', hasMedia: false, score: 0.5, reasons: ['r'],
};

test('toListCandidate = handle fields + trackId/listId/source/vein', () => {
  const base = toCandidate(row);
  assert.equal(base.url, 'https://x.com/bob/status/9');
  assert.equal(base.text, 'hi there');
  assert.equal(base.vein, 'x');
  const c = toListCandidate(row, { trackId: 'design', listId: '123' });
  assert.deepEqual(c, { ...base, vein: 'design', trackId: 'design', listId: '123', source: 'list' });
});

test('buildListSignalsPayload shape', () => {
  const p = buildListSignalsPayload({ generatedAt: 'g', byTrack: { t: { lists: [], posts: [] } } });
  assert.deepEqual(p, { generatedAt: 'g', method: 'bird list-timeline (local, free)', byTrack: { t: { lists: [], posts: [] } } });
  assert.deepEqual(buildListSignalsPayload({ generatedAt: 'g' }).byTrack, {});
});

test('isListSignalsStale', () => {
  assert.equal(isListSignalsStale(null, NOW), true);
  assert.equal(isListSignalsStale({ generatedAt: 123 }, NOW), true);
  assert.equal(isListSignalsStale({ generatedAt: 'nope' }, NOW), true);
  assert.equal(isListSignalsStale({ generatedAt: iso(1) }, NOW), false);
  assert.equal(isListSignalsStale({ generatedAt: iso(13) }, NOW), true);
});
