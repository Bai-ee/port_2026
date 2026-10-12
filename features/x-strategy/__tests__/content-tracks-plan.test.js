// plan.contentTracks wiring: plan-state, evaluate, loop-corpora, agent tools/proposals/prompt, engine-quota hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, normalizePlan, validatePlan, revertTo } from '../plan-state.js';
import { DEFAULT_TRACKS } from '../content-tracks.js';
import { PLAN_LIMITS } from '../contracts.js';
import { evaluate } from '../evaluate.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { loadTrackCorpora } from '../loop-corpora.js';
import { buildSystemPrompt, summarizePlan } from '../agent/prompt.js';
import { prepareProposal, runReadTool, TOOL_SCHEMAS } from '../agent/tools.js';
import { validateProposal } from '../agent/proposals.js';
import { createContentPlanHandlers } from '../content-plan.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { mergeEngineConfig, raiseEngineMinimums } from '../../x-content-inventory/engine-quota.js';

const tracks = () => JSON.parse(JSON.stringify(DEFAULT_TRACKS));
const req = (over = {}) => ({ changes: {}, by: 'owner', source: 'manual', reason: 'r', expectedVersion: 0, now: 1_000, ...over });
const row = (i, over = {}) => ({
  id: String(i), utc: '2026-09-01T10:00:00.000Z', dateLocal: `2026-09-${String(1 + (i % 25)).padStart(2, '0')}`, hourLocal: 10 + (i % 8),
  type: 'original-text', media: 'none', topics: [], chars: 80 + i, likes: i % 7, reposts: 0, replies: 0, views: 100 + i, ...over,
});
const rows = (n, over) => Array.from({ length: n }, (_, i) => row(i + 1, over));

test('limits: 8 distinct benchmark handles', () => assert.equal(PLAN_LIMITS.maxBenchmarkHandles, 8));

test('back-compat: normalizePlan without contentTracks adds nothing; null clears', () => {
  assert.ok(!('contentTracks' in normalizePlan({})));
  assert.ok(!('contentTracks' in normalizePlan({ contentTracks: null })));
  assert.equal(validatePlan(normalizePlan({})).ok, true);
});

test('contentTracks round-trips through applyChange with history + revert', () => {
  const t = tracks();
  t[1].benchmarks = ['musicguy'];
  const v1 = applyChange(null, req({ changes: { contentTracks: t } }));
  assert.equal(v1.version, 1);
  assert.deepEqual(v1.plan.contentTracks[1].benchmarks, ['musicguy']);
  assert.ok(v1.history[0].diff.some((d) => d.path === 'contentTracks'));
  const t2 = JSON.parse(JSON.stringify(v1.plan.contentTracks));
  t2[0].share = 0.8; t2[1].share = 0.2;
  const v2 = applyChange(v1, req({ changes: { contentTracks: t2 }, expectedVersion: 1 }));
  assert.equal(v2.plan.contentTracks[0].share, 0.8);
  const back = revertTo(v2, 1, { by: 'owner' });
  assert.equal(back.plan.contentTracks[0].share, 0.5);
  const cleared = applyChange(v2, req({ changes: { contentTracks: null }, expectedVersion: 2 }));
  assert.ok(!('contentTracks' in cleared.plan));
});

test('invalid contentTracks is rejected with a reason (missing engine, 4 benchmarks, 9 distinct)', () => {
  const t = tracks(); t[1].engines = ['ue'];
  assert.match(applyChange(null, req({ changes: { contentTracks: t } })).errors.join(' '), /record/);
  const t2 = tracks(); t2[0].benchmarks = ['a', 'b', 'c', 'd'];
  assert.equal(applyChange(null, req({ changes: { contentTracks: t2 } })).error, 'invalid');
  const t3 = tracks(); t3[0].benchmarks = ['a', 'b', 'c']; t3[1].benchmarks = ['d', 'e', 'f'];
  assert.equal(applyChange(null, req({ changes: { contentTracks: t3 } })).plan.contentTracks.length, 2); // 6 distinct ok
});

test('evaluate: no byTrack key without tracks (output unchanged); grouped per track with them', () => {
  const base = { ownHandle: 'me', ownRows: rows(80), ownMeta: null, plan: null, now: Date.parse('2026-10-11T00:00:00Z') };
  const input = { ...base, benchmarks: [{ handle: 'seb__design', rows: rows(80, { likes: 20 }), meta: null }, { handle: 'mm', rows: rows(80, { likes: 3 }), meta: null }] };
  assert.ok(!('byTrack' in evaluate(input)));
  const t = tracks(); t[1].benchmarks = ['mm'];
  const out = evaluate({ ...input, plan: { ...normalizePlan({}), contentTracks: t } });
  const [design, music] = out.byTrack;
  assert.equal(design.gapsAgainst, 'seb__design');
  assert.equal(music.gapsAgainst, 'mm');
  assert.deepEqual(music.perBenchmark.map((p) => p.handle), ['mm']);
  // default tracks: music has no benchmark
  const d = evaluate({ ...input, tracks: tracks() });
  assert.equal(d.byTrack[1].status, 'no-benchmark');
  assert.equal(d.byTrack[1].fallback, 'own-history');
  assert.deepEqual(d.byTrack[1].gaps, []);
  assert.deepEqual(d.gaps, evaluate(input).gaps, 'overall primary gaps unchanged');
});

test('loadTrackCorpora reads each track its own handles (store-first)', async () => {
  const store = createMemoryCorpusStore({ loadCommitted: () => null });
  await store.writeMergedRows('mm', rows(3), { pulledAt: '2026-10-11T00:00:00.000Z' });
  const t = tracks(); t[1].benchmarks = ['mm'];
  const out = await loadTrackCorpora({ corpusStore: store, tracks: t, loadCommitted: () => null });
  assert.equal(out.music.byHandle.mm.rows.length, 3);
  assert.deepEqual(out.design.handles, ['seb__design']);
  assert.ok(!('mm' in out.design.byHandle));
});

test('agent: plan-change proposal may carry contentTracks (validated); bad tracks refused', async () => {
  const doc = applyChange(null, req({ changes: { authoredPerDay: 6 } }));
  const toolDeps = { getPlan: async () => doc };
  const good = tracks(); good[1].benchmarks = ['musicguy'];
  const ok = await prepareProposal('propose_plan_change', { changes: { contentTracks: good }, expectedVersion: 1, summary: 's', rationale: 'r', evidence: [] }, { toolDeps });
  assert.equal(ok.ok, true, ok.error);
  const bad = tracks(); bad[0].engines = ['client'];
  const no = await prepareProposal('propose_plan_change', { changes: { contentTracks: bad }, expectedVersion: 1, summary: 's', rationale: 'r', evidence: [] }, { toolDeps });
  assert.equal(no.ok, false);
  assert.match(no.error, /contentTracks/);
  assert.equal(validateProposal({ kind: 'plan-change', payload: { changes: { contentTracks: good }, expectedVersion: 1 } }).ok, true);
  assert.equal(validateProposal({ kind: 'plan-change', payload: { changes: { contentTracks: bad }, expectedVersion: 1 } }).ok, false);
});

test('agent: get_tracks tool + prompt/summary describe tracks only when set', async () => {
  assert.ok(TOOL_SCHEMAS.some((s) => s.name === 'get_tracks'));
  const none = await runReadTool('get_tracks', {}, { getPlan: async () => null });
  assert.equal(none.explicit, false);
  assert.deepEqual(none.tracks.map((x) => x.id), ['design', 'music']);
  const injected = await runReadTool('get_tracks', {}, { getTracks: async () => ({ tracks: [], profiles: [] }) });
  assert.deepEqual(injected, { tracks: [], profiles: [] });
  assert.match(buildSystemPrompt({}), /CONTENT TRACKS/);
  assert.doesNotMatch(summarizePlan({ version: 1, plan: normalizePlan({}) }), /content tracks/);
  const t = tracks(); t[1].benchmarks = ['mm'];
  assert.match(summarizePlan({ version: 1, plan: { ...normalizePlan({}), contentTracks: t } }), /music 50% \(@mm\)/);
  assert.match(summarizePlan({ version: 1, plan: { ...normalizePlan({}), contentTracks: tracks() } }), /music 50% \(no benchmark\)/);
});

test('engine-quota hook: raises minimums only, clamps to caps, does not mutate', () => {
  const cfg = mergeEngineConfig({});
  const before = JSON.stringify(cfg);
  const out = raiseEngineMinimums(cfg, { identity: { minPerDay: 0 }, record: { minPerDay: 9 }, ue: { weeklyMin: 99 }, client: { weeklyMin: 5 } });
  assert.equal(JSON.stringify(cfg), before);
  assert.equal(out.engines.identity.minPerDay, 1, 'floor not lowered');
  assert.equal(out.engines.record.minPerDay, cfg.engines.record.maxPerDay, 'clamped to maxPerDay');
  assert.equal(out.engines.ue.weeklyMin, cfg.engines.ue.weeklyMax, 'clamped to weeklyMax');
  assert.equal(out.engines.client.weeklyMin, 5);
});

test('content-plan: plan without contentTracks has no trackProfiles; with tracks it adds them', async () => {
  const store = createMemoryCorpusStore({ loadCommitted: () => null });
  await store.writeMergedRows('bai_ee', rows(30), { pulledAt: '2026-10-11T00:00:00.000Z' });
  await store.writeMergedRows('seb__design', rows(30, { likes: 9 }), { pulledAt: '2026-10-11T00:00:00.000Z' });
  const planStore = createMemoryPlanStore();
  const make = () => createContentPlanHandlers({
    corpusStore: store, planStore,
    readXGrowthConfig: async () => ({ ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] }),
    readInventory: async () => ({ packages: [], seeded: false }),
    buildPlan: (a) => ({ slots: [], engineConfig: a.engineConfig ?? null, posts: a.posts }),
    legacyRows: { own: [], benchmark: [] },
  });
  await planStore.apply('c1', req({ changes: { authoredPerDay: 6 } }));
  const plain = await make().contentPlan({ clientId: 'c1' }, { date: '2026-10-11' });
  assert.ok(!('trackProfiles' in plain));
  assert.equal(plain.plan.engineConfig, null);
  await planStore.apply('c1', req({ changes: { contentTracks: tracks() }, expectedVersion: 1 }));
  const withT = await make().contentPlan({ clientId: 'c1' }, { date: '2026-10-11' });
  assert.equal(withT.trackProfiles.length, 2);
  assert.equal(withT.trackProfiles[0].status, 'ok');
  assert.equal(withT.trackProfiles[1].status, 'no-benchmark');
  assert.ok(withT.plan.engineConfig.engines.identity.minPerDay >= 1);
});
