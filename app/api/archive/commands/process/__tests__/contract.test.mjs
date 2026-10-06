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

function fakeRequest({ headers = {}, searchParams, body } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name) => map.get(String(name).toLowerCase()) || null },
    nextUrl: { searchParams: new URLSearchParams(searchParams || {}) },
    json: async () => body,
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

test('POST defaults to PROCESS_COLLECTION so existing callers are unaffected', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'PROCESS_COLLECTION');
  assert.equal(stored.mode, undefined);
});

test('POST accepts ORGANIZE_COLLECTION with a valid mode and stores it on the QUEUED command', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', type: 'ORGANIZE_COLLECTION', mode: 'plan' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'ORGANIZE_COLLECTION');
  assert.equal(stored.mode, 'plan');
  assert.equal(stored.state, 'QUEUED');
  assert.equal(stored.workerId, 'w1');
  assert.equal(stored.sourceId, 's1');
  assert.equal(stored.relativePath, 'Housepit');
});

test('POST rejects ORGANIZE_COLLECTION with a missing or invalid mode', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const missing = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', type: 'ORGANIZE_COLLECTION' } }));
  assert.equal(missing.status, 400);
  const invalid = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', type: 'ORGANIZE_COLLECTION', mode: 'delete-everything' } }));
  assert.equal(invalid.status, 400);
});

test('POST accepts UNDO_ORGANIZE with no mode required', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', type: 'UNDO_ORGANIZE' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'UNDO_ORGANIZE');
  assert.equal(stored.mode, undefined);
});

test('POST rejects an unrecognized type', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', type: 'DELETE_EVERYTHING' } }));
  assert.equal(r.status, 400);
});

test('POST keeps the same relativePath traversal guard for the new command types', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: '../etc', type: 'ORGANIZE_COLLECTION', mode: 'plan' } }));
  assert.equal(r.status, 400);
});

test('GET by commandId polls a single command, mirroring the browse route contract', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const plan = { root: '/Volumes/bryan/HITLOOP-ARCHIVE', moves: [{ sha256: 'abc', from: 'Housepit/clip.mp4', to: 'housepit/travel/clip.mp4', pillar: 'travel', confidence: 0.9, sizeBytes: 100 }], skipped: [{ path: 'Housepit/notes.txt', reason: 'unknown extension' }], counts: { moves: 1, skipped: 1, bytes: 100 } };
  await fake.adminDb.collection('archive_commands').doc('cmd-1').set({ workerId: 'w1', sourceId: 's1', type: 'ORGANIZE_COLLECTION', mode: 'plan', state: 'COMPLETE', result: { plan } });

  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { commandId: 'cmd-1' } }));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.id, 'cmd-1');
  assert.equal(body.state, 'COMPLETE');
  assert.deepEqual(body.result.plan, plan);
});

test('GET by commandId 404s for an unknown command', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { commandId: 'nope' } }));
  assert.equal(r.status, 404);
});

test('POST accepts PROCESS_SELECTION with a valid collectionId and items, storing no relativePath', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [
    { relativePath: 'Housepit/2008/clip.mp4', kind: 'file' },
    { relativePath: 'Housepit/2009', kind: 'folder' },
  ];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'housepit-2008', items } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'PROCESS_SELECTION');
  assert.equal(stored.collectionId, 'housepit-2008');
  assert.deepEqual(stored.items, items);
  assert.equal(stored.relativePath, undefined);
});

test('POST rejects PROCESS_SELECTION with a missing or invalid collectionId', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'a', kind: 'file' }];
  const missing = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', items } }));
  assert.equal(missing.status, 400);
  const invalid = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'Not_Valid!', items } }));
  assert.equal(invalid.status, 400);
});

test('POST rejects PROCESS_SELECTION with empty, oversized, or malformed items', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const base = { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'a-collection' };

  const missing = await mod.POST(fakeRequest({ headers: auth, body: { ...base } }));
  assert.equal(missing.status, 400);

  const empty = await mod.POST(fakeRequest({ headers: auth, body: { ...base, items: [] } }));
  assert.equal(empty.status, 400);

  const tooMany = await mod.POST(fakeRequest({ headers: auth, body: { ...base, items: Array.from({ length: 501 }, (_, i) => ({ relativePath: `f${i}`, kind: 'file' })) } }));
  assert.equal(tooMany.status, 400);

  const badKind = await mod.POST(fakeRequest({ headers: auth, body: { ...base, items: [{ relativePath: 'a', kind: 'symlink' }] } }));
  assert.equal(badKind.status, 400);

  const traversal = await mod.POST(fakeRequest({ headers: auth, body: { ...base, items: [{ relativePath: '../etc/passwd', kind: 'file' }] } }));
  assert.equal(traversal.status, 400);

  const leadingSlash = await mod.POST(fakeRequest({ headers: auth, body: { ...base, items: [{ relativePath: '/etc/passwd', kind: 'file' }] } }));
  assert.equal(leadingSlash.status, 400);

  const emptyPath = await mod.POST(fakeRequest({ headers: auth, body: { ...base, items: [{ relativePath: '', kind: 'file' }] } }));
  assert.equal(emptyPath.status, 400);
});

test('POST accepts an at-cap 500-item PROCESS_SELECTION', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = Array.from({ length: 500 }, (_, i) => ({ relativePath: `f${i}.mp4`, kind: 'file' }));
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'big-batch', items } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.items.length, 500);
});

test('POST accepts ORGANIZE_COLLECTION scoped to a selection via items+collectionId, relativePath optional', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'Housepit/2008/clip.mp4', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'ORGANIZE_COLLECTION', mode: 'plan', collectionId: 'housepit-2008', items } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'ORGANIZE_COLLECTION');
  assert.equal(stored.mode, 'plan');
  assert.equal(stored.collectionId, 'housepit-2008');
  assert.deepEqual(stored.items, items);
  assert.equal(stored.relativePath, undefined);
});

test('POST accepts ORGANIZE_COLLECTION with items AND an explicit relativePath', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'Housepit/2008/clip.mp4', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'ORGANIZE_COLLECTION', mode: 'apply', collectionId: 'housepit-2008', items, relativePath: 'Housepit' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.relativePath, 'Housepit');
});

test('POST rejects ORGANIZE_COLLECTION items without a valid collectionId', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'a', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'ORGANIZE_COLLECTION', mode: 'plan', items } }));
  assert.equal(r.status, 400);
});

test('POST rejects ORGANIZE_COLLECTION items-scoped traversal in relativePath', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'a', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'ORGANIZE_COLLECTION', mode: 'plan', collectionId: 'c1', items, relativePath: '../etc' } }));
  assert.equal(r.status, 400);
});

test('POST accepts UNDO_ORGANIZE scoped to a selection via collectionId, relativePath optional', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'UNDO_ORGANIZE', collectionId: 'housepit-2008' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'UNDO_ORGANIZE');
  assert.equal(stored.collectionId, 'housepit-2008');
  assert.equal(stored.relativePath, undefined);
});

test('POST rejects UNDO_ORGANIZE with an invalid collectionId', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'UNDO_ORGANIZE', collectionId: 'Not Valid' } }));
  assert.equal(r.status, 400);
});

test('recent commands GET surfaces collectionId and itemCount without leaking the full items array', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'a', kind: 'file' }, { relativePath: 'b', kind: 'folder' }];
  await fake.adminDb.collection('archive_commands').doc('c1').set({
    workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'sel-1', items, state: 'QUEUED',
    updatedAt: { toDate: () => new Date() },
  });
  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1' } }));
  const body = await r.json();
  const found = body.commands.find((c) => c.id === 'c1');
  assert.equal(found.collectionId, 'sel-1');
  assert.equal(found.itemCount, 2);
  assert.equal(found.items, undefined);
});

test('recent commands GET reports itemCount null and collectionId null for commands without a selection', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  await fake.adminDb.collection('archive_commands').doc('c1').set({
    workerId: 'w1', sourceId: 's1', type: 'PROCESS_COLLECTION', relativePath: 'Housepit', state: 'QUEUED',
    updatedAt: { toDate: () => new Date() },
  });
  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1' } }));
  const body = await r.json();
  const found = body.commands.find((c) => c.id === 'c1');
  assert.equal(found.collectionId, null);
  assert.equal(found.itemCount, null);
});

test('POST accepts CANCEL_JOB with no target (cancels whatever is active) and stores no relativePath', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'CANCEL_JOB');
  assert.equal(stored.state, 'QUEUED');
  assert.equal(stored.targetCommandId, undefined);
  assert.equal(stored.jobId, undefined);
  assert.equal(stored.relativePath, undefined);
});

test('POST accepts CANCEL_JOB with a commandId that belongs to the same worker, storing it as targetCommandId', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  await fake.adminDb.collection('archive_commands').doc('proc-1').set({ workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', state: 'RUNNING' });

  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', commandId: 'proc-1' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'CANCEL_JOB');
  assert.equal(stored.targetCommandId, 'proc-1');
});

test('POST accepts CANCEL_JOB with an explicit jobId', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', jobId: 'job-123' } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.jobId, 'job-123');
});

test('POST rejects CANCEL_JOB with a commandId that does not exist', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', commandId: 'does-not-exist' } }));
  assert.equal(r.status, 404);
});

test('POST rejects CANCEL_JOB with a commandId belonging to a different worker', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  await fake.adminDb.collection('archive_commands').doc('proc-other').set({ workerId: 'w2', sourceId: 's9', type: 'PROCESS_COLLECTION', state: 'RUNNING' });
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', commandId: 'proc-other' } }));
  assert.equal(r.status, 403);
});

test('POST rejects CANCEL_JOB with a non-string/empty commandId or jobId', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const emptyCommandId = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', commandId: '' } }));
  assert.equal(emptyCommandId.status, 400);
  const numericCommandId = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', commandId: 42 } }));
  assert.equal(numericCommandId.status, 400);
  const emptyJobId = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', jobId: '' } }));
  assert.equal(emptyJobId.status, 400);
});

test('recent commands GET includes CANCEL_JOB rows alongside other command types', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  await fake.adminDb.collection('archive_commands').doc('cancel-1').set({
    workerId: 'w1', sourceId: 's1', type: 'CANCEL_JOB', state: 'COMPLETE', targetCommandId: 'proc-1',
    result: { cancelled: true, jobId: 'job-1', hashedSoFar: 4 },
    updatedAt: { toDate: () => new Date() },
  });
  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1' } }));
  const body = await r.json();
  const found = body.commands.find((c) => c.id === 'cancel-1');
  assert.ok(found, 'CANCEL_JOB command must appear in the recent-commands list');
  assert.equal(found.type, 'CANCEL_JOB');
  assert.equal(found.state, 'COMPLETE');
});

test('POST accepts PROCESS_SELECTION with mediaOnly:true and stores it on the command', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'Housepit/2008/clip.mp4', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'housepit-2008', items, mediaOnly: true } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.mediaOnly, true);
});

test('POST accepts PROCESS_SELECTION with mediaOnly:false and stores it on the command', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'a', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'c1', items, mediaOnly: false } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.mediaOnly, false);
});

test('POST omits mediaOnly on PROCESS_SELECTION when not provided (unchanged prior behavior)', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'a', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'c1', items } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.mediaOnly, undefined);
});

test('POST rejects PROCESS_SELECTION with a non-boolean mediaOnly', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const items = [{ relativePath: 'a', kind: 'file' }];
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', type: 'PROCESS_SELECTION', collectionId: 'c1', items, mediaOnly: 'yes' } }));
  assert.equal(r.status, 400);
});

test('POST accepts PROCESS_COLLECTION with mediaOnly:false explicitly (the PROCESS FOLDER button always sends this)', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', mediaOnly: false } }));
  assert.equal(r.status, 202);
  const body = await r.json();
  const stored = fake.adminDb._raw('archive_commands', body.commandId);
  assert.equal(stored.type, 'PROCESS_COLLECTION');
  assert.equal(stored.mediaOnly, false);
});

test('POST rejects PROCESS_COLLECTION with a non-boolean mediaOnly', async () => {
  const { mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const r = await mod.POST(fakeRequest({ headers: auth, body: { workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', mediaOnly: 1 } }));
  assert.equal(r.status, 400);
});

test('recent commands GET surfaces `result` only for COMPLETE ORGANIZE_COLLECTION/UNDO_ORGANIZE, never for PROCESS_COLLECTION', async () => {
  const { fake, mod } = await loadRouteWithFakeFirebase();
  const auth = { authorization: 'Bearer good-token' };
  const base = Date.parse('2026-09-20T00:00:00.000Z');
  const applyResult = { plan: { moves: [], skipped: [], counts: { moves: 0, skipped: 0, bytes: 0 } }, applied: { moved: 3, journal: '_meta/moves.jsonl' } };
  await fake.adminDb.collection('archive_commands').doc('c1').set({
    workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', type: 'ORGANIZE_COLLECTION', mode: 'apply', state: 'COMPLETE',
    result: applyResult, updatedAt: { toDate: () => new Date(base) },
  });
  await fake.adminDb.collection('archive_commands').doc('c2').set({
    workerId: 'w1', sourceId: 's1', relativePath: 'Housepit', type: 'PROCESS_COLLECTION', state: 'COMPLETE',
    result: { some: 'payload' }, updatedAt: { toDate: () => new Date(base + 60000) },
  });

  const r = await mod.GET(fakeRequest({ headers: auth, searchParams: { workerId: 'w1' } }));
  const body = await r.json();
  const organize = body.commands.find((c) => c.id === 'c1');
  const process_ = body.commands.find((c) => c.id === 'c2');
  assert.deepEqual(organize.result, applyResult);
  assert.equal(organize.mode, 'apply');
  assert.equal(organize.sourceId, 's1');
  assert.equal(organize.relativePath, 'Housepit');
  assert.equal(process_.result, null, 'PROCESS_COLLECTION never surfaces its result in the recent-commands list');
});
