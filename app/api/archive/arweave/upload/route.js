import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../../api/_lib/auth.cjs');
const fb=require('../../../../../api/_lib/firebase-admin.cjs');
const {uploadArchiveBuffer}=require('../../../../../api/_lib/archive-arweave.cjs');

export const runtime='nodejs';

export async function POST(request){
  try{await verifyAdminRequest(buildAuthRequestShim(request));}
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Forbidden.'},{status:403});}
  const body=await request.json();
  const {collectionId,manifest,approved}=body||{};
  if(!approved)return NextResponse.json({error:'Explicit archive approval required'},{status:409});
  if(!collectionId||!manifest)return NextResponse.json({error:'collectionId and manifest required'},{status:400});

  const bytes=Buffer.from(JSON.stringify(manifest,null,2));
  const fileName=`${String(collectionId).replace(/[^a-zA-Z0-9_-]/g,'_')}-manifest.json`;
  try{
    const result=await uploadArchiveBuffer({data:bytes,fileName,contentType:'application/json',collectionId});
    await fb.adminDb.collection('archive_uploads').doc(result.transactionId).set({
      collectionId,kind:'manifest',state:'UPLOADED',transactionId:result.transactionId,
      arweaveUrl:result.arweaveUrl,sizeBytes:result.sizeBytes,
      createdAt:fb.FieldValue.serverTimestamp(),updatedAt:fb.FieldValue.serverTimestamp()
    });
    return NextResponse.json({upload:result});
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:'Arweave upload failed'},{status:500});
  }
}
