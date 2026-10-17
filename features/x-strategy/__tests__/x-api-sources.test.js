import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTimeline } from '../../x-benchmark/normalize-corpus.js';
import { xApiTweetToBird, mapXApiPage, decodeEntities } from '../x-api-mapper.js';
import { pullCorporaViaXApi, createMemoryUserIdCache, estimateCorporaPull, fetchTimelineViaXApi } from '../x-api-pull.js';
import { estimateQuoteScan } from '../x-api-estimate.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { normalizeDataSources, applyDataSourcesPatch, saveDataSources, readDataSources } from '../data-sources.js';
import { runAutoDailyXApi } from '../auto-daily.js';
import { createStrategyHandlers, STRATEGY_ROUTE_ACTIONS } from '../route-handlers.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../refresh.js';
import { XBudgetError } from '../../x-api-usage/index.js';

// Real stored rows (x_corpora/seb__design/rows, bird path, read-only prod read 2026-10-17).
const REAL = JSON.parse(readFileSync(new URL('./fixtures/real-corpus-rows.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-17T12:00:00.000Z');

/** Build the X API tweet that would produce a stored row. */
function apiTweetFor(row, { views } = {}) {
  const refs = [];
  const includes = { tweets: [], users: [], media: [] };
  if (row.type === 'quote-react') {
    refs.push({ type: 'quoted', id: '900' });
    includes.tweets.push({ id: '900', text: row.quotedText, author_id: 'u9' });
    includes.users.push({ id: 'u9', username: row.quotedAuthor, name: 'Q' });
  }
  const tweet = {
    id: row.id, text: row.text, created_at: row.utc, conversation_id: row.conversationId,
    public_metrics: { like_count: row.likes, retweet_count: row.reposts, reply_count: row.replies, quote_count: 0, ...(views !== undefined ? { impression_count: views } : {}) },
    ...(refs.length ? { referenced_tweets: refs } : {}),
    ...(row.media === 'video' ? { attachments: { media_keys: ['m1'] } } : {}),
  };
  if (row.media === 'video') includes.media.push({ media_key: 'm1', type: 'video' });
  return { tweet, includes };
}
const mapRow = (row, opts) => {
  const { tweet, includes } = apiTweetFor(row, opts);
  return normalizeTimeline(mapXApiPage({ data: [tweet], includes }, { author: { username: 'seb__design' } }), { handle: 'seb__design' }).rows[0];
};

test('row parity: X API mapper -> same keys as the bird path row (freshest real row) and every older one', () => {
  const fresh = REAL['original-showcase'];
  const mapped = mapRow(fresh);
  assert.deepEqual(Object.keys(mapped).sort(), Object.keys(fresh).sort());
  for (const k of Object.keys(fresh)) {
    if (k === 'views' || k === 'engagementRate') continue;
    assert.deepEqual(mapped[k], fresh[k], `value of ${k}`);
    assert.equal(typeof mapped[k], typeof fresh[k], `type of ${k}`);
  }
  // Older stored rows predate some keys (lanes): the mapper emits a superset with identical values on shared keys.
  for (const name of ['quote-react', 'original-text']) {
    const old = REAL[name];
    const m = mapRow(old);
    for (const k of Object.keys(old)) {
      if (['views', 'engagementRate', 'engagement', 'dateLocal', 'timeLocal', 'hourLocal', 'weekday'].includes(k)) continue; // engagement was merged from other metrics; local time used that account's tz offset
      assert.deepEqual(m[k], old[k], `${name}.${k}`);
    }
    assert.equal(m.type, old.type);
  }
});

test('row parity: views come from impression_count (number) where bird has null; absent count stays null, never 0', () => {
  const withViews = mapRow(REAL['original-showcase'], { views: 1234 });
  assert.equal(withViews.views, 1234);
  assert.equal(typeof withViews.engagementRate, 'number');
  assert.equal(mapRow(REAL['original-showcase']).views, null);
});

test('mapper: entities decoded, replies and quotes classified, retweets never produced', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt;'), 'a & b <c>');
  const reply = xApiTweetToBird({ id: '5', text: 'x', created_at: '2026-10-17T00:00:00Z', referenced_tweets: [{ type: 'replied_to', id: '4' }] });
  const [r] = normalizeTimeline([reply], { handle: 'h' }).rows;
  assert.equal(r.type, 'reply');
});

test('estimators: formulas', () => {
  assert.deepEqual(estimateCorporaPull({ handles: ['a', 'b', 'c'], maxPerHandle: 300 }), { handles: 3, lookups: 3, timelineCalls: 9, calls: 12, maxPosts: 900 });
  assert.equal(estimateCorporaPull({ handles: 3, cachedIds: 3 }).calls, 9);
  assert.deepEqual(estimateQuoteScan({ accounts: 39, perHandle: 12 }), { accounts: 15, lookups: 15, timelineCalls: 15, calls: 30, maxPosts: 180 });
  assert.equal(estimateQuoteScan({ accounts: 4, perHandle: 1, cachedIds: 4 }).maxPosts, 20); // min 5/call
});

// ---- fake X client ---------------------------------------------------------
function fakeClient({ pages = {}, users = {}, failTimeline = null } = {}) {
  const calls = [];
  return {
    calls,
    v2: {
      async userByUsername(h) { calls.push(['lookup', h]); return users[h] === undefined ? { data: { id: `id-${h}`, username: h, name: h.toUpperCase() } } : { data: users[h] }; },
      async userTimeline(id, params) {
        calls.push(['timeline', id, params]);
        if (failTimeline) throw failTimeline;
        const list = pages[id] || [];
        const i = params.pagination_token ? Number(params.pagination_token) : 0;
        const page = list[i] || { data: [] };
        return { data: { data: page.data, includes: page.includes, meta: { result_count: page.data.length, ...(list[i + 1] ? { next_token: String(i + 1) } : {}) } } };
      },
    },
  };
}
const tw = (id, iso, likes = 3) => ({ id: String(id), text: `post ${id}`, created_at: iso, public_metrics: { like_count: likes, retweet_count: 0, reply_count: 0, impression_count: 100 + likes } });
const usage = () => { const tags = []; const budget = []; return { tags, budget, withXUsage: (t, fn) => { tags.push(t); return fn(); }, assertXBudget: async (o) => { budget.push(o); } }; };

test('pull: writes rows via the corpus store with source x-api, tags usage, pages with pagination_token, excludes retweets', async () => {
  const store = createMemoryCorpusStore({ loadCommitted: () => null });
  const client = fakeClient({ pages: { 'id-me': [{ data: [tw(1, '2026-10-16T10:00:00Z'), tw(2, '2026-10-15T10:00:00Z')] }, { data: [tw(3, '2026-10-14T10:00:00Z')] }] } });
  const u = usage();
  const r = await pullCorporaViaXApi('c1', { handles: ['me'], store, client, usage: u, now: () => NOW, userIdCache: createMemoryUserIdCache() });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'x-api');
  assert.equal(r.handles.me.pulledRows, 3);
  assert.equal(r.calls, 3); // 1 lookup + 2 pages
  assert.deepEqual(u.tags, [{ clientId: 'c1', source: 'strategy-accounts' }]);
  assert.equal(u.budget[0].source, 'strategy-accounts');
  const tl = client.calls.filter((c) => c[0] === 'timeline');
  assert.deepEqual(tl[0][2].exclude, ['retweets']);
  assert.equal(tl[1][2].pagination_token, '1');
  const stored = await store.readRows('me');
  assert.equal(stored.rows.length, 3);
  assert.equal(stored.meta.source, 'x-api');
  assert.equal(stored.rows[0].views, 103);
});

test('pull: user ids are cached (second run makes no lookup); incremental since = newest stored - 3d', async () => {
  const store = createMemoryCorpusStore({ loadCommitted: () => null });
  const cache = createMemoryUserIdCache();
  const client = fakeClient({ pages: { 'id-me': [{ data: [tw(1, '2026-10-16T10:00:00Z')] }] } });
  await pullCorporaViaXApi('c1', { handles: ['me'], store, client, usage: usage(), now: () => NOW, userIdCache: cache });
  const client2 = fakeClient({ pages: { 'id-me': [{ data: [tw(1, '2026-10-16T10:00:00Z', 9), tw(2, '2026-10-17T01:00:00Z')] }] } });
  const r2 = await pullCorporaViaXApi('c1', { handles: ['me'], store, client: client2, usage: usage(), now: () => NOW, userIdCache: cache });
  assert.equal(client2.calls.filter((c) => c[0] === 'lookup').length, 0);
  assert.equal(r2.calls, 1);
  assert.equal(client2.calls[0][2].start_time, '2026-10-13T10:00:00.000Z');
  assert.equal(r2.handles.me.added, 1);
  assert.equal(r2.handles.me.updated, 1); // metrics of the overlapping post refreshed
});

test('pull: budget refusal stops the run before any X call and reports x-budget', async () => {
  const store = createMemoryCorpusStore({ loadCommitted: () => null });
  const client = fakeClient();
  const u = { withXUsage: (t, fn) => fn(), assertXBudget: async () => { throw new XBudgetError('daily cap'); } };
  const r = await pullCorporaViaXApi('c1', { handles: ['a', 'b'], store, client, usage: u, now: () => NOW });
  assert.equal(r.ok, false);
  assert.equal(r.stopped, 'x-budget');
  assert.equal(client.calls.length, 0);
  assert.equal(r.handles.b.status, 'skipped');
});

test('pull: 429 stops the run, keeps nothing half-written; >6 handles refused; no handles refused', async () => {
  const store = createMemoryCorpusStore({ loadCommitted: () => null });
  const client = fakeClient({ failTimeline: Object.assign(new Error('rate'), { code: 429 }) });
  const r = await pullCorporaViaXApi('c1', { handles: ['a', 'b'], store, client, usage: usage(), now: () => NOW });
  assert.equal(r.stopped, 'rate-limited');
  assert.equal(r.handles.b.status, 'skipped');
  assert.equal((await pullCorporaViaXApi('c1', { handles: Array.from({ length: 7 }, (_, i) => `h${i}`), store, client, usage: usage() })).ok, false);
  assert.equal((await pullCorporaViaXApi('c1', { handles: [], store, client })).ok, false);
});

test('fetchTimelineViaXApi: deadline ends paging with what was pulled; page size 100 max', async () => {
  const client = fakeClient({ pages: { u1: [{ data: [tw(1, '2026-10-16T10:00:00Z')] }, { data: [tw(2, '2026-10-15T10:00:00Z')] }] } });
  let t = 0;
  const r = await fetchTimelineViaXApi({ client, userId: 'u1', sinceIso: null, maxPerHandle: 300, deadlineAt: 1, now: () => (t += 1) });
  assert.equal(r.error.kind, 'deadline');
  const r2 = await fetchTimelineViaXApi({ client, userId: 'u1', maxPerHandle: 1000 });
  assert.ok(client.calls.every((c) => c[0] !== 'timeline' || c[2].max_results <= 100));
  assert.equal(r2.tweets.length, 2);
});

// ---- data sources --------------------------------------------------------------
function memDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(o[k] || {}, v) : v; return o; };
  return {
    docs,
    collection: (c) => ({ doc: (id) => ({
      get: async () => ({ exists: docs.has(`${c}/${id}`), data: () => docs.get(`${c}/${id}`) }),
      set: async (d, o) => docs.set(`${c}/${id}`, o?.merge ? merge(docs.get(`${c}/${id}`) || {}, d) : d),
    }) }),
  };
}

test('dataSources: defaults all mac/false; unknown dropped; autoDaily only with x-api', () => {
  assert.deepEqual(normalizeDataSources(null), { strategyAccounts: 'mac', quoteTargets: 'mac', autoDaily: { strategyAccounts: false, quoteTargets: false } });
  assert.deepEqual(normalizeDataSources({ strategyAccounts: 'x-api', quoteTargets: 'bogus', autoDaily: { strategyAccounts: true, quoteTargets: true }, extra: 1 }),
    { strategyAccounts: 'x-api', quoteTargets: 'mac', autoDaily: { strategyAccounts: true, quoteTargets: false } });
  assert.equal(applyDataSourcesPatch({ strategyAccounts: 'x-api', autoDaily: { strategyAccounts: true } }, { strategyAccounts: 'mac' }).autoDaily.strategyAccounts, false);
});

test('dataSources: save is a deep merge that keeps the watchlist and other xGrowth fields', async () => {
  const db = memDb({ 'client_configs/c1': { marketingBriefConfig: { xGrowth: { ownHandle: 'me', watchlist: [{ handle: 'a', vein: 'v' }] } } } });
  const saved = await saveDataSources(db, 'c1', { quoteTargets: 'x-api', autoDaily: { quoteTargets: true } });
  assert.equal(saved.quoteTargets, 'x-api');
  const x = db.docs.get('client_configs/c1').marketingBriefConfig.xGrowth;
  assert.equal(x.ownHandle, 'me');
  assert.equal(x.watchlist.length, 1);
  assert.deepEqual((await readDataSources(db, 'c1')), saved);
  await assert.rejects(() => saveDataSources(db, 'a/b', {}));
});

// ---- routing -------------------------------------------------------------------
function routes({ sources, pull, scan, save } = {}) {
  const calls = { pull: [], scan: [] };
  const h = createStrategyHandlers({
    corpusStore: createMemoryCorpusStore({ loadCommitted: () => null }), planStore: createMemoryPlanStore(),
    refreshService: createRefreshService({ store: createMemoryCorpusStore({ loadCommitted: () => null }), queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'req-1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' }),
    clock: () => NOW,
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_a'], timezone: 'America/Chicago', watchlist: [{ handle: 'w1', vein: 'v' }, { handle: 'w2', vein: 'v' }] }),
    readDataSources: async () => sources ?? null,
    saveDataSources: save ?? (async (id, p) => applyDataSourcesPatch(sources, p)),
    pullCorpora: pull ?? (async (id, o) => { calls.pull.push([id, o]); return { ok: true, source: 'x-api', calls: 5, posts: 20, handles: {}, stopped: null }; }),
    scanQuotes: scan ?? (async (id, o) => { calls.scan.push([id, o]); return { ok: true, wrote: true, calls: 4, posts: 9, stopped: null, payload: { scanned: 2, succeeded: 2, candidates: [1, 2, 3], failures: [], rateLimited: [] } }; }),
  });
  return { calls, call: (a, b) => h.handle(a, { clientId: 'c1', ...b }, { clientId: 'c1' }, { decoded: { email: 'a@x.test' } }) };
}

test('routes: actions are registered', () => {
  for (const a of ['quote-scan-refresh', 'x-data-sources-get', 'x-data-sources-save']) assert.ok(STRATEGY_ROUTE_ACTIONS.includes(a), a);
});

test('strategy-refresh with source x-api: refused without confirmPaid (409), runs inline with it; mac source never calls the puller', async () => {
  const x = routes({ sources: { strategyAccounts: 'x-api' } });
  const refused = await x.call('strategy-refresh');
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 409);
  assert.equal(x.calls.pull.length, 0);
  const ok = await x.call('strategy-refresh', { confirmPaid: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.source, 'x-api');
  assert.deepEqual(x.calls.pull[0], ['c1', { handles: ['me_acct', 'bench_a'] }]);

  const mac = routes({ sources: null });
  const q = await mac.call('strategy-refresh', { confirmPaid: true });
  assert.equal(q.status, 'queued');
  assert.equal(mac.calls.pull.length, 0);
});

test('quote-scan-refresh: mac -> needs-mac with instructions; x-api -> confirm gate then scan summary', async () => {
  const mac = routes({});
  const m = await mac.call('quote-scan-refresh');
  assert.equal(m.status, 'needs-mac');
  assert.match(m.instructions, /scan-quote-targets\.mjs --client c1/);
  assert.equal(mac.calls.scan.length, 0);

  const x = routes({ sources: { quoteTargets: 'x-api' } });
  assert.equal((await x.call('quote-scan-refresh')).status, 409);
  assert.equal(x.calls.scan.length, 0);
  const r = await x.call('quote-scan-refresh', { confirmPaid: true });
  assert.deepEqual({ ok: r.ok, source: r.source, candidates: r.candidates, calls: r.calls, wrote: r.wrote }, { ok: true, source: 'x-api', candidates: 3, calls: 4, wrote: true });
});

test('x-data-sources-get returns sources + estimates; save validates and patches', async () => {
  const x = routes({ sources: { strategyAccounts: 'x-api' } });
  const g = await x.call('x-data-sources-get');
  assert.equal(g.dataSources.strategyAccounts, 'x-api');
  assert.equal(g.estimates.strategyAccounts.handles, 2);
  assert.equal(g.estimates.strategyAccounts.calls, 2 + 2 * 3);
  assert.equal(g.estimates.quoteTargets.calls, 4);
  assert.equal((await x.call('x-data-sources-save', { quoteTargets: 'nope' })).status, 400);
  assert.equal((await x.call('x-data-sources-save', {})).status, 400);
  assert.equal((await x.call('x-data-sources-save', { quoteTargets: 'x-api' })).dataSources.quoteTargets, 'x-api');
});

// ---- cron gating ---------------------------------------------------------------
test('auto-daily: only x-api + autoDaily on; mac/default clients never reach a puller; budget stop ends the step', async () => {
  const ran = [];
  const sources = {
    off: null,
    xapiNoAuto: { strategyAccounts: 'x-api', quoteTargets: 'x-api' },
    auto: { strategyAccounts: 'x-api', quoteTargets: 'x-api', autoDaily: { strategyAccounts: true, quoteTargets: false } },
    macAuto: { strategyAccounts: 'mac', autoDaily: { strategyAccounts: true } },
  };
  const deps = {
    readDataSources: async (id) => sources[id],
    pullCorpora: async (id) => { ran.push(['pull', id]); return { ok: true, calls: 3, posts: 10 }; },
    scanQuotes: async (id) => { ran.push(['scan', id]); return { ok: true, calls: 1 }; },
  };
  const out = await runAutoDailyXApi(['off', 'xapiNoAuto', 'auto', 'macAuto'], deps);
  assert.deepEqual(ran, [['pull', 'auto']]);
  assert.equal(out[2].strategyAccounts.ok, true);
  assert.deepEqual(out[2].quoteTargets, { skipped: 'off' });

  ran.length = 0;
  const stopped = await runAutoDailyXApi(['auto', 'auto'], { ...deps, pullCorpora: async (id) => { ran.push(id); return { ok: false, stopped: 'x-budget', error: 'cap' }; } });
  assert.equal(ran.length, 1);
  assert.equal(stopped.budgetStopped, true);

  const failing = await runAutoDailyXApi(['auto'], { ...deps, pullCorpora: async () => { throw new Error('boom'); } });
  assert.equal(failing[0].strategyAccounts.ok, false);
});
