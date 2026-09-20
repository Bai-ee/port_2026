'use strict';

// Mocks firebase-admin.cjs (fake Firestore) via require.cache injection —
// same technique as archive-worker-intake.test.js. archive-record.cjs /
// archive-manifest.cjs / archive-arweave.cjs are left real (pure, no
// Firebase dependency); deployViewerIfChanged reads the real
// public/archive-viewer/index.html off disk, same as production.

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const modPath = path.resolve(__dirname, '../archive-permanent-archive.cjs');

function loadModuleWithFakes() {
  delete require.cache[modPath];
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  const mod = require(modPath);
  return { fake, mod };
}

async function seedReview(fake, id, overrides = {}) {
  await fake.adminDb.collection('archive_review').doc(id).set({
    assetId: id, sha256: 'a'.repeat(64), sizeBytes: 1000, mediaType: 'video', archiveName: 'clip.mp4',
    sourcePaths: ['Housepit/2008/clip.mp4'], observations: [{ provider: 'twelvelabs', status: 'READY' }],
    decisions: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, question: `q${i}?`, selectedValue: 'x', confidence: 0.5, reviewBand: 'QUICK_REVIEW', choices: ['x', 'y'] })),
    workerId: 'worker-a', sourceId: 'source-a', collectionId: 'housepit-2008', collectionTitle: '2008',
    humanConfirmations: {}, humanCorrections: [], state: 'REVIEW_PENDING',
    ...overrides,
  });
}

async function seedUpload(fake, contentAssetId, overrides = {}) {
  await fake.adminDb.collection('archive_uploads').doc(`tx-${contentAssetId}`).set({
    kind: 'original', state: 'UPLOADED', transactionId: `tx-${contentAssetId}`, contentAssetId,
    arweaveUrl: `https://arweave.net/tx-${contentAssetId}`, sizeBytes: 1000, collectionId: 'housepit-2008',
    archiveName: 'clip.mp4', sha256: 'a'.repeat(64), contentType: 'video/mp4', workerId: 'worker-a',
    ...overrides,
  });
}

async function seedWorker(fake, id = 'worker-a', overrides = {}) {
  await fake.adminDb.collection('archive_workers').doc(id).set({ lastHeartbeatAt: new Date().toISOString(), ...overrides });
}

// ── collection identity ──────────────────────────────────────────────────

test('slugifyCollectionId / collectionTitleFromPath', () => {
  const { mod } = loadModuleWithFakes();
  assert.equal(mod.slugifyCollectionId('Housepit/San Francisco/2008'), 'housepit-san-francisco-2008');
  assert.equal(mod.slugifyCollectionId('.'), 'root');
  assert.equal(mod.slugifyCollectionId(''), 'root');
  assert.equal(mod.collectionTitleFromPath('Housepit/San Francisco/2008'), '2008');
  assert.equal(mod.collectionTitleFromPath('.'), 'root');
});

test('resolveCollectionForJob: jobId -> PROCESS_COLLECTION command -> relativePath -> collection id/title', async () => {
  const { fake, mod } = loadModuleWithFakes();
  await fake.adminDb.collection('archive_commands').doc('cmd-1').set({
    type: 'PROCESS_COLLECTION', workerId: 'worker-a', sourceId: 'source-a',
    relativePath: 'Housepit/2008', jobId: 'job-1', state: 'RUNNING',
  });
  const resolved = await mod.resolveCollectionForJob({ collectionJobId: 'job-1' });
  assert.deepEqual(resolved, { id: 'housepit-2008', title: '2008', relativePath: 'Housepit/2008' });
  assert.equal(await mod.resolveCollectionForJob({ collectionJobId: 'no-such-job' }), null);
  assert.equal(await mod.resolveCollectionForJob({}), null);
});

// ── auto-enqueue on documentation (item 1) ───────────────────────────────

test('autoEnqueueArchiveUpload: skips junk-only locations, missing READY evidence, and <6 decisions', async () => {
  const { mod } = loadModuleWithFakes();
  const base = { workerId: 'worker-a', sourceId: 'source-a', reviewId: 'asset-1', collectionId: 'housepit-2008', archiveName: 'clip.mp4', mediaType: 'video', sha256: 'a'.repeat(64) };

  assert.equal(await mod.autoEnqueueArchiveUpload({ ...base, sourcePaths: ['Housepit/2008/._clip.mp4', 'Housepit/2008/.DS_Store'], observations: [{ status: 'READY' }], decisions: Array(6).fill({ id: 'x' }) }), null, 'junk-only locations never enqueue');

  assert.equal(await mod.autoEnqueueArchiveUpload({ ...base, sourcePaths: ['Housepit/2008/clip.mp4'], observations: [{ status: 'INDEXING' }], decisions: Array(6).fill({ id: 'x' }) }), null, 'no READY observation -> no enqueue');

  assert.equal(await mod.autoEnqueueArchiveUpload({ ...base, sourcePaths: ['Housepit/2008/clip.mp4'], observations: [{ status: 'READY' }], decisions: Array(5).fill({ id: 'x' }) }), null, 'fewer than 6 decisions -> no enqueue');
});

test('autoEnqueueArchiveUpload: enqueues once documented, is idempotent across re-syncs, and derives a basenamed archiveName', async () => {
  const { fake, mod } = loadModuleWithFakes();
  const params = {
    workerId: 'worker-a', sourceId: 'source-a', reviewId: 'asset-1', collectionId: 'housepit-2008',
    sourcePaths: ['Housepit/2008/._junk', 'Housepit/2008/clip.mp4'], archiveName: 'clip.mp4', mediaType: 'video',
    sha256: 'a'.repeat(64), observations: [{ status: 'READY' }], decisions: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}` })),
  };
  const commandId = await mod.autoEnqueueArchiveUpload(params);
  assert.ok(commandId);
  const cmd = fake.adminDb._raw('archive_commands', commandId);
  assert.equal(cmd.type, 'UPLOAD_ASSET_ARWEAVE');
  assert.equal(cmd.relativePath, 'Housepit/2008/clip.mp4', 'skips the junk path, uses the first clean location');
  assert.equal(cmd.archiveName, 'clip.mp4');
  assert.equal(cmd.contentType, 'video/mp4');
  assert.equal(cmd.state, 'QUEUED');

  const second = await mod.autoEnqueueArchiveUpload(params);
  assert.equal(second, null, 'a second sync with an active command is a no-op');
  const all = await fake.adminDb.collection('archive_commands').where('contentAssetId', '==', 'asset-1').get();
  assert.equal(all.docs.length, 1, 'exactly one UPLOAD_ASSET_ARWEAVE command exists');
});

// ── COMPLETE dispatch: UPLOAD_ASSET_ARWEAVE -> archive_uploads + record v1 ─

test('handleCommandComplete UPLOAD_ASSET_ARWEAVE: writes archive_uploads and enqueues archive-record v1', async () => {
  const { fake, mod } = loadModuleWithFakes();
  await seedWorker(fake);
  await seedReview(fake, 'asset-1');

  const command = { type: 'UPLOAD_ASSET_ARWEAVE', workerId: 'worker-a', collectionId: 'housepit-2008' };
  const result = {
    transactionId: 'tx-asset-1', contentAssetId: 'asset-1', arweaveUrl: 'https://arweave.net/tx-asset-1',
    sizeBytes: 1000, collectionId: 'housepit-2008', archiveName: 'clip.mp4', sha256: 'a'.repeat(64), contentType: 'video/mp4',
  };
  await mod.handleCommandComplete({ command, result });

  const uploadDoc = fake.adminDb._raw('archive_uploads', 'tx-asset-1');
  assert.equal(uploadDoc.contentAssetId, 'asset-1');
  assert.equal(uploadDoc.kind, 'original');

  const jsonCommands = (await fake.adminDb.collection('archive_commands').where('type', '==', 'UPLOAD_JSON').get()).docs;
  assert.equal(jsonCommands.length, 1);
  const jsonCmd = jsonCommands[0].data();
  assert.equal(jsonCmd.kind, 'archive-record');
  assert.equal(jsonCmd.refs.contentAssetId, 'asset-1');
  assert.equal(jsonCmd.refs.version, 1);
  assert.equal(jsonCmd.refs.previousTransactionId, null);
  assert.equal(jsonCmd.payload.asset.id, 'asset-1');
  assert.equal(jsonCmd.payload.version, 1);
  assert.ok(jsonCmd.tags.some((t) => t.name === 'Archive-Schema' && t.value === '1.1'));
});

// ── COMPLETE dispatch: UPLOAD_JSON archive-record -> archive_records + manifest gate ─

test('handleCommandComplete UPLOAD_JSON archive-record: writes archive_records + mirrors archive_review, then rebuilds the manifest when nothing else is in flight', async () => {
  const { fake, mod } = loadModuleWithFakes();
  await seedWorker(fake);
  await seedReview(fake, 'asset-1');
  await seedUpload(fake, 'asset-1');

  const command = { type: 'UPLOAD_JSON', kind: 'archive-record', workerId: 'worker-a', refs: { contentAssetId: 'asset-1', collectionId: 'housepit-2008', version: 1, previousTransactionId: null } };
  const result = { kind: 'archive-record', transactionId: 'tx-record-v1', arweaveUrl: 'https://arweave.net/tx-record-v1' };
  await mod.handleCommandComplete({ command, result });

  const recordDoc = fake.adminDb._raw('archive_records', 'asset-1');
  assert.equal(recordDoc.version, 1);
  assert.equal(recordDoc.transactionId, 'tx-record-v1');
  assert.equal(recordDoc.dirty, false);

  const reviewDoc = fake.adminDb._raw('archive_review', 'asset-1');
  assert.equal(reviewDoc.recordTransactionId, 'tx-record-v1');
  assert.equal(reviewDoc.recordVersion, 1);

  const manifestCommands = (await fake.adminDb.collection('archive_commands').where('type', '==', 'UPLOAD_JSON').get()).docs.filter((d) => d.data().kind === 'collection-manifest');
  assert.equal(manifestCommands.length, 1, 'no uploads/records left in flight for the collection -> manifest v1 is enqueued');
  const manifestCmd = manifestCommands[0].data();
  assert.equal(manifestCmd.refs.collectionId, 'housepit-2008');
  assert.equal(manifestCmd.refs.version, 1);
  assert.equal(manifestCmd.payload.assets.length, 1);
  assert.equal(manifestCmd.payload.assets[0].id, 'asset-1');
});

test('maybeRebuildManifest: gated while an UPLOAD_ASSET_ARWEAVE for the collection is still in flight', async () => {
  const { fake, mod } = loadModuleWithFakes();
  await seedWorker(fake);
  await seedReview(fake, 'asset-1');
  await seedUpload(fake, 'asset-1');
  // A second asset in the same collection is still mid-upload.
  await fake.adminDb.collection('archive_commands').doc('still-uploading').set({
    type: 'UPLOAD_ASSET_ARWEAVE', collectionId: 'housepit-2008', state: 'RUNNING', workerId: 'worker-a',
  });

  const out = await mod.maybeRebuildManifest('housepit-2008', 'worker-a');
  assert.equal(out, null);
  const manifestCommands = (await fake.adminDb.collection('archive_commands').where('type', '==', 'UPLOAD_JSON').get()).docs;
  assert.equal(manifestCommands.length, 0, 'no manifest command should be enqueued while an upload is still in flight');
});

// ── correction -> dirty/debounce -> next version (item 2/5) ─────────────

test('appendReviewCorrection: debounces while an archive-record command is in flight, then versions on completion', async () => {
  const { fake, mod } = loadModuleWithFakes();
  await seedWorker(fake);
  await seedReview(fake, 'asset-1');
  await seedUpload(fake, 'asset-1');
  await fake.adminDb.collection('archive_records').doc('asset-1').set({ version: 1, transactionId: 'tx-record-v1', collectionId: 'housepit-2008' });
  // Simulate a v2 archive-record command already QUEUED for this asset.
  await fake.adminDb.collection('archive_commands').doc('inflight-record').set({
    type: 'UPLOAD_JSON', kind: 'archive-record', state: 'QUEUED', workerId: 'worker-a',
    refs: { contentAssetId: 'asset-1', collectionId: 'housepit-2008', version: 2 },
  });

  const correctionResult = await mod.appendReviewCorrection({ id: 'asset-1', decisionId: 'd0', value: 'y', actor: 'admin@example.com' });
  assert.equal(correctionResult.recordVersionQueued, null, 'a command is already in flight -> nothing new queued right now');

  const reviewAfter = fake.adminDb._raw('archive_review', 'asset-1');
  assert.equal(reviewAfter.humanConfirmations.d0, 'y');
  assert.equal(reviewAfter.humanCorrections.length, 1);
  assert.equal(reviewAfter.humanCorrections[0].decisionId, 'd0');

  const recordAfter = fake.adminDb._raw('archive_records', 'asset-1');
  assert.equal(recordAfter.dirty, true, 'marked dirty instead of double-enqueueing');

  const jsonBefore = (await fake.adminDb.collection('archive_commands').where('type', '==', 'UPLOAD_JSON').get()).docs.filter((d) => d.data().kind === 'archive-record');
  assert.equal(jsonBefore.length, 1, 'still exactly the one in-flight command — no duplicate enqueued');

  // Now the in-flight v2 command completes — mirrors what the real route does:
  // it flips the command doc's own state to COMPLETE *before* calling
  // handleCommandComplete, so the debounce's own in-flight check no longer
  // sees this command as active.
  await fake.adminDb.collection('archive_commands').doc('inflight-record').set({ state: 'COMPLETE' }, { merge: true });
  await mod.handleCommandComplete({
    command: { type: 'UPLOAD_JSON', kind: 'archive-record', workerId: 'worker-a', refs: { contentAssetId: 'asset-1', collectionId: 'housepit-2008', version: 2, previousTransactionId: 'tx-record-v1' } },
    result: { kind: 'archive-record', transactionId: 'tx-record-v2', arweaveUrl: 'https://arweave.net/tx-record-v2' },
  });

  const recordFinal = fake.adminDb._raw('archive_records', 'asset-1');
  assert.equal(recordFinal.version, 2);
  assert.equal(recordFinal.transactionId, 'tx-record-v2');
  assert.equal(recordFinal.dirty, false, 'cleared, then a v3 enqueue picked up the pending correction');

  const jsonAfter = (await fake.adminDb.collection('archive_commands').where('type', '==', 'UPLOAD_JSON').get()).docs.filter((d) => d.data().kind === 'archive-record');
  assert.equal(jsonAfter.length, 2, 'the dirty flag produced exactly one more (v3) command');
  const v3 = jsonAfter.find((d) => d.data().refs.version === 3);
  assert.ok(v3, 'a v3 archive-record command was enqueued from the dirty flag');
  assert.equal(v3.data().refs.previousTransactionId, 'tx-record-v2');

  // And because a record command is now in flight again for this collection,
  // the manifest must NOT have been rebuilt yet.
  const manifestCommands = (await fake.adminDb.collection('archive_commands').where('type', '==', 'UPLOAD_JSON').get()).docs.filter((d) => d.data().kind === 'collection-manifest');
  assert.equal(manifestCommands.length, 0);
});

test('enqueueNextRecordVersionIfNeeded: no-op with no review doc and no permanent original yet', async () => {
  const { fake, mod } = loadModuleWithFakes();
  assert.equal(await mod.enqueueNextRecordVersionIfNeeded({ contentAssetId: 'missing' }), null);
  await seedReview(fake, 'asset-2'); // no upload yet
  assert.equal(await mod.enqueueNextRecordVersionIfNeeded({ contentAssetId: 'asset-2' }), null);
});

// ── viewer deploy (item 4/7) ──────────────────────────────────────────────

test('deployViewerIfChanged: enqueues once, then skips a re-deploy with the same sha256', async () => {
  const { fake, mod } = loadModuleWithFakes();
  await assert.rejects(mod.deployViewerIfChanged(), (e) => e.status === 503, 'no registered worker -> 503');

  await seedWorker(fake);
  const first = await mod.deployViewerIfChanged();
  assert.equal(first.skipped, false);
  assert.ok(first.commandId);
  assert.ok(first.sha256);

  const cmd = fake.adminDb._raw('archive_commands', first.commandId);
  assert.equal(cmd.kind, 'viewer');
  assert.equal(cmd.contentType, 'text/html');
  assert.equal(typeof cmd.payload, 'string');

  // Simulate the worker completing that upload.
  await mod.handleCommandComplete({
    command: { type: 'UPLOAD_JSON', kind: 'viewer', workerId: 'worker-a', refs: { sha256: first.sha256 } },
    result: { kind: 'viewer', transactionId: 'tx-viewer-1', arweaveUrl: 'https://arweave.net/tx-viewer-1' },
  });
  const settings = fake.adminDb._raw('archive_settings', 'viewer');
  assert.equal(settings.transactionId, 'tx-viewer-1');
  assert.equal(settings.sha256, first.sha256);

  const second = await mod.deployViewerIfChanged();
  assert.equal(second.skipped, true);
  assert.equal(second.transactionId, 'tx-viewer-1');
});

// ── page summary ──────────────────────────────────────────────────────────

test('getPermanentArchiveSummary: aggregates per collection', async () => {
  const { fake, mod } = loadModuleWithFakes();
  await seedReview(fake, 'asset-1');
  await seedUpload(fake, 'asset-1');
  await fake.adminDb.collection('archive_records').doc('asset-1').set({ version: 2, collectionId: 'housepit-2008' });
  await fake.adminDb.collection('archive_collections').doc('housepit-2008').set({ title: '2008', manifestVersion: 1, manifestTransactionId: 'tx-manifest-1' });

  const summary = await mod.getPermanentArchiveSummary();
  assert.equal(summary.collections.length, 1);
  const c = summary.collections[0];
  assert.equal(c.id, 'housepit-2008');
  assert.equal(c.title, '2008');
  assert.equal(c.documented, 1);
  assert.equal(c.uploaded, 1);
  assert.equal(c.recordVersionsTotal, 2);
  assert.equal(c.manifestVersion, 1);
  assert.ok(c.cost);
  assert.ok(c.viewerUrl.includes('tx-manifest-1'));
});
