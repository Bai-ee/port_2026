import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const fb=require('../../../../../api/_lib/firebase-admin.cjs');
const {resolveCollectionForJob,autoEnqueueArchiveUpload}=require('../../../../../api/_lib/archive-permanent-archive.cjs');

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

 const ref=fb.adminDb.collection('archive_review').doc(reviewId);
 // Read-before-write: a resync that fails to resolve the collection (e.g. the
 // PROCESS_COLLECTION command doc isn't visible yet) must never blank a
 // collectionId a prior sync already resolved.
 const priorSnap=await ref.get();
 const prior=priorSnap.exists?priorSnap.data():null;

 let collection=null;
 try{ collection=await resolveCollectionForJob({collectionJobId}); }catch{ collection=null; }
 const collectionId=collection?.id||prior?.collectionId||null;
 const collectionTitle=collection?.title||prior?.collectionTitle||null;

 const patch={
   assetId:reviewId,sha256:String(asset.sha256),mediaType:asset.mediaType||null,sizeBytes:Number(asset.sizeBytes||0),
   archiveName:asset.archiveName||null,sourcePaths,observations:asset.observations||[],decisions,
   workerId:String(workerId),sourceId:String(sourceId),collectionJobId:collectionJobId||null,state,
   syncedAt:fb.FieldValue.serverTimestamp(),updatedAt:fb.FieldValue.serverTimestamp()
 };
 if(collectionId){patch.collectionId=collectionId;patch.collectionTitle=collectionTitle;}
 await ref.set(patch,{merge:true});

 // Auto-enqueue the permanent Arweave upload once this asset is "documented"
 // (hashed, TwelveLabs evidence READY, six Jev decisions present) — no
 // per-asset approval click. Best-effort: a failure here must never fail the
 // sync itself (the worker will just retry on its next poll/sync cycle).
 let archiveUploadQueued=false;
 try{
   const commandId=await autoEnqueueArchiveUpload({
     workerId,sourceId,reviewId,collectionId,sourcePaths,archiveName:asset.archiveName,
     mediaType:asset.mediaType,sha256:asset.sha256,observations:asset.observations||[],decisions,
   });
   archiveUploadQueued=Boolean(commandId);
 }catch{ archiveUploadQueued=false; }

 return NextResponse.json({ok:true,id:reviewId,state,collectionId,archiveUploadQueued});
}
