import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { handleCommandComplete } = require('../../../../../api/_lib/archive-permanent-archive.cjs');
const token = process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;

function authorized(request) { return token && request.headers.get('authorization') === `Bearer ${token}`; }

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: token ? 401 : 503 });
  const workerId = request.nextUrl.searchParams.get('workerId');
  if (!workerId) return NextResponse.json({ error: 'workerId required' }, { status: 400 });
  const snap = await fb.adminDb.collection('archive_commands').where('workerId','==',workerId).where('state','==','QUEUED').limit(10).get();
  return NextResponse.json({ commands: snap.docs.map(d => ({ id:d.id, ...d.data(), createdAt:d.data().createdAt?.toDate?.().toISOString?.() || null })) }, { headers:{'cache-control':'no-store'} });
}

export async function PATCH(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: token ? 401 : 503 });
  const body = await request.json();
  const { commandId, state, jobId = null, error = null, result = null } = body || {};
  if (!commandId || !['CLAIMED','RUNNING','COMPLETE','FAILED'].includes(state)) return NextResponse.json({ error:'Invalid command update' }, {status:400});

  // Read the command before overwriting its state — handleCommandComplete
  // needs its type/workerId/refs, which the incoming PATCH body doesn't carry.
  const cmdRef = fb.adminDb.collection('archive_commands').doc(commandId);
  const cmdSnap = await cmdRef.get();
  const cmdData = cmdSnap.exists ? cmdSnap.data() : null;

  await cmdRef.set({ state, jobId, error, result, updatedAt: fb.FieldValue.serverTimestamp() }, { merge: true });

  // UPLOAD_ASSET_ARWEAVE COMPLETE -> archive_uploads write + versions the
  // asset's archive-record JSON. UPLOAD_JSON COMPLETE -> upserts
  // archive_records / archive_collections / archive_settings per kind, and
  // (for archive-record) re-checks whether the collection's manifest can now
  // rebuild. See api/_lib/archive-permanent-archive.cjs.
  if (state === 'COMPLETE' && cmdData) {
    try { await handleCommandComplete({ command: cmdData, result }); }
    catch (e) { console.error('[archive] handleCommandComplete failed for', commandId, e); }
  }

  return NextResponse.json({ok:true});
}
