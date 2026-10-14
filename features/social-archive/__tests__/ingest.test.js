import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './_fakedb.js';
import { readerFromMap } from '../fs-reader.js';
import { ingestArchive, loadNasPackages, ADAPTERS } from '../ingest.js';

const raw = (id, ts, o = {}) => ({
  platform: 'facebook', account: 'Housepit CHI', platformId: id, kind: 'post', ts, tsKind: 'posted',
  tsSource: 'facebook-posts-html', text: `hello ${id}`, media: [], ...o,
});
const stub = {
  ADAPTER: 'stub',
  detect: (r) => r.exists('posts'),
  parse: () => ({
    entries: [
      raw('1', '2010-05-01T10:00:00Z', { media: [{ type: 'image', relPath: 'photos_and_videos/A/a.jpg' }, { type: 'image', relPath: 'photos_and_videos/A/zzz.jpg' }] }),
      raw('2', '2010-05-01T11:00:00Z'),
      raw('3', '2011-06-01T11:00:00Z', { kind: 'media', tsKind: 'taken', tsSource: 'facebook-album-html' }),
      raw('2', '2010-05-01T11:00:00Z'),
      raw('bad', 'garbage'),
      raw('mtime', '2010-05-01T11:00:00Z', { tsSource: 'mtime' }),
    ],
    stats: {}, warnings: ['w1'],
  }),
};
const reader = readerFromMap({ 'posts/x.html': '<html>' });
const NOW = '2026-10-08T12:00:00.000Z';
const base = (db, extra = {}) => ({
  db, clientId: 'c1', platform: 'facebook', account: 'Housepit CHI', archiveName: 'fb1', reader,
  archiveRootRel: 'FB/arch', adapter: stub, now: () => Date.parse(NOW), ...extra,
});
const seed = (db) => db.cols.set('x_content_packages', new Map([
  ['nas-aaa', { clientId: 'c1', bucketId: 'nas', nas: { relativePath: 'FB/arch/photos_and_videos/A/a.jpg', sha256: 'a'.repeat(64) }, status: 'idea' }],
  ['rv-1', { clientId: 'c1', bucketId: 'rendered', status: 'idea' }],
  // Another client's NAS row is never matched or linked (multi-client Phase 3a).
  ['nas-other', { clientId: 'c2', bucketId: 'nas', nas: { relativePath: 'FB/arch/photos_and_videos/A/a.jpg', sha256: 'b'.repeat(64) }, status: 'idea' }],
]));

test('loadNasPackages returns only nas-* packages with nas.relativePath', async () => {
  const db = makeDb(); seed(db);
  db.cols.get('x_content_packages').set('nas-nopath', { bucketId: 'nas' });
  assert.deepEqual(await loadNasPackages(db, 'c1'), [{ id: 'nas-aaa', nas: { relativePath: 'FB/arch/photos_and_videos/A/a.jpg', sha256: 'a'.repeat(64) } }]);
});

test('dry run reports and writes NOTHING', async () => {
  const db = makeDb(); seed(db);
  const colsBefore = structuredClone([...db.cols].map(([k, v]) => [k, [...v]]));
  const r = await ingestArchive(base(db));
  assert.equal(r.dryRun, true);
  assert.equal(r.entries, 3);
  assert.deepEqual(r.rejected, { 'duplicate-id': 1, 'bad-timestamp': 1, 'bad-tsSource': 1 });
  assert.deepEqual(r.byKind, { post: 2, media: 1 });
  assert.equal(r.firstTs, '2010-05-01T10:00:00.000Z'); assert.equal(r.lastTs, '2011-06-01T11:00:00.000Z');
  assert.equal(r.days, 3 - 1); assert.equal(r.withMedia, 1);
  assert.deepEqual(r.media, { total: 2, matched: 1, unmatched: 1 });
  assert.deepEqual(r.unmatchedSample.map((u) => u.relPath), ['photos_and_videos/A/zzz.jpg']);
  assert.deepEqual(r.warnings, ['w1']);
  assert.equal(db.writes.length, 0);
  assert.deepEqual([...db.cols].map(([k, v]) => [k, [...v]]), colsBefore);
  assert.equal(db.cols.has('timeline_entries'), false);
});

test('write ingests entries, links package, rebuilds days, saves archive', async () => {
  const db = makeDb(); seed(db);
  const r = await ingestArchive(base(db, { dryRun: false }));
  assert.equal(r.dryRun, false);
  assert.equal(db.cols.get('timeline_entries').size, 3);
  assert.equal(db.cols.get('timeline_days').size, 2);
  const pkg = db.cols.get('x_content_packages').get('nas-aaa');
  assert.equal(pkg.status, 'idea'); assert.equal(pkg.post.day, '2010-05-01'); assert.equal(pkg.postIds.length, 1);
  assert.equal(db.cols.get('x_content_packages').get('rv-1').post, undefined);
  const arch = [...db.cols.get('social_archives').values()][0];
  assert.deepEqual({ e: arch.entries, m: arch.matched, u: arch.unmatched, at: arch.ingestedAt, a: arch.adapter }, { e: 3, m: 1, u: 1, at: NOW, a: 'stub' });
  assert.ok([...db.cols.get('timeline_entries').values()].some((e) => e.linked.includes('nas-aaa')));
});

test('second ingest is idempotent: identical docs, no package/day changes', async () => {
  const db = makeDb(); seed(db);
  await ingestArchive(base(db, { dryRun: false }));
  const snap = JSON.stringify([...db.cols].map(([k, v]) => [k, [...v]]));
  const n = db.writes.length;
  await ingestArchive(base(db, { dryRun: false, now: () => Date.parse(NOW) + 86_400_000 * 30 }));
  const after = JSON.parse(JSON.stringify([...db.cols].map(([k, v]) => [k, [...v]])));
  const before = JSON.parse(snap);
  const strip = (cols) => cols.filter(([k]) => k !== 'social_archives');
  assert.deepEqual(strip(after), strip(before));
  assert.ok(db.writes.slice(n).every((w) => w.col !== 'x_content_packages' && w.col !== 'timeline_days'));
});

test('passed packages skip the Firestore package read; wrong layout throws on detect', async () => {
  const db = makeDb();
  const r = await ingestArchive(base(db, { packages: [{ id: 'nas-q', nas: { relativePath: 'FB/arch/photos_and_videos/A/zzz.jpg' } }] }));
  assert.deepEqual(r.media, { total: 2, matched: 1, unmatched: 1 });
  await assert.rejects(ingestArchive(base(db, { reader: readerFromMap({ 'other/x': '1' }) })), /does not look like/);
});

test('adapter registry is lazy and covers the three platforms', () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ['facebook', 'instagram', 'x']);
  assert.ok(Object.values(ADAPTERS).every((f) => typeof f === 'function'));
});

test('mediaOnly keeps only entries with media and counts the rest as no-media', async () => {
  const db = makeDb(); seed(db);
  const r = await ingestArchive(base(db, { mediaOnly: true }));
  assert.equal(r.entries, 1);
  assert.equal(r.withMedia, 1);
  assert.equal(r.rejected['no-media'], 3);
});
