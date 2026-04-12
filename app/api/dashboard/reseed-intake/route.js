import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { reseedIntakeForClient } = require('../../../../api/_lib/client-provisioning.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

export async function POST(request) {
  // Auth
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Parse body
  let websiteUrl;
  try {
    const body = await request.json().catch(() => ({}));
    websiteUrl = String(body.websiteUrl || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!websiteUrl) {
    return NextResponse.json({ error: 'websiteUrl is required.' }, { status: 400 });
  }

  // Resolve clientId from the authenticated user's record
  const userDoc = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    return NextResponse.json({ error: 'User record not found.' }, { status: 404 });
  }
  const clientId = userDoc.data()?.clientId;
  if (!clientId) {
    return NextResponse.json({ error: 'No client associated with this account.' }, { status: 404 });
  }

  // Queue reseed
  let result;
  try {
    result = await reseedIntakeForClient({
      clientId,
      uid: decoded.uid,
      websiteUrl,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reseed failed.' },
      { status: 500 }
    );
  }

  // Fire-and-forget: trigger the worker to claim and execute the queued intake run.
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('host') || 'localhost:3000';
  fetch(`${proto}://${host}/api/worker/run-brief`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-secret': process.env.WORKER_SECRET || '',
    },
    body: JSON.stringify({ runId: result.runId }),
  }).catch(() => {});

  return NextResponse.json(result);
}
