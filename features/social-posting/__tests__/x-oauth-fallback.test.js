// x-oauth-fallback.test.js — the global @bai_ee token fallback in getXOAuth2Client
// is a HOME-ONLY exception (multi-client 4.2). In-memory Firestore, an injected
// home resolver, and a stubbed refreshOAuth2Token: no network, no X calls, no
// real Firestore.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import { TwitterApi } from 'twitter-api-v2';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { getXOAuth2Client, __setXOAuthDepsForTest } = await import('../x-oauth.js');

const HOME = 'home-client-test';
const OTHER = 'other-client-test';
const FAR_FUTURE = () => Date.now() + 3_600_000;

let db;
let originalDbDescriptor;
let restoreDeps;
let originalRefresh;
let refreshCalls;
const envBackup = {};

beforeEach(() => {
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  db = makeFakeContext().adminDb;
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => db });
  restoreDeps = __setXOAuthDepsForTest({ resolveHomeClientId: async () => HOME });
  refreshCalls = [];
  originalRefresh = TwitterApi.prototype.refreshOAuth2Token;
  TwitterApi.prototype.refreshOAuth2Token = async (token) => {
    refreshCalls.push(token);
    return { accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh', expiresIn: 7200 };
  };
  for (const k of ['X_OAUTH_CLIENT_ID', 'X_OAUTH_CLIENT_SECRET']) envBackup[k] = process.env[k];
  process.env.X_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.X_OAUTH_CLIENT_SECRET = 'test-client-secret';
});

afterEach(() => {
  restoreDeps();
  TwitterApi.prototype.refreshOAuth2Token = originalRefresh;
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function seedGlobal(patch = {}) {
  db._patch('system_flags', 'x_oauth_tokens', {
    accessToken: 'global-access', refreshToken: 'global-refresh', expiresAt: FAR_FUTURE(), userId: '111', username: 'bai_ee', ...patch,
  });
}

test('legacy (no clientId) still serves the global token', async () => {
  seedGlobal();
  const out = await getXOAuth2Client();
  assert.equal(out.tokens.accessToken, 'global-access');
  assert.equal(out.tokenSource, 'global');
});

test('a non-home client with no X doc gets 409 account-not-connected, never the global token', async () => {
  seedGlobal();
  await assert.rejects(getXOAuth2Client(OTHER), (err) => {
    assert.equal(err.status, 409);
    assert.equal(err.code, 'account-not-connected');
    assert.match(err.message, /no connected X account/);
    return true;
  });
  assert.equal(db._raw('social_accounts', OTHER), undefined, 'nothing written into the client doc');
});

test('an unresolvable home fails closed (no global fallback)', async () => {
  seedGlobal();
  restoreDeps();
  restoreDeps = __setXOAuthDepsForTest({ resolveHomeClientId: async () => { throw new Error('firestore down'); } });
  await assert.rejects(getXOAuth2Client(HOME), (err) => err.code === 'account-not-connected');
});

test('the home client with no per-client doc falls back to the global token', async () => {
  seedGlobal();
  const out = await getXOAuth2Client(HOME);
  assert.equal(out.tokens.accessToken, 'global-access');
  assert.equal(out.tokenSource, 'global');
  assert.equal(out.sourceClientId, null);
});

test('refreshing a globally-served token writes back to the GLOBAL doc, not social_accounts', async () => {
  seedGlobal({ expiresAt: Date.now() - 1000 });
  const out = await getXOAuth2Client(HOME);
  assert.deepEqual(refreshCalls, ['global-refresh']);
  assert.equal(out.tokens.accessToken, 'refreshed-access');
  assert.equal(db._raw('system_flags', 'x_oauth_tokens').accessToken, 'refreshed-access');
  assert.equal(db._raw('system_flags', 'x_oauth_tokens').refreshToken, 'refreshed-refresh');
  assert.equal(db._raw('social_accounts', HOME), undefined, 'the global token is never cloned into the home client doc');
});

test('a client with its own doc uses it and refreshes into its own social_accounts doc', async () => {
  seedGlobal();
  db._patch('social_accounts', OTHER, {
    clientId: OTHER,
    platforms: { x: { accessToken: 'own-access', refreshToken: 'own-refresh', expiresAt: Date.now() - 1000, userId: '222', username: 'ue', updatedAt: 1 } },
  });
  const out = await getXOAuth2Client(OTHER);
  assert.equal(out.tokenSource, 'client');
  assert.deepEqual(refreshCalls, ['own-refresh']);
  assert.equal(db._raw('social_accounts', OTHER).platforms.x.accessToken, 'refreshed-access');
  assert.equal(db._raw('system_flags', 'x_oauth_tokens').accessToken, 'global-access', 'global untouched');
});

test('a client doc without an access token is not-connected (no global fallback even for home)', async () => {
  seedGlobal();
  db._patch('social_accounts', HOME, { clientId: HOME, platforms: { x: { username: 'x', updatedAt: 1 } } });
  await assert.rejects(getXOAuth2Client(HOME), (err) => err.code === 'account-not-connected');
});
