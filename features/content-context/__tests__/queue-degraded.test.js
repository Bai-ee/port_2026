// Queue-read degradation: a failing posting-queue read must surface as raw.recentPostsError and an unusable
// 'queue' input (never silent), without breaking the other inputs. No readRecentPosts dep => no queue input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContentContext } from '../load-content-context.js';

const NOW = Date.parse('2026-10-11T18:00:00Z');

function fakeDb({ state = {}, brains = {}, packages = {} } = {}) {
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  return {
    collection(name) {
      if (name === 'x_content_packages') {
        const q = { select: () => q, get: async () => ({ docs: Object.entries(packages).map(([id, d]) => snap(id, d)) }) };
        return { ...q, doc: (id) => ({ id, get: async () => snap(id, packages[id]) }) };
      }
      return {
        doc(id) {
          return {
            get: async () => snap(id, name === 'dashboard_state' ? state[id] : undefined),
            collection: (sub) => ({ doc: () => ({ get: async () => snap('current', sub === 'client_brain' ? brains[id] : undefined) }) }),
          };
        },
      };
    },
    getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
  };
}

const mkDeps = (extra = {}) => ({
  db: fakeDb({
    state: { A: { marketingBrief: { quoteTargets: { generatedAt: new Date(NOW - 3_600_000).toISOString() } } } },
    brains: { A: { status: 'approved', version: 3 } },
    packages: { p1: { title: 'x' } },
  }),
  readPlanDoc: async () => null,
  loadBrainContext: async () => 'VOICE',
  ...extra,
});
const byId = (ctx, id) => ctx.inputs.find((i) => i.id === id);

test('1. async-rejecting readRecentPosts => recentPostsError set, queue input unusable with a caveat naming the error', async () => {
  const ctx = await loadContentContext(mkDeps({ readRecentPosts: async () => { throw new Error('firestore boom'); } }), { clientId: 'A', now: NOW });
  assert.equal(ctx.raw.queueChecked, true);
  assert.equal(ctx.raw.recentPostsError, 'firestore boom');
  const q = byId(ctx, 'queue');
  assert.ok(q);
  assert.equal(q.usable, false);
  assert.ok(q.caveats.some((c) => /firestore boom/.test(c)), 'caveat mentions the error');
  assert.ok(q.caveats.some((c) => /paused/.test(c)));
});

test('1b. other inputs still load when the queue read fails', async () => {
  const ctx = await loadContentContext(mkDeps({ readRecentPosts: async () => { throw new Error('boom'); } }), { clientId: 'A', now: NOW });
  assert.equal(byId(ctx, 'brain').usable, true);
  assert.equal(byId(ctx, 'scan').usable, true);
  assert.equal(byId(ctx, 'inventory').usable, true);
  assert.ok(byId(ctx, 'plan'));
  assert.equal(ctx.raw.packages.length, 1);
});

test('1c. a rejection with no message still degrades ("unreadable")', async () => {
  const ctx = await loadContentContext(mkDeps({ readRecentPosts: async () => { throw {}; } }), { clientId: 'A', now: NOW });
  assert.equal(ctx.raw.recentPostsError, 'unreadable');
  assert.equal(byId(ctx, 'queue').usable, false);
});

test('1d. SYNCHRONOUSLY throwing readRecentPosts also degrades instead of failing the whole load', async () => {
  const deps = mkDeps({ readRecentPosts: () => { throw new Error('sync boom'); } });
  const ctx = await loadContentContext(deps, { clientId: 'A', now: NOW });
  assert.equal(ctx.raw.recentPostsError, 'sync boom');
  assert.equal(byId(ctx, 'queue').usable, false);
});

test('2. readRecentPosts returning [] => queue input usable, no error', async () => {
  const ctx = await loadContentContext(mkDeps({ readRecentPosts: async () => [] }), { clientId: 'A', now: NOW });
  assert.equal(ctx.raw.recentPostsError, null);
  const q = byId(ctx, 'queue');
  assert.ok(q);
  assert.equal(q.usable, true);
  assert.deepEqual(q.caveats, []);
  assert.equal(q.source, 'social_posts');
});

test('3. no readRecentPosts dep => no queue input at all, queueChecked false', async () => {
  const ctx = await loadContentContext(mkDeps(), { clientId: 'A', now: NOW });
  assert.equal(ctx.raw.queueChecked, false);
  assert.equal(byId(ctx, 'queue'), undefined);
  assert.ok(!ctx.inputs.some((i) => i.id === 'queue'));
});

test('4. the versions hash differs between a healthy and a degraded queue', async () => {
  const ok = await loadContentContext(mkDeps({ readRecentPosts: async () => [] }), { clientId: 'A', now: NOW });
  const bad = await loadContentContext(mkDeps({ readRecentPosts: async () => { throw new Error('x'); } }), { clientId: 'A', now: NOW });
  assert.notEqual(ok.versions.hash, bad.versions.hash);
});
