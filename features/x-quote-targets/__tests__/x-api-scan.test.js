import test from 'node:test';
import assert from 'node:assert/strict';
import { scanQuoteTargetsViaXApi, estimateQuoteScan, SCAN_METHOD } from '../x-api-scan.js';
import { buildQuoteTargetsPayload } from '../scan-core.js';
import { createMemoryUserIdCache } from '../../x-strategy/x-api-pull.js';
import { XBudgetError } from '../../x-api-usage/index.js';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const WL = [{ handle: 'alpha', vein: 'design' }, { handle: 'beta', vein: 'design' }, { handle: 'gamma', vein: 'music', unproven: true }];
const hrs = (h) => new Date(NOW - h * 3_600_000).toISOString();
const post = (id, h, likes) => ({ id, text: `post ${id}`, created_at: hrs(h), public_metrics: { like_count: likes, retweet_count: 5, reply_count: 2 } });

function client({ timelines = {}, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    v2: {
      async userByUsername(h) { calls.push(['lookup', h]); return { data: { id: `id-${h}`, username: h, name: `N ${h}` } }; },
      async userTimeline(id, params) {
        calls.push(['timeline', id, params]);
        const h = id.replace('id-', '');
        if (fail[h]) throw fail[h];
        return { data: { data: timelines[h] || [], meta: {} } };
      },
    },
  };
}
const usage = () => { const tags = []; return { tags, withXUsage: (t, fn) => { tags.push(t); return fn(); }, assertXBudget: async () => {} }; };

test('scan: only the 36h window is requested (start_time), tagged quote-targets, payload written with source x-api', async () => {
  const c = client({ timelines: { alpha: [post('1', 2, 400), post('2', 5, 50)], beta: [post('3', 1, 900)] } });
  const written = [];
  const u = usage();
  const r = await scanQuoteTargetsViaXApi('c1', { watchlist: WL, client: c, usage: u, now: () => NOW, maxAccounts: 2, userIdCache: createMemoryUserIdCache(), writePayload: async (id, p) => written.push([id, p]) });
  assert.equal(r.ok, true);
  assert.equal(r.wrote, true);
  const tl = c.calls.filter((x) => x[0] === 'timeline');
  assert.equal(tl.length, 2); // proven first, capped at 2
  assert.equal(tl[0][2].start_time, '2026-10-16T00:00:00.000Z'); // now - 36h
  assert.deepEqual(tl[0][2].exclude, ['retweets']);
  assert.equal(tl[0][2].max_results, 12);
  assert.deepEqual(u.tags[0], { clientId: 'c1', source: 'quote-targets' });
  assert.equal(r.calls, 4); // 2 lookups + 2 timelines
  const [, payload] = written[0];
  assert.equal(payload.source, 'x-api');
  assert.equal(payload.method, SCAN_METHOD);
  assert.equal(payload.windowHours, 36);
  assert.equal(payload.candidates[0].author, 'beta');
  assert.equal(payload.candidates[0].url, 'https://x.com/beta/status/3');
});

test('scan: payload keys are the bird scan\'s keys (+ source); candidate keys identical', () => {
  const birdKeys = ['generatedAt', 'method', 'windowHours', 'scanned', 'succeeded', 'pooled', 'failures', 'rateLimited', 'candidates'];
  const p = buildQuoteTargetsPayload({ pool: [], watchlist: [], scanned: 0, failures: [], rateLimited: [], method: 'm', limit: 12, windowHours: 36 });
  assert.deepEqual(Object.keys(p), birdKeys);
  const pool = [{ id: '1', text: 't', createdAt: hrs(2), likeCount: 300, retweetCount: 1, replyCount: 1, author: { username: 'a' }, media: [] }];
  const withPost = buildQuoteTargetsPayload({ pool, watchlist: [], scanned: 1, failures: [], rateLimited: [], method: 'm', limit: 12, windowHours: 36, now: NOW });
  assert.deepEqual(Object.keys(withPost.candidates[0]).sort(), ['ageHours', 'author', 'authorName', 'createdAt', 'engagement', 'hasMedia', 'id', 'likes', 'reasons', 'replies', 'reposts', 'score', 'text', 'url', 'velocity', 'vein', 'windowOpen'].sort());
});

test('scan: user ids cached across runs (no repeat lookup)', async () => {
  const cache = createMemoryUserIdCache();
  const base = { watchlist: WL.slice(0, 1), usage: usage(), now: () => NOW, userIdCache: cache, writePayload: async () => {} };
  const c1 = client({ timelines: { alpha: [post('1', 1, 100)] } });
  await scanQuoteTargetsViaXApi('c1', { ...base, client: c1 });
  const c2 = client({ timelines: { alpha: [post('1', 1, 100)] } });
  const r2 = await scanQuoteTargetsViaXApi('c1', { ...base, client: c2 });
  assert.equal(c2.calls.filter((x) => x[0] === 'lookup').length, 0);
  assert.equal(r2.calls, 1);
});

test('scan: budget refusal and 429 stop the run; all-failed never overwrites the stored scan', async () => {
  const written = [];
  const c = client();
  const denied = { withXUsage: (t, fn) => fn(), assertXBudget: async () => { throw new XBudgetError('cap'); } };
  const r = await scanQuoteTargetsViaXApi('c1', { watchlist: WL, client: c, usage: denied, now: () => NOW, writePayload: async (...a) => written.push(a) });
  assert.equal(r.ok, false);
  assert.equal(r.stopped, 'x-budget');
  assert.equal(c.calls.length, 0);
  assert.equal(written.length, 0);

  const c2 = client({ fail: { alpha: Object.assign(new Error('429'), { code: 429 }) } });
  const r2 = await scanQuoteTargetsViaXApi('c1', { watchlist: WL, client: c2, usage: usage(), now: () => NOW, writePayload: async (...a) => written.push(a) });
  assert.equal(r2.stopped, 'rate-limited');
  assert.equal(r2.wrote, false);
  assert.equal(written.length, 0);
  assert.equal(c2.calls.filter((x) => x[0] === 'timeline').length, 1); // beta/gamma never requested
});

test('scan: empty watchlist skips with nothing written; dry run (write:false) writes nothing', async () => {
  const none = await scanQuoteTargetsViaXApi('c1', { watchlist: [], client: client(), usage: usage() });
  assert.equal(none.skipped, 'no-watchlist');
  const c = client({ timelines: { alpha: [post('1', 1, 100)] } });
  const dry = await scanQuoteTargetsViaXApi('c1', { watchlist: WL.slice(0, 1), client: c, usage: usage(), now: () => NOW, write: false });
  assert.equal(dry.ok, true);
  assert.equal(dry.wrote, false);
});

test('estimateQuoteScan formula', () => {
  assert.deepEqual(estimateQuoteScan({ accounts: 20, perHandle: 12 }), { accounts: 15, lookups: 15, timelineCalls: 15, calls: 30, maxPosts: 180 });
});
