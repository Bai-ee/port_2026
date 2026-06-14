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

// GET /api/integrations/google/status — is this user's Google Calendar connected?
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  if (!gcal.isConfigured()) {
    return json({ connected: false, configured: false });
  }
  try {
    const status = await gcal.getStatus(decoded.uid);
    return json({ ...status, configured: true });
  } catch (err) {
    return json({ error: err.message || 'Status check failed.' }, 500);
  }
}
