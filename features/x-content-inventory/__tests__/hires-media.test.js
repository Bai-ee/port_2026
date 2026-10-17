// High-res original from the NAS: find (read), use (stage or swap), the agent tool, the catalog entries and the runtime
// snapshot/undo. Fixtures follow the real Facebook export shape (720px thumbnail vs 2048px `_o` original). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findHiresMedia, useHiresMedia, NAS_WORKER_START_COMMAND, HIRES_EDITABLE_STATUSES } from '../hires-media.js';
import { runReadTool, READ_TOOLS } from '../../x-strategy/agent/tools.js';
import { getAction, findActions } from '../../x-strategy/agent/action-registry.js';
import { createActionRuntime } from '../../x-strategy/agent/action-runtime.js';
import { createMemoryActionStores } from '../../x-strategy/agent/action-stores.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLIENT = 'bryan-balli-WUoltG84';
const PHOTO = '10217141824798684';
const thumb = { id: 'nas-0a15111c26459788', clientId: CLIENT, title: 'Housepit.Chi · East Room', rights: 'owned', mediaState: 'still', assetRefs: [],
  nas: { sourceId: 's1', sha256: 'a'.repeat(64), relativePath: `Facebook Downloads/facebook-bryanballi7/photos_and_videos/thumbnails/41027512_${PHOTO}_5428795802665353216_n.jpg`, width: 720, height: 720 } };
const original = { id: 'nas-orig000000000001', clientId: CLIENT, title: 'Housepit.Chi · East Room', rights: 'owned', mediaState: 'still', assetRefs: [],
  nas: { sourceId: 's1', sha256: 'b'.repeat(64), relativePath: `Facebook Downloads/facebook-bryanballi7/photos_and_videos/photos/41027512_${PHOTO}_5428795802665353216_o_1.jpg`, width: 2048, height: 2048 } };
const other = { id: 'nas-other00000000001', clientId: CLIENT, title: 'Housepit East Room 10/30', rights: 'owned', mediaState: 'still', assetRefs: [],
  nas: { sourceId: 's1', sha256: 'c'.repeat(64), relativePath: 'Facebook Downloads/x/photos/99999999_10200000000000001_1_o.jpg', width: 2048, height: 2048 } };
const post = { id: 'social_d3fe74af56353b8b7b89f041', clientId: CLIENT, status: 'draft', packageId: thumb.id, mediaUrl: 'https://x/thumb.jpg', mediaStoragePath: 'publish-staging/nas/old.jpg', revision: 3 };
const STAGED = 'publish-staging/nas/nas-orig000000000001/bbbbbbbbbbbbbbbb.jpg';

function world({ stagedRef = null, online = true, pending = null, postOverride = {} } = {}) {
  const pkgs = new Map([thumb, { ...original, assetRefs: stagedRef ? [stagedRef] : [] }, other].map((p) => [p.id, structuredClone(p)]));
  const posts = new Map([[post.id, { ...post, ...postOverride }]]);
  const calls = { stage: [], applied: [], upserts: [] };
  const deps = {
    readPost: async (id) => posts.get(id) ?? null,
    readPackages: async () => [...pkgs.values()],
    readStageStates: async (ids) => new Map(ids.filter((i) => pending?.id === i).map((i) => [i, { state: pending.state, commandId: pending.commandId }])),
    nasStatus: async () => ({ online, lastSeenAt: '2026-10-17T16:00:00.000Z' }),
    getPost: async (id) => posts.get(id) ?? null,
    getPackage: async (id) => pkgs.get(id) ?? null,
    pendingStage: async () => (pending ? { state: pending.state, commandId: pending.commandId, createdAt: pending.createdAt } : null),
    nasStage: async (id) => { calls.stage.push(id); return { ok: true, commandId: 'cmd-1' }; },
    pickMedia: async (pkg) => ({ mediaUrl: `https://dl/${pkg.assetRefs[0]}`, mediaType: 'image', mediaContentType: 'image/jpeg', mediaStoragePath: pkg.assetRefs[0] }),
    applyPostMedia: async (id, media) => { calls.applied.push({ id, media }); Object.assign(posts.get(id), media); return true; },
    upsertPackage: async (p) => { calls.upserts.push(p); pkgs.set(p.id, p); },
    now: () => Date.parse('2026-10-17T16:05:00.000Z'),
  };
  return { deps, calls, pkgs, posts };
}

test('find: thumbnail post -> the same-photo original (not the same-series flyer), unstaged, worker online', async () => {
  const w = world();
  const out = await findHiresMedia(w.deps, { postId: post.id });
  assert.equal(out.ok, true);
  assert.equal(out.target.id, thumb.id);
  assert.equal(out.target.isThumbnail, true);
  assert.equal(out.target.hasPostMedia, true);
  assert.deepEqual(out.candidates.filter((c) => !c.self).map((c) => c.id), [original.id]);
  assert.equal(out.candidates.at(-1).self, true); // the item's own file is always offered last
  const c = out.candidates[0];
  assert.equal(c.width, 2048);
  assert.equal(c.staged, false);
  assert.equal(c.stageState, 'not-staged');
  assert.equal(c.thumbId, original.id);
  assert.equal(out.bestId, original.id);
  assert.equal(out.nasWorker.online, true);
  assert.ok(!('startCommand' in out.nasWorker));
});

test('find: offline worker carries the exact start command; a queued copy shows its state', async () => {
  const w = world({ online: false, pending: { id: original.id, state: 'QUEUED', commandId: 'cmd-9', createdAt: '2026-10-17T16:04:00.000Z' } });
  const out = await findHiresMedia(w.deps, { packageId: thumb.id });
  assert.equal(out.nasWorker.online, false);
  assert.equal(out.nasWorker.startCommand, NAS_WORKER_START_COMMAND);
  assert.match(NAS_WORKER_START_COMMAND, /assetManager.*archive:analyzer/);
  assert.equal(out.candidates[0].stageState, 'QUEUED');
});

test('find: a staged candidate says staged and skips the worker lookup', async () => {
  const w = world({ stagedRef: STAGED });
  const out = await findHiresMedia(w.deps, { postId: post.id });
  assert.equal(out.candidates[0].staged, true);
  assert.ok(!('stageState' in out.candidates[0]));
  assert.ok(!('nasWorker' in out));
});

test('find: unknown post, post without an item and a non-NAS item are explained', async () => {
  const w = world();
  assert.match((await findHiresMedia(w.deps, { postId: 'nope' })).error, /unknown post/);
  w.posts.set('p2', { id: 'p2', clientId: CLIENT, status: 'draft' });
  assert.match((await findHiresMedia(w.deps, { postId: 'p2' })).error, /no library item/);
  w.pkgs.set('disc', { id: 'disc', clientId: CLIENT, title: 'x' });
  assert.match((await findHiresMedia(w.deps, { packageId: 'disc' })).error, /not a NAS item/);
});

test('use: not staged -> queues nas-stage once, tells the owner how to start an offline worker', async () => {
  const w = world({ online: false });
  const r = await useHiresMedia(w.deps, { clientId: CLIENT, postId: post.id, packageId: thumb.id, candidateId: original.id });
  assert.equal(r.status, 'staging');
  assert.equal(r.commandId, 'cmd-1');
  assert.deepEqual(w.calls.stage, [original.id]);
  assert.equal(r.workerOnline, false);
  assert.equal(r.needsYou, true);
  assert.equal(r.startCommand, NAS_WORKER_START_COMMAND);
  assert.match(r.note, /Needs you: start it on the Mac/);
  assert.equal(w.calls.applied.length, 0, 'the post is untouched until the file is staged');
});

test('use: a fresh queued copy is not queued twice; a finished or stale one is', async () => {
  const fresh = world({ pending: { id: original.id, state: 'RUNNING', commandId: 'cmd-7', createdAt: '2026-10-17T16:04:00.000Z' } });
  const a = await useHiresMedia(fresh.deps, { clientId: CLIENT, postId: post.id, candidateId: original.id });
  assert.equal(a.commandId, 'cmd-7');
  assert.equal(a.alreadyQueued, true);
  assert.equal(fresh.calls.stage.length, 0);
  const failed = world({ pending: { id: original.id, state: 'FAILED', commandId: 'cmd-6', createdAt: '2026-10-17T16:04:00.000Z' } });
  assert.equal((await useHiresMedia(failed.deps, { clientId: CLIENT, postId: post.id, candidateId: original.id })).commandId, 'cmd-1');
  const stale = world({ pending: { id: original.id, state: 'QUEUED', commandId: 'cmd-5', createdAt: '2026-10-17T10:00:00.000Z' } });
  assert.equal((await useHiresMedia(stale.deps, { clientId: CLIENT, postId: post.id, candidateId: original.id })).commandId, 'cmd-1');
});

test('use: staged -> replaces the post media, links the original onto the item, returns a download link', async () => {
  const w = world({ stagedRef: STAGED });
  const r = await useHiresMedia(w.deps, { clientId: CLIENT, postId: post.id, packageId: thumb.id, candidateId: original.id });
  assert.equal(r.status, 'done');
  assert.equal(r.downloadUrl, `https://dl/${STAGED}`);
  assert.equal(r.width, 2048);
  assert.equal(r.replacedMedia, 'publish-staging/nas/old.jpg');
  assert.equal(r.linkedToItem, true);
  const applied = w.calls.applied[0];
  assert.equal(applied.media.mediaStoragePath, STAGED);
  assert.equal(applied.media.mediaFromHires.candidateId, original.id);
  const linked = w.calls.upserts[0];
  assert.equal(linked.id, thumb.id);
  assert.deepEqual(linked.assetRefs, [STAGED]);
  assert.equal(linked.mediaFrom.id, original.id);
  assert.equal(linked.mediaState, 'still');
  assert.equal(w.posts.get(post.id).mediaStoragePath, STAGED);
});

test('use: refuses wrong inputs without touching anything', async () => {
  const w = world({ stagedRef: STAGED });
  const go = (over, deps = w.deps) => useHiresMedia(deps, { clientId: CLIENT, postId: post.id, packageId: thumb.id, candidateId: original.id, ...over });
  await assert.rejects(go({ candidateId: other.id }), (e) => e.status === 409 && /not a high-res match/.test(e.message));
  // candidateId = the post's own item is allowed now (its own original), so it is not a refusal case.
  await assert.rejects(go({ packageId: 'something-else' }), (e) => e.status === 409);
  await assert.rejects(go({ postId: 'nope' }), (e) => e.status === 404);
  await assert.rejects(go({ candidateId: '' }), (e) => e.status === 400);
  for (const status of ['posted', 'posting', 'needs_review', 'failed']) {
    assert.ok(!HIRES_EDITABLE_STATUSES.includes(status));
    await assert.rejects(go({}, world({ stagedRef: STAGED, postOverride: { status } }).deps), (e) => e.status === 409);
  }
  await assert.rejects(go({ clientId: 'another-client' }), (e) => e.status === 404);
  assert.equal(w.calls.applied.length, 0);
  assert.equal(w.calls.stage.length, 0);
});

test('use: a never-public candidate is never offered, so it is never staged', async () => {
  const w = world();
  w.pkgs.get(original.id).rights = 'never-public';
  await assert.rejects(useHiresMedia(w.deps, { clientId: CLIENT, postId: post.id, candidateId: original.id }), (e) => e.status === 409);
  assert.equal(w.calls.stage.length, 0);
});

test('use: a post changed mid-swap (transaction says no) is reported, the package is not linked', async () => {
  const w = world({ stagedRef: STAGED });
  w.deps.applyPostMedia = async () => false;
  await assert.rejects(useHiresMedia(w.deps, { clientId: CLIENT, postId: post.id, candidateId: original.id }), (e) => e.status === 409);
  assert.equal(w.calls.upserts.length, 0);
});

test('agent tool: find_hires_media is a registered read tool that delegates and validates', async () => {
  assert.ok(READ_TOOLS.some((t) => t.name === 'find_hires_media'));
  const seen = [];
  const deps = { findHiresMedia: async (a) => { seen.push(a); return { ok: true }; } };
  assert.deepEqual(await runReadTool('find_hires_media', { postId: ' p1 ', limit: 3 }, deps), { ok: true });
  assert.deepEqual(seen[0], { postId: 'p1', packageId: '', limit: 3 });
  assert.match((await runReadTool('find_hires_media', {}, deps)).error, /postId or packageId/);
  assert.match(JSON.stringify(await runReadTool('find_hires_media', { postId: 'p' }, {})), /not available/i);
});

test('catalog: media.use-hires is tier 1, snapshots post + item, and find_actions finds it by the owner\'s words', () => {
  const e = getAction('media.use-hires');
  assert.equal(e.tier, 1);
  assert.equal(e.action, 'hires-media-use');
  assert.deepEqual(e.args.required, ['postId', 'packageId', 'candidateId']);
  assert.deepEqual(e.snapshot, [{ collection: 'social_posts', idArg: 'postId' }, { collection: 'x_content_packages', idArg: 'packageId' }]);
  assert.equal(getAction('content.item.find-hires').tier, 0);
  for (const q of ['high res copy of the flyer from the drive', 'original full size flyer from the NAS', 'high-res original']) {
    const ids = findActions(q, { limit: 8 }).map((r) => r.id);
    assert.ok(ids.includes('media.use-hires'), `${q} -> ${ids.join(',')}`);
  }
  assert.match(getAction('nas.stage').description, /original high-res full size/);
});

test('route: both actions are served by the quote-targets route and listed as supported', () => {
  const src = readFileSync(path.join(ROOT, 'app/api/dashboard/quote-targets/route.js'), 'utf8');
  assert.match(src, /'find-hires-media',\n\s+'hires-media-use',/);
  assert.match(src, /action === 'find-hires-media'\) return json\(await handleFindHiresMedia\(/);
  assert.match(src, /action === 'hires-media-use'\) return json\(await handleHiresMediaUse\(/);
});

test('runtime: media.use-hires runs on auto, snapshots the post and item, and undo restores both', async () => {
  const stores = createMemoryActionStores();
  stores.files.set(`social_posts/${post.id}`, { ...post });
  stores.files.set(`x_content_packages/${thumb.id}`, { ...thumb });
  const invoke = async (entry, args) => {
    stores.files.set(`social_posts/${args.postId}`, { ...stores.files.get(`social_posts/${args.postId}`), mediaStoragePath: STAGED, revision: 4 });
    stores.files.set(`x_content_packages/${args.packageId}`, { ...stores.files.get(`x_content_packages/${args.packageId}`), assetRefs: [STAGED] });
    return { ok: true, status: 200, json: { ok: true, status: 'done' } };
  };
  let n = 0;
  const rt = createActionRuntime({ ...stores, invoke, clock: () => 1000 + (n += 1), idGen: () => `u${n}` });
  const ctx = { clientId: CLIENT, authorization: 'Bearer o', by: 'owner@x.com' };
  const out = await rt.run(ctx, { actionId: 'media.use-hires', args: { postId: post.id, packageId: thumb.id, candidateId: original.id } });
  assert.equal(out.kind, 'result');
  assert.ok(out.result.undoId, 'tier 1 returns an undo id');
  assert.equal(stores.files.get(`social_posts/${post.id}`).mediaStoragePath, STAGED);
  const undone = await rt.undo(ctx, out.result.undoId);
  assert.equal(undone.ok, true);
  assert.equal(stores.files.get(`social_posts/${post.id}`).mediaStoragePath, post.mediaStoragePath);
  assert.deepEqual(stores.files.get(`x_content_packages/${thumb.id}`).assetRefs, []);
});

// ---- auto-attach when the copy completes + the upload header case fix ----
import { attachStagedHires } from '../hires-media.js';
import { nasUploadUrl } from '../nas.js';

test('nas upload-url returns a lowercase content-type so the worker never sends it twice (v4 signature)', async () => {
  const sha = 'a'.repeat(64);
  const out = await nasUploadUrl({ signUpload: async () => 'https://signed' }, { packageId: `nas-${sha.slice(0, 16)}`, sha256: sha, contentType: 'image/jpeg', sizeBytes: 10 });
  assert.deepEqual(out.headers, { 'content-type': 'image/jpeg' });
  const merged = new Headers({ 'content-type': 'image/jpeg', ...out.headers });
  assert.equal(merged.get('content-type'), 'image/jpeg');
});

test('attachStagedHires puts the staged original on waiting posts, links the item, skips non-editable, clears the list', async () => {
  const pkgs = new Map([
    ['nas-cand', { id: 'nas-cand', clientId: 'c1', mediaState: 'still', assetRefs: ['publish-staging/nas/nas-cand/abc.jpg'], hiresPending: [
      { postId: 'p1', targetId: 'nas-thumb', clientId: 'c1' }, { postId: 'p2', targetId: 'nas-thumb', clientId: 'c1' }] }],
    ['nas-thumb', { id: 'nas-thumb', clientId: 'c1', mediaState: 'still', assetRefs: [] }],
  ]);
  const posts = { p1: { clientId: 'c1', status: 'draft' }, p2: { clientId: 'c1', status: 'posted' } };
  const applied = [];
  const out = await attachStagedHires({
    getPackage: async (id) => (pkgs.has(id) ? structuredClone(pkgs.get(id)) : null),
    upsertPackage: async (p) => { pkgs.set(p.id, p); },
    getPost: async (c, id) => posts[id] || null,
    pickMedia: async () => ({ mediaUrl: 'https://u', mediaType: 'image', mediaStoragePath: 'publish-staging/nas/nas-cand/abc.jpg' }),
    applyPostMedia: async (id, media) => { applied.push([id, media.mediaStoragePath, media.mediaFromHires.auto]); return true; },
    now: () => 0,
  }, { candidateId: 'nas-cand' });
  assert.deepEqual(out.attached, ['p1']);
  assert.equal(out.skipped[0].postId, 'p2');
  assert.deepEqual(applied, [['p1', 'publish-staging/nas/nas-cand/abc.jpg', true]]);
  assert.deepEqual(pkgs.get('nas-cand').hiresPending, []);
  assert.ok((pkgs.get('nas-thumb').assetRefs || []).includes('publish-staging/nas/nas-cand/abc.jpg'));
});

test("the item's own original is always offered and usable when no larger copy exists (HUSH case)", async () => {
  const { findHiresMedia, useHiresMedia } = await import('../hires-media.js');
  const target = { id: 'nas-hush', clientId: 'c1', mediaState: 'still', title: 'HUSH', nas: { relativePath: 'flyers/hush.jpg', width: 1128, height: 1135, sha256: 'b'.repeat(64) }, assetRefs: [] };
  const post = { id: 'p1', clientId: 'c1', status: 'draft', packageId: 'nas-hush' };
  const found = await findHiresMedia({ readPost: async () => post, readPackages: async () => [target] }, { postId: 'p1' });
  assert.equal(found.bestId, 'nas-hush');
  const self = found.candidates.find((c) => c.self);
  assert.ok(self && self.width === 1128 && self.staged === false);
  let staged = null;
  const r = await useHiresMedia({
    getPost: async () => post, getPackage: async (id) => (id === 'nas-hush' ? target : null), readPackages: async () => [target],
    nasStage: async (id) => { staged = id; return { commandId: 'cmd1' }; }, upsertPackage: async () => {}, now: () => 0,
  }, { clientId: 'c1', postId: 'p1', candidateId: 'nas-hush' });
  assert.equal(r.status, 'staging');
  assert.equal(staged, 'nas-hush');
});
