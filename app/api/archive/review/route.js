import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../../api/_lib/auth.cjs');
const fb=require('../../../../../api/_lib/firebase-admin.cjs');

async function auth(request){try{await verifyAdminRequest(buildAuthRequestShim(request));return null}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Forbidden.'},{status:403})}}

export async function GET(request){
  const denied=await auth(request);if(denied)return denied;
  const state=request.nextUrl.searchParams.get('state')||'REVIEW_PENDING';
  const snap=await fb.adminDb.collection('archive_review').where('state','==',state).limit(100).get();
  return NextResponse.json({items:snap.docs.map(d=>({id:d.id,...d.data()}))},{headers:{'cache-control':'no-store'}});
}

export async function PATCH(request){
  const denied=await auth(request);if(denied)return denied;
  const {id,decisionId,value}=await request.json();
  if(!id||!decisionId||!value)return NextResponse.json({error:'id, decisionId and value required'},{status:400});
  await fb.adminDb.collection('archive_review').doc(id).set({
    state:'CONFIRMED',humanDecision:{decisionId,value},confirmedAt:fb.FieldValue.serverTimestamp(),updatedAt:fb.FieldValue.serverTimestamp()
  },{merge:true});
  return NextResponse.json({ok:true});
}
