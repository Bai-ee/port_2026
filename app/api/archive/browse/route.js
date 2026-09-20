import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

export async function POST(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); }
  catch (e) { return NextResponse.json({error:e instanceof Error?e.message:'Forbidden.'},{status:403}); }
  const body=await request.json();
  const {workerId,sourceId,relativePath='.'}=body||{};
  if(!workerId||!sourceId||typeof relativePath!=='string') return NextResponse.json({error:'workerId, sourceId and relativePath required'},{status:400});
  if(relativePath.startsWith('/')||relativePath.split(/[\\/]+/).includes('..')) return NextResponse.json({error:'Invalid relative path'},{status:400});
  const id=randomUUID();
  await fb.adminDb.collection('archive_commands').doc(id).set({
    id,type:'LIST_DIRECTORY',workerId:String(workerId),sourceId:String(sourceId),relativePath,
    state:'QUEUED',createdAt:fb.FieldValue.serverTimestamp(),updatedAt:fb.FieldValue.serverTimestamp()
  });
  return NextResponse.json({ok:true,commandId:id},{status:202});
}

export async function GET(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); }
  catch (e) { return NextResponse.json({error:e instanceof Error?e.message:'Forbidden.'},{status:403}); }
  const commandId=request.nextUrl.searchParams.get('commandId');
  if(!commandId) return NextResponse.json({error:'commandId required'},{status:400});
  const doc=await fb.adminDb.collection('archive_commands').doc(commandId).get();
  if(!doc.exists) return NextResponse.json({error:'Not found'},{status:404});
  const d=doc.data();
  return NextResponse.json({id:doc.id,state:d.state,result:d.result||null,error:d.error||null});
}
