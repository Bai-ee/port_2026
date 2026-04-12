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

function serializeDoc(data) {
  if (!data) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.toDate === 'function') {
      out[k] = v.toDate().toISOString();
    } else if (v && typeof v === 'object' && typeof v._seconds === 'number') {
      out[k] = new Date(v._seconds * 1000).toISOString();
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = serializeDoc(v);
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
  const runId = searchParams.get('runId');
  const status = searchParams.get('status') || 'queued';

  // Single run detail
  if (runId) {
    const doc = await _fb.adminDb.collection('brief_runs').doc(String(runId)).get();
    if (!doc.exists) {
      return NextResponse.json({ error: `Run ${runId} not found.` }, { status: 404 });
    }
    return NextResponse.json({ run: serializeDoc({ id: doc.id, ...doc.data() }) });
  }

  // List by status — `queue` is queued+running
  try {
    let snapshot;
    if (status === 'queue') {
      snapshot = await _fb.adminDb
        .collection('brief_runs')
        .where('status', 'in', ['queued', 'running'])
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
    } else {
      snapshot = await _fb.adminDb
        .collection('brief_runs')
        .where('status', '==', String(status))
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
    }

    return NextResponse.json({
      runs: snapshot.docs.map((doc) => serializeDoc({ id: doc.id, ...doc.data() })),
      status,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Query failed — composite index may be missing.',
        detail: err.message,
      },
      { status: 500 }
    );
  }
}
