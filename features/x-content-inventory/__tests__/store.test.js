import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertPackage, deletePackage, readInventory, readCandidates, getPackage,
  backfillIndexFields, PACKAGE_CAP,
} from '../store.js';
import seedRows from '../content-packages.json' with { type: 'json' };

// ---- in-memory Firestore fake -------------------------------------------
// Counts document reads (a get() = 1, each doc a query returns = 1) so tests can
// assert a write does not scan the collection. Mirrors the Firestore behaviours
// the store depends on: orderBy EXCLUDES docs missing the field, null sorts
// first, `in` / `==` filters, __name__ ordering with startAfter(id).
function makeDb() {
  const cols = new Map();
  const stats = { reads: 0, queries: [] };
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const FieldValue = {
    increment: (n) => ({ __inc: n }),
    serverTimestamp: () => ({ __ts: true }),
  };
  const apply = (prev, patch, merge) => {
    const out = merge ? { ...(prev || {}) } : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && '__inc' in v) out[k] = (Number(out[k]) || 0) + v.__inc;
      else if (v && typeof v === 'object' && '__ts' in v) out[k] = 'TS';
      else out[k] = structuredClone(v);
    }
    return out;
  };
  const docRef = (n, id) => ({
    id,
    async get() {
      stats.reads += 1;
      const d = col(n).get(id);
      return { id, exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
    },
    async set(data, opts) { col(n).set(id, apply(col(n).get(id), data, !!opts?.merge)); },
    async delete() { col(n).delete(id); },
  });
  const rank = (v) => (v === null ? [0, 0] : [1, v]);
  const query = (n, spec = {}) => ({
    where: (f, op, v) => query(n, { ...spec, wheres: [...(spec.wheres || []), [f, op, v]] }),
    orderBy: (f, dir = 'asc') => query(n, { ...spec, order: [f, dir] }),
    limit: (l) => query(n, { ...spec, lim: l }),
    startAfter: (c) => query(n, { ...spec, after: c }),
    async get() {
      stats.queries.push(spec);
      let rows = [...col(n).entries()].map(([id, data]) => ({ id, data }));
      for (const [f, op, v] of spec.wheres || []) {
        rows = rows.filter((r) => (op === '==' ? r.data[f] === v : v.includes(r.data[f])));
      }
      const [of, dir] = spec.order || ['__name__', 'asc'];
      if (of !== '__name__') rows = rows.filter((r) => r.data[of] !== undefined);
      rows.sort((a, b) => {
        const [x, y] = of === '__name__' ? [a.id, b.id] : [rank(a.data[of]), rank(b.data[of])];
        const c = of === '__name__' ? (x < y ? -1 : x > y ? 1 : 0) : (x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
        return dir === 'desc' ? -c : c;
      });
      if (spec.after) rows = rows.filter((r) => r.id > spec.after);
      if (spec.lim) rows = rows.slice(0, spec.lim);
      stats.reads += rows.length;
      return { docs: rows.map((r) => ({ id: r.id, data: () => structuredClone(r.data) })) };
    },
  });
  return {
    FieldValue, stats, cols,
    collection: (n) => ({ doc: (id) => docRef(n, id), ...query(n) }),
    batch() {
      const ops = [];
      return {
        set: (ref, data, o) => ops.push(() => ref.set(data, o)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
}

const row = (o = {}) => ({
  ...seedRows[1], id: 'r1', series: 'C1', status: 'idea', ...o,
});
const stored = (db) => db.cols.get('x_content_packages') || new Map();
const meta = (db) => db.cols.get('x_content_inventory_meta')?.get('state');

test('upsert reads only the target doc + meta, never the collection', async () => {
  const db = makeDb();
  for (let i = 0; i < 300; i += 1) await upsertPackage(row({ id: `bulk-${i}` }), { db, returnPackages: false });
  db.stats.reads = 0; db.stats.queries.length = 0;
  await upsertPackage(row({ id: 'bulk-7', title: 'edited' }), { db, returnPackages: false });
  assert.equal(db.stats.reads, 2);
  assert.equal(db.stats.queries.length, 0);
  assert.equal(stored(db).get('bulk-7').title, 'edited');
});

test('minting an id checks single docs, not the collection', async () => {
  const db = makeDb();
  const r = await upsertPackage(row({ id: undefined, title: 'Brand New' }), { db, returnPackages: false });
  assert.match(r.pkg.id, /^brand-new-/);
  assert.equal(r.created, true);
  assert.equal(db.stats.queries.length, 0);
});

test('delete reads only target + meta and decrements the count', async () => {
  const db = makeDb();
  await upsertPackage(row({ id: 'a' }), { db, returnPackages: false });
  await upsertPackage(row({ id: 'b' }), { db, returnPackages: false });
  const count = meta(db).count;
  db.stats.reads = 0; db.stats.queries.length = 0;
  const r = await deletePackage('a', { db, returnPackages: false });
  assert.equal(r.removed, true);
  assert.equal(db.stats.reads, 2);
  assert.equal(db.stats.queries.length, 0);
  assert.equal(meta(db).count, count - 1);
  assert.equal((await deletePackage('a', { db, returnPackages: false })).removed, false);
});

test('seed-once: first write materializes seed; emptied inventory does not resurrect it', async () => {
  const db = makeDb();
  assert.equal((await readInventory({ db })).seeded, true);
  assert.equal(stored(db).size, 0, 'read never writes');
  await upsertPackage(row({ id: 'mine' }), { db, returnPackages: false });
  assert.equal(stored(db).size, 4, '3 seed rows + mine');
  assert.equal(meta(db).count, 4);
  for (const id of [...stored(db).keys()]) await deletePackage(id, { db, returnPackages: false });
  assert.equal(stored(db).size, 0);
  const after = await readInventory({ db });
  assert.equal(after.seeded, false);
  assert.deepEqual(after.packages, []);
  // A later upsert must not re-seed either.
  await upsertPackage(row({ id: 'again' }), { db, returnPackages: false });
  assert.equal(stored(db).size, 1);
});

test('deleting a seed row on a never-written inventory keeps the other seed rows', async () => {
  const db = makeDb();
  const r = await deletePackage('holopaper-cloth-grab', { db, returnPackages: false });
  assert.equal(r.removed, true);
  assert.equal(stored(db).has('holopaper-cloth-grab'), false);
  assert.equal(stored(db).size, 2);
});

test('engine is stamped on legacy rows; lastPostedAt defaults to null only when absent', async () => {
  const db = makeDb();
  await upsertPackage(row({ id: 'c1' }), { db, returnPackages: false });
  assert.equal(stored(db).get('c1').engine, 'record');
  assert.equal(stored(db).get('c1').lastPostedAt, null);
  await upsertPackage(row({ id: 'c6', series: 'C6', pillar: seedRows[0].pillar }), { db, returnPackages: false });
  assert.equal(stored(db).get('c6').engine, 'client');
  await upsertPackage(row({ id: 'own', engine: 'ue' }), { db, returnPackages: false });
  assert.equal(stored(db).get('own').engine, 'ue');
  // A write-back's lastPostedAt must survive an edit that does not carry the field.
  stored(db).get('c1').lastPostedAt = 1700000000000;
  await upsertPackage(row({ id: 'c1', title: 'edited again', lastPostedAt: undefined }), { db, returnPackages: false });
  assert.equal(stored(db).get('c1').lastPostedAt, 1700000000000);
});

test('readCandidates: engine + status filter, never-posted first, then oldest posted', async () => {
  const db = makeDb();
  await upsertPackage(row({ id: 'seed-anchor', series: 'C4', engine: 'ue' }), { db, returnPackages: false });
  const put = (id, extra) => upsertPackage(row({ id, ...extra }), { db, returnPackages: false });
  await put('posted-new', { lastPostedAt: 3000 });
  await put('posted-old', { lastPostedAt: 1000 });
  await put('never-a', {});
  await put('never-b', { lastPostedAt: null });
  await put('wrong-status', { status: 'retired' });
  await put('wrong-engine', { series: 'C6', pillar: seedRows[0].pillar });
  db.stats.queries.length = 0;
  const out = await readCandidates({ engine: 'record', statuses: ['idea', 'ready'], db });
  const ids = out.map((r) => r.id).filter((i) => !i.startsWith('EXAMPLE'));
  assert.deepEqual(ids.slice(0, 2).sort(), ['never-a', 'never-b']);
  assert.deepEqual(ids.slice(2), ['posted-old', 'posted-new']);
  assert.ok(!out.some((r) => ['wrong-status', 'wrong-engine'].includes(r.id)));
  const q = db.stats.queries[0];
  assert.deepEqual(q.wheres, [['engine', '==', 'record'], ['status', 'in', ['idea', 'ready']]]);
  assert.deepEqual(q.order, ['lastPostedAt', 'asc']);
  assert.equal(q.lim, 50);
  const limited = await readCandidates({ engine: 'record', statuses: ['idea'], limit: 2, db });
  assert.equal(limited.length, 2);
});

test('readCandidates validates input and falls back to filtered seed when never written', async () => {
  const db = makeDb();
  await assert.rejects(() => readCandidates({ engine: 'nope', statuses: ['idea'], db }), { status: 400 });
  await assert.rejects(() => readCandidates({ engine: 'record', statuses: [], db }), { status: 400 });
  const seedOut = await readCandidates({ engine: 'client', statuses: ['idea'], db });
  assert.deepEqual(seedOut.map((r) => r.id), ['holopaper-cloth-grab']);
});

test('backfillIndexFields stamps legacy docs missing engine/lastPostedAt', async () => {
  const db = makeDb();
  await upsertPackage(row({ id: 'seeded' }), { db, returnPackages: false });
  db.cols.get('x_content_packages').set('legacy', { series: 'C2', status: 'idea', title: 'x' });
  assert.deepEqual(await readCandidates({ engine: 'record', statuses: ['idea'], db }).then((r) => r.map((x) => x.id).includes('legacy')), false);
  const res = await backfillIndexFields({ pageSize: 2, db });
  assert.equal(res.updated, 1);
  assert.equal(stored(db).get('legacy').engine, 'record');
  assert.ok((await readCandidates({ engine: 'record', statuses: ['idea'], db })).some((r) => r.id === 'legacy'));
});

test('readInventory paginates by id; default shape unchanged', async () => {
  const db = makeDb();
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) await upsertPackage(row({ id }), { db, returnPackages: false });
  const all = await readInventory({ db });
  assert.deepEqual(Object.keys(all).sort(), ['packages', 'seeded', 'updatedAt']);
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const page = await readInventory({ db, pageSize: 3, startAfter: cursor });
    seen.push(...page.packages.map((p) => p.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.equal(new Set(seen).size, seen.length, 'no repeated rows across pages');
  assert.equal(seen.length, all.packages.length);
});

test('getPackage is a single doc read', async () => {
  const db = makeDb();
  await upsertPackage(row({ id: 'solo' }), { db, returnPackages: false });
  db.stats.reads = 0;
  assert.equal((await getPackage('solo', { db })).id, 'solo');
  assert.equal(db.stats.reads, 1);
  assert.equal(await getPackage('missing', { db }), null);
});

test('create past the guard is refused with 409', async () => {
  const db = makeDb();
  await upsertPackage(row({ id: 'x' }), { db, returnPackages: false });
  db.cols.get('x_content_inventory_meta').get('state').count = PACKAGE_CAP;
  await assert.rejects(() => upsertPackage(row({ id: 'y' }), { db, returnPackages: false }), { status: 409 });
  await upsertPackage(row({ id: 'x', title: 'edit ok' }), { db, returnPackages: false });
});
