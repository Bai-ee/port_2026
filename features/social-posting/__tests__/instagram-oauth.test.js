import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signInstagramState, verifyInstagramState, startInstagramOAuthFlow, completeInstagramOAuthFlow,
  needsRefresh, refreshDueInstagramTokens, REFRESH_WINDOW_MS, INSTAGRAM_OAUTH_SCOPES,
} from '../instagram-oauth.js';

const DAY = 24 * 60 * 60 * 1000;
const env = { INSTAGRAM_APP_ID: 'app123', INSTAGRAM_APP_SECRET: 'shh' };

function memoryDeps({ now = 1_000_000_000_000, responses = [], accounts = {} } = {}) {
  const pending = {};
  const calls = [];
  const queue = [...responses];
  return {
    env,
    now: () => now,
    calls,
    accounts,
    pending,
    savePending: async (clientId, doc) => { pending[clientId] = doc; },
    readPending: async (clientId) => pending[clientId] || null,
    deletePending: async (clientId) => { delete pending[clientId]; },
    saveAccount: async (clientId, patch) => { accounts[clientId] = { ...(accounts[clientId] || {}), ...patch }; },
    getAccount: async (clientId) => accounts[clientId] || null,
    listInstagramAccounts: async () => Object.entries(accounts).filter(([, a]) => a?.accessToken).map(([clientId, account]) => ({ clientId, account })),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return { ok: next.status ? next.status < 400 : true, status: next.status || 200, json: async () => next.body };
    },
  };
}

test('state round-trips the clientId and rejects tampering / expiry', () => {
  const now = 5_000;
  const s = signInstagramState('client-a', { appSecret: 'shh', now });
  assert.equal(verifyInstagramState(s, { appSecret: 'shh', now }), 'client-a');
  assert.equal(verifyInstagramState(s, { appSecret: 'other', now }), null);
  assert.equal(verifyInstagramState(s, { appSecret: 'shh', now: now + 16 * 60 * 1000 }), null);
  assert.equal(verifyInstagramState('garbage', { appSecret: 'shh', now }), null);
});

test('start builds the Instagram authorize URL and pins a pending doc', async () => {
  const d = memoryDeps();
  const { url } = await startInstagramOAuthFlow('https://hitloop.agency/cb', 'owner@x.com', 'client-a', d);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'app123');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://hitloop.agency/cb');
  assert.equal(u.searchParams.get('scope'), INSTAGRAM_OAUTH_SCOPES.join(','));
  assert.equal(d.pending['client-a'].state, u.searchParams.get('state'));
  assert.equal(d.pending['client-a'].startedBy, 'owner@x.com');
});

test('start fails closed without app credentials', async () => {
  const d = { ...memoryDeps(), env: {} };
  await assert.rejects(() => startInstagramOAuthFlow('https://x/cb', null, 'client-a', d), /INSTAGRAM_APP_ID/);
});

test('complete exchanges code → long-lived token → profile and saves per client', async () => {
  const d = memoryDeps({
    responses: [
      { body: { access_token: 'short', user_id: 17841, permissions: ['instagram_business_basic', 'instagram_business_content_publish'] } },
      { body: { access_token: 'long-token', token_type: 'bearer', expires_in: 5_184_000 } },
      { body: { user_id: '17841402101650073', username: 'bai__ee', account_type: 'BUSINESS', profile_picture_url: 'https://p/img.jpg' } },
    ],
  });
  const { url } = await startInstagramOAuthFlow('https://hitloop.agency/cb', 'owner@x.com', 'client-a', d);
  const state = new URL(url).searchParams.get('state');

  const out = await completeInstagramOAuthFlow({ code: 'abc#_', state }, d);
  assert.deepEqual(out, { clientId: 'client-a', username: 'bai__ee' });

  const body = new URLSearchParams(d.calls[0].init.body);
  assert.equal(body.get('code'), 'abc', 'strips the trailing #_');
  assert.equal(body.get('redirect_uri'), 'https://hitloop.agency/cb');
  assert.match(d.calls[1].url, /graph\.instagram\.com\/access_token\?grant_type=ig_exchange_token/);
  assert.match(d.calls[2].url, /graph\.instagram\.com\/v[\d.]+\/me\?/);
  assert.equal(d.calls[2].init.headers.Authorization, 'Bearer long-token');

  const acct = d.accounts['client-a'];
  assert.equal(acct.accessToken, 'long-token');
  assert.equal(acct.userId, '17841402101650073');
  assert.equal(acct.username, 'bai__ee');
  assert.equal(acct.authMode, 'instagram-login');
  assert.equal(acct.expiresAt, d.now() + 5_184_000 * 1000);
  assert.deepEqual(acct.scope, ['instagram_business_basic', 'instagram_business_content_publish']);
  assert.equal(d.pending['client-a'], undefined, 'pending doc is single-use');
});

test('complete refuses a state with no matching pending attempt', async () => {
  const d = memoryDeps();
  const state = signInstagramState('client-a', { appSecret: 'shh', now: d.now() });
  await assert.rejects(() => completeInstagramOAuthFlow({ code: 'abc', state }, d), /No matching in-progress/);
  assert.equal(d.calls.length, 0, 'no token exchange attempted');
});

test('complete surfaces an Instagram error and stores nothing', async () => {
  const d = memoryDeps({ responses: [{ status: 400, body: { error_type: 'OAuthException', error_message: 'Invalid code' } }] });
  const { url } = await startInstagramOAuthFlow('https://x/cb', null, 'client-a', d);
  await assert.rejects(
    () => completeInstagramOAuthFlow({ code: 'bad', state: new URL(url).searchParams.get('state') }, d),
    /Invalid code/,
  );
  assert.equal(d.accounts['client-a'], undefined);
});

test('needsRefresh: only inside the window, only when >=24h old, never once expired', () => {
  const now = 100 * DAY;
  assert.equal(needsRefresh({ accessToken: 't', expiresAt: now + REFRESH_WINDOW_MS + DAY, tokenIssuedAt: 0 }, now), false);
  assert.equal(needsRefresh({ accessToken: 't', expiresAt: now + 5 * DAY, tokenIssuedAt: now - 2 * DAY }, now), true);
  assert.equal(needsRefresh({ accessToken: 't', expiresAt: now + 5 * DAY, tokenIssuedAt: now - 1000 }, now), false);
  assert.equal(needsRefresh({ accessToken: 't', expiresAt: now - 1, tokenIssuedAt: 0 }, now), false);
  assert.equal(needsRefresh(null, now), false);
});

test('refreshDue renews due tokens, skips fresh ones, reports expired and failures', async () => {
  const now = 100 * DAY;
  const accounts = {
    due: { accessToken: 'old', expiresAt: now + 5 * DAY, tokenIssuedAt: now - 55 * DAY, username: 'due' },
    fresh: { accessToken: 'f', expiresAt: now + 50 * DAY, tokenIssuedAt: now - 10 * DAY },
    gone: { accessToken: 'g', expiresAt: now - DAY, tokenIssuedAt: now - 70 * DAY },
    broken: { accessToken: 'b', expiresAt: now + 2 * DAY, tokenIssuedAt: now - 58 * DAY },
  };
  const d = memoryDeps({
    now,
    accounts,
    responses: [
      { body: { access_token: 'renewed', expires_in: 5_184_000 } },
      { status: 400, body: { error: { message: 'Session has expired' } } },
    ],
  });
  const r = await refreshDueInstagramTokens(d);
  assert.equal(r.checked, 4);
  assert.deepEqual(r.refreshed, ['due']);
  assert.deepEqual(r.expired, ['gone']);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].clientId, 'broken');
  assert.equal(accounts.due.accessToken, 'renewed');
  assert.equal(accounts.due.username, 'due', 'keeps profile fields');
  assert.equal(accounts.due.refreshError, null);
  assert.match(accounts.broken.refreshError, /Session has expired/);
  assert.equal(accounts.fresh.accessToken, 'f');
  assert.match(d.calls[0].url, /graph\.instagram\.com\/refresh_access_token\?grant_type=ig_refresh_token/);
});
