// Route-level pilot gate: requireAdminContext -> requirePilotOwner. Auth/context are stubbed by patching the CJS
// module exports BEFORE the route is imported; Firestore is the in-memory fake. No network.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const auth = require('../../../../../api/_lib/auth.cjs');
const provisioning = require('../../../../../api/_lib/client-provisioning.cjs');
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../../../api/_lib/__tests__/fake-firestore.cjs');

const OWNER_UID = 'owner-uid';
const OWNER_CLIENT = 'owner-client';
let who; // { uid } | null (unauthenticated)
let resolvedClient;
let admin;
let ctx;
let handlerCalls;
const realEnv = { ...process.env };
const realVerify = auth.verifyRequestUser;
const realIsAdmin = auth.isAdminEmail;
const realCtx = provisioning.getEffectiveClientContext;
const dbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');

auth.verifyRequestUser = async () => {
  handlerCalls.auth += 1;
  if (!who) throw Object.assign(new Error('Unauthorized.'), { status: 401 });
  return { uid: who.uid, email: `${who.uid}@example.com` };
};
auth.isAdminEmail = async () => admin;
provisioning.getEffectiveClientContext = async () => ({ clientId: resolvedClient });

const route = await import('../route.js');

beforeEach(() => {
  handlerCalls = { auth: 0 };
  who = { uid: OWNER_UID };
  resolvedClient = OWNER_CLIENT;
  admin = true;
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
  auth.isAdminEmail = realIsAdmin;
  provisioning.getEffectiveClientContext = realCtx;
});

const post = async (body) => {
  const res = await route.POST(new Request('http://localhost/api/dashboard/quote-targets?as=other', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};
// Any collection holding a document means some handler wrote something.
const writes = () => [...ctx.adminDb._store.entries()].filter(([, m]) => m.size).map(([c]) => c);

test('unauthenticated => 401, nothing executed', async () => {
  who = null;
  const r = await post({ action: 'draft-quote', clientId: OWNER_CLIENT });
  assert.equal(r.status, 401);
  assert.deepEqual(writes(), []);
});

test('admin but non-owner uid => 403 pilot-not-owner', async () => {
  who = { uid: 'other-admin' };
  const r = await post({ action: 'approve-package', packageId: 'p1' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'Content Management is limited to the pilot owner.');
});

test('non-admin => 403 before the pilot check', async () => {
  admin = false;
  const r = await post({ action: 'post-status', postIds: [] }); // a gate-free action still needs admin
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Admin access required/);
});

test('owner uid impersonating another client (?as=) => 403, no handler ran', async () => {
  resolvedClient = 'other-client';
  for (const body of [
    { action: 'approve-package', packageId: 'p1' },
    { action: 'reject-package', packageId: 'p1' },
    { action: 'upsert-bucket', bucket: { id: 'b1' } },
    { action: 'calendar-approve', postId: 'x' },
    { action: 'calendar-item-decide', decision: 'approve', item: {} },
    { action: 'strategy-proposal-decide', clientId: 'other-client', threadId: 't', proposalId: 'p', decision: 'confirm' },
    { action: 'strategy-autonomy-save', clientId: 'other-client' },
    { action: 'x-data-sources-save', clientId: 'other-client', strategyAccounts: 'x-api' },
    { action: 'strategy-action-undo', clientId: 'other-client' },
    { action: 'strategy-refresh', clientId: 'other-client', confirmPaid: true },
    { action: 'quote-scan-refresh', clientId: 'other-client', confirmPaid: true },
    { action: 'daily-run-generate', draftWithModel: true },
    { action: 'nas-process' },
    { action: 'not-a-real-action' },
  ]) {
    const r = await post(body);
    assert.equal(r.status, 403, body.action);
    assert.equal(r.body.error, 'Content Management is not enabled for this client.');
  }
  assert.deepEqual(writes(), []);
});

test('body clientId of the owner is ignored when the server resolved another client => 403', async () => {
  resolvedClient = 'other-client';
  const r = await post({ action: 'approve-package', packageId: 'p1', clientId: OWNER_CLIENT, requestedClientId: OWNER_CLIENT });
  assert.equal(r.status, 403);
  assert.deepEqual(writes(), []);
});

test('production with no pilot env => 503 fail closed', async () => {
  delete process.env.PILOT_OWNER_UIDS;
  const r = await post({ action: 'approve-package', packageId: 'p1' });
  assert.equal(r.status, 503);
});

test('non-pilot client (admin, other uid, other client): gate-free actions are served, no 403', async () => {
  who = { uid: 'other-admin' };
  resolvedClient = 'other-client';
  const r = await post({ action: 'post-status', postIds: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, posts: [] });
  const list = await post({ action: 'list-buckets' });
  assert.equal(list.status, 200);
  const doc = await post({ action: 'strategy-doc-get', clientId: 'other-client' });
  assert.notEqual(doc.status, 403, 'strategy doc read must not be pilot-gated');
  const g = await route.GET(new Request('http://localhost/api/dashboard/quote-targets?as=other', { headers: { authorization: 'Bearer t' } }));
  assert.notEqual(g.status, 403, 'GET reads must not be pilot-gated');
});

test('production with no pilot env: gate-free actions still serve (not 503)', async () => {
  delete process.env.PILOT_OWNER_UIDS;
  delete process.env.PILOT_CLIENT_IDS;
  const r = await post({ action: 'post-status', postIds: [] });
  assert.equal(r.status, 200);
});

test('owner uid + owner client + post-status => 200', async () => {
  const r = await post({ action: 'post-status', postIds: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, posts: [] });
});
