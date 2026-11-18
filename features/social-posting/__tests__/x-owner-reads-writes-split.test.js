// x-owner-reads-writes-split.test.js — owner-credential READS vs connected-account WRITES.
// Reads (X Monitor) run on the owner/app OAuth1 keys; writes (adapters/x.js) still need the client's own
// connected account and fail closed (409) without one. In-memory Firestore, no network, no X calls.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const xAdapter = await import('../adapters/x.js');
const { getPlatformClient } = await import('../social-accounts.js');
const { getOwnerReadIdentity } = await import('../twitter-service.js');

const OTHER = 'other-client-test';
let db;
let original;

beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  db = makeFakeContext().adminDb;
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => db });
});
afterEach(() => Object.defineProperty(fb, 'adminDb', original));

test('the X posting adapter still refuses (account-not-connected) when the client has no connected X account (writes never fall back to owner keys)', async () => {
  await assert.rejects(
    xAdapter.publish({ clientId: OTHER, text: 'hello' }),
    (err) => err.code === 'account-not-connected', // the adapter maps the status; the code is the contract
  );
});

test('getPlatformClient (the write client resolver) is a 409 for a client with no connection', async () => {
  await assert.rejects(getPlatformClient(OTHER, 'x'), (err) => err.status === 409 && err.code === 'account-not-connected');
});

test('getOwnerReadIdentity parses the user id from the OAuth1 access token prefix, no call, null when unparseable', () => {
  const names = ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET'];
  const backup = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    process.env.TWITTER_API_KEY = 'k'; process.env.TWITTER_API_SECRET = 's'; process.env.TWITTER_ACCESS_SECRET = 'as';
    process.env.TWITTER_ACCESS_TOKEN = '18508964-AbCdEf';
    assert.deepEqual(getOwnerReadIdentity(), { userId: '18508964' });
    process.env.TWITTER_ACCESS_TOKEN = 'no-digits-prefix';
    assert.equal(getOwnerReadIdentity(), null);
  } finally {
    for (const [n, v] of Object.entries(backup)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
  }
});
