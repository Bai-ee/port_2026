import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cal = require('../../../../../api/_lib/calendar-oauth.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/calendar/callback
 * Google's redirect target. NOT authenticated by Firebase — trust comes from the
 * HMAC-signed `state`, which binds the clientId. Exchanges the code, stores the
 * refresh token per client, and redirects back to the dashboard with a status.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const back = (status) => NextResponse.redirect(new URL(`/dashboard?calendar=${status}`, url.origin));

  if (oauthError) return back('denied');
  if (!cal.isConfigured()) return back('unconfigured');

  const clientId = cal.verifyState(state);
  if (!clientId || !code) return back('error');

  try {
    const tokens = await cal.exchangeCode(code);
    let email = '';
    if (tokens.access_token) email = await cal.fetchAccountEmail(tokens.access_token);
    await cal.saveConnection(clientId, {
      connected: true,
      refreshToken: tokens.refresh_token || null, // saveConnection keeps prior if null
      email,
      calendarId: 'primary',
      scope: tokens.scope || '',
    });
    return back('connected');
  } catch {
    return back('error');
  }
}
