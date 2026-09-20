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

// Live Turbo rate. The legacy calculator above was ~100x low against reality
// (first real batch, 2026-09-20: Turbo quoted ≈ $91/GB). Rate is fetched
// unauthenticated (no wallet needed) and cached briefly so the /archive
// status poll does not hammer the price endpoint.
const RATE_CACHE_MS=10*60*1000;
const BYTES_PER_GB=1e9;
let _rateCache=null; // {usdPerGb, wincPerGb, wincPerUsd, quotedAt}

async function defaultTurboRateClient(){
  const {TurboFactory,USD}=await import('@ardrive/turbo-sdk');
  const turbo=TurboFactory.unauthenticated();
  return {
    async wincForBytes(bytes){const [c]=await turbo.getUploadCosts({bytes:[bytes]});return Number(c.winc);},
    async wincForUsd(usd){const r=await turbo.getWincForFiat({amount:USD(usd)});return Number(r.winc);},
  };
}

async function getTurboRate({client,now=Date.now()}={}){
  if(_rateCache&&now-_rateCache.quotedAt<RATE_CACHE_MS) return _rateCache;
  const c=client||await defaultTurboRateClient();
  const wincPerGb=await c.wincForBytes(BYTES_PER_GB);
  const wincPerUsd=(await c.wincForUsd(10))/10;
  if(!(wincPerGb>0)||!(wincPerUsd>0)) throw new Error('Turbo rate quote returned no usable numbers');
  _rateCache={usdPerGb:wincPerGb/wincPerUsd,wincPerGb,wincPerUsd,quotedAt:now};
  return _rateCache;
}

/** Live Turbo quote for `sizeBytes`; falls back to the legacy estimate (clearly
 * labelled `isLiveQuote:false`) when the price endpoint is unreachable. */
async function estimateArchiveCostLive(sizeBytes,opts={}){
  const bytes=Math.max(0,Number(sizeBytes)||0);
  try{
    const rate=await getTurboRate(opts);
    return {
      quoteType:'TURBO_LIVE',sizeBytes:bytes,sizeGB:Number((bytes/BYTES_PER_GB).toFixed(4)),
      usdPerGb:Number(rate.usdPerGb.toFixed(2)),costUSD:Number((bytes/BYTES_PER_GB*rate.usdPerGb).toFixed(2)),
      quotedAt:new Date(rate.quotedAt).toISOString(),source:'ardrive turbo getUploadCosts + getWincForFiat',isLiveQuote:true,
    };
  }catch(error){
    return {...estimateArchiveCost(bytes),liveQuoteError:error instanceof Error?error.message:String(error)};
  }
}

function _resetTurboRateCache(){_rateCache=null;}

module.exports={estimateArchiveCost,estimateArchiveCostLive,getTurboRate,_resetTurboRateCache,archiveTags};


function parseWalletJwk(){
  const raw=process.env.ARWEAVE_WALLET_JWK;
  if(!raw) throw new Error('ARWEAVE_WALLET_JWK is not configured');
  let value=raw.trim();
  if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
  value=value.replace(/\\n/g,'').replace(/\r?\n/g,'');
  const jwk=JSON.parse(value);
  for(const field of ['d','dp','dq','e','kty','n','p','q','qi']) if(!jwk[field]) throw new Error('ARWEAVE_WALLET_JWK is missing '+field);
  return jwk;
}

async function uploadArchiveBuffer({data,fileName,contentType,sha256,collectionId}){
  if(!Buffer.isBuffer(data)&&!(data instanceof Uint8Array)) throw new Error('Archive upload data must be bytes');
  const {TurboFactory,ArweaveSigner}=await import('@ardrive/turbo-sdk');
  const signer=new ArweaveSigner(parseWalletJwk());
  const turbo=TurboFactory.authenticated({signer,config:{gatewayUrl:'https://turbo.ardrive.io',uploadUrl:'https://turbo.ardrive.io'}});
  const tags=archiveTags({fileName,sizeBytes:data.length,contentType,sha256,collectionId});
  const result=await turbo.upload({data,dataItemOpts:{tags},turboOpts:{payment:{token:'arweave'}}});
  if(!result?.id) throw new Error('Turbo upload returned no transaction id');
  return {transactionId:result.id,arweaveUrl:`https://arweave.net/${result.id}`,fileName,sizeBytes:data.length,tags};
}

module.exports.uploadArchiveBuffer=uploadArchiveBuffer;
module.exports.parseWalletJwk=parseWalletJwk;
