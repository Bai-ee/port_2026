import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../../api/_lib/auth.cjs');
const fb=require('../../../../../api/_lib/firebase-admin.cjs');

export async function POST(request){
  try{await verifyAdminRequest(buildAuthRequestShim(request));}
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Forbidden.'},{status:403});}
  const body=await request.json();
  const {workerId,sourceId,relativePath,contentAssetId,collectionId,archiveName,contentType,expectedSha256,approved}=body||{};
  if(!approved)return NextResponse.json({error:'Explicit archive approval required'},{status:409});
  if(!workerId||!sourceId||!relativePath||!contentAssetId||!collectionId||!archiveName||!expectedSha256)
    return NextResponse.json({error:'Missing approved asset upload fields'},{status:400});
  if(relativePath.startsWith('/')||relativePath.split(/[\\/]+/).includes('..'))
    return NextResponse.json({error:'Invalid relative path'},{status:400});
  const id=randomUUID();
  await fb.adminDb.collection('archive_commands').doc(id).set({
    id,type:'UPLOAD_ASSET_ARWEAVE',workerId:String(workerId),sourceId:String(sourceId),relativePath:String(relativePath),
    contentAssetId:String(contentAssetId),collectionId:String(collectionId),archiveName:String(archiveName),
    contentType:contentType||'application/octet-stream',expectedSha256:String(expectedSha256),
    state:'QUEUED',approved:true,createdAt:fb.FieldValue.serverTimestamp(),updatedAt:fb.FieldValue.serverTimestamp()
  });
  return NextResponse.json({ok:true,commandId:id,state:'QUEUED'},{status:202});
}
