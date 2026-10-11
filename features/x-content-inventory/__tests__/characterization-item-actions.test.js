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
  const deps = {
    getPackage: async (id) => (id === pkg.id ? pkg : null),
    async findDraft(...args) {
      findCalls.push(args);
      const snap = await db.collection('social_posts').where('packageId', '==', args[0]).limit(10).get();
      const rows = snap.docs.map((d) => d.data());
      return rows.find((r) => r.status === 'draft' || r.status === 'scheduled') || rows[0] || null;
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
  return { db, deps, rows, findCalls };
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
  await db.collection('social_posts').doc('s1').set({ id: 's1', packageId: 'pkg-1', status: 'scheduled', scheduledAt: '2026-10-12T14:00:00Z' });
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(r, { ok: true, postId: 's1', existing: true });
  assert.equal((await rows()).length, 1);
});

test('CURRENT (known gap): approved row not reused -> a SECOND row is created for the same package', async () => {
  const { db, deps, rows } = setup();
  await db.collection('social_posts').doc('a1').set({ id: 'a1', packageId: 'pkg-1', status: 'approved', scheduledAt: null });
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.equal(r.existing, undefined);
  assert.equal(r.postId, 'post-1');
  const all = await rows();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((x) => x.status).sort(), ['approved', 'draft']);
});

test('CURRENT (known gap): queued/posting/needs_review/posted rows are not reused either -> duplicate draft', async () => {
  for (const status of ['queued', 'posting', 'needs_review', 'posted']) {
    const { db, deps, rows } = setup();
    await db.collection('social_posts').doc('x1').set({ id: 'x1', packageId: 'pkg-1', status });
    const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
    assert.equal(r.existing, undefined, status);
    assert.equal((await rows()).length, 2, status);
  }
});

test('CURRENT (known gap): findDraft is called with the packageId ONLY - clientId never reaches the lookup (not client-scoped)', async () => {
  const { db, deps, findCalls } = setup();
  // A draft belonging to ANOTHER client is returned and reused for client c1.
  await db.collection('social_posts').doc('other').set({ id: 'other', clientId: 'c2', packageId: 'pkg-1', status: 'draft' });
  const r = await createDraftFromItem(deps, { clientId: 'c1', id: 'pkg-1' });
  assert.deepEqual(findCalls, [['pkg-1']]);
  assert.deepEqual(r, { ok: true, postId: 'other', existing: true });
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
  await db.collection('social_posts').doc('d1').set({ id: 'd1', packageId: 'pkg-1', status: 'draft' });
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
