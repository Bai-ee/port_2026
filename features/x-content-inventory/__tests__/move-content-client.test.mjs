// Covered by `npm test` (the scripts/ dir is not in the glob). Pure planner only; no Firestore.
import assert from 'node:assert/strict';
import test from 'node:test';
import { planMove, matchesFilters, postPackageId } from '../../../scripts/x-content/move-content-client.mjs';

const A = 'client-aaa';
const B = 'client-bbb';
const pkg = (id, extra = {}) => ({ id, clientId: A, engine: 'record', series: 'C1', bucketId: 'records', source: { kind: 'discogs' }, ...extra });
const post = (id, packageId, status, extra = {}) => ({ id, clientId: A, packageId, status, revision: 2, ...extra });

test('filters are AND-ed; source matches string or kind; discogs also matches discogs-ingest', () => {
  const p = pkg('p1');
  assert.ok(matchesFilters(p, { source: 'discogs', series: 'C1' }));
  assert.ok(!matchesFilters(p, { source: 'discogs', series: 'C4' }));
  assert.ok(matchesFilters(pkg('p2', { source: 'rendered-video' }), { source: 'rendered-video' }));
  assert.ok(matchesFilters(pkg('p3', { source: 'discogs-ingest' }), { source: 'discogs' }));
  assert.ok(matchesFilters(pkg('p4', { source: 'nas-archive' }), { source: 'NAS-archive' }));
  assert.ok(!matchesFilters(p, { bucket: 'ue' }));
});

test('only the from-client packages that match move; other clients and non-matches are untouched', () => {
  const plan = planMove([pkg('p1'), pkg('p2', { source: 'nas-archive' }), pkg('p3', { clientId: 'other-client' })], [], { from: A, to: B, source: 'discogs' });
  assert.deepEqual(plan.movePackages.map((m) => m.id), ['p1']);
  assert.equal(plan.movePackages[0].patch.clientId, B);
});

test('posts: movable statuses move, history stays, counts reported', () => {
  const posts = [
    post('a', 'p1', 'draft'), post('b', 'p1', 'needs_review'), post('c', 'p1', 'posted'), post('d', 'p1', 'rejected'),
    post('e', 'p1', 'failed'), post('f', 'p1', 'expired'), post('g', 'other', 'draft'), post('h', 'p1', 'draft', { clientId: 'x-client' }),
  ];
  const plan = planMove([pkg('p1')], posts, { from: A, to: B, source: 'discogs' });
  assert.deepEqual(plan.movePosts.map((m) => m.id).sort(), ['a', 'b']);
  assert.deepEqual(plan.leftBehind, { posted: 1, rejected: 1, failed: 1, expired: 1 });
  assert.equal(plan.movePosts[0].patch.clientId, B);
  assert.equal(plan.movePosts[0].patch.revision, 3);
});

test('approved / awaiting_approval reset to draft with approval cleared', () => {
  const posts = [post('a', 'p1', 'approved', { reviewedAt: 't', reviewedBy: 'me', approvedHash: 'h' }), post('b', 'p1', 'awaiting_approval')];
  const plan = planMove([pkg('p1')], posts, { from: A, to: B, source: 'discogs' });
  assert.deepEqual(plan.resetPostIds.sort(), ['a', 'b']);
  const patch = plan.movePosts.find((m) => m.id === 'a').patch;
  assert.deepEqual({ s: patch.status, r: patch.reviewedAt, b: patch.reviewedBy, h: patch.approvedHash, at: patch.scheduledAt }, { s: 'draft', r: null, b: null, h: null, at: null });
});

test('scheduled post blocks its package and that package\'s other posts', () => {
  const posts = [post('s', 'p1', 'scheduled', { scheduledAt: '2099-01-01T00:00:00Z' }), post('d', 'p1', 'draft'), post('d2', 'p2', 'draft')];
  const plan = planMove([pkg('p1'), pkg('p2')], posts, { from: A, to: B, source: 'discogs' });
  assert.deepEqual(plan.movePackages.map((m) => m.id), ['p2']);
  assert.deepEqual(plan.movePosts.map((m) => m.id), ['d2']);
  assert.deepEqual(plan.blocked.map((b) => b.postId), ['s']);
  assert.deepEqual(plan.heldPackageIds, ['p1']);
});

test('an approved post carrying scheduledAt, and a possibly-live needs_review, also block', () => {
  const posts = [post('a', 'p1', 'approved', { scheduledAt: '2099-01-01T00:00:00Z' }), post('n', 'p2', 'needs_review', { twitterId: '123' })];
  const plan = planMove([pkg('p1'), pkg('p2')], posts, { from: A, to: B, source: 'discogs' });
  assert.equal(plan.movePackages.length, 0);
  assert.equal(plan.blocked.length, 2);
});

test('discogs-ingest posts without packageId link through sourceRef.releaseId', () => {
  assert.equal(postPackageId({ source: 'discogs-ingest', sourceRef: { releaseId: 42 } }), 'discogs-42');
  const plan = planMove([pkg('discogs-42')], [{ id: 'x', clientId: A, source: 'discogs-ingest', sourceRef: { releaseId: 42 }, status: 'draft' }], { from: A, to: B, source: 'discogs' });
  assert.deepEqual(plan.movePosts.map((m) => m.id), ['x']);
});

test('includePosts:false moves packages only; buckets of moved packages are listed', () => {
  const plan = planMove([pkg('p1')], [post('a', 'p1', 'scheduled')], { from: A, to: B, source: 'discogs', includePosts: false });
  assert.equal(plan.movePackages.length, 1);
  assert.equal(plan.movePosts.length, 0);
  assert.deepEqual(plan.buckets, ['records']);
});
