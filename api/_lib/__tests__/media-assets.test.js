'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const mediaAssets = require('../media-assets.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  mediaAssets.__setTestContext(fakeCtx);
});

afterEach(() => {
  mediaAssets.__setTestContext(null);
});

test('assetDocId is a stable, idempotent base64url encoding of the full path', () => {
  const a = mediaAssets.assetDocId('skyline/clip.mov');
  const b = mediaAssets.assetDocId('skyline/clip.mov');
  assert.equal(a, b);
  assert.notEqual(a, mediaAssets.assetDocId('skyline/other.mov'));
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'base64url has no +/= characters');
});

test('posterPathForSource derives .posters/<folder>/<name>.jpg, appending (not swapping) the extension', () => {
  assert.equal(mediaAssets.posterPathForSource('skyline/clip.mov'), '.posters/skyline/clip.mov.jpg');
  assert.equal(mediaAssets.posterPathForSource('assets/retro_dust/dust.mp4'), '.posters/assets/retro_dust/dust.mp4.jpg');
  assert.equal(mediaAssets.posterPathForSource('no-folder.mp4'), null);
  assert.equal(mediaAssets.posterPathForSource(''), null);
});

test('kindForContentType prefers contentType, falls back to extension', () => {
  assert.equal(mediaAssets.kindForContentType('video/quicktime', 'clip.mov'), 'video');
  assert.equal(mediaAssets.kindForContentType('image/png', 'still.png'), 'image');
  assert.equal(mediaAssets.kindForContentType('', 'clip.mov'), 'video');
  assert.equal(mediaAssets.kindForContentType('', 'still.png'), 'image');
  assert.equal(mediaAssets.kindForContentType('', 'notes.txt'), 'other');
});

test('upsertAssets writes asset docs keyed by fullPath, idempotent on re-upsert', async () => {
  await mediaAssets.upsertAssets([
    { fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 100, contentType: 'video/quicktime' },
    { fullPath: 'skyline/b.png', folder: 'skyline', name: 'b.png', size: 50, contentType: 'image/png' },
  ]);
  const first = await mediaAssets.listIndexFolderFiles('skyline');
  assert.equal(first.files.length, 2);

  // Re-upsert one with a new size — should merge, not duplicate.
  await mediaAssets.upsertAssets([
    { fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 200, contentType: 'video/quicktime' },
  ]);
  const second = await mediaAssets.listIndexFolderFiles('skyline');
  assert.equal(second.files.length, 2, 'no duplicate doc for the same fullPath');
  assert.equal(second.files.find((f) => f.name === 'a.mov').size, 200);
});

test('removeAssets deletes docs by fullPath', async () => {
  await mediaAssets.upsertAssets([
    { fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 100 },
    { fullPath: 'skyline/b.mov', folder: 'skyline', name: 'b.mov', size: 100 },
  ]);
  await mediaAssets.removeAssets(['skyline/a.mov']);
  const { files } = await mediaAssets.listIndexFolderFiles('skyline');
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'b.mov');
});

test('moveAssetDocs re-keys the doc under the new fullPath and recomputes posterPath when one existed', async () => {
  await mediaAssets.upsertAssets([
    { fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 100, contentType: 'video/quicktime', posterPath: '.posters/skyline/a.mov.jpg' },
  ]);
  await mediaAssets.moveAssetDocs([{ from: 'skyline/a.mov', to: 'neighborhood/a.mov', folder: 'neighborhood' }]);

  const oldFolder = await mediaAssets.listIndexFolderFiles('skyline');
  assert.equal(oldFolder.files.length, 0, 'old location doc is gone');

  const newFolder = await mediaAssets.listIndexFolderFiles('neighborhood');
  assert.equal(newFolder.files.length, 1);
  assert.equal(newFolder.files[0].fullPath, 'neighborhood/a.mov');
  assert.equal(newFolder.files[0].posterPath, '.posters/neighborhood/a.mov.jpg', 'poster path recomputed for new location');
  assert.equal(newFolder.files[0].size, 100, 'other fields carried forward from the old doc');
});

test('moveAssetDocs on a file with no poster leaves posterPath null', async () => {
  await mediaAssets.upsertAssets([{ fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 100 }]);
  await mediaAssets.moveAssetDocs([{ from: 'skyline/a.mov', to: 'neighborhood/a.mov', folder: 'neighborhood' }]);
  const { files } = await mediaAssets.listIndexFolderFiles('neighborhood');
  assert.equal(files[0].posterPath, null);
});

test('ensureFolderDoc/removeFolderDoc represent an empty folder in listIndexFolders', async () => {
  await mediaAssets.ensureFolderDoc('empty-folder');
  const folders = await mediaAssets.listIndexFolders();
  assert.deepEqual(folders, [{ name: 'empty-folder', count: 0 }]);

  await mediaAssets.removeFolderDoc('empty-folder');
  assert.deepEqual(await mediaAssets.listIndexFolders(), []);
});

test('listIndexFolders unions asset-derived folders with folder-only docs and counts correctly', async () => {
  await mediaAssets.upsertAssets([
    { fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 1 },
    { fullPath: 'skyline/b.mov', folder: 'skyline', name: 'b.mov', size: 1 },
    { fullPath: 'neighborhood/c.png', folder: 'neighborhood', name: 'c.png', size: 1 },
  ]);
  await mediaAssets.ensureFolderDoc('empty-folder');

  const folders = await mediaAssets.listIndexFolders();
  assert.deepEqual(folders, [
    { name: 'empty-folder', count: 0 },
    { name: 'neighborhood', count: 1 },
    { name: 'skyline', count: 2 },
  ]);
});

test('syncIndexFromBucket adds new bucket files, removes stale index docs, updates changed ones', async () => {
  // Seed the index with a file the bucket no longer has, and one that will change size.
  await mediaAssets.upsertAssets([
    { fullPath: 'skyline/gone.mov', folder: 'skyline', name: 'gone.mov', size: 1, updated: '2026-01-01T00:00:00.000Z' },
    { fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 100, updated: '2026-01-01T00:00:00.000Z', posterPath: '.posters/skyline/a.mov.jpg' },
  ]);

  const bucketRows = [
    { fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 999, updated: '2026-02-01T00:00:00.000Z' }, // changed
    { fullPath: 'neighborhood/new.png', folder: 'neighborhood', name: 'new.png', size: 50, updated: '2026-02-01T00:00:00.000Z' }, // new
  ];

  const result = await mediaAssets.syncIndexFromBucket(bucketRows);
  assert.deepEqual(result, { added: 1, removed: 1, updated: 1 });

  const skyline = await mediaAssets.listIndexFolderFiles('skyline');
  assert.equal(skyline.files.length, 1);
  assert.equal(skyline.files[0].size, 999);
  assert.equal(skyline.files[0].posterPath, '.posters/skyline/a.mov.jpg', 'existing posterPath preserved across a bucket-driven update');

  const neighborhood = await mediaAssets.listIndexFolderFiles('neighborhood');
  assert.equal(neighborhood.files.length, 1);
  assert.equal(neighborhood.files[0].name, 'new.png');
});

test('syncIndexFromBucket on an empty bucket removes every existing asset doc', async () => {
  await mediaAssets.upsertAssets([{ fullPath: 'skyline/a.mov', folder: 'skyline', name: 'a.mov', size: 1 }]);
  const result = await mediaAssets.syncIndexFromBucket([]);
  assert.deepEqual(result, { added: 0, removed: 1, updated: 0 });
  assert.deepEqual(await mediaAssets.listIndexFolders(), []);
});
