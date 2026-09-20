import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

function serialize(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value.toDate === 'function') out[key] = value.toDate().toISOString();
    else out[key] = value;
  }
  return out;
}

export async function GET(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Forbidden.' }, { status: 403 });
  }

  const snapshot = await fb.adminDb.collection('archive_workers').get();
  const workers = snapshot.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }));
  workers.sort((a, b) => Date.parse(b.lastHeartbeatAt || 0) - Date.parse(a.lastHeartbeatAt || 0));
  return NextResponse.json({ workers }, { headers: { 'cache-control': 'no-store, max-age=0' } });
}
