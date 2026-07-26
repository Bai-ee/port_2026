import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { getClientWeather } = require('../../../../features/intelligence/_weather.js');

export const maxDuration = 120;

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

// Returns the current client's live forecast (or { ok, weather: null } when
// weather is disabled / unconfigured). Used by the Local Weather card + modal.
export async function GET(request) {
  let context;
  try {
    const decoded = await verifyRequestUser(makeReqShim(request));
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  if (!context?.clientId) return json({ error: 'No clientId.' }, 404);

  try {
    const weather = await getClientWeather(context.clientId);
    return json({ ok: true, weather });
  } catch (err) {
    return json({ error: err.message || 'Could not load weather.' }, 500);
  }
}
