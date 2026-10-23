import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { safeSecretEquals } = require('../../../../api/_lib/auth.cjs');

// Instagram long-lived token renewal (Vercel cron, daily). Renews every
// client's Instagram token that is inside the refresh window; a failure is
// recorded on that client's account (refreshError) for the Social Accounts
// card. Free: Meta's refresh endpoint is not metered. Fails closed in
// production without CRON_SECRET; locally it accepts Vercel's cron header only.
const isProduction = () => (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development') || process.env.NODE_ENV === 'production';

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) return safeSecretEquals(request.headers.get('authorization') || '', `Bearer ${secret}`);
  if (isProduction()) return false;
  return request.headers.get('x-vercel-cron') === '1';
}

async function run(request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const { refreshDueInstagramTokens } = await import('../../../../features/social-posting/instagram-oauth.js');
  const result = await refreshDueInstagramTokens();
  if (result.failed.length || result.expired.length) {
    console.warn('[instagram-token-refresh]', JSON.stringify({ failed: result.failed, expired: result.expired }));
  }
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
