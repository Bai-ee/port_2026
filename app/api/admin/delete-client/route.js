import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function batchDelete(db, query) {
  const snap = await query.get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function deleteIfExists(db, ref) {
  try { await ref.delete(); } catch { /* non-fatal */ }
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  let clientId;
  try {
    const body = await request.json();
    clientId = String(body.clientId || '').trim();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!clientId) return json({ error: 'clientId is required.' }, 400);

  // Gate: admin must be in admins collection AND client must be accessible.
  // Mirrors canAdminAccessClient: check explicit roster first, then fall back
  // to clients/{id} existence (listAdminDashboards shows all clients in the
  // collection, so any client visible in the UI is fair game to delete).
  const adminEmail = (decoded.email || '').toLowerCase().trim();
  const [adminSnap, clientSnap] = await Promise.all([
    fb.adminDb.collection('admins').doc(adminEmail).get(),
    fb.adminDb.collection('clients').doc(clientId).get(),
  ]);
  if (!adminSnap.exists) {
    return json({ error: 'Forbidden.' }, 403);
  }
  const adminDashboards = adminSnap.data()?.adminDashboards || [];
  const inRoster = adminDashboards.includes(clientId);
  const clientExists = clientSnap.exists;
  if (!inRoster && !clientExists) {
    return json({ error: 'Client not found.' }, 404);
  }

  const db = fb.adminDb;

  try {
    await Promise.allSettled([
      // clients + all subcollections (members/, system/, brief_runs/)
      db.recursiveDelete(db.collection('clients').doc(clientId)),
      // flat config/state docs
      db.collection('client_configs').doc(clientId).delete(),
      db.collection('dashboard_state').doc(clientId).delete(),
      // optional collections — non-fatal if missing
      deleteIfExists(db, db.collection('digest_config').doc(clientId)),
      deleteIfExists(db, db.collection('intelligence').doc(clientId)),
      deleteIfExists(db, db.collection('items').doc(clientId)),
      deleteIfExists(db, db.collection('knowledge_base').doc(clientId)),
      // top-level brief_runs keyed by clientId field
      batchDelete(db, db.collection('brief_runs').where('clientId', '==', clientId)),
      // user docs that still reference this clientId
      batchDelete(db, db.collection('users').where('clientId', '==', clientId)),
    ]);

    // Remove from admin dashboard roster
    await db.collection('admins').doc(adminEmail).update({
      adminDashboards: fb.FieldValue.arrayRemove(clientId),
    });

    return json({ ok: true, clientId });
  } catch (err) {
    console.error('[delete-client] error:', err?.message);
    return json({ error: err?.message || 'Delete failed.' }, 500);
  }
}
