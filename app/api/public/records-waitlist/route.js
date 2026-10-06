import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { parseWaitlistBody, waitlistDocId } from '../../../../features/records-page/records-helpers.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLLECTION = 'records_waitlist';
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const parsed = parseWaitlistBody(body);
  if (parsed.honeypot) return json({ ok: true }); // silently drop bots
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const ip = getClientIp(request);
  const limit = await checkRateLimit({ key: `records-waitlist:${ip}`, limit: 5, windowSeconds: 3600, failOpen: true });
  if (!limit.allowed) return json({ error: 'Too many attempts. Try again later.' }, 429);

  const now = new Date().toISOString();
  const ref = fb.adminDb.collection(COLLECTION).doc(waitlistDocId(parsed.value.email));
  try {
    await fb.adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const userAgent = String(request.headers.get('user-agent') || '').slice(0, 160);
      const base = { ...parsed.value, source: 'records-page', userAgent, updatedAt: now };
      if (snap.exists) {
        tx.set(ref, { ...base, createdAt: snap.data().createdAt || now, submissions: (snap.data().submissions || 1) + 1 });
      } else {
        tx.set(ref, { ...base, createdAt: now, submissions: 1 });
      }
    });
  } catch (err) {
    console.error('[records-waitlist]', err?.message || err);
    return json({ error: 'Could not save right now. Try again shortly.' }, 500);
  }
  return json({ ok: true });
}
