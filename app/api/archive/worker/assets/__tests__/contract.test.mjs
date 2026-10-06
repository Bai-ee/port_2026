import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../../__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require(path.resolve(process.cwd(), 'api/_lib/__tests__/fake-firestore.cjs'));

const firebaseAdminPath = path.resolve(process.cwd(), 'api/_lib/firebase-admin.cjs');
const routeUrl = pathToFileURL(path.resolve(process.cwd(), 'app/api/archive/worker/assets/route.js'));

let importCounter = 0;
async function loadRouteWithFakeFirebase() {
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  process.env.HITLOOP_ARCHIVE_WORKER_TOKEN = 'test-worker-token';
  importCounter += 1;
  const mod = await import(`${routeUrl.href}?bust=${importCounter}`);
  return { fake, mod };
}

function fakeRequest({ body, headers = {} } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name) => map.get(String(name).toLowerCase()) || null },
    json: async () => body,
  };
}

test('asset sync persists a worker-reported organized stamp onto archive_review', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };

  const r = await mod.POST(fakeRequest({
    headers: auth,
    body: {
      workerId: 'w1', sourceId: 's1',
      asset: {
        id: 'asset-1', sha256: 'abc123', mediaType: 'video/mp4', sizeBytes: 1024,
        archiveName: 'clip.mp4', sourcePaths: ['Housepit/clip.mp4'],
        organized: { path: 'housepit/travel/clip.mp4', appliedAt: '2026-09-20T12:00:00.000Z' },
      },
    },
  }));
  assert.equal(r.status, 200);

  const stored = fake.adminDb._raw('archive_review', 'asset-1');
  assert.deepEqual(stored.organized, { path: 'housepit/travel/clip.mp4', appliedAt: '2026-09-20T12:00:00.000Z' });
});

test('a resync with no organized field never clears a prior organize stamp', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };

  await mod.POST(fakeRequest({
    headers: auth,
    body: {
      workerId: 'w1', sourceId: 's1',
      asset: {
        id: 'asset-1', sha256: 'abc123', sourcePaths: ['Housepit/clip.mp4'],
        organized: { path: 'housepit/travel/clip.mp4', appliedAt: '2026-09-20T12:00:00.000Z' },
      },
    },
  }));

  // A later resync (e.g. a fresh Jev decision) carries no `organized` key at all.
  const r2 = await mod.POST(fakeRequest({
    headers: auth,
    body: {
      workerId: 'w1', sourceId: 's1',
      asset: { id: 'asset-1', sha256: 'abc123', sourcePaths: ['Housepit/clip.mp4'], decisions: [{ question: 'pillar?', selectedValue: 'travel', confidence: 0.9 }] },
    },
  }));
  assert.equal(r2.status, 200);

  const stored = fake.adminDb._raw('archive_review', 'asset-1');
  assert.deepEqual(stored.organized, { path: 'housepit/travel/clip.mp4', appliedAt: '2026-09-20T12:00:00.000Z' }, 'organized must survive a sync that omits it');
});

test('rejects an unauthorized asset sync', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const r = await mod.POST(fakeRequest({ headers: { authorization: 'Bearer wrong-token' }, body: { workerId: 'w1', sourceId: 's1', asset: { id: 'a', sha256: 'x' } } }));
  assert.equal(r.status, 401);
});

test('requires worker/source and asset identity', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', asset: { id: 'a' } } }));
  assert.equal(r.status, 400);
});
