import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { config as loadDotenv } from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORTFOLIO_ENV = path.join(REPO_ROOT, '.env.local');

// X OAuth 2.0 user-context (PKCE) for the @bai_ee account. The OAuth 1.0a keys
// in twitter-service.js cannot reach bookmarks — the /2/users/:id/bookmarks
// endpoints only accept OAuth 2.0 user tokens with the bookmark.* scopes, so
// this module owns a second, parallel auth path. Tokens are a global singleton
// (one X account for the whole app, same model as the TWITTER_* env keys).
//
// Spend rules for anything built on top of this: docs/source-of-truth/
// X-API-AND-PROFILE-OPERATIONS.md — every credit-metered call needs an explicit
// user confirmation, and X spend is invisible to the Operating Cost card.

const FLAGS_COLLECTION = 'system_flags';
const TOKENS_DOC = 'x_oauth_tokens';
const PENDING_DOC = 'x_oauth_pending';
const PENDING_TTL_MS = 15 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

// Requested once, broadly, so later phases (engagement, follows) do not force a
// reconnect. Scopes are free — the spend gate lives on each call site instead.
export const X_OAUTH_SCOPES = [
  'tweet.read',
  'tweet.write',
  'tweet.moderate.write',
  'users.read',
  'bookmark.read',
  'bookmark.write',
  'like.read',
  'like.write',
  'follows.read',
  'follows.write',
  'offline.access',
];

let envLoaded = false;

function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  try {
    loadDotenv({ path: PORTFOLIO_ENV, override: false });
  } catch {
    // Vercel provides process.env directly; the file only exists locally.
  }
}

function stripQuotes(value) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getAppCredentials() {
  loadEnv();
  return {
    clientId: stripQuotes(process.env.X_OAUTH_CLIENT_ID || ''),
    clientSecret: stripQuotes(process.env.X_OAUTH_CLIENT_SECRET || ''),
  };
}

export function getXOAuthConfigStatus() {
  const { clientId, clientSecret } = getAppCredentials();
  return { hasClientId: Boolean(clientId), hasClientSecret: Boolean(clientSecret) };
}

function getAppClient() {
  const { clientId, clientSecret } = getAppCredentials();
  if (!clientId || !clientSecret) {
    const err = new Error('X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET are not configured on the server.');
    err.status = 503;
    throw err;
  }
  return new TwitterApi({ clientId, clientSecret });
}

function tokensRef() {
  loadEnv(); // firebase-admin needs FIREBASE_ADMIN_* before first use (CLI runs)
  return fb.adminDb.collection(FLAGS_COLLECTION).doc(TOKENS_DOC);
}

function pendingRef() {
  loadEnv();
  return fb.adminDb.collection(FLAGS_COLLECTION).doc(PENDING_DOC);
}

export function compactXOAuthError(error) {
  const code = error?.code || error?.status || null;
  const detail = error?.data?.detail || error?.data?.title || error?.message || 'X API error';
  if (code === 402) {
    return { status: 402, message: 'X API credits are depleted (402 CreditsDepleted). Add credits in the X developer portal — retrying will not help.' };
  }
  if (code === 429) {
    const reset = error?.rateLimit?.reset ? new Date(error.rateLimit.reset * 1000).toLocaleTimeString() : null;
    return { status: 429, message: `X API rate limit hit (429).${reset ? ` Resets around ${reset}.` : ''} Wait before retrying.` };
  }
  if (code === 403) {
    return { status: 403, message: `X API refused the call (403) — the plan tier may not include this endpoint, or the token is missing a scope. Detail: ${detail}` };
  }
  return { status: typeof code === 'number' ? code : 500, message: detail };
}

export async function startXOAuthFlow(redirectUri, startedBy = null) {
  const client = getAppClient();
  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(redirectUri, { scope: X_OAUTH_SCOPES });
  await pendingRef().set({
    codeVerifier,
    state,
    redirectUri,
    startedBy: startedBy || null,
    createdAt: Date.now(),
  });
  return { url };
}

export async function completeXOAuthFlow({ code, state }) {
  if (!code || !state) throw new Error('Missing code or state in the OAuth callback.');
  const snap = await pendingRef().get();
  const pending = snap.exists ? snap.data() : null;
  if (!pending || pending.state !== state) {
    throw new Error('No matching in-progress connection — start the Connect flow again from the dashboard.');
  }
  if (Date.now() - (pending.createdAt || 0) > PENDING_TTL_MS) {
    await pendingRef().delete();
    throw new Error('The connection attempt expired — start the Connect flow again from the dashboard.');
  }

  const appClient = getAppClient();
  const { client: loggedClient, accessToken, refreshToken, expiresIn, scope } = await appClient.loginWithOAuth2({
    code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
  });

  // One users.read call to pin down whose account this token controls.
  const me = await loggedClient.v2.me();

  await tokensRef().set({
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: Date.now() + (expiresIn || 7200) * 1000,
    scope: Array.isArray(scope) ? scope : String(scope || '').split(' ').filter(Boolean),
    userId: me?.data?.id || null,
    username: me?.data?.username || null,
    name: me?.data?.name || null,
    connectedBy: pending.startedBy || null,
    updatedAt: Date.now(),
  });
  await pendingRef().delete();

  return { username: me?.data?.username || null };
}

async function readTokens() {
  const snap = await tokensRef().get();
  return snap.exists ? snap.data() : null;
}

// Returns a user-context OAuth2 client, refreshing the (single-use, rotating)
// refresh token when the access token is near expiry. Single-admin usage —
// concurrent refreshes are not guarded against.
export async function getXOAuth2Client() {
  let doc = await readTokens();
  if (!doc?.accessToken) {
    const err = new Error('The X account is not connected yet — run Connect in the X Command Center card.');
    err.status = 409;
    throw err;
  }
  if (Date.now() > (doc.expiresAt || 0) - REFRESH_SKEW_MS) {
    if (!doc.refreshToken) {
      const err = new Error('The X token expired and no refresh token was stored — reconnect the account.');
      err.status = 409;
      throw err;
    }
    const appClient = getAppClient();
    const { accessToken, refreshToken, expiresIn } = await appClient.refreshOAuth2Token(doc.refreshToken);
    doc = {
      ...doc,
      accessToken,
      refreshToken: refreshToken || doc.refreshToken,
      expiresAt: Date.now() + (expiresIn || 7200) * 1000,
      updatedAt: Date.now(),
    };
    await tokensRef().set(doc);
  }
  return { client: new TwitterApi(doc.accessToken), tokens: doc };
}

export async function getXOAuthStatus() {
  const doc = await readTokens();
  return {
    config: getXOAuthConfigStatus(),
    connected: Boolean(doc?.accessToken),
    username: doc?.username || null,
    userId: doc?.userId || null,
    scope: doc?.scope || [],
    expiresAt: doc?.expiresAt || null,
    updatedAt: doc?.updatedAt || null,
  };
}

export async function disconnectXOAuth() {
  const doc = await readTokens();
  if (doc?.refreshToken || doc?.accessToken) {
    try {
      const appClient = getAppClient();
      if (doc.refreshToken) await appClient.revokeOAuth2Token(doc.refreshToken, 'refresh_token');
      else await appClient.revokeOAuth2Token(doc.accessToken, 'access_token');
    } catch {
      // Best effort — the stored copy is deleted either way.
    }
  }
  await tokensRef().delete();
  return { ok: true };
}

// The Phase 0 proof call: one GET /2/users/:id/bookmarks (max_results=1).
// Credit-metered — call sites must pass the spend gate first. twitter-api-v2
// may issue one extra /2/users/me lookup to resolve the user id.
export async function verifyBookmarkAccess() {
  const { client, tokens } = await getXOAuth2Client();
  const res = await client.v2.bookmarks({ max_results: 1 });
  const first = res?.tweets?.[0] || null;
  return {
    ok: true,
    username: tokens.username || null,
    resultCount: res?.meta?.result_count ?? (first ? 1 : 0),
    sample: first ? { id: first.id, text: String(first.text || '').slice(0, 140) } : null,
  };
}
