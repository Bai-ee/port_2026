import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors route.js's authorized() — the same Bearer-token check as
// app/api/archive/worker/heartbeat/route.js (compares the raw Authorization
// header against `Bearer ${HITLOOP_ARCHIVE_WORKER_TOKEN}`; unconfigured or
// mismatched token is always Unauthorized). See docs/archive/INTAKE_CONTRACT.md.

function authorized(authorizationHeader, configuredToken) {
  if (!configuredToken) return false;
  return (authorizationHeader || '') === `Bearer ${configuredToken}`;
}

test('rejects when HITLOOP_ARCHIVE_WORKER_TOKEN is not configured, even with a header', () => {
  assert.equal(authorized('Bearer anything', ''), false);
  assert.equal(authorized('Bearer anything', undefined), false);
});

test('rejects a missing Authorization header', () => {
  assert.equal(authorized(null, 'secret-token'), false);
  assert.equal(authorized('', 'secret-token'), false);
});

test('rejects a mismatched token and a missing "Bearer " prefix', () => {
  assert.equal(authorized('Bearer wrong-token', 'secret-token'), false);
  assert.equal(authorized('secret-token', 'secret-token'), false); // no "Bearer " prefix
});

test('accepts an exact "Bearer <token>" match', () => {
  assert.equal(authorized('Bearer secret-token', 'secret-token'), true);
});
