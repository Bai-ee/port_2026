'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidWorkerTransition,
  isValidPurgeTransition,
  isValidBrowserUploadConfirm,
  isAllowedIntakeContentType,
  maxBytesForContentType,
  sanitizeIntakeFileName,
} = require('../archive-intake-transitions.cjs');

test('worker transition table allows the documented chain', () => {
  assert.equal(isValidWorkerTransition('UPLOADED', 'CLAIMED'), true);
  assert.equal(isValidWorkerTransition('CLAIMED', 'HASHED'), true);
  assert.equal(isValidWorkerTransition('HASHED', 'REVIEWED'), true);
  assert.equal(isValidWorkerTransition('REVIEWED', 'ARCHIVED'), true);
});

test('worker transition table rejects an illegal jump', () => {
  assert.equal(isValidWorkerTransition('UPLOADED', 'ARCHIVED'), false);
  assert.equal(isValidWorkerTransition('UPLOADED', 'REVIEWED'), false);
  assert.equal(isValidWorkerTransition('CLAIMED', 'ARCHIVED'), false);
  assert.equal(isValidWorkerTransition('PENDING_UPLOAD', 'CLAIMED'), false);
});

test('ARCHIVED -> PURGED is not a valid PATCH transition (DELETE-only)', () => {
  assert.equal(isValidWorkerTransition('ARCHIVED', 'PURGED'), false);
  assert.equal(isValidPurgeTransition('ARCHIVED'), true);
  assert.equal(isValidPurgeTransition('REVIEWED'), false);
  assert.equal(isValidPurgeTransition('PURGED'), false);
});

test('any known state may PATCH to FAILED', () => {
  for (const from of ['UPLOADED', 'CLAIMED', 'HASHED', 'REVIEWED', 'ARCHIVED', 'PENDING_UPLOAD']) {
    assert.equal(isValidWorkerTransition(from, 'FAILED'), true, `${from} -> FAILED`);
  }
});

test('an unknown target state is always rejected, even from FAILED-adjacent states', () => {
  assert.equal(isValidWorkerTransition('UPLOADED', 'NOT_A_REAL_STATE'), false);
});

test('browser upload-confirm PATCH only ever moves PENDING_UPLOAD -> UPLOADED (idempotent)', () => {
  assert.equal(isValidBrowserUploadConfirm('PENDING_UPLOAD'), true);
  assert.equal(isValidBrowserUploadConfirm('UPLOADED'), true); // idempotent replay
  assert.equal(isValidBrowserUploadConfirm('CLAIMED'), false);
  assert.equal(isValidBrowserUploadConfirm('ARCHIVED'), false);
});

test('content type gate accepts only image/* and video/*', () => {
  assert.equal(isAllowedIntakeContentType('image/jpeg'), true);
  assert.equal(isAllowedIntakeContentType('video/mp4'), true);
  assert.equal(isAllowedIntakeContentType('application/pdf'), false);
  assert.equal(isAllowedIntakeContentType(''), false);
});

test('size cap differs for image vs video', () => {
  assert.equal(maxBytesForContentType('video/mp4'), 500 * 1024 * 1024);
  assert.equal(maxBytesForContentType('image/png'), 50 * 1024 * 1024);
});

test('filename sanitizer keeps the extension and dash-normalizes the base', () => {
  assert.equal(sanitizeIntakeFileName('My Photo (1).JPG'), 'my-photo-1.jpg');
  assert.equal(sanitizeIntakeFileName('IMG_0001.heic'), 'img_0001.heic');
  assert.throws(() => sanitizeIntakeFileName(''));
});
