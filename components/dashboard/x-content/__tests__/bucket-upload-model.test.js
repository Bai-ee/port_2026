import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadTargetFor, acceptPicked, toIngestFiles, summarizeIngest, MAX_UPLOAD_BATCH } from '../bucket-upload-model.js';

test('uploadTargetFor: saved folder is reused, otherwise track-<id> is new', () => {
  assert.deepEqual(uploadTargetFor({ id: 'xyz', uploadFolder: 'track-xyz' }), { folderMode: 'existing', folderName: 'track-xyz' });
  assert.deepEqual(uploadTargetFor({ id: 'xyz' }), { folderMode: 'new', folderName: 'track-xyz' });
});

test('acceptPicked: drops non media and caps the batch', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `a${i}`, type: 'video/mp4' }));
  const r = acceptPicked([...many, { name: 'x.pdf', type: 'application/pdf' }]);
  assert.equal(r.accepted.length, MAX_UPLOAD_BATCH);
  assert.equal(r.skippedType, 1);
  assert.equal(r.skippedCap, 5);
  assert.equal(acceptPicked(many, 24).accepted.length, 1);
});

test('toIngestFiles: kind normalised, posterPath only when present', () => {
  const [a, b] = toIngestFiles([
    { fullPath: 'f/a.mp4', name: 'a.mp4', size: 1, contentType: 'video/mp4', kind: 'video', posterPath: '.posters/f/a.jpg' },
    { fullPath: 'f/b.png', name: 'b.png', size: 2, contentType: 'image/png', kind: 'image', posterPath: null },
  ]);
  assert.equal(a.posterPath, '.posters/f/a.jpg');
  assert.equal('posterPath' in b, false);
});

test('summarizeIngest', () => {
  assert.equal(summarizeIngest({ created: ['1', '2'], existing: ['3'] }, 'XYZ'), '2 added to XYZ · 1 already there');
  assert.equal(summarizeIngest({ created: [] }, 'XYZ'), '0 added to XYZ');
});
