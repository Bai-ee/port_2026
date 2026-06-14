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

// POST /api/integrations/google/disconnect — revoke + forget the user's token.
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  try {
    const status = await gcal.disconnect(decoded.uid);
    return json({ ok: true, ...status });
  } catch (err) {
    return json({ error: err.message || 'Disconnect failed.' }, 500);
  }
}
