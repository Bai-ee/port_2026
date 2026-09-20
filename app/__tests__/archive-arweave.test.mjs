import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'module';
const require=createRequire(import.meta.url);const {estimateArchiveCost,archiveTags}=require('../../api/_lib/archive-arweave.cjs');
test('legacy quote is explicitly not live',()=>{const q=estimateArchiveCost(1024*1024,{arPriceUSD:10});assert.equal(q.quoteType,'LEGACY_ESTIMATE');assert.equal(q.isLiveQuote,false);});
test('archive tags carry provenance keys',()=>{const tags=archiveTags({fileName:'a.mov',sizeBytes:10,sha256:'abc',collectionId:'c'});const m=Object.fromEntries(tags.map(x=>[x.name,x.value]));assert.equal(m['App-Name'],'HITLOOP-Archive');assert.equal(m['SHA-256'],'abc');assert.equal(m['Collection-ID'],'c');});
