import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const gcal = require('../../../../../api/_lib/google-calendar.cjs');

export const maxDuration = 15;

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

// GET /api/integrations/google/connect
// Returns the Google consent URL for the caller to redirect their browser to.
// State carries the (HMAC-signed) uid so the public callback can be trusted.
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  if (!gcal.isConfigured()) {
    return json({ error: 'Google OAuth is not configured on this environment.' }, 503);
  }
  try {
    const redirectUri = gcal.defaultRedirectUri(request.nextUrl?.origin);
    const state = gcal.signState({ uid: decoded.uid });
    const url = gcal.buildAuthUrl({ state, redirectUri });
    return json({ url });
  } catch (err) {
    return json({ error: err.message || 'Could not start Google connect.' }, 500);
  }
}
