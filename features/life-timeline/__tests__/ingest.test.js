import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestLifeResults, lifeUploadUrls } from '../ingest.js';
import { rawItem, sha } from './_fixtures.js';

function makeDeps() {
  const media = new Map();
  const months = new Map();
  const sources = new Map();
  return {
    media, months, sources,
    now: () => Date.parse('2026-11-06T00:00:00Z'),
    getMedia: async (ids) => new Map(ids.filter((i) => media.has(i)).map((i) => [i, media.get(i)])),
    putMedia: async (docs) => docs.forEach((d) => media.set(d.id, d)),
    listMediaByMonth: async (ym) => [...media.values()].filter((d) => d.ym === ym),
    writeMonth: async (ym, m, p) => months.set(ym, { m, p }),
    countBySource: async (sid) => [...media.values()].filter((d) => d.sourceIds.includes(sid)).length,
    upsertSource: async (s, n) => sources.set(s.id, { ...s, itemCount: n }),
  };
}
const SRC = { id: 'photos-lib-1', kind: 'photos', label: 'Lib', libraryPath: 'bryan/Backup/Photos.photoslibrary' };

test('ingest happy path', async () => {
  const d = makeDeps();
  const out = await ingestLifeResults(d, { source: SRC, items: [rawItem(1), rawItem(2, { takenLocal: null }), rawItem(3, { sha256: 'bad' })] });
  assert.equal(out.ok, true);
  assert.equal(out.upserted, 2);
  assert.equal(out.skipped.length, 1);
  assert.deepEqual(out.months, ['2010-05', 'unknown']);
  assert.equal(d.months.get('2010-05').m.count, 1);
  assert.equal(d.sources.get(SRC.id).itemCount, 2);
});
test('date change rebuilds old month and empties it', async () => {
  const d = makeDeps();
  await ingestLifeResults(d, { source: SRC, items: [rawItem(1)] });
  const out = await ingestLifeResults(d, { source: SRC, items: [rawItem(1, { takenLocal: '2011-01-01T00:00:00' })] });
  assert.deepEqual(out.months, ['2010-05', '2011-01']);
  assert.equal(d.months.get('2010-05').m.count, 0);
  assert.equal(d.months.get('2011-01').m.count, 1);
});
test('merge across sources', async () => {
  const d = makeDeps();
  await ingestLifeResults(d, { source: SRC, items: [rawItem(1)] });
  await ingestLifeResults(d, { source: { ...SRC, id: 'other' }, items: [rawItem(1, { albums: ['Z'], locations: [{ sourceId: '', relativePath: 'q.jpg', originalFileName: 'q' }] })] });
  const doc = [...d.media.values()][0];
  assert.deepEqual(doc.sourceIds, ['photos-lib-1', 'other']);
  assert.deepEqual(doc.albums, ['A', 'Z']);
  assert.equal(doc.locations.length, 2);
});
test('rejects >100 items, empty, bad source', async () => {
  const d = makeDeps();
  const many = Array.from({ length: 101 }, (_, i) => rawItem(i));
  await assert.rejects(ingestLifeResults(d, { source: SRC, items: many }), (e) => e.status === 400);
  await assert.rejects(ingestLifeResults(d, { source: SRC, items: [] }), (e) => e.status === 400);
  for (const bad of [{ ...SRC, id: 'Bad_ID' }, { ...SRC, kind: 'x' }, { ...SRC, libraryPath: '/abs' }, { ...SRC, libraryPath: 'a/../b' }, { ...SRC, libraryPath: 'Volumes/x' }]) {
    await assert.rejects(ingestLifeResults(d, { source: bad, items: [rawItem(1)] }), (e) => e.status === 400);
  }
});

test('upload urls', async () => {
  const signUpload = async ({ storagePath, contentType }) => `https://u/${storagePath}?ct=${contentType}`;
  const s = sha('a');
  const out = await lifeUploadUrls({ signUpload }, { items: [{ sha256: s, variant: 's', contentType: 'image/jpeg', sizeBytes: 100 }] });
  assert.equal(out.urls[0].storagePath, `life-thumbs/${s.slice(0, 16)}_s.jpg`);
  assert.deepEqual(out.urls[0].headers, { 'content-type': 'image/jpeg' });
  const base = { sha256: s, variant: 'm', contentType: 'image/jpeg', sizeBytes: 5 };
  for (const bad of [{ ...base, sha256: 'x' }, { ...base, variant: 'l' }, { ...base, contentType: 'image/png' }, { ...base, sizeBytes: 0 }, { ...base, sizeBytes: 11 * 1024 * 1024 }]) {
    await assert.rejects(lifeUploadUrls({ signUpload }, { items: [bad] }), (e) => e.status === 400);
  }
  await assert.rejects(lifeUploadUrls({ signUpload }, { items: [] }), (e) => e.status === 400);
  await assert.rejects(lifeUploadUrls({ signUpload }, { items: Array(201).fill(base) }), (e) => e.status === 400);
});
