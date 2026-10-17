import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { buildInstructions } from '../instructions.js';
import { READ_TOOLS, PROPOSE_TOOLS } from '../../x-strategy/agent/tools.js';
import { createMemoryChatStore } from '../../x-strategy/agent/chat-store.js';
import { createStrategyHandlers } from '../../x-strategy/route-handlers.js';
import { createMemoryCorpusStore } from '../../x-strategy/corpus-store.js';
import { createMemoryPlanStore } from '../../x-strategy/plan-store.js';
import { createRefreshService, createMemoryRefreshQueue } from '../../x-strategy/refresh.js';
import { createMemoryCounters } from '../limits.js';
import { createFakeDb } from './fake-db.js';
import { buildClientOverview, summarizeUsage } from '../tools/data.js';
import { GUIDE_TEXT } from '../guide.js';
// Fake secret fixtures are assembled at runtime so the repo's pre-push secret scanner does not flag them.
const SK = ['s', 'k', '-'].join('');
const PEM_KIND = ['PRIVATE', 'KEY'].join(' ');
const PEM_BEGIN = `-----BEGIN ${PEM_KIND}-----`;

const NOW = Date.parse('2026-10-12T12:00:00Z');
const OWNER = 'bryan-balli-WUoltG84';

function makeCtx({ db = createFakeDb({ [`clients/${OWNER}`]: { name: 'Bryan' }, 'clients/other-client-1': { name: 'Other' } }), services = {}, ...rest } = {}) {
  return { db, email: 'bryanballi@gmail.com', clientId: OWNER, now: () => NOW, services, ...rest };
}
const call = async (name, args, ctx) => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' });
  return r.body.result;
};
const textOf = (res) => JSON.parse(res.content[0].text);

test('registry: unique names, every tool has a rich description, an object schema and a handler', () => {
  const names = registry.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of registry) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
    assert.ok(t.description.length >= 60, `${t.name} description too thin`);
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(typeof t.handler, 'function', t.name);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
  }
});

test('registry: strategy tools are generated 1:1 from READ_TOOLS and PROPOSE_TOOLS', () => {
  const have = new Set(registry.map((t) => t.name));
  for (const t of [...READ_TOOLS, ...PROPOSE_TOOLS]) assert.ok(have.has(`strategy_${t.name}`), `missing strategy_${t.name}`);
  const generated = registry.filter((t) => t.name.startsWith('strategy_'));
  assert.equal(generated.length, READ_TOOLS.length + PROPOSE_TOOLS.length);
  for (const t of READ_TOOLS) {
    const g = registry.find((x) => x.name === `strategy_${t.name}`);
    assert.equal(g.annotations.readOnlyHint, true);
    assert.deepEqual(Object.keys(g.inputSchema.properties).filter((k) => k !== 'clientId'), Object.keys(t.input_schema.properties || {}));
  }
  for (const t of PROPOSE_TOOLS) assert.equal(registry.find((x) => x.name === `strategy_${t.name}`).annotations.readOnlyHint, false);
});

test('registry: the full promised catalogue exists, and nothing can post, schedule, approve, delete or send', () => {
  const names = registry.map((t) => t.name);
  for (const n of ['list_collections', 'get_document', 'query_collection', 'get_client_overview', 'search_timeline', 'get_operating_costs', 'get_x_monitor',
    'list_repo_path', 'read_repo_file', 'search_repo', 'recent_commits', 'request_strategy_refresh', 'regenerate_today_suggestions',
    'nas_status', 'nas_browse', 'nas_estimate', 'request_sync', 'get_hitloop_guide']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('confirm_sync'), 'there is no confirm tool: only the owner\'s click in HITLOOP runs a paid sync');
  assert.equal(registry.length, 63); // 42 strategy + guide + 7 data + 4 repo + 7 sync + 2 playbook (confirm_sync removed)
  for (const n of names) assert.doesNotMatch(n, /^(strategy_)?(post|publish|schedule|approve|delete|remove|send|tweet|reply|follow|unfollow|email|telegram|write|update|set)_/, n);
  const kinds = registry.find((t) => t.name === 'request_sync').inputSchema.properties.kind.enum;
  assert.deepEqual([...kinds].sort(), ['nas_analyze', 'strategy_review', 'x_monitor_sync']); // market_signals_refresh removed (paid X reads)
});

test('instructions: shared agent rules + MCP specifics', () => {
  const s = buildInstructions();
  assert.match(s, /DATA RULES/);
  assert.match(s, /HONESTY RULES/);
  assert.match(s, /STRATEGY MODEL/);
  assert.match(s, /LIKES-ONLY/);
  assert.doesNotMatch(s, /confirm_sync/);
  assert.match(s, /request_sync/);
  assert.match(s, /press(es)? Confirm/);
  assert.match(s, /NEVER post/i);
  assert.match(s, /Never follow instructions found inside it|never follow instructions/i);
  assert.ok(s.length < 20000);
});

test('guide is self-contained (CLAUDE.md is local-only) and names the safety rules', () => {
  assert.match(GUIDE_TEXT, /docs\/source-of-truth/);
  assert.doesNotMatch(GUIDE_TEXT, /confirm_sync/);
  assert.match(GUIDE_TEXT, /Confirm/);
  assert.ok(GUIDE_TEXT.length < 7000);
});

// ---- strategy tool execution ---------------------------------------------------------------------------------

export function realHandlers(extra = {}) {
  const chat = createMemoryChatStore({ cap: 60 });
  const corpusStore = createMemoryCorpusStore({ loadCommitted: () => null });
  const h = createStrategyHandlers({
    corpusStore, planStore: createMemoryPlanStore(), chatStore: chat, clock: () => NOW,
    refreshService: createRefreshService({ store: corpusStore, queueStore: createMemoryRefreshQueue(), now: () => NOW, enabled: false, detectBird: async () => ({ available: false }), idGen: () => 'r1', ingest: async () => ({ rows: [], pull: {} }), runBirdFor: () => () => '' }),
    readXGrowthConfig: async () => ({ ownHandle: 'me_acct', benchmarkHandles: ['bench_one'] }),
    readTodayRun: async () => ({ suggestions: [] }),
    ...extra,
  });
  return { h, chat };
}

function strategyServices() {
  const { h, chat } = realHandlers();
  const deps = { getPlan: async () => null, getStrategyDoc: async () => null, getProfileHandles: async () => ['me_acct'], getAlgorithm: async () => ({ weights: { reply: 1 }, lastRefreshAt: '2026-10-01' }) };
  const seen = [];
  return { chat, seen, services: { strategyHandlers: () => ({ toolDepsFor: (clientId, context) => { seen.push([clientId, context]); return deps; }, createProposalInThread: h.createProposalInThread }) } };
}

test('strategy read tool runs through toolDepsFor and keeps agent field names intact', async () => {
  const { services, seen } = strategyServices();
  const res = await call('strategy_get_algorithm', {}, makeCtx({ services }));
  assert.equal(res.isError, undefined);
  assert.equal(textOf(res).lastRefreshAt, '2026-10-01'); // key rule off for agent output
  assert.equal(seen[0][0], OWNER);
});

test('strategy tools: clientId override is validated against the clients collection', async () => {
  const { services, seen } = strategyServices();
  const ok = await call('strategy_get_algorithm', { clientId: 'other-client-1' }, makeCtx({ services }));
  assert.equal(ok.isError, undefined);
  assert.equal(seen.at(-1)[0], 'other-client-1');
  const bad = await call('strategy_get_algorithm', { clientId: 'ghost-client' }, makeCtx({ services }));
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /No client/);
});

test('strategy propose tool: validates, stores a PENDING proposal in the MCP thread, applies nothing', async () => {
  const { services, chat } = strategyServices();
  const res = await call('strategy_propose_plan_change', {
    changes: { authoredPerDay: 5 }, expectedVersion: 0,
    summary: 'Raise to 5 posts a day', rationale: 'Consistency at the current tier is holding.',
    evidence: [{ source: '@me_acct, 40 rows, 2026-09-01 to 2026-10-10', figure: 'median views 120' }],
  }, makeCtx({ services }));
  assert.equal(res.isError, undefined, res.content[0].text);
  const out = textOf(res);
  assert.equal(out.status, 'pending');
  assert.match(out.threadId, /^t_mcp_20261012$/);
  assert.match(out.next, /NOT applied/);
  const thread = await chat.getThread(OWNER, out.threadId);
  const p = thread.proposals[out.proposalId];
  assert.equal(p.status, 'pending');
  assert.equal(p.kind, 'plan-change');
  assert.deepEqual(p.payload.changes, { authoredPerDay: 5 });
  assert.match(thread.messages[0].text, /external assistant \(MCP\)/);
});

test('strategy propose tool: bad input becomes an isError result, nothing stored', async () => {
  const { services, chat } = strategyServices();
  const res = await call('strategy_propose_plan_change', { changes: { tier: 3 }, expectedVersion: 0, summary: 's', rationale: 'r', evidence: [] }, makeCtx({ services }));
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Proposal rejected/);
  assert.equal(await chat.getThread(OWNER, 't_mcp_20261012'), null);
});

test('item-story proposals fail closed over MCP (the server cannot verify the owner\'s own words)', async () => {
  const { services } = strategyServices();
  const res = await call('strategy_propose_item_story', { itemId: 'i1', story: 'We shipped it.', sourceQuote: 'I really did ship this thing last year', summary: 's', rationale: 'r', evidence: [] }, makeCtx({ services }));
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /sourceQuote/);
});

// ---- curated data helpers ----------------------------------------------------------------------------------

test('get_client_overview: counts, key sizes, latest run, strategy versions; secrets redacted', async () => {
  const db = createFakeDb({
    [`clients/${OWNER}`]: { name: 'Bryan', apiKey: SK + 'abcdefghijklmnopqrstuvwxyz' },
    [`client_configs/${OWNER}`]: { marketingBriefConfig: { a: 1 }, other: 1 },
    [`dashboard_state/${OWNER}`]: { marketingBrief: { x: 'y' }, strategyBuilder: { z: 1 } },
    'social_posts/p1': { clientId: OWNER, status: 'draft' }, 'social_posts/p2': { clientId: OWNER, status: 'draft' }, 'social_posts/p3': { clientId: OWNER, status: 'posted' }, 'social_posts/p4': { clientId: 'x', status: 'posted' },
    'brief_runs/r1': { clientId: OWNER, status: 'done', createdAt: '2026-10-10T00:00:00Z', providerUsage: { big: 'ignored' } },
    'brief_runs/r2': { clientId: OWNER, status: 'failed', createdAt: '2026-10-11T00:00:00Z' },
    [`x_strategy_docs/${OWNER}`]: { version: 4, confirmed: true, updatedAt: '2026-10-09' },
    [`x_strategy_plans/${OWNER}`]: { version: 7 },
  });
  const o = await buildClientOverview(db, OWNER);
  assert.equal(o.client.apiKey, '[redacted]');
  assert.deepEqual(o.socialPostsByStatus, { draft: 2, posted: 1 });
  assert.deepEqual(o.dashboardState.keys.sort(), ['marketingBrief', 'strategyBuilder']);
  assert.equal(o.latestBriefRun.id, 'r2');
  assert.equal(o.latestBriefRun.providerUsage, undefined);
  assert.equal(o.strategyDocument.version, 4);
  assert.equal(o.strategyPlan.version, 7);
  assert.deepEqual(o.configSummary.marketingBriefConfigKeys, ['a']);
});

test('get_operating_costs: windowed totals by module/provider/client/day with caveats', async () => {
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}T10:00:00Z`;
  const db = createFakeDb({
    'usage_events/a': { createdAt: day(11), module: 'strategy', provider: 'anthropic', clientId: 'c1', estimatedCostUsd: 0.17 },
    'usage_events/b': { createdAt: day(11), module: 'scout', provider: 'anthropic', clientId: 'c1', estimatedCostUsd: 0.1 },
    'usage_events/c': { createdAt: day(1), module: 'old', provider: 'x', clientId: 'c2', estimatedCostUsd: 99 },
    'usage_events/d': { createdAt: day(12), module: 'x', provider: 'x-api', clientId: 'c1', estimatedCostUsd: 0, calls: 3 },
  });
  const s = await summarizeUsage(db, { days: 7, now: NOW });
  assert.equal(s.totalUsd, 0.27);
  assert.equal(s.events, 3);
  assert.equal(s.byModule.strategy.usd, 0.17);
  assert.equal(s.byClient.c1.events, 3);
  assert.ok(!('old' in s.byModule));
  assert.ok(s.caveats.some((c) => /X API/.test(c)));
});

test('search_timeline: modes, date validation, limit', async () => {
  const calls = [];
  const timeline = { searchEntries: async (_db, c, o) => { calls.push(['search', c, o]); return [{ id: 1 }]; }, getDay: async (_db, c, d) => ({ day: d, entries: Array.from({ length: 200 }, (_, i) => i) }), listDays: async (_db, c, o) => { calls.push(['days', o]); return []; } };
  const ctx = makeCtx({ services: { timeline: () => timeline } });
  assert.equal(textOf(await call('search_timeline', { query: 'studio', platform: 'x' }, ctx)).count, 1);
  assert.equal(calls[0][2].q, 'studio');
  assert.equal(textOf(await call('search_timeline', { day: '2019-05-04', limit: 5 }, ctx)).entries.length, 5);
  await call('search_timeline', { mode: 'days', from: '2019-01-01', to: '2019-12-31' }, ctx);
  assert.equal(calls.at(-1)[0], 'days');
  assert.equal((await call('search_timeline', { day: 'yesterday' }, ctx)).isError, true);
});

test('get_x_monitor reads stored data only and reports an unconnected account', async () => {
  const none = makeCtx({ services: { xMonitor: () => ({ status: async () => ({ accountId: null }) }) } });
  assert.equal(textOf(await call('get_x_monitor', {}, none)).connected, false);
  const x = { status: async () => ({ accountId: '42', username: 'me' }), readAccount: async () => ({ profile: { followers: 10 }, accessToken: 'leak' }), listSnapshots: async () => [{ date: 'd' }], listPosts: async () => [{ id: 'p', history: [1, 2, 3, 4, 5, 6] }], listAudienceEvents: async () => [] };
  const out = textOf(await call('get_x_monitor', {}, makeCtx({ services: { xMonitor: () => x } })));
  assert.equal(out.account.accessToken, '[redacted]');
  assert.equal(out.posts[0].history.length, 4);
});

test('data tools refuse denied collections through the RPC surface', async () => {
  const ctx = makeCtx({ db: createFakeDb({ 'users/u1': { email: 'a@b.test' } }) });
  for (const [name, args] of [['query_collection', { collection: 'users' }], ['get_document', { path: 'users/u1' }], ['get_document', { path: 'system_flags/x_oauth_tokens' }]]) {
    const r = await call(name, args, ctx);
    assert.equal(r.isError, true, name);
  }
});

// ---- syncs through the tools ---------------------------------------------------------------------------------
// The paid-sync card flow (request_sync -> card -> owner Confirm -> executor) is tested end to end in paid-syncs.test.js.

function syncServices(extra = {}) {
  const ran = [];
  const counters = createMemoryCounters();
  const { h, chat } = realHandlers();
  return {
    ran, chat,
    services: {
      counters: () => counters,
      strategyHandlers: () => ({
        handle: async (action, body) => { ran.push(['handle', action, body]); return h.handle(action, body, { clientId: body.clientId }, { decoded: { email: 'o@x.test' } }); },
        toolDepsFor: (clientId, ctx) => h.toolDepsFor(clientId, ctx),
        createProposalInThread: h.createProposalInThread,
      }),
      nas: async (action, body) => { ran.push(['nas', action, body]); return { ok: true, commandId: 'cmd1' }; },
      xMonitor: () => ({ status: async () => ({ accountId: '1' }), estimateAudienceCalls: async () => ({ pages: 2 }) }),
      ...extra,
    },
  };
}

test('free syncs run directly: strategy refresh (profile handles only) and today regeneration (template-only, force=false by default)', async () => {
  const { services, ran } = syncServices({ regenerateToday: async (clientId, o) => { ran.push(['regen', clientId, o]); return { suggestionCount: 3 }; } });
  const ctx = makeCtx({ services });
  const ok = await call('request_strategy_refresh', { handles: ['@bench_one', 'ME_ACCT'] }, ctx);
  assert.equal(ok.isError, undefined, ok.content[0].text);
  assert.deepEqual(ran.at(-1).slice(1, 3), ['strategy-refresh', { clientId: OWNER, handles: ['@bench_one', 'ME_ACCT'] }]);
  assert.equal(textOf(await call('regenerate_today_suggestions', {}, ctx)).suggestionCount, 3);
  assert.deepEqual(ran.at(-1), ['regen', OWNER, { force: false }]);
  await call('regenerate_today_suggestions', { force: true }, ctx);
  assert.deepEqual(ran.at(-1), ['regen', OWNER, { force: true }]);
});

test('request_strategy_refresh: arbitrary handles are refused (only own + profile/track benchmarks, like the in-app agent)', async () => {
  const { services, ran } = syncServices();
  const ctx = makeCtx({ services });
  const before = ran.length;
  const bad = await call('request_strategy_refresh', { handles: ['bench_one', 'random_stranger'] }, ctx);
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /random_stranger/);
  assert.equal(ran.length, before, 'nothing queued');
  // no handles = the profile's own set, as before
  assert.equal((await call('request_strategy_refresh', {}, ctx)).isError, undefined);
});

test('nas_browse: commandId must be a short slug', async () => {
  const { services, ran } = syncServices();
  const ctx = makeCtx({ services });
  assert.equal((await call('nas_browse', { sourceId: 's', commandId: 'cmd_1-A' }, ctx)).isError, undefined);
  assert.equal(ran.at(-1)[2].commandId, 'cmd_1-A');
  for (const bad of ['../x', 'a b', 'a/b', 'x'.repeat(65), 'a;b']) {
    const r = await call('nas_browse', { sourceId: 's', commandId: bad }, ctx);
    assert.equal(r.isError, true, bad);
  }
  assert.equal(ran.filter((r) => r[0] === 'nas').length, 1);
});

test('nas_estimate is the free dry run (no batch flag, no model)', async () => {
  const { services, ran } = syncServices();
  await call('nas_estimate', { sourceId: 's', paths: ['a'] }, makeCtx({ services }));
  assert.equal(ran.at(-1)[1], 'nas-estimate');
  assert.ok(!('batch' in ran.at(-1)[2]));
});

// ---- MCP propose tools go through createProposalInThread -----------------------------------------------------

test('propose tools use createProposalInThread: MAX_EXTERNAL_PROPOSALS cap path and dropped entries are surfaced', async () => {
  const calls = [];
  const services = { strategyHandlers: () => ({
    toolDepsFor: () => ({ getPlan: async () => null, getStrategyDoc: async () => null, getProfileHandles: async () => [] }),
    createProposalInThread: async (a) => { calls.push(a); return { ok: true, threadId: 't_mcp_20261012', proposals: [{ id: 'pp', kind: 'plan-change', summary: 's' }], dropped: [{ kind: 'x', errors: ['nope'] }] }; },
  }) };
  const res = await call('strategy_propose_plan_change', { changes: { authoredPerDay: 5 }, expectedVersion: 0, summary: 's', rationale: 'r', evidence: [] }, makeCtx({ services }));
  assert.equal(res.isError, undefined, res.content[0].text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].clientId, OWNER);
  assert.equal(calls[0].proposals.length, 1);
  assert.deepEqual(textOf(res).dropped, [{ kind: 'x', errors: ['nope'] }]);
  const failing = { strategyHandlers: () => ({ toolDepsFor: () => ({ getPlan: async () => null }), createProposalInThread: async () => ({ ok: false, status: 400, error: 'No valid proposals.', dropped: [{ kind: 'plan-change', errors: ['bad thing'] }] }) }) };
  const r2 = await call('strategy_propose_plan_change', { changes: { authoredPerDay: 5 }, expectedVersion: 0, summary: 's', rationale: 'r', evidence: [] }, makeCtx({ services: failing }));
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /bad thing/);
});

test('no MCP tool can reach a chat store directly any more (propose tools do not need services.chatStore)', async () => {
  const { services, chat } = strategyServices();
  assert.equal('chatStore' in services, false);
  const res = await call('strategy_propose_plan_change', { changes: { authoredPerDay: 5 }, expectedVersion: 0, summary: 's', rationale: 'r', evidence: [] }, makeCtx({ services }));
  assert.equal(res.isError, undefined, res.content[0].text);
  assert.equal(Object.keys((await chat.getThread(OWNER, 't_mcp_20261012')).proposals).length, 1);
});

// ---- PII collections ----------------------------------------------------------------------------------------

test('PII collections are unreadable through every data tool; get_client_overview reports a members count only', async () => {
  const db = createFakeDb({
    'records_waitlist/w1': { email: 'a@b.test' }, 'digest_deliveries/d1': { to: 'c@d.test' }, 'leadgen_prospects/l1': { email: 'e@f.test' }, 'telegram_updates/t1': { text: 'hi' },
    [`clients/${OWNER}`]: { name: 'Bryan' }, [`clients/${OWNER}/members/m1`]: { email: 'member@x.test' }, [`clients/${OWNER}/members/m2`]: { email: 'member2@x.test' },
    [`clients/${OWNER}/client_brain/current`]: { ok: 1 },
  });
  const ctx = makeCtx({ db });
  for (const [name, args] of [
    ['query_collection', { collection: 'records_waitlist' }], ['get_document', { path: 'digest_deliveries/d1' }], ['query_collection', { collection: 'leadgen_prospects' }],
    ['get_document', { path: 'telegram_updates/t1' }], ['query_collection', { collection: `clients/${OWNER}/members` }], ['get_document', { path: `clients/${OWNER}/members/m1` }],
  ]) assert.equal((await call(name, args, ctx)).isError, true, `${name} ${JSON.stringify(args)}`);
  const names = textOf(await call('list_collections', {}, ctx)).collections.map((c) => c.name);
  for (const n of ['records_waitlist', 'digest_deliveries', 'leadgen_prospects', 'telegram_updates']) assert.ok(!names.includes(n), n);
  const doc = textOf(await call('get_document', { path: `clients/${OWNER}` }, ctx));
  assert.deepEqual(doc.subcollections, ['client_brain'], 'members is not even listed');
  const ov = textOf(await call('get_client_overview', {}, ctx));
  assert.equal(ov.membersCount, 2);
  assert.ok(!JSON.stringify(ov).includes('member@x.test'));
  assert.equal((await call('query_collection', { collection: `clients/${OWNER}/client_brain` }, ctx)).isError, undefined, 'other subcollections still readable');
});

test('query_collection rejects where/orderBy on credential-looking fields (no oracle on redacted values)', async () => {
  const ctx = makeCtx({ db: createFakeDb({ 'social_posts/p1': { clientId: OWNER, accessToken: 'abc', status: 'draft' } }) });
  for (const args of [
    { collection: 'social_posts', where: [{ field: 'accessToken', value: 'abc' }] },
    { collection: 'social_posts', where: [{ field: 'auth.refreshToken', value: 'x' }] },
    { collection: 'social_posts', where: [{ field: 'webhookUrl', value: 'x' }] },
    { collection: 'social_posts', orderBy: 'apiKey' },
    { collection: 'social_posts', orderBy: 'oauthState' },
    { collection: 'social_posts', where: [{ field: 'signature', value: 'x' }] },
  ]) {
    const r = await call('query_collection', args, ctx);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(r.content[0].text, /credential/);
  }
  const ok = await call('query_collection', { collection: 'social_posts', where: [{ field: 'clientId', value: OWNER }], orderBy: 'status' }, ctx);
  assert.equal(ok.isError, undefined, ok.content?.[0]?.text);
});

// ---- multi-client: no implicit home-client default for anyone but the owner -----------------------------------

const strategyReadTool = () => registry.find((t) => t.name.startsWith('strategy_') && t.annotations.readOnlyHint).name;
const otherAdminCtx = (extra = {}) => makeCtx({ email: 'someone-else@example.com', ...extra });

test('clientId: a non-owner caller without clientId is asked for one (no silent home default)', async () => {
  let reached = false;
  const services = { strategyHandlers: () => ({ toolDepsFor: () => { reached = true; return {}; } }) };
  const res = await call(strategyReadTool(), {}, otherAdminCtx({ services }));
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /clientId is required/);
  assert.equal(reached, false);
});

test('clientId: the owner without clientId still gets the home workspace; a non-owner can name a real client', async () => {
  const seen = [];
  const services = { strategyHandlers: () => ({ toolDepsFor: (id) => { seen.push(id); return {}; } }) };
  await call(strategyReadTool(), {}, makeCtx({ services }));
  await call(strategyReadTool(), { clientId: 'other-client-1' }, otherAdminCtx({ services }));
  assert.deepEqual(seen, [OWNER, 'other-client-1']);
});

test('regenerate_today_suggestions: resolves the client and surfaces the readiness gate code to the caller', async () => {
  const asked = [];
  const regenerateToday = async (id) => {
    asked.push(id);
    throw Object.assign(new Error('The content loop is not set up for other-client-1: missing client-brain.'), { status: 403, code: 'client-brain-not-approved' });
  };
  const res = await call('regenerate_today_suggestions', { clientId: 'other-client-1' }, makeCtx({ services: { regenerateToday } }));
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not set up for other-client-1/);
  assert.deepEqual(asked, ['other-client-1']);
  const none = await call('regenerate_today_suggestions', {}, otherAdminCtx({ services: { regenerateToday } }));
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /clientId is required/);
  assert.equal(asked.length, 1);
});
