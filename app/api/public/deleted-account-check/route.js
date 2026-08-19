import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * GET /api/public/deleted-account-check?email=
 *
 * Compatibility endpoint for older clients. Deleted-account records are audit
 * history only, so this endpoint always permits signup.
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

  return json({ blocked: false });
}
