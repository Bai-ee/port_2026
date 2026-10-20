import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { loadLoopCorpora, safeProfileHandles } from '../loop-corpora.js';
import { loadDailyLoopInputs } from '../../x-content-inventory/daily-loop/inputs.js';
import { buildDayPlan } from '../../x-content-inventory/plan-day.js';

const row = (i) => ({ id: String(i), utc: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), text: `t${i}`, likes: 1, reposts: 0, replies: 0, views: null });
const rows = (n, tag = '') => Array.from({ length: n }, (_, i) => ({ ...row(n - i), text: `${tag}t${i}` }));
const committed = { bai_ee: rows(3, 'c-'), seb__design: rows(4, 'c-') };
const loadCommitted = (h) => committed[h] ?? null;
const PULLED = '2026-10-11T23:30:00.000Z';
// The home client's STORED profile (seed-home-priors.mjs); nothing defaults to it any more.
const HOME = { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] };

test('stored rows are used, label carries the UTC pull date', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('bai_ee', rows(5, 's-'), { pulledAt: PULLED });
  const c = await loadLoopCorpora({ corpusStore: store, profileHandles: HOME });
  assert.equal(c.own.length, 5);
  assert.equal(c.ownSource, 'rows store, 5 rows for @bai_ee, pulled 2026-10-11');
  assert.equal(c.benchmark.length, 4);
  assert.equal(c.benchmarkSource, 'committed file docs/audits/seb-design-x-corpus.json');
  assert.deepEqual([c.ownHandle, c.benchmarkHandle], ['bai_ee', 'seb__design']);
});

test('no stored rows: committed fallback labelled with the relative path', async () => {
  const c = await loadLoopCorpora({ corpusStore: createMemoryCorpusStore({ loadCommitted }), profileHandles: HOME });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json');
  assert.equal(c.own[0].text.startsWith('c-'), true);
});

test('store throws: committed loader + (rows store unavailable)', async () => {
  const corpusStore = { readRows: async () => { throw new Error('firestore down'); } };
  const c = await loadLoopCorpora({ corpusStore, loadCommitted, profileHandles: HOME });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json (rows store unavailable)');
  assert.equal(c.benchmarkSource, 'committed file docs/audits/seb-design-x-corpus.json (rows store unavailable)');
  assert.equal(c.own.length, 3);
  const dead = await loadLoopCorpora({ corpusStore, loadCommitted: () => { throw new Error('no fs'); }, profileHandles: HOME });
  assert.deepEqual([dead.own.length, dead.ownSource], [0, 'no stored rows for @bai_ee (rows store unavailable)']);
});

test('profile handles override; partial/empty profile reads nothing (no bai_ee / seb__design default)', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('someone', rows(2), { pulledAt: PULLED });
  await store.writeMergedRows('rival', rows(6), { pulledAt: '2026-10-09T01:00:00Z' });
  const c = await loadLoopCorpora({ corpusStore: store, profileHandles: { ownHandle: '@Someone', benchmarkHandles: ['rival', 'x'] } });
  assert.deepEqual([c.ownHandle, c.benchmarkHandle, c.own.length, c.benchmark.length], ['someone', 'rival', 2, 6]);
  assert.equal(c.benchmarkSource, 'rows store, 6 rows for @rival, pulled 2026-10-09');
  const d = await loadLoopCorpora({ corpusStore: store, profileHandles: { ownHandle: 'someone' } });
  assert.deepEqual([d.ownHandle, d.benchmarkHandle, d.benchmark], ['someone', null, null]);
  assert.match(d.benchmarkSource, /no benchmark handle/);
  const reads = [];
  const spy = { readRows: async (h) => { reads.push(h); return store.readRows(h); } };
  for (const profileHandles of [{}, undefined, { ownHandle: '', benchmarkHandles: [] }]) {
    const e = await loadLoopCorpora({ corpusStore: spy, loadCommitted, profileHandles });
    assert.deepEqual([e.ownHandle, e.benchmarkHandle, e.own, e.benchmark], [null, null, [], null]);
    assert.match(e.ownSource, /no own X handle/);
  }
  assert.deepEqual(reads, [], 'no corpus (committed or stored) was read for a client with no handles');
});

test('handle with no committed file and no rows: empty rows, "no stored rows"', async () => {
  const c = await loadLoopCorpora({ corpusStore: createMemoryCorpusStore({ loadCommitted }), profileHandles: { ownHandle: 'ghost', benchmarkHandles: ['nobody'] } });
  assert.deepEqual([c.own, c.ownSource, c.benchmark, c.benchmarkSource], [[], 'no stored rows for @ghost', [], 'no stored rows for @nobody']);
});

test('inputs.js prints the labels verbatim in the inputs summaries', async () => {
  const none = { exists: false, data: () => ({}) };
  const doc = () => ({ get: async () => none, collection: () => ({ doc }) });
  const db = { collection: (name) => ({ doc, select: () => ({ get: async () => ({ docs: [] }) }), where: () => ({ select: () => ({ get: async () => ({ docs: [] }) }) }), name }) };
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('bai_ee', rows(5), { pulledAt: PULLED });
  const corpora = await loadLoopCorpora({ corpusStore: store, profileHandles: HOME });
  const inputs = await loadDailyLoopInputs({ db, buildDayPlan }, { clientId: 'fixture-client-a', corpora, now: Date.parse(PULLED) });
  assert.equal(inputs.ownSummary.source, 'rows store, 5 rows for @bai_ee, pulled 2026-10-11 (re-tagged with the shared taxonomy)');
  assert.equal(inputs.benchmark.source, 'computed from rows store, 5 rows for @bai_ee, pulled 2026-10-11 vs committed file docs/audits/seb-design-x-corpus.json (no saved report exists)');
});

const noneSnap = { exists: false, data: () => ({}) };
const fakeDb = () => {
  const doc = () => ({ get: async () => noneSnap, collection: () => ({ doc }) });
  return { collection: (name) => ({ doc, select: () => ({ get: async () => ({ docs: [] }) }), where: () => ({ select: () => ({ get: async () => ({ docs: [] }) }) }), name }) };
};

test('inputs.js uses corpora.ownHandle for strategyInputs; absent => null (never the owner)', async () => {
  const mk = (corpora) => loadDailyLoopInputs({ db: fakeDb(), buildDayPlan }, { clientId: 'fixture-client-a', corpora, now: Date.parse(PULLED) });
  const custom = await mk({ own: rows(5), benchmark: rows(4), ownHandle: 'someone_else', benchmarkHandle: 'rival' });
  assert.equal(custom.strategyInputs.ownHandle, 'someone_else');
  assert.match(JSON.stringify(custom.benchmark), /someone_else/);
  const dflt = await mk({ own: rows(5), benchmark: rows(4) });
  assert.equal(dflt.strategyInputs.ownHandle, null);
  assert.doesNotMatch(JSON.stringify(dflt.benchmark), /someone_else/);
});

test('seeded doc (firestore + meta.source committed-json) is labelled seeded, even with pulledAt null', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.seedFromCommitted('bai_ee');
  await store.seedFromCommitted('someone');
  const c = await loadLoopCorpora({ corpusStore: store, profileHandles: HOME });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json (seeded in rows store)');
  const r = await store.readRows('bai_ee');
  assert.equal(r.source, 'firestore');
  assert.equal(r.meta.pulledAt ?? null, null);
});

test('one handle throwing while the other succeeds: per-handle fallback', async () => {
  const mem = createMemoryCorpusStore({ loadCommitted });
  await mem.writeMergedRows('seb__design', rows(6, 's-'), { pulledAt: PULLED });
  const corpusStore = { readRows: async (h) => { if (h === 'bai_ee') throw new Error('boom'); return mem.readRows(h); } };
  const c = await loadLoopCorpora({ corpusStore, loadCommitted, profileHandles: HOME });
  assert.equal(c.ownSource, 'committed file docs/audits/bai-ee-x-corpus.json (rows store unavailable)');
  assert.equal(c.own.length, 3);
  assert.equal(c.benchmarkSource, 'rows store, 6 rows for @seb__design, pulled 2026-10-11');
  assert.equal(c.benchmark.length, 6);
});

test('safeProfileHandles: failing profile read => {} => no handles, never the owner pair', async () => {
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('bai_ee', rows(5, 's-'), { pulledAt: PULLED });
  const handles = await safeProfileHandles(async () => { throw new Error('config down'); }, () => ({ ownHandle: 'x' }));
  assert.deepEqual(handles, {});
  const c = await loadLoopCorpora({ corpusStore: store, profileHandles: handles });
  assert.deepEqual([c.ownHandle, c.benchmarkHandle, c.own.length, c.benchmark], [null, null, 0, null]);
  const ok = await safeProfileHandles(async () => ({ a: 1 }), ({ config }) => ({ ownHandle: 'z', config }));
  assert.equal(ok.ownHandle, 'z');
});

test('loadClientLoopCorpora: no own handle => empty own corpus and null handle, never the default pair\'s owner rows', async () => {
  const { loadClientLoopCorpora } = await import('../loop-corpora.js');
  const store = createMemoryCorpusStore({ loadCommitted });
  await store.writeMergedRows('bai_ee', rows(5, 's-'), { pulledAt: PULLED });
  await store.writeMergedRows('client_a', rows(3, 'a-'), { pulledAt: PULLED });
  const none = await loadClientLoopCorpora({ corpusStore: store, ownHandle: null, profileHandles: {} });
  assert.equal(none.ownHandle, null);
  assert.deepEqual(none.own, []);
  assert.match(none.ownSource, /no own X handle/);
  const mine = await loadClientLoopCorpora({ corpusStore: store, ownHandle: 'client_a', profileHandles: { ownHandle: 'someone_else' } });
  assert.equal(mine.ownHandle, 'client_a');
  assert.equal(mine.own.length, 3);
  // Composed with inputs.js: no handle reaches strategyInputs as null, and no owner rows ride along.
  const inputs = await loadDailyLoopInputs({ db: fakeDb(), buildDayPlan }, { clientId: 'fixture-client-a', corpora: none, now: Date.parse(PULLED) });
  assert.equal(inputs.strategyInputs.ownHandle, null);
  assert.deepEqual(inputs.strategyInputs.ownPosts, []);
});

test('loadClientLoopCorpora: connected account handle != xGrowth.ownHandle is flagged, matching handles are not', async () => {
  const { loadClientLoopCorpora } = await import('../loop-corpora.js');
  const store = createMemoryCorpusStore({ loadCommitted: () => null });
  await store.writeMergedRows('bai_ee', rows(4), { pulledAt: PULLED });
  const wrong = await loadClientLoopCorpora({ corpusStore: store, ownHandle: 'UGExistence', profileHandles: HOME, loadCommitted: () => null });
  assert.deepEqual([wrong.ownHandle, wrong.own.length, wrong.ownSource], ['ugexistence', 0, 'no stored rows for @ugexistence']);
  assert.match(wrong.ownHandleMismatch, /@ugexistence comes from the connected X account, but xGrowth\.ownHandle is @bai_ee/);
  const right = await loadClientLoopCorpora({ corpusStore: store, ownHandle: '@Bai_ee', profileHandles: HOME, loadCommitted: () => null });
  assert.equal(right.own.length, 4);
  assert.equal(right.ownHandleMismatch, undefined);
});
