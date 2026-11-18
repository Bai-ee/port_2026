import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { READ_TOOLS } from '../../x-strategy/agent/tools.js';
import { AGENT_REFRESH_GROUP_IDS } from '../../x-strategy/contracts.js';
import { REFRESHES, EXCLUDED } from '../ops/catalog.js';
import { opsCapKey } from '../ops/runs.js';
import { planGroup } from '../../x-strategy/agent/refresh-engine.js';
import { makeWorld, OWNER, OTHER, NOW } from './ops-world.js';

const FREE_IDS = ['strategy-accounts', 'quote-targets', 'hot-quotes', 'bookmarks', 'recent-posts', 'today-queue'];
const PAID_IDS = ['market-signals', 'analysis', 'renders', 'x-search', 'x-monitor', 'strategy-review', 'site-showcase'];
const OPS_TOOLS = ['list_refreshes', 'run_refresh', 'get_run_status', 'get_settings', 'set_setting', 'undo_setting'];

test('catalog: free ids are free in the engine, paid ids are paid or have no free path', () => {
  assert.deepEqual(REFRESHES.filter((r) => r.costClass === 'free').map((r) => r.id), FREE_IDS);
  assert.deepEqual(REFRESHES.filter((r) => r.costClass === 'paid').map((r) => r.id), PAID_IDS);
  for (const id of FREE_IDS.filter((x) => x !== 'today-queue')) {
    assert.ok(AGENT_REFRESH_GROUP_IDS.includes(id), id);
    assert.equal(planGroup(id, { sources: {} }).paid, false, id);
    assert.equal(planGroup(id, { sources: { strategyAccounts: 'x-api', quoteTargets: 'x-api' } }).paid, id === 'strategy-accounts' || id === 'quote-targets', `${id} with x-api sources`);
  }
  for (const id of PAID_IDS.filter((x) => AGENT_REFRESH_GROUP_IDS.includes(x))) assert.equal(planGroup(id, { sources: {} }).paid, true, id);
  assert.ok(!EXCLUDED.some((e) => e.id === 'x-search'), 'x-search is a paid refresh now');
});

test('list_refreshes: free runnable, paid preview-then-confirm with effects and caps, excluded shown, usage counted', async () => {
  const w = makeWorld();
  await w.call('run_refresh', { refreshId: 'bookmarks' });
  const out = w.json(await w.call('list_refreshes'));
  assert.equal(out.phase, 2);
  assert.equal(out.refreshes.find((r) => r.id === 'bookmarks').usedToday, 1);
  assert.equal(out.refreshes.find((r) => r.id === 'bookmarks').runnable, true);
  for (const id of PAID_IDS) {
    const r = out.refreshes.find((x) => x.id === id);
    assert.equal(r.costClass, 'paid'); assert.equal(r.availability, 'preview-then-confirm'); assert.equal(r.runnable, true); assert.ok(r.estimate && r.writes && r.effects.length);
  }
  assert.ok(out.excluded.length >= 5);
  assert.equal(out.paidCaps.globalPerDay, 10);
  assert.equal(out.refreshes.find((r) => r.id === 'analysis').maxPerDay, 3);
  assert.equal(out.refreshes.find((r) => r.id === 'site-showcase').maxPerDay, 2);
  assert.match(out.refreshes.find((r) => r.id === 'analysis').effects.join(' '), /PUBLISH a fresh hosted Executive Brief/);
  assert.match(out.refreshes.find((r) => r.id === 'analysis').effects.join(' '), /digest delivery record/);
  const other = w.json(await w.call('list_refreshes', { clientId: OTHER }));
  assert.match(other.refreshes.find((r) => r.id === 'site-showcase').availability, /^blocked/);
});

test('run_refresh: a free Mac group goes through agent-refresh with ONE group and records a run row', async () => {
  const w = makeWorld();
  const res = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  assert.equal(res.ran, true); assert.equal(res.status, 'queued'); assert.equal(res.requestId, 'req_bookmarks'); assert.equal(res.runId, 'run_t1');
  assert.equal(w.spies.agent.length, 1);
  assert.deepEqual(w.spies.agent[0].body.groups, ['bookmarks']);
  assert.equal(w.spies.agent[0].body.clientId, OWNER);
  const row = await w.stores.runs.get('run_t1');
  assert.equal(row.clientId, OWNER); assert.equal(row.refreshId, 'bookmarks'); assert.equal(row.requestId, 'req_bookmarks'); assert.equal(row.email, 'bryanballi@gmail.com');
});

test('run_refresh today-queue: template regenerate, no agent call', async () => {
  const w = makeWorld();
  const res = w.json(await w.call('run_refresh', { refreshId: 'today-queue' }));
  assert.equal(res.status, 'done');
  assert.deepEqual(w.spies.regenerate, [[OWNER, { force: false }]]);
  assert.equal(w.spies.agent.length, 0);
});

test('gate: excluded ids refuse with a reason; unknown ids are an error; nothing invoked', async () => {
  const w = makeWorld();
  const ex = w.json(await w.call('run_refresh', { refreshId: 'digest-send' }));
  assert.equal(ex.ran, false); assert.equal(ex.excluded, true); assert.match(ex.reason, /sending/i);
  const bad = await w.call('run_refresh', { refreshId: 'send-the-email' });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /Unknown refreshId/);
  assert.equal(w.spies.agent.length, 0); assert.equal(w.counters._raw.size, 0);
});

test('gate: a client on the paid X API source cannot run strategy-accounts / quote-targets (refused before the cap)', async () => {
  const w = makeWorld();
  w.sources.strategyAccounts = 'x-api'; w.sources.quoteTargets = 'x-api';
  for (const id of ['strategy-accounts', 'quote-targets']) {
    const res = w.json(await w.call('run_refresh', { refreshId: id }));
    assert.equal(res.ran, false, id); assert.equal(res.refused, true, id); assert.equal(res.reason, 'x-api-source');
  }
  assert.equal(w.spies.agent.length, 0); assert.equal(w.counters._raw.size, 0);
  const list = w.json(await w.call('list_refreshes'));
  assert.match(list.refreshes.find((r) => r.id === 'strategy-accounts').availability, /^blocked/);
  assert.equal(list.refreshes.find((r) => r.id === 'bookmarks').runnable, true);
});

test('gate: an engine that answers needs-confirm is recorded as refused, never as ran', async () => {
  const w = makeWorld({ agentResults: { bookmarks: { ok: true, results: [{ group: 'bookmarks', mode: 'paid', status: 'needs-confirm', detail: 'owner setting off' }] } } });
  const res = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  assert.equal(res.ran, false); assert.equal(res.status, 'refused');
});

test('caps: per refresh per client per day; other client, other refresh and next day are independent', async () => {
  const w = makeWorld();
  for (let i = 0; i < 10; i += 1) assert.equal(w.json(await w.call('run_refresh', { refreshId: 'bookmarks' })).ran, true);
  const over = await w.call('run_refresh', { refreshId: 'bookmarks' });
  assert.equal(over.isError, true); assert.match(over.content[0].text, /Daily limit reached: 10/);
  assert.equal(w.json(await w.call('run_refresh', { refreshId: 'bookmarks', clientId: OTHER })).ran, true);
  assert.equal(w.json(await w.call('run_refresh', { refreshId: 'recent-posts' })).ran, true);
  assert.equal(w.counters._raw.get(opsCapKey('bookmarks', OWNER, NOW)), 10);
  w.clock.now = NOW + 86400000;
  assert.equal(w.json(await w.call('run_refresh', { refreshId: 'bookmarks' })).ran, true);
  // today-queue has its own lower cap
  for (let i = 0; i < 5; i += 1) await w.call('run_refresh', { refreshId: 'today-queue' });
  assert.equal((await w.call('run_refresh', { refreshId: 'today-queue' })).isError, true);
});

test('caps: validation refusals (excluded, paid, x-api source, unknown client) never burn the cap', async () => {
  const w = makeWorld();
  w.sources.strategyAccounts = 'x-api';
  for (let i = 0; i < 15; i += 1) {
    await w.call('run_refresh', { refreshId: 'strategy-accounts' });
    await w.call('run_refresh', { refreshId: 'digest-send' });
    await w.call('run_refresh', { refreshId: 'bookmarks', clientId: 'no-such-client' });
  }
  assert.equal(w.counters._raw.get(opsCapKey('strategy-accounts', OWNER, NOW)) ?? 0, 0);
  w.sources.strategyAccounts = 'mac';
  for (let i = 0; i < 10; i += 1) assert.equal(w.json(await w.call('run_refresh', { refreshId: 'strategy-accounts' })).ran, true);
});

test('get_run_status: follows the queue request, writes the terminal state, and is read-only for the engine', async () => {
  const w = makeWorld({ statusResults: { req_bookmarks: { ok: true, requests: [{ requestId: 'req_bookmarks', status: 'done', result: { found: 4 } }] } } });
  const { runId } = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  const st = w.json(await w.call('get_run_status', { runId }));
  assert.equal(st.status, 'done'); assert.deepEqual(st.result, { found: 4 });
  assert.equal(w.spies.agent.at(-1).action, 'agent-refresh-status');
  assert.equal((await w.stores.runs.get(runId)).status, 'done');
  const before = w.spies.agent.length;
  assert.equal(w.json(await w.call('get_run_status', { runId })).status, 'done');
  assert.equal(w.spies.agent.length, before, 'a finished run is not re-polled');
});

test('get_run_status: a run of another client is refused like a missing one; bad ids too', async () => {
  const w = makeWorld();
  const { runId } = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  const cross = await w.call('get_run_status', { runId, clientId: OTHER });
  assert.equal(cross.isError, true); assert.match(cross.content[0].text, /No such run for this client/);
  for (const bad of ['nope', 'a/b', '../x']) assert.equal((await w.call('get_run_status', { runId: bad })).isError, true);
});

test('get_run_status: stale and unfinished reads as timed-out, never running', async () => {
  const w = makeWorld();
  const { runId } = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  assert.equal(w.json(await w.call('get_run_status', { runId })).status, 'queued');
  w.clock.now = NOW + 16 * 60_000; // bookmarks lease is 15 min
  const st = w.json(await w.call('get_run_status', { runId }));
  assert.equal(st.status, 'timed-out'); assert.match(st.note, /unknown/);
  assert.equal((await w.stores.runs.get(runId)).status, 'timed-out');
  assert.equal(w.json(await w.call('get_run_status', { runId })).status, 'timed-out');
});

test('client resolution: a non-owner admin without clientId is refused on all 6 tools; unknown clients too; nothing runs', async () => {
  const w = makeWorld({ email: 'someone-else@example.com' });
  const args = { list_refreshes: {}, run_refresh: { refreshId: 'bookmarks' }, get_run_status: { runId: 'run_t1' }, get_settings: {}, set_setting: { key: 'digest.dailyXSearch', value: false }, undo_setting: { changeId: 'chg_t1' } };
  for (const name of OPS_TOOLS) {
    const noClient = await w.call(name, args[name]);
    assert.equal(noClient.isError, true, name); assert.match(noClient.content[0].text, /clientId is required/, name);
    const unknown = await w.call(name, { ...args[name], clientId: 'ghost-client' });
    assert.equal(unknown.isError, true, name); assert.match(unknown.content[0].text, /No client "ghost-client"/, name);
  }
  assert.equal(w.spies.agent.length, 0); assert.equal(w.counters._raw.size, 0);
  assert.equal(w.settings.writes.digest.length + w.settings.writes.daily.length + w.settings.writes.sources.length, 0);
  // an explicit existing client works for that admin
  assert.equal(w.json(await w.call('run_refresh', { refreshId: 'bookmarks', clientId: OTHER })).ran, true);
});

test('strategy_refresh_data is unchanged and MCP-OPS never touches the shared strategy handlers', async () => {
  const t = registry.find((x) => x.name === 'strategy_refresh_data');
  const src = READ_TOOLS.find((x) => x.name === 'refresh_data');
  assert.ok(t && src);
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['clientId', ...Object.keys(src.input_schema.properties)].sort());
  assert.deepEqual(t.inputSchema.properties.groups.items.enum, [...AGENT_REFRESH_GROUP_IDS]);
  const w = makeWorld();
  await w.call('list_refreshes'); await w.call('run_refresh', { refreshId: 'bookmarks' }); await w.call('run_refresh', { refreshId: 'analysis' }); await w.call('get_settings');
  assert.equal(w.spies.shared.length, 0);
});

test('status: partial and skipped map to done (partial with a note)', async () => {
  const w = makeWorld({ statusResults: { req_bookmarks: { ok: true, requests: [{ requestId: 'req_bookmarks', status: 'partial' }] }, req_recent_posts: { ok: true, requests: [{ status: 'skipped' }] } } });
  const a = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  const st = w.json(await w.call('get_run_status', { runId: a.runId }));
  assert.equal(st.status, 'done'); assert.match(st.note, /partially/);
  const w2 = makeWorld({ agentResults: { bookmarks: { ok: true, results: [{ group: 'bookmarks', mode: 'mac', status: 'skipped', detail: 'nothing to do' }] } } });
  assert.equal(w2.json(await w2.call('run_refresh', { refreshId: 'bookmarks' })).status, 'done');
});

test('a data-source read error refuses strategy-accounts / quote-targets BEFORE the cap; other groups are unaffected', async () => {
  const w = makeWorld();
  w.ops.readSources = async () => { throw new Error('firestore down'); };
  for (const id of ['strategy-accounts', 'quote-targets']) {
    const r = await w.call('run_refresh', { refreshId: id });
    assert.equal(r.isError, true, id); assert.match(r.content[0].text, /data sources/);
  }
  assert.equal(w.spies.agent.length, 0); assert.equal(w.counters._raw.size, 0);
  assert.equal(w.json(await w.call('run_refresh', { refreshId: 'bookmarks' })).ran, true);
  const list = w.json(await w.call('list_refreshes'));
  assert.equal(list.refreshes.find((r) => r.id === 'strategy-accounts').runnable, false);
});

test('stores: run/change rows are create-only (memory and Firestore .create())', async () => {
  const { createMemoryOpsStores, createFirestoreOpsStores } = await import('../ops/stores.js');
  const m = createMemoryOpsStores();
  await m.runs.create('run_1', { a: 1 });
  await assert.rejects(m.runs.create('run_1', { a: 2 }));
  assert.deepEqual(await m.runs.get('run_1'), { a: 1 });
  const calls = [];
  const db = { collection: (c) => ({ doc: (id) => ({ create: async (d) => { calls.push(['create', c, id, d]); }, set: async () => { calls.push(['set']); } }) }) };
  await createFirestoreOpsStores(db).runs.create('run_2', { b: 1 });
  assert.deepEqual(calls, [['create', 'mcp_ops_runs', 'run_2', { b: 1 }]]);
});

test('ops agent handlers expose only the three actions ops uses', async () => {
  const { restrictAgentHandlers, OPS_AGENT_ACTIONS } = await import('../ops/catalog.js');
  const seen = [];
  const h = restrictAgentHandlers({ handle: async (a) => { seen.push(a); return { ok: true }; } });
  assert.deepEqual([...OPS_AGENT_ACTIONS].sort(), ['agent-refresh', 'agent-refresh-status', 'strategy-autonomy-get']);
  for (const a of OPS_AGENT_ACTIONS) await h.handle(a, {}, {}, {});
  for (const a of ['strategy-refresh', 'x-data-sources-save', 'strategy-proposal-decide', 'action-run']) assert.throws(() => h.handle(a, {}, {}, {}), /may not call/);
  assert.equal(seen.length, 3);
});

// The REAL handlers built by the same factory server.js uses (createStrategyHandlersFromDb), all effects injected: no Firestore.
async function realOpsHandlers({ withSpendStore }) {
  const { createStrategyHandlersFromDb } = await import('../../x-strategy/route-handlers.js');
  const { createFakeDb } = await import('./fake-db.js');
  const called = [];
  const spy = (name, ret) => async (...a) => { called.push(name); return typeof ret === 'function' ? ret(...a) : ret; };
  const handlers = createStrategyHandlersFromDb(createFakeDb({}), {
    env: {}, clock: () => NOW,
    readPackages: async () => [], readXGrowthConfig: async () => ({ ownHandle: 'me', benchmarkHandles: ['a'] }),
    actionRuntime: { getAutonomy: async () => ({ trustedRefresh: { enabled: true, dailyCapUsd: 20 } }) }, // owner opted in to paid agent refresh
    readDataSources: async () => ({ strategyAccounts: 'x-api', quoteTargets: 'mac' }),
    runDigestRefresh: spy('runDigestRefresh', { ok: true }), runPaidSync: spy('runPaidSync', { ok: true }), pullCorpora: spy('pullCorpora', { ok: true, calls: 1, posts: 1 }),
    describePaidSync: spy('describePaidSync', null),
    quoteScanQueue: { request: spy('queueScan', { requestId: 'q1', status: 'queued' }), get: async () => null },
    ...(withSpendStore ? { refreshSpendStore: { get: async () => ({ usd: 0, runs: [] }), add: async () => {} } } : { refreshSpendStore: null }), // server.js passes null
  });
  return { handlers, called };
}

test('real handlers (server.js factory, spend store null, trustedRefresh ON): paid groups and x-api strategy-accounts run nothing', async () => {
  const { handlers, called } = await realOpsHandlers({ withSpendStore: false });
  const auth = { decoded: { email: 'o@example.com' } };
  const res = await handlers.handle('agent-refresh', { clientId: OWNER, groups: ['analysis', 'market-signals', 'renders', 'x-monitor', 'strategy-accounts'] }, { clientId: OWNER }, auth);
  assert.equal(res.ok, true);
  for (const r of res.results) assert.equal(r.status, 'needs-confirm', `${r.group}: ${r.status} ${r.detail}`);
  assert.deepEqual(called.filter((c) => ['runDigestRefresh', 'runPaidSync', 'pullCorpora'].includes(c)), [], 'no paid runner called');
});

test('real handlers control: WITH a spend store the same trustedRefresh client WOULD run paid groups (so the null store is what protects)', async () => {
  const { handlers, called } = await realOpsHandlers({ withSpendStore: true });
  const res = await handlers.handle('agent-refresh', { clientId: OWNER, groups: ['analysis'] }, { clientId: OWNER }, { decoded: { email: 'o@example.com' } });
  assert.equal(res.results[0].status, 'done');
  assert.ok(called.includes('runDigestRefresh'));
});

test('partial note is persisted into detail, so a later get_run_status keeps it', async () => {
  const w = makeWorld({ statusResults: { req_bookmarks: { ok: true, requests: [{ requestId: 'req_bookmarks', status: 'partial' }] } } });
  const { runId } = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  assert.match(w.json(await w.call('get_run_status', { runId })).note, /partially/);
  assert.match((await w.stores.runs.get(runId)).detail, /partially/);
  const again = w.json(await w.call('get_run_status', { runId }));
  assert.equal(again.status, 'done'); assert.match(again.detail, /partially/);
});
