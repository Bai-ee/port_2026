import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { safeSecretEquals } = require('../../../../api/_lib/auth.cjs');

// Telegram due-time dispatcher (Vercel cron, every 5 minutes): reprocess unfinished inbox updates, queue handoff
// cards / briefings / failure alerts that came due, finalize album intakes, and drain the outbox. Fails closed in
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
  if (!process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ ok: true, skipped: 'telegram-not-configured' });
  const { getTelegramRuntime } = await import('../../../../features/telegram/runtime.js');
  const result = await getTelegramRuntime().dispatch({ now: Date.now() });
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
