import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { safeSecretEquals } = require('../../../../api/_lib/auth.cjs');

// CQ daily brief video (Vercel cron, every 15 min). Each tick attaches a finished render, fails/re-pokes stale jobs,
// and starts at most one new `brief_video_jobs` render for an allowlisted client's next brief draft. The Cloud Run
// showcase-render service does the render; this route never renders or posts. Off unless DAILY_BRIEF_VIDEO_ENABLED=true.
// ?dryRun=1 lists the parsed briefs and writes nothing (works while the flag is off). ?postId=&force=1 re-renders a
// draft whose media came from a bv_ job. Same CRON_SECRET auth as instagram-token-refresh (fails closed in production).
const isProduction = () => (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development') || process.env.NODE_ENV === 'production';

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) return safeSecretEquals(request.headers.get('authorization') || '', `Bearer ${secret}`);
  if (isProduction()) return false;
  return request.headers.get('x-vercel-cron') === '1';
}

async function run(request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const { runTick, dryRun, defaultDb } = await import('../../../../features/brief-video/worker.js');
  const db = defaultDb();
  if (params.get('dryRun') === '1') return NextResponse.json(await dryRun({ db }), { headers: { 'cache-control': 'no-store' } });
  if (process.env.DAILY_BRIEF_VIDEO_ENABLED !== 'true') return NextResponse.json({ ok: true, disabled: true });
  try {
    const report = await runTick({ db, postId: params.get('postId') || null, force: params.get('force') === '1' });
    return NextResponse.json(report, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn('[cq-daily-video]', err?.message || err);
    return NextResponse.json({ ok: false, error: 'tick failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
