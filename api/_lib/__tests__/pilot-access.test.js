const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePilotOwner, OWNER_CLIENT_ID } = require('../pilot-access.cjs');

const PROD = { VERCEL_ENV: 'production', PILOT_OWNER_UIDS: 'owner-uid', PILOT_CLIENT_IDS: 'owner-client' };
const ctx = (clientId) => ({ clientId });
const fails = (fn, status, code) => assert.throws(fn, (e) => e.status === status && (code === undefined || e.code === code));

test('no uid => 401', () => {
  fails(() => requirePilotOwner(ctx('owner-client'), {}, PROD), 401);
  fails(() => requirePilotOwner(ctx('owner-client'), null, PROD), 401);
});

test('no clientId => 404', () => {
  fails(() => requirePilotOwner({}, { uid: 'owner-uid' }, PROD), 404);
  fails(() => requirePilotOwner(null, { uid: 'owner-uid' }, PROD), 404);
});

test('production fails closed (503) when either list is missing or blank', () => {
  for (const env of [
    { VERCEL_ENV: 'production' },
    { VERCEL_ENV: 'production', PILOT_OWNER_UIDS: 'owner-uid' },
    { VERCEL_ENV: 'production', PILOT_CLIENT_IDS: 'owner-client' },
    { VERCEL_ENV: 'production', PILOT_OWNER_UIDS: ' , ', PILOT_CLIENT_IDS: 'owner-client' },
    { NODE_ENV: 'production' },
  ]) fails(() => requirePilotOwner(ctx('owner-client'), { uid: 'owner-uid' }, env), 503, 'pilot-not-configured');
});

test('non-owner uid => 403 pilot-not-owner', () => {
  fails(() => requirePilotOwner(ctx('owner-client'), { uid: 'someone' }, PROD), 403, 'pilot-not-owner');
});

test('wrong client => 403 pilot-wrong-client', () => {
  fails(() => requirePilotOwner(ctx('other-client'), { uid: 'owner-uid' }, PROD), 403, 'pilot-wrong-client');
});

test('owner uid + owner client returns {uid, clientId}', () => {
  assert.deepEqual(requirePilotOwner(ctx('owner-client'), { uid: 'owner-uid' }, PROD), { uid: 'owner-uid', clientId: 'owner-client' });
});

test('comma lists tolerate spaces and empty entries', () => {
  const env = { VERCEL_ENV: 'production', PILOT_OWNER_UIDS: ' a , owner-uid ,, b', PILOT_CLIENT_IDS: 'x ,  owner-client' };
  assert.equal(requirePilotOwner(ctx('owner-client'), { uid: 'owner-uid' }, env).clientId, 'owner-client');
  assert.equal(requirePilotOwner(ctx('x'), { uid: 'b' }, env).uid, 'b');
  fails(() => requirePilotOwner(ctx('y'), { uid: 'a' }, env), 403, 'pilot-wrong-client');
});

test('dev defaults: only the owner client, any uid', () => {
  assert.deepEqual(requirePilotOwner(ctx(OWNER_CLIENT_ID), { uid: 'anyone' }, {}), { uid: 'anyone', clientId: 'bryan-balli-WUoltG84' });
  assert.equal(OWNER_CLIENT_ID, 'bryan-balli-WUoltG84');
  fails(() => requirePilotOwner(ctx('other-client'), { uid: 'anyone' }, {}), 403, 'pilot-wrong-client');
  fails(() => requirePilotOwner(ctx('other-client'), { uid: 'anyone' }, { NODE_ENV: 'development' }), 403, 'pilot-wrong-client');
});

test('dev with only a uid list still restricts uid and defaults the client', () => {
  const env = { PILOT_OWNER_UIDS: 'owner-uid' };
  fails(() => requirePilotOwner(ctx(OWNER_CLIENT_ID), { uid: 'x' }, env), 403, 'pilot-not-owner');
  assert.equal(requirePilotOwner(ctx(OWNER_CLIENT_ID), { uid: 'owner-uid' }, env).uid, 'owner-uid');
});

test('client id is read only from context.clientId; requestedClientId / body-like fields are ignored', () => {
  const spoof = { clientId: 'other-client', requestedClientId: 'owner-client', body: { clientId: 'owner-client' }, ownClientId: 'owner-client' };
  fails(() => requirePilotOwner(spoof, { uid: 'owner-uid' }, PROD), 403, 'pilot-wrong-client');
  fails(() => requirePilotOwner(spoof, { uid: 'owner-uid', clientId: 'owner-client' }, PROD), 403, 'pilot-wrong-client');
});

const { requirePilotOwnerUid } = require('../pilot-access.cjs');

test('Vercel PREVIEW deployments fail closed like production (previews share production data)', () => {
  const preview = { VERCEL_ENV: 'preview', NODE_ENV: 'production' };
  fails(() => requirePilotOwner(ctx('bryan-balli-WUoltG84'), { uid: 'anyone' }, preview), 503, 'pilot-not-configured');
  fails(() => requirePilotOwnerUid({ uid: 'anyone' }, preview), 503, 'pilot-not-configured');
});

test('self-hosted production (NODE_ENV=production, no VERCEL_ENV) fails closed; explicit development stays permissive', () => {
  fails(() => requirePilotOwner(ctx('bryan-balli-WUoltG84'), { uid: 'u' }, { NODE_ENV: 'production' }), 503);
  assert.deepEqual(requirePilotOwner(ctx('bryan-balli-WUoltG84'), { uid: 'u' }, { VERCEL_ENV: 'development', NODE_ENV: 'development' }), { uid: 'u', clientId: 'bryan-balli-WUoltG84' });
});

test('requirePilotOwnerUid: 401 without uid, 403 for a non-owner, ok for the owner, 503 unconfigured in production', () => {
  fails(() => requirePilotOwnerUid({}, PROD), 401);
  fails(() => requirePilotOwnerUid({ uid: 'other' }, PROD), 403, 'pilot-not-owner');
  assert.deepEqual(requirePilotOwnerUid({ uid: 'owner-uid' }, PROD), { uid: 'owner-uid' });
  fails(() => requirePilotOwnerUid({ uid: 'owner-uid' }, { VERCEL_ENV: 'production' }), 503);
});
