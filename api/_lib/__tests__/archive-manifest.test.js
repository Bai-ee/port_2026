'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCollectionManifest, buildCollectionManifestV11 } = require('../archive-manifest.cjs');

test('manifest links permanent originals and provenance', () => {
  const m = buildCollectionManifest({
    collection: { id: 'c', title: 'Chicago' },
    assets: [{ id: 'a', archiveName: 'set.mov', sha256: 'abc', transactionId: 'tx' }],
  });
  assert.equal(m.assets[0].arweaveUrl, 'https://arweave.net/tx');
  assert.equal(m.provenance.originalsReadOnly, true);
  assert.equal(m.provenance.contentAddressing, 'sha256');
});

test('manifest rejects assets without permanent identity', () =>
  assert.throws(() => buildCollectionManifest({ collection: { id: 'c' }, assets: [{ id: 'a' }] })));

// ── schema 1.1 (docs/archive/PERMANENT_ARCHIVE_CONTRACT.md §D) ──────────

const v11Asset = {
  id: 'asset-1', sha256: 'a'.repeat(64), sizeBytes: 2048, mediaType: 'video', contentType: 'video/mp4',
  archiveName: 'Housepit/2008/clip.mp4', // caller may still pass a path — the manifest basenames it
  originalTransactionId: 'tx-original-1', originalUrl: 'https://arweave.net/tx-original-1',
  recordTransactionId: 'tx-record-v2', recordVersion: 2,
  decisions: [{ id: 'era', question: 'What era?', value: '2008' }],
};

test('buildCollectionManifestV11 basics: schema, version chain, viewer tx, basenamed archiveName', () => {
  const m = buildCollectionManifestV11({
    collection: { id: 'housepit-2008', title: '2008' },
    version: 3, previousManifestTransactionId: 'tx-manifest-v2',
    assets: [v11Asset], viewerTransactionId: 'tx-viewer-1', now: '2026-09-20T12:00:00.000Z',
  });
  assert.equal(m.schemaVersion, '1.1');
  assert.equal(m.recordType, 'collection-manifest');
  assert.equal(m.version, 3);
  assert.equal(m.previousManifestTransactionId, 'tx-manifest-v2');
  assert.equal(m.collection.id, 'housepit-2008');
  assert.equal(m.collection.generatedAt, '2026-09-20T12:00:00.000Z');
  assert.equal(m.viewerTransactionId, 'tx-viewer-1');
  assert.equal(m.assets[0].archiveName, 'clip.mp4', 'never a full path, even if the caller passed one');
  assert.equal(m.assets[0].recordTransactionId, 'tx-record-v2');
  assert.equal(m.assets[0].recordVersion, 2);
  assert.deepEqual(m.assets[0].decisions, [{ id: 'era', question: 'What era?', value: '2008' }]);
  assert.equal(m.provenance.originalsReadOnly, true);
});

test('buildCollectionManifestV11: version 1 has no previous manifest tx; viewer defaults to null', () => {
  const m = buildCollectionManifestV11({ collection: { id: 'c' }, assets: [v11Asset] });
  assert.equal(m.version, 1);
  assert.equal(m.previousManifestTransactionId, null);
  assert.equal(m.viewerTransactionId, null);
});

test('buildCollectionManifestV11 rejects an asset with no permanent original', () =>
  assert.throws(() => buildCollectionManifestV11({ collection: { id: 'c' }, assets: [{ id: 'a' }] })));
