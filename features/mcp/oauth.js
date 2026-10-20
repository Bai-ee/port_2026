// oauth.js - pure OAuth 2.1 logic for the HITLOOP MCP server (node:crypto only).
// Everything here takes an injected store, clock and secret so it is testable without Firestore or env.
//
// Store contract (all async):
//   clients: { get(id) -> doc|null, put(id, doc) }
//   codes:   { put(hash, doc), consume(hash) -> doc|null }   consume is atomic: it returns the doc once and deletes it
//   refresh: { put(hash, doc), consume(hash) -> {doc, alreadyUsed}|null, revokeFamily(familyId) }
//            consume marks the token used (it is NOT deleted) so a replay of a rotated token is detectable; a replay
//            revokes the whole token family. Families also die at an absolute familyExpiresAt and when MCP_OAUTH_SECRET changes.
// Authorization codes and refresh tokens are stored by SHA-256 hash, never in the clear.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SCOPE = 'hitloop';
// Client-scoped connectors (features/client-mcp): read-only, one HITLOOP client per token. Codes, refresh tokens and
// access tokens for it carry a `binding` {aud, scope, hcid, gid}; records without one are owner records (SCOPE, /api/mcp).
export const CLIENT_SCOPE = 'client:read';
export const ACCESS_TTL_SEC = 3600;
export const REFRESH_TTL_SEC = 30 * 24 * 3600;
export const CODE_TTL_SEC = 600;
export const MAX_REDIRECT_URIS = 5;

export class OAuthError extends Error {
  constructor(code, description, status = 400) {
    super(description || code);
    this.name = 'OAuthError';
    this.code = code;
    this.status = status;
  }
}

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const sha256b64url = (s) => createHash('sha256').update(String(s)).digest('base64url');
export const sha256hex = (s) => createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (!x.length || x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

// ---- PKCE --------------------------------------------------------------------------------------------------

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/; // base64url(SHA-256) is always 43 chars

export function isValidChallenge(challenge) {
  return typeof challenge === 'string' && CHALLENGE_RE.test(challenge);
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) === challenge, constant-time. */
export function verifyPkceS256(verifier, challenge) {
  if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return false;
  if (!isValidChallenge(challenge)) return false;
  return safeEqual(sha256b64url(verifier), challenge);
}

// ---- Access tokens (compact HS256 JWT) ---------------------------------------------------------------------

const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');

export function signAccessToken({ secret, email, aud, scope = SCOPE, clientId = null, hcid = null, gid = null, now, ttlSec = ACCESS_TTL_SEC, jti = randomToken(12) }) {
  if (!secret) throw new OAuthError('server_error', 'signing secret is not configured', 503);
  const iat = Math.floor(now / 1000);
  // cid = OAuth client id; hcid/gid = HITLOOP client id + connect grant id (client-scoped tokens only).
  const claims = { sub: String(email).toLowerCase(), aud, scope, jti, iat, exp: iat + ttlSec, ...(clientId ? { cid: clientId } : {}), ...(hcid ? { hcid } : {}), ...(gid ? { gid } : {}) };
  const body = b64url(JSON.stringify(claims));
  return `${HEADER}.${body}.${hmac(secret, `${HEADER}.${body}`)}`;
}

/** @returns {{ok:true, claims:object}|{ok:false, error:string}} Never throws. */
export function verifyAccessToken(token, { secret, aud, now }) {
  if (!secret) return { ok: false, error: 'not-configured' };
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, error: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return { ok: false, error: 'malformed' };
  if (!safeEqual(hmac(secret, `${parts[0]}.${parts[1]}`), parts[2])) return { ok: false, error: 'bad-signature' };
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { ok: false, error: 'malformed' }; }
  if (!claims || typeof claims !== 'object') return { ok: false, error: 'malformed' };
  if (!Number.isFinite(claims.exp) || Math.floor(now / 1000) >= claims.exp) return { ok: false, error: 'expired' };
  if (aud && claims.aud !== aud) return { ok: false, error: 'wrong-audience' };
  if (typeof claims.sub !== 'string' || !claims.sub) return { ok: false, error: 'malformed' };
  return { ok: true, claims };
}

// ---- Redirect URIs / dynamic client registration -----------------------------------------------------------

export const BASE_REDIRECT_HOSTS = Object.freeze(['claude.ai', 'chatgpt.com', 'chat.openai.com']);
const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/** Parse MCP_EXTRA_REDIRECT_HOSTS (comma list) into lower-case bare hostnames. */
export function parseExtraHosts(raw) {
  if (Array.isArray(raw)) return raw.map((h) => String(h).trim().toLowerCase()).filter(Boolean);
  return String(raw ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/**
 * Only known connector hosts may receive an authorization code: the exact host must be allowlisted (claude.ai,
 * chatgpt.com, chat.openai.com, loopback, plus MCP_EXTRA_REDIRECT_HOSTS). https required, except http on loopback.
 * No fragments, no credentials.
 */
export function validateRedirectUri(uri, { extraHosts = [] } = {}) {
  if (typeof uri !== 'string' || uri.length > 500) return false;
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.includes(host)) return u.protocol === 'http:' || u.protocol === 'https:';
  if (u.protocol !== 'https:') return false;
  return BASE_REDIRECT_HOSTS.includes(host) || parseExtraHosts(extraHosts).includes(host);
}

const cleanName = (v) => String(v ?? '').replace(/[^\p{L}\p{N} ._\-()]/gu, '').trim().slice(0, 80);

/** RFC 7591 registration of a public (PKCE) client. */
export async function registerClient(store, body, { now, id = `mcpc_${randomToken(16)}`, extraHosts = [] } = {}) {
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length) throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required');
  if (uris.length > MAX_REDIRECT_URIS) throw new OAuthError('invalid_redirect_uri', `at most ${MAX_REDIRECT_URIS} redirect_uris`);
  for (const u of uris) if (!validateRedirectUri(u, { extraHosts })) throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https on an allowed connector host (claude.ai, chatgpt.com, chat.openai.com) or http(s) on localhost, without a fragment');
  const method = body?.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') throw new OAuthError('invalid_client_metadata', 'only token_endpoint_auth_method "none" (PKCE public client) is supported');
  const grants = Array.isArray(body?.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'];
  if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) throw new OAuthError('invalid_client_metadata', 'unsupported grant_types');
  const doc = {
    clientId: id,
    clientName: cleanName(body?.client_name) || 'MCP client',
    redirectUris: [...new Set(uris)],
    grantTypes: grants,
    createdAt: new Date(now).toISOString(),
  };
  await store.clients.put(id, doc);
  return {
    client_id: id,
    client_name: doc.clientName,
    redirect_uris: doc.redirectUris,
    grant_types: doc.grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    client_id_issued_at: Math.floor(now / 1000),
  };
}

/**
 * A code is only issued for an identity Firebase has verified: a confirmed email address, or Google sign-in (Google
 * verified the address). An unverified email/password signup that happens to match an admin address gets nothing.
 */
export const isVerifiedIdentity = (decoded) => decoded?.email_verified === true || decoded?.firebase?.sign_in_provider === 'google.com';

// ---- Authorization request ---------------------------------------------------------------------------------

/**
 * Validate the authorize query against the registered client. Throws OAuthError. The caller must NOT redirect to
 * redirect_uri when this throws for client_id / redirect_uri (those errors are shown to the user instead).
 */
export async function checkAuthRequest(store, params, { extraHosts = [], scope = SCOPE } = {}) {
  const client = typeof params?.client_id === 'string' && params.client_id ? await store.clients.get(params.client_id) : null;
  if (!client) throw new OAuthError('invalid_client', 'unknown client_id');
  if (!client.redirectUris.includes(params.redirect_uri)) throw new OAuthError('invalid_redirect_uri', 'redirect_uri is not registered for this client');
  // Re-checked here so a client registered before the allowlist (or after an env change) can never receive a code.
  if (!validateRedirectUri(params.redirect_uri, { extraHosts })) throw new OAuthError('invalid_redirect_uri', 'redirect_uri host is not allowed');
  if (params.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'response_type must be "code"');
  if (params.code_challenge_method !== 'S256') throw new OAuthError('invalid_request', 'code_challenge_method must be S256');
  if (!isValidChallenge(params.code_challenge)) throw new OAuthError('invalid_request', 'code_challenge is missing or malformed');
  if (params.scope && String(params.scope).split(/\s+/).some((s) => s && s !== scope)) throw new OAuthError('invalid_scope', `only the "${scope}" scope exists for this resource`);
  return { client };
}

/**
 * After the admin allowed it: mint a single-use code bound to client, redirect_uri, challenge and admin email.
 * `binding` ({aud, scope, hcid, gid}) is set only for a client-scoped connect grant; the tokens inherit it.
 */
export async function issueAuthCode(store, { params, email, now, ttlSec = CODE_TTL_SEC, extraHosts = [], binding = null }) {
  const { client } = await checkAuthRequest(store, params, { extraHosts, scope: binding?.scope || SCOPE });
  const code = randomToken(32);
  await store.codes.put(sha256hex(code), {
    clientId: client.clientId,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    email: String(email).toLowerCase(),
    scope: binding?.scope || SCOPE,
    ...(binding ? { aud: binding.aud, hcid: binding.hcid, gid: binding.gid } : {}),
    createdAt: now,
    expiresAt: now + ttlSec * 1000,
  });
  const u = new URL(params.redirect_uri);
  u.searchParams.set('code', code);
  if (params.state) u.searchParams.set('state', String(params.state));
  return { code, redirectUrl: u.toString() };
}

// ---- Token endpoint ----------------------------------------------------------------------------------------

/** Short, non-reversible fingerprint of the signing secret: rotating MCP_OAUTH_SECRET invalidates every refresh token. */
export const secretVersionOf = (secret) => sha256hex(String(secret ?? '')).slice(0, 16);

/** The binding a code/refresh record carries, or null for an owner record (old records have none). */
const bindingOf = (rec) => (rec?.hcid && rec?.gid && rec?.aud ? { aud: rec.aud, scope: rec.scope, hcid: rec.hcid, gid: rec.gid } : null);

async function mintTokens(store, { secret, aud, email, clientId, now, familyId = randomToken(12), familyExpiresAt = now + REFRESH_TTL_SEC * 1000, binding = null }) {
  const refreshToken = randomToken(32);
  const scope = binding ? binding.scope : SCOPE;
  await store.refresh.put(sha256hex(refreshToken), {
    clientId, email, scope, createdAt: now,
    ...(binding ? { aud: binding.aud, hcid: binding.hcid, gid: binding.gid } : {}),
    // A rotated token never outlives its family: the family clock starts at first issue and is not extended.
    expiresAt: Math.min(now + REFRESH_TTL_SEC * 1000, familyExpiresAt),
    familyId, familyExpiresAt, secretVersion: secretVersionOf(secret), used: false,
  });
  return {
    access_token: signAccessToken({ secret, email, aud: binding ? binding.aud : aud, scope, clientId, hcid: binding?.hcid, gid: binding?.gid, now }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refreshToken,
    scope,
  };
}

/** authorization_code grant. Single use: the code is consumed before anything else is checked. */
export async function exchangeCode(store, { code, clientId, redirectUri, codeVerifier, secret, aud, now }) {
  if (!secret) throw new OAuthError('server_error', 'MCP_OAUTH_SECRET is not configured', 503);
  if (!code || !clientId || !redirectUri || !codeVerifier) throw new OAuthError('invalid_request', 'code, client_id, redirect_uri and code_verifier are required');
  const rec = await store.codes.consume(sha256hex(code));
  if (!rec) throw new OAuthError('invalid_grant', 'authorization code is invalid or already used');
  if (now >= rec.expiresAt) throw new OAuthError('invalid_grant', 'authorization code expired');
  if (rec.clientId !== clientId) throw new OAuthError('invalid_grant', 'authorization code was issued to another client');
  if (rec.redirectUri !== redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
  if (!verifyPkceS256(codeVerifier, rec.codeChallenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
  return mintTokens(store, { secret, aud, email: rec.email, clientId, now, binding: bindingOf(rec) });
}

/**
 * refresh_token grant with rotation. The presented token is marked used and a new pair is issued in the same family.
 * Presenting an already-used token means it leaked (or a client replayed it): the whole family is revoked.
 */
export async function refreshGrant(store, { refreshToken, clientId, secret, aud, now }) {
  if (!secret) throw new OAuthError('server_error', 'MCP_OAUTH_SECRET is not configured', 503);
  if (!refreshToken || !clientId) throw new OAuthError('invalid_request', 'refresh_token and client_id are required');
  const res = await store.refresh.consume(sha256hex(refreshToken));
  if (!res) throw new OAuthError('invalid_grant', 'refresh token is invalid or already used');
  const rec = res.doc;
  if (res.alreadyUsed) {
    if (rec.familyId) await store.refresh.revokeFamily(rec.familyId);
    throw new OAuthError('invalid_grant', 'refresh token reuse detected; the session was revoked, authorize again');
  }
  if (rec.secretVersion !== secretVersionOf(secret) || !rec.familyId) {
    if (rec.familyId) await store.refresh.revokeFamily(rec.familyId);
    throw new OAuthError('invalid_grant', 'refresh token was revoked, authorize again');
  }
  if (now >= rec.expiresAt || now >= rec.familyExpiresAt) throw new OAuthError('invalid_grant', 'refresh token expired');
  if (rec.clientId !== clientId) throw new OAuthError('invalid_grant', 'refresh token was issued to another client');
  return mintTokens(store, { secret, aud, email: rec.email, clientId, now, familyId: rec.familyId, familyExpiresAt: rec.familyExpiresAt, binding: bindingOf(rec) });
}

/** Dispatch a token request body (already parsed to a plain object). */
export async function handleTokenRequest(store, body, { secret, aud, now }) {
  const grant = body?.grant_type;
  if (grant === 'authorization_code') {
    return exchangeCode(store, { code: body.code, clientId: body.client_id, redirectUri: body.redirect_uri, codeVerifier: body.code_verifier, secret, aud, now });
  }
  if (grant === 'refresh_token') {
    return refreshGrant(store, { refreshToken: body.refresh_token, clientId: body.client_id, secret, aud, now });
  }
  throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

// ---- Stores ------------------------------------------------------------------------------------------------

export function createMemoryOAuthStore() {
  const clients = new Map(); const codes = new Map(); const refresh = new Map();
  const copy = (v) => JSON.parse(JSON.stringify(v));
  return {
    clients: { get: async (id) => clients.get(id) ?? null, put: async (id, d) => { clients.set(id, copy(d)); } },
    codes: {
      put: async (k, v) => { codes.set(k, copy(v)); },
      consume: async (k) => { const v = codes.get(k) ?? null; codes.delete(k); return v; },
      get: async (k) => codes.get(k) ?? null,
    },
    refresh: {
      put: async (k, v) => { refresh.set(k, copy(v)); },
      get: async (k) => refresh.get(k) ?? null,
      consume: async (k) => {
        const v = refresh.get(k);
        if (!v) return null;
        if (v.used) return { doc: copy(v), alreadyUsed: true };
        refresh.set(k, { ...v, used: true, usedAt: Date.now() });
        return { doc: copy(v), alreadyUsed: false };
      },
      revokeFamily: async (familyId) => { for (const [k, v] of refresh) if (v.familyId === familyId) refresh.delete(k); },
    },
    _raw: { clients, codes, refresh },
  };
}

/** Firestore-backed store. `consume` runs in a transaction so two concurrent exchanges cannot both win. */
export function createFirestoreOAuthStore(db) {
  const col = (name) => db.collection(name);
  return {
    clients: {
      get: async (id) => { if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(id))) return null; const s = await col('mcp_oauth_clients').doc(id).get(); return s.exists ? s.data() : null; },
      put: async (id, doc) => { await col('mcp_oauth_clients').doc(id).set(doc); },
    },
    codes: {
      put: async (k, d) => { await col('mcp_oauth_codes').doc(k).set(d); },
      consume: async (key) => db.runTransaction(async (tx) => {
        const ref = col('mcp_oauth_codes').doc(key);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        return snap.data();
      }),
    },
    refresh: {
      put: async (k, d) => { await col('mcp_oauth_refresh').doc(k).set(d); },
      consume: async (key) => db.runTransaction(async (tx) => {
        const ref = col('mcp_oauth_refresh').doc(key);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const doc = snap.data();
        if (doc.used) return { doc, alreadyUsed: true };
        tx.update(ref, { used: true, usedAt: Date.now() });
        return { doc, alreadyUsed: false };
      }),
      revokeFamily: async (familyId) => {
        const snap = await col('mcp_oauth_refresh').where('familyId', '==', familyId).get();
        for (let i = 0; i < snap.docs.length; i += 400) {
          const batch = db.batch();
          snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      },
    },
  };
}
