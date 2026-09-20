import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { listUploadedForWorker, applyWorkerTransition, purgeArchivedIntake } = require('../../../../../api/_lib/archive-worker-intake.cjs');

// Lane 2 (phone upload) intake — worker side. Same Bearer-token check as
// app/api/archive/worker/heartbeat/route.js. See docs/archive/INTAKE_CONTRACT.md.

const workerToken = process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;

function authorized(request) {
  if (!workerToken) return false;
  return (request.headers.get('authorization') || '') === `Bearer ${workerToken}`;
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store, max-age=0' } });
}

export async function GET(request) {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);
  const workerId = request.nextUrl.searchParams.get('workerId');
  try {
    const items = await listUploadedForWorker({ workerId });
    return json({ items });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'List failed.' }, error?.status || 500);
  }
}

export async function PATCH(request) {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    const result = await applyWorkerTransition(body || {});
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Transition failed.' }, error?.status || 500);
  }
}

export async function DELETE(request) {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    const result = await purgeArchivedIntake(body || {});
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Purge failed.' }, error?.status || 500);
  }
}
