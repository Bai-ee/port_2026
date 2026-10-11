// The Strategy plan doc reaching the daily loop (T5): cadence, floors/caps, strategySource record, regenerate, id stability.
// Memory stores, injected clock, no model, no Firestore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDailyLoop, OWNER_CLIENT_IDS } from '../daily-loop.js';
import { createMemoryRunStore, editSuggestion } from '../daily-run-store.js';
import { buildDayPlan } from '../plan-day.js';
import { resolvePlanInputs } from '../../x-strategy/plan-inputs.js';
import { normalizePlan } from '../../x-strategy/plan-state.js';
import { loadDailyLoopInputs } from '../daily-loop/inputs.js';

const rd = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const FX = rd('./fixtures/daily-loop-replay.json');
const OWN = rd('../../../docs/audits/bai-ee-x-corpus.json');
const BENCH = rd('../../../docs/audits/seb-design-x-corpus.json');
const OWNER = OWNER_CLIENT_IDS[0];
const NOW = Date.parse(FX.now);

const planDoc = (plan, version = 1) => ({ version, plan: normalizePlan(plan) });
const inputsWith = (doc) => ({
  ...FX,
  strategyInputs: {
    buildDayPlan, planInput: { corpusRows: OWN, benchmarkRows: BENCH, packages: FX.packages }, ownPosts: OWN, ownHandle: 'bai_ee',
    ...(doc ? { planInputs: resolvePlanInputs(doc) } : {}),
  },
});
const gen = (store, doc, opts = {}) => runDailyLoop({ now: () => NOW, store, readInputs: async () => inputsWith(doc) }, { clientId: OWNER, inputSource: 'fixture', ...opts });

test('no plan doc: strategySource carries no plan fields (byte-level equality is pinned by t5-golden)', async () => {
  const none = await gen(createMemoryRunStore(), null);
  assert.equal('planSource' in none.run.strategySource, false);
  assert.equal('postsRequested' in none.run.strategySource, false);
  assert.equal(none.run.strategySource.authoredPerDay, 4);
});

test('a plan doc sets the cadence and is recorded on the run (source, version, posts used)', async () => {
  for (const n of [3, 6]) {
    const { run } = await gen(createMemoryRunStore(), planDoc({ authoredPerDay: n }, 5));
    assert.equal(run.strategySource.authoredPerDay, n);
    assert.equal(run.strategySource.planSource, 'plan-doc');
    assert.equal(run.strategySource.planVersion, 5);
    assert.equal(run.strategySource.postsRequested, n);
    assert.match(run.inputs.find((r) => r.input === 'strategy slots').detail, /Strategy plan v5/);
  }
});

test('plan typeCaps / typeFloors reach the slots', async () => {
  const { run } = await gen(createMemoryRunStore(), planDoc({ authoredPerDay: 6, typeFloors: { 'quote-react': 3 } }));
  const slotTypes = (r) => r.strategySource.slotLetters.length;
  assert.ok(slotTypes(run) >= 6);
  const capped = await gen(createMemoryRunStore(), planDoc({ authoredPerDay: 6, typeCaps: { 'quote-react': 1, 'quote-commentary': 0 } }));
  const quoteSlots = capped.run.suggestions.filter((s) => /^quote-/.test(s.slot?.type ?? ''));
  assert.ok(quoteSlots.length <= 1, `at most one quote slot filled, got ${quoteSlots.map((s) => s.slot.type)}`);
});

test('changing the plan regenerates (new fingerprint); the same plan version does not', async () => {
  const store = createMemoryRunStore();
  const first = await gen(store, planDoc({ authoredPerDay: 4 }, 1));
  const same = await gen(store, planDoc({ authoredPerDay: 4 }, 1));
  assert.equal(same.skipped, true);
  assert.equal(same.reason, 'unchanged');
  const changed = await gen(store, planDoc({ authoredPerDay: 3 }, 2));
  assert.equal(changed.skipped, false);
  assert.notEqual(changed.run.inputFingerprint, first.run.inputFingerprint);
});

test('an edit survives regeneration after a plan change (suggestion ids are slot-type + post + package)', async () => {
  const store = createMemoryRunStore();
  const first = await gen(store, planDoc({ authoredPerDay: 4 }, 1));
  const target = first.run.suggestions.find((s) => s.slot?.type === 'original-showcase' || s.slot?.type === 'original-text') || first.run.suggestions[0];
  const key = { clientId: OWNER, localDate: first.run.localDate, channel: 'x', version: first.run.version };
  await editSuggestion({ store, now: () => NOW }, { key, suggestionId: target.id, text: 'my own words' });
  const next = await gen(store, planDoc({ authoredPerDay: 6 }, 2), { force: true });
  const kept = next.run.suggestions.find((s) => s.id === target.id);
  assert.ok(kept, 'the edited suggestion id is still in the regenerated run');
  assert.equal(kept.edit?.text ?? kept.edit, 'my own words');
});

// loadDailyLoopInputs: readPlanDoc -> strategyInputs.planInputs (fake db; nothing real is read).
function fakeDb() {
  const none = { exists: false, data: () => ({}) };
  const doc = () => ({ get: async () => none, collection: () => ({ doc }) });
  return { collection: (name) => ({ doc, select: () => ({ get: async () => ({ docs: [] }) }), name }) };
}

test('loadDailyLoopInputs attaches planInputs only when readPlanDoc returns a doc', async () => {
  const base = { db: fakeDb(), buildDayPlan };
  const opts = { clientId: OWNER, corpora: { own: OWN.slice(0, 80), benchmark: BENCH.slice(0, 80) }, now: NOW };
  const absent = await loadDailyLoopInputs({ ...base, readPlanDoc: async () => null }, opts);
  assert.equal('planInputs' in absent.strategyInputs, false);
  const missingDep = await loadDailyLoopInputs(base, opts);
  assert.equal('planInputs' in missingDep.strategyInputs, false);
  const asked = [];
  const present = await loadDailyLoopInputs({ ...base, readPlanDoc: async (id) => { asked.push(id); return planDoc({ authoredPerDay: 3 }, 9); } }, opts);
  assert.deepEqual(asked, [OWNER]);
  assert.equal(present.strategyInputs.planInputs.source, 'plan-doc');
  assert.equal(present.strategyInputs.planInputs.posts, 3);
  assert.equal(present.strategyInputs.planInputs.planVersion, 9);
});

test('a cap that drops slots shows up in run.gaps as slot-dropped:<letter>:cap; a plan without caps adds none', async () => {
  const caps = { 'original-text': 1, 'original-showcase': 1, 'quote-react': 1, 'self-quote': 1, 'quote-commentary': 1 };
  const { run } = await gen(createMemoryRunStore(), planDoc({ authoredPerDay: 8, typeFloors: {}, typeCaps: caps }));
  const dropped = run.gaps.filter((g) => /^slot-dropped:[A-Z]:cap$/.test(g.code));
  assert.ok(dropped.length > 0, 'at least one slot dropped');
  const uncapped = await gen(createMemoryRunStore(), planDoc({ authoredPerDay: 8, typeFloors: {} }));
  assert.equal(run.strategySource.authoredPerDay, uncapped.run.strategySource.authoredPerDay - dropped.length);
  const plain = await gen(createMemoryRunStore(), planDoc({ authoredPerDay: 6 }));
  assert.equal(plain.run.gaps.filter((g) => g.code.startsWith('slot-dropped')).length, 0);
});
