import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// PSI audits can take 15–40s; allow 120s headroom
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { runIntelligenceSource } = require('../../../../api/_lib/intelligence-runner.cjs');

const WORKER_SECRET = process.env.WORKER_SECRET;

function hasValidWorkerSecret(request) {
  if (!WORKER_SECRET) return false;
  return request.headers.get('x-worker-secret') === WORKER_SECRET;
}

export async function POST(request) {
  // Auth — worker-secret only
  if (!hasValidWorkerSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Parse body
  let clientId, sourceId, runId;
  try {
    const body = await request.json().catch(() => ({}));
    clientId = String(body.clientId || '').trim();
    sourceId = String(body.sourceId || '').trim();
    runId    = body.runId ? String(body.runId).trim() : null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!clientId) return NextResponse.json({ error: 'clientId is required.' }, { status: 400 });
  if (!sourceId) return NextResponse.json({ error: 'sourceId is required.' }, { status: 400 });

  const result = await runIntelligenceSource(clientId, sourceId, { runId });

  if (!result.ok) {
    console.error(`[intelligence/run] ${sourceId}/${clientId} failed: ${result.error}`);
    return NextResponse.json({ ok: false, clientId, sourceId, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, clientId, sourceId, status: result.status });
}
