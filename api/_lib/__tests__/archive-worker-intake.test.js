'use strict';

// Mocks firebase-admin.cjs (fake Firestore) and archive-intake-bucket.cjs
// (fake Storage bucket, HITLOOP's own default bucket — not the
// EditVideos-bridge bucket) via require.cache injection — same technique as
// deleted-accounts.test.js. archive-worker-intake.cjs is the worker-side
// Lane 2 intake logic (app/api/archive/worker/intake/route.js is a thin
// Bearer-token wrapper around it — not imported directly here, matching
// every other route test in this repo: next/server can't be resolved
// outside the Next.js runtime).

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const archiveIntakeBucketPath = path.resolve(__dirname, '../archive-intake-bucket.cjs');
const workerIntakePath = path.resolve(__dirname, '../archive-worker-intake.cjs');

function loadModuleWithFakes() {
  delete require.cache[workerIntakePath];
  const fake = makeFakeContext();
  const bucket = fake.adminStorage.bucket();

  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  require.cache[archiveIntakeBucketPath] = {
    id: archiveIntakeBucketPath,
    filename: archiveIntakeBucketPath,
    loaded: true,
    exports: { intakeBucket: () => bucket },
  };

  const mod = require(workerIntakePath);
  return { fake, bucket, mod };
}

function seedIntake(fake, id, overrides = {}) {
  fake.adminDb._store.has('archive_intake') || fake.adminDb._store.set('archive_intake', new Map());
  fake.adminDb._store.get('archive_intake').set(id, {
    state: 'UPLOADED',
    storagePath: `archive-intake/${id}/photo.jpg`,
    fileName: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    sha256: null,
    contentAssetId: null,
    claimedBy: null,
    error: null,
    ...overrides,
  });
}

test('listUploadedForWorker requires workerId', async () => {
  const { mod } = loadModuleWithFakes();
  await assert.rejects(mod.listUploadedForWorker({}), (err) => err.status === 400);
});

test('listUploadedForWorker only returns UPLOADED docs, each with a signed download URL', async () => {
  const { fake, bucket, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-1');
  seedIntake(fake, 'claimed-1', { state: 'CLAIMED', claimedBy: 'worker-a' });
  await bucket.file('archive-intake/up-1/photo.jpg').save(Buffer.from('x'));

  const items = await mod.listUploadedForWorker({ workerId: 'worker-a' });
  assert.equal(items.length, 1);
  assert.equal(items[0].intakeId, 'up-1');
  assert.match(items[0].downloadUrl, /^https:\/\/fake-storage\.local\//);
});

test('applyWorkerTransition rejects an illegal jump (UPLOADED -> ARCHIVED)', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-2');
  await assert.rejects(
    mod.applyWorkerTransition({ intakeId: 'up-2', workerId: 'worker-a', state: 'ARCHIVED' }),
    (err) => err.status === 409 && /Illegal transition/.test(err.message),
  );
});

test('applyWorkerTransition UPLOADED -> CLAIMED sets claimedBy', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-3');
  const result = await mod.applyWorkerTransition({ intakeId: 'up-3', workerId: 'worker-a', state: 'CLAIMED' });
  assert.equal(result.state, 'CLAIMED');
  assert.equal(fake.adminDb._raw('archive_intake', 'up-3').claimedBy, 'worker-a');
});

test('applyWorkerTransition refuses a step from a worker that does not own the claim', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-4', { state: 'CLAIMED', claimedBy: 'worker-a' });
  await assert.rejects(
    mod.applyWorkerTransition({ intakeId: 'up-4', workerId: 'worker-b', state: 'HASHED', sha256: 'a'.repeat(64) }),
    (err) => err.status === 409 && /claimed by a different worker/.test(err.message),
  );
});

test('applyWorkerTransition CLAIMED -> HASHED requires sha256', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-5', { state: 'CLAIMED', claimedBy: 'worker-a' });
  await assert.rejects(
    mod.applyWorkerTransition({ intakeId: 'up-5', workerId: 'worker-a', state: 'HASHED' }),
    (err) => err.status === 400 && /sha256 is required/.test(err.message),
  );
  const result = await mod.applyWorkerTransition({ intakeId: 'up-5', workerId: 'worker-a', state: 'HASHED', sha256: 'a'.repeat(64), contentAssetId: 'asset-1' });
  assert.equal(result.state, 'HASHED');
  assert.equal(fake.adminDb._raw('archive_intake', 'up-5').sha256, 'a'.repeat(64));
  assert.equal(fake.adminDb._raw('archive_intake', 'up-5').contentAssetId, 'asset-1');
});

test('applyWorkerTransition allows any -> FAILED from any worker, but requires an error message', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-6', { state: 'CLAIMED', claimedBy: 'worker-a' });
  await assert.rejects(
    mod.applyWorkerTransition({ intakeId: 'up-6', workerId: 'worker-b', state: 'FAILED' }),
    (err) => err.status === 400 && /error is required/.test(err.message),
  );
  const result = await mod.applyWorkerTransition({ intakeId: 'up-6', workerId: 'worker-b', state: 'FAILED', error: 'disk full' });
  assert.equal(result.state, 'FAILED');
  assert.equal(fake.adminDb._raw('archive_intake', 'up-6').error, 'disk full');
});

test('purgeArchivedIntake refuses to purge a non-ARCHIVED doc', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-7', { state: 'REVIEWED', claimedBy: 'worker-a' });
  await assert.rejects(
    mod.purgeArchivedIntake({ intakeId: 'up-7', workerId: 'worker-a' }),
    (err) => err.status === 409 && /only ARCHIVED may be purged/.test(err.message),
  );
});

test('purgeArchivedIntake refuses an ownership mismatch even from ARCHIVED', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-8', { state: 'ARCHIVED', claimedBy: 'worker-a' });
  await assert.rejects(
    mod.purgeArchivedIntake({ intakeId: 'up-8', workerId: 'worker-b' }),
    (err) => err.status === 409,
  );
});

test('purgeArchivedIntake deletes the Storage object and sets PURGED', async () => {
  const { fake, bucket, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-9', { state: 'ARCHIVED', claimedBy: 'worker-a', storagePath: 'archive-intake/up-9/photo.jpg' });
  await bucket.file('archive-intake/up-9/photo.jpg').save(Buffer.from('bytes'));
  assert.ok(bucket._raw('archive-intake/up-9/photo.jpg'));

  const result = await mod.purgeArchivedIntake({ intakeId: 'up-9', workerId: 'worker-a' });
  assert.equal(result.state, 'PURGED');
  assert.equal(fake.adminDb._raw('archive_intake', 'up-9').state, 'PURGED');
  assert.equal(bucket._raw('archive-intake/up-9/photo.jpg'), undefined);
});

test('purgeArchivedIntake tolerates an already-missing object (ignoreNotFound)', async () => {
  const { fake, mod } = loadModuleWithFakes();
  seedIntake(fake, 'up-10', { state: 'ARCHIVED', claimedBy: 'worker-a', storagePath: 'archive-intake/up-10/gone.jpg' });
  const result = await mod.purgeArchivedIntake({ intakeId: 'up-10', workerId: 'worker-a' });
  assert.equal(result.state, 'PURGED');
});
