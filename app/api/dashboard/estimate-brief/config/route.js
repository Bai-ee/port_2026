import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { normalizeEstimateConfig } from '../../../../../features/leadgen/estimate-generator.js';

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
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const snap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  const data = snap.exists ? snap.data() || {} : {};
  return json({
    ok: true,
    clientId: context.clientId,
    config: data.estimateBriefConfig || null,
  });
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const estimateBriefConfig = {
    ...normalizeEstimateConfig(body || {}, {}),
    updatedAtIso: new Date().toISOString(),
  };

  if (!estimateBriefConfig.lineItems.length) {
    return json({ error: 'At least one line item is required.' }, 400);
  }

  await fb.adminDb.collection('client_configs').doc(context.clientId).set(
    {
      estimateBriefConfig,
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return json({ ok: true, clientId: context.clientId, config: estimateBriefConfig });
}
