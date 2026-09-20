import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'module';
const require=createRequire(import.meta.url);const {estimateArchiveCost,archiveTags}=require('../../api/_lib/archive-arweave.cjs');
test('legacy quote is explicitly not live',()=>{const q=estimateArchiveCost(1024*1024,{arPriceUSD:10});assert.equal(q.quoteType,'LEGACY_ESTIMATE');assert.equal(q.isLiveQuote,false);});
test('archive tags carry provenance keys',()=>{const tags=archiveTags({fileName:'a.mov',sizeBytes:10,sha256:'abc',collectionId:'c'});const m=Object.fromEntries(tags.map(x=>[x.name,x.value]));assert.equal(m['App-Name'],'HITLOOP-Archive');assert.equal(m['SHA-256'],'abc');assert.equal(m['Collection-ID'],'c');});
const {estimateArchiveCostLive,_resetTurboRateCache}=require('../../api/_lib/archive-arweave.cjs');
test('live quote converts Turbo winc math to USD per GB and labels itself live',async()=>{
  _resetTurboRateCache();
  // 1 GB = 12.39e12 winc, $10 = 1.3627e12 winc  → ≈ $90.91/GB (the numbers observed on 2026-09-20)
  const client={wincForBytes:async()=>12388704228959,wincForUsd:async(usd)=>1362683438155*(usd/10)};
  const q=await estimateArchiveCostLive(420_000_000,{client});
  assert.equal(q.quoteType,'TURBO_LIVE');assert.equal(q.isLiveQuote,true);
  assert.equal(q.usdPerGb,90.91);assert.equal(q.costUSD,38.18);
});
test('live quote falls back to the legacy estimate, clearly labelled, when Turbo is unreachable',async()=>{
  _resetTurboRateCache();
  const client={wincForBytes:async()=>{throw new Error('ENETDOWN');},wincForUsd:async()=>0};
  const q=await estimateArchiveCostLive(1024*1024,{client});
  assert.equal(q.quoteType,'LEGACY_ESTIMATE');assert.equal(q.isLiveQuote,false);assert.match(q.liveQuoteError,/ENETDOWN/);
});
test('live rate is cached for repeated summaries',async()=>{
  _resetTurboRateCache();let calls=0;
  const client={wincForBytes:async()=>{calls++;return 1e12;},wincForUsd:async()=>1e12};
  await estimateArchiveCostLive(1,{client});await estimateArchiveCostLive(2,{client});
  assert.equal(calls,1);
});
