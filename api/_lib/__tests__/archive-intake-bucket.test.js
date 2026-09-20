'use strict';

// Mocks firebase-admin.cjs (fake Firestore + fake Storage bucket with a
// getMetadata()/setMetadata() CORS surface) via require.cache injection —
// same technique as deleted-accounts.test.js. Exercises the real
// ensureIntakeCors()/intakeBucket() logic (no mocking of this module
// itself, unlike archive-intake.test.js / archive-worker-intake.test.js,
// which mock this whole module out).

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const archiveIntakeBucketPath = path.resolve(__dirname, '../archive-intake-bucket.cjs');

function loadModuleWithFakes() {
  delete require.cache[archiveIntakeBucketPath];
  const fake = makeFakeContext();
  const bucket = fake.adminStorage.bucket();
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  const mod = require(archiveIntakeBucketPath);
  return { fake, bucket, mod };
}

test('intakeBucket() returns HITLOOP\'s own default bucket (fb.adminStorage.bucket()), not a second app', () => {
  const { fake, bucket, mod } = loadModuleWithFakes();
  assert.equal(mod.intakeBucket(), bucket);
  assert.equal(mod.intakeBucket(), fake.adminStorage.bucket());
});

test('intakeOrigins() always includes the three known HITLOOP hosts', () => {
  const { mod } = loadModuleWithFakes();
  const origins = mod.intakeOrigins();
  assert.ok(origins.includes('http://localhost:3000'));
  assert.ok(origins.includes('https://hitloop.agency'));
  assert.ok(origins.includes('https://www.hitloop.agency'));
});

test('ensureIntakeCors() merges a new rule into an EMPTY cors list', async () => {
  const { bucket, mod } = loadModuleWithFakes();
  await mod.ensureIntakeCors();
  assert.equal(bucket._cors.length, 1);
  const rule = bucket._cors[0];
  assert.ok(rule.origin.includes('http://localhost:3000'));
  assert.ok(['OPTIONS', 'PUT', 'GET', 'HEAD'].every((m) => rule.method.includes(m)));
  assert.ok(['Content-Type', 'Content-Length', 'x-goog-resumable'].every((h) => rule.responseHeader.includes(h)));
});

test('ensureIntakeCors() MERGES without dropping an unrelated existing CORS entry', async () => {
  const { bucket, mod } = loadModuleWithFakes();
  const unrelatedRule = {
    origin: ['https://some-other-app.example'],
    method: ['GET'],
    responseHeader: ['Content-Type'],
    maxAgeSeconds: 600,
  };
  bucket._setCors([unrelatedRule]);

  await mod.ensureIntakeCors();

  assert.equal(bucket._cors.length, 2, 'the unrelated rule must still be present alongside the new intake rule');
  assert.deepEqual(bucket._cors[0], unrelatedRule, 'the unrelated rule must be untouched, not rewritten');
  const intakeRule = bucket._cors[1];
  assert.ok(intakeRule.origin.includes('http://localhost:3000'));
  assert.ok(['OPTIONS', 'PUT', 'GET', 'HEAD'].every((m) => intakeRule.method.includes(m)));
});

test('ensureIntakeCors() skips the write when an existing rule already covers every required origin/method/header', async () => {
  const { bucket, mod } = loadModuleWithFakes();
  bucket._setCors([{
    origin: ['http://localhost:3000', 'https://hitloop.agency', 'https://www.hitloop.agency'],
    method: ['OPTIONS', 'PUT', 'GET', 'HEAD'],
    responseHeader: ['Content-Type', 'Content-Length', 'x-goog-resumable'],
    maxAgeSeconds: 3600,
  }]);

  await mod.ensureIntakeCors();

  assert.equal(bucket._setMetadataCalls, 0, 'an already-covering rule must never trigger a write');
  assert.equal(bucket._cors.length, 1);
});

test('a rule missing one required header (e.g. no x-goog-resumable) is NOT treated as covering — a new rule is still appended', async () => {
  const { bucket, mod } = loadModuleWithFakes();
  bucket._setCors([{
    origin: ['http://localhost:3000', 'https://hitloop.agency', 'https://www.hitloop.agency'],
    method: ['OPTIONS', 'PUT', 'GET', 'HEAD'],
    responseHeader: ['Content-Type', 'Content-Length'],
    maxAgeSeconds: 3600,
  }]);

  await mod.ensureIntakeCors();

  assert.equal(bucket._setMetadataCalls, 1);
  assert.equal(bucket._cors.length, 2);
});

test('ensureIntakeCors() memoizes success per process — a second call never re-reads or re-writes bucket metadata', async () => {
  const { bucket, mod } = loadModuleWithFakes();
  await mod.ensureIntakeCors();
  assert.equal(bucket._getMetadataCalls, 1);
  assert.equal(bucket._setMetadataCalls, 1);

  // Simulate the bucket's CORS having drifted since — memoization means we
  // never notice, because we never look again within this process.
  bucket._setCors([]);
  await mod.ensureIntakeCors();

  assert.equal(bucket._getMetadataCalls, 1, 'must not re-read metadata once memoized');
  assert.equal(bucket._setMetadataCalls, 1, 'must not re-write metadata once memoized');
});

test('__resetForTests() clears the memoization so a fresh check runs again', async () => {
  const { bucket, mod } = loadModuleWithFakes();
  await mod.ensureIntakeCors();
  assert.equal(bucket._getMetadataCalls, 1);

  mod.__resetForTests();
  await mod.ensureIntakeCors();

  assert.equal(bucket._getMetadataCalls, 2);
});
