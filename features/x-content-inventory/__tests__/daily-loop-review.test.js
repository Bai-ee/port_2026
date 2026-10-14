import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDailyLoop, MAX_SUGGESTIONS } from '../daily-loop.js';
import { createMemoryRunStore, mergePreserved, saveSuggestionDraft, editSuggestion, dismissSuggestion } from '../daily-run-store.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-replay.json', import.meta.url), 'utf8'));
const OWNER = 'fixture-client-a';
const NOW = Date.parse(FX.now);
const LOCAL = '2026-10-10';

async function setup() {
  const store = createMemoryRunStore();
  const { run } = await runDailyLoop({ now: () => NOW, store, readInputs: async () => FX }, { clientId: OWNER });
  const key = { clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version };
  const rows = new Map();
  const deps = {
    store, now: () => NOW,
    getPackage: async (id) => FX.packages.find((p) => p.id === id),
    postExists: async (id) => rows.has(id),
    createDraftPostOnce: async (clientId, postId, payload) => {
      if (rows.has(postId)) return { post: rows.get(postId), existing: true };
      const post = { id: postId, clientId, ...payload, status: 'draft', scheduledAt: null };
      rows.set(postId, post);
      return { post, existing: false };
    },
  };
  return { store, run, key, rows, deps };
}

const sug = (id, extra = {}) => ({ id, opportunity: { id: `o-${id}` }, package: { id: `p-${id}` }, reviewState: 'pending', socialPostId: null, ...extra });

test('an edit survives a forced regeneration', async () => {
  const { store, run, key, deps } = await setup();
  const id = run.suggestions[0].id;
  await editSuggestion(deps, { key, suggestionId: id, text: 'my own wording' });
  const forced = await runDailyLoop({ now: () => NOW, store, readInputs: async () => FX }, { clientId: OWNER, force: true });
  const kept = forced.run.suggestions.filter((s) => s.id === id);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].reviewState, 'edited');
  assert.equal(kept[0].edit.text, 'my own wording');
});

test('an edit is re-checked: a blocked edit is flagged and cannot be saved; empty text clears it', async () => {
  const { run, key, deps, rows } = await setup();
  const id = run.suggestions[0].id;
  const edited = await editSuggestion(deps, { key, suggestionId: id, text: 'so good #house' });
  assert.equal(edited.edit.checks.blocked, true);
  await assert.rejects(saveSuggestionDraft(deps, { key, suggestionId: id }), /Blocked/);
  assert.equal(rows.size, 0);
  const cleared = await editSuggestion(deps, { key, suggestionId: id, text: '  ' });
  assert.equal(cleared.edit, null);
  assert.equal(cleared.reviewState, 'pending');
});

test('saved and dismissed suggestions refuse edits with 409', async () => {
  const { run, key, deps } = await setup();
  await saveSuggestionDraft(deps, { key, suggestionId: run.suggestions[0].id });
  await assert.rejects(editSuggestion(deps, { key, suggestionId: run.suggestions[0].id, text: 'late' }), (e) => e.status === 409);
  assert.ok(run.suggestions[1], 'fixture should yield a second suggestion');
  await dismissSuggestion(deps, { key, suggestionId: run.suggestions[1].id });
  await assert.rejects(editSuggestion(deps, { key, suggestionId: run.suggestions[1].id, text: 'late' }), (e) => e.status === 409);
});

test('regeneration cap: 2 kept + 3 fresh yields MAX_SUGGESTIONS total, kept first', () => {
  const prev = { suggestions: [sug('a', { reviewState: 'edited' }), sug('b', { reviewState: 'saved', socialPostId: 'social_b' })] };
  const next = { suggestions: [sug('c'), sug('d'), sug('e')] };
  const merged = mergePreserved(prev, next).suggestions;
  assert.equal(merged.length, MAX_SUGGESTIONS);
  assert.deepEqual(merged.slice(0, 3).map((s) => s.id), ['a', 'b', 'c']);
});

test('a dismissed pair is not re-suggested and does not use a slot', () => {
  const prev = { suggestions: [sug('a', { reviewState: 'dismissed' })] };
  // Same opportunity+package under a new id must still be skipped.
  const next = { suggestions: [sug('z', { opportunity: { id: 'o-a' }, package: { id: 'p-a' } }), sug('c'), sug('d'), sug('e'), sug('f'), sug('g')] };
  const ids = mergePreserved(prev, next).suggestions.map((s) => s.id);
  assert.ok(!ids.includes('z'));
  assert.equal(ids.filter((id) => id !== 'a').length, MAX_SUGGESTIONS);
});

test('repeated save after an edit lands on one row carrying the edited text', async () => {
  const { run, key, deps, rows } = await setup();
  const s = run.suggestions[0];
  await editSuggestion(deps, { key, suggestionId: s.id, text: 'edited take' });
  const [a, b] = await Promise.all([1, 2].map(() => saveSuggestionDraft(deps, { key, suggestionId: s.id })));
  assert.equal(a.postId, b.postId);
  assert.equal(rows.size, 1);
  assert.ok([...rows.values()][0].content.startsWith('edited take'));
});

test('a deleted queue row can be saved again: same id, still one row', async () => {
  const { run, key, deps, rows, store } = await setup();
  const s = run.suggestions[0];
  const first = await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'keep this wording' });
  rows.delete(first.postId);
  const again = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  assert.equal(again.postId, first.postId);
  assert.equal(again.existing, false);
  assert.equal(rows.size, 1);
  assert.ok([...rows.values()][0].content.startsWith('keep this wording'));
  assert.equal((await store.read(key)).suggestions.find((x) => x.id === s.id).reviewState, 'saved');
});

test('run doc records inputSource and copySource', async () => {
  const d = { now: () => NOW, readInputs: async () => FX };
  const fixture = await runDailyLoop({ ...d, store: createMemoryRunStore() }, { clientId: OWNER, inputSource: 'fixture' });
  assert.equal(fixture.run.inputSource, 'fixture');
  assert.equal(fixture.run.copySource, 'fallback');
  const live = await runDailyLoop({ ...d, store: createMemoryRunStore() }, { clientId: OWNER });
  assert.equal(live.run.inputSource, 'live');
});
