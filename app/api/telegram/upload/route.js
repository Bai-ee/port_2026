// POST /api/telegram/upload — token-scoped web upload for Telegram files over the 20 MB bot limit.
// No login: the signed token (TELEGRAM_UPLOAD_SECRET) is the scope. All logic lives in
// features/telegram/continuation.js (completeContinuation); this file only binds real deps.
import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { completeContinuation, UPLOAD_SECRET_ENV } from '../../../../features/telegram/continuation.js';
import { createIntake } from '../../../../features/telegram/intake.js';
import { createIntakeStorage } from '../../../../features/telegram/intake-storage.js';
import { createBotTransport } from '../../../../features/telegram/transport.js';
import { upsertPackage } from '../../../../features/x-content-inventory/store.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function buildDeps() {
  const secret = process.env[UPLOAD_SECRET_ENV] || undefined;
  const db = fb.adminDb;
  const bucket = fb.adminStorage.bucket();
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const transport = botToken ? createBotTransport({ token: botToken }) : null;
  const storage = createIntakeStorage({ bucket, db, registerAsset: (pkg) => upsertPackage(pkg, { returnPackages: false }) });
  const intake = createIntake({
    db, transport, storage, now: () => Date.now(),
    send: async (chatId, text) => { if (transport) await transport.sendMessage(chatId, text); },
    // The link was already sent when the oversize file arrived (continuationSent); never mint one here.
    continuationUrl: () => '',
  });
  return { db, bucket, secret, now: () => Date.now(), attachWebUpload: intake.attachWebUpload };
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  try {
    const { status, body: out } = await completeContinuation(buildDeps(), {
      token: body?.token, action: body?.action, contentType: body?.contentType, bytes: Number(body?.bytes),
    });
    return json(out, status);
  } catch (err) {
    console.warn(`[telegram-upload] failed: ${err?.code || err?.name || 'error'}`);
    return json({ error: 'Upload failed. Please try again.' }, 500);
  }
}
