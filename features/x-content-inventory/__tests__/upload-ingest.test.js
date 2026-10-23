import test from 'node:test';
import assert from 'node:assert/strict';
import { packageFromUpload, uploadPackageId, assertUploadPath, titleFromFilename } from '../upload-ingest.js';
import { validatePackage } from '../schema.js';
import { pickMediaRef } from '../item-actions.js';

const C = 'client-a';
const NOW = Date.parse('2026-10-23T12:00:00Z');
const file = { fullPath: 'Uploads/mixes/my_clip-final.mp4', name: 'my_clip-final.mp4', size: 10, contentType: 'video/mp4', kind: 'video' };

test('builds a package that passes validatePackage', () => {
  const p = packageFromUpload({ clientId: C, bucket: { id: 'flyers' }, file: { ...file, posterPath: 'Uploads/posters/a.jpg' }, now: NOW });
  const v = validatePackage(p);
  assert.deepEqual(v.errors, []);
  assert.equal(p.clientId, C);
  assert.equal(p.bucketId, 'flyers');
  assert.equal(p.title, 'my clip final');
  assert.deepEqual(p.assetRefs, ['ev:Uploads/mixes/my_clip-final.mp4']);
  assert.equal(p.posterRef, 'ev:Uploads/posters/a.jpg');
  assert.equal(p.mediaState, 'video');
  assert.deepEqual([p.rights, p.rightsSetBy, p.effort, p.status], ['owned', 'human', 'ready', 'idea']);
  assert.deepEqual(p.source, { kind: 'upload', externalId: file.fullPath });
});

test('still image uses still mediaState', () => {
  const p = packageFromUpload({ clientId: C, bucket: { id: 'x' }, file: { fullPath: 'U/a.png', name: 'a.png', kind: 'image' }, now: NOW });
  assert.equal(p.mediaState, 'still');
  assert.deepEqual(validatePackage(p).errors, []);
});

test('id is deterministic per client+path', () => {
  const a = packageFromUpload({ clientId: C, bucket: { id: 'x' }, file, now: NOW });
  const b = packageFromUpload({ clientId: C, bucket: { id: 'x' }, file, now: NOW + 5000 });
  assert.equal(a.id, b.id);
  assert.match(a.id, /^upload-[0-9a-f]{16}$/);
  assert.notEqual(a.id, uploadPackageId('client-b', file.fullPath));
  assert.notEqual(a.id, uploadPackageId(C, 'Uploads/other.mp4'));
});

test('rejects traversal, absolute and out-of-folder paths', () => {
  assert.throws(() => assertUploadPath('/etc/x.mp4'), { status: 400 });
  assert.throws(() => assertUploadPath('a/../b.mp4'), { status: 400 });
  assert.throws(() => assertUploadPath('Other/a.mp4', 'Uploads'), { status: 400 });
  assert.throws(() => assertUploadPath('Uploads2/a.mp4', 'Uploads'), { status: 400 });
  assert.equal(assertUploadPath('Uploads/a.mp4', 'Uploads/'), 'Uploads/a.mp4');
  assert.throws(() => packageFromUpload({ clientId: C, bucket: { id: 'x' }, file: { fullPath: '../a.mp4' } }), { status: 400 });
});

test('engine only for built-in bucket ids', () => {
  assert.equal(packageFromUpload({ clientId: C, bucket: { id: 'record' }, file, now: NOW }).engine, 'record');
  assert.equal('engine' in packageFromUpload({ clientId: C, bucket: { id: 'my-uploads' }, file, now: NOW }), false);
});

test('pickMediaRef resolves the ev ref', () => {
  const m = pickMediaRef(packageFromUpload({ clientId: C, bucket: { id: 'x' }, file, now: NOW }));
  assert.equal(m.viaEv, true);
  assert.equal(m.path, file.fullPath);
  assert.equal(m.kind, 'video');
});

test('titleFromFilename tidies separators', () => {
  assert.equal(titleFromFilename('Cool_Track.v2.MOV'), 'Cool Track v2');
  assert.equal(titleFromFilename(''), 'Untitled upload');
});
