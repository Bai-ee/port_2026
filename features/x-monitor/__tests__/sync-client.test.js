// sync-client.test.js — X Monitor syncs are per client (multi-client 4.1) and READ on the owner/app credentials.
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
const { getXUsageContext, instrumentXClient } = await import('../../x-api-usage/index.js');
const { XBudgetError } = await import('../../x-api-usage/index.js');

const HOME = 'home-client-test';
const UE = 'undergroundexistence-test';
const OTHER = 'other-client-test';

let db;
let restores = [];
let xCalls;
let xParams;
let usageTags;
let budgetCalls;
let budgetError;
let forbiddenClientCalls; // getPlatformClient / getXOAuth2Client: reads must never reach them
let ownerClientServed;
let ownerUserId;
const HANDLE_IDS = { ue_brand: '777', ue: '333', ghost: '888' };

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

// The owner/app read client: every call is recorded with its params and the usage tag active at call time.
function fakeOwnerClient() {
  return {
    v2: {
      get: async (path, params) => {
        xCalls.push(path);
        xParams.push([path, params]);
        usageTags.push(getXUsageContext());
        if (path === 'users/me') throw new Error('users/me must never be used for client reads');
        const byName = /^users\/by\/username\/(.+)$/.exec(path);
        if (byName) return { data: { id: HANDLE_IDS[decodeURIComponent(byName[1])] || '999', username: decodeURIComponent(byName[1]), name: byName[1], public_metrics: { followers_count: 10, following_count: 2, tweet_count: 5 } } };
        if (path.endsWith('/tweets')) return { data: [{ id: `t-${path}`, text: 'hi', created_at: '2026-10-01T00:00:00Z', public_metrics: { like_count: 1 } }] };
        if (path.endsWith('/followers')) return { data: [{ id: 'f1', username: 'fan' }], meta: {} };
        const byId = /^users\/(\d+)$/.exec(path);
        if (byId) return { data: { id: byId[1], username: byId[1] === '111' ? 'bai_ee' : `user${byId[1]}`, name: 'N', public_metrics: { followers_count: 10, following_count: 2, tweet_count: 5 } } };
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
  xParams = [];
  usageTags = [];
  budgetCalls = [];
  budgetError = null;
  forbiddenClientCalls = 0;
  ownerClientServed = 0;
  ownerUserId = '111'; // production: the owner OAuth1 token's user id (18508964) equals the home global userId
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
      // Writes keep these; reads must never touch them.
      getXOAuth2Client: async () => { forbiddenClientCalls += 1; throw new Error('X Monitor reads must not use getXOAuth2Client'); },
      getPlatformClient: async () => { forbiddenClientCalls += 1; throw new Error('X Monitor reads must not use getPlatformClient'); },
      getOwnerReadClient: async () => { ownerClientServed += 1; return fakeOwnerClient(); },
      getOwnerReadIdentity: async () => (ownerUserId ? { userId: ownerUserId } : null),
      assertXBudget: async (args) => { budgetCalls.push(args); if (budgetError) throw budgetError; return { ok: true }; },
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

test('a non-home client with no X account and no handle → 409 client-x-handle-missing; no X call, no budget spend', async () => {
  for (const run of [() => sync.syncProfile({ clientId: OTHER }), () => sync.syncPosts({ clientId: OTHER }), () => sync.syncAudience({ clientId: OTHER })]) {
    await assert.rejects(run(), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'client-x-handle-missing');
      assert.match(err.message, /Strategy > X profile/);
      assert.doesNotMatch(err.message, /connect/i);
      return true;
    });
  }
  assert.equal(forbiddenClientCalls, 0);
  assert.equal(xCalls.length, 0);
  assert.equal(budgetCalls.length, 0);
  assert.deepEqual(await sync.resolveAccountId(OTHER), { accountId: null, username: null, handle: null, source: null });
});

test('a non-home client with NO connection but a saved xGrowth handle: profile goes by-username on the owner client, tagged to the client', async () => {
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: '@ue_brand' } } });
  assert.deepEqual(await sync.resolveAccountId(OTHER), { accountId: null, username: 'ue_brand', handle: 'ue_brand', source: 'xgrowth-profile' });
  const profile = await sync.syncProfile({ clientId: OTHER });
  assert.deepEqual(xCalls, ['users/by/username/ue_brand']);
  assert.equal(profile.accountId, '777', 'the response id stamps where rows land');
  assert.equal(profile.callsMade, 1);
  assert.equal(forbiddenClientCalls, 0, 'getPlatformClient / getXOAuth2Client are never called');
  assert.equal(ownerClientServed, 1);
  assert.deepEqual(usageTags.map((t) => [t.clientId, t.source]), [[OTHER, 'x-monitor']], 'usage is tagged with the clientId');
  assert.deepEqual(db._raw('x_monitor', '777').clientIds, [OTHER]);
  // The id is now known from the stored doc: the next read goes by id.
  assert.deepEqual(await sync.resolveAccountId(OTHER), { accountId: '777', username: 'ue_brand', handle: 'ue_brand', source: 'x_monitor' });
});

test('the Client Brain handle works too (last in the handle chain)', async () => {
  db._patch('clients', OTHER, { id: OTHER });
  db.collection('clients').doc(OTHER).collection('client_brain').doc('current').set({ identity: { xHandle: '@ghost' } });
  const r = await sync.resolveAccountId(OTHER);
  assert.equal(r.handle, 'ghost');
  assert.equal(r.source, 'client-brain');
});

test('posts with only a handle runs the profile lookup first, then posts by id (public fields), 2 calls', async () => {
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: 'ue_brand' } } });
  const posts = await sync.syncPosts({ clientId: OTHER });
  assert.deepEqual(xCalls, ['users/by/username/ue_brand', 'users/777/tweets']);
  assert.equal(posts.accountId, '777');
  assert.equal(posts.callsMade, 2);
  assert.equal(posts.metricsSource, 'public');
  assert.deepEqual(budgetCalls.map((b) => b.estimatePosts), [1, 100]);
  const audience = await sync.syncAudience({ clientId: OTHER });
  assert.equal(audience.accountId, '777');
  assert.equal(xCalls.at(-1), 'users/777/followers');
});

test('audience with only a handle also looks the profile up first', async () => {
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: 'ue_brand' } } });
  const out = await sync.syncAudience({ clientId: OTHER });
  assert.deepEqual(xCalls, ['users/by/username/ue_brand', 'users/777/followers']);
  assert.equal(out.callsMade, 2);
});

test('private tweet fields only for the owner credential\'s own id; everyone else gets public fields only', async () => {
  seedSocial(UE, { accessToken: 'ue-access', userId: '222', username: 'ue' });
  db._patch('client_configs', UE, { marketingBriefConfig: { xGrowth: { ownHandle: 'ue' } } }); // brand == connected: it IS the client's account
  await sync.syncPosts({ clientId: UE });
  const other = xParams.find(([p]) => p === 'users/222/tweets')[1];
  assert.equal(other['tweet.fields'], 'created_at,public_metrics,referenced_tweets');
  ownerUserId = '222';
  xParams.length = 0;
  await sync.syncPosts({ clientId: UE });
  assert.match(xParams[0][1]['tweet.fields'], /non_public_metrics,organic_metrics/);
  ownerUserId = null; // unparseable token: never private
  xParams.length = 0;
  await sync.syncPosts({ clientId: UE });
  assert.doesNotMatch(xParams[0][1]['tweet.fields'], /non_public/);
});

test('the home client still resolves the global userId and gets private fields (owner id == global userId)', async () => {
  const r = await sync.resolveAccountId(HOME);
  assert.deepEqual(r, { accountId: '111', username: 'bai_ee', handle: 'bai_ee', source: 'global' });
  const posts = await sync.syncPosts({ clientId: HOME });
  assert.equal(posts.metricsSource, 'private');
  assert.match(xParams[0][1]['tweet.fields'], /non_public_metrics/);
  assert.equal(xCalls[0], 'users/111/tweets');
  assert.equal(forbiddenClientCalls, 0);
});

test('a private-field refusal on the owner id retries public-only; a public request never retries', async () => {
  let n = 0;
  restores.push(sync.__setXMonitorDepsForTest({
    getOwnerReadClient: async () => ({ v2: { get: async (path, params) => {
      xCalls.push(path); n += 1;
      if (/non_public/.test(params['tweet.fields'])) throw Object.assign(new Error('forbidden'), { code: 403 });
      return { data: [] };
    } } }),
  }));
  const home = await sync.syncPosts({ clientId: HOME });
  assert.equal(home.callsMade, 2);
  assert.equal(home.metricsSource, 'public');
  seedSocial(UE, { accessToken: 'a', userId: '222', username: 'ue' });
  xCalls.length = 0;
  restores.push(sync.__setXMonitorDepsForTest({ getOwnerReadClient: async () => ({ v2: { get: async (path) => { xCalls.push(path); throw Object.assign(new Error('boom'), { code: 403 }); } } }) }));
  await assert.rejects(sync.syncPosts({ clientId: UE }));
  assert.equal(xCalls.length, 1, 'public-only request is not retried');
});

test('assertXBudget runs with source x-monitor + the clientId before any X call; a budget error stops everything', async () => {
  seedSocial(UE, { accessToken: 'a', userId: '222', username: 'ue' });
  await sync.syncProfile({ clientId: UE });
  await sync.syncPosts({ clientId: UE, deep: true });
  assert.deepEqual(budgetCalls.map((b) => [b.source, b.clientId, b.estimatePosts]), [['x-monitor', UE, 1], ['x-monitor', UE, 200]]);

  budgetError = new XBudgetError('cap reached');
  xCalls.length = 0;
  for (const run of [() => sync.syncProfile({ clientId: UE }), () => sync.syncPosts({ clientId: UE }), () => sync.syncAudience({ clientId: UE })]) {
    await assert.rejects(run(), (err) => err.code === 'x-budget' && err.status === 429);
  }
  assert.equal(xCalls.length, 0, 'no X call after a budget refusal');
  assert.equal(ownerClientServed, 2, 'the owner client is not even resolved after a refusal');
});

test('handle-only posts: a budget refusal on the profile lookup stops before any X call', async () => {
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: 'ue_brand' } } });
  budgetError = new XBudgetError('cap reached');
  await assert.rejects(sync.syncPosts({ clientId: OTHER }), (err) => err.code === 'x-budget');
  assert.equal(xCalls.length, 0);
});

test('the owner read client is the readOnly view of the instrumented client (sync.js wiring + instrument keeps the view metered)', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../sync.js', import.meta.url), 'utf8');
  assert.match(src, /getXReadClient\(\)\.readOnly/);
  const recorded = [];
  const raw = { v2: { get: async () => ({ data: [] }) }, readOnly: { v2: { get: async () => ({ data: { id: '1' } }) } } };
  const wrapped = instrumentXClient(raw, { record: async (e) => { recorded.push(e); } });
  assert.equal(wrapped.readOnly.__xUsageInstrumented, true);
  await wrapped.readOnly.v2.get('users/by/username/x');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, 'read');
});

test('home with no per-client doc falls back to the global token + its userId and stamps clientIds', async () => {
  const profile = await sync.syncProfile({ clientId: HOME });
  assert.equal(profile.accountId, '111');
  assert.equal(xCalls[0], 'users/111');
  assert.equal(forbiddenClientCalls, 0);
  const posts = await sync.syncPosts({ clientId: HOME });
  assert.equal(posts.accountId, '111');
  const root = db._raw('x_monitor', '111');
  assert.deepEqual(root.clientIds, [HOME]);
  assert.equal(root.lastSyncedBy, HOME);
  assert.equal((await sync.readClientConnection(HOME)).source, 'global');
});

test('home with a per-client X doc (publishing tests) keeps monitoring the global account while it is connected', async () => {
  seedSocial(HOME, { accessToken: 'home-test-access', userId: '333', username: 'test_account' });
  assert.deepEqual(await sync.resolveAccountId(HOME), { accountId: '111', username: 'bai_ee', handle: 'bai_ee', source: 'global' });
  const posts = await sync.syncPosts({ clientId: HOME });
  assert.equal(posts.accountId, '111');
  assert.equal(forbiddenClientCalls, 0);
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
  db._patch('client_configs', UE, { marketingBriefConfig: { xGrowth: { ownHandle: 'shared' } } }); // brand == connected username
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
  assert.equal(forbiddenClientCalls, 0);
  assert.deepEqual(db._raw('x_monitor', '222').clientIds, [UE]);
  assert.equal(db._raw('x_monitor', '111'), undefined);
  const conn = await sync.readClientConnection(UE);
  assert.equal(conn.connected, true);
  assert.equal(conn.userId, '222');
  assert.equal(conn.source, 'client');
});

test('a connected OAuth1 doc with no stored userId: handle known → profile by-username learns the id, posts/audience run it first (no account-id-unknown)', async () => {
  seedSocial(UE, { oauth1: { appKey: 'k' }, username: 'ue' });
  const posts = await sync.syncPosts({ clientId: UE });
  assert.deepEqual(xCalls, ['users/by/username/ue', 'users/333/tweets']);
  assert.equal(posts.accountId, '333');
  xCalls.length = 0;
  const profile = await sync.syncProfile({ clientId: UE });
  assert.equal(profile.accountId, '333');
  assert.deepEqual(xCalls, ['users/333'], 'once stamped, reads go by id');
  assert.equal(forbiddenClientCalls, 0);
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

test('findAccountIdForClient: several x_monitor docs list the client → the latest profile sync wins', async () => {
  db._patch('x_monitor', 'old', { accountId: 'old', clientIds: [UE], profileUpdatedAt: 1000, updatedAt: 9000 });
  db._patch('x_monitor', 'new', { accountId: 'new', clientIds: [UE], profileUpdatedAt: 5000, updatedAt: 5000 });
  assert.equal(await store.findAccountIdForClient(UE), 'new');
});

test('store writes without a clientId are refused', async () => {
  await assert.rejects(store.saveProfile('1', { id: '1' }), (err) => err.status === 400);
  await assert.rejects(store.saveSyncMeta('1', { a: 1 }), (err) => err.status === 400);
});

test('a changed saved handle is re-resolved over the stamped x_monitor account (profile goes by the new username)', async () => {
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: 'ghost' } } });
  await sync.syncProfile({ clientId: OTHER }); // stamps OTHER on account 888 (username ghost)
  assert.equal((await sync.resolveAccountId(OTHER)).accountId, '888');
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: '@ue_brand' } } });
  assert.deepEqual(await sync.resolveAccountId(OTHER), { accountId: null, username: 'ue_brand', handle: 'ue_brand', source: 'xgrowth-profile' });
  xCalls.length = 0;
  const profile = await sync.syncProfile({ clientId: OTHER });
  assert.deepEqual(xCalls, ['users/by/username/ue_brand']);
  assert.equal(profile.accountId, '777');
});

test('the same saved handle in a different case keeps the stored account id', async () => {
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: 'ue_brand' } } });
  await sync.syncProfile({ clientId: OTHER });
  db._patch('client_configs', OTHER, { marketingBriefConfig: { xGrowth: { ownHandle: '@UE_Brand' } } });
  const r = await sync.resolveAccountId(OTHER);
  assert.equal(r.accountId, '777');
  assert.equal(r.source, 'x_monitor');
});

test('writePosts: a public-only sync keeps earlier private counters; a private sync still overwrites them', async () => {
  const base = { id: 'p1', text: 't', url: 'u', createdAt: null, kind: 'post' };
  await store.writePosts('acct-1', [{ ...base, metricsSource: 'private', metrics: { likes: 1, impressions: 100, profileClicks: 4, linkClicks: 2 } }]);
  await store.writePosts('acct-1', [{ ...base, metricsSource: 'public', metrics: { likes: 5, impressions: null, profileClicks: null, linkClicks: undefined, engagements: null } }]);
  const after = (await store.listPosts('acct-1')).find((p) => p.id === 'p1');
  assert.equal(after.metrics.likes, 5);
  assert.equal(after.metrics.impressions, 100);
  assert.equal(after.metrics.profileClicks, 4);
  assert.equal(after.metrics.linkClicks, 2);
  await store.writePosts('acct-1', [{ ...base, metricsSource: 'private', metrics: { likes: 6, impressions: 200, profileClicks: 9, linkClicks: 3 } }]);
  const again = (await store.listPosts('acct-1')).find((p) => p.id === 'p1');
  assert.equal(again.metrics.impressions, 200);
  assert.equal(again.metrics.profileClicks, 9);
});

// --- identity rule (owner 2026-11-18): a client's X identity is its own handle, never the owner's @bai_ee ---------
const OWNER_ID = '18508964';
const CQ = 'critters-quest-test';
function seedCq({ brand = 'crittersquest', connected = { accessToken: 't', userId: OWNER_ID, username: 'bai_ee' }, staleTag = true } = {}) {
  ownerUserId = OWNER_ID;
  if (brand) db._patch('client_configs', CQ, { marketingBriefConfig: { xGrowth: { ownHandle: `@${brand}` } } });
  if (connected) seedSocial(CQ, connected);
  if (staleTag) db._patch('x_monitor', OWNER_ID, { profile: { username: 'bai_ee' }, clientIds: [HOME, CQ], profileUpdatedAt: 5 });
}

test('identity: CQ (connected @bai_ee, brand crittersquest, stale x_monitor tag) -> handle only; profile by-username; owner id never used', async () => {
  seedCq();
  assert.deepEqual(await sync.resolveAccountId(CQ), { accountId: null, username: 'crittersquest', handle: 'crittersquest', source: 'xgrowth-profile' });
  const profile = await sync.syncProfile({ clientId: CQ });
  assert.deepEqual(xCalls, ['users/by/username/crittersquest']);
  assert.notEqual(profile.accountId, OWNER_ID);
  assert.ok(xCalls.every((p) => !p.includes(OWNER_ID)));
});

test('identity: connected account equal to the brand handle -> its userId is used', async () => {
  seedCq({ connected: { accessToken: 't', userId: '555', username: 'CrittersQuest' }, staleTag: false });
  assert.deepEqual(await sync.resolveAccountId(CQ), { accountId: '555', username: 'CrittersQuest', handle: 'CrittersQuest', source: 'social_accounts' });
});

test('identity: no brand handle, connected account is not the owner -> the connected account is used', async () => {
  seedCq({ brand: null, connected: { accessToken: 't', userId: '555', username: 'client_own' }, staleTag: false });
  assert.equal((await sync.resolveAccountId(CQ)).accountId, '555');
});

test('identity: no brand handle, connected account IS the owner -> 409 client-x-handle-missing (stale tag ignored too)', async () => {
  seedCq({ brand: null });
  assert.deepEqual(await sync.resolveAccountId(CQ), { accountId: null, username: null, handle: null, source: null });
  await assert.rejects(sync.syncProfile({ clientId: CQ }), (e) => e.status === 409 && e.code === 'client-x-handle-missing');
  assert.equal(xCalls.length, 0);
});

test('identity: an x_monitor doc whose profile username matches the brand handle is used; a mismatching one is not', async () => {
  seedCq({ connected: null, staleTag: true });
  db._patch('x_monitor', '777', { profile: { username: 'CrittersQuest' }, clientIds: [CQ], profileUpdatedAt: 1 });
  assert.equal((await sync.resolveAccountId(CQ)).accountId, '777');
  db._patch('x_monitor', '777', { profile: { username: 'other' } });
  assert.equal((await sync.resolveAccountId(CQ)).accountId, null);
});

test('identity: the home client is unchanged even when the owner doc lists it', async () => {
  ownerUserId = '111';
  db._patch('x_monitor', '111', { profile: { username: 'bai_ee' }, clientIds: [HOME] });
  const r = await sync.resolveAccountId(HOME);
  assert.deepEqual([r.accountId, r.handle], ['111', 'bai_ee']);
});

test('identity: owner id unknown + no brand handle -> fail closed (stale owner x_monitor tag ignored)', async () => {
  seedCq({ brand: null, connected: null, staleTag: true });
  ownerUserId = null;
  assert.deepEqual(await sync.resolveAccountId(CQ), { accountId: null, username: null, handle: null, source: null });
  assert.equal(await store.findAccountIdForClient(CQ, { skipSocial: true }), null);
  await assert.rejects(sync.syncProfile({ clientId: CQ }), (e) => e.status === 409 && e.code === 'client-x-handle-missing');
  assert.equal(xCalls.length, 0);
});

test('identity: connected oauth1 token carrying the owner id is the owner (not the client)', async () => {
  seedCq({ brand: null, connected: { username: 'bai_ee', oauth1: { accessToken: '18508964-abc' } }, staleTag: false });
  assert.equal((await sync.resolveAccountId(CQ)).accountId, null);
});
