'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isValidResumableSessionUri, mapResumableStatus } = require('../editvideos-bridge.cjs');

const GOOD = 'https://storage.googleapis.com/upload/storage/v1/b/bkt/o?uploadType=resumable&name=a%2Fb.mp4&upload_id=ABC123';

test('session URI guard accepts GCS resumable URIs', () => {
  assert.equal(isValidResumableSessionUri(GOOD), true);
  assert.equal(isValidResumableSessionUri('https://www.googleapis.com/upload/storage/v1/b/x/o?upload_id=1'), true);
  assert.equal(isValidResumableSessionUri('https://bkt.storage.googleapis.com/o?upload_id=1'), true);
});

test('session URI guard rejects SSRF shapes', () => {
  for (const bad of [
    '', null, undefined, 'not a url',
    GOOD.replace('https:', 'http:'),
    'https://evil.com/upload?upload_id=1',
    'https://storage.googleapis.com.evil.com/o?upload_id=1',
    'https://evilstorage.googleapis.com.evil.com/o?upload_id=1',
    'https://storage.googleapis.com/o?uploadType=resumable',
    'https://user:pw@storage.googleapis.com/o?upload_id=1',
    'https://storage.googleapis.com:8443/o?upload_id=1',
    'https://169.254.169.254/o?upload_id=1',
  ]) assert.equal(isValidResumableSessionUri(bad), false, String(bad));
});

test('status mapping', () => {
  assert.deepEqual(mapResumableStatus(308, 'bytes=0-999', 5000), { ok: true, offset: 1000, complete: false });
  assert.deepEqual(mapResumableStatus(308, null, 5000), { ok: true, offset: 0, complete: false });
  assert.deepEqual(mapResumableStatus(200, null, 5000), { ok: true, offset: 5000, complete: true });
  assert.deepEqual(mapResumableStatus(201, null, 5000), { ok: true, offset: 5000, complete: true });
  assert.deepEqual(mapResumableStatus(404, null, 5000), { ok: true, expired: true });
  assert.deepEqual(mapResumableStatus(410, null, 5000), { ok: true, expired: true });
  assert.equal(mapResumableStatus(500, null, 5000), null);
});
