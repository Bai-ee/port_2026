import assert from 'node:assert/strict';
import test from 'node:test';

import { relativeTime, windowTotals, withinRange } from '../post-window.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test('withinRange accepts fractional days (1.5 = 36h)', () => {
  assert.equal(withinRange(hoursAgo(35), 1.5, NOW), true);
  assert.equal(withinRange(hoursAgo(37), 1.5, NOW), false);
  assert.equal(withinRange(hoursAgo(9999), 0, NOW), true);
  assert.equal(withinRange('garbage', 7, NOW), false);
});

test('withinRange {sinceMs} filters by timestamp; missing sinceMs means all', () => {
  assert.equal(withinRange(hoursAgo(1), { sinceMs: NOW - 2 * 3_600_000 }, NOW), true);
  assert.equal(withinRange(hoursAgo(3), { sinceMs: NOW - 2 * 3_600_000 }, NOW), false);
  assert.equal(withinRange(hoursAgo(3), { sinceMs: undefined }, NOW), true);
});

test('windowTotals sums only posts in the window and computes ER', () => {
  const posts = [
    { createdAt: hoursAgo(5), metrics: { impressions: 1000, likes: 10, retweets: 5, replies: 3, quotes: 1, bookmarks: 1 } },
    { createdAt: hoursAgo(30), metrics: { impressions: 1000, likes: 20 } },
    { createdAt: hoursAgo(100), metrics: { impressions: 5000, likes: 99 } },
  ];
  const t = windowTotals(posts, 1.5, null, NOW);
  assert.equal(t.posts, 2);
  assert.equal(t.impressions, 2000);
  assert.equal(t.likes, 30);
  assert.equal(t.replies, 3);
  assert.equal(t.er, (30 + 5 + 3 + 1 + 1) / 2000);
});

test('windowTotals: impressions null when no post in window reports one', () => {
  const t = windowTotals([{ createdAt: hoursAgo(1), metrics: { likes: 4 } }], 7, null, NOW);
  assert.equal(t.impressions, null);
  assert.equal(t.er, null);
  assert.equal(t.likes, 4);
});

test("windowTotals 'sync' uses sync.postsAt", () => {
  const posts = [{ createdAt: hoursAgo(1), metrics: { impressions: 10 } }, { createdAt: hoursAgo(10), metrics: { impressions: 10 } }];
  assert.equal(windowTotals(posts, 'sync', { postsAt: NOW - 2 * 3_600_000 }, NOW).posts, 1);
  assert.equal(windowTotals(posts, 'sync', null, NOW).posts, 2);
});

test('relativeTime', () => {
  assert.equal(relativeTime(NOW - 10_000, NOW), 'just now');
  assert.equal(relativeTime(NOW - 5 * 60_000, NOW), '5 min ago');
  assert.equal(relativeTime(NOW - 3 * 3_600_000, NOW), '3 h ago');
  assert.equal(relativeTime(NOW - 72 * 3_600_000, NOW), '3 d ago');
  assert.equal(relativeTime(undefined, NOW), null);
});
