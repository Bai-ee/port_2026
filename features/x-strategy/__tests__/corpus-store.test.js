import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryCorpusStore, createFirestoreCorpusStore, CorpusStoreError, normalizeHandle, defaultLoadCommitted,
} from '../corpus-store.js';

const row = (i, over = {}) => ({ id: String(i), utc: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), likes: 1, reposts: 0, replies: 0, views: null, ...over });
const rows = (n, over) => Array.from({ length: n }, (_, i) => row(n - i, over)); // newest first
const P = '2026-10-11T00:00:00.000Z';

test('invalid handles throw typed error; @/case normalized', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => null });
  for (const bad of ['', '@', 'a b', 'x'.repeat(16), 'bad-dash', null]) {
    await assert.rejects(() => s.readRows(bad), (e) => e instanceof CorpusStoreError && e.code === 'invalid-handle');
    await assert.rejects(() => s.writeMergedRows(bad, [row(1)], {}), { code: 'invalid-handle' });
  }
  assert.equal(normalizeHandle(' @Seb__Design '), 'seb__design');
});

test('missing rows fall back to committed loader; none when no file', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: (h) => (h === 'bai_ee' ? rows(3) : null) });
  const r = await s.readRows('@bai_ee');
  assert.equal(r.source, 'committed-json');
  assert.equal(r.rows.length, 3);
  assert.equal(r.meta.source, 'committed-json');
  assert.equal(r.meta.pulledAt, null);
  const none = await s.readRows('nobody');
  assert.deepEqual([none.source, none.rows.length, none.meta], ['none', 0, null]);
});

test('default loader maps the two committed corpora and nothing else', () => {
  assert.ok(defaultLoadCommitted('bai_ee').length > 100);
  assert.ok(defaultLoadCommitted('seb__design').length > 500);
  assert.equal(defaultLoadCommitted('someoneelse'), null);
});

test('first write merges onto committed seed and persists as firestore source', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => rows(5, { views: 10 }) });
  const res = await s.writeMergedRows('bai_ee', [row(99, { views: 1 })], { pulledAt: P, source: 'bird' });
  assert.deepEqual([res.before, res.after, res.added], [5, 6, 1]);
  const r = await s.readRows('bai_ee');
  assert.equal(r.source, 'firestore');
  assert.equal(r.meta.source, 'bird');
  assert.equal(r.meta.pulledAt, P);
});

test('idempotent: same incoming twice adds nothing, rewrites no chunks', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => null });
  const inc = rows(300, { views: 7 });
  const a = await s.writeMergedRows('h', inc, { pulledAt: P });
  const b = await s.writeMergedRows('h', inc, { pulledAt: '2026-10-12T00:00:00.000Z' });
  assert.deepEqual([a.added, a.after], [300, 300]);
  assert.deepEqual([b.added, b.updated, b.after, b.wrote], [0, 0, 300, false]);
  const r = await s.readRows('h');
  assert.equal(r.rows.length, 300);
  assert.equal(r.meta.chunks, 2);
  assert.equal(r.meta.pulledAt, '2026-10-12T00:00:00.000Z'); // meta still refreshed
});

test('views preserved when incoming lacks them; counts reported', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => null });
  await s.writeMergedRows('h', rows(10, { views: 100 }), { pulledAt: P });
  const res = await s.writeMergedRows('h', rows(10, { views: null, likes: 5 }), { pulledAt: P });
  assert.deepEqual([res.viewsBefore, res.viewsAfter, res.updated, res.added], [10, 10, 10, 0]);
  const r = await s.readRows('h');
  assert.ok(r.rows.every((x) => x.views === 100 && x.likes === 5));
  assert.equal(r.meta.viewsCoverage, 1);
});

test('never shrinks: partial incoming keeps all existing rows', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => null });
  await s.writeMergedRows('h', rows(501), { pulledAt: P });
  const res = await s.writeMergedRows('h', rows(3), { pulledAt: P });
  assert.equal(res.after, 501);
  assert.equal((await s.readRows('h')).meta.chunks, 3);
});

test('surplus chunks are deleted when a forced reseed is smaller', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => rows(10) });
  await s.writeMergedRows('h', rows(501), { pulledAt: P });
  assert.equal(s._chunks.get('h').size, 3);
  const r = await s.seedFromCommitted('h', { force: true });
  assert.equal(r.seeded, true);
  assert.equal(s._chunks.get('h').size, 1);
  assert.equal((await s.readRows('h')).rows.length, 10);
});

test('chunk boundaries persisted: 249/250/251/501', async () => {
  for (const [n, c] of [[249, 1], [250, 1], [251, 2], [501, 3]]) {
    const s = createMemoryCorpusStore({ loadCommitted: () => null });
    await s.writeMergedRows('h', rows(n), { pulledAt: P });
    assert.equal(s._chunks.get('h').size, c, `n=${n}`);
    assert.ok([...s._chunks.get('h').values()].every((x) => x.length <= 250));
    assert.equal((await s.readRows('h')).rows.length, n);
  }
});

test('rowsMeta write does not clobber other x_corpora fields', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => null });
  s._docs.set('h', { stats: { posts: 9 }, watchlistSeed: ['a'], meta: { x: 1 } });
  await s.writeMergedRows('h', rows(3), { pulledAt: P });
  const d = s._docs.get('h');
  assert.deepEqual(d.stats, { posts: 9 });
  assert.deepEqual(d.watchlistSeed, ['a']);
  assert.equal(d.rowsMeta.rowCount, 3);
});

test('empty incoming is a no-op (no writes, no seed)', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: () => rows(4) });
  for (const empty of [[], null, undefined]) {
    const r = await s.writeMergedRows('h', empty, { pulledAt: P });
    assert.deepEqual([r.before, r.after, r.added, r.wrote], [4, 4, 0, false]);
  }
  assert.equal(s._docs.has('h'), false);
  assert.equal(s._chunks.has('h'), false);
});

test('seedFromCommitted: no-op when rows exist unless force; no file -> not seeded', async () => {
  const s = createMemoryCorpusStore({ loadCommitted: (h) => (h === 'h' ? rows(4) : null) });
  assert.equal((await s.seedFromCommitted('h')).seeded, true);
  assert.equal((await s.readRows('h')).meta.source, 'committed-json');
  const again = await s.seedFromCommitted('h');
  assert.deepEqual([again.seeded, again.reason], [false, 'rows-exist']);
  assert.equal((await s.seedFromCommitted('h', { force: true })).seeded, true);
  assert.equal((await s.seedFromCommitted('zz')).reason, 'no-committed-file');
});

// --- Firestore adapter against a minimal fake db -------------------------------------------------
function fakeDb({ failOn } = {}) {
  const docs = new Map(); // path -> data
  const batches = [];
  const ref = (path) => ({
    path,
    id: path.split('/').pop(),
    collection: (n) => col(`${path}/${n}`),
    async get() { if (failOn === 'doc') throw new Error('boom'); return { exists: docs.has(path), data: () => docs.get(path) }; },
    async set(data, opts) { if (failOn === 'set') throw new Error('boom'); docs.set(path, opts?.merge ? { ...(docs.get(path) ?? {}), ...data } : data); },
  });
  const col = (path) => ({
    doc: (id) => ref(`${path}/${id}`),
    async get() {
      if (failOn === 'col') throw new Error('unavailable');
      const kids = [...docs.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
      return { forEach: (fn) => kids.forEach((k) => fn({ id: k.split('/').pop(), ref: ref(k), data: () => docs.get(k) })) };
    },
  });
  return {
    docs, batches,
    collection: (n) => col(n),
    batch() {
      const ops = [];
      batches.push(ops);
      return { set: (r, d) => ops.push(['set', r, d]), delete: (r) => ops.push(['delete', r]), async commit() { for (const [t, r, d] of ops) { if (t === 'set') docs.set(r.path, d); else docs.delete(r.path); } } };
    },
  };
}

test('firestore adapter: writes only rows/* + rowsMeta, batches <=400, merge-preserves doc', async () => {
  const db = fakeDb();
  db.docs.set('x_corpora/h', { stats: { n: 1 } });
  const s = createFirestoreCorpusStore(db, { loadCommitted: () => null });
  await s.writeMergedRows('h', rows(1000), { pulledAt: P });
  assert.ok(db.batches.every((b) => b.length <= 400));
  const paths = [...db.docs.keys()].sort();
  assert.ok(paths.every((p) => p === 'x_corpora/h' || /^x_corpora\/h\/rows\/\d+$/.test(p)));
  assert.deepEqual(db.docs.get('x_corpora/h').stats, { n: 1 });
  assert.equal(db.docs.get('x_corpora/h').rowsMeta.chunks, 4);
  assert.equal((await s.readRows('h')).rows.length, 1000);
});

test('firestore errors propagate as typed CorpusStoreError', async () => {
  for (const failOn of ['col', 'set']) {
    const s = createFirestoreCorpusStore(fakeDb({ failOn }), { loadCommitted: () => null });
    const op = failOn === 'col' ? () => s.readRows('h') : () => s.writeMergedRows('h', rows(2), {});
    await assert.rejects(op, (e) => e instanceof CorpusStoreError && e.code === 'firestore' && e.cause instanceof Error);
  }
});
