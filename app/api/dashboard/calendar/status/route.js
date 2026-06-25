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
 * GET /api/dashboard/calendar/status
 * Authenticated. Reports whether OAuth is configured server-side and whether this
 * client has a live connection (refresh token present).
 */
export async function GET(request) {
  const configured = cal.isConfigured();

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
  const conn = clientId ? await cal.getConnection(clientId) : null;

  return json({
    configured,
    connected: Boolean(conn?.connected && conn?.refreshToken),
    email: conn?.email || '',
    calendarId: conn?.calendarId || 'primary',
  });
}
