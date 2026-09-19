'use strict';

/**
 * Archive Arweave bridge.
 *
 * Source implementation: Bai-ee/arweave-video-generator
 *   lib/ArweaveCostCalculator.js
 *   lib/ArweaveUploader.js
 *
 * Important: the legacy calculator is an APPROXIMATION, not a network quote.
 * Keep that distinction explicit in the POC until Turbo's live price endpoint
 * is wired and verified.
 */
const BYTES_PER_MB=1024*1024;
const LEGACY_COST_PER_MB_AR=0.0001;

function estimateArchiveCost(sizeBytes,{arPriceUSD=10}={}){
  const bytes=Math.max(0,Number(sizeBytes)||0);
  const sizeMB=bytes/BYTES_PER_MB;
  const costAR=sizeMB*LEGACY_COST_PER_MB_AR;
  return {
    quoteType:'LEGACY_ESTIMATE',
    sizeBytes:bytes,
    sizeMB:Number(sizeMB.toFixed(4)),
    costAR:Number(costAR.toFixed(8)),
    costUSD:Number((costAR*arPriceUSD).toFixed(4)),
    arPriceUSD:Number(arPriceUSD),
    source:'arweave-video-generator/lib/ArweaveCostCalculator.js',
    isLiveQuote:false,
  };
}

function archiveTags({fileName,sizeBytes,contentType='application/octet-stream',sha256,collectionId}){
  return [
    {name:'Content-Type',value:contentType},
    {name:'File-Name',value:String(fileName)},
    {name:'File-Size',value:String(sizeBytes)},
    {name:'App-Name',value:'HITLOOP-Archive'},
    {name:'Archive-Schema',value:'1.0'},
    ...(sha256?[{name:'SHA-256',value:String(sha256)}]:[]),
    ...(collectionId?[{name:'Collection-ID',value:String(collectionId)}]:[]),
  ];
}

module.exports={estimateArchiveCost,archiveTags};
