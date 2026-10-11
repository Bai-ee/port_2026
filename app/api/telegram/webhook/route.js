import { NextResponse, after } from 'next/server';
import { createRequire } from 'module';
import { recordUpdate } from '../../../../features/telegram/store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { safeSecretEquals } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

// Telegram webhook. Verify the secret header, persist the update (duplicate update_id = no-op), acknowledge.
// Processing happens after the response (`after`) and is re-driven by the dispatch cron if this instance dies,
// so nothing slow (downloads, publishing, model calls) ever runs before Telegram gets its 200.
const MAX_BODY_BYTES = 256 * 1024;
const ACCEPTED = ['message', 'callback_query'];

const ok = () => NextResponse.json({ ok: true });

export async function POST(request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ ok: false }, { status: 503 });
  if (!safeSecretEquals(request.headers.get('x-telegram-bot-api-secret-token') || '', secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  let update;
  try {
    update = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!Number.isInteger(update?.update_id)) return NextResponse.json({ ok: false }, { status: 400 });
  // Unsupported update types are acknowledged and dropped so Telegram doesn't redeliver them.
  if (!ACCEPTED.some((k) => update[k])) return ok();

  const { duplicate, id } = await recordUpdate(fb.adminDb, update);
  if (!duplicate) {
    after(async () => {
      try {
        const { getTelegramRuntime } = await import('../../../../features/telegram/runtime.js');
        await getTelegramRuntime().processUpdate(id);
      } catch (error) {
        console.warn('[telegram-webhook] deferred processing failed; the dispatch cron will retry:', error.message);
      }
    });
  }
  return ok();
}
