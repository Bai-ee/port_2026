import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyAdminRequest } = require('../../../../../api/_lib/auth.cjs');
const { setSourceSetting }   = require('../../../../../features/intelligence/_store');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

const VALID_ACTIONS = ['enable', 'disable', 'rerun'];

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

  const { clientId, sourceId, action } = body || {};
  if (!clientId || !sourceId || !action) {
    return NextResponse.json({ error: 'clientId, sourceId, action required.' }, { status: 400 });
  }

  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  try {
    if (action === 'enable') {
      await setSourceSetting(clientId, sourceId, { enabled: true });
      return NextResponse.json({ ok: true, clientId, sourceId, action });
    }

    if (action === 'disable') {
      await setSourceSetting(clientId, sourceId, { enabled: false });
      return NextResponse.json({ ok: true, clientId, sourceId, action });
    }

    if (action === 'rerun') {
      const proto        = request.headers.get('x-forwarded-proto') || 'http';
      const host         = request.headers.get('host')              || 'localhost:3000';
      const workerSecret = process.env.WORKER_SECRET                || '';

      // Fire-and-forget
      fetch(`${proto}://${host}/api/intelligence/run`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': workerSecret },
        body:    JSON.stringify({ clientId, sourceId }),
      }).catch((err) => {
        console.error(`[admin/intelligence/update-source] rerun trigger failed: ${err?.message}`);
      });

      return NextResponse.json({ ok: true, clientId, sourceId, action, status: 'queued' });
    }
  } catch (err) {
    console.error('[admin/intelligence/update-source] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
