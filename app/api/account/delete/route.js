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
 * POST /api/account/delete
 *
 * Permanently deletes the signed-in user's account. Removes, in order:
 *   1. Firebase Storage files under clients/{clientId}/
 *   2. Firestore dashboard_state, client_configs, clients/{clientId} (+ subcollections), users/{uid}
 *   3. Firebase Auth user
 *
 * Logs an audit record to account_deletions/{uid} before the user doc is gone.
 *
 * Each step collects errors but does not short-circuit so partial cleanup still
 * progresses. The client is expected to sign out and redirect regardless.
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const uid = decoded.uid;
  const email = decoded.email || null;
  const errors = [];

  let clientId = null;
  try {
    const userSnap = await fb.adminDb.collection('users').doc(uid).get();
    clientId = userSnap.exists ? (userSnap.data()?.clientId || null) : null;
  } catch (err) {
    errors.push({ step: 'read_user_doc', message: err?.message || String(err) });
  }

  // 0. Audit log (best-effort; done first so we still have the record if later steps throw)
  try {
    await fb.adminDb.collection('account_deletions').doc(uid).set({
      uid,
      email,
      clientId,
      deletedAt: fb.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    errors.push({ step: 'audit_log', message: err?.message || String(err) });
  }

  // 1. Storage: delete everything under clients/{clientId}/
  if (clientId) {
    try {
      const bucket = fb.adminStorage.bucket();
      await bucket.deleteFiles({ prefix: `clients/${clientId}/`, force: true });
    } catch (err) {
      errors.push({ step: 'storage_delete', message: err?.message || String(err) });
    }
  }

  // 2. Firestore: recursive delete on client-scoped docs
  if (clientId) {
    const clientDocPaths = [
      fb.adminDb.collection('dashboard_state').doc(clientId),
      fb.adminDb.collection('client_configs').doc(clientId),
      fb.adminDb.collection('clients').doc(clientId),
    ];
    for (const ref of clientDocPaths) {
      try {
        await fb.adminDb.recursiveDelete(ref);
      } catch (err) {
        errors.push({ step: `firestore_delete:${ref.path}`, message: err?.message || String(err) });
      }
    }
  }

  // 3. Firestore: delete the users/{uid} record
  try {
    await fb.adminDb.collection('users').doc(uid).delete();
  } catch (err) {
    errors.push({ step: 'firestore_delete:users', message: err?.message || String(err) });
  }

  // 4. Firebase Auth: delete the identity last so retries are safe
  try {
    await fb.adminAuth.deleteUser(uid);
  } catch (err) {
    errors.push({ step: 'auth_delete', message: err?.message || String(err) });
  }

  if (errors.length > 0) {
    return json({ ok: false, uid, clientId, errors }, 500);
  }
  return json({ ok: true, uid, clientId });
}
