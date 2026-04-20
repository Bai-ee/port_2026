import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');

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

/**
 * POST /api/account/update-client
 *
 * Updates the signed-in user's client record. V1 supports renaming only.
 *
 * Body: { companyName: string }  // 1–120 chars, trimmed
 * Response: { ok: true, clientId, companyName }
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) return json({ error: 'No user record.' }, 404);
  const clientId = userSnap.data()?.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  let companyName;
  try {
    const body = await request.json();
    companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!companyName) return json({ error: 'companyName is required.' }, 400);
  if (companyName.length > 120) {
    return json({ error: 'companyName must be 120 characters or fewer.' }, 400);
  }

  const now = fb.FieldValue.serverTimestamp();
  await Promise.all([
    fb.adminDb.collection('clients').doc(clientId).set(
      { companyName, updatedAt: now },
      { merge: true }
    ),
    fb.adminDb.collection('dashboard_state').doc(clientId).set(
      { companyName, updatedAt: now },
      { merge: true }
    ),
  ]);

  return json({ ok: true, clientId, companyName });
}
