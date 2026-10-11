// CHARACTERIZATION: pins what the daily-loop review actions (save / edit / dismiss / regenerate) do TODAY.
// Complements daily-loop-review.test.js; not a spec. "CURRENT (known gap)" = behaviour the content-management work plans to change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDailyLoop, OWNER_CLIENT_IDS } from '../daily-loop.js';
import { createMemoryRunStore, saveSuggestionDraft, editSuggestion, dismissSuggestion } from '../daily-run-store.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-replay.json', import.meta.url), 'utf8'));
const OWNER = OWNER_CLIENT_IDS[0];
const NOW = Date.parse(FX.now);
const LOCAL = '2026-10-10';

async function setup({ withPostExists = true } = {}) {
  const store = createMemoryRunStore();
  const { run } = await runDailyLoop({ now: () => NOW, store, readInputs: async () => FX }, { clientId: OWNER });
  const key = { clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version };
  const rows = new Map();
  const calls = [];
  const deps = {
    store, now: () => NOW,
    getPackage: async (id) => FX.packages.find((p) => p.id === id),
    ...(withPostExists ? { postExists: async (id) => rows.has(id) } : {}),
    createDraftPostOnce: async (clientId, postId, payload) => {
      calls.push({ clientId, postId, payload });
      if (rows.has(postId)) return { post: rows.get(postId), existing: true };
      const post = { id: postId, clientId, ...payload, status: 'draft', scheduledAt: null };
      rows.set(postId, post);
      return { post, existing: false };
    },
  };
  return { store, run, key, rows, calls, deps };
}

test('save: row id is deterministic social_<suggestionId>; payload is an unscheduled daily-loop draft', async () => {
  const { run, key, deps, rows, calls } = await setup();
  const s = run.suggestions[0];
  const r = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  assert.deepEqual(r, { ok: true, postId: `social_${s.id}`, existing: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].clientId, OWNER);
  const p = calls[0].payload;
  assert.equal(p.platform, 'x');
  assert.equal(p.source, 'daily-loop');
  assert.equal(p.sourceRef.kind, 'daily-loop');
  assert.equal(p.sourceRef.suggestionId, s.id);
  assert.equal(p.sourceRef.suggestionType, s.type);
  assert.equal(p.xStrategy.source, 'daily-loop');
  assert.equal(rows.get(`social_${s.id}`).status, 'draft');
  assert.equal(rows.get(`social_${s.id}`).scheduledAt, null);
  const stored = (await deps.store.read(key)).suggestions.find((x) => x.id === s.id);
  assert.equal(stored.reviewState, 'saved');
  assert.equal(stored.socialPostId, `social_${s.id}`);
  assert.equal(stored.savedAt, new Date(NOW).toISOString());
});

test('repeated save => ONE row; the second call short-circuits (existing:true) without calling createDraftPostOnce again', async () => {
  const { run, key, deps, rows, calls } = await setup();
  const id = run.suggestions[0].id;
  const a = await saveSuggestionDraft(deps, { key, suggestionId: id });
  const b = await saveSuggestionDraft(deps, { key, suggestionId: id });
  const c = await saveSuggestionDraft(deps, { key, suggestionId: id });
  assert.equal(a.existing, false);
  assert.equal(b.existing, true);
  assert.equal(c.existing, true);
  assert.equal(rows.size, 1);
  assert.equal(calls.length, 1);
});

test('edit then save: the saved row carries the edited text; the stored suggestion keeps edit + savedText', async () => {
  const { run, key, deps, rows } = await setup();
  const s = run.suggestions[0];
  const edited = await editSuggestion(deps, { key, suggestionId: s.id, text: '  my edited take  ' });
  assert.equal(edited.reviewState, 'edited');
  assert.equal(edited.edit.text, 'my edited take');
  await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  const row = rows.get(`social_${s.id}`);
  assert.ok(row.content.startsWith('my edited take'));
  const stored = (await deps.store.read(key)).suggestions.find((x) => x.id === s.id);
  assert.equal(stored.savedText, 'my edited take');
  assert.equal(stored.edit.text, 'my edited take');
});

test('save with explicit text wins over a stored edit', async () => {
  const { run, key, deps, rows } = await setup();
  const s = run.suggestions[0];
  await editSuggestion(deps, { key, suggestionId: s.id, text: 'stored edit' });
  await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'explicit text' });
  assert.ok(rows.get(`social_${s.id}`).content.startsWith('explicit text'));
});

test('CURRENT (known gap): once saved, a different text on a second save is silently ignored - the queue row keeps the first text', async () => {
  const { run, key, deps, rows } = await setup();
  const s = run.suggestions[0];
  await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'first wording' });
  const again = await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'second wording' });
  assert.equal(again.existing, true);
  assert.ok(rows.get(`social_${s.id}`).content.startsWith('first wording'));
});

test('CURRENT (known gap): "existing" only means the row exists - a row that has since moved on (approved/posted) is still returned as a draft', async () => {
  const { run, key, deps, rows } = await setup();
  const s = run.suggestions[0];
  const first = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  rows.get(first.postId).status = 'posted';
  const again = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  assert.deepEqual(again, { ok: true, postId: first.postId, existing: true });
  assert.equal(rows.get(first.postId).status, 'posted');
});

test('CURRENT (known gap): without deps.postExists a saved suggestion is always reported existing, even if the row was deleted', async () => {
  const { run, key, deps, rows } = await setup({ withPostExists: false });
  const s = run.suggestions[0];
  const first = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  rows.delete(first.postId);
  const again = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  assert.equal(again.existing, true);
  assert.equal(rows.size, 0);
});

test('dismiss: marks dismissed with a timestamp; later save and edit are refused with 409; no row is created', async () => {
  const { run, key, deps, rows } = await setup();
  const s = run.suggestions[0];
  const d = await dismissSuggestion(deps, { key, suggestionId: s.id });
  assert.equal(d.reviewState, 'dismissed');
  assert.equal(d.dismissedAt, new Date(NOW).toISOString());
  await assert.rejects(saveSuggestionDraft(deps, { key, suggestionId: s.id }), (e) => e.status === 409);
  await assert.rejects(editSuggestion(deps, { key, suggestionId: s.id, text: 'x' }), (e) => e.status === 409);
  assert.equal(rows.size, 0);
});

test('dismiss after save is refused (409) and the queue row is untouched', async () => {
  const { run, key, deps, rows } = await setup();
  const s = run.suggestions[0];
  await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  await assert.rejects(dismissSuggestion(deps, { key, suggestionId: s.id }), (e) => e.status === 409);
  assert.equal(rows.size, 1);
});

test('unknown suggestion id: 404 for save, edit and dismiss', async () => {
  const { key, deps } = await setup();
  await assert.rejects(saveSuggestionDraft(deps, { key, suggestionId: 'nope' }), (e) => e.status === 404);
  await assert.rejects(editSuggestion(deps, { key, suggestionId: 'nope', text: 'x' }), (e) => e.status === 404);
  await assert.rejects(dismissSuggestion(deps, { key, suggestionId: 'nope' }), (e) => e.status === 404);
});

test('regenerate (force) does not overwrite or duplicate a saved post: same suggestion, same socialPostId, queue row untouched', async () => {
  const { run, key, deps, rows, store } = await setup();
  const s = run.suggestions[0];
  await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'saved wording' });
  const rowBefore = JSON.stringify(rows.get(`social_${s.id}`));
  const forced = await runDailyLoop({ now: () => NOW, store, readInputs: async () => FX }, { clientId: OWNER, force: true });
  const kept = forced.run.suggestions.filter((x) => x.id === s.id);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].reviewState, 'saved');
  assert.equal(kept[0].socialPostId, `social_${s.id}`);
  assert.equal(kept[0].savedText, 'saved wording');
  assert.equal(rows.size, 1);
  assert.equal(JSON.stringify(rows.get(`social_${s.id}`)), rowBefore);
});

test('regenerate keeps a dismissed suggestion dismissed (it is not resurrected as pending)', async () => {
  const { run, key, deps, store } = await setup();
  const s = run.suggestions[0];
  await dismissSuggestion(deps, { key, suggestionId: s.id });
  const forced = await runDailyLoop({ now: () => NOW, store, readInputs: async () => FX }, { clientId: OWNER, force: true });
  const kept = forced.run.suggestions.filter((x) => x.id === s.id);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].reviewState, 'dismissed');
});

test('PHASE 2: save persists provenance (runId, suggestionId, strategyVersion, channel, lifecycleVersion) and keeps the deterministic id', async () => {
  const { run, key, deps, calls } = await setup();
  const s = run.suggestions[0];
  const r = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  assert.equal(r.postId, `social_${s.id}`);
  const p = calls[0].payload;
  assert.equal(p.runId, `${key.clientId}__${key.localDate}__x__v${key.version}`);
  assert.equal(p.suggestionId, s.id);
  assert.equal(p.channel, 'x');
  assert.equal(p.lifecycleVersion, 2);
  const pv = run.strategySource?.planVersion;
  if (typeof pv === 'number') assert.equal(p.strategyVersion, pv); else assert.equal('strategyVersion' in p, false);
});

test('PHASE 2: strategyVersion is persisted when the run carries a numeric planVersion; expiresAt only when the suggestion has one', async () => {
  const { run, key, deps, calls, store } = await setup();
  const s = run.suggestions[0];
  await store.updateSuggestion(key, s.id, () => ({ expiresAt: '2026-10-12T00:00:00.000Z' }));
  const orig = store.read.bind(store);
  store.read = async (k) => ({ ...(await orig(k)), strategySource: { planSource: 'plan-doc', planVersion: 7 } });
  await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  assert.equal(calls[0].payload.strategyVersion, 7);
  assert.equal(calls[0].payload.expiresAt, '2026-10-12T00:00:00.000Z');
  const o = await setup();
  await saveSuggestionDraft(o.deps, { key: o.key, suggestionId: o.run.suggestions[1].id });
  assert.equal('expiresAt' in o.calls[0].payload, false);
});
