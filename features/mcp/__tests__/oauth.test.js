import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  verifyPkceS256, signAccessToken, verifyAccessToken, validateRedirectUri, registerClient, checkAuthRequest, issueAuthCode,
  exchangeCode, refreshGrant, handleTokenRequest, createMemoryOAuthStore, OAuthError, ACCESS_TTL_SEC, CODE_TTL_SEC, REFRESH_TTL_SEC, sha256b64url,
  parseExtraHosts, secretVersionOf, isVerifiedIdentity, sha256hex,
} from '../oauth.js';

const SECRET = 'test-secret-value-0123456789';
const AUD = 'https://hitloop.agency/api/mcp';
const NOW = Date.parse('2026-10-12T12:00:00Z');
const VERIFIER = 'a'.repeat(43) + 'B-._~9';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function setup() {
  const store = createMemoryOAuthStore();
  const reg = await registerClient(store, { redirect_uris: [REDIRECT], client_name: 'Claude' }, { now: NOW });
  const params = { client_id: reg.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'xyz' };
  return { store, reg, params };
}
const codeFrom = (url) => new URL(url).searchParams.get('code');
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof OAuthError && (!code || e.code === code));

test('PKCE S256: matches, rejects wrong verifier, short verifier, bad challenge', () => {
  assert.equal(verifyPkceS256(VERIFIER, CHALLENGE), true);
  assert.equal(verifyPkceS256(`${VERIFIER}x`, CHALLENGE), false);
  assert.equal(verifyPkceS256('short', sha256b64url('short')), false);
  assert.equal(verifyPkceS256(VERIFIER, 'nope'), false);
  assert.equal(verifyPkceS256(undefined, CHALLENGE), false);
});

test('access token: sign/verify roundtrip with claims', () => {
  const t = signAccessToken({ secret: SECRET, email: 'Bryan@X.test', aud: AUD, now: NOW, clientId: 'c1' });
  const v = verifyAccessToken(t, { secret: SECRET, aud: AUD, now: NOW + 1000 });
  assert.equal(v.ok, true);
  assert.equal(v.claims.sub, 'bryan@x.test');
  assert.equal(v.claims.aud, AUD);
  assert.equal(v.claims.scope, 'hitloop');
  assert.equal(v.claims.exp - v.claims.iat, ACCESS_TTL_SEC);
  assert.ok(v.claims.jti);
});

test('access token: expiry, tamper, wrong secret, wrong audience, malformed, unsigned', () => {
  const t = signAccessToken({ secret: SECRET, email: 'a@b.test', aud: AUD, now: NOW });
  assert.equal(verifyAccessToken(t, { secret: SECRET, aud: AUD, now: NOW + ACCESS_TTL_SEC * 1000 }).error, 'expired');
  assert.equal(verifyAccessToken(t, { secret: SECRET, aud: AUD, now: NOW + ACCESS_TTL_SEC * 1000 - 1000 }).ok, true);
  const [h, b, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), sub: 'evil@x.test' })).toString('base64url');
  assert.equal(verifyAccessToken(`${h}.${forged}.${s}`, { secret: SECRET, aud: AUD, now: NOW }).error, 'bad-signature');
  assert.equal(verifyAccessToken(t, { secret: 'other-secret', aud: AUD, now: NOW }).error, 'bad-signature');
  assert.equal(verifyAccessToken(t, { secret: SECRET, aud: 'https://evil/api/mcp', now: NOW }).error, 'wrong-audience');
  assert.equal(verifyAccessToken('garbage', { secret: SECRET, aud: AUD, now: NOW }).error, 'malformed');
  assert.equal(verifyAccessToken(`${h}.${b}.`, { secret: SECRET, aud: AUD, now: NOW }).ok, false);
  // alg:none style token
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${b}.`;
  assert.equal(verifyAccessToken(none, { secret: SECRET, aud: AUD, now: NOW }).ok, false);
  // fail closed without a secret
  assert.equal(verifyAccessToken(t, { secret: '', aud: AUD, now: NOW }).ok, false);
  assert.throws(() => signAccessToken({ secret: '', email: 'a@b', aud: AUD, now: NOW }));
});

test('redirect uri validation: https and loopback http only, no fragments', () => {
  assert.equal(validateRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'), true);
  assert.equal(validateRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(validateRedirectUri('http://localhost:3000/cb'), true);
  assert.equal(validateRedirectUri('http://127.0.0.1:8080/cb'), true);
  assert.equal(validateRedirectUri('http://evil.test/cb'), false);
  assert.equal(validateRedirectUri('https://x.test/cb#frag'), false);
  assert.equal(validateRedirectUri('https://claude.ai/cb#frag'), false);
  assert.equal(validateRedirectUri('javascript:alert(1)'), false);
  assert.equal(validateRedirectUri('https://user:pw@x.test/cb'), false);
  assert.equal(validateRedirectUri(42), false);
});

test('registration: stores client, rejects bad uris and unsupported auth methods', async () => {
  const store = createMemoryOAuthStore();
  const out = await registerClient(store, { redirect_uris: [REDIRECT], client_name: '<b>ChatGPT</b>' }, { now: NOW });
  assert.match(out.client_id, /^mcpc_/);
  assert.equal(out.token_endpoint_auth_method, 'none');
  assert.equal((await store.clients.get(out.client_id)).clientName, 'bChatGPTb');
  await rejects(registerClient(store, { redirect_uris: [] }, { now: NOW }), 'invalid_redirect_uri');
  await rejects(registerClient(store, { redirect_uris: ['http://evil.test/x'] }, { now: NOW }), 'invalid_redirect_uri');
  await rejects(registerClient(store, { redirect_uris: ['https://evil.test/x'] }, { now: NOW }), 'invalid_redirect_uri'); // https alone is not enough: the host must be allowlisted
  await rejects(registerClient(store, { redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' }, { now: NOW }), 'invalid_client_metadata');
  await rejects(registerClient(store, { redirect_uris: [REDIRECT], grant_types: ['password'] }, { now: NOW }), 'invalid_client_metadata');
});

test('authorize request checks: unknown client, unregistered redirect, bad method, bad challenge, bad scope', async () => {
  const { store, params } = await setup();
  assert.ok((await checkAuthRequest(store, params)).client);
  await rejects(checkAuthRequest(store, { ...params, client_id: 'nope' }), 'invalid_client');
  await rejects(checkAuthRequest(store, { ...params, redirect_uri: 'https://evil.test/cb' }), 'invalid_redirect_uri');
  await rejects(checkAuthRequest(store, { ...params, code_challenge_method: 'plain' }), 'invalid_request');
  await rejects(checkAuthRequest(store, { ...params, code_challenge: 'short' }), 'invalid_request');
  await rejects(checkAuthRequest(store, { ...params, response_type: 'token' }), 'unsupported_response_type');
  await rejects(checkAuthRequest(store, { ...params, scope: 'admin' }), 'invalid_scope');
});

test('code flow: issue -> exchange succeeds once; second use fails (single use)', async () => {
  const { store, reg, params } = await setup();
  const { redirectUrl } = await issueAuthCode(store, { params, email: 'Owner@x.test', now: NOW });
  assert.ok(redirectUrl.startsWith(`${REDIRECT}?`));
  assert.equal(new URL(redirectUrl).searchParams.get('state'), 'xyz');
  const code = codeFrom(redirectUrl);
  // codes are stored hashed, never in the clear
  assert.ok(![...store._raw.codes.keys()].includes(code));
  const body = { code, clientId: reg.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, secret: SECRET, aud: AUD, now: NOW + 1000 };
  const tokens = await exchangeCode(store, body);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, ACCESS_TTL_SEC);
  const v = verifyAccessToken(tokens.access_token, { secret: SECRET, aud: AUD, now: NOW + 2000 });
  assert.equal(v.claims.sub, 'owner@x.test');
  await rejects(exchangeCode(store, body), 'invalid_grant');
});

test('code flow: expiry, wrong verifier, wrong client, wrong redirect_uri all invalid_grant (and burn the code)', async () => {
  const { store, reg, params } = await setup();
  const base = { clientId: reg.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, secret: SECRET, aud: AUD };
  const mint = async () => codeFrom((await issueAuthCode(store, { params, email: 'o@x.test', now: NOW })).redirectUrl);
  await rejects(exchangeCode(store, { ...base, code: await mint(), now: NOW + CODE_TTL_SEC * 1000 + 1 }), 'invalid_grant');
  await rejects(exchangeCode(store, { ...base, code: await mint(), codeVerifier: 'z'.repeat(50), now: NOW }), 'invalid_grant');
  await rejects(exchangeCode(store, { ...base, code: await mint(), clientId: 'other', now: NOW }), 'invalid_grant');
  await rejects(exchangeCode(store, { ...base, code: await mint(), redirectUri: 'https://evil.test/cb', now: NOW }), 'invalid_grant');
  const c = await mint();
  await rejects(exchangeCode(store, { ...base, code: c, codeVerifier: 'z'.repeat(50), now: NOW }), 'invalid_grant');
  await rejects(exchangeCode(store, { ...base, code: c, now: NOW }), 'invalid_grant'); // already consumed by the failed attempt
  await rejects(exchangeCode(store, { ...base, code: undefined, now: NOW }), 'invalid_request');
});

test('exchange fails closed (503) when the secret is unset', async () => {
  const { store, reg, params } = await setup();
  const code = codeFrom((await issueAuthCode(store, { params, email: 'o@x.test', now: NOW })).redirectUrl);
  await assert.rejects(exchangeCode(store, { code, clientId: reg.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, secret: '', aud: AUD, now: NOW }), (e) => e.status === 503);
});

test('refresh: rotates (old token dies), expires, bound to client', async () => {
  const { store, reg, params } = await setup();
  const code = codeFrom((await issueAuthCode(store, { params, email: 'o@x.test', now: NOW })).redirectUrl);
  const first = await exchangeCode(store, { code, clientId: reg.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, secret: SECRET, aud: AUD, now: NOW });
  const second = await refreshGrant(store, { refreshToken: first.refresh_token, clientId: reg.client_id, secret: SECRET, aud: AUD, now: NOW + 5000 });
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.equal(verifyAccessToken(second.access_token, { secret: SECRET, aud: AUD, now: NOW + 6000 }).ok, true);
  await rejects(refreshGrant(store, { refreshToken: first.refresh_token, clientId: reg.client_id, secret: SECRET, aud: AUD, now: NOW }), 'invalid_grant');
  await rejects(refreshGrant(store, { refreshToken: second.refresh_token, clientId: 'other', secret: SECRET, aud: AUD, now: NOW }), 'invalid_grant');
  // the failed wrong-client attempt consumed it; mint a fresh pair for the expiry check
  const code2 = codeFrom((await issueAuthCode(store, { params, email: 'o@x.test', now: NOW })).redirectUrl);
  const fresh = await exchangeCode(store, { code: code2, clientId: reg.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, secret: SECRET, aud: AUD, now: NOW });
  const third = await refreshGrant(store, { refreshToken: fresh.refresh_token, clientId: reg.client_id, secret: SECRET, aud: AUD, now: NOW });
  await rejects(refreshGrant(store, { refreshToken: third.refresh_token, clientId: reg.client_id, secret: SECRET, aud: AUD, now: NOW + REFRESH_TTL_SEC * 1000 + 1 }), 'invalid_grant');
});

test('token endpoint dispatch: grant types and errors', async () => {
  const { store, reg, params } = await setup();
  const code = codeFrom((await issueAuthCode(store, { params, email: 'o@x.test', now: NOW })).redirectUrl);
  const t = await handleTokenRequest(store, { grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER }, { secret: SECRET, aud: AUD, now: NOW });
  const r = await handleTokenRequest(store, { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: reg.client_id }, { secret: SECRET, aud: AUD, now: NOW });
  assert.ok(r.access_token);
  await rejects(handleTokenRequest(store, { grant_type: 'password' }, { secret: SECRET, aud: AUD, now: NOW }), 'unsupported_grant_type');
});

// ---- M1: redirect host allowlist ---------------------------------------------------------------------------

test('redirect allowlist: known connector hosts, loopback, MCP_EXTRA_REDIRECT_HOSTS; everything else refused', () => {
  for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect', 'https://chat.openai.com/aip/x/oauth/callback',
    'http://localhost:8080/cb', 'http://127.0.0.1:3000/cb', 'http://[::1]:3000/cb']) assert.equal(validateRedirectUri(ok), true, ok);
  for (const bad of ['https://evil.test/cb', 'https://claude.ai.evil.test/cb', 'https://evilclaude.ai/cb', 'https://notchatgpt.com/cb', 'http://claude.ai/cb', 'http://chatgpt.com/cb',
    'https://sub.claude.ai/cb', 'https://localhost.evil.test/cb', 'ftp://claude.ai/cb']) assert.equal(validateRedirectUri(bad), false, bad);
  assert.equal(validateRedirectUri('https://connector.example.org/cb'), false);
  assert.equal(validateRedirectUri('https://connector.example.org/cb', { extraHosts: parseExtraHosts(' Connector.Example.org , other.test ') }), true);
  assert.equal(validateRedirectUri('http://connector.example.org/cb', { extraHosts: ['connector.example.org'] }), false, 'extra hosts still need https');
  assert.deepEqual(parseExtraHosts(undefined), []);
});

test('redirect allowlist is enforced at registration, with extra hosts honored', async () => {
  const store = createMemoryOAuthStore();
  await rejects(registerClient(store, { redirect_uris: ['https://connector.example.org/cb'] }, { now: NOW }), 'invalid_redirect_uri');
  const ok = await registerClient(store, { redirect_uris: ['https://connector.example.org/cb'] }, { now: NOW, extraHosts: parseExtraHosts('connector.example.org') });
  assert.ok(ok.client_id);
});

test('authorize re-checks the allowlist: a client registered with a now-disallowed host never gets a code', async () => {
  const store = createMemoryOAuthStore();
  const reg = await registerClient(store, { redirect_uris: ['https://connector.example.org/cb'] }, { now: NOW, extraHosts: ['connector.example.org'] });
  const params = { client_id: reg.client_id, redirect_uri: 'https://connector.example.org/cb', response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' };
  assert.ok(await issueAuthCode(store, { params, email: 'o@x.test', now: NOW, extraHosts: ['connector.example.org'] }));
  await rejects(issueAuthCode(store, { params, email: 'o@x.test', now: NOW }), 'invalid_redirect_uri'); // env var removed
  await rejects(checkAuthRequest(store, params), 'invalid_redirect_uri');
});

// ---- H1: verified identity ---------------------------------------------------------------------------------

test('isVerifiedIdentity: verified email or Google sign-in only', () => {
  assert.equal(isVerifiedIdentity({ email: 'a@b.test', email_verified: true, firebase: { sign_in_provider: 'password' } }), true);
  assert.equal(isVerifiedIdentity({ email: 'a@b.test', email_verified: false, firebase: { sign_in_provider: 'google.com' } }), true);
  assert.equal(isVerifiedIdentity({ email: 'a@b.test', email_verified: false, firebase: { sign_in_provider: 'password' } }), false);
  assert.equal(isVerifiedIdentity({ email: 'a@b.test' }), false);
  assert.equal(isVerifiedIdentity({ email: 'a@b.test', email_verified: 'true' }), false);
  assert.equal(isVerifiedIdentity(null), false);
});

// ---- M4: refresh token families ----------------------------------------------------------------------------

async function firstTokens(store, reg, params, now = NOW, secret = SECRET) {
  const code = codeFrom((await issueAuthCode(store, { params, email: 'o@x.test', now })).redirectUrl);
  return exchangeCode(store, { code, clientId: reg.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, secret, aud: AUD, now });
}
const refresh = (store, reg, token, now, secret = SECRET) => refreshGrant(store, { refreshToken: token, clientId: reg.client_id, secret, aud: AUD, now });
const liveCount = (store) => [...store._raw.refresh.values()].filter((v) => !v.used).length;

test('refresh family: records carry familyId, absolute familyExpiresAt and secretVersion; rotation keeps the family and does not extend it', async () => {
  const { store, reg, params } = await setup();
  const t1 = await firstTokens(store, reg, params);
  const r1 = store._raw.refresh.get(sha256hex(t1.refresh_token));
  assert.ok(r1.familyId);
  assert.equal(r1.familyExpiresAt, NOW + REFRESH_TTL_SEC * 1000);
  assert.equal(r1.secretVersion, secretVersionOf(SECRET));
  assert.notEqual(r1.secretVersion, secretVersionOf('another-secret'));
  const later = NOW + 10 * 24 * 3600 * 1000;
  const t2 = await refresh(store, reg, t1.refresh_token, later);
  const r2 = store._raw.refresh.get(sha256hex(t2.refresh_token));
  assert.equal(r2.familyId, r1.familyId);
  assert.equal(r2.familyExpiresAt, r1.familyExpiresAt, 'rotation must not extend the family');
  assert.equal(r2.expiresAt, Math.min(later + REFRESH_TTL_SEC * 1000, r1.familyExpiresAt));
  // keep rotating: still alive just before day 30, dead after, however recently it was rotated
  const t3 = await refresh(store, reg, t2.refresh_token, NOW + 29 * 24 * 3600 * 1000);
  await rejects(refresh(store, reg, t3.refresh_token, NOW + REFRESH_TTL_SEC * 1000 + 1), 'invalid_grant');
});

test('refresh reuse: replaying a rotated token revokes the whole family (including the newest token)', async () => {
  const { store, reg, params } = await setup();
  const t1 = await firstTokens(store, reg, params);
  const t2 = await refresh(store, reg, t1.refresh_token, NOW + 1000);
  const t3 = await refresh(store, reg, t2.refresh_token, NOW + 2000);
  assert.equal(liveCount(store), 1);
  await assert.rejects(refresh(store, reg, t1.refresh_token, NOW + 3000), (e) => e instanceof OAuthError && e.code === 'invalid_grant' && /reuse/.test(e.message));
  assert.equal(store._raw.refresh.size, 0, 'every token of the family is gone');
  await rejects(refresh(store, reg, t3.refresh_token, NOW + 4000), 'invalid_grant'); // the legitimate holder must re-authorize
});

test('refresh reuse only revokes its own family', async () => {
  const { store, reg, params } = await setup();
  const a1 = await firstTokens(store, reg, params);
  const b1 = await firstTokens(store, reg, params);
  const a2 = await refresh(store, reg, a1.refresh_token, NOW + 1000);
  await rejects(refresh(store, reg, a1.refresh_token, NOW + 2000), 'invalid_grant');
  const b2 = await refresh(store, reg, b1.refresh_token, NOW + 3000); // the other session is untouched
  assert.ok(b2.access_token);
  await rejects(refresh(store, reg, a2.refresh_token, NOW + 4000), 'invalid_grant');
});

test('refresh after MCP_OAUTH_SECRET rotation: rejected, and the family is revoked', async () => {
  const { store, reg, params } = await setup();
  const t1 = await firstTokens(store, reg, params);
  await rejects(refresh(store, reg, t1.refresh_token, NOW + 1000, 'a-brand-new-secret-value-123'), 'invalid_grant');
  assert.equal(store._raw.refresh.size, 0);
  // and an access token signed with the old secret is already dead
  assert.equal(verifyAccessToken(t1.access_token, { secret: 'a-brand-new-secret-value-123', aud: AUD, now: NOW }).ok, false);
});

test('refresh: tokens without a family (legacy shape) are refused', async () => {
  const { store, reg } = await setup();
  await store.refresh.put(sha256hex('legacy-token'), { clientId: reg.client_id, email: 'o@x.test', scope: 'hitloop', createdAt: NOW, expiresAt: NOW + 1e9 });
  await rejects(refresh(store, reg, 'legacy-token', NOW + 1000), 'invalid_grant');
});
