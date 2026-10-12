import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayStagedMedia, saveSuggestionDraft } from '../daily-loop/review.js';
import { createMemoryRunStore } from '../daily-loop/run-store.js';

const run = (media) => ({ suggestions: [{ id: 's1', package: { id: 'nas-1', media }, slot: { type: 'original-showcase' }, draft: { text: 'hi' } }] });

test('overlay: staged package replaces needs-staging with its media ref', async () => {
  const out = await overlayStagedMedia(run({ status: 'needs-staging' }), async () => ({ assetRefs: ['publish-staging/nas/nas-1/abc.mp4'] }));
  assert.deepEqual(out.suggestions[0].package.media, { kind: 'video', ref: 'publish-staging/nas/nas-1/abc.mp4' });
});

test('overlay: still unstaged stays needs-staging; other runs untouched', async () => {
  const out = await overlayStagedMedia(run({ status: 'needs-staging' }), async () => ({ assetRefs: [] }));
  assert.equal(out.suggestions[0].package.media.status, 'needs-staging');
  const plain = run({ kind: 'video', ref: 'ev:a.mp4' });
  assert.equal(await overlayStagedMedia(plain, async () => { throw new Error('no lookup'); }), plain);
});

test('save refuses a showcase suggestion whose package has no media even when the old run doc has no media field', async () => {
  const store = createMemoryRunStore();
  const key = { clientId: 'bryan-balli-WUoltG84', localDate: '2026-10-11', channel: 'x', version: 1 };
  const r = run(undefined); r.suggestions[0].package.rights = 'owned';
  await store.write?.(key, { ...key, ...r });
  const deps = {
    store: { read: async () => ({ ...key, ...r }), updateSuggestion: async () => { throw new Error('no write'); } },
    getPackage: async () => ({ id: 'nas-1', rights: 'owned', status: 'idea', assetRefs: [], story: 'I built this piece over a long winter and it finally shipped last spring.', title: 'Real piece', source: { kind: 'nas' }, nas: { sha256: 'x' }, memory: 'the day it shipped' }),
    createDraftPostOnce: async () => { throw new Error('no draft'); },
    postExists: async () => true,
  };
  await assert.rejects(saveSuggestionDraft(deps, { key, suggestionId: 's1' }), (e) => e.code === 'needs-staging');
});
