import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { checkRateLimit, getClientIp } = require('../../../../../api/_lib/rate-limit.cjs');
const { refreshOpportunitySignals } = require('../../../../../features/scout-intake/opportunity-signals-search.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RATE_LIMIT_WINDOW_SECONDS = 60 * 10;
const RATE_LIMIT_REQUESTS_PER_CLIENT = 6;

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
 * POST /api/dashboard/opportunity-signals/refresh
 *
 * The ONLY dashboard-triggered path that searches X for Opportunity Signals —
 * a deliberate human click, unlike the unattended pre-digest-refresh cron
 * (which always calls refreshOpportunitySignals without allowX, so it never
 * touches X). Reddit/Instagram already refresh automatically in that cron;
 * this exists so (a) a client can see results immediately after enabling the
 * feature instead of waiting for the next daily cron, and (b) X search stays
 * an explicit, visible action (paid, not tracked on the Operating Cost card —
 * see docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md).
 */
export async function POST(request) {
  let clientId;
  try {
    const decoded = await verifyRequestUser(makeReqShim(request));
    const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
    if (!context.userProfile) return json({ error: 'No user record.' }, 404);
    clientId = context.clientId || null;
    if (!clientId) return json({ error: 'No clientId on user record.' }, 404);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, err?.status || 401);
  }

  const ip = getClientIp(request);
  const rl = await checkRateLimit({
    key: `dashboard:${clientId}:opportunity-signals-refresh:${ip}`,
    limit: RATE_LIMIT_REQUESTS_PER_CLIENT,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!rl.allowed) return json({ error: 'Too many refreshes. Try again later.' }, 429);

  const result = await refreshOpportunitySignals(clientId, { allowX: true });
  if (!result.ok && result.error) return json({ ok: false, error: result.error }, 502);
  return json(result);
}
