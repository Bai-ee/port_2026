import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../../api/_lib/auth.cjs');
const fb=require('../../../../../api/_lib/firebase-admin.cjs');
const {buildCollectionManifest}=require('../../../../../api/_lib/archive-manifest.cjs');
const {uploadArchiveBuffer}=require('../../../../../api/_lib/archive-arweave.cjs');
const {deployViewerIfChanged,rebuildManifestManual,readPermanenceSettings}=require('../../../../../api/_lib/archive-permanent-archive.cjs');
export const runtime='nodejs';

export async function POST(request){
  try{await verifyAdminRequest(buildAuthRequestShim(request));}catch(e){return NextResponse.json({error:'Forbidden.'},{status:403});}
  const body=await request.json();

  // W7a command-based flow (docs/archive/PERMANENT_ARCHIVE_CONTRACT.md): the
  // /archive page's PERMANENT ARCHIVE panel calls these two actions instead
  // of the legacy {collection,assets,approved} finalize body below. Both
  // enqueue a worker UPLOAD_JSON command rather than uploading bytes here —
  // the Arweave wallet lives only on the worker.
  if(body?.action==='deploy-viewer'){
    try{ return NextResponse.json(await deployViewerIfChanged()); }
    catch(e){ return NextResponse.json({error:e instanceof Error?e.message:'Viewer deploy failed'},{status:e?.status||500}); }
  }
  if(body?.action==='rebuild-manifest'){
    try{ return NextResponse.json(await rebuildManifestManual({collectionId:body.collectionId})); }
    catch(e){ return NextResponse.json({error:e instanceof Error?e.message:'Manifest rebuild failed'},{status:e?.status||500}); }
  }

  // Legacy path (pre-W7a): HITLOOP itself uploading the manifest bytes with
  // the wallet in this process. The /archive page no longer calls this
  // without an `action` — kept working for compatibility only. The
  // automatic UPLOAD_JSON collection-manifest command path above
  // (api/_lib/archive-permanent-archive.cjs rebuildManifest) is authoritative.
  const {autoUpload}=await readPermanenceSettings();
  if(autoUpload!==true)return NextResponse.json({ok:false,reason:'auto-upload-off',error:'Permanent uploads are disabled (archive_settings/permanence.autoUpload).'},{status:409});
  const {collection,assets,approved}=body;
  if(!approved)return NextResponse.json({error:'Explicit collection approval required'},{status:409});
  if(!Array.isArray(assets)||assets.length===0)return NextResponse.json({error:'Collection must contain approved permanent assets before finalization'},{status:409});
  try{
    const permanent=await fb.adminDb.collection('archive_uploads').where('kind','==','original').get();
  const txByAsset=new Map(permanent.docs.map(d=>[d.data().contentAssetId,d.data()]));
  for(const asset of assets){
    const stored=txByAsset.get(asset.id);
    if(!stored||stored.transactionId!==asset.transactionId||stored.sha256!==asset.sha256||stored.collectionId!==collection.id)
      return NextResponse.json({error:`Permanent asset verification failed for ${asset.id}`},{status:409});
  }
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
