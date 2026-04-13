import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyAdminRequest }   = require('../../../../../api/_lib/auth.cjs');
const { setPipelineInjection } = require('../../../../../features/intelligence/_store');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

export async function POST(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Forbidden.' },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { clientId, enabled } = body || {};
  if (!clientId || enabled === undefined) {
    return NextResponse.json({ error: 'clientId and enabled required.' }, { status: 400 });
  }

  try {
    await setPipelineInjection(clientId, Boolean(enabled));
    return NextResponse.json({ ok: true, clientId, pipelineInjection: Boolean(enabled) });
  } catch (err) {
    console.error('[admin/intelligence/toggle-injection] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
