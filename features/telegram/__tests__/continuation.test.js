import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  signContinuationToken, verifyContinuationToken, continuationUrlFor, storagePathFor, completeContinuation,
  MAX_UPLOAD_BYTES, TOKEN_TTL_MS,
} from '../continuation.js';
import { createIntake } from '../intake.js';
import { createIntakeStorage, STORAGE_PREFIX } from '../intake-storage.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const SECRET = 'test-secret';
const NOW = 5_000_000;
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64, 2)]);

// Fake bucket with the extra File methods continuation needs (exists/getMetadata/ranged download).
function makeBucket() {
  const store = new Map();
  return {
    store,
    file(path) {
      return {
        async save(buf) { store.set(path, Buffer.from(buf)); },
        async getSignedUrl(o) { return [`https://fake/${path}?a=${o.action}&t=${o.contentType}`]; },
        async exists() { return [store.has(path)]; },
        async getMetadata() { return [{ size: String(store.get(path).length) }]; },
        async download({ start = 0, end } = {}) { return [store.get(path).subarray(start, end === undefined ? undefined : end + 1)]; },
        async delete() { store.delete(path); },
      };
    },
  };
}

async function setup({ bindingStatus = 'active', pilot = true, itemStatus = 'needs-web-upload' } = {}) {
  const fx = makeFakeContext();
  const db = fx.adminDb;
  const bucket = makeBucket();
  await db.collection('telegram_bindings').doc('7').set({ telegramUserId: 7, chatId: 100, uid: 'u1', clientId: 'c1', status: bindingStatus });
  await db.collection('telegram_intakes').doc('ti_1').set({
    id: 'ti_1', clientId: 'c1', telegramUserId: 7, chatId: 100, mode: 'single', status: 'needs-web-upload', messageIds: [1], context: { caption: 'hi' },
    continuationSent: true, items: [{ fileUniqueId: 'fu1', fileId: 'f1', kind: 'video', fileSize: 50e6, messageId: 1, status: itemStatus, attempts: 0 }],
  });
  const registered = [];
  const storage = createIntakeStorage({ bucket, db, registerAsset: async (p) => { registered.push(p); } });
  const sent = [];
  const intake = createIntake({ db, transport: null, storage, send: async (...a) => { sent.push(a); }, now: () => NOW, continuationUrl: () => '' });
  let attachCalls = 0;
  const deps = {
    db, bucket, secret: SECRET, now: () => NOW,
    requirePilotOwner: pilot ? (ctx, dec) => ({ uid: dec.uid, clientId: ctx.clientId }) : () => { throw Object.assign(new Error('no'), { code: 'pilot-not-owner' }); },
    attachWebUpload: (...a) => { attachCalls += 1; return intake.attachWebUpload(...a); },
  };
  const token = signContinuationToken({ intakeId: 'ti_1', fileUniqueId: 'fu1', clientId: 'c1', telegramUserId: 7, expiresAt: NOW + TOKEN_TTL_MS }, SECRET, { now: NOW });
  return { db, bucket, deps, token, registered, calls: () => attachCalls };
}

const path = storagePathFor({ clientId: 'c1', intakeId: 'ti_1', fileUniqueId: 'fu1', ext: 'mp4' });

test('token round-trip, tamper, expiry, disabled', () => {
  const claims = { intakeId: 'a', fileUniqueId: 'b', clientId: 'c', telegramUserId: 9, expiresAt: NOW + 1000 };
  const t = signContinuationToken(claims, SECRET, { now: NOW });
  const v = verifyContinuationToken(t, SECRET, { now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.claims.intakeId, 'a');
  assert.equal(v.claims.telegramUserId, '9');
  const [p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ i: 'a', f: 'b', c: 'other', u: '9', e: NOW + 1000 })).toString('base64url');
  assert.equal(verifyContinuationToken(`${forged}.${s}`, SECRET, { now: NOW }).reason, 'bad-signature');
  assert.equal(verifyContinuationToken(`${p}.x`, SECRET, { now: NOW }).ok, false);
  assert.equal(verifyContinuationToken(t, 'wrong', { now: NOW }).reason, 'bad-signature');
  assert.equal(verifyContinuationToken(t, SECRET, { now: NOW + 1001 }).reason, 'expired');
  assert.equal(verifyContinuationToken('garbage', SECRET).reason, 'malformed');
  assert.equal(signContinuationToken(claims, undefined), null);
  assert.equal(verifyContinuationToken(t, undefined).reason, 'disabled');
  assert.equal(continuationUrlFor('https://x.test/', 'T'), 'https://x.test/telegram-upload/T');
  assert.equal(continuationUrlFor('https://x.test', null), null);
  assert.ok(path.startsWith(`${STORAGE_PREFIX}/c1/ti_1/`));
});

test('start returns a signed PUT url for a valid item', async () => {
  const { deps, token } = await setup();
  const r = await completeContinuation(deps, { token, action: 'start', contentType: 'video/mp4', bytes: 50e6 });
  assert.equal(r.status, 200);
  assert.match(r.body.uploadUrl, /a=write/);
  assert.ok(!JSON.stringify(r.body).includes(token));
});

test('wrong item, expired, revoked binding, non-pilot owner are refused', async () => {
  const s = await setup();
  const other = signContinuationToken({ intakeId: 'ti_1', fileUniqueId: 'nope', clientId: 'c1', telegramUserId: 7, expiresAt: NOW + 1000 }, SECRET);
  assert.equal((await completeContinuation(s.deps, { token: other, action: 'start', contentType: 'video/mp4', bytes: 1e7 })).status, 404);
  const wrongClient = signContinuationToken({ intakeId: 'ti_1', fileUniqueId: 'fu1', clientId: 'c2', telegramUserId: 7, expiresAt: NOW + 1000 }, SECRET);
  assert.equal((await completeContinuation(s.deps, { token: wrongClient, action: 'start', contentType: 'video/mp4', bytes: 1e7 })).status, 403);
  const expired = signContinuationToken({ intakeId: 'ti_1', fileUniqueId: 'fu1', clientId: 'c1', telegramUserId: 7, expiresAt: NOW - 1 }, SECRET);
  assert.equal((await completeContinuation(s.deps, { token: expired, action: 'start', contentType: 'video/mp4', bytes: 1e7 })).status, 410);
  const revoked = await setup({ bindingStatus: 'revoked' });
  assert.equal((await completeContinuation(revoked.deps, { token: revoked.token, action: 'start', contentType: 'video/mp4', bytes: 1e7 })).status, 403);
  const np = await setup({ pilot: false });
  assert.equal((await completeContinuation(np.deps, { token: np.token, action: 'start', contentType: 'video/mp4', bytes: 1e7 })).status, 403);
});

test('oversize and bad type refused; non-pending item refused', async () => {
  const { deps, token } = await setup();
  assert.equal((await completeContinuation(deps, { token, action: 'start', contentType: 'video/mp4', bytes: MAX_UPLOAD_BYTES + 1 })).status, 400);
  assert.equal((await completeContinuation(deps, { token, action: 'start', contentType: 'application/pdf', bytes: 100 })).status, 400);
  assert.equal((await completeContinuation(deps, { token, action: 'start', contentType: 'video/mp4', bytes: 0 })).status, 400);
  const done = await setup({ itemStatus: 'rejected' });
  assert.equal((await completeContinuation(done.deps, { token: done.token, action: 'start', contentType: 'video/mp4', bytes: 1e7 })).status, 409);
});

test('complete refuses a missing object, size mismatch, and wrong magic bytes', async () => {
  const s = await setup();
  const req = { token: s.token, action: 'complete', contentType: 'video/mp4', bytes: MP4.length };
  assert.equal((await completeContinuation(s.deps, req)).status, 404);
  await s.bucket.file(path).save(MP4);
  assert.equal((await completeContinuation(s.deps, { ...req, bytes: MP4.length + 5 })).status, 400);
  assert.equal(s.bucket.store.has(path), false);
  await s.bucket.file(path).save(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(80, 3)]));
  assert.equal((await completeContinuation(s.deps, { ...req, bytes: 82 })).status, 400);
  assert.equal(s.calls(), 0);
});

test('complete success attaches once; repeat is idempotent', async () => {
  const s = await setup();
  await s.bucket.file(path).save(MP4);
  const req = { token: s.token, action: 'complete', contentType: 'video/mp4', bytes: MP4.length };
  const r1 = await completeContinuation(s.deps, req);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok, true);
  assert.equal(s.calls(), 1);
  assert.equal(s.registered.length, 1);
  assert.deepEqual(s.registered[0].assetRefs, [path]);
  const r2 = await completeContinuation(s.deps, req);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.status, 'already-uploaded');
  assert.equal(s.calls(), 1);
  assert.equal(s.registered.length, 1);
});
