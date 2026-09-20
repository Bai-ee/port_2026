import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../api/_lib/auth.cjs');
const fb=require('../../../../api/_lib/firebase-admin.cjs');
const {appendReviewCorrection}=require('../../../../api/_lib/archive-permanent-archive.cjs');

async function requireAdmin(request){
  try{ return { decoded: await verifyAdminRequest(buildAuthRequestShim(request)) }; }
  catch(e){ return { denied: NextResponse.json({error:e instanceof Error?e.message:'Forbidden.'},{status:403}) }; }
}

export async function GET(request){
  const {denied}=await requireAdmin(request);if(denied)return denied;
  const state=request.nextUrl.searchParams.get('state')||'REVIEW_PENDING';
  const snap=await fb.adminDb.collection('archive_review').where('state','==',state).limit(100).get();
  return NextResponse.json({items:snap.docs.map(d=>({id:d.id,...d.data()}))},{headers:{'cache-control':'no-store'}});
}

// Human review is no longer a gate on permanent publishing (the asset is
// already auto-uploaded once documented) — a PATCH here is a CORRECTION.
// It always appends to `humanCorrections[]` (audit trail) and, when the
// asset already has a permanent original, versions its archive-record JSON
// (see appendReviewCorrection / enqueueNextRecordVersionIfNeeded in
// api/_lib/archive-permanent-archive.cjs). CONFIRMED/REVIEW_PENDING state
// still reflects "has every decision been looked at", it just doesn't gate
// anything anymore.
export async function PATCH(request){
  const {decoded,denied}=await requireAdmin(request);if(denied)return denied;
  const {id,decisionId,value}=await request.json();
  if(!id||!decisionId||!value)return NextResponse.json({error:'id, decisionId and value required'},{status:400});
  try{
    const result=await appendReviewCorrection({id,decisionId,value,actor:decoded.email||decoded.uid||null});
    return NextResponse.json(result);
  }catch(e){
    const status=e && typeof e.status==='number'?e.status:500;
    return NextResponse.json({error:e instanceof Error?e.message:'Review update failed'},{status});
  }
}
