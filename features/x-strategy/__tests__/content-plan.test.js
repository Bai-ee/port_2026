// content-plan / refresh-analysis reading the Strategy plan doc (T5). Memory stores only; no Firestore, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContentPlanHandlers } from '../content-plan.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { buildDayPlan } from '../../x-content-inventory/plan-day.js';
import { summarizeCorpus } from '../../x-benchmark/summarize.js';
import { readFileSync } from 'node:fs';
import { makeLegacyReaders } from './fixtures/t5-golden/legacy-cases.mjs';

const repoRows = (rel) => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
const OWN = repoRows('docs/audits/bai-ee-x-corpus.json');
const BENCH = repoRows('docs/audits/seb-design-x-corpus.json');
const PLAN = { authoredPerDay: 5 }; // any plan doc: selects the plan-doc branch (the no-plan branch is the legacy path, see t5-golden.test.js)

const NOW = Date.parse('2026-10-11T15:00:00.000Z');
const CTX = { clientId: 'c1' };

async function setup({ config = { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] }, plan = null, buildPlan, corpusStore, readCorpus } = {}) {
  const planStore = createMemoryPlanStore();
  if (plan) await planStore.apply('c1', { changes: plan, expectedVersion: 0, by: 'test', source: 'manual', now: NOW });
  const calls = [];
  const spy = (input) => { calls.push(input); return (buildPlan || buildDayPlan)(input); };
  const h = createContentPlanHandlers({
    corpusStore: corpusStore ?? createMemoryCorpusStore(),
    planStore,
    readXGrowthConfig: async () => config,
    readInventory: async () => ({ packages: [], seeded: false }),
    buildPlan: spy,
    legacyRows: { own: OWN, benchmark: BENCH },
    ...makeLegacyReaders({ own: OWN, bench: BENCH, summarizeCorpus }),
    ...(readCorpus ? { readCorpus } : {}),
    saveGapReport: async () => {},
    clock: () => NOW,
  });
  return { ...h, calls, planStore };
}

test('authoredPerDay 3 and 6 decide the day size; the request\'s own posts is ignored once a plan exists', async () => {
  for (const n of [3, 6]) {
    const { contentPlan } = await setup({ plan: { authoredPerDay: n } });
    const out = await contentPlan(CTX, { posts: 8, date: '2026-10-11' });
    assert.equal(out.planSource, 'plan-doc');
    assert.equal(out.planVersion, 1);
    assert.equal(out.plan.slots.length, n);
  }
});

test('without a plan (legacy path) the request\'s posts applies (default 5, capped at 12)', async () => {
  const { contentPlan } = await setup();
  assert.equal((await contentPlan(CTX, { date: '2026-10-11' })).plan.slots.length, 5);
  assert.equal((await contentPlan(CTX, { posts: 99, date: '2026-10-11' })).plan.slots.length, 12);
});

test('engineConfig is passed only for a plan with non-empty engineTargets', async () => {
  const none = await setup({ plan: { authoredPerDay: 4 } });
  await none.contentPlan(CTX, { date: '2026-10-11' });
  assert.equal('engineConfig' in none.calls[0], false);
  const some = await setup({ plan: { authoredPerDay: 3, engineTargets: { authored: { targetPerDay: 3 } } } });
  await some.contentPlan(CTX, { date: '2026-10-11' });
  assert.equal(some.calls[0].engineConfig.authored.targetPerDay, 3);
});

test('rows come from the rows store: a fresher stored row set wins over the committed file', async () => {
  const corpusStore = createMemoryCorpusStore();
  const rows = [{ id: '1', utc: '2026-10-09T12:00:00.000Z', type: 'original-text', text: 'fresh row', likes: 1, views: 10 }];
  await corpusStore.writeMergedRows('bai_ee', rows, { pulledAt: '2026-10-10T00:00:00.000Z' });
  const { contentPlan, calls } = await setup({ corpusStore, plan: PLAN });
  await contentPlan(CTX, { date: '2026-10-11' });
  // writeMergedRows merges onto the committed rows (262) by id, so the stored set is 263 and carries the new row.
  assert.equal(calls[0].corpusRows.length, 263);
  assert.ok(calls[0].corpusRows.some((r) => r.text === 'fresh row'));
});

test('benchmarkPrimary picks the benchmark when it is one of the profile handles, else the first', async () => {
  const corpusStore = createMemoryCorpusStore();
  await corpusStore.writeMergedRows('other', [{ id: '9', utc: '2026-10-09T12:00:00.000Z', type: 'original-text', text: 'o', likes: 1 }], { pulledAt: '2026-10-10T00:00:00.000Z' });
  const config = { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design', 'other'] };
  const picked = await setup({ config, corpusStore, plan: { authoredPerDay: 4, benchmarkPrimary: 'other' } });
  await picked.contentPlan(CTX, { date: '2026-10-11' });
  assert.equal(picked.calls[0].benchmarkRows.length, 1);
  const unknown = await setup({ config, corpusStore, plan: { authoredPerDay: 4, benchmarkPrimary: 'not_in_profile' } });
  await unknown.contentPlan(CTX, { date: '2026-10-11' });
  assert.ok(unknown.calls[0].benchmarkRows.length > 100, 'falls back to the first profile benchmark (seb__design committed rows)');
});

test('an empty profile with a plan is a 409 asking for the X handle, never the bai_ee / seb__design pair', async () => {
  const { contentPlan, refreshAnalysis, calls } = await setup({ config: null, plan: PLAN });
  await assert.rejects(contentPlan(CTX, { date: '2026-10-11' }), (e) => e.status === 409 && /No X handle saved/.test(e.message));
  await assert.rejects(refreshAnalysis(CTX), (e) => e.status === 409 && /No X handle saved/.test(e.message));
  assert.equal(calls.length, 0, 'no plan was built from anyone\'s corpus');
});

test('own handle but no benchmarks: content-plan runs without benchmark rows; refresh-analysis 409s (no seb__design fallback)', async () => {
  const { contentPlan, refreshAnalysis, calls } = await setup({ config: { ownHandle: 'bai_ee' }, plan: PLAN });
  const out = await contentPlan(CTX, { date: '2026-10-11' });
  assert.equal(out.ok, true);
  assert.equal(calls[0].benchmarkRows, null);
  await assert.rejects(refreshAnalysis(CTX), (e) => e.status === 409 && /No benchmark accounts saved/.test(e.message));
});

test('legacy no-plan path: only the client whose own handle is the committed corpus\'s account gets it', async () => {
  const home = await setup({ config: { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] } });
  assert.equal((await home.contentPlan(CTX, { date: '2026-10-11' })).ok, true);
  for (const config of [null, {}, { ownHandle: 'other_acct', benchmarkHandles: ['seb__design'] }, { ownHandle: 'seb__design' }]) {
    const other = await setup({ config });
    await assert.rejects(other.contentPlan(CTX, { date: '2026-10-11' }), (e) => e.status === 409 && /No Strategy plan yet/.test(e.message), JSON.stringify(config));
    assert.equal(other.calls.length, 0, 'the owner corpora were never handed to buildPlan');
  }
});

test('no rows for the own handle is a 409 with a pointer to Refresh, not an empty plan', async () => {
  const { contentPlan } = await setup({ config: { ownHandle: 'nobody_here', benchmarkHandles: ['seb__design'] }, plan: PLAN });
  await assert.rejects(contentPlan(CTX, {}), (e) => e.status === 409 && /Refresh/.test(e.message));
});

test('refresh-analysis with a plan: calendar has exactly authoredPerDay slots/day, tier source plan, version reported', async () => {
  for (const n of [3, 6]) {
    const { refreshAnalysis } = await setup({ plan: { authoredPerDay: n } });
    const out = await refreshAnalysis(CTX);
    assert.equal(out.planSource, 'plan-doc');
    assert.equal(out.planVersion, 1);
    assert.equal(out.tier.source, 'plan');
    assert.equal(out.tier.authoredPerDay, n);
    assert.equal(out.calendar.days[0].slots.length, n);
  }
});

test('refresh-analysis: the plan\'s benchmarkPrimary drives the calendar report, the other becomes an alternate', async () => {
  const corpusStore = createMemoryCorpusStore();
  const seb = (await corpusStore.readRows('seb__design')).rows.slice(0, 200);
  await corpusStore.writeMergedRows('other', seb, { pulledAt: '2026-10-10T00:00:00.000Z' });
  const config = { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design', 'other'] };
  const { refreshAnalysis } = await setup({ config, corpusStore, plan: { authoredPerDay: 4, benchmarkPrimary: 'other' } });
  const out = await refreshAnalysis(CTX);
  assert.equal(out.report.benchmarkHandle, 'other');
  assert.deepEqual(out.report.alternates.map((a) => a.benchmarkHandle), ['seb__design']);
});

test('refresh-analysis: a handle with no rows falls back to its legacy stat block; with neither it is a 409', async () => {
  const committed = (await createMemoryCorpusStore().readRows('bai_ee')).rows;
  const legacy = { stats: summarizeCorpus(committed, { handle: 'legacy_acct' }), meta: { source: 'ingest' } };
  const config = { ownHandle: 'legacy_acct', benchmarkHandles: ['seb__design'] };
  const ok = await setup({ config, plan: PLAN, readCorpus: async (h) => (h === 'legacy_acct' ? legacy : null) });
  const out = await ok.refreshAnalysis(CTX);
  assert.equal(out.ok, true);
  assert.deepEqual(out.report.corpora.own, { handle: 'legacy_acct', source: 'ingest' });
  const none = await setup({ config, plan: PLAN });
  await assert.rejects(none.refreshAnalysis(CTX), (e) => e.status === 409);
});
