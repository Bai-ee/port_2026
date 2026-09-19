import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
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
  await fb.adminDb.collection('archive_commands').doc(commandId).set({ state, jobId, error, result, updatedAt:fb.FieldValue.serverTimestamp() }, {merge:true});
  if(state==='COMPLETE' && result?.transactionId && result?.contentAssetId){
    await fb.adminDb.collection('archive_uploads').doc(result.transactionId).set({
      kind:'original',state:'UPLOADED',transactionId:result.transactionId,contentAssetId:result.contentAssetId,
      arweaveUrl:result.arweaveUrl,sizeBytes:result.sizeBytes||null,updatedAt:fb.FieldValue.serverTimestamp(),createdAt:fb.FieldValue.serverTimestamp()
    },{merge:true});
  }
  return NextResponse.json({ok:true});
}
