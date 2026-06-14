import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const gcal = require('../../../../../api/_lib/google-calendar.cjs');

export const maxDuration = 30;

// Where to send the browser back to after the OAuth round-trip.
function dashboardUrl(origin, params) {
  const url = new URL('/dashboard', origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// GET /api/integrations/google/callback?code=…&state=…
// Public endpoint (top-level browser redirect from Google — no auth header).
// Trust is established by verifying the HMAC-signed state, which carries uid.
export async function GET(request) {
  const origin = request.nextUrl?.origin || '';
  const code = request.nextUrl?.searchParams?.get('code');
  const state = request.nextUrl?.searchParams?.get('state');
  const oauthError = request.nextUrl?.searchParams?.get('error');

  if (oauthError) {
    return Response.redirect(dashboardUrl(origin, { calendar: 'error', reason: oauthError }), 302);
  }
  if (!code || !state) {
    return Response.redirect(dashboardUrl(origin, { calendar: 'error', reason: 'missing_code' }), 302);
  }

  try {
    const { uid } = gcal.verifyState(state);
    const redirectUri = gcal.defaultRedirectUri(origin);
    const { tokens, email } = await gcal.exchangeCode({ code, redirectUri });
    await gcal.storeUserToken(uid, { tokens, email });
    return Response.redirect(dashboardUrl(origin, { calendar: 'connected' }), 302);
  } catch (err) {
    console.error('[google-callback] failed:', err);
    return Response.redirect(
      dashboardUrl(origin, { calendar: 'error', reason: (err?.message || 'failed').slice(0, 80) }),
      302,
    );
  }
}
