// instagram-oauth.js — per-client Instagram connect (Instagram API with
// Instagram Login; no Facebook Page). Mirrors the per-client half of
// x-oauth.js: HMAC-signed state carries the clientId through the redirect,
// a pending doc pins the attempt, and the result lands in the generic
// social_accounts store under platforms.instagram.
//
// Flow (Meta docs, "Business Login for Instagram"):
//   1. https://www.instagram.com/oauth/authorize?...           -> ?code=
//   2. POST https://api.instagram.com/oauth/access_token         -> short-lived token (1h)
//   3. GET  graph.instagram.com/access_token?grant_type=ig_exchange_token -> long-lived (~60d)
//   4. GET  graph.instagram.com/me                              -> user_id / username
// Long-lived tokens are renewed by refreshDueInstagramTokens (daily cron)
// via grant_type=ig_refresh_token; a token must be >=24h old to refresh.
//
// Connecting spends nothing. Publishing stays gated by platforms.js `live`.

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { GRAPH_API_VERSION, GRAPH_HOST } from './adapters/instagram.js';

const require = createRequire(import.meta.url);

export const INSTAGRAM_OAUTH_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const SHORT_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const PENDING_COLLECTION = 'social_oauth_pending';
const PENDING_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Renew when fewer than this many days remain (tokens live ~60 days).
export const REFRESH_WINDOW_MS = 20 * DAY_MS;
// Meta refuses to refresh a token younger than 24 hours.
const MIN_TOKEN_AGE_MS = DAY_MS;

function stripQuotes(value) {
  if (!value || typeof value !== 'string') return value;
  const t = value.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
}

export function getInstagramAppCredentials(env = process.env) {
  return {
    appId: stripQuotes(env.INSTAGRAM_APP_ID || ''),
    appSecret: stripQuotes(env.INSTAGRAM_APP_SECRET || ''),
  };
}

function requireCredentials(env) {
  const creds = getInstagramAppCredentials(env);
  if (!creds.appId || !creds.appSecret) {
    throw Object.assign(new Error('INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET are not configured on the server.'), { status: 503 });
  }
  return creds;
}

// ── State: clientId|nonce|ts|hmac, base64url (same shape as x-oauth.js) ───────
export function signInstagramState(clientId, { appSecret, now = Date.now() } = {}) {
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${clientId}|${nonce}|${now}`;
  const sig = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

export function verifyInstagramState(state, { appSecret, now = Date.now() } = {}) {
  try {
    const decoded = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const [clientId, nonce, ts, sig] = decoded.split('|');
    if (!clientId || !nonce || !ts || !sig) return null;
    const expected = crypto.createHmac('sha256', appSecret).update(`${clientId}|${nonce}|${ts}`).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (now - Number(ts) > PENDING_TTL_MS) return null;
    return clientId;
  } catch {
    return null;
  }
}

// ── Default Firestore-backed deps (lazy, so tests never load firebase) ───────
function pendingDocId(clientId) {
  return `${clientId}__instagram`;
}

async function defaultDeps() {
  const fb = require('../../api/_lib/firebase-admin.cjs');
  const accounts = await import('./social-accounts.js');
  const ref = (clientId) => fb.adminDb.collection(PENDING_COLLECTION).doc(pendingDocId(clientId));
  return {
    savePending: (clientId, doc) => ref(clientId).set(doc),
    readPending: async (clientId) => { const s = await ref(clientId).get(); return s.exists ? s.data() : null; },
    deletePending: (clientId) => ref(clientId).delete(),
    saveAccount: (clientId, patch) => accounts.saveSocialAccount(clientId, 'instagram', patch),
    getAccount: (clientId) => accounts.getSocialAccount(clientId, 'instagram'),
    listInstagramAccounts: async () => {
      const snap = await fb.adminDb.collection('social_accounts').get();
      return snap.docs
        .map((d) => ({ clientId: d.id, account: d.data()?.platforms?.instagram || null }))
        .filter((row) => row.account?.accessToken);
    },
  };
}

async function resolveDeps(deps) {
  const base = deps && deps.savePending ? {} : await defaultDeps();
  return { ...base, ...(deps || {}), fetchImpl: deps?.fetchImpl || globalThis.fetch, env: deps?.env || process.env, now: deps?.now || Date.now };
}

async function readJson(res, label) {
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.error || body?.error_type) {
    const msg = body?.error?.message || body?.error_message || body?.error_description || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Instagram ${label} failed: ${msg}`), { status: res.status >= 400 && res.status < 500 ? 400 : 502 });
  }
  return body || {};
}

// Token endpoints (access_token, refresh_access_token) are unversioned in
// Meta's docs; data reads (/me) use the adapter's pinned version.
function graphUrl(path, params, { versioned = false } = {}) {
  return `${GRAPH_HOST}/${versioned ? `${GRAPH_API_VERSION}/` : ''}${path}?${new URLSearchParams(params).toString()}`;
}

// ── Connect ───────────────────────────────────────────────────────────────────
export async function startInstagramOAuthFlow(redirectUri, startedBy = null, clientId, deps) {
  if (!clientId) throw Object.assign(new Error('clientId is required.'), { status: 400 });
  const d = await resolveDeps(deps);
  const { appId, appSecret } = requireCredentials(d.env);
  const state = signInstagramState(clientId, { appSecret, now: d.now() });
  const url = `${AUTHORIZE_URL}?${new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_OAUTH_SCOPES.join(','),
    state,
  }).toString()}`;
  await d.savePending(clientId, { state, redirectUri, startedBy: startedBy || null, clientId, createdAt: d.now() });
  return { url };
}

export async function completeInstagramOAuthFlow({ code, state }, deps) {
  if (!code || !state) throw new Error('Missing code or state in the Instagram callback.');
  const d = await resolveDeps(deps);
  const { appId, appSecret } = requireCredentials(d.env);
  const clientId = verifyInstagramState(state, { appSecret, now: d.now() });
  if (!clientId) throw new Error('This connection link is invalid or expired — start Connect again from the dashboard.');

  const pending = await d.readPending(clientId);
  if (!pending || pending.state !== state) {
    throw new Error('No matching in-progress connection — start the Connect flow again from the dashboard.');
  }
  if (d.now() - (pending.createdAt || 0) > PENDING_TTL_MS) {
    await d.deletePending(clientId);
    throw new Error('The connection attempt expired — start the Connect flow again from the dashboard.');
  }

  // Instagram appends "#_" to the code in the redirect; it is not part of the code.
  const cleanCode = String(code).replace(/#_$/, '');
  const short = await readJson(await d.fetchImpl(SHORT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: pending.redirectUri,
      code: cleanCode,
    }).toString(),
  }), 'code exchange');
  const shortToken = short.access_token || short.data?.[0]?.access_token;
  if (!shortToken) throw new Error('Instagram returned no access token.');

  const long = await readJson(await d.fetchImpl(graphUrl('access_token', {
    grant_type: 'ig_exchange_token',
    client_secret: appSecret,
    access_token: shortToken,
  })), 'long-lived token exchange');

  const me = await readJson(await d.fetchImpl(graphUrl('me', { fields: 'user_id,username,name,profile_picture_url,account_type' }, { versioned: true }), {
    headers: { Authorization: `Bearer ${long.access_token}` },
  }), 'profile read');

  const grantedScope = short.permissions || short.data?.[0]?.permissions;
  const now = d.now();
  await d.saveAccount(clientId, {
    authMode: 'instagram-login',
    accessToken: long.access_token,
    expiresAt: now + Number(long.expires_in || 60 * 24 * 3600) * 1000,
    tokenIssuedAt: now,
    userId: me.user_id ? String(me.user_id) : null,
    username: me.username || null,
    name: me.name || null,
    profileImageUrl: me.profile_picture_url || null,
    accountType: me.account_type || null,
    scope: Array.isArray(grantedScope) ? grantedScope : String(grantedScope || INSTAGRAM_OAUTH_SCOPES.join(',')).split(',').filter(Boolean),
    connectedBy: pending.startedBy || null,
    refreshError: null,
  });
  await d.deletePending(clientId);
  return { clientId, username: me.username || null };
}

// ── Refresh ───────────────────────────────────────────────────────────────────
export function needsRefresh(account, now = Date.now()) {
  if (!account?.accessToken || !account.expiresAt) return false;
  if (account.expiresAt <= now) return false; // expired: refresh is impossible, owner must reconnect
  if (account.expiresAt - now > REFRESH_WINDOW_MS) return false;
  return now - (account.tokenIssuedAt || 0) >= MIN_TOKEN_AGE_MS;
}

export async function refreshInstagramToken(clientId, deps) {
  const d = await resolveDeps(deps);
  const account = await d.getAccount(clientId);
  if (!account?.accessToken) throw Object.assign(new Error('Instagram is not connected for this client.'), { status: 404 });
  const out = await readJson(await d.fetchImpl(graphUrl('refresh_access_token', {
    grant_type: 'ig_refresh_token',
    access_token: account.accessToken,
  })), 'token refresh');
  const now = d.now();
  await d.saveAccount(clientId, {
    ...account,
    accessToken: out.access_token,
    expiresAt: now + Number(out.expires_in || 60 * 24 * 3600) * 1000,
    tokenIssuedAt: now,
    refreshError: null,
  });
  return { clientId, expiresAt: now + Number(out.expires_in || 0) * 1000 };
}

// Daily cron body. Never throws for one client's failure; records it on the
// account (refreshError) so the Social Accounts card can show "reconnect".
export async function refreshDueInstagramTokens(deps) {
  const d = await resolveDeps(deps);
  const now = d.now();
  const rows = await d.listInstagramAccounts();
  const result = { checked: rows.length, refreshed: [], expired: [], failed: [] };
  for (const { clientId, account } of rows) {
    if (account.expiresAt && account.expiresAt <= now) { result.expired.push(clientId); continue; }
    if (!needsRefresh(account, now)) continue;
    try {
      await refreshInstagramToken(clientId, { ...d, getAccount: async () => account });
      result.refreshed.push(clientId);
    } catch (err) {
      result.failed.push({ clientId, error: err.message });
      try { await d.saveAccount(clientId, { ...account, refreshError: err.message }); } catch { /* best effort */ }
    }
  }
  return result;
}
