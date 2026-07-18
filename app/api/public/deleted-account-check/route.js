import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isEmailBlocked } = require('../../../../api/_lib/deleted-accounts.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * GET /api/public/deleted-account-check?email=
 *
 * Pre-signup check: is this email barred from re-signing up (deleted account)?
 * Powers the immediate "Deleted Account, Contact Bryan." toast before the auth
 * user is created. The provision route re-checks server-side, so a failure or
 * bypass here never grants a workspace.
 */
export async function GET(request) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit({
    key: `deleted-check:ip:${ip}`,
    limit: 30,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return json({ blocked: false, error: 'Too many checks. Try again later.' }, 429);
  }

  const email = new URL(request.url).searchParams.get('email') || '';
  let blocked = false;
  try {
    blocked = await isEmailBlocked(email);
  } catch {
    // Fail-open: the provision route is the authority.
  }
  return json({ blocked });
}
