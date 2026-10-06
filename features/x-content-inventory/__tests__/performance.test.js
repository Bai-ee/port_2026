import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPerformance, engineStats, valueScore, median, MIN_N } from '../performance.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const day = (d) => new Date(NOW - d * 86_400_000).toISOString();
const post = (id, engine, d, extra = {}) => ({ id: `p${id}`, twitterId: `t${id}`, status: 'posted', engine, postedAt: day(d), ...extra });
const m = (views, likes = 0, replies = 0, reposts = 0, quotes = 0) => ({ views, likes, replies, reposts, quotes, capturedAt: day(0) });

test('valueScore uses verified weights', () => {
  assert.equal(valueScore({ replies: 2, quotes: 1, reposts: 3, likes: 4 }), 10 + 5 + 3 + 2);
  assert.equal(valueScore(null), null);
});

test('median handles empty, odd, even', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('joinPerformance joins by twitterId, falls back to package engine/series, skips unposted', () => {
  const rows = joinPerformance({
    posts: [
      post(1, 'record', 1, { packageId: 'k1' }),
      { id: 'pX', twitterId: null, status: 'posted' },
      { id: 'pY', twitterId: 'tY', status: 'draft' },
      { id: 'p2', twitterId: 't2', status: 'posted', packageId: 'k2', postedAt: day(2) },
      post(3, undefined, 1),
    ],
    timeline: { t1: m(100, 4), t2: m(50) },
    packages: [{ id: 'k2', series: 'C7' }],
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].metrics.views, 100);
  assert.equal(rows[0].valueScore, 2);
  assert.equal(rows[1].engine, 'identity');
  assert.equal(rows[1].series, 'C7');
  assert.equal(rows[2].metrics, null);
  assert.equal(rows[2].engine, 'untagged');
  assert.ok(rows[0].ageHoursAtCapture > 0);
});

test('joinPerformance falls back to stored post.performance and array timelines', () => {
  const rows = joinPerformance({
    posts: [post(1, 'ue', 1, { performance: m(9) }), post(2, 'ue', 1)],
    timeline: [{ id: 't2', views: 7, likes: 1 }],
  });
  assert.equal(rows[0].metrics.views, 9);
  assert.equal(rows[1].metrics.views, 7);
});

test('n<5 is insufficient: no rank, no best/worst, no trend', () => {
  const posts = [1, 2, 3, 4].map((i) => post(i, 'ue', 1));
  const timeline = Object.fromEntries(posts.map((p, i) => [p.twitterId, m(100 * (i + 1))]));
  const s = engineStats(joinPerformance({ posts, timeline }), { windowDays: 30, now: NOW });
  assert.equal(s.engines.ue.n, 4);
  assert.equal(s.engines.ue.insufficient, true);
  assert.equal(s.engines.ue.rank, null);
  assert.equal(s.engines.ue.best, null);
  assert.equal(s.engines.ue.trend.state, 'insufficient');
  assert.equal(s.engines.ue.medianViews, 250);
});

test('ranks only sufficient engines, trend vs previous window, reply rate', () => {
  const posts = []; const timeline = {};
  const add = (id, engine, d, met) => { const p = post(id, engine, d); posts.push(p); timeline[p.twitterId] = met; };
  for (let i = 0; i < MIN_N; i++) add(`r${i}`, 'record', 2 + i, m(200, 0, 1)); // current, higher
  for (let i = 0; i < MIN_N; i++) add(`rp${i}`, 'record', 35 + i, m(100));      // previous
  for (let i = 0; i < MIN_N; i++) add(`i${i}`, 'identity', 3 + i, m(50, 10, 2)); // value 10+5=15 > record 5
  for (let i = 0; i < 2; i++) add(`u${i}`, 'ue', 1, m(9999, 99));                 // tiny n, huge numbers
  const s = engineStats(joinPerformance({ posts, timeline }), { windowDays: 30, now: NOW });
  assert.equal(s.engines.record.trend.state, 'up');
  assert.equal(s.engines.record.trend.pct, 100);
  assert.equal(s.engines.record.replyRate, 5); // replies per 1,000 views
  assert.equal(s.engines.identity.rank, 1);
  assert.equal(s.engines.record.rank, 2);
  assert.equal(s.engines.ue.rank, null);
  assert.equal(s.engines.record.best.views, 200);
  assert.equal(s.series.untagged.n >= 0, true);
});

test('unmeasured posts are counted, not treated as zero views', () => {
  const rows = joinPerformance({ posts: [post(1, 'record', 1)] });
  const s = engineStats(rows, { windowDays: 30, now: NOW });
  assert.equal(s.unmeasured, 1);
  assert.equal(s.engines.record.medianViews, null);
});
