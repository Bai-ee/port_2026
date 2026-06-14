'use strict';

// google-calendar.cjs — per-user Google Calendar connection.
//
// Unlike the daily-digest calendar (app/api/admin/daily-digest/route.js), which
// reads ONE owner calendar via the Firebase service account, this module lets
// each signed-in user connect THEIR OWN Google Calendar over OAuth 2.0. The
// user's refresh token is stored server-side in `user_integrations/{uid}` —
// a collection that has no Firestore rule, so it is unreachable by clients and
// only the admin SDK (these routes) can touch it.
//
// Flow:
//   1. /api/integrations/google/connect  → buildAuthUrl(signState({ uid }))
//   2. Google consent → /api/integrations/google/callback?code&state
//   3. verifyState(state) → exchangeCode(code) → storeUserToken(uid, …)
//   4. brief render → fetchTodayAgenda(uid) → { events: [...] }
//
// Required env (falls back to the existing Gmail OAuth client when the
// dedicated vars are unset, so no new Google project is strictly required):
//   GOOGLE_OAUTH_CLIENT_ID      (or GMAIL_CLIENT_ID)
//   GOOGLE_OAUTH_CLIENT_SECRET  (or GMAIL_CLIENT_SECRET)
//   GOOGLE_OAUTH_REDIRECT_URI   (optional — derived from the request origin)
//   GOOGLE_OAUTH_STATE_SECRET   (or WORKER_SECRET — signs the OAuth state)

const crypto = require('crypto');
const { google } = require('googleapis');
const fb = require('./firebase-admin.cjs');

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];
const STORE_COLLECTION = 'user_integrations';
const DEFAULT_TZ = process.env.DIGEST_TIMEZONE || 'America/Chicago';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── OAuth client ────────────────────────────────────────────────────────────

function getClientId() {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID || '';
}
function getClientSecret() {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || '';
}

/** Default redirect URI for an env that didn't set one — derived from origin. */
function defaultRedirectUri(origin) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI
    || (origin ? new URL('/api/integrations/google/callback', origin).toString() : '');
}

function isConfigured() {
  return Boolean(getClientId() && getClientSecret());
}

function oauthClient(redirectUri) {
  if (!isConfigured()) {
    throw new Error('Google OAuth is not configured — set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  return new google.auth.OAuth2(getClientId(), getClientSecret(), redirectUri);
}

// ── Signed state (CSRF-safe, carries uid through the redirect) ───────────────

function stateSecret() {
  const s = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.WORKER_SECRET || getClientSecret();
  if (!s) throw new Error('No secret available to sign the OAuth state.');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

/** Sign { uid } into a tamper-proof, short-lived state string. */
function signState({ uid }) {
  const payload = b64urlJson({ uid, exp: Date.now() + STATE_TTL_MS, nonce: b64url(crypto.randomBytes(9)) });
  const sig = b64url(crypto.createHmac('sha256', stateSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Verify a state string; returns { uid } or throws. */
function verifyState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) throw new Error('Malformed OAuth state.');
  const expected = b64url(crypto.createHmac('sha256', stateSecret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('OAuth state signature mismatch.');
  }
  let data;
  try { data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); }
  catch { throw new Error('OAuth state payload unreadable.'); }
  if (!data?.uid) throw new Error('OAuth state missing uid.');
  if (!data.exp || Date.now() > data.exp) throw new Error('OAuth state expired — please reconnect.');
  return { uid: data.uid };
}

// ── Authorize + exchange ────────────────────────────────────────────────────

function buildAuthUrl({ state, redirectUri }) {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: 'offline',     // we need a refresh token
    prompt: 'consent',          // force refresh_token on re-consent
    include_granted_scopes: true,
    scope: CALENDAR_SCOPES,
    state,
  });
}

/** Exchange the auth code for tokens and read the connected account email. */
async function exchangeCode({ code, redirectUri }) {
  const client = oauthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email = null;
  try {
    const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    email = data?.email || null;
  } catch { /* email is best-effort */ }
  return { tokens, email };
}

// ── Token storage (server-only collection) ──────────────────────────────────

async function storeUserToken(uid, { tokens, email }) {
  if (!tokens?.refresh_token) {
    // Google omits refresh_token on repeat consent without prompt=consent.
    // We force prompt=consent above, but guard anyway.
    throw new Error('Google did not return a refresh token — disconnect and reconnect.');
  }
  await fb.adminDb.collection(STORE_COLLECTION).doc(uid).set({
    googleCalendar: {
      refreshToken: tokens.refresh_token,
      email: email || null,
      calendarId: 'primary',
      scopes: CALENDAR_SCOPES,
      connectedAt: new Date().toISOString(),
    },
  }, { merge: true });
}

async function getUserToken(uid) {
  const snap = await fb.adminDb.collection(STORE_COLLECTION).doc(uid).get();
  return snap.exists ? (snap.data()?.googleCalendar || null) : null;
}

/** Public connection status — never leaks the refresh token. */
async function getStatus(uid) {
  const t = await getUserToken(uid);
  if (!t?.refreshToken) return { connected: false };
  return { connected: true, email: t.email || null, connectedAt: t.connectedAt || null };
}

async function disconnect(uid) {
  const t = await getUserToken(uid);
  if (t?.refreshToken) {
    try { await oauthClient().revokeToken(t.refreshToken); } catch { /* best-effort revoke */ }
  }
  await fb.adminDb.collection(STORE_COLLECTION).doc(uid).set({ googleCalendar: null }, { merge: true });
  return { connected: false };
}

// ── Today's agenda ──────────────────────────────────────────────────────────

/** Offset (ms) of `tz` from UTC at `date`, parsed from the IANA long offset. */
function tzOffsetMs(tz, date) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const m = part.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * ((Number(m[2]) * 60) + Number(m[3] || 0)) * 60000;
  } catch { return 0; }
}

/**
 * Fetch the user's events for *today* in their timezone, shaped for the brief
 * renderer's Standup board: { events: [{ timeLabel, summary, location }] }.
 * Returns { events: [] } when not connected; { error } on a hard failure.
 */
async function fetchTodayAgenda(uid, { timezone = DEFAULT_TZ } = {}) {
  const token = await getUserToken(uid);
  if (!token?.refreshToken) return { events: [] };
  try {
    const now = new Date();
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now); // YYYY-MM-DD in the user's tz
    const [y, mo, d] = ymd.split('-').map(Number);
    const offset = tzOffsetMs(timezone, now);
    const startUtc = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - offset);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

    const client = oauthClient();
    client.setCredentials({ refresh_token: token.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: client });
    const { data } = await calendar.events.list({
      calendarId: token.calendarId || 'primary',
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
      timeMin: startUtc.toISOString(),
      timeMax: endUtc.toISOString(),
      timeZone: timezone,
    });

    const events = (data.items || [])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => {
        const allDay = Boolean(e.start?.date && !e.start?.dateTime);
        let timeLabel = 'All day';
        if (!allDay && e.start?.dateTime) {
          timeLabel = new Date(e.start.dateTime).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', timeZone: timezone,
          });
        }
        return { timeLabel, summary: e.summary || '(busy)', location: e.location || '' };
      });
    return { events, email: token.email || null };
  } catch (err) {
    return { events: [], error: err?.message || 'Calendar fetch failed.' };
  }
}

module.exports = {
  CALENDAR_SCOPES,
  isConfigured,
  defaultRedirectUri,
  signState,
  verifyState,
  buildAuthUrl,
  exchangeCode,
  storeUserToken,
  getStatus,
  disconnect,
  fetchTodayAgenda,
};
