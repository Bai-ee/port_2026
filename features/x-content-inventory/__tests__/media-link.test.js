import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateRef, refsOf, getMediaLinks } from '../media-link.js';
import { capturesOf } from '../media-signers.js';

const signRef = async ({ bucket, path }) => `https://signed/${bucket}/${path}`;
const RV = { id: 'rv-1', title: 'BLUE JAY – Live at Hush', format: 'video', durationSec: 30, assetRefs: ['ev:videos/blue.mp4'], thumbRef: 'content-thumbs/c/rv-1.jpg' };
const NAS = { id: 'nas-abc', title: 'Hush flyer video', mediaType: 'video', nas: { relativePath: 'x/hush.mov' }, assetRefs: [], rights: 'owned' };
const NEVER = { id: 'nas-def', title: 'private', nas: { relativePath: 'y.mov' }, assetRefs: [], rights: 'never-public' };
const deps = (extra = {}) => ({ readPackages: async () => [RV, NAS, NEVER], signRef, ...extra });

test('locateRef: ev, staging, http, unsafe', () => {
  assert.deepEqual(locateRef('ev:videos/a.mp4'), { bucket: 'ev', path: 'videos/a.mp4', kind: 'video' });
  assert.deepEqual(locateRef('publish-staging/nas/x.jpg'), { bucket: 'hitloop', path: 'publish-staging/nas/x.jpg', kind: 'image' });
  assert.equal(locateRef('https://arweave.net/abc').url, 'https://arweave.net/abc');
  assert.equal(locateRef('../etc/passwd.jpg'), null);
  assert.equal(locateRef('sha256deadbeef'), null);
});

test('refsOf: media first, poster/thumb after, deduped', () => {
  const r = refsOf({ ...RV, assetRefs: ['ev:videos/blue.mp4', 'ev:videos/blue.mp4'] });
  assert.deepEqual(r.map((x) => x.role), ['media', 'thumbnail']);
});

test('itemId: rendered video gets a signed link', async () => {
  const out = await getMediaLinks(deps(), { itemId: 'rv-1' });
  const [row] = out.results;
  assert.equal(row.links[0].url, 'https://signed/ev/videos/blue.mp4');
  assert.equal(row.links[0].kind, 'video');
  assert.equal(row.links[0].expires, '6.9 days');
  assert.equal(row.links[1].role, 'thumbnail');
  assert.equal(row.needsStaging, undefined);
});

test('NAS item not copied yet: needsStaging + nas.stage; never-public refused', async () => {
  const a = (await getMediaLinks(deps(), { itemId: 'nas-abc' })).results[0];
  assert.equal(a.needsStaging, true);
  assert.deepEqual(a.stage.args, { id: 'nas-abc' });
  const b = (await getMediaLinks(deps(), { itemId: 'nas-def' })).results[0];
  assert.ok(b.stage.refused);
});

test('query finds by title words, linked items first; kind filter', async () => {
  const out = await getMediaLinks(deps(), { query: 'hush', kind: 'video' });
  assert.deepEqual(out.results.map((r) => r.id), ['rv-1', 'nas-abc']);
  const none = await getMediaLinks(deps(), { query: 'hush', kind: 'image' });
  assert.equal(none.results.length, 0);
});

test('postId: re-signs mediaStoragePath and adds the item', async () => {
  const readPost = async () => ({ id: 'p1', status: 'draft', content: 'hi', mediaStoragePath: 'ev:videos/blue.mp4', mediaUrl: 'https://old', packageId: 'rv-1' });
  const [row] = (await getMediaLinks(deps({ readPost }), { postId: 'p1' })).results;
  assert.equal(row.links[0].url, 'https://signed/ev/videos/blue.mp4');
  assert.equal(row.item.id, 'rv-1');
});

test('postId: falls back to the stored mediaUrl when unsignable', async () => {
  const readPost = async () => ({ id: 'p2', mediaUrl: 'https://old.mp4', mediaType: 'video' });
  const [row] = (await getMediaLinks(deps({ readPost, signRef: async () => null }), { postId: 'p2' })).results;
  assert.equal(row.links[0].url, 'https://old.mp4');
});

test('captures: studio/remix/arweave renders are searchable', async () => {
  const caps = capturesOf({
    studioCaptures: [{ jobId: 's1', downloadUrl: 'https://tok/s1.mp4', storagePath: 'clients/c/studio/video-cloud-1.mp4', createdAt: '2026-10-01' }],
    archivePublishing: { archivedAssets: [{ label: 'Mix', arweaveUrl: 'https://arweave.net/tx1', archivedAt: '2026-09-01' }] },
  });
  assert.deepEqual(caps.map((c) => c.type), ['studio-render', 'arweave']);
  const out = await getMediaLinks(deps({ readCaptures: async () => caps }), { query: 'studio' });
  assert.equal(out.results[0].links[0].url, 'https://signed/hitloop/clients/c/studio/video-cloud-1.mp4');
});

test('a render whose file is gone says missing', async () => {
  const [row] = (await getMediaLinks(deps({ signRef: async () => null }), { itemId: 'rv-1' })).results;
  assert.deepEqual(row.links, []);
  assert.ok(row.missing);
});

test('no input is an error', async () => {
  assert.ok((await getMediaLinks(deps(), {})).error);
});
