import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../../api/_lib/auth.cjs');
const fb=require('../../../../../api/_lib/firebase-admin.cjs');
const {buildCollectionManifest}=require('../../../../../api/_lib/archive-manifest.cjs');
const {uploadArchiveBuffer}=require('../../../../../api/_lib/archive-arweave.cjs');
export const runtime='nodejs';

export async function POST(request){
  try{await verifyAdminRequest(buildAuthRequestShim(request));}catch(e){return NextResponse.json({error:'Forbidden.'},{status:403});}
  const {collection,assets,approved}=await request.json();
  if(!approved)return NextResponse.json({error:'Explicit collection approval required'},{status:409});
  if(!Array.isArray(assets)||assets.length===0)return NextResponse.json({error:'Collection must contain approved permanent assets before finalization'},{status:409});
  try{
    const manifest=buildCollectionManifest({collection,assets});
    const data=Buffer.from(JSON.stringify(manifest,null,2));
    const uploaded=await uploadArchiveBuffer({data,fileName:`${collection.id}-manifest.json`,contentType:'application/json',collectionId:collection.id});
    await fb.adminDb.collection('archive_collections').doc(String(collection.id)).set({
      title:manifest.collection.title,state:'ARCHIVED',manifestTransactionId:uploaded.transactionId,
      manifestUrl:uploaded.arweaveUrl,assetCount:manifest.assets.length,
      updatedAt:fb.FieldValue.serverTimestamp(),createdAt:fb.FieldValue.serverTimestamp()
    },{merge:true});
    return NextResponse.json({manifest,upload:uploaded});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Manifest upload failed'},{status:500});}
}
