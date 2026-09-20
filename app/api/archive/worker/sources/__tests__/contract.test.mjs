import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../../__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require(path.resolve(process.cwd(), 'api/_lib/__tests__/fake-firestore.cjs'));

const firebaseAdminPath = path.resolve(process.cwd(), 'api/_lib/firebase-admin.cjs');
const routeUrl = pathToFileURL(path.resolve(process.cwd(), 'app/api/archive/worker/sources/route.js'));

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

test('registering a source upserts the parent archive_workers/{workerId} doc so a fresh worker is visible before its first heartbeat', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };

  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', label: 'Bryan NAS' } }));
  assert.equal(r.status, 200);

  const worker = fake.adminDb._raw('archive_workers', 'w1');
  assert.ok(worker, 'parent archive_workers/{workerId} doc must exist from source registration alone, before any heartbeat');
  assert.equal(worker.workerId, 'w1');
  assert.ok(worker.registeredAt, 'registeredAt must be set on first registration');
  assert.ok(worker.updatedAt);

  const source = fake.adminDb._raw('archive_workers/w1/sources', 's1');
  assert.equal(source.label, 'Bryan NAS');
  assert.equal(source.state, 'ONLINE');
});

test('re-registering the same worker (daemon restart) does not overwrite registeredAt', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };

  await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', label: 'Bryan NAS' } }));
  const firstRegisteredAt = fake.adminDb._raw('archive_workers', 'w1').registeredAt;

  const r2 = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', label: 'Bryan NAS' } }));
  assert.equal(r2.status, 200);

  const workerAfter = fake.adminDb._raw('archive_workers', 'w1');
  assert.deepEqual(workerAfter.registeredAt, firstRegisteredAt, 'registeredAt is first-write-wins, not touched on subsequent registrations');
});
