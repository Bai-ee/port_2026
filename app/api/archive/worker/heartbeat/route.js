import { NextResponse } from 'next/server';

const workerToken = process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;

export async function POST(request) {
  if (!workerToken) return NextResponse.json({ error: 'Archive worker token is not configured' }, { status: 503 });

  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${workerToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { workerId, sourceId, jobId, state, at, counters } = payload || {};
  const allowed = new Set(['ONLINE', 'PROCESSING', 'PAUSED', 'OFFLINE', 'ERROR']);
  if (!workerId || !sourceId || !state || !at || !allowed.has(state)) {
    return NextResponse.json({ error: 'Invalid heartbeat payload' }, { status: 400 });
  }

  // POC boundary: authenticate and validate the worker contract first.
  // Durable Firebase projection is the next integration step.
  return NextResponse.json({
    ok: true,
    received: { workerId, sourceId, jobId: jobId || null, state, at, counters: counters || null },
    serverAt: new Date().toISOString(),
  });
}
