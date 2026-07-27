import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import { saveSocialAccount, getSocialAccount } from './social-accounts.js';

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
  // media.write is required to upload video/image before a v2 tweet — added
  // for the per-client publishing flow. The existing @bai_ee token predates
  // this and lacks it; the card surfaces a reconnect notice when missing.
  'media.write',
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

// ── Per-client connect (Social Accounts card) ─────────────────────────────────
// A second, parallel pending-state path keyed by clientId rather than the
// single global doc above. The legacy no-clientId flow (X Command Center,
// @bai_ee) is untouched by everything below.
const CLIENT_PENDING_COLLECTION = 'social_oauth_pending';

function clientPendingRef(clientId) {
  loadEnv();
  return fb.adminDb.collection(CLIENT_PENDING_COLLECTION).doc(clientId);
}

// The callback only receives (code, state) from X — no clientId. Signing the
// clientId into `state` (same HMAC shape as api/_lib/calendar-oauth.cjs
// signState/verifyState) lets the callback recover whose flow this is without
// a client-supplied hint it could spoof.
function signOAuthState(clientId) {
  const { clientSecret } = getAppCredentials();
  const nonce = crypto.randomBytes(8).toString('hex');
  const ts = Date.now();
  const payload = `${clientId}|${nonce}|${ts}`;
  const sig = crypto.createHmac('sha256', clientSecret).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function verifyOAuthState(state) {
  try {
    const { clientSecret } = getAppCredentials();
    const decoded = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const [clientId, nonce, ts, sig] = decoded.split('|');
    if (!clientId || !nonce || !ts || !sig) return null;
    const expected = crypto.createHmac('sha256', clientSecret).update(`${clientId}|${nonce}|${ts}`).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Date.now() - Number(ts) > PENDING_TTL_MS) return null;
    return clientId;
  } catch {
    return null;
  }
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

export async function startXOAuthFlow(redirectUri, startedBy = null, clientId = null) {
  const client = getAppClient();
  const stateOverride = clientId ? signOAuthState(clientId) : undefined;
  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(redirectUri, {
    scope: X_OAUTH_SCOPES,
    ...(stateOverride ? { state: stateOverride } : {}),
  });
  const ref = clientId ? clientPendingRef(clientId) : pendingRef();
  await ref.set({
    codeVerifier,
    state,
    redirectUri,
    startedBy: startedBy || null,
    clientId: clientId || null,
    createdAt: Date.now(),
  });
  return { url };
}

export async function completeXOAuthFlow({ code, state }) {
  if (!code || !state) throw new Error('Missing code or state in the OAuth callback.');

  // A per-client connect signs its clientId into `state`; the legacy global
  // flow uses a plain random state that will not decode to anything here.
  const clientId = verifyOAuthState(state);
  const ref = clientId ? clientPendingRef(clientId) : pendingRef();

  const snap = await ref.get();
  const pending = snap.exists ? snap.data() : null;
  if (!pending || pending.state !== state) {
    throw new Error('No matching in-progress connection — start the Connect flow again from the dashboard.');
  }
  if (Date.now() - (pending.createdAt || 0) > PENDING_TTL_MS) {
    await ref.delete();
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

  const tokenDoc = {
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: Date.now() + (expiresIn || 7200) * 1000,
    scope: Array.isArray(scope) ? scope : String(scope || '').split(' ').filter(Boolean),
    userId: me?.data?.id || null,
    username: me?.data?.username || null,
    name: me?.data?.name || null,
    connectedBy: pending.startedBy || null,
    updatedAt: Date.now(),
  };

  if (clientId) {
    await saveSocialAccount(clientId, 'x', { ...tokenDoc, authMode: 'oauth2' });
  } else {
    await tokensRef().set(tokenDoc);
  }
  await ref.delete();

  return { username: me?.data?.username || null };
}

async function readTokens() {
  const snap = await tokensRef().get();
  return snap.exists ? snap.data() : null;
}

// One X user can be assigned to more than one Hitloop client (for example the
// Underground account is the publishing owner while Hitloop is the admin
// control surface). Re-authorizing that same X user can invalidate the older
// rotating refresh token. Resolve every alias to the newest stored credential
// for the same immutable X userId instead of letting those copies compete.
async function readClientTokens(clientId) {
  const direct = await getSocialAccount(clientId, 'x');
  if (!direct?.userId) return { doc: direct, sourceClientId: clientId };
  try {
    const snap = await fb.adminDb.collection('social_accounts')
      .where('platforms.x.userId', '==', direct.userId)
      .limit(20)
      .get();
    const candidates = snap.docs
      .map((row) => ({ sourceClientId: row.id, doc: row.data()?.platforms?.x || null }))
      .filter((row) => row.doc?.accessToken)
      .sort((a, b) => Number(b.doc.updatedAt || 0) - Number(a.doc.updatedAt || 0));
    return candidates[0] || { doc: direct, sourceClientId: clientId };
  } catch {
    return { doc: direct, sourceClientId: clientId };
  }
}

function invalidRefreshError(error) {
  const err = new Error('The saved X authorization is no longer refreshable. Reconnect this X account once from either linked client dashboard, then generate a fresh approval email.');
  err.status = 409;
  err.code = 'x-reconnect-required';
  err.details = error?.data || error?.message || null;
  err.twitterError = {
    code: error?.code || error?.status || null,
    message: error?.message || null,
    data: error?.data || null,
    rateLimit: error?.rateLimit || null,
  };
  return err;
}

// Returns a user-context OAuth2 client, refreshing the (single-use, rotating)
// refresh token when the access token is near expiry. Single-admin usage —
// concurrent refreshes are not guarded against.
//
// clientId omitted (default): exact legacy behavior — the global @bai_ee
// singleton in system_flags/x_oauth_tokens, used by the X Command Center.
// clientId given: reads social_accounts/{clientId}.platforms.x, falling back
// to the legacy global doc so an already-connected @bai_ee keeps working
// before that client's first explicit per-client Connect.
export async function getXOAuth2Client(clientId = null) {
  let sourceClientId = clientId;
  let resolved = clientId ? await readClientTokens(clientId) : { doc: await readTokens(), sourceClientId: null };
  let doc = resolved.doc || (clientId ? await readTokens() : null);
  sourceClientId = resolved.doc ? resolved.sourceClientId : null;
  if (!doc?.accessToken) {
    const err = new Error(clientId
      ? 'This client has no connected X account — connect one in the Social Accounts card.'
      : 'The X account is not connected yet — run Connect in the X Command Center card.');
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
    let refreshed;
    try {
      refreshed = await appClient.refreshOAuth2Token(doc.refreshToken);
    } catch (refreshError) {
      // Rotating-token race: another invocation may have refreshed the shared
      // alias milliseconds earlier. Re-read once and use the newer record if
      // it changed; otherwise this authorization genuinely needs reconnecting.
      if (clientId) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const latest = await readClientTokens(clientId);
        if (
          latest.doc?.accessToken
          && Number(latest.doc.updatedAt || 0) > Number(doc.updatedAt || 0)
        ) {
          doc = latest.doc;
          sourceClientId = latest.sourceClientId;
          return { client: new TwitterApi(doc.accessToken), tokens: doc, sourceClientId };
        }
      }
      throw invalidRefreshError(refreshError);
    }
    const { accessToken, refreshToken, expiresIn } = refreshed;
    doc = {
      ...doc,
      accessToken,
      refreshToken: refreshToken || doc.refreshToken,
      expiresAt: Date.now() + (expiresIn || 7200) * 1000,
      updatedAt: Date.now(),
    };
    if (clientId) await saveSocialAccount(sourceClientId || clientId, 'x', { ...doc, authMode: 'oauth2' });
    else await tokensRef().set(doc);
  }
  return { client: new TwitterApi(doc.accessToken), tokens: doc, sourceClientId };
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

// ── Command-center operations (all credit-metered unless noted) ──────────────

const BOOKMARKS_CACHE_DOC = 'x_bookmarks_cache';

function bookmarksCacheRef() {
  loadEnv();
  return fb.adminDb.collection(FLAGS_COLLECTION).doc(BOOKMARKS_CACHE_DOC);
}

// OAuth 1.0a client for the few operations that are v1.1-only (profile field
// updates). Reuses the same TWITTER_* env keys as twitter-service.js.
function getOAuth1Client() {
  loadEnv();
  const appKey = stripQuotes(process.env.TWITTER_API_KEY || '');
  const appSecret = stripQuotes(process.env.TWITTER_API_SECRET || '');
  const accessToken = stripQuotes(process.env.TWITTER_ACCESS_TOKEN || '');
  const accessSecret = stripQuotes(process.env.TWITTER_ACCESS_SECRET || '');
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    const err = new Error('TWITTER_* OAuth 1.0a keys are not fully configured — profile updates need them.');
    err.status = 503;
    throw err;
  }
  return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
}

// App-only read of the project's monthly request usage. 2 HTTP calls (free
// bearer mint + the usage meta endpoint) — reports request counts against the
// monthly cap; dollar spend stays visible only in console.x.com.
export async function getXUsage() {
  loadEnv();
  const key = stripQuotes(process.env.TWITTER_API_KEY || '');
  const secret = stripQuotes(process.env.TWITTER_API_SECRET || '');
  if (!key || !secret) {
    const err = new Error('TWITTER_API_KEY/SECRET missing — cannot mint an app-only token for usage.');
    err.status = 503;
    throw err;
  }
  const basic = Buffer.from(`${key}:${secret}`).toString('base64');
  const tokenRes = await fetch('https://api.twitter.com/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`App-only token mint failed (HTTP ${tokenRes.status}).`);
  const usageRes = await fetch('https://api.twitter.com/2/usage/tweets', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const usage = await usageRes.json();
  if (!usageRes.ok) {
    const err = new Error(usage?.detail || `Usage endpoint failed (HTTP ${usageRes.status}).`);
    err.status = usageRes.status;
    throw err;
  }
  return { ...usage.data, checkedAt: Date.now() };
}

export async function readBookmarksCache() {
  const snap = await bookmarksCacheRef().get();
  return snap.exists ? snap.data() : { items: [], nextToken: null, fetchedAt: null };
}

// One GET /2/users/:id/bookmarks page (metered). Fresh fetch replaces the
// cache; passing the stored cursor appends the next page. Browsing the cache
// afterwards is free.
export async function fetchBookmarksPage({ cursor = null, max = 50 } = {}) {
  const { client } = await getXOAuth2Client();
  const opts = {
    max_results: Math.min(Math.max(max, 10), 100),
    expansions: ['author_id'],
    'tweet.fields': ['created_at', 'public_metrics'],
    'user.fields': ['username'],
  };
  if (cursor) opts.pagination_token = cursor;
  const page = await client.v2.bookmarks(opts);
  const users = new Map((page.includes?.users || []).map((u) => [u.id, u]));
  const items = (page.tweets || []).map((t) => ({
    id: t.id,
    text: t.text || '',
    createdAt: t.created_at || null,
    authorId: t.author_id || null,
    authorUsername: users.get(t.author_id)?.username || null,
    metrics: t.public_metrics || null,
  }));
  const prev = cursor ? await readBookmarksCache() : { items: [] };
  const seen = new Set(items.map((i) => i.id));
  const merged = [...(prev.items || []).filter((i) => !seen.has(i.id)), ...items];
  const cache = { items: merged, nextToken: page.meta?.next_token || null, fetchedAt: Date.now() };
  await bookmarksCacheRef().set(cache);
  return cache;
}

// DELETE /2/users/:id/bookmarks/:tweet_id (metered) + drop from cache.
export async function removeBookmark(tweetId) {
  const { client } = await getXOAuth2Client();
  await client.v2.deleteBookmark(tweetId);
  const cache = await readBookmarksCache();
  const items = (cache.items || []).filter((i) => i.id !== tweetId);
  await bookmarksCacheRef().set({ ...cache, items });
  return { items, nextToken: cache.nextToken || null, fetchedAt: cache.fetchedAt || null };
}

// GET /2/users/me with profile fields (1 metered call).
export async function loadXProfile() {
  const { client } = await getXOAuth2Client();
  const me = await client.v2.me({
    'user.fields': ['description', 'location', 'url', 'public_metrics', 'profile_image_url', 'created_at', 'protected'],
  });
  return me?.data || null;
}

// v1.1 account/update_profile over OAuth 1.0a (1 metered call). Only sends
// the fields provided — empty strings are legal (clears the field), undefined
// fields stay untouched.
export async function updateXProfile(fields = {}) {
  const client = getOAuth1Client();
  const payload = {};
  for (const key of ['name', 'description', 'location', 'url']) {
    if (typeof fields[key] === 'string') payload[key] = fields[key];
  }
  if (!Object.keys(payload).length) throw new Error('No profile fields provided.');
  const res = await client.v1.updateAccountProfile(payload);
  return { name: res?.name || null, description: res?.description || null, location: res?.location || null };
}

// Single-tweet engagement ops (1 metered call each; reply posts publicly).
export async function runTweetAction({ op, tweetId, text = '' }) {
  const { client, tokens } = await getXOAuth2Client();
  const uid = tokens.userId;
  switch (op) {
    case 'like': return { done: await client.v2.like(uid, tweetId) };
    case 'unlike': return { done: await client.v2.unlike(uid, tweetId) };
    case 'repost': return { done: await client.v2.retweet(uid, tweetId) };
    case 'unrepost': return { done: await client.v2.unretweet(uid, tweetId) };
    case 'bookmark': return { done: await client.v2.bookmark(tweetId) };
    case 'delete': return { done: await client.v2.deleteTweet(tweetId) };
    case 'reply': {
      if (!text.trim()) throw new Error('Reply text is empty.');
      const posted = await client.v2.reply(text.trim(), tweetId);
      return { done: posted, postedId: posted?.data?.id || null };
    }
    default: throw new Error(`Unknown tweet action: ${op}`);
  }
}

// Follow/unfollow by handle: 1 lookup call + 1 write call = 2 metered calls.
export async function runFollowAction({ handle, op }) {
  const clean = String(handle || '').replace(/^@/, '').trim();
  if (!clean) throw new Error('No handle provided.');
  const { client, tokens } = await getXOAuth2Client();
  const target = await client.v2.userByUsername(clean);
  const targetId = target?.data?.id;
  if (!targetId) throw new Error(`@${clean} not found.`);
  if (op === 'follow') await client.v2.follow(tokens.userId, targetId);
  else if (op === 'unfollow') await client.v2.unfollow(tokens.userId, targetId);
  else throw new Error(`Unknown follow action: ${op}`);
  return { targetId, username: target.data.username };
}
