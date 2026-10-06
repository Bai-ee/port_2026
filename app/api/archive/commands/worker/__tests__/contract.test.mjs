import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../../__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require(path.resolve(process.cwd(), 'api/_lib/__tests__/fake-firestore.cjs'));

const firebaseAdminPath = path.resolve(process.cwd(), 'api/_lib/firebase-admin.cjs');
const routeUrl = pathToFileURL(path.resolve(process.cwd(), 'app/api/archive/commands/worker/route.js'));

let importCounter = 0;

async function loadRouteWithFakeFirebase() {
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  process.env.HITLOOP_ARCHIVE_WORKER_TOKEN = 'test-worker-token';
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

async function seedCommand(fake, { id, type, workerId = 'w1', state = 'QUEUED' }) {
  await fake.adminDb.collection('archive_commands').doc(id).set({ workerId, sourceId: 's1', type, state });
}

test('GET with no types/excludeTypes claims QUEUED commands of any type for the worker (default unchanged)', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };
  await seedCommand(fake, { id: 'c1', type: 'PROCESS_COLLECTION' });
  await seedCommand(fake, { id: 'c2', type: 'LIST_DIRECTORY' });
  await seedCommand(fake, { id: 'c3', type: 'LIST_DIRECTORY', workerId: 'w2' }); // different worker, must not leak
  await seedCommand(fake, { id: 'c4', type: 'PROCESS_COLLECTION', state: 'COMPLETE' }); // not QUEUED

  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1' } }));
  assert.equal(r.status, 200);
  const body = await r.json();
  const ids = body.commands.map((c) => c.id).sort();
  assert.deepEqual(ids, ['c1', 'c2']);
});

test('GET types=LIST_DIRECTORY only claims LIST_DIRECTORY commands (browse lane)', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };
  await seedCommand(fake, { id: 'c1', type: 'PROCESS_COLLECTION' });
  await seedCommand(fake, { id: 'c2', type: 'LIST_DIRECTORY' });
  await seedCommand(fake, { id: 'c3', type: 'ORGANIZE_COLLECTION' });

  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1', types: 'LIST_DIRECTORY' } }));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.commands.map((c) => c.id), ['c2']);
  assert.ok(body.commands.every((c) => c.type === 'LIST_DIRECTORY'));
});

test('GET excludeTypes=LIST_DIRECTORY never claims LIST_DIRECTORY commands (main lane)', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };
  await seedCommand(fake, { id: 'c1', type: 'PROCESS_COLLECTION' });
  await seedCommand(fake, { id: 'c2', type: 'LIST_DIRECTORY' });
  await seedCommand(fake, { id: 'c3', type: 'ORGANIZE_COLLECTION' });

  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1', excludeTypes: 'LIST_DIRECTORY' } }));
  assert.equal(r.status, 200);
  const body = await r.json();
  const ids = body.commands.map((c) => c.id).sort();
  assert.deepEqual(ids, ['c1', 'c3']);
  assert.ok(body.commands.every((c) => c.type !== 'LIST_DIRECTORY'));
});

test('GET supports a comma list for types/excludeTypes', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer test-worker-token' };
  await seedCommand(fake, { id: 'c1', type: 'PROCESS_COLLECTION' });
  await seedCommand(fake, { id: 'c2', type: 'LIST_DIRECTORY' });
  await seedCommand(fake, { id: 'c3', type: 'ORGANIZE_COLLECTION' });
  await seedCommand(fake, { id: 'c4', type: 'UNDO_ORGANIZE' });

  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1', excludeTypes: 'LIST_DIRECTORY, ORGANIZE_COLLECTION' } }));
  const body = await r.json();
  const ids = body.commands.map((c) => c.id).sort();
  assert.deepEqual(ids, ['c1', 'c4']);
});

test('GET still requires workerId and worker auth with the new params present', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const noWorkerId = await mod.GET(fakeRequest({ headers: { authorization: 'Bearer test-worker-token' }, searchParams: { types: 'LIST_DIRECTORY' } }));
  assert.equal(noWorkerId.status, 400);

  const unauthorized = await mod.GET(fakeRequest({ headers: { authorization: 'Bearer wrong' }, searchParams: { workerId: 'w1', types: 'LIST_DIRECTORY' } }));
  assert.equal(unauthorized.status, 401);
});
