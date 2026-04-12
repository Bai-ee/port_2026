import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const _fb = require('../../../../api/_lib/firebase-admin.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function serializeTimestamps(data) {
  if (!data) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.toDate === 'function') {
      out[k] = v.toDate().toISOString();
    } else if (v && typeof v === 'object' && typeof v._seconds === 'number') {
      out[k] = new Date(v._seconds * 1000).toISOString();
    } else if (v && typeof v === 'object' && !Array.isArray(v) && v !== null) {
      out[k] = serializeTimestamps(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function GET(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Forbidden.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId query param required.' }, { status: 400 });
  }

  const doc = await _fb.adminDb.collection('client_configs').doc(String(clientId)).get();
  if (!doc.exists) {
    return NextResponse.json({ error: `client_configs/${clientId} not found.` }, { status: 404 });
  }

  return NextResponse.json({ config: serializeTimestamps(doc.data()) });
}
