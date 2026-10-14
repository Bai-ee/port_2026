// sync-client.test.js — X Monitor syncs are per client (multi-client 4.1).
// In-memory Firestore + injected fake X clients: no X API call, no real
// Firestore, no usage logging leaves the process.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const sync = await import('../sync.js');
const store = await import('../store.js');
const { __setXOAuthDepsForTest } = await import('../../social-posting/x-oauth.js');

const HOME = 'home-client-test';
const UE = 'undergroundexistence-test';
const OTHER = 'other-client-test';

let db;
let restores = [];
let xCalls;
let globalTokenServed;

// ── Minimal fake extensions, local to this test (arrayUnion, array-contains, batch) ──
function extendFake(fakeDb) {
  const docProto = Object.getPrototypeOf(fakeDb.collection('a').doc('b'));
  const queryProto = Object.getPrototypeOf(Object.getPrototypeOf(fakeDb.collection('a')));
  const origSet = docProto.set;
  const origGet = docProto.get;
  const origWhere = queryProto.where;
  const origRows = queryProto._rows;
  docProto.set = async function set(data, opts = {}) {
    const prev = (await origGet.call(this)).data() || {};
    const resolved = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && v.__sentinel === 'arrayUnion') {
        const base = opts.merge && Array.isArray(prev[k]) ? prev[k] : [];
        resolved[k] = [...new Set([...base, ...v.values])];
      } else {
        resolved[k] = v;
      }
    }
    return origSet.call(this, resolved, opts);
  };
  queryProto.where = function where(field, op, value) {
    if (op !== 'array-contains') return origWhere.call(this, field, op, value);
    (this._arrayContains ||= []).push({ field, value });
    return this;
  };
  queryProto._rows = function rows() {
    const limit = this._limit;
    this._limit = Infinity; // filter first, then apply the limit (as Firestore does)
    let out;
    try { out = origRows.call(this); } finally { this._limit = limit; }
    return (this._arrayContains || []).reduce(
      (acc, f) => acc.filter(({ data }) => Array.isArray(data?.[f.field]) && data[f.field].includes(f.value)),
      out,
    ).slice(0, limit);
  };
  fakeDb.batch = () => {
    const ops = [];
    return {
      set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
      delete: (ref) => ops.push(() => ref.delete()),
      commit: async () => { for (const op of ops) await op(); },
    };
  };
  return () => {
    docProto.set = origSet;
    queryProto.where = origWhere;
    queryProto._rows = origRows;
  };
}

function fakeXClient(userId, username) {
  return {
    v2: {
      get: async (path) => {
        xCalls.push(path);
        if (path === 'users/me') return { data: { id: userId, username, name: username, public_metrics: { followers_count: 10, following_count: 2, tweet_count: 5 } } };
        if (path.endsWith('/tweets')) return { data: [{ id: `t-${userId}`, text: 'hi', created_at: '2026-10-01T00:00:00Z', public_metrics: { like_count: 1 } }] };
        if (path.endsWith('/followers')) return { data: [{ id: 'f1', username: 'fan' }], meta: {} };
        throw new Error(`unexpected path ${path}`);
      },
    },
  };
}

function seedSocial(clientId, x) {
  db._patch('social_accounts', clientId, { clientId, platforms: { x } });
}

beforeEach(() => {
  xCalls = [];
  globalTokenServed = 0;
  const original = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  const originalFieldValue = fb.FieldValue;
  db = makeFakeContext().adminDb;
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => db });
  fb.FieldValue = { ...originalFieldValue, arrayUnion: (...values) => ({ __sentinel: 'arrayUnion', values }) };
  restores = [
    () => Object.defineProperty(fb, 'adminDb', original),
    () => { fb.FieldValue = originalFieldValue; },
    extendFake(db),
    __setXOAuthDepsForTest({ resolveHomeClientId: async () => HOME }),
    sync.__setXMonitorDepsForTest({
      resolveHomeClientId: async () => HOME,
      logUsage: async () => null,
      readGlobalStatus: async () => ({ connected: true, userId: '111', username: 'bai_ee', config: {} }),
      // Global token path (home exception) — counted, never a network client.
      getXOAuth2Client: async (clientId) => {
        // HOME (no per-client doc) or null (the legacy global token, which sync.js only asks for on home's behalf).
        assert.ok(clientId === HOME || clientId === null, 'only the home client may reach the global token');
        globalTokenServed += 1;
        return { client: fakeXClient('111', 'bai_ee'), tokens: { userId: '111' } };
      },
      // Per-client clients: only for clients that actually have their own X doc.
      getPlatformClient: async (clientId) => {
        const snap = await db.collection('social_accounts').doc(clientId).get();
        const x = snap.exists ? snap.data()?.platforms?.x : null;
        if (!x?.accessToken && !x?.oauth1) {
          throw Object.assign(new Error('This client has no connected X account.'), { status: 409, code: 'account-not-connected' });
        }
        return { client: fakeXClient(x.userId || x.fakeMeId, x.username), authMode: 'oauth2' };
      },
    }),
  ];
});

afterEach(() => {
  for (const restore of restores.reverse()) restore();
});

test('every sync without a clientId is a 400', async () => {
  for (const run of [() => sync.syncProfile(), () => sync.syncPosts({}), () => sync.syncAudience({}), () => sync.resolveAccountId()]) {
    await assert.rejects(run(), (err) => err.status === 400 && err.code === 'client-id-required');
  }
  assert.equal(xCalls.length, 0);
});

test('a non-home client with no X account → 409 account-not-connected; no global token, no X call', async () => {
  for (const run of [() => sync.syncProfile({ clientId: OTHER }), () => sync.syncPosts({ clientId: OTHER }), () => sync.syncAudience({ clientId: OTHER })]) {
    await assert.rejects(run(), (err) => err.status === 409 && err.code === 'account-not-connected');
  }
  assert.equal(globalTokenServed, 0);
  assert.equal(xCalls.length, 0);
  assert.deepEqual(await sync.resolveAccountId(OTHER), { accountId: null, username: null, source: null });
});

test('home with no per-client doc falls back to the global token + its userId and stamps clientIds', async () => {
  const profile = await sync.syncProfile({ clientId: HOME });
  assert.equal(profile.accountId, '111');
  assert.equal(globalTokenServed, 1);
  const posts = await sync.syncPosts({ clientId: HOME });
  assert.equal(posts.accountId, '111');
  const root = db._raw('x_monitor', '111');
  assert.deepEqual(root.clientIds, [HOME]);
  assert.equal(root.lastSyncedBy, HOME);
  assert.equal((await sync.readClientConnection(HOME)).source, 'global');
});

test('home with a per-client X doc (publishing tests) keeps monitoring the global account while it is connected', async () => {
  seedSocial(HOME, { accessToken: 'home-test-access', userId: '333', username: 'test_account' });
  assert.deepEqual(await sync.resolveAccountId(HOME), { accountId: '111', username: 'bai_ee', source: 'global' });
  const posts = await sync.syncPosts({ clientId: HOME });
  assert.equal(posts.accountId, '111');
  assert.equal(globalTokenServed, 1);
  assert.equal((await sync.readClientConnection(HOME)).source, 'global');
  assert.equal(db._raw('x_monitor', '333'), undefined);
  // Global disconnected => home behaves like any other client (its own doc).
  restores.push(sync.__setXMonitorDepsForTest({ readGlobalStatus: async () => ({ connected: false, userId: null }) }));
  assert.equal((await sync.resolveAccountId(HOME)).accountId, '333');
});

test('a non-home client never gets the global account, even with the global connected', async () => {
  seedSocial(UE, { accessToken: 'ue-access', userId: '222', username: 'ue' });
  assert.equal((await sync.resolveAccountId(UE)).accountId, '222');
  assert.notEqual((await sync.readClientConnection(UE)).source, 'global');
});

test('two clients sharing one X user are both listed in clientIds; rows stay under the account', async () => {
  seedSocial(UE, { accessToken: 'ue-access', userId: '111', username: 'shared' });
  await sync.syncProfile({ clientId: HOME });
  await sync.syncProfile({ clientId: UE });
  const root = db._raw('x_monitor', '111');
  assert.deepEqual([...root.clientIds].sort(), [HOME, UE].sort());
  assert.equal(root.lastSyncedBy, UE);
});

test('a connected client syncs its OWN account (social_accounts userId), never the global one', async () => {
  seedSocial(UE, { accessToken: 'ue-access', userId: '222', username: 'ue' });
  const posts = await sync.syncPosts({ clientId: UE });
  assert.equal(posts.accountId, '222');
  assert.deepEqual(xCalls, ['users/222/tweets']);
  assert.equal(globalTokenServed, 0);
  assert.deepEqual(db._raw('x_monitor', '222').clientIds, [UE]);
  assert.equal(db._raw('x_monitor', '111'), undefined);
  const conn = await sync.readClientConnection(UE);
  assert.equal(conn.connected, true);
  assert.equal(conn.userId, '222');
  assert.equal(conn.source, 'client');
});

test('posts/audience with an unknown account id → 409 account-id-unknown; profile learns it from users/me', async () => {
  // OAuth1 override style doc: connected, but no stored userId.
  seedSocial(UE, { oauth1: { appKey: 'k' }, username: 'ue', fakeMeId: '333' });
  await assert.rejects(sync.syncPosts({ clientId: UE }), (err) => err.status === 409 && err.code === 'account-id-unknown');
  await assert.rejects(sync.syncAudience({ clientId: UE }), (err) => err.code === 'account-id-unknown');
  assert.equal(xCalls.length, 0, 'no metered call before the id is known');
  const profile = await sync.syncProfile({ clientId: UE });
  assert.equal(profile.accountId, '333');
  assert.deepEqual(xCalls, ['users/me'], 'no extra call to learn the id');
  const posts = await sync.syncPosts({ clientId: UE });
  assert.equal(posts.accountId, '333');
});

test('findAccountIdForClient: social_accounts userId first, else an x_monitor doc listing the client, else null', async () => {
  assert.equal(await store.findAccountIdForClient(UE), null);
  assert.equal(await store.findAccountIdForClient(''), null);
  db._patch('x_monitor', '444', { accountId: '444', clientIds: [UE, HOME] });
  db._patch('x_monitor', '555', { accountId: '555', clientIds: [OTHER] });
  assert.equal(await store.findAccountIdForClient(UE), '444');
  assert.equal(await store.findAccountIdForClient(OTHER), '555');
  seedSocial(UE, { accessToken: 'a', userId: '999' });
  assert.equal(await store.findAccountIdForClient(UE), '999');
});

test('store writes without a clientId are refused', async () => {
  await assert.rejects(store.saveProfile('1', { id: '1' }), (err) => err.status === 400);
  await assert.rejects(store.saveSyncMeta('1', { a: 1 }), (err) => err.status === 400);
});
