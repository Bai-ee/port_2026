import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const fb=require('../../../../../api/_lib/firebase-admin.cjs');

function workerAuthorized(request){
 const expected=process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;
 const supplied=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 return Boolean(expected&&supplied&&supplied===expected);
}
export async function POST(request){
 if(!workerAuthorized(request))return NextResponse.json({error:'Unauthorized'},{status:401});
 const body=await request.json();
 const {workerId,sourceId,collectionJobId,asset}=body||{};
 if(!workerId||!sourceId||!asset?.id||!asset?.sha256)return NextResponse.json({error:'workerId, sourceId and asset identity required'},{status:400});
 const reviewId=String(asset.id);
 const sourcePaths=(asset.sourcePaths||[]).map(p=>String(p).replace(/^\/+/, '')).filter(p=>!p.includes('..'));
 const decisions=(asset.decisions||[]).map(d=>({
   id:d.id||d.question,question:d.question,choices:d.choices||[],selectedValue:d.selectedValue||d.selected,
   confidence:Number(d.confidence||0),reviewBand:d.reviewBand||null,evidence:d.evidence||[]
 }));
 const state=decisions.length?'REVIEW_PENDING':(asset.state||'ANALYZED');
 await fb.adminDb.collection('archive_review').doc(reviewId).set({
   assetId:reviewId,sha256:String(asset.sha256),mediaType:asset.mediaType||null,sizeBytes:Number(asset.sizeBytes||0),
   archiveName:asset.archiveName||null,sourcePaths,observations:asset.observations||[],decisions,
   workerId:String(workerId),sourceId:String(sourceId),collectionJobId:collectionJobId||null,state,
   syncedAt:fb.FieldValue.serverTimestamp(),updatedAt:fb.FieldValue.serverTimestamp()
 },{merge:true});
 return NextResponse.json({ok:true,id:reviewId,state});
}
