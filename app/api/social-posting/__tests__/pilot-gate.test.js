// Route-level pilot gate for social-posting. approve-draft / approve-and-schedule / reject-draft are always gated;
// `update` only for lifecycleVersion>=2 rows (gatePilotRow); legacy actions stay ungated. Auth is stubbed on the
// CJS exports before the route is imported; Firestore is the in-memory fake. No network.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const auth = require('../../../../api/_lib/auth.cjs');
const provisioning = require('../../../../api/_lib/client-provisioning.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../../api/_lib/__tests__/fake-firestore.cjs');

const OWNER_UID = 'owner-uid';
const OWNER_CLIENT = 'owner-client';
let who;
let resolvedClient;
let ctx;
const realEnv = { ...process.env };
const realVerify = auth.verifyRequestUser;
const realCtx = provisioning.getEffectiveClientContext;
const dbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');

auth.verifyRequestUser = async () => {
  if (!who) throw Object.assign(new Error('Unauthorized.'), { status: 401 });
  return { uid: who.uid, email: `${who.uid}@example.com` };
};
provisioning.getEffectiveClientContext = async () => ({ clientId: resolvedClient });

const route = await import('../route.js');

const seed = (id, extra = {}) => ctx.adminDb.collection('social_posts').doc(id).set({
  id, clientId: 'c-other', content: 'Original text', status: 'draft', createdAt: new Date().toISOString(), ...extra,
});
const raw = (id) => ctx.adminDb._raw('social_posts', id);

beforeEach(() => {
  who = { uid: 'non-owner' };
  resolvedClient = 'c-other';
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  process.env.PILOT_OWNER_UIDS = OWNER_UID;
  process.env.PILOT_CLIENT_IDS = OWNER_CLIENT;
  process.env.VERCEL_ENV = 'production';
});
afterEach(() => {
  Object.defineProperty(fb, 'adminDb', dbDescriptor);
  process.env = { ...realEnv };
});
test.after(() => {
  auth.verifyRequestUser = realVerify;
  provisioning.getEffectiveClientContext = realCtx;
});

const post = async (body) => {
  const res = await route.POST(new Request('http://localhost/api/social-posting', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

test('unauthenticated => 401 and the row is untouched', async () => {
  who = null;
  await seed('p1');
  const r = await post({ action: 'reject-draft', postId: 'p1' });
  assert.equal(r.status, 401);
  assert.equal(raw('p1').status, 'draft');
});

for (const [action, extra] of [
  ['approve-draft', {}],
  ['approve-and-schedule', { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }],
  ['reject-draft', {}],
]) {
  test(`${action} as non-owner => 403, row unchanged`, async () => {
    await seed('p1');
    const before = JSON.stringify(raw('p1'));
    const r = await post({ action, postId: 'p1', ...extra });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'Content Management is limited to the pilot owner.');
    assert.equal(JSON.stringify(raw('p1')), before);
  });

  test(`${action} by the owner uid on a non-owner client (impersonation) => 403, body clientId ignored`, async () => {
    who = { uid: OWNER_UID };
    await seed('p1');
    const before = JSON.stringify(raw('p1'));
    const r = await post({ action, postId: 'p1', clientId: OWNER_CLIENT, ...extra });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'Content Management is not enabled for this client.');
    assert.equal(JSON.stringify(raw('p1')), before);
  });
}

test('owner uid + owner client: reject-draft works (gate passes)', async () => {
  who = { uid: OWNER_UID };
  resolvedClient = OWNER_CLIENT;
  await seed('p1', { clientId: OWNER_CLIENT });
  const r = await post({ action: 'reject-draft', postId: 'p1' });
  assert.equal(r.status, 200);
  assert.equal(raw('p1').status, 'rejected');
});

test('update on a legacy row (no lifecycleVersion) by a non-owner still succeeds (Copywriter compat)', async () => {
  await seed('legacy');
  const r = await post({ action: 'update', postId: 'legacy', content: 'Edited legacy text' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(raw('legacy').content, 'Edited legacy text');
});

test('update on a lifecycleVersion:2 row by a non-owner => 403, row unchanged', async () => {
  await seed('v2', { lifecycleVersion: 2 });
  const r = await post({ action: 'update', postId: 'v2', content: 'Hijacked' });
  assert.equal(r.status, 403);
  assert.equal(raw('v2').content, 'Original text');
});

test('update on a lifecycleVersion:2 row by the owner passes the gate', async () => {
  who = { uid: OWNER_UID };
  resolvedClient = OWNER_CLIENT;
  await seed('v2', { clientId: OWNER_CLIENT, lifecycleVersion: 2 });
  const r = await post({ action: 'update', postId: 'v2', content: 'Owner edit' });
  assert.notEqual(r.status, 403, JSON.stringify(r.body));
});

test('score stays ungated for a non-owner', async () => {
  const r = await post({ action: 'score', content: 'A reasonable post about design systems.' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('schedule stays ungated: a non-owner rejection is not a pilot error', async () => {
  const r = await post({ action: 'schedule', content: 'Hello', scheduledAt: 'not-a-date' });
  assert.notEqual(r.status, 401);
  assert.doesNotMatch(String(r.body.error), /pilot owner|not enabled for this client/);
  assert.ok(!r.body.code || !String(r.body.code).startsWith('pilot-'));
});

for (const action of ['approve-post', 'reject-post', 'attach-media', 'retry-self-reply']) {
  test(`${action} on a lifecycleVersion:2 row by a non-owner (or owner uid impersonating another client) => 403, row unchanged`, async () => {
    await seed('v2row', { lifecycleVersion: 2, status: 'awaiting_approval' });
    const before = JSON.stringify(raw('v2row'));
    who = { uid: 'non-owner' };
    assert.equal((await post({ action, postId: 'v2row' })).status, 403);
    who = { uid: OWNER_UID }; // owner uid, but the server resolved another client (?as= impersonation)
    assert.equal((await post({ action, postId: 'v2row', clientId: OWNER_CLIENT })).status, 403);
    assert.equal(JSON.stringify(raw('v2row')), before);
  });
}

test('reject-post on a LEGACY awaiting_approval row (Social Auto-Publish) stays available to its own client', async () => {
  await seed('legacy', { status: 'awaiting_approval' });
  const r = await post({ action: 'reject-post', postId: 'legacy' });
  assert.notEqual(r.status, 403);
});
