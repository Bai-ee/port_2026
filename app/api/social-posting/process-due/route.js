import { NextResponse } from 'next/server';
import { processDuePostsForAllClients } from '../../../../features/social-posting/twitter-service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const auth = request.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || process.env.SOCIAL_POSTING_CRON_SECRET || '';
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    return false;
  }
  return request.headers.get('x-vercel-cron') === '1';
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const result = await processDuePostsForAllClients();
    return NextResponse.json({
      ok: true,
      posted: result.posted.length,
      failed: result.failed.length,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to process due social posts.' },
      { status: err.status || 500 }
    );
  }
}
