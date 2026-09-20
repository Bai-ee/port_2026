'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchiveRecord, resolveDecisionValue } = require('../archive-record.cjs');

const baseReview = {
  assetId: 'asset-1',
  sha256: 'a'.repeat(64),
  sizeBytes: 1024,
  mediaType: 'video',
  archiveName: 'clip.mp4',
  sourcePaths: ['Housepit/2008/clip.mp4'],
  collectionId: 'housepit-2008',
  collectionTitle: '2008',
  observations: [{ provider: 'twelvelabs', kind: 'video_understanding', summary: 'people dancing', status: 'READY', at: '2026-09-01T00:00:00.000Z' }],
  decisions: [
    { id: 'era', question: 'What era?', selectedValue: 'unknown', confidence: 0.4, reviewBand: 'IDENTIFICATION_REQUIRED', choices: ['unknown', '2008', '2009'] },
    { id: 'series', question: 'What series?', selectedValue: 'C2', confidence: 0.5, reviewBand: 'QUICK_REVIEW', choices: ['C1', 'C2', 'C3'] },
  ],
  humanConfirmations: {},
  humanCorrections: [],
};

const baseUpload = {
  transactionId: 'tx-original-1',
  arweaveUrl: 'https://arweave.net/tx-original-1',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  contentType: 'video/mp4',
  archiveName: 'clip.mp4',
  contentAssetId: 'asset-1',
  collectionId: 'housepit-2008',
};

test('buildArchiveRecord: values prefer human corrections over Jev', () => {
  const review = {
    ...baseReview,
    humanConfirmations: { era: '2008' },
    humanCorrections: [{ decisionId: 'era', previousValue: null, value: '2008', actor: 'admin@example.com', at: '2026-09-20T10:00:00.000Z' }],
  };
  const record = buildArchiveRecord({ review, upload: baseUpload, version: 1 });
  const era = record.decisions.find((d) => d.id === 'era');
  assert.equal(era.value, '2008', 'human correction wins over the Jev value');
  assert.equal(era.jev.value, 'unknown', 'the Jev pick is preserved separately');
  assert.deepEqual(era.human, { value: '2008', at: '2026-09-20T10:00:00.000Z' });

  const series = record.decisions.find((d) => d.id === 'series');
  assert.equal(series.value, 'C2', 'no human correction -> falls back to Jev value');
  assert.equal(series.human, null);
});

test('resolveDecisionValue: same preference rule standalone', () => {
  const decision = { id: 'x', selectedValue: 'jev-pick' };
  assert.equal(resolveDecisionValue(decision, {}), 'jev-pick');
  assert.equal(resolveDecisionValue(decision, { x: 'human-pick' }), 'human-pick');
});

test('buildArchiveRecord: never includes NAS paths, only a basename + a location count', () => {
  const review = { ...baseReview, sourcePaths: ['/Volumes/bryan/Housepit/San Francisco/2008/clip.mp4', 'Housepit/San Francisco/2008/clip.mov'] };
  const record = buildArchiveRecord({ review, upload: baseUpload, version: 1 });
  assert.equal(record.asset.archiveName, 'clip.mp4', 'archiveName is a basename, not a path');
  assert.ok(!record.asset.archiveName.includes('/'));
  assert.equal(record.provenance.sourceCount, 2, 'the NAS path itself never appears — only how many locations it was found at');
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('/Volumes/bryan'), 'no NAS mount path anywhere in the record');
  assert.ok(!serialized.includes('San Francisco'), 'no raw source path segment anywhere in the record');
});

test('buildArchiveRecord: version 1 has no previous tx; a later version carries it', () => {
  const v1 = buildArchiveRecord({ review: baseReview, upload: baseUpload, version: 1 });
  assert.equal(v1.previousRecordTransactionId, null);
  assert.equal(v1.version, 1);

  const v2 = buildArchiveRecord({ review: baseReview, upload: baseUpload, version: 2, previousTransactionId: 'record-tx-v1' });
  assert.equal(v2.previousRecordTransactionId, 'record-tx-v1');
  assert.equal(v2.version, 2);
});

test('buildArchiveRecord: asset identity, schema fields, and evidence/corrections mapping', () => {
  const review = {
    ...baseReview,
    humanConfirmations: { era: '2008' },
    humanCorrections: [{ decisionId: 'era', previousValue: 'unknown', value: '2008', actor: 'admin@example.com', at: '2026-09-20T10:00:00.000Z' }],
  };
  const record = buildArchiveRecord({ review, upload: baseUpload, version: 3, previousTransactionId: 'record-tx-v2', now: '2026-09-20T11:00:00.000Z' });

  assert.equal(record.schemaVersion, '1.1');
  assert.equal(record.recordType, 'archive-record');
  assert.equal(record.asset.id, 'asset-1');
  assert.equal(record.asset.originalTransactionId, 'tx-original-1');
  assert.equal(record.asset.originalUrl, 'https://arweave.net/tx-original-1');
  assert.equal(record.collection.id, 'housepit-2008');
  assert.equal(record.collection.title, '2008');
  assert.equal(record.provenance.sourceSystem, 'HITLOOP Archive');
  assert.equal(record.provenance.originalsReadOnly, true);
  assert.equal(record.provenance.contentAddressing, 'sha256');
  assert.equal(record.evidence.length, 1);
  assert.equal(record.evidence[0].provider, 'twelvelabs');
  assert.equal(record.corrections.length, 1);
  assert.equal(record.corrections[0].previousValue, 'unknown');
  assert.equal(record.generatedAt, '2026-09-20T11:00:00.000Z');
});

test('buildArchiveRecord: throws without a permanent upload transaction', () => {
  assert.throws(() => buildArchiveRecord({ review: baseReview, upload: {} }));
  assert.throws(() => buildArchiveRecord({ review: null, upload: baseUpload }));
});
