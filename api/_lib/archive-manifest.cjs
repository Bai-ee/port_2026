'use strict';

const { basename } = require('./archive-record.cjs');

function buildCollectionManifest({collection,assets,decisions=[]}){
  if(!collection?.id) throw new Error('collection.id required');
  const rows=(assets||[]).map(a=>{
    if(!a.transactionId||!a.sha256) throw new Error('Every permanent asset requires transactionId and sha256');
    return {
      id:a.id,archiveName:a.archiveName,sha256:a.sha256,sizeBytes:a.sizeBytes||null,
      contentType:a.contentType||'application/octet-stream',
      transactionId:a.transactionId,arweaveUrl:a.arweaveUrl||`https://arweave.net/${a.transactionId}`,
      sourcePaths:a.sourcePaths||[],observations:a.observations||[],decisions:a.decisions||[]
    };
  });
  return {
    schemaVersion:'1.0',
    collection:{id:collection.id,title:collection.title||collection.id,description:collection.description||'',generatedAt:new Date().toISOString()},
    assets:rows,decisions,
    provenance:{sourceSystem:'HITLOOP Archive',originalsReadOnly:true,contentAddressing:'sha256'},
  };
}
// Collection manifest — schema 1.1 (docs/archive/PERMANENT_ARCHIVE_CONTRACT.md §D).
// Each row is already-resolved (the caller — api/_lib/archive-permanent-archive.cjs
// — supplies `decisions:[{id,question,value}]` with the human-preferred value
// already picked, and `recordTransactionId`/`recordVersion` pointing at that
// asset's own archive-record JSON, separate from `originalTransactionId`
// which points at the original media file). Superset of `buildCollectionManifest`
// (kept above, unchanged, for its existing callers/tests) — this is the one
// the automatic UPLOAD_JSON collection-manifest command path builds.
function buildCollectionManifestV11({collection,version=1,previousManifestTransactionId=null,assets=[],viewerTransactionId=null,now}){
  if(!collection?.id) throw new Error('collection.id required');
  const generatedAt=now||new Date().toISOString();
  const rows=(assets||[]).map(a=>{
    if(!a.originalTransactionId||!a.sha256) throw new Error('Every manifest asset requires originalTransactionId and sha256');
    return {
      id:a.id,
      sha256:a.sha256,
      sizeBytes:a.sizeBytes??null,
      mediaType:a.mediaType||null,
      contentType:a.contentType||'application/octet-stream',
      archiveName:basename(a.archiveName)||a.archiveName||a.id,
      originalTransactionId:a.originalTransactionId,
      originalUrl:a.originalUrl||`https://arweave.net/${a.originalTransactionId}`,
      recordTransactionId:a.recordTransactionId||null,
      recordVersion:a.recordVersion||null,
      decisions:(a.decisions||[]).map(d=>({id:d.id,question:d.question||null,value:d.value})),
    };
  });
  return {
    schemaVersion:'1.1',
    recordType:'collection-manifest',
    version:Number(version)||1,
    previousManifestTransactionId:previousManifestTransactionId||null,
    collection:{id:collection.id,title:collection.title||collection.id,generatedAt},
    assets:rows,
    viewerTransactionId:viewerTransactionId||null,
    // Aggregate proxy at the collection level: how many distinct content
    // assets this manifest vouches for. Each row's own per-asset location
    // count (how many places on the NAS it was found) lives only in that
    // asset's own archive-record JSON (schema C), never here — the manifest
    // never carries NAS paths either.
    provenance:{sourceCount:rows.length,sourceSystem:'HITLOOP Archive',originalsReadOnly:true,contentAddressing:'sha256'},
  };
}

module.exports={buildCollectionManifest,buildCollectionManifestV11};
