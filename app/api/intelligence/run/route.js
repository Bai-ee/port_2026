import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// PSI audits can take 15–40s; allow 120s headroom
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { runIntelligenceSource } = require('../../../../api/_lib/intelligence-runner.cjs');
const { buildAuthRequestShim, hasValidWorkerSecret } = require('../../../../api/_lib/auth.cjs');
const { logError, logInfo } = require('../../../../api/_lib/observability.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

export async function POST(request) {
  // Auth — worker-secret only
  if (!hasValidWorkerSecret(buildAuthRequestShim(request))) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  // Parse body
  let clientId, sourceId, runId;
  try {
    const body = await request.json().catch(() => ({}));
    clientId = String(body.clientId || '').trim();
    sourceId = String(body.sourceId || '').trim();
    runId    = body.runId ? String(body.runId).trim() : null;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  if (!sourceId) return json({ error: 'sourceId is required.' }, 400);

  logInfo('intelligence_run_start', { clientId, sourceId, runId });

  let result;
  try {
    result = await runIntelligenceSource(clientId, sourceId, { runId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('intelligence_run_throw', { clientId, sourceId, runId, error: message });
    return json({ ok: false, clientId, sourceId, error: message }, 500);
  }

  if (!result.ok) {
    logError('intelligence_run_failed', { clientId, sourceId, runId, error: result.error });
    return json({ ok: false, clientId, sourceId, error: result.error }, 500);
  }

  logInfo('intelligence_run_complete', { clientId, sourceId, runId, status: result.status });
  return json({ ok: true, clientId, sourceId, status: result.status });
}
