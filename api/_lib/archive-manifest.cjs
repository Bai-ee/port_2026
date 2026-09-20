'use strict';

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
module.exports={buildCollectionManifest};
