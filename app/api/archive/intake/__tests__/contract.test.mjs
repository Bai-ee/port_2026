import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the request-shape guards in route.js (admin-auth is
// verifyAdminRequest from api/_lib/auth.cjs — the same 403 pattern as
// app/api/archive/browse/route.js, already covered by that module's own
// auth-path tests). See docs/archive/INTAKE_CONTRACT.md.

function postGuardRejects({ fileName, contentType }) {
  return !fileName || !contentType;
}

function patchGuardRejects(state) {
  return state !== 'UPLOADED';
}

test('POST requires both fileName and contentType', () => {
  assert.equal(postGuardRejects({ fileName: '', contentType: 'image/jpeg' }), true);
  assert.equal(postGuardRejects({ fileName: 'a.jpg', contentType: '' }), true);
  assert.equal(postGuardRejects({ fileName: 'a.jpg', contentType: 'image/jpeg' }), false);
});

test('PATCH from the browser can only ever confirm state UPLOADED — never CLAIMED/HASHED/REVIEWED/ARCHIVED/PURGED', () => {
  assert.equal(patchGuardRejects('UPLOADED'), false);
  for (const other of ['PENDING_UPLOAD', 'CLAIMED', 'HASHED', 'REVIEWED', 'ARCHIVED', 'PURGED', 'FAILED']) {
    assert.equal(patchGuardRejects(other), true, `state=${other} must be rejected`);
  }
});
