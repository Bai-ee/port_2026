import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { runWatchlistPull } = require('../../../../features/scout-intake/watchlist-pull');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_REQUESTS_PER_CLIENT = 12;

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

/**
 * POST /api/dashboard/watchlist-pull
 *
 * Pulls each configured watchlist handle's recent X activity (last30days
 * --x-handle per handle) for the signed-in user's client. Returns one timeline
 * per handle. Does NOT run the brief pipeline and writes nothing.
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return json({ error: err.message || 'Forbidden.' }, err.status || 403);
  }
  if (!context.userProfile) return json({ error: 'No user record.' }, 404);
  const clientId = context.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  const ip = getClientIp(request);
  const rl = await checkRateLimit({
    key: `dashboard:${clientId}:watchlist-pull:${ip}`,
    limit: RATE_LIMIT_REQUESTS_PER_CLIENT,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!rl.allowed) {
    return json({ ok: false, handles: [], count: 0, error: 'Too many watchlist pulls. Try again later.' }, 429);
  }

  const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  const clientConfig = configSnap.exists ? (configSnap.data() || {}) : {};

  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }
  const detail = (body && typeof body.detail === 'object') ? body.detail : null;

  try {
    const result = await runWatchlistPull({ clientId, clientConfig, detail });
    return json(result); // 200 even on ok:false so the UI can show the message
  } catch (err) {
    return json({ ok: false, handles: [], count: 0, error: err.message || 'Watchlist pull failed.' }, 500);
  }
}
