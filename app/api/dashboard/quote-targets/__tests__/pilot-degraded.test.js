// Route-level degraded mode: daily-run-generate must refuse (503, "posting queue") when the social_posts queue read
// throws, and must not write a run. Technique and stubs mirror pilot-gate.test.js. No network.
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
const OWNER_CLIENT = 'bryan-balli-WUoltG84'; // daily loop is hard-limited to this client (assertOwnerClient)
let ctx;
let queueReads;
const realEnv = { ...process.env };
const realVerify = auth.verifyRequestUser;
const realIsAdmin = auth.isAdminEmail;
const realCtx = provisioning.getEffectiveClientContext;
const dbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');

auth.verifyRequestUser = async () => ({ uid: OWNER_UID, email: `${OWNER_UID}@example.com` });
auth.isAdminEmail = async () => true;
provisioning.getEffectiveClientContext = async () => ({ clientId: OWNER_CLIENT });

const route = await import('../route.js');

/** Wrap the fake db so every social_posts QUERY (where/orderBy/get) rejects, as an unavailable Firestore would. */
function breakQueueReads(db) {
  const orig = db.collection.bind(db);
  db.collection = (name) => {
    const col = orig(name);
    // The full library (the pilot default) reads packages with a field projection the shared fake does not implement.
    if (name !== 'social_posts') return col.select ? col : Object.assign(col, { select: () => col });
    const boom = () => { queueReads += 1; return Promise.reject(new Error('firestore unavailable')); };
    const chain = { where: () => chain, orderBy: () => chain, limit: () => chain, select: () => chain, get: boom };
    return { ...col, doc: col.doc.bind(col), where: () => chain, orderBy: () => chain, get: boom };
  };
}

beforeEach(() => {
  queueReads = 0;
  ctx = makeFakeContext();
  // The context loader batches package reads through db.getAll (not provided by the shared fake).
  ctx.adminDb.getAll = async (...refs) => Promise.all(refs.map((r) => r.get()));
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
  const res = await route.POST(new Request('http://localhost/api/dashboard/quote-targets', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};
const written = () => [...ctx.adminDb._store.entries()].filter(([, m]) => m.size).map(([c]) => c);

test('daily-run-generate with an unreadable posting queue => 503 mentioning the posting queue; no run stored, no post written', async () => {
  breakQueueReads(ctx.adminDb);
  const r = await post({ action: 'daily-run-generate' });
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.match(r.body.error, /posting queue/);
  assert.ok(queueReads >= 1, 'the queue read was actually attempted');
  assert.ok(!written().includes('social_posts'));
  assert.ok(!written().some((c) => /daily/i.test(c)), `no run persisted, saw ${JSON.stringify(written())}`);
});

test('control: with a healthy (empty) queue the same request is NOT the queue-degraded 503', async () => {
  const r = await post({ action: 'daily-run-generate' });
  assert.ok(!(r.status === 503 && /posting queue/.test(r.body?.error || '')), `unexpected degraded response: ${JSON.stringify(r.body)}`);
});
