import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDailyLoop, describeInputs, inputFingerprint, OWNER_CLIENT_IDS } from '../daily-loop.js';
import { suggestionIdFor } from '../daily-loop/time-ids.js';
import { LOOP_VERSION } from '../daily-loop/config.js';
import { createMemoryRunStore, mergePreserved, editSuggestion, dismissSuggestion } from '../daily-run-store.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-replay.json', import.meta.url), 'utf8'));
const OWNER = OWNER_CLIENT_IDS[0];
const NOW = Date.parse(FX.now);
const LOCAL = '2026-10-10';
const SOURCE = { date: LOCAL, tier: 1, authoredPerDay: 4, mixSource: 'gap-report', slotLetters: ['A', 'B', 'R'] };

const deps = (store, extra = {}, inputs = FX) => ({ now: () => NOW, store, readInputs: async () => inputs, ...extra });
const keyOf = (run) => ({ clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version });
function countingDrafter() {
  const draft = async () => { draft.calls += 1; return { post: 'model words here', model: 'fake-model' }; };
  draft.calls = 0;
  return draft;
}

test('loop version is 3 so the old v2 run doc is never touched', async () => {
  assert.equal(LOOP_VERSION, 3);
  const { run } = await runDailyLoop(deps(createMemoryRunStore()), { clientId: OWNER });
  assert.equal(run.version, 3);
});

test('suggestion id ignores the slot letter and tracks type + post + package', () => {
  const base = { clientId: OWNER, localDate: LOCAL, slotType: 'quote-react', opportunityId: '9104', packageId: null };
  assert.equal(suggestionIdFor({ ...base, slot: 'A' }), suggestionIdFor({ ...base, slot: 'C' }));
  assert.notEqual(suggestionIdFor(base), suggestionIdFor({ ...base, slotType: 'reply' }));
  assert.notEqual(suggestionIdFor(base), suggestionIdFor({ ...base, opportunityId: '9105' }));
  assert.match(suggestionIdFor(base), /^dl_20261010_[0-9a-f]{8}$/);
});

test('an edit survives a calendar shift because the id is unchanged', () => {
  const id = suggestionIdFor({ clientId: OWNER, localDate: LOCAL, slotType: 'quote-react', opportunityId: '9104', packageId: null });
  const prev = { suggestions: [{ id, opportunity: { id: '9104' }, package: null, reviewState: 'edited', edit: { text: 'mine' }, slot: { letter: 'A' } }] };
  const next = { suggestions: [{ id, opportunity: { id: '9104' }, package: null, reviewState: 'pending', slot: { letter: 'C' } }] };
  const merged = mergePreserved(prev, next).suggestions;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].edit.text, 'mine');
});

test('ids are identical across two regenerations of identical inputs', async () => {
  const store = createMemoryRunStore();
  const a = await runDailyLoop(deps(store), { clientId: OWNER });
  const b = await runDailyLoop(deps(store), { clientId: OWNER, force: true });
  assert.deepEqual(b.run.suggestions.map((s) => s.id), a.run.suggestions.map((s) => s.id));
});

test('saved and dismissed suggestions cost zero model calls on regeneration', async () => {
  const store = createMemoryRunStore();
  const { run } = await runDailyLoop(deps(store), { clientId: OWNER });
  const key = keyOf(run);
  await dismissSuggestion({ store, now: () => NOW }, { key, suggestionId: run.suggestions[0].id });
  store.docs.get(`${OWNER}__${LOCAL}__x__v3`).suggestions.slice(1).forEach((s) => { s.reviewState = 'saved'; s.socialPostId = `social_${s.id}`; });
  const draft = countingDrafter();
  await runDailyLoop(deps(store, { draft }), { clientId: OWNER, force: true });
  assert.equal(draft.calls, 0);
});

test('a no-model forced regenerate keeps a pending model draft; a gone id is not resurrected', async () => {
  const store = createMemoryRunStore();
  const first = await runDailyLoop(deps(store, { draft: countingDrafter() }), { clientId: OWNER });
  assert.equal(first.run.copySource, 'model');
  const ids = first.run.suggestions.map((s) => s.id);

  const again = await runDailyLoop(deps(store), { clientId: OWNER, force: true });
  assert.equal(again.run.suggestions.every((s) => s.draft.source === 'fake-model' && s.draft.text === 'model words here'), true);
  assert.equal(again.run.copySource, 'model');
  assert.equal(again.run.usage.modelCalls, 0);

  // Inputs shrink: a suggestion whose id is gone is not brought back with its old draft.
  const fewer = { ...FX, packages: FX.packages.filter((p) => !again.run.suggestions.some((s) => s.package?.id === p.id && s.id === ids[0])) };
  const shrunk = await runDailyLoop(deps(store, {}, fewer), { clientId: OWNER, force: true });
  assert.ok(!shrunk.run.suggestions.some((s) => s.id === ids[0]));
});

test('run doc stores strategySource and per-suggestion slot/package nulls; absent stays null', async () => {
  const plain = await runDailyLoop(deps(createMemoryRunStore()), { clientId: OWNER });
  assert.equal(plain.run.strategySource, null);
  assert.ok(plain.run.suggestions.every((s) => s.slot === null));
  const withSrc = await runDailyLoop(deps(createMemoryRunStore(), {}, { ...FX, strategySource: SOURCE }), { clientId: OWNER });
  assert.deepEqual(withSrc.run.strategySource, SOURCE);
});

test('a changed slot plan changes the fingerprint and regenerates', async () => {
  const store = createMemoryRunStore();
  const run = (src) => runDailyLoop(deps(store, {}, { ...FX, strategySource: src }), { clientId: OWNER });
  await run(SOURCE);
  assert.equal((await run(SOURCE)).skipped, true);
  assert.equal((await run({ ...SOURCE, slotLetters: ['A', 'R'] })).skipped, false);
  const base = { scan: null, search: null, packages: [], max: 3 };
  assert.notEqual(inputFingerprint({ ...base, strategySource: SOURCE }), inputFingerprint(base));
});

test('inputs: strategy row, Seb-rules voice label, Strategy Builder not used for X; works without strategySource', () => {
  const rows = describeInputs({ ...FX, strategySource: SOURCE }, NOW);
  const strat = rows.find((r) => r.input === 'strategy slots');
  assert.equal(strat.status, 'loaded');
  assert.match(strat.detail, /gap-report.*tier 1.*A, B, R/);
  assert.equal(rows.find((r) => r.input === 'Client Brain').detail, 'Seb rules §7 + content guard — Brain not used');
  assert.match(rows.find((r) => r.input === 'Strategy Builder plan').detail, /^not used for X/);
  assert.equal(describeInputs(FX, NOW).find((r) => r.input === 'strategy slots').status, 'missing');
});
