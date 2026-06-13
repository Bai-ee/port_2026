import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

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

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  if (!context.clientId) { const e = new Error('No clientId on user record.'); e.status = 404; throw e; }
  return { decoded, context };
}

// Saves user edits to the rolling 30-day post strategy. Edited days are marked
// source:'user' so the strategy roller soft-locks them on the next brief run.
export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }

  const days = (Array.isArray(body?.days) ? body.days : [])
    .map((d) => ({
      date: String(d?.date || '').slice(0, 10),
      theme: String(d?.theme || '').trim().slice(0, 80),
      idea: String(d?.idea || '').trim().slice(0, 300),
      source: d?.source === 'user' ? 'user' : 'auto',
    }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.idea)
    .slice(0, 30);
  if (!days.length) return json({ error: 'At least one valid day is required.' }, 400);

  try {
    const ref = fb.adminDb.collection('dashboard_state').doc(context.clientId);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data()?.strategy30 || {} : {};
    const strategy30 = {
      ...prev,
      days,
      editedAtIso: new Date().toISOString(),
      editedByUid: context.userProfile?.uid || null,
    };
    await ref.set({ strategy30 }, { merge: true });
    return json({ ok: true, strategy30 });
  } catch (err) {
    return json({ error: `Firestore error: ${err.message}` }, 500);
  }
}
