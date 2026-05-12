import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const provisioningPath = require.resolve('../../../../api/_lib/client-provisioning.cjs');

function loadProvisioning() {
  if (process.env.NODE_ENV !== 'production') {
    delete require.cache[provisioningPath];
  }
  return require('../../../../api/_lib/client-provisioning.cjs');
}

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

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  let placeId;
  try {
    const body = await request.json();
    placeId = String(body?.placeId || '').trim();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const { provisionClientFromProspect } = loadProvisioning();
    if (typeof provisionClientFromProspect !== 'function') {
      return json({ error: 'Dashboard provisioning helper is not loaded. Restart the dev server and retry.' }, 500);
    }
    const result = await provisionClientFromProspect({
      placeId,
      adminUid: decoded.uid,
      adminEmail: decoded.email,
    });
    return json({ ok: true, ...result });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Could not provision dashboard.' },
      err?.status || 500
    );
  }
}
