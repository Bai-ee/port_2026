import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const token = process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;

function authorized(request) { return token && request.headers.get('authorization') === `Bearer ${token}`; }

export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ error:'Unauthorized' }, {status:token?401:503});
  const body = await request.json();
  const { workerId, sourceId, label } = body || {};
  if (!workerId || !sourceId || !label) return NextResponse.json({error:'workerId, sourceId and label required'}, {status:400});
  const record = { workerId:String(workerId), sourceId:String(sourceId), label:String(label), state:body.state || 'ONLINE', updatedAt:fb.FieldValue.serverTimestamp() };
  // `kind` distinguishes browsable NAS sources from the worker's cloud-intake
  // scratch source ('cloud-intake'), which /archive must never offer for browsing.
  if (typeof body.kind === 'string' && body.kind) record.kind = body.kind;

  // Only the heartbeat route used to create archive_workers/{workerId}, so a
  // freshly registered worker stayed invisible on /archive until its first
  // heartbeat landed. Source registration now upserts the parent doc too.
  const workerRef = fb.adminDb.collection('archive_workers').doc(String(workerId));
  const existing = await workerRef.get();
  const workerUpsert = { workerId: String(workerId), updatedAt: fb.FieldValue.serverTimestamp() };
  if (!existing.exists || !existing.data()?.registeredAt) {
    workerUpsert.registeredAt = fb.FieldValue.serverTimestamp();
  }

  await Promise.all([
    workerRef.set(workerUpsert, { merge: true }),
    workerRef.collection('sources').doc(String(sourceId)).set(record, { merge: true }),
  ]);
  return NextResponse.json({ok:true});
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error:'Unauthorized' }, {status:token?401:503});
  const workerId=request.nextUrl.searchParams.get('workerId');
  if(!workerId) return NextResponse.json({error:'workerId required'},{status:400});
  const snap=await fb.adminDb.collection('archive_workers').doc(workerId).collection('sources').get();
  return NextResponse.json({sources:snap.docs.map(d=>({id:d.id,...d.data(),updatedAt:d.data().updatedAt?.toDate?.().toISOString?.()||null}))});
}
