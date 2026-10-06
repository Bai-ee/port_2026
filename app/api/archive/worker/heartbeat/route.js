import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const workerToken = process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;
const allowedStates = new Set(['ONLINE', 'PROCESSING', 'PAUSED', 'OFFLINE', 'ERROR']);

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store, max-age=0' } });
}

export async function POST(request) {
  if (!workerToken) return json({ error: 'Archive worker token is not configured' }, 503);
  if ((request.headers.get('authorization') || '') !== `Bearer ${workerToken}`) return json({ error: 'Unauthorized' }, 401);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { workerId, sourceId, jobId, state, at, counters, capabilities, localThumbBase } = payload || {};
  if (!workerId || !sourceId || !state || !at || !allowedStates.has(state)) return json({ error: 'Invalid heartbeat payload' }, 400);
  if (Number.isNaN(Date.parse(at))) return json({ error: 'Invalid heartbeat timestamp' }, 400);

  const now = new Date().toISOString();
  // The daemon sends an idle ONLINE heartbeat with no counters on startup and
  // every ~60s. Writing `counters: null` for that heartbeat used to blank out
  // a completed job's numbers the instant the job finished. Only touch the
  // `counters` field when this heartbeat actually carries one.
  const hasCounters = Boolean(counters) && typeof counters === 'object';
  const record = {
    workerId: String(workerId),
    sourceId: String(sourceId),
    jobId: jobId ? String(jobId) : null,
    state,
    workerAt: at,
    lastHeartbeatAt: fb.FieldValue.serverTimestamp(),
    updatedAt: fb.FieldValue.serverTimestamp(),
  };
  // Analyzer heartbeats advertise what they can do and where local thumbs live.
  if (Array.isArray(capabilities)) record.capabilities = capabilities.map(String).slice(0, 20);
  if (typeof localThumbBase === 'string' && localThumbBase) record.localThumbBase = localThumbBase.slice(0, 500);
  if (hasCounters) {
    record.counters = counters;
    // Survives even if a later job's own early heartbeats reset `counters`
    // to a fresh zero state before the UI ever reads them.
    record.lastJobCounters = counters;
    record.lastJobAt = fb.FieldValue.serverTimestamp();
  }

  // One stable worker document gives the operator surface a cheap current-state read.
  // A source subdocument preserves per-NAS/source status without exposing local paths.
  const workerRef = fb.adminDb.collection('archive_workers').doc(String(workerId));
  const sourceRef = workerRef.collection('sources').doc(String(sourceId));
  await Promise.all([
    workerRef.set(record, { merge: true }),
    sourceRef.set({ ...record, workerId: String(workerId) }, { merge: true }),
  ]);

  return json({ ok: true, received: { workerId, sourceId, jobId: jobId || null, state, at, counters: hasCounters ? counters : null }, serverAt: now });
}

export async function GET() {
  return json({ error: 'Method not allowed' }, 405);
}
