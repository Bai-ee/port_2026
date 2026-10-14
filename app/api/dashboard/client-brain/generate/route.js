import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('../_context.cjs');
const { generateAndSaveClientBrain } = require('../../../../../features/client-brain/store.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request) {
  let context;
  let decoded;
  try {
    ({ context, decoded } = await resolveDashboardClientContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  // Optional model-based regeneration: body { mode: 'llm' }. Default is the
  // deterministic build; invalid/missing body falls back to deterministic.
  let mode = 'deterministic';
  try {
    const body = await request.json();
    if (body?.mode === 'llm') mode = 'llm';
  } catch { /* no body — deterministic */ }

  try {
    const result = await generateAndSaveClientBrain(context.clientId, { mode, byUid: decoded?.uid || null });
    // result.mode is 'markdown' when the stored Markdown was recompiled instead of rebuilt.
    return json({ ok: true, clientId: context.clientId, mode: result.mode, brain: result.brain });
  } catch (err) {
    return json({ error: err.message || 'Could not generate Client Brain.' }, err.status || 500);
  }
}
