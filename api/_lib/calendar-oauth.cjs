'use strict';

// calendar-oauth.cjs — per-client Google Calendar OAuth (one-click connect).
//
// Flow: the dashboard "Google Calendar" card POSTs /api/dashboard/calendar/connect
// (authenticated) → we return a Google consent URL whose `state` is an HMAC-signed
// token binding the clientId. Google redirects to /api/dashboard/calendar/callback
// (no Firebase session there) → we verify the signed state, exchange the code, and
// store the refresh token per client in `calendar_connections/{clientId}`.
//
// SECURITY NOTE: refresh tokens are stored in PLAINTEXT by product decision. They
// are kept in a dedicated collection (not the shared client config) to limit blast
// radius. If this decision changes, encrypt at rest here (e.g. AES-256-GCM) — the
// rest of the system only touches tokens through this module.

const crypto = require('crypto');
const { google } = require('googleapis');
const fb = require('./firebase-admin.cjs');

// calendar.readonly to fetch events; userinfo.email to label the connection.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];
const COLLECTION = 'calendar_connections';
const STATE_TTL_MS = 10 * 60 * 1000;

function oauthClientId() { return process.env.GOOGLE_OAUTH_CLIENT_ID || ''; }
function oauthClientSecret() { return process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''; }
function redirectUri() { return process.env.GOOGLE_OAUTH_REDIRECT_URI || ''; }

/** True only when the OAuth web client env is fully present. */
function isConfigured() {
  return Boolean(oauthClientId() && oauthClientSecret() && redirectUri());
}

function newOAuthClient() {
  return new google.auth.OAuth2(oauthClientId(), oauthClientSecret(), redirectUri());
}

// ── CSRF state — HMAC(clientId|nonce|ts) keyed by the OAuth client secret. The
// callback has no logged-in session, so the signed state is the only trusted
// link to a client. Valid for STATE_TTL_MS.
function signState(clientId) {
  const nonce = crypto.randomBytes(8).toString('hex');
  const ts = Date.now();
  const payload = `${clientId}|${nonce}|${ts}`;
  const sig = crypto.createHmac('sha256', oauthClientSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

/** Verify a state token; returns the clientId or null. */
function verifyState(state) {
  try {
    const decoded = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const [clientId, nonce, ts, sig] = decoded.split('|');
    if (!clientId || !nonce || !ts || !sig) return null;
    const expected = crypto.createHmac('sha256', oauthClientSecret())
      .update(`${clientId}|${nonce}|${ts}`).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Date.now() - Number(ts) > STATE_TTL_MS) return null;
    return clientId;
  } catch {
    return null;
  }
}

/** Google consent URL for a given client (forces refresh-token issuance). */
function buildAuthUrl(clientId) {
  return newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: signState(clientId),
  });
}

/** Exchange an authorization code for tokens. */
async function exchangeCode(code) {
  const { tokens } = await newOAuthClient().getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, scope, ... }
}

/** Best-effort: the connected Google account email, for display. */
async function fetchAccountEmail(accessToken) {
  try {
    const client = newOAuthClient();
    client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    return me?.data?.email || '';
  } catch {
    return '';
  }
}

async function getConnection(clientId) {
  if (!clientId) return null;
  try {
    const snap = await fb.adminDb.collection(COLLECTION).doc(clientId).get();
    return snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
}

/** Persist a connection. Never overwrites a stored refreshToken with null. */
async function saveConnection(clientId, data) {
  const payload = { ...data, updatedAt: new Date().toISOString() };
  if (payload.refreshToken == null) delete payload.refreshToken;
  await fb.adminDb.collection(COLLECTION).doc(clientId).set(payload, { merge: true });
}

async function deleteConnection(clientId) {
  await fb.adminDb.collection(COLLECTION).doc(clientId).delete();
}

/** Mint a fresh access token from the stored refresh token, or null. */
async function getAccessTokenForClient(clientId) {
  const conn = await getConnection(clientId);
  if (!conn?.refreshToken) return null;
  const client = newOAuthClient();
  client.setCredentials({ refresh_token: conn.refreshToken });
  const { token } = await client.getAccessToken();
  return token || null;
}

module.exports = {
  SCOPES,
  isConfigured,
  buildAuthUrl,
  exchangeCode,
  verifyState,
  fetchAccountEmail,
  getConnection,
  saveConnection,
  deleteConnection,
  getAccessTokenForClient,
};
