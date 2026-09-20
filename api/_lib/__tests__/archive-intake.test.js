'use strict';

// Mocks firebase-admin.cjs (fake Firestore) and archive-intake-bucket.cjs
// (fake Storage bucket, HITLOOP's own default bucket — not the
// EditVideos-bridge bucket) via require.cache injection — same technique as
// deleted-accounts.test.js. archive-intake.cjs is the browser-side Lane 2
// intake logic (app/api/archive/intake/route.js is a thin wrapper around it
// that isn't imported directly here because next/server can't be resolved
// outside the Next.js runtime — see every other route test in this repo).

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const archiveIntakeBucketPath = path.resolve(__dirname, '../archive-intake-bucket.cjs');
const archiveIntakePath = path.resolve(__dirname, '../archive-intake.cjs');

function loadModuleWithFakes() {
  delete require.cache[archiveIntakePath];
  const fake = makeFakeContext();
  const bucket = fake.adminStorage.bucket();

  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  require.cache[archiveIntakeBucketPath] = {
    id: archiveIntakeBucketPath,
    filename: archiveIntakeBucketPath,
    loaded: true,
    exports: {
      intakeBucket: () => bucket,
      ensureIntakeCors: async () => {},
    },
  };

  const mod = require(archiveIntakePath);
  return { fake, bucket, mod };
}

test('createIntake rejects a non image/video content type', async () => {
  const { mod } = loadModuleWithFakes();
  await assert.rejects(
    mod.createIntake({ fileName: 'doc.pdf', contentType: 'application/pdf', sizeBytes: 100 }),
    /image\/\* or video\/\*/,
  );
});

test('createIntake rejects a size over the per-type cap', async () => {
  const { mod } = loadModuleWithFakes();
  await assert.rejects(
    mod.createIntake({ fileName: 'huge.jpg', contentType: 'image/jpeg', sizeBytes: 60 * 1024 * 1024 }),
    /intake limit/,
  );
});

test('createIntake writes a PENDING_UPLOAD doc and returns a signed PUT URL under archive-intake/', async () => {
  const { fake, mod } = loadModuleWithFakes();
  const result = await mod.createIntake({ fileName: 'IMG_0001.jpg', contentType: 'image/jpeg', sizeBytes: 1024, createdBy: { uid: 'u1', email: 'bryanballi@gmail.com' } });

  assert.match(result.storagePath, /^archive-intake\/[^/]+\/img_0001\.jpg$/);
  assert.equal(result.storagePath.split('/')[1], result.intakeId);
  assert.equal(result.method, 'PUT');
  assert.match(result.uploadUrl, /^https:\/\/fake-storage\.local\//);

  const stored = fake.adminDb._raw('archive_intake', result.intakeId);
  assert.equal(stored.state, 'PENDING_UPLOAD');
  assert.equal(stored.sha256, null);
  assert.equal(stored.contentAssetId, null);
  assert.equal(stored.createdBy.email, 'bryanballi@gmail.com');
});

test('markUploaded refuses to confirm before the object exists in Storage', async () => {
  const { mod } = loadModuleWithFakes();
  const created = await mod.createIntake({ fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 });
  await assert.rejects(
    mod.markUploaded({ intakeId: created.intakeId, sizeBytes: 10 }),
    (err) => err.status === 409 && /not found in storage/.test(err.message),
  );
});

test('markUploaded confirms once the object exists, and is idempotent on replay', async () => {
  const { fake, bucket, mod } = loadModuleWithFakes();
  const created = await mod.createIntake({ fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 });

  // Simulate the browser's real PUT having landed the bytes.
  await bucket.file(created.storagePath).save(Buffer.from('bytes'), { contentType: 'image/jpeg' });

  const first = await mod.markUploaded({ intakeId: created.intakeId, sizeBytes: 10 });
  assert.equal(first.state, 'UPLOADED');
  assert.equal(fake.adminDb._raw('archive_intake', created.intakeId).state, 'UPLOADED');

  // Replay (e.g. a flaky network retry from the phone) must not throw.
  const second = await mod.markUploaded({ intakeId: created.intakeId, sizeBytes: 10 });
  assert.equal(second.state, 'UPLOADED');
});

test('markUploaded rejects an intake already claimed by the worker (CLAIMED is not a valid confirm source)', async () => {
  const { fake, bucket, mod } = loadModuleWithFakes();
  const created = await mod.createIntake({ fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 });
  await bucket.file(created.storagePath).save(Buffer.from('bytes'));
  fake.adminDb._patch('archive_intake', created.intakeId, { state: 'CLAIMED' });

  await assert.rejects(
    mod.markUploaded({ intakeId: created.intakeId, sizeBytes: 10 }),
    (err) => err.status === 409,
  );
});

test('listRecentIntake returns newest first and respects the limit clamp', async () => {
  const { mod } = loadModuleWithFakes();
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await mod.createIntake({ fileName: `f${i}.jpg`, contentType: 'image/jpeg', sizeBytes: 10 });
  }
  const items = await mod.listRecentIntake({ limit: 2 });
  assert.equal(items.length, 2);
  assert.equal(items[0].fileName, 'f2.jpg');
  assert.equal(items[1].fileName, 'f1.jpg');
});
