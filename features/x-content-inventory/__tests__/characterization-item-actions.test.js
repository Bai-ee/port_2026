// CHARACTERIZATION: pins what createDraftFromItem does TODAY (docs/plans/content-management-audit.md).
// Not a spec. Cases labelled "CURRENT (known gap)" document behaviour the content-management work intends to change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDraftFromItem } from '../item-actions.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const PKG = { id: 'pkg-1', rights: 'owned', story: 'A real memory of that night.', title: 'T', engine: 'identity', assetRefs: [] };

/** Deps over a fake social_posts collection. findDraft mirrors the one in app/api/dashboard/quote-targets/route.js. */
function setup(pkg = PKG) {
  const db = makeFakeContext().adminDb;
  let n = 0;
  const findCalls = [];
  const ensureCalls = [];
  const deps = {
    getPackage: async (id) => (id === pkg.id ? pkg : null),
    async findDraft(...args) {
      findCalls.push(args);
      const snap = await db.collection('social_posts').where('packageId', '==', args[0]).limit(10).get();
      // PHASE 2: client-scoped like the production lookup (2nd arg = clientId).
      const rows = snap.docs.map((d) => d.data()).filter((r) => !args[1] || r.clientId === args[1]);
      return rows.find((r) => r.status === 'draft' || r.status === 'scheduled') || rows[0] || null;
    },
    async ensureDraft(clientId, { idempotencyKey, ...payload }) {
      ensureCalls.push(idempotencyKey);
      return { post: await deps.createPost(clientId, payload), existing: false };
    },
    async createPost(clientId, payload) {
      n += 1;
      const post = { id: `post-${n}`, clientId, ...payload };
      await db.collection('social_posts').doc(post.id).set(post);
      return post;
    },
    patchPost: async (id, patch) => db.collection('social_posts').doc(id).set(patch, { merge: true }),
  };
  const rows = async () => (await db.collection('social_posts').get()).docs.map((d) => d.data());
  return { db, deps, rows, findCalls, ensureCalls };
}

test('creates a draft once: unscheduled, source content-engine, packageId stamped', async () => {
  const { deps, rows } = setup();
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(r, { ok: true, postId: 'post-1' });
  const [row] = await rows();
  assert.equal(row.status, 'draft');
  assert.equal(row.scheduledAt, null);
  assert.equal(row.source, 'content-engine');
  assert.equal(row.packageId, 'pkg-1');
  assert.equal(row.content, PKG.story);
});

test('second call reuses the existing draft (existing:true), no new row', async () => {
  const { deps, rows } = setup();
  await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  const again = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(again, { ok: true, postId: 'post-1', existing: true });
  assert.equal((await rows()).length, 1);
});

test('a scheduled row for the same packageId is reused too', async () => {
  const { db, deps, rows } = setup();
  await db.collection('social_posts').doc('s1').set({ id: 's1', clientId: 'c1', packageId: 'pkg-1', status: 'scheduled', scheduledAt: '2026-10-12T14:00:00Z' });
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(r, { ok: true, postId: 's1', existing: true });
  assert.equal((await rows()).length, 1);
});

test('PHASE 2: approved row IS reused (was: a SECOND row was created for the same package)', async () => {
  const { db, deps, rows } = setup();
  await db.collection('social_posts').doc('a1').set({ id: 'a1', clientId: 'c1', packageId: 'pkg-1', status: 'approved', scheduledAt: null });
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(r, { ok: true, postId: 'a1', existing: true });
  assert.equal((await rows()).length, 1);
});

test('PHASE 2: every open status is reused; only terminal (posted) still creates a new row', async () => {
  for (const status of ['approved', 'awaiting_approval', 'queued', 'posting', 'needs_review', 'scheduled', 'draft']) {
    const { db, deps, rows } = setup();
    await db.collection('social_posts').doc('x1').set({ id: 'x1', clientId: 'c1', packageId: 'pkg-1', status });
    const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
    assert.deepEqual(r, { ok: true, postId: 'x1', existing: true }, status);
    assert.equal((await rows()).length, 1, status);
  }
  const { db, deps, rows } = setup();
  await db.collection('social_posts').doc('p1').set({ id: 'p1', clientId: 'c1', packageId: 'pkg-1', status: 'posted' });
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.equal(r.existing, undefined);
  assert.equal((await rows()).length, 2);
});

test('PHASE 2: findDraft receives (packageId, clientId); another client\'s draft is NOT reused', async () => {
  const { db, deps, findCalls, rows } = setup();
  await db.collection('social_posts').doc('other').set({ id: 'other', clientId: 'c2', packageId: 'pkg-1', status: 'draft' });
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(findCalls, [['pkg-1', 'c1']]);
  assert.equal(r.existing, undefined);
  assert.notEqual(r.postId, 'other');
  assert.equal((await rows()).length, 2);
});

test('PHASE 2: even a findDraft that ignores clientId cannot hand back another client\'s row', async () => {
  const { db, deps, rows } = setup();
  await db.collection('social_posts').doc('other').set({ id: 'other', clientId: 'c2', packageId: 'pkg-1', status: 'draft' });
  deps.findDraft = async (pid) => (await db.collection('social_posts').doc('other').get()).data();
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.equal(r.existing, undefined);
  assert.equal((await rows()).length, 2);
});

test('PHASE 2: uses deps.ensureDraft with idempotency key item:<packageId> when provided; existing:true propagates', async () => {
  const { deps, ensureCalls, rows } = setup();
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.equal(r.postId, 'post-1');
  assert.deepEqual(ensureCalls, ['item:pkg-1']);
  assert.equal((await rows()).length, 1);
  const { deps: d2 } = setup();
  d2.ensureDraft = async () => ({ post: { id: 'dup' }, existing: true });
  assert.deepEqual(await createDraftFromItem(d2, { clientId: 'c1', id: 'pkg-1' }), { ok: true, postId: 'dup', existing: true });
});

test('guards: unknown package 404, bad rights 409, empty text 400, id required 400 (no row created)', async () => {
  const s = setup();
  await assert.rejects(createDraftFromItem(s.deps, { clientId: 'c1', id: 'nope' }), (e) => e.status === 404);
  await assert.rejects(createDraftFromItem(s.deps, { clientId: 'c1' }), (e) => e.status === 400);
  const bad = setup({ ...PKG, rights: 'unknown' });
  await assert.rejects(createDraftFromItem(bad.deps, { clientId: 'c1', id: 'pkg-1' }), (e) => e.status === 409);
  const empty = setup({ ...PKG, story: '', title: '' });
  await assert.rejects(createDraftFromItem(empty.deps, { clientId: 'c1', id: 'pkg-1' }), (e) => e.status === 400);
  for (const x of [s, bad, empty]) assert.equal((await x.rows()).length, 0);
});

test('guard ordering: an existing draft is returned BEFORE the rights check runs', async () => {
  const { db, deps } = setup({ ...PKG, rights: 'unknown' });
  await db.collection('social_posts').doc('d1').set({ id: 'd1', clientId: 'c1', packageId: 'pkg-1', status: 'draft' });
  assert.deepEqual(await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' }), { ok: true, postId: 'd1', existing: true });
});

test('text over 280 chars is cut to 277 + "..."; placeholder story falls back to suggestedStory then title', async () => {
  const long = setup({ ...PKG, story: 'x'.repeat(400) });
  await createDraftFromItem(long.deps, { clientId: 'c1', id: 'pkg-1' });
  const [row] = await long.rows();
  assert.equal(row.content.length, 280);
  assert.ok(row.content.endsWith('...'));
  const ph = setup({ ...PKG, story: '[add your memory]', variants: { x: { suggestedStory: 'Suggested.' } } });
  await createDraftFromItem(ph.deps, { clientId: 'c1', id: 'pkg-1' });
  assert.equal((await ph.rows())[0].content, 'Suggested.');
});

test('CURRENT (known gap): findDraft/createPost is read-then-create - two concurrent calls on a fresh package both create', async () => {
  const { deps, rows } = setup();
  const [a, b] = await Promise.all([
    createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' }),
    createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' }),
  ]);
  assert.notEqual(a.postId, b.postId);
  assert.equal((await rows()).length, 2);
});

test('falls back to deps.createPost when no ensureDraft dep is injected', async () => {
  const { deps, rows, ensureCalls } = setup();
  delete deps.ensureDraft;
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(r, { ok: true, postId: 'post-1' });
  assert.equal(ensureCalls.length, 0);
  assert.equal((await rows()).length, 1);
});
