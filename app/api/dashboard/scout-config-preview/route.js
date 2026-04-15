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

/**
 * GET /api/dashboard/scout-config-preview
 *
 * Returns the signed-in user's own scoutConfig (from client_configs/{id}.
 * scoutConfig) plus a small context block so the preview page can indicate
 * staleness vs the current websiteUrl. User-authed, not admin.
 */
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized.' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }

  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: 'No user record.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const clientId = userSnap.data()?.clientId || null;
  if (!clientId) {
    return NextResponse.json({ error: 'No clientId on user record.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const [configSnap, clientSnap] = await Promise.all([
    fb.adminDb.collection('client_configs').doc(clientId).get(),
    fb.adminDb.collection('clients').doc(clientId).get(),
  ]);

  const clientConfig = configSnap.exists ? configSnap.data() : null;
  const client = clientSnap.exists ? clientSnap.data() : null;

  return NextResponse.json(
    {
      clientId,
      currentWebsiteUrl: client?.websiteUrl || null,
      scoutConfig:       clientConfig?.scoutConfig || null,
      hasConfig:         Boolean(clientConfig?.scoutConfig),
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
