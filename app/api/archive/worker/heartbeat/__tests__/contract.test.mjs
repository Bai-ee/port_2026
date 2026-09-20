import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../../__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
// require.cache is a single process-wide map keyed by resolved absolute path,
// shared by every require() function (including one made via createRequire) —
// so injecting a fake firebase-admin.cjs here is visible to the route module's
// own createRequire('.../firebase-admin.cjs') call once it is imported below.
const { makeFakeContext } = require(path.resolve(process.cwd(), 'api/_lib/__tests__/fake-firestore.cjs'));

const firebaseAdminPath = path.resolve(process.cwd(), 'api/_lib/firebase-admin.cjs');
const routeUrl = pathToFileURL(path.resolve(process.cwd(), 'app/api/archive/worker/heartbeat/route.js'));

let importCounter = 0;
// route.js is an ES module; dynamic import() caches by specifier, so each
// test gets a fresh module instance (and thus a fresh module-scope `fb`
// binding to a fresh FakeDb) via a cache-busting query string.
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

test('archive heartbeat contract states stay intentionally narrow', () => {
  const states = ['ONLINE', 'PROCESSING', 'PAUSED', 'OFFLINE', 'ERROR'];
  assert.equal(states.includes('PROCESSING'), true);
  assert.equal(states.includes('UPLOADED'), false);
});

test('idle heartbeat with no counters does not blank a completed job\'s numbers', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };

  const processing = fakeRequest({
    headers: auth,
    body: {
      workerId: 'w1', sourceId: 's1', jobId: 'j1', state: 'PROCESSING', at: new Date().toISOString(),
      counters: { discovered: 12, hashed: 7, duplicates: 5, failed: 0 },
    },
  });
  const r1 = await mod.POST(processing);
  assert.equal(r1.status, 200);

  let stored = fake.adminDb._raw('archive_workers', 'w1');
  assert.deepEqual(stored.counters, { discovered: 12, hashed: 7, duplicates: 5, failed: 0 });
  assert.deepEqual(stored.lastJobCounters, { discovered: 12, hashed: 7, duplicates: 5, failed: 0 });
  assert.ok(stored.lastJobAt, 'lastJobAt must be stamped whenever counters arrive');

  // The daemon's idle ONLINE heartbeat (startup + every ~60s) carries no
  // counters key at all.
  const idle = fakeRequest({
    headers: auth,
    body: { workerId: 'w1', sourceId: 's1', state: 'ONLINE', at: new Date().toISOString() },
  });
  const r2 = await mod.POST(idle);
  assert.equal(r2.status, 200);
  const receivedBody = await r2.json();
  assert.equal(receivedBody.received.counters, null);

  stored = fake.adminDb._raw('archive_workers', 'w1');
  assert.equal(stored.state, 'ONLINE');
  // The regression this guards: this used to be written as `null`,
  // wiping the completed job's numbers within one idle heartbeat.
  assert.deepEqual(stored.counters, { discovered: 12, hashed: 7, duplicates: 5, failed: 0 });
  assert.deepEqual(stored.lastJobCounters, { discovered: 12, hashed: 7, duplicates: 5, failed: 0 });

  // The source subdocument gets the same treatment.
  const sourceStored = fake.adminDb._raw('archive_workers/w1/sources', 's1');
  assert.deepEqual(sourceStored.counters, { discovered: 12, hashed: 7, duplicates: 5, failed: 0 });
});

test('a worker that never ran a job has no counters and no lastJobCounters', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w2', sourceId: 's1', state: 'ONLINE', at: new Date().toISOString() } }));
  assert.equal(r.status, 200);
  const stored = fake.adminDb._raw('archive_workers', 'w2');
  assert.equal(stored.counters, undefined);
  assert.equal(stored.lastJobCounters, undefined);
});
