import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { searchEvents } = require('../../../../features/scout-intake/events-search');

function getProviderFactory() {
  return require('../../../../features/not-the-rug-brief/providers');
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

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  if (!context.clientId) { const e = new Error('No clientId on user record.'); e.status = 404; throw e; }
  return { decoded, context };
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === 'global' ? 'global' : 'local';
  const zip = String(body?.zip || '').replace(/\D/g, '').slice(0, 5);
  const keywords = String(body?.keywords || '').trim().slice(0, 200);

  const configSnap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  const clientConfig = configSnap.exists ? configSnap.data() || {} : {};

  try {
    const { initProvider } = getProviderFactory();
    const provider = initProvider(clientConfig?.providerConfig || { defaultProvider: 'anthropic' });
    const { events } = await searchEvents({ mode, zip, keywords, provider });
    return json({ ok: true, mode, events });
  } catch (err) {
    return json({ error: err?.message || 'Event search failed.' }, 500);
  }
}
