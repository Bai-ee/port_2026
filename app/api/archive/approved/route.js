import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../../api/_lib/auth.cjs');
const fb=require('../../../../../api/_lib/firebase-admin.cjs');

async function auth(r){try{await verifyAdminRequest(buildAuthRequestShim(r));return null}catch{return NextResponse.json({error:'Forbidden.'},{status:403})}}

export async function GET(request){
 const denied=await auth(request);if(denied)return denied;
 const jobId=request.nextUrl.searchParams.get('jobId');
 let q=fb.adminDb.collection('archive_review').where('state','==','CONFIRMED');
 if(jobId)q=q.where('collectionJobId','==',jobId);
 const snap=await q.limit(500).get();
 const assets=snap.docs.map(d=>{const x=d.data();return {id:d.id,sha256:x.sha256,sizeBytes:Number(x.sizeBytes||0),archiveName:x.archiveName||x.sourcePaths?.[0]?.split('/').pop()||d.id,sourcePaths:x.sourcePaths||[],sourceId:x.sourceId,workerId:x.workerId,collectionJobId:x.collectionJobId,humanDecision:x.humanDecision,decisions:x.decisions||[]};});
 return NextResponse.json({assets,totalBytes:assets.reduce((n,a)=>n+a.sizeBytes,0),assetCount:assets.length},{headers:{'cache-control':'no-store'}});
}
