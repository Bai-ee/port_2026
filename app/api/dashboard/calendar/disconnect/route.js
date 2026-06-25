import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const cal = require('../../../../../api/_lib/calendar-oauth.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function shim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}
function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * POST /api/dashboard/calendar/disconnect
 * Authenticated. Removes the stored connection for this client.
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(shim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return json({ error: err.message || 'Forbidden.' }, err.status || 403);
  }
  const clientId = context.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  try {
    await cal.deleteConnection(clientId);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message || 'Disconnect failed.' }, 500);
  }
}
