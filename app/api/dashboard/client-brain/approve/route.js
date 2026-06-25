import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('../_context.cjs');
const { markClientBrainStatus } = require('../../../../../features/client-brain/store.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveDashboardClientContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const status = body?.status || 'approved';
  try {
    const brain = await markClientBrainStatus(context.clientId, status);
    return json({ ok: true, clientId: context.clientId, brain });
  } catch (err) {
    return json({ error: err.message || 'Could not update Client Brain status.' }, err.status || 500);
  }
}
