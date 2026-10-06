import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcsFields, buildContentPackage, mergeMissing, normalizeTag, packageIdPatch } from '../draft-builder.js';
import { validatePackage } from '../../x-content-inventory/schema.js';

const vp = (k, v) => `publish-staging/discogs/74379/${k}-${v}.${k === 'video' ? 'mp4' : 'jpg'}`;
const req = {
  releaseId: 74379, discogsUrl: 'https://www.discogs.com/release/74379', artist: '  Aphex  Twin ', title: 'Windowlicker',
  label: 'Warp Records', catno: 'WAP 105', year: '1999',
  videoStoragePath: 'publish-staging/discogs/74379/video.mp4', imageStoragePath: 'publish-staging/discogs/74379/image.jpg',
  variants: { video: { '1x1': vp('video', '1x1'), '9x16': vp('video', '9x16') }, image: { '1x1': vp('image', '1x1'), '9x16': vp('image', '9x16') } },
};

test('acs fields: engine/source/priority/format/approval/tags', () => {
  const f = buildAcsFields(req);
  assert.equal(f.engine, 'record');
  assert.deepEqual(f.source, { kind: 'discogs', externalId: '74379', url: req.discogsUrl });
  assert.equal(f.priority, 'evergreen'); assert.equal(f.format, 'video');
  assert.deepEqual(f.related, []); assert.deepEqual(f.approval, { state: 'none' });
  assert.deepEqual(f.tags, ['warp records', 'aphex twin', '1999']);
  assert.deepEqual(f.variants.x, { aspect: '1x1', video: vp('video', '1x1'), image: vp('image', '1x1') });
  assert.deepEqual(f.variants.instagram, { aspect: '9x16', video: vp('video', '9x16'), image: vp('image', '9x16') });
});

test('acs fields: no variants key when no variant paths; no empty tags', () => {
  const f = buildAcsFields({ ...req, variants: {}, label: '', year: null });
  assert.equal('variants' in f, false);
  assert.deepEqual(f.tags, ['aphex twin']);
  assert.equal(normalizeTag(null), '');
});

test('package with acs fields still validates (validatePackage ignores unknown fields)', () => {
  const pkg = buildContentPackage(req);
  assert.equal(pkg.engine, 'record');
  const v = validatePackage(pkg);
  assert.deepEqual(v.errors, []);
});

test('merge: existing human/ACS-set values win, missing are filled', () => {
  const existing = { story: 's', status: 'drafted', engine: 'client', priority: 'pinned', tags: ['custom'], approval: { state: 'approved' } };
  const pkg = buildContentPackage(req, existing);
  assert.equal(pkg.engine, 'client'); assert.equal(pkg.priority, 'pinned');
  assert.deepEqual(pkg.tags, ['custom']); assert.deepEqual(pkg.approval, { state: 'approved' });
  assert.equal(pkg.format, 'video'); assert.equal(pkg.source.kind, 'discogs');
  assert.deepEqual(mergeMissing({ a: null, b: 0 }, { a: 1, b: 2, c: 3 }), { a: 1, c: 3 });
});

test('join key: packageId patch', () => {
  assert.deepEqual(packageIdPatch(74379), { packageId: 'discogs-74379' });
});
