import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  assertXBudget, createMemoryUsageStore, dayKey, getXProjectUsage, instrumentXClient, readXUsage,
  recordXApiCall, setXPricing, setXUsageStore, withXUsage, XBudgetError, estimateUsd, normalizePricing,
} from '../index.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
let store;
beforeEach(() => { store = createMemoryUsageStore(); setXUsageStore(store); });

// Fake twitter-api-v2 client: NO network. Paginator-shaped results like the real library.
function fakeClient() {
  const calls = [];
  const paginator = (n) => ({ tweets: Array.from({ length: n }, (_, i) => ({ id: String(i) })), fetchNext: async function () { this.tweets.push({ id: 'x' }, { id: 'y' }); return this; } });
  const v2 = {
    async userByUsername(u) { calls.push(['userByUsername', u]); return { data: { id: '1', username: u } }; },
    async userTimeline(id) { calls.push(['userTimeline', id]); return paginator(5); },
    async search() { calls.push(['search']); return paginator(10); },
    async tweet() { calls.push(['tweet']); return { data: { id: '9' } }; },
    async get(path) { calls.push(['get', path]); return { data: [{ id: '1' }, { id: '2' }, { id: '3' }] }; },
    async boom() { throw Object.assign(new Error('nope'), { code: 403 }); },
    notAFunction: 'keep',
  };
  const v1 = { async uploadMedia() { calls.push(['v1.uploadMedia']); return 'mid'; } };
  return { client: { v1, v2, refresh() { return this === undefined ? 'bad' : 'ok'; } }, calls };
}

const day = () => store.readDays([dayKey(NOW)]).then((d) => d[0]);

test('recordXApiCall writes one doc per UTC day with source/endpoint/client counters', async () => {
  await recordXApiCall({ clientId: 'c1', endpoint: 'users/:id/tweets', kind: 'read', posts: 40, source: 'strategy-accounts' }, { now: NOW });
  await recordXApiCall({ clientId: 'c1', endpoint: 'users/by/username', kind: 'read', posts: 1, source: 'strategy-accounts' }, { now: NOW });
  await recordXApiCall({ clientId: null, endpoint: 'tweets', kind: 'write', posts: 1, source: 'posting', ok: false }, { now: NOW });
  const d = await day();
  assert.equal(d.calls, 3);
  assert.equal(d.readPosts, 40);
  assert.equal(d.userReads, 1);
  assert.equal(d.writes, 1);
  assert.equal(d.errors, 1);
  assert.equal(d.bySource['strategy-accounts'].calls, 2);
  assert.equal(d.byEndpoint.users_id_tweets.readPosts, 40);
  assert.equal(d.byClient.c1.calls, 2);
  assert.equal((await store.readDays(['2026-10-16'])).length, 0);
});

test('withXUsage tags calls; nested tag overrides only what it sets; writes default to posting', async () => {
  await withXUsage({ clientId: 'cA', source: 'quote-targets' }, async () => {
    await withXUsage({ source: 'x-monitor' }, () => recordXApiCall({ endpoint: 'users/me', posts: 1 }, { now: NOW }));
    await recordXApiCall({ endpoint: 'tweets/search/recent', posts: 10 }, { now: NOW });
  });
  await recordXApiCall({ endpoint: 'tweets', kind: 'write' }, { now: NOW });
  const d = await day();
  assert.equal(d.bySource['x-monitor'].calls, 1);
  assert.equal(d.bySource['quote-targets'].readPosts, 10);
  assert.equal(d.bySource.posting.writes, 1);
  assert.equal(d.byClient.cA.calls, 2);
});

test('instrumented client records every v2/v1 call with endpoint, kind and returned counts', async () => {
  const { client, calls } = fakeClient();
  const c = instrumentXClient(client, { record: (x) => recordXApiCall(x, { now: NOW }) });
  await withXUsage({ clientId: 'c1', source: 'strategy-accounts' }, async () => {
    await c.v2.userByUsername('someone');
    const tl = await c.v2.userTimeline('1');
    assert.equal(tl.tweets.length, 5);
    await tl.fetchNext(); // follow-up page is a real HTTP call: counted, +2 new posts
    await c.v2.search('q');
    await c.v2.get('users/12345678/tweets', {});
  });
  await c.v2.tweet({ text: 'hi' });
  await c.v1.uploadMedia(Buffer.from('x'));
  assert.equal(calls.length, 7 - 1); // fetchNext is not in `calls`
  const d = await day();
  assert.equal(d.calls, 7);
  assert.equal(d.byEndpoint.users_by_username.userReads, 1);
  assert.equal(d.byEndpoint.users_id_tweets.readPosts, 5 + 2 + 3); // timeline + fetchNext + raw get
  assert.equal(d.byEndpoint.tweets_search_recent.readPosts, 10);
  assert.equal(d.byEndpoint.tweets.writes, 1);
  assert.equal(d.byEndpoint.media_upload.writes, 1);
  assert.equal(d.bySource['strategy-accounts'].calls, 5);
  assert.equal(d.bySource.posting.writes, 2);
});

test('failed calls are counted as errors and the error still propagates; non-methods pass through; idempotent', async () => {
  const { client } = fakeClient();
  const c = instrumentXClient(client, { record: (x) => recordXApiCall(x, { now: NOW }) });
  await assert.rejects(() => c.v2.boom(), /nope/);
  assert.equal(c.v2.notAFunction, 'keep');
  assert.equal(c.refresh(), 'ok');
  assert.equal(instrumentXClient(c), c);
  const d = await day();
  assert.equal(d.errors, 1);
});

test('a broken ledger store never breaks the X call', async () => {
  setXUsageStore({ increment: async () => { throw new Error('firestore down'); }, readDays: async () => [], getPricing: async () => null });
  const { client } = fakeClient();
  const c = instrumentXClient(client);
  const orig = console.error; console.error = () => {};
  try { assert.equal((await c.v2.userByUsername('a')).data.id, '1'); } finally { console.error = orig; }
});

test('pricing: no rate set => null dollars; only set rates contribute; invalid values are ignored', async () => {
  const none = normalizePricing({});
  assert.equal(estimateUsd({ readPosts: 100, userReads: 5, writes: 2 }, none), null);
  const some = normalizePricing({ perPostReadUsd: '0.005', perUserLookupUsd: 'abc', dailyReadCap: '200.9', sourceCaps: { 'quote-targets': 50, bad: -1 } });
  assert.equal(some.perUserLookupUsd, null);
  assert.equal(some.dailyReadCap, 200);
  assert.deepEqual(some.sourceCaps, { 'quote-targets': 50 });
  assert.equal(estimateUsd({ readPosts: 100, userReads: 5, writes: 2 }, some), 0.5);
});

test('assertXBudget refuses past the daily cap and the per-source cap; allows when no cap', async () => {
  await assertXBudget({ source: 'quote-targets', estimatePosts: 99999 }, { now: NOW }); // no cap set
  await setXPricing({ dailyReadCap: 100, sourceCaps: { 'quote-targets': 30 } });
  await recordXApiCall({ endpoint: 'users/:id/tweets', posts: 60, source: 'strategy-accounts' }, { now: NOW });
  await assertXBudget({ source: 'strategy-accounts', estimatePosts: 40 }, { now: NOW });
  await assert.rejects(() => assertXBudget({ source: 'strategy-accounts', estimatePosts: 41 }, { now: NOW }), (e) => e instanceof XBudgetError && e.code === 'x-budget' && e.scope === 'daily');
  await assert.rejects(() => assertXBudget({ source: 'quote-targets', estimatePosts: 31 }, { now: NOW }), (e) => e.code === 'x-budget' && e.scope === 'source');
  // yesterday's reads do not count against today
  await recordXApiCall({ endpoint: 'users/:id/tweets', posts: 500, source: 'other' }, { now: NOW - 86400_000 });
  await assertXBudget({ source: 'strategy-accounts', estimatePosts: 40 }, { now: NOW });
});

test('readXUsage: today/month/byDay/bySource/cap/est; dollars only with a rate', async () => {
  await recordXApiCall({ endpoint: 'users/:id/tweets', posts: 40, source: 'strategy-accounts' }, { now: NOW });
  await recordXApiCall({ endpoint: 'users/:id/tweets', posts: 10, source: 'quote-targets' }, { now: NOW - 86400_000 });
  await recordXApiCall({ endpoint: 'users/:id/tweets', posts: 7, source: 'quote-targets' }, { now: Date.parse('2026-09-30T10:00:00Z') });
  let u = await readXUsage({ days: 7, now: NOW });
  assert.equal(u.today.readPosts, 40);
  assert.equal(u.month.readPosts, 50); // October only
  assert.equal(u.month.estUsd, null);
  assert.equal(u.ratesSet, false);
  assert.equal(u.byDay.length, 7);
  assert.equal(u.byDay.at(-1).day, '2026-10-17');
  assert.equal(u.bySource['quote-targets'].readPosts, 10);
  assert.equal(u.cap.remainingToday, null);
  await setXPricing({ perPostReadUsd: 0.01, dailyReadCap: 100 });
  u = await readXUsage({ days: 7, now: NOW });
  assert.equal(u.month.estUsd, 0.5);
  assert.equal(u.today.estUsd, 0.4);
  assert.equal(u.cap.remainingToday, 60);
});

test('getXProjectUsage stores the injected answer (no real call); readXUsage surfaces it', async () => {
  const usage = await getXProjectUsage({ fetchUsage: async () => ({ project_usage: '120', project_cap: '10000' }), now: NOW });
  assert.equal(usage.project_cap, '10000');
  const u = await readXUsage({ now: NOW });
  assert.equal(u.projectUsage.project_usage, '120');
  assert.equal(u.projectUsage.checkedAt, NOW);
});
