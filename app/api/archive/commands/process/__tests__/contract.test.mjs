import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../../__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require(path.resolve(process.cwd(), 'api/_lib/__tests__/fake-firestore.cjs'));

const firebaseAdminPath = path.resolve(process.cwd(), 'api/_lib/firebase-admin.cjs');
const routeUrl = pathToFileURL(path.resolve(process.cwd(), 'app/api/archive/commands/process/route.js'));

let importCounter = 0;
const ADMIN_EMAIL = 'admin@example.com';

async function loadRouteWithFakeFirebase() {
  const fake = {
    ...makeFakeContext(),
    // verifyAdminRequest (api/_lib/auth.cjs) needs adminAuth.verifyIdToken;
    // real firebase-admin.cjs exposes it as a getter, a plain property works
    // identically for every call site that reads fb.adminAuth.
    adminAuth: {
      verifyIdToken: async (token) => {
        if (token !== 'good-token') throw new Error('invalid token');
        return { uid: 'admin-uid', email: ADMIN_EMAIL };
      },
    },
  };
  await fake.adminDb.collection('admins').doc(ADMIN_EMAIL).set({});
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  importCounter += 1;
  const mod = await import(`${routeUrl.href}?bust=${importCounter}`);
  return { fake, mod };
}

function fakeRequest({ headers = {}, searchParams } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name) => map.get(String(name).toLowerCase()) || null },
    nextUrl: { searchParams: new URLSearchParams(searchParams || {}) },
  };
}

test('recent commands GET returns the last 5 for a worker, newest first, with FAILED errors surfaced', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };

  const base = Date.parse('2026-09-20T00:00:00.000Z');
  const seed = [
    { id: 'c1', type: 'LIST_DIRECTORY', state: 'COMPLETE', offsetMin: 0 },
    { id: 'c2', type: 'PROCESS_COLLECTION', state: 'COMPLETE', offsetMin: 1 },
    { id: 'c3', type: 'PROCESS_COLLECTION', state: 'FAILED', error: 'disk full', offsetMin: 2 },
    { id: 'c4', type: 'LIST_DIRECTORY', state: 'COMPLETE', offsetMin: 3 },
    { id: 'c5', type: 'UPLOAD_ASSET_ARWEAVE', state: 'RUNNING', offsetMin: 4 },
    { id: 'c6', type: 'PROCESS_COLLECTION', state: 'QUEUED', offsetMin: 5 },
  ];
  for (const c of seed) {
    await fake.adminDb.collection('archive_commands').doc(c.id).set({
      workerId: 'w1', sourceId: 's1', type: c.type, state: c.state, error: c.error || null,
      updatedAt: { toDate: () => new Date(base + c.offsetMin * 60000) },
    });
  }
  // A command belonging to a different worker must never leak into w1's strip.
  await fake.adminDb.collection('archive_commands').doc('other-worker').set({
    workerId: 'w2', sourceId: 's9', type: 'PROCESS_COLLECTION', state: 'COMPLETE',
    updatedAt: { toDate: () => new Date(base + 999 * 60000) },
  });

  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1' } }));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.commands.length, 5);
  assert.deepEqual(body.commands.map((c) => c.id), ['c6', 'c5', 'c4', 'c3', 'c2']);

  const failed = body.commands.find((c) => c.id === 'c3');
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.error, 'disk full');

  const complete = body.commands.find((c) => c.id === 'c4');
  assert.equal(complete.error, null, 'error must only surface for FAILED commands');
});

test('recent commands GET requires admin auth', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const r = await mod.GET(fakeRequest({ headers: { authorization: 'Bearer wrong-token' }, searchParams: { workerId: 'w1' } }));
  assert.equal(r.status, 403);
});

test('recent commands GET requires workerId', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const r = await mod.GET(fakeRequest({ headers: { authorization: 'Bearer good-token' } }));
  assert.equal(r.status, 400);
});
