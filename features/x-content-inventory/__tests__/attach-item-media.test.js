// attachItemMedia: format allow-list, needs-staging mapping, client isolation, swap outcomes. Fake deps; no I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachItemMedia, isXPublishableContentType } from '../attach-item-media.js';

const mp4 = { mediaUrl: 'https://x/v.mp4', mediaType: 'video', mediaContentType: 'video/mp4', mediaStoragePath: 'ev:a/v.mp4' };
const mk = (over = {}) => {
  const calls = [];
  return {
    calls,
    getPackage: async (id) => (id === 'p1' ? { id: 'p1', clientId: 'c1', rights: 'owned' } : null),
    pickMedia: async () => mp4,
    swapPostMedia: async (...a) => { calls.push(a); return { approvalVoided: false }; },
    rowOf: async (id) => ({ id }),
    ...over,
  };
};
const args = { clientId: 'c1', postId: 'post1', packageId: 'p1' };

test('requires postId and packageId', async () => {
  assert.equal((await attachItemMedia(mk(), { clientId: 'c1', postId: 'post1' })).status, 400);
  assert.equal((await attachItemMedia(mk(), { clientId: 'c1', packageId: 'p1' })).status, 400);
});

test('refuses a foreign or missing package without touching the post', async () => {
  const d = mk({ getPackage: async () => ({ id: 'p1', clientId: 'other' }) });
  const r = await attachItemMedia(d, args);
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(d.calls.length, 0);
  assert.equal((await attachItemMedia(mk(), { ...args, packageId: 'nope' })).status, 404);
});

test('refuses never-public items', async () => {
  const d = mk({ getPackage: async () => ({ id: 'p1', clientId: 'c1', rights: 'never-public' }) });
  const r = await attachItemMedia(d, args);
  assert.deepEqual([r.status, r.code], [403, 'never-public']);
});

test('refuses a .mov (quicktime) source and never swaps', async () => {
  const d = mk({ pickMedia: async () => ({ ...mp4, mediaContentType: 'video/quicktime' }) });
  const r = await attachItemMedia(d, args);
  assert.deepEqual([r.ok, r.status, r.code], [false, 422, 'unsupported-format']);
  assert.equal(d.calls.length, 0);
});

test('an unstaged item (no usable media) maps to needs-staging with packageId', async () => {
  const d = mk({ pickMedia: async () => null });
  const r = await attachItemMedia(d, args);
  assert.deepEqual([r.ok, r.status, r.code, r.packageId], [false, 409, 'needs-staging', 'p1']);
  assert.equal(d.calls.length, 0);
});

test('a refused swap is a conflict', async () => {
  const r = await attachItemMedia(mk({ swapPostMedia: async () => false }), args);
  assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'post-conflict']);
});

test('success returns approvalVoided and the row', async () => {
  const d = mk({ swapPostMedia: async (...a) => { d.calls.push(a); return { approvalVoided: true }; } });
  const r = await attachItemMedia(d, args);
  assert.deepEqual(r, { ok: true, approvalVoided: true, row: { id: 'post1' } });
  assert.deepEqual(d.calls[0], ['post1', mp4]);
});

test('format allow-list', () => {
  for (const t of ['video/mp4', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']) assert.equal(isXPublishableContentType(t), true);
  for (const t of ['video/webm', 'video/quicktime', '']) assert.equal(isXPublishableContentType(t), false);
});
