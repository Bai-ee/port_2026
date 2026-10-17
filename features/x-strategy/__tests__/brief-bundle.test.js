import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_PARTS, FRESHNESS_RULES, BRIEF_LIMITS, buildBriefBundle, freshnessOf, readBriefRaw, toMs } from '../brief-bundle.js';
import { REFRESH_GROUPS } from '../../../components/dashboard/marketing/refresh-groups.js';
import { runReadTool, READ_TOOLS, LIMITS, serializeResult } from '../agent/tools.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test('every part has a rule; refresh groups are real REFRESH_GROUPS ids or null', () => {
  const ids = new Set(REFRESH_GROUPS.map((g) => g.id));
  assert.deepEqual(Object.keys(FRESHNESS_RULES).sort(), [...BRIEF_PARTS].sort());
  for (const [k, r] of Object.entries(FRESHNESS_RULES)) {
    assert.ok(r.refreshGroup === null || ids.has(r.refreshGroup), k);
    assert.ok(r.maxAgeHours === null || r.maxAgeHours > 0, k);
  }
  assert.equal(FRESHNESS_RULES['market-signals'].maxAgeHours, 24);
  assert.equal(FRESHNESS_RULES['quote-targets'].maxAgeHours, 12);
  assert.equal(FRESHNESS_RULES['strategy-accounts'].maxAgeHours, 48);
  assert.equal(FRESHNESS_RULES['x-monitor'].maxAgeHours, 72);
});

test('toMs reads ISO, ms, Firestore timestamps and rejects junk', () => {
  assert.equal(toMs('2026-10-17T12:00:00Z'), NOW);
  assert.equal(toMs(NOW), NOW);
  assert.equal(toMs({ _seconds: NOW / 1000 }), NOW);
  assert.equal(toMs({ toMillis: () => NOW }), NOW);
  assert.equal(toMs('nope'), null);
  assert.equal(toMs(null), null);
});

const raw = () => ({
  marketingBrief: {
    scoutBrief: { timestamp: hoursAgo(30) },
    watchlistTimelines: { generatedAt: hoursAgo(2), handles: { a: {}, b: {} } },
    reportSnapshot: {
      platformTests: { reddit: { generatedAt: hoursAgo(20), count: 4 }, instagram: { generatedAt: hoursAgo(21), items: [1] }, x: { generatedAt: hoursAgo(900) } },
      redditAnalysis: { generatedAt: hoursAgo(10), text: 'reddit text' },
      watchlistAnalysis: { generatedAt: hoursAgo(2), text: 'wl text' },
      digestRecipes: [{ recipeId: 'reply-targets', generatedAt: hoursAgo(5), analysis: 'replies' }],
    },
  },
  signals: { headline: 'H', humanBrief: 'B', narratives: [{ trend: 't', detail: 'd' }], strategyBuilder: { generatedAt: hoursAgo(10), items: [] } },
  quoteTargets: { generatedAt: hoursAgo(3), candidates: [{ id: 'c', text: 'x', author: { username: 'u' } }] },
  planDoc: { version: 3, updatedAt: hoursAgo(500), plan: { authoredPerDay: 3 } },
  corpora: [{ handle: 'me', source: 'firestore', rows: 50, pulledAt: hoursAgo(60) }, { handle: 'seb', source: 'firestore', rows: 80, pulledAt: hoursAgo(5) }],
  xMonitor: { updatedAt: NOW - 100 * 3_600_000, sync: { postsAt: NOW - 80 * 3_600_000 } },
});

test('buildBriefBundle: ages, stale flags, groups and unique staleGroups', () => {
  const b = buildBriefBundle(raw(), { now: NOW });
  assert.equal(b.generatedAt, new Date(NOW).toISOString());
  assert.equal(b.parts['market-signals'].stale, true); // 30h > 24h
  assert.equal(b.parts['market-signals'].ageHours, 30);
  assert.equal(b.parts['market-signals'].refreshGroup, 'market-signals');
  assert.equal(b.parts.watchlist.stale, false);
  assert.equal(b.parts['platform-searches'].asOf, hoursAgo(21)); // older of reddit/instagram
  assert.equal(b.parts['platform-searches'].stale, false);
  assert.equal(b.parts.analysis.asOf, hoursAgo(10)); // oldest PRESENT core analyzer
  assert.equal(b.parts['quote-targets'].stale, false);
  assert.equal(b.parts['quote-targets'].refreshGroup, null);
  assert.equal(b.parts['strategy-accounts'].asOf, hoursAgo(60));
  assert.equal(b.parts['strategy-accounts'].stale, true); // 60h > 48h
  assert.equal(b.parts['x-monitor'].stale, true); // 80h > 72h (newest of sync stamps / updatedAt)
  assert.equal(b.parts['strategy-plan'].stale, false); // no age rule: never stale
  assert.equal(b.parts['strategy-plan'].ageHours, 500);
  // missing data on an age-ruled part = stale; no-rule part = not stale
  assert.equal(b.parts['today-run'].asOf, null);
  assert.equal(b.parts['today-run'].stale, true);
  assert.equal(b.parts['proof-builder'].stale, false);
  assert.deepEqual([...b.staleGroups].sort(), [...new Set(b.staleGroups)].sort());
  for (const g of ['market-signals', 'strategy-accounts', 'x-monitor', 'today-queue', 'x-search', 'renders']) assert.ok(b.staleGroups.includes(g), g);
  assert.ok(!b.staleGroups.includes(null));
});

test('analysis: an old optional analyzer (x market talk) does not make the part stale', () => {
  const r = raw();
  r.marketingBrief.reportSnapshot.xMarketTalkAnalysis = { generatedAt: hoursAgo(2000), text: 'old' };
  const b = buildBriefBundle(r, { now: NOW });
  assert.equal(b.parts.analysis.asOf, hoursAgo(10));
  assert.equal(b.parts.analysis.stale, false);
});

test('empty / junk raw never throws and marks age-ruled parts stale', () => {
  for (const r of [undefined, null, {}, { marketingBrief: 'x', signals: 5, corpora: 'no' }]) {
    const b = buildBriefBundle(r, { now: NOW });
    assert.equal(Object.keys(b.parts).length, BRIEF_PARTS.length);
    assert.equal(b.parts['market-signals'].stale, true);
  }
});

test('compact bundle stays small; one part comes back in detail; summaries are capped', () => {
  const big = raw();
  big.signals.narratives = Array.from({ length: 50 }, (_, i) => ({ trend: `t${i}`, detail: 'd'.repeat(500) }));
  big.signals.humanBrief = 'b'.repeat(5000);
  const compact = buildBriefBundle(big, { now: NOW });
  for (const p of Object.values(compact.parts)) assert.ok(JSON.stringify(p.summary).length <= BRIEF_LIMITS.compactChars + 60);
  assert.ok(JSON.stringify(compact).length <= LIMITS.briefBundleMaxChars);
  const one = buildBriefBundle(big, { now: NOW, part: 'market-signals' });
  assert.ok(one.parts['market-signals'].summary);
  assert.ok(!('summary' in one.parts.watchlist), 'other parts carry freshness only');
  assert.ok(JSON.stringify(one.parts['market-signals'].summary).length <= BRIEF_LIMITS.detailChars + 60);
  assert.ok(one.parts['market-signals'].summary.narratives.length >= 1);
});

test('freshnessOf drops summaries but keeps label, how and staleGroups', () => {
  const f = freshnessOf(buildBriefBundle(raw(), { now: NOW }));
  assert.ok(!('summary' in f.parts['market-signals']));
  assert.ok(f.parts['market-signals'].label && f.parts['market-signals'].how);
  assert.ok(Array.isArray(f.staleGroups));
  assert.ok(JSON.stringify(f).length < 6000);
});

test('readBriefRaw: injected readers, non-fatal sub-reads, no scoutBrief re-read', async () => {
  const doc = (data) => ({ exists: !!data, data: () => data });
  const db = {
    collection: (c) => ({
      doc: (id) => ({
        get: async () => doc(c === 'dashboard_state' ? { marketingBrief: { scoutBrief: { timestamp: hoursAgo(1) } }, moduleBriefs: { generatedAtIso: hoursAgo(2) } } : null),
        collection: (sub) => ({
          doc: () => ({ get: async () => doc(sub === 'client_brain' ? { status: 'approved', approvedAt: hoursAgo(9) } : null) }),
          where: () => ({ limit: () => ({ get: async () => ({ docs: [{ id: 'daily-1', data: () => ({ publicClientSlug: 'cc', publicBriefSlug: 'bb', updatedAt: hoursAgo(4) }) }] }) }) }),
        }),
      }),
    }),
  };
  const r = await readBriefRaw('c1', {
    db, projectBrief: (mb) => ({ headline: 'proj', from: mb.scoutBrief.timestamp }),
    readPlanDoc: async () => ({ version: 1 }), readStrategyDoc: async () => { throw new Error('boom'); },
  });
  assert.equal(r.signals.headline, 'proj');
  assert.equal(r.brain.status, 'approved');
  assert.equal(r.publishedBrief.path, '/briefs/cc/bb');
  assert.equal(r.strategyDoc, undefined); // failed read is non-fatal
  assert.equal(r.planDoc.version, 1);
  await assert.rejects(() => readBriefRaw('', { db }));
});

test('get_brief / get_freshness tools: model never supplies clientId, bad part rejected, unavailable without the dep', async () => {
  assert.ok(READ_TOOLS.find((t) => t.name === 'get_brief').input_schema.properties.part.enum.includes('analysis'));
  const calls = [];
  const deps = { readBriefBundle: async (a) => { calls.push(a); return buildBriefBundle(raw(), { now: NOW, ...a }); } };
  const all = await runReadTool('get_brief', {}, deps);
  assert.equal(Object.keys(all.parts).length, BRIEF_PARTS.length);
  assert.ok(serializeResult(all).length <= LIMITS.resultMaxChars);
  const one = await runReadTool('get_brief', { part: 'analysis', clientId: 'evil' }, deps);
  assert.deepEqual(calls.at(-1), { part: 'analysis' });
  assert.ok(one.parts.analysis.summary);
  const bad = await runReadTool('get_brief', { part: 'nope' }, deps);
  assert.match(bad.error, /unknown part/);
  const fr = await runReadTool('get_freshness', {}, deps);
  assert.ok(fr.staleGroups.includes('market-signals'));
  assert.ok(!('summary' in fr.parts['market-signals']));
  for (const n of ['get_brief', 'get_freshness']) assert.deepEqual(await runReadTool(n, {}, {}), { error: 'not available' });
});
