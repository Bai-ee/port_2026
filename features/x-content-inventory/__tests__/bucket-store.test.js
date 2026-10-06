import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listBuckets, upsertBucket, deleteBucket, listFolders, upsertFolder, deleteFolder, getAliases, upsertAliases,
} from '../bucket-store.js';
import { DEFAULT_BUCKETS } from '../buckets.js';
import { bucketsToEngineConfig, mergeEngineConfig, DEFAULT_ENGINE_CONFIG } from '../engine-quota.js';
import { upsertPackage, getPackage } from '../store.js';
import { buildSearchTokens } from '../facets.js';
import { validatePackage } from '../schema.js';
import seedRows from '../content-packages.json' with { type: 'json' };

// Minimal nested-collection fake keyed by full path.
function makeDb() {
  const docs = new Map();
  const FieldValue = { increment: (n) => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) };
  const apply = (prev, patch, merge) => {
    const out = merge ? { ...(prev || {}) } : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && '__inc' in v) out[k] = (Number(out[k]) || 0) + v.__inc;
      else if (v && typeof v === 'object' && '__ts' in v) out[k] = 'TS';
      else out[k] = structuredClone(v);
    }
    return out;
  };
  const doc = (path) => ({
    path,
    id: path.split('/').pop(),
    collection: (n) => collection(`${path}/${n}`),
    async get() { const d = docs.get(path); return { id: path.split('/').pop(), exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) }; },
    async set(data, o) { docs.set(path, apply(docs.get(path), data, !!o?.merge)); },
    async delete() { docs.delete(path); },
  });
  const collection = (path, wheres = []) => ({
    doc: (id) => doc(`${path}/${id}`),
    where: (f, op, v) => collection(path, [...wheres, [f, op, v]]),
    orderBy: () => collection(path, wheres),
    limit: () => collection(path, wheres),
    async get() {
      const rows = [...docs.entries()]
        .filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'))
        .filter(([, d]) => wheres.every(([f, , v]) => d[f] === v))
        .map(([p, d]) => ({ id: p.split('/').pop(), data: () => structuredClone(d) }));
      return { docs: rows };
    },
  });
  return {
    FieldValue, docs,
    collection,
    batch() {
      const ops = [];
      return { set: (ref, d, o) => ops.push(() => ref.set(d, o)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
    },
  };
}
const C = 'client-a';
const pkg = (o = {}) => ({ ...seedRows[1], id: 'p1', series: 'C1', status: 'idea', ...o });

test('listBuckets returns defaults when nothing stored', async () => {
  const b = await listBuckets(C, { db: makeDb() });
  assert.deepEqual(b.map((x) => x.id), DEFAULT_BUCKETS.map((x) => x.id));
});

test('upsertBucket creates with id from name, rejects duplicate names, validates', async () => {
  const db = makeDb();
  const r = await upsertBucket(C, { name: 'Flyers 90s', sourceKind: 'manual', share: { perDayMax: 1 } }, { db });
  assert.equal(r.created, true);
  assert.equal(r.bucket.id, 'flyers-90s');
  assert.ok((await listBuckets(C, { db })).some((b) => b.id === 'flyers-90s'));
  await assert.rejects(() => upsertBucket(C, { name: 'flyers 90s', sourceKind: 'manual' }, { db }), { status: 409 });
  await assert.rejects(() => upsertBucket(C, { name: 'Discogs Records', sourceKind: 'manual' }, { db }), { status: 409 });
  await assert.rejects(() => upsertBucket(C, { name: 'Bad', sourceKind: 'nope' }, { db }), { status: 400 });
});

test('upsertBucket rename of an existing id keeps it and checks name clashes', async () => {
  const db = makeDb();
  const r = await upsertBucket(C, { id: 'ue', name: 'Mixes', sourceKind: 'rendered-video' }, { db });
  assert.equal(r.created, false);
  assert.equal((await listBuckets(C, { db })).find((b) => b.id === 'ue').name, 'Mixes');
  await assert.rejects(() => upsertBucket(C, { id: 'ue', name: 'Ideas', sourceKind: 'rendered-video' }, { db }), { status: 409 });
});

test('deleteBucket refuses with items, reassigns when asked, folders follow', async () => {
  const db = makeDb();
  await upsertBucket(C, { name: 'Temp', sourceKind: 'manual' }, { db });
  await upsertPackage(pkg({ id: 'x1', bucketId: 'temp' }), { db, returnPackages: false });
  await upsertFolder(C, { bucketId: 'temp', name: 'acid' }, { db });
  await assert.rejects(() => deleteBucket(C, 'temp', { db }), { status: 409 });
  await assert.rejects(() => deleteBucket(C, 'temp', { db, reassignTo: 'nope' }), { status: 400 });
  const r = await deleteBucket(C, 'temp', { db, reassignTo: 'client' });
  assert.deepEqual([r.removed, r.reassigned], [true, 1]);
  assert.equal((await getPackage('x1', { db })).bucketId, 'client');
  assert.equal((await listFolders(C, { db, bucketId: 'client' })).length, 1);
  assert.ok(!(await listBuckets(C, { db })).some((b) => b.id === 'temp'));
});

test('deleteBucket on an empty custom bucket removes it; default bucket is deactivated', async () => {
  const db = makeDb();
  await upsertBucket(C, { name: 'Empty', sourceKind: 'manual' }, { db });
  assert.equal((await deleteBucket(C, 'empty', { db })).removed, true);
  const r = await deleteBucket(C, 'nas', { db });
  assert.equal(r.deactivated, true);
  assert.equal((await listBuckets(C, { db })).find((b) => b.id === 'nas').active, false);
  assert.equal((await deleteBucket(C, 'ghost', { db })).removed, false);
});

test('folders: manual + smart, unknown bucket, duplicates, delete, switch rule<->ids', async () => {
  const db = makeDb();
  const a = await upsertFolder(C, { bucketId: 'record', name: 'Acid', itemIds: ['a', 'b'] }, { db });
  assert.equal(a.folder.id, 'acid');
  const s = await upsertFolder(C, { bucketId: 'record', name: '303 stuff', rule: { field: 'gear', op: 'contains', value: 'tb-303' } }, { db });
  assert.equal(s.folder.rule.value, 'tb-303');
  await assert.rejects(() => upsertFolder(C, { bucketId: 'record', name: 'acid' }, { db }), { status: 409 });
  await assert.rejects(() => upsertFolder(C, { bucketId: 'ghost', name: 'x' }, { db }), { status: 400 });
  await assert.rejects(() => upsertFolder(C, { bucketId: 'record', name: 'both', rule: { field: 'a', value: 1 }, itemIds: [] }, { db }), { status: 400 });
  assert.equal((await listFolders(C, { db })).length, 2);
  await upsertFolder(C, { id: 'acid', bucketId: 'record', name: 'Acid', rule: { field: 'genres', op: 'contains', value: 'acid' } }, { db });
  assert.equal(db.docs.get(`content_buckets/${C}/folders/acid`).itemIds, undefined);
  assert.equal((await deleteFolder(C, 'acid', { db })).removed, true);
  assert.equal((await deleteFolder(C, 'acid', { db })).removed, false);
});

test('aliases merge, lowercase and dedupe; clients isolated', async () => {
  const db = makeDb();
  assert.deepEqual(await getAliases(C, { db }), {});
  await upsertAliases(C, { 'TR-909': ['909', 'Roland 909'] }, { db });
  const m = await upsertAliases(C, { 'tr-909': ['909', 'tr909'] }, { db });
  assert.deepEqual(m['tr-909'].sort(), ['909', 'roland 909', 'tr909']);
  assert.deepEqual(await getAliases('other', { db }), {});
  await assert.rejects(() => upsertAliases(C, { x: 'nope' }, { db }), { status: 400 });
  await assert.rejects(() => listBuckets('', { db }), { status: 400 });
});

test('bucketsToEngineConfig: defaults reproduce DEFAULT_ENGINE_CONFIG; shares flow through', () => {
  assert.deepEqual(mergeEngineConfig(bucketsToEngineConfig(DEFAULT_BUCKETS)), DEFAULT_ENGINE_CONFIG);
  assert.deepEqual(mergeEngineConfig(bucketsToEngineConfig(undefined)), DEFAULT_ENGINE_CONFIG);
  const custom = DEFAULT_BUCKETS.map((b) => (b.id === 'record' ? { ...b, share: { ...b.share, perDayMax: 1, maxSharePct: 25 } } : b));
  const cfg = mergeEngineConfig(bucketsToEngineConfig(custom));
  assert.equal(cfg.engines.record.maxPerDay, 1);
  assert.equal(cfg.engines.record.maxSharePct, 25);
  const off = mergeEngineConfig(bucketsToEngineConfig(DEFAULT_BUCKETS.map((b) => (b.id === 'ue' ? { ...b, active: false } : b))));
  assert.equal(off.engines.ue.maxPerDay, 0);
  // custom (non-engine) bucket ids are ignored by the legacy config
  assert.deepEqual(bucketsToEngineConfig([{ id: 'flyers', share: { perDayMax: 3 } }]), { engines: {} });
});

test('package writes stamp searchTokens + facetVersion; bucketId validated', async () => {
  const db = makeDb();
  const r = await upsertPackage(pkg({ facets: { gear: ['909'], people: ['Jev'] }, humanEdits: { venues: ['The Pit'] }, bucketId: 'record' }), { db, returnPackages: false });
  assert.equal(r.pkg.facetVersion, 1);
  assert.deepEqual(r.pkg.searchTokens.sort(), buildSearchTokens(r.pkg).sort());
  assert.ok(r.pkg.searchTokens.includes('tr-909'));
  assert.ok(r.pkg.searchTokens.includes('pit'));
  assert.equal(validatePackage({ ...pkg(), bucketId: 'Bad Id' }).ok, false);
  assert.equal(validatePackage({ ...pkg(), facets: [] }).ok, false);
  assert.equal(validatePackage({ ...pkg(), bucketId: 'record', facets: {}, humanEdits: {}, facetVersion: 1, searchTokens: ['a'] }).ok, true);
});
