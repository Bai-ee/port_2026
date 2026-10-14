// runDailyLoop on the strategy spine: slotted suggestions, strategySource on the run doc,
// the old selector when the strategy inputs are absent, no model calls without a drafter,
// and reviewed work surviving a spine regenerate. buildDayPlan and the store are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDailyLoop } from '../daily-loop.js';
import { createMemoryRunStore, dismissSuggestion, editSuggestion } from '../daily-run-store.js';
import { loadDailyLoopInputs } from '../daily-loop/inputs.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-real-shapes.json', import.meta.url), 'utf8'));
const OWNER = 'fixture-client-a';
const NOW = Date.parse(FX.now);
const LOCAL = '2026-10-10';

function fakeBuildDayPlan() {
  const fn = (input) => {
    fn.calls.push(input);
    return {
      date: input.date,
      report: {},
      slots: [
        { slot: 'A', timeCT: '19:00', type: 'quote-react', lane: 'music', hoursFromNow: 1, dynamic: true },
        { slot: 'B', timeCT: '19:30', type: 'quote-react', lane: 'craft', hoursFromNow: 1.5, dynamic: true },
        { slot: 'C', timeCT: '20:00', type: 'original-text', lane: 'craft', hoursFromNow: 2 },
      ],
    };
  };
  fn.calls = [];
  return fn;
}
const withSpine = (buildDayPlan, extra = {}) => ({ ...FX, strategyInputs: { buildDayPlan, planInput: { corpusRows: [], benchmarkRows: null, packages: FX.packages }, ownPosts: [], ownHandle: 'bai_ee', ...extra } });
const deps = (store, inputs, extra = {}) => ({ now: () => NOW, store, readInputs: async () => inputs, ...extra });
const keyOf = (run) => ({ clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version });

test('spine path: slotted suggestions, strategySource on the run doc, plan built with the injected now', async () => {
  const bdp = fakeBuildDayPlan();
  const { run } = await runDailyLoop(deps(createMemoryRunStore(), withSpine(bdp)), { clientId: OWNER });
  assert.equal(bdp.calls.length, 1);
  assert.equal(bdp.calls[0].now, NOW);
  assert.equal(bdp.calls[0].date, LOCAL);
  assert.equal(bdp.calls[0].packages.length, FX.packages.length);
  assert.deepEqual(run.strategySource, { date: LOCAL, tier: 1, authoredPerDay: 3, mixSource: 'gap-report', slotLetters: ['A', 'B', 'C', 'R'] });
  assert.ok(run.suggestions.length > 0);
  assert.ok(run.suggestions.every((s) => s.slot && s.slot.letter));
  const quote = run.suggestions.find((s) => s.slot.letter === 'A');
  assert.ok(quote, 'quote-react slot filled from the watchlist scan');
  assert.equal(quote.type, 'quote');
  assert.equal(run.inputs.find((i) => i.input === 'strategy slots').status, 'loaded');
});

test('a precomputed plan is used as is, without buildDayPlan', async () => {
  const plan = fakeBuildDayPlan()({ date: LOCAL });
  const inputs = { ...FX, strategyInputs: { plan, ownPosts: [], ownHandle: 'bai_ee' } };
  const { run } = await runDailyLoop(deps(createMemoryRunStore(), inputs), { clientId: OWNER });
  assert.deepEqual(run.strategySource.slotLetters, ['A', 'B', 'C', 'R']);
});

test('absent strategy inputs keep the old selector: no slots, null strategySource', async () => {
  const { run } = await runDailyLoop(deps(createMemoryRunStore(), FX), { clientId: OWNER });
  assert.equal(run.strategySource, null);
  assert.ok(run.suggestions.every((s) => s.slot === null));
});

test('a spine run makes zero model calls without a drafter, and one per suggestion with it', async () => {
  const none = await runDailyLoop(deps(createMemoryRunStore(), withSpine(fakeBuildDayPlan())), { clientId: OWNER });
  assert.equal(none.run.usage.modelCalls, 0);
  assert.equal(none.run.copySource, 'fallback');
  let calls = 0;
  const draft = async () => { calls += 1; return { post: 'model words', model: 'fake-model' }; };
  const withModel = await runDailyLoop(deps(createMemoryRunStore(), withSpine(fakeBuildDayPlan()), { draft }), { clientId: OWNER });
  assert.equal(calls, withModel.run.usage.modelCalls);
  assert.ok(calls <= withModel.run.suggestions.length);
});

test('saved, edited and dismissed work survives a spine regenerate, with zero model calls', async () => {
  const store = createMemoryRunStore();
  const inputs = withSpine(fakeBuildDayPlan());
  const first = await runDailyLoop(deps(store, inputs), { clientId: OWNER });
  const [a, b] = first.run.suggestions;
  assert.ok(a && b);
  await dismissSuggestion({ store, now: () => NOW }, { key: keyOf(first.run), suggestionId: a.id });
  await editSuggestion({ store, now: () => NOW }, { key: keyOf(first.run), suggestionId: b.id, text: 'my words' });
  let calls = 0;
  const draft = async () => { calls += 1; return { post: 'x', model: 'fake-model' }; };
  const again = await runDailyLoop(deps(store, inputs, { draft }), { clientId: OWNER, force: true });
  const byId = new Map(again.run.suggestions.map((s) => [s.id, s]));
  assert.equal(byId.get(a.id).reviewState, 'dismissed');
  assert.equal(byId.get(b.id).reviewState, 'edited');
  assert.equal(byId.get(b.id).edit.text, 'my words');
  assert.ok(byId.get(a.id).slot && byId.get(b.id).slot);
  assert.ok(calls <= again.run.suggestions.length - 2);
});

test('a changed slot plan regenerates; the same plan is skipped as unchanged', async () => {
  const store = createMemoryRunStore();
  const run = (bdp) => runDailyLoop(deps(store, withSpine(bdp)), { clientId: OWNER });
  await run(fakeBuildDayPlan());
  assert.equal((await run(fakeBuildDayPlan())).skipped, true);
  const fewer = fakeBuildDayPlan();
  const trimmed = (input) => ({ ...fewer(input), slots: [{ slot: 'A', timeCT: '19:00', type: 'quote-react', lane: 'music', hoursFromNow: 1, dynamic: true }] });
  assert.equal((await run(trimmed)).skipped, false);
});

test('loadDailyLoopInputs hands back strategyInputs only with an injected buildDayPlan and both corpora', async () => {
  const doc = (data) => ({ exists: !!data, data: () => data, id: 'x' });
  const db = {
    collection: () => ({ doc: () => ({ get: async () => doc({}), collection: () => ({ doc: () => ({ get: async () => doc(null) }) }) }), select: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }),
    getAll: async () => [],
  };
  const row = { id: '1', utc: '2026-09-01T00:00:00.000Z', text: 'hello', type: 'original-text', topics: [], handle: 'bai_ee' };
  const corpora = { own: [row], benchmark: [row] };
  const bdp = () => ({});
  const off = await loadDailyLoopInputs({ db }, { clientId: OWNER, corpora, now: NOW });
  assert.equal(off.strategyInputs, null);
  const on = await loadDailyLoopInputs({ db, buildDayPlan: bdp }, { clientId: OWNER, corpora, now: NOW });
  assert.equal(on.strategyInputs.buildDayPlan, bdp);
  assert.equal(on.strategyInputs.planInput.corpusRows.length, 1);
  assert.equal(on.strategyInputs.ownHandle, null); // no handle passed => none, never the owner's
  const noCorpus = await loadDailyLoopInputs({ db, buildDayPlan: bdp }, { clientId: OWNER, now: NOW });
  assert.equal(noCorpus.strategyInputs, null);
});
