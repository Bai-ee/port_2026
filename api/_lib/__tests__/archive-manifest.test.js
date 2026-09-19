import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'module';
const require=createRequire(import.meta.url);const {buildCollectionManifest}=require('../../api/_lib/archive-manifest.cjs');
test('manifest links permanent originals and provenance',()=>{const m=buildCollectionManifest({collection:{id:'c',title:'Chicago'},assets:[{id:'a',archiveName:'set.mov',sha256:'abc',transactionId:'tx'}]});assert.equal(m.assets[0].arweaveUrl,'https://arweave.net/tx');assert.equal(m.provenance.originalsReadOnly,true);assert.equal(m.provenance.contentAddressing,'sha256')});
test('manifest rejects assets without permanent identity',()=>assert.throws(()=>buildCollectionManifest({collection:{id:'c'},assets:[{id:'a'}]})));
