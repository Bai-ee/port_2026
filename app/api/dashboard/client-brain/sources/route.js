import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('../_context.cjs');
const { saveSourceRefs } = require('../../../../../features/client-brain/store.cjs');

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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!Array.isArray(body?.sourceRefs)) {
    return json({ error: 'sourceRefs array is required.' }, 400);
  }

  try {
    const brain = await saveSourceRefs(context.clientId, body.sourceRefs);
    return json({ ok: true, clientId: context.clientId, brain });
  } catch (err) {
    return json({ error: err.message || 'Could not save Client Brain sources.' }, err.status || 500);
  }
}
