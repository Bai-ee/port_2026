import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHandles, runPull, createBirdFetchTimeline, readClientXGrowth } from '../pull-corpora.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { BIRD_FAILURE } from '../ingest.js';
import { makePages } from './fixtures/timeline-fixture.js';
import { parseArgs } from '../../../scripts/x-content/pull-corpora.mjs';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const FIXTURE = { ownHandle: '@Fixture_Own', benchmarkHandles: ['bench_one', '@Bench_Two'] };
const configs = { fixture: FIXTURE, blank: {}, none: null };
const readXGrowth = async (id) => configs[id] ?? null;
const noCommitted = { loadCommitted: () => null };
const rowsFor = (handle, n = 3) => Array.from({ length: n }, (_, i) => ({ id: `${handle}-${i}`, text: `p${i}`, views: 10 }));

test('resolveHandles: normalizes, dedupes, drops invalid; own first', () => {
  assert.deepEqual(resolveHandles(FIXTURE), { own: 'fixture_own', benchmarks: ['bench_one', 'bench_two'], handles: ['fixture_own', 'bench_one', 'bench_two'], invalid: [] });
  const r = resolveHandles({ ownHandle: 'me', benchmarkHandles: ['ME', 'x', 'x', 'bad handle!', '', null] });
  assert.deepEqual(r.handles, ['me', 'x']);
  assert.deepEqual(r.invalid, ['bad handle!']);
  for (const x of [null, undefined, {}, { ownHandle: '', benchmarkHandles: [] }]) assert.deepEqual(resolveHandles(x).handles, []);
});

test('dry run resolves 3 handles from xGrowth and writes nothing (no fetcher needed)', async () => {
  const store = createMemoryCorpusStore(noCommitted);
  let writes = 0;
  const orig = store.writeMergedRows;
  store.writeMergedRows = async (...a) => { writes += 1; return orig(...a); };
  const res = await runPull({ clients: ['fixture'], readXGrowth, store });
  assert.deepEqual(Object.keys(res.handles), ['fixture_own', 'bench_one', 'bench_two']);
  assert.ok(Object.values(res.handles).every((h) => h.status === 'resolved' && h.storedRows === 0));
  assert.equal(writes, 0);
  assert.equal(store._chunks.size, 0);
  assert.equal(res.exitCode, 0);
});

test('dry run with fetch pulls via the fake fetcher but still writes nothing', async () => {
  const store = createMemoryCorpusStore(noCommitted);
  const calls = [];
  const res = await runPull({ clients: ['fixture'], readXGrowth, store, fetch: true, fetchTimeline: async (h) => { calls.push(h); return { rows: rowsFor(h), error: null }; } });
  assert.deepEqual(calls, ['fixture_own', 'bench_one', 'bench_two']);
  assert.ok(Object.values(res.handles).every((h) => h.pulledRows === 3 && h.wouldWrite));
  assert.equal(store._chunks.size, 0);
});

test('--write with fake fetcher merges rows per handle into the memory store', async () => {
  const store = createMemoryCorpusStore(noCommitted);
  const slept = [];
  const res = await runPull({ clients: ['fixture'], readXGrowth, store, write: true, fetchTimeline: async (h) => ({ rows: rowsFor(h), error: null }), delayMs: 5, sleep: async (ms) => { slept.push(ms); }, now: () => NOW });
  assert.equal(res.exitCode, 0);
  assert.equal(res.pulled, 3);
  assert.deepEqual(slept, [5, 5]);
  for (const h of ['fixture_own', 'bench_one', 'bench_two']) {
    const { rows, meta, source } = await store.readRows(h);
    assert.equal(source, 'firestore');
    assert.equal(rows.length, 3);
    assert.equal(meta.source, 'bird');
    assert.equal(res.handles[h].added, 3);
  }
  // Second run merges (no dupes).
  const again = await runPull({ clients: ['fixture'], readXGrowth, store, write: true, fetchTimeline: async (h) => ({ rows: rowsFor(h, 4), error: null }) });
  assert.equal(again.handles.bench_one.added, 1);
  assert.equal((await store.readRows('bench_one')).rows.length, 4);
});

test('client with no xGrowth handles is skipped with a clear message; all skipped => exit 1', async () => {
  const lines = [];
  const store = createMemoryCorpusStore(noCommitted);
  const res = await runPull({ clients: ['blank', 'none'], readXGrowth, store, write: true, fetchTimeline: async () => { throw new Error('must not fetch'); }, log: (l) => lines.push(l) });
  assert.equal(res.skippedClients, 2);
  assert.equal(res.exitCode, 1);
  assert.ok(lines.some((l) => /\[blank\] no xGrowth handles .*skipped/.test(l)));
  assert.equal(store._chunks.size, 0);
  // One configured client alongside a skipped one => exit 0.
  const mixed = await runPull({ clients: ['blank', 'fixture'], readXGrowth, store: createMemoryCorpusStore(noCommitted) });
  assert.equal(mixed.exitCode, 0);
  assert.equal(mixed.skippedClients, 1);
});

test('shared handle across clients is pulled once', async () => {
  const cfg = { a: { ownHandle: 'a_own', benchmarkHandles: ['shared'] }, b: { ownHandle: 'b_own', benchmarkHandles: ['shared'] } };
  const calls = [];
  await runPull({ clients: ['a', 'b'], readXGrowth: async (id) => cfg[id], store: createMemoryCorpusStore(noCommitted), write: true, fetchTimeline: async (h) => { calls.push(h); return { rows: rowsFor(h), error: null }; } });
  assert.deepEqual(calls, ['a_own', 'shared', 'b_own']);
});

test('rate limit stops further pulls; everything failing => exit 1', async () => {
  const calls = [];
  const res = await runPull({ clients: ['fixture'], readXGrowth, store: createMemoryCorpusStore(noCommitted), write: true, fetchTimeline: async (h) => { calls.push(h); return { rows: [], error: { kind: BIRD_FAILURE.RATE_LIMITED, message: '429' } }; } });
  assert.deepEqual(calls, ['fixture_own']);
  assert.equal(res.stopped, BIRD_FAILURE.RATE_LIMITED);
  assert.equal(res.handles.bench_one.status, 'skipped');
  assert.equal(res.exitCode, 1);
});

test('createBirdFetchTimeline converts bird pages to rows via ingestHandle (fake runBird, no real bird)', async () => {
  const pages = makePages('fixture_own');
  const args = [];
  const fetchTimeline = createBirdFetchTimeline({
    runBird: (a) => { args.push(a); const ci = a.indexOf('--cursor'); return JSON.stringify(pages[ci === -1 ? 0 : Number(a[ci + 1].slice(1))]); },
    days: 365, now: () => NOW,
  });
  const res = await fetchTimeline('fixture_own');
  assert.equal(res.error, null);
  assert.ok(res.rows.length > 0);
  assert.equal(args[0][0], 'user-tweets');
  const failing = createBirdFetchTimeline({ runBird: () => { throw Object.assign(new Error('Command failed'), { stderr: '429 Too Many Requests' }); }, now: () => NOW });
  const bad = await failing('fixture_own');
  assert.deepEqual(bad.rows, []);
  assert.equal(bad.error.kind, BIRD_FAILURE.RATE_LIMITED);
});

test('readClientXGrowth reads client_configs xGrowth; null when absent', async () => {
  const db = { collection: (c) => ({ doc: (id) => ({ get: async () => (c === 'client_configs' && id === 'fixture' ? { exists: true, data: () => ({ marketingBriefConfig: { xGrowth: FIXTURE } }) } : { exists: false }) }) }) };
  assert.deepEqual(await readClientXGrowth(db, 'fixture'), FIXTURE);
  assert.equal(await readClientXGrowth(db, 'other'), null);
  assert.equal(await readClientXGrowth(db, 'a/b'), null);
});

test('CLI parseArgs: scope flags shared with the scan; dry run by default', () => {
  assert.deepEqual(parseArgs(['--client', 'fixture']), { write: false, fetch: false, client: 'fixture', clients: '', pilot: false, days: 0, delay: 4000 });
  const p = parseArgs(['--pilot', '--write', '--days', '14', '--delay', '0']);
  assert.equal(p.pilot, true); assert.equal(p.write, true); assert.equal(p.days, 14); assert.equal(p.delay, 0);
});
