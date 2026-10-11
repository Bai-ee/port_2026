import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { loadLoopCorpora, safeProfileHandles } from '../loop-corpora.js';
import { loadDailyLoopInputs } from '../../x-content-inventory/daily-loop/inputs.js';
import { buildDayPlan } from '../../x-content-inventory/plan-day.js';
import { OWNER_CLIENT_IDS } from '../../x-content-inventory/daily-loop.js';

const row = (i) => ({ id: String(i), utc: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), text: `t${i}`, likes: 1, reposts: 0, replies: 0, views: null });
const rows = (n, tag = '') => Array.from({ length: n }, (_, i) => ({ ...row(n - i), text: `${tag}t${i}` }));
const committed = { bai_ee: rows(3, 'c-'), seb__design: rows(4, 'c-') };
const loadCommitted = (h) => committed[h] ?? null;
const PULLED = '2026-10-11T23:30:00.000Z';

test('stored rows are used, label carries the UTC pull date', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('bai_ee', rows(5, 's-'), { pulledAt: PULLED });
  const c = await loadLoopCorpora({ corpusStore: store });
  assert.equal(c.own.length, 5);
  assert.equal(c.ownSource, 'rows store, pulled 2026-10-11');
  assert.equal(c.benchmark.length, 4);
  assert.equal(c.benchmarkSource, 'committed file docs/audits/seb-design-x-corpus.json');
  assert.deepEqual([c.ownHandle, c.benchmarkHandle], ['bai_ee', 'seb__design']);
});

test('no stored rows: committed fallback labelled with the relative path', async () => {
  const c = await loadLoopCorpora({ corpusStore: createMemoryCorpusStore({ loadCommitted }) });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json');
  assert.equal(c.own[0].text.startsWith('c-'), true);
});

test('store throws: committed loader + (rows store unavailable)', async () => {
  const corpusStore = { readRows: async () => { throw new Error('firestore down'); } };
  const c = await loadLoopCorpora({ corpusStore, loadCommitted });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json (rows store unavailable)');
  assert.equal(c.benchmarkSource, 'committed file docs/audits/seb-design-x-corpus.json (rows store unavailable)');
  assert.equal(c.own.length, 3);
  const dead = await loadLoopCorpora({ corpusStore, loadCommitted: () => { throw new Error('no fs'); } });
  assert.deepEqual([dead.own.length, dead.ownSource], [0, 'no stored rows (rows store unavailable)']);
});

test('profile handles override; partial/empty profile defaults to the pair', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('someone', rows(2), { pulledAt: PULLED });
  await store.writeMergedRows('rival', rows(6), { pulledAt: '2026-10-09T01:00:00Z' });
  const c = await loadLoopCorpora({ corpusStore: store, profileHandles: { ownHandle: '@Someone', benchmarkHandles: ['rival', 'x'] } });
  assert.deepEqual([c.ownHandle, c.benchmarkHandle, c.own.length, c.benchmark.length], ['someone', 'rival', 2, 6]);
  assert.equal(c.benchmarkSource, 'rows store, pulled 2026-10-09');
  const d = await loadLoopCorpora({ corpusStore: store, profileHandles: { ownHandle: 'someone' } });
  assert.deepEqual([d.ownHandle, d.benchmarkHandle], ['someone', 'seb__design']);
  const e = await loadLoopCorpora({ corpusStore: store, profileHandles: {} });
  assert.deepEqual([e.ownHandle, e.benchmarkHandle], ['bai_ee', 'seb__design']);
});

test('handle with no committed file and no rows: empty rows, "no stored rows"', async () => {
  const c = await loadLoopCorpora({ corpusStore: createMemoryCorpusStore({ loadCommitted }), profileHandles: { ownHandle: 'ghost', benchmarkHandles: ['nobody'] } });
  assert.deepEqual([c.own, c.ownSource, c.benchmark, c.benchmarkSource], [[], 'no stored rows', [], 'no stored rows']);
});

test('inputs.js prints the labels verbatim in the inputs summaries', async () => {
  const none = { exists: false, data: () => ({}) };
  const doc = () => ({ get: async () => none, collection: () => ({ doc }) });
  const db = { collection: (name) => ({ doc, select: () => ({ get: async () => ({ docs: [] }) }), name }) };
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('bai_ee', rows(5), { pulledAt: PULLED });
  const corpora = await loadLoopCorpora({ corpusStore: store });
  const inputs = await loadDailyLoopInputs({ db, buildDayPlan }, { clientId: OWNER_CLIENT_IDS[0], corpora, now: Date.parse(PULLED) });
  assert.equal(inputs.ownSummary.source, 'rows store, pulled 2026-10-11 (re-tagged with the shared taxonomy)');
  assert.equal(inputs.benchmark.source, 'computed from rows store, pulled 2026-10-11 vs committed file docs/audits/seb-design-x-corpus.json (no saved report exists)');
});

const noneSnap = { exists: false, data: () => ({}) };
const fakeDb = () => {
  const doc = () => ({ get: async () => noneSnap, collection: () => ({ doc }) });
  return { collection: (name) => ({ doc, select: () => ({ get: async () => ({ docs: [] }) }), name }) };
};

test('inputs.js uses corpora.ownHandle for strategyInputs; absent => bai_ee', async () => {
  const mk = (corpora) => loadDailyLoopInputs({ db: fakeDb(), buildDayPlan }, { clientId: OWNER_CLIENT_IDS[0], corpora, now: Date.parse(PULLED) });
  const custom = await mk({ own: rows(5), benchmark: rows(4), ownHandle: 'someone_else', benchmarkHandle: 'rival' });
  assert.equal(custom.strategyInputs.ownHandle, 'someone_else');
  assert.match(JSON.stringify(custom.benchmark), /someone_else/);
  const dflt = await mk({ own: rows(5), benchmark: rows(4) });
  assert.equal(dflt.strategyInputs.ownHandle, 'bai_ee');
  assert.doesNotMatch(JSON.stringify(dflt.benchmark), /someone_else/);
});

test('seeded doc (firestore + meta.source committed-json) is labelled seeded, even with pulledAt null', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.seedFromCommitted('bai_ee');
  await store.seedFromCommitted('someone');
  const c = await loadLoopCorpora({ corpusStore: store });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json (seeded in rows store)');
  const r = await store.readRows('bai_ee');
  assert.equal(r.source, 'firestore');
  assert.equal(r.meta.pulledAt ?? null, null);
});

test('one handle throwing while the other succeeds: per-handle fallback', async () => {
  const mem = createMemoryCorpusStore({ loadCommitted });
  await mem.writeMergedRows('seb__design', rows(6, 's-'), { pulledAt: PULLED });
  const corpusStore = { readRows: async (h) => { if (h === 'bai_ee') throw new Error('boom'); return mem.readRows(h); } };
  const c = await loadLoopCorpora({ corpusStore, loadCommitted });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json (rows store unavailable)');
  assert.equal(c.own.length, 3);
  assert.equal(c.benchmarkSource, 'rows store, pulled 2026-10-11');
  assert.equal(c.benchmark.length, 6);
});

test('safeProfileHandles: failing profile read => default pair, rows store still used', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('bai_ee', rows(5, 's-'), { pulledAt: PULLED });
  const handles = await safeProfileHandles(async () => { throw new Error('config down'); }, () => ({ ownHandle: 'x' }));
  assert.deepEqual(handles, {});
  const c = await loadLoopCorpora({ corpusStore: store, profileHandles: handles });
  assert.deepEqual([c.ownHandle, c.benchmarkHandle, c.own.length, c.ownSource], ['bai_ee', 'seb__design', 5, 'rows store, pulled 2026-10-11']);
  const ok = await safeProfileHandles(async () => ({ a: 1 }), ({ config }) => ({ ownHandle: 'z', config }));
  assert.equal(ok.ownHandle, 'z');
});
