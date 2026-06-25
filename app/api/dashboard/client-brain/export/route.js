import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('../_context.cjs');
const { getClientBrain } = require('../../../../../features/client-brain/store.cjs');

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

  try {
    const { brain } = await getClientBrain(context.clientId);
    const contextPack = brain?.aiContextPack || {};
    return json({
      ok: true,
      clientId: context.clientId,
      status: brain?.status || 'draft',
      CLIENT_CONTEXT: contextPack.shortContext || '',
      CLIENT_CONTEXT_LONG: contextPack.longContext || '',
      promptRules: contextPack.promptRules || [],
      sourceRefs: brain?.sourceRefs || [],
    });
  } catch (err) {
    return json({ error: err.message || 'Could not export Client Brain.' }, err.status || 500);
  }
}
