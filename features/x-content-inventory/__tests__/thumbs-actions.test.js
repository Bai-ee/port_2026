import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  thumbPathFor, validateThumbDataUrl, makeThumbJpeg, resolveMediaUrlsBatch, MEDIA_URLS_MAX_IDS, THUMB_MAX_BYTES,
} from '../thumbs.js';
import { setRights, saveThumb, createDraftFromItem, isPlaceholderStory } from '../item-actions.js';

const jpegUrl = async (w, h, mime = 'jpeg') => {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } })[mime]({ quality: 60 }).toBuffer();
  return { buf, url: `data:image/${mime};base64,${buf.toString('base64')}` };
};

function fakeBucket(objects = {}) {
  const saved = {};
  const meta = {};
  return {
    name: 'hl-bucket', saved, meta,
    file: (p) => ({
      exists: async () => [p in objects || p in saved],
      getMetadata: async () => [{ metadata: meta[p] || {} }],
      setMetadata: async (m) => { meta[p] = { ...(meta[p] || {}), ...m.metadata }; },
      save: async (buf, o) => { saved[p] = { buf, o }; meta[p] = o.metadata.metadata; },
    }),
  };
}

test('thumbPathFor + id safety', () => {
  assert.equal(thumbPathFor('cl1', 'rv-a'), 'content-thumbs/cl1/rv-a.jpg');
  assert.throws(() => thumbPathFor('cl1', '../x'));
  assert.throws(() => thumbPathFor('', 'a'));
});

test('validateThumbDataUrl: mime and size', async () => {
  const { url } = await jpegUrl(100, 100);
  assert.equal(validateThumbDataUrl(url).ok, true);
  assert.equal(validateThumbDataUrl('data:image/png;base64,AAAA').ok, false);
  assert.equal(validateThumbDataUrl('nope').ok, false);
  const big = `data:image/jpeg;base64,${Buffer.alloc(THUMB_MAX_BYTES + 1000, 1).toString('base64')}`;
  assert.match(validateThumbDataUrl(big).error, /limit/);
});

test('makeThumbJpeg: re-encodes to 320, rejects >480', async () => {
  const { buf } = await jpegUrl(480, 270);
  const out = await sharp(await makeThumbJpeg(buf)).metadata();
  assert.equal(out.width, 320); assert.equal(out.format, 'jpeg');
  const { buf: wide } = await jpegUrl(600, 100);
  await assert.rejects(makeThumbJpeg(wide), /exceeds/);
  await assert.rejects(makeThumbJpeg(Buffer.from('garbage')), /decodable/);
});

test('saveThumb: writes path, sets thumbRef, 404 when package missing, 400 bad url', async () => {
  const store = new Map([['rv-a', { id: 'rv-a', title: 't' }]]);
  const bucket = fakeBucket();
  const deps = { getPackage: async (id) => store.get(id) || null, upsertPackage: async (p) => store.set(p.id, p), bucket };
  const { url } = await jpegUrl(400, 225, 'webp');
  const r = await saveThumb(deps, { clientId: 'cl1', id: 'rv-a', dataUrl: url });
  assert.deepEqual(r, { ok: true, thumbRef: 'content-thumbs/cl1/rv-a.jpg' });
  assert.equal(store.get('rv-a').thumbRef, r.thumbRef);
  assert.equal(bucket.saved[r.thumbRef].o.metadata.contentType, 'image/jpeg');
  await assert.rejects(saveThumb(deps, { clientId: 'cl1', id: 'rv-zz', dataUrl: url }), { status: 404 });
  await assert.rejects(saveThumb(deps, { clientId: 'cl1', id: 'rv-a', dataUrl: 'x' }), { status: 400 });
  const { url: huge } = await jpegUrl(900, 900);
  await assert.rejects(saveThumb(deps, { clientId: 'cl1', id: 'rv-a', dataUrl: huge }), { status: 400 });
});

test('resolveMediaUrlsBatch: shapes per kind and source', async () => {
  const bucket = fakeBucket({ 'content-thumbs/c/rv-a.jpg': 1, 'publish-staging/discogs/9/image-1x1.jpg': 1, 'publish-staging/discogs/9/video.mp4': 1 });
  const signed = [];
  const deps = { hitloopBucket: bucket, signEv: async (p) => { signed.push(p); return `https://ev/${p}`; } };
  const pkgs = [
    { id: 'rv-a', thumbRef: 'content-thumbs/c/rv-a.jpg', assetRefs: ['ev:videos/a.mp4'] },
    { id: 'rv-b', posterRef: 'ev:posters/b.jpg', assetRefs: ['ev:videos/b.mp4'] },
    { id: 'discogs-9', assetRefs: ['publish-staging/discogs/9/image-1x1.jpg', 'publish-staging/discogs/9/video.mp4'] },
    { id: 'bare', assetRefs: ['sha256:abc'] },
  ];
  const t = await resolveMediaUrlsBatch(pkgs, ['thumb'], deps);
  assert.match(t['rv-a'].thumbUrl, /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/hl-bucket\/o\/content-thumbs%2Fc%2Frv-a\.jpg\?alt=media&token=/);
  assert.equal(t['rv-b'].thumbUrl, 'https://ev/posters/b.jpg');
  assert.deepEqual(t.bare, {});
  assert.equal(t['rv-a'].videoUrl, undefined);
  // token URL is stable across calls (cacheable)
  const t2 = await resolveMediaUrlsBatch(pkgs, ['thumb'], deps);
  assert.equal(t2['rv-a'].thumbUrl, t['rv-a'].thumbUrl);
  const all = await resolveMediaUrlsBatch(pkgs, ['video', 'image'], deps);
  assert.equal(all['rv-a'].videoUrl, 'https://ev/videos/a.mp4');
  assert.match(all['discogs-9'].videoUrl, /publish-staging%2Fdiscogs%2F9%2Fvideo\.mp4/);
  assert.match(all['discogs-9'].imageUrl, /image-1x1\.jpg/);
  assert.equal(MEDIA_URLS_MAX_IDS, 60);
});

test('setRights: allowed values, stamps human, rejects others, 404', async () => {
  const store = new Map([['p', { id: 'p', rights: 'never-public' }]]);
  const deps = { getPackage: async (id) => store.get(id) || null, upsertPackage: async (p) => store.set(p.id, p), now: () => Date.parse('2026-10-06T00:00:00Z') };
  assert.deepEqual(await setRights(deps, { id: 'p', rights: 'cleared' }), { ok: true });
  assert.equal(store.get('p').rights, 'cleared');
  assert.equal(store.get('p').rightsSetBy, 'human');
  assert.equal(store.get('p').rightsSetAt, '2026-10-06T00:00:00.000Z');
  await assert.rejects(setRights(deps, { id: 'p', rights: 'client-approval-needed' }), { status: 400 });
  await assert.rejects(setRights(deps, { id: 'nope', rights: 'owned' }), { status: 404 });
});

function draftDeps(pkg, existing = null) {
  const posts = [];
  return {
    posts,
    getPackage: async (id) => (pkg && id === pkg.id ? pkg : null),
    findDraft: async () => existing,
    createPost: async (clientId, payload) => { const p = { id: `post${posts.length + 1}`, clientId, ...payload }; posts.push(p); return p; },
    patchPost: async (id, patch) => { Object.assign(posts.find((p) => p.id === id) || {}, patch); },
    signEvLong: async (p) => `https://ev-long/${p}`,
    hitloopUrl: async (p) => `https://hl/${p}`,
  };
}
const rv = (o = {}) => ({ id: 'rv-a', title: 'ACIDMAN – Mix', story: '[add your memory]', rights: 'owned', approval: { state: 'none' }, bucketId: 'ue', engine: 'ue',
  assetRefs: ['ev:videos/a.mp4'], variants: { x: { suggestedStory: 'Rendered video for ACIDMAN.' } }, ...o });

test('create-draft: video media, suggestedStory fallback, draft only', async () => {
  const d = draftDeps(rv());
  const r = await createDraftFromItem(d, { clientId: 'cl1', id: 'rv-a' });
  assert.deepEqual(r, { ok: true, postId: 'post1' });
  const p = d.posts[0];
  assert.equal(p.status, 'draft'); assert.equal(p.scheduledAt, null);
  assert.equal(p.content, 'Rendered video for ACIDMAN.');
  assert.equal(p.mediaType, 'video'); assert.equal(p.mediaStoragePath, 'ev:videos/a.mp4');
  assert.equal(p.mediaUrl, 'https://ev-long/videos/a.mp4');
  assert.equal(p.packageId, 'rv-a'); assert.equal(p.engine, 'ue'); assert.equal(p.bucketId, 'ue');
});

test('create-draft: owner story wins; falls back to title', async () => {
  const story = 'I made this for the night everything went sideways at the club.';
  assert.equal((await (async () => { const d = draftDeps(rv({ story })); await createDraftFromItem(d, { clientId: 'c', id: 'rv-a' }); return d.posts[0].content; })()), story);
  const d = draftDeps(rv({ variants: undefined }));
  await createDraftFromItem(d, { clientId: 'c', id: 'rv-a' });
  assert.equal(d.posts[0].content, 'ACIDMAN – Mix');
  assert.ok(isPlaceholderStory('[add your memory]') && isPlaceholderStory('') && !isPlaceholderStory('real'));
});

test('create-draft: idempotent (returns existing draft, creates nothing)', async () => {
  const d = draftDeps(rv(), { id: 'old1', status: 'draft' });
  assert.deepEqual(await createDraftFromItem(d, { clientId: 'c', id: 'rv-a' }), { ok: true, postId: 'old1', existing: true });
  assert.equal(d.posts.length, 0);
  const dis = draftDeps({ id: 'discogs-9', title: 'T', story: 'story', rights: 'owned', assetRefs: [] }, { id: 'dd', status: 'scheduled' });
  assert.equal((await createDraftFromItem(dis, { clientId: 'c', id: 'discogs-9' })).postId, 'dd');
});

test('create-draft: refusals (rights, approval, missing)', async () => {
  await assert.rejects(createDraftFromItem(draftDeps(rv({ rights: 'never-public' })), { clientId: 'c', id: 'rv-a' }), { status: 409 });
  await assert.rejects(createDraftFromItem(draftDeps(rv({ rights: 'client-approval-needed' })), { clientId: 'c', id: 'rv-a' }), { status: 409 });
  await assert.rejects(createDraftFromItem(draftDeps(rv({ approval: { state: 'needed' } })), { clientId: 'c', id: 'rv-a' }), /approval/);
  const ok = draftDeps(rv({ rights: 'cleared', approval: { state: 'approved' } }));
  assert.equal((await createDraftFromItem(ok, { clientId: 'c', id: 'rv-a' })).ok, true);
  await assert.rejects(createDraftFromItem(draftDeps(null), { clientId: 'c', id: 'zz' }), { status: 404 });
});

test('create-draft: a posted prior draft does not block a new one', async () => {
  const d = draftDeps(rv(), { id: 'old', status: 'posted' });
  assert.equal((await createDraftFromItem(d, { clientId: 'c', id: 'rv-a' })).postId, 'post1');
});
