// CHARACTERIZATION: pins CURRENT behaviour of the single-use approval token
// (api/_lib/social-approval.cjs) and the public approve route. Not a spec of
// desired behaviour. No network, no real X/Firestore.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../../../api/_lib/__tests__/fake-firestore.cjs');
const approval = require('../../../../../api/_lib/social-approval.cjs');

const { __setXAdapterDepsForTest } = await import('../../../../../features/social-posting/adapters/x.js');
const svc = await import('../../../../../features/social-posting/twitter-service.js');
const route = await import('../route.js');

let ctx;
let tweets;
let tweetError;
let restoreDeps;
let originalDbDescriptor;
let ipCounter = 0;
const realNow = Date.now;
const realEnv = { ...process.env };

const raw = (coll, id) => ctx.adminDb._raw(coll, id);

beforeEach(() => {
  tweets = [];
  tweetError = null;
  process.env.SOCIAL_APPROVAL_SECRET = 'test-secret';
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  // The shared fake has no batch(); revokeApprovals* use one.
  ctx.adminDb.batch = () => {
    const ops = [];
    return { set: (ref, data, o) => ops.push(() => ref.set(data, o)), commit: async () => { for (const op of ops) await op(); } };
  };
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({
      authMode: 'oauth2',
      client: {
        v1: { uploadMedia: async () => 'm1' },
        v2: {
          tweet: async (payload) => {
            if (tweetError) throw tweetError;
            tweets.push(payload);
            return { data: { id: `main-${tweets.length}` } };
          },
        },
      },
    }),
    fetchMedia: async () => { throw new Error('no media in these tests'); },
  });
});

afterEach(() => {
  Date.now = realNow;
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
  process.env = { ...realEnv };
});

async function pendingPost(clientId = 'c1', extra = {}) {
  return svc.createSocialPost(clientId, {
    content: 'Approve me.', source: 'daily-video:x:2026-10-01', status: 'awaiting_approval', ...extra,
  });
}

// A fresh IP per request: the fake transaction has no tx.update, so a second
// hit on the same rate-limit key would fail closed (429) for fake-only reasons.
const req = (method, { url = 'http://localhost/api/public/social-approve', body, rawBody } = {}) => new Request(url, {
  method,
  headers: { 'x-forwarded-for': `10.0.0.${++ipCounter}`, 'content-type': 'application/json', 'user-agent': 'node-test' },
  ...(method === 'POST' ? { body: rawBody !== undefined ? rawBody : JSON.stringify(body) } : {}),
});
const get = (token) => route.GET(req('GET', { url: `http://localhost/api/public/social-approve?token=${encodeURIComponent(token)}` }));
const post = (body) => route.POST(req('POST', { body }));
const parse = async (res) => ({ status: res.status, body: await res.json() });

// ── token module ────────────────────────────────────────────────────────────

test('signApprovalToken requires postId, clientId and platform (400)', async () => {
  for (const bad of [{}, { postId: 'p' }, { postId: 'p', clientId: 'c' }]) {
    await assert.rejects(() => approval.signApprovalToken(bad), (e) => e.status === 400);
  }
});

test('signApprovalToken writes an unburned apv_ record with a 48h TTL and a verifiable token', async () => {
  const { token, tokenId, expiresAt } = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  assert.match(tokenId, /^apv_[0-9a-f]{24}$/);
  const doc = raw('social_approvals', tokenId);
  assert.equal(doc.postId, 'p1');
  assert.equal(doc.clientId, 'c1');
  assert.equal(doc.platform, 'x');
  assert.equal(doc.redeemedAt, null);
  assert.equal(doc.revokedAt, null);
  assert.equal(doc.result, null);
  assert.equal(expiresAt - doc.createdAt, approval.APPROVAL_TTL_MS);
  assert.equal(approval.APPROVAL_TTL_MS, 48 * 60 * 60 * 1000);
  assert.deepEqual(approval.verifyApprovalToken(token), { postId: 'p1', clientId: 'c1', platform: 'x', tokenId });
});

test('redeemApprovalToken is single-use: second redeem throws 409 already-posted', async () => {
  const { token, tokenId } = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  const decoded = await approval.redeemApprovalToken(token, { ip: '1.2.3.4', ua: 'ua' });
  assert.equal(decoded.postId, 'p1');
  const doc = raw('social_approvals', tokenId);
  assert.ok(doc.redeemedAt);
  assert.equal(doc.redeemedIp, '1.2.3.4');
  assert.equal(doc.redeemedUa, 'ua');
  await assert.rejects(() => approval.redeemApprovalToken(token), (e) => e.status === 409 && e.code === 'already-posted');
});

test('concurrent redeems burn exactly once (serialized fake transaction)', async () => {
  const { token } = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  const results = await Promise.allSettled([approval.redeemApprovalToken(token), approval.redeemApprovalToken(token)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});

test('tampering with postId/clientId/platform or the signature is rejected as invalid (400)', async () => {
  const { token } = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  const parts = Buffer.from(token, 'base64url').toString('utf8').split('|');
  const forge = (i, v) => { const p = [...parts]; p[i] = v; return Buffer.from(p.join('|')).toString('base64url'); };
  for (const forged of [forge(0, 'p2'), forge(1, 'c2'), forge(2, 'instagram'), forge(5, 'a'.repeat(64)), 'garbage', '']) {
    assert.throws(() => approval.verifyApprovalToken(forged), (e) => e.status === 400 && e.code === 'invalid');
  }
  // Signed with a different secret => invalid.
  process.env.SOCIAL_APPROVAL_SECRET = 'other-secret';
  assert.throws(() => approval.verifyApprovalToken(token), (e) => e.code === 'invalid');
});

test('an expired token (>48h) is rejected 410 expired before touching Firestore', async () => {
  const { token } = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  const t0 = realNow();
  Date.now = () => t0 + approval.APPROVAL_TTL_MS + 1000;
  await assert.rejects(() => approval.redeemApprovalToken(token), (e) => e.status === 410 && e.code === 'expired');
});

test('a validly-signed token with no burn record is 404 not-found', async () => {
  const { token, tokenId } = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  await ctx.adminDb.collection('social_approvals').doc(tokenId).delete();
  await assert.rejects(() => approval.redeemApprovalToken(token), (e) => e.status === 404 && e.code === 'not-found');
});

test('revokeApprovalsForPost revokes only that post\'s unredeemed tokens; redeemed and other posts untouched', async () => {
  const a = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  const b = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  const other = await approval.signApprovalToken({ postId: 'p2', clientId: 'c1', platform: 'x' });
  await approval.redeemApprovalToken(b.token);
  assert.deepEqual(await approval.revokeApprovalsForPost('p1'), { revoked: 1 });
  assert.ok(raw('social_approvals', a.tokenId).revokedAt);
  assert.equal(raw('social_approvals', b.tokenId).revokedAt, null);
  assert.equal(raw('social_approvals', other.tokenId).revokedAt, null);
  await assert.rejects(() => approval.redeemApprovalToken(a.token), (e) => e.status === 410 && e.code === 'revoked');
  // Idempotent + empty-id guard.
  assert.deepEqual(await approval.revokeApprovalsForPost('p1'), { revoked: 0 });
  assert.deepEqual(await approval.revokeApprovalsForPost(''), { revoked: 0 });
});

test('revokeApprovalsForClient revokes every unredeemed token for that client only', async () => {
  const a = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  const b = await approval.signApprovalToken({ postId: 'p2', clientId: 'c1', platform: 'x' });
  const o = await approval.signApprovalToken({ postId: 'p3', clientId: 'c2', platform: 'x' });
  assert.deepEqual(await approval.revokeApprovalsForClient('c1'), { revoked: 2 });
  assert.ok(raw('social_approvals', a.tokenId).revokedAt && raw('social_approvals', b.tokenId).revokedAt);
  assert.equal(raw('social_approvals', o.tokenId).revokedAt, null);
});

test('readApproval accepts a token or a raw apv_ id and returns null for unknown ids', async () => {
  const { token, tokenId } = await approval.signApprovalToken({ postId: 'p1', clientId: 'c1', platform: 'x' });
  assert.equal((await approval.readApproval(token)).postId, 'p1');
  assert.equal((await approval.readApproval(tokenId)).postId, 'p1');
  assert.equal(await approval.readApproval('apv_unknown'), null);
});

test('production without SOCIAL_APPROVAL_SECRET throws a 500 server error; dev falls back to CRON_SECRET', async () => {
  delete process.env.SOCIAL_APPROVAL_SECRET;
  process.env.VERCEL_ENV = 'production';
  await assert.rejects(() => approval.signApprovalToken({ postId: 'p', clientId: 'c', platform: 'x' }), (e) => e.status === 500 && e.code === 'server');
  delete process.env.VERCEL_ENV;
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const { token } = await approval.signApprovalToken({ postId: 'p', clientId: 'c', platform: 'x' });
  assert.equal(approval.verifyApprovalToken(token).postId, 'p');
  process.env.NODE_ENV = env;
});

// ── public route ────────────────────────────────────────────────────────────

test('route exports only GET and POST handlers (no other publish verb)', () => {
  const handlers = Object.keys(route).filter((k) => typeof route[k] === 'function').sort();
  assert.deepEqual(handlers, ['GET', 'POST']);
});

test('GET never publishes or redeems: returns a ready preview and leaves post + token untouched', async () => {
  const p = await pendingPost();
  const { token, tokenId } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  const { status, body } = await parse(await get(token));
  assert.equal(status, 200);
  assert.equal(body.state, 'ready');
  assert.equal(body.caption, 'Approve me.');
  assert.equal(body.platform, 'x');
  assert.equal(tweets.length, 0);
  assert.equal(raw('social_posts', p.id).status, 'awaiting_approval');
  assert.equal(raw('social_approvals', tokenId).redeemedAt, null);
  // Repeated GETs (email scanners) are still harmless.
  await get(token); await get(token);
  assert.equal(tweets.length, 0);
  assert.equal(raw('social_approvals', tokenId).redeemedAt, null);
});

test('GET reports state for bad/missing/revoked/redeemed tokens with HTTP 200 (missing token is 400)', async () => {
  assert.equal((await parse(await route.GET(req('GET')))).status, 400);
  assert.deepEqual(await parse(await get('garbage')), { status: 200, body: { state: 'invalid', error: 'Malformed approval token.' } });
  const p = await pendingPost();
  const rev = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  await approval.revokeApprovalsForPost(p.id);
  assert.equal((await parse(await get(rev.token))).body.state, 'revoked');
  const used = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  await approval.redeemApprovalToken(used.token);
  assert.equal((await parse(await get(used.token))).body.state, 'already-posted');
  await approval.recordApprovalResult(used.tokenId, 'failed');
  assert.equal((await parse(await get(used.token))).body.state, 'failed');
});

test('POST publishes once: posted status, one tweet, result recorded, link burned', async () => {
  const p = await pendingPost();
  const { token, tokenId } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  const res = await parse(await post({ token }));
  assert.deepEqual(res, { status: 200, body: { ok: true, state: 'posted' } });
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].text, 'Approve me.');
  const stored = raw('social_posts', p.id);
  assert.equal(stored.status, 'posted');
  assert.equal(stored.approvalSource, 'email');
  assert.equal(stored.twitterId, 'main-1');
  assert.equal(raw('social_approvals', tokenId).result, 'posted');
  assert.equal(raw('social_approvals', tokenId).redeemedUa, 'node-test');
});

test('second POST of the same link never double-posts (409 already-posted)', async () => {
  const p = await pendingPost();
  const { token } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  await post({ token });
  const again = await parse(await post({ token }));
  assert.equal(again.status, 409);
  assert.equal(again.body.state, 'already-posted');
  assert.equal(tweets.length, 1);
});

test('POST with edited content saves the edit then publishes that text', async () => {
  const p = await pendingPost();
  const { token } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  const res = await parse(await post({ token, content: '  Edited copy.  ' }));
  assert.equal(res.body.state, 'posted');
  assert.equal(tweets[0].text, 'Edited copy.');
  assert.equal(raw('social_posts', p.id).content, 'Edited copy.');
});

test('POST validation: missing token / bad JSON / empty or >280 content are 400 and do not burn the link', async () => {
  const p = await pendingPost();
  const { token, tokenId } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  assert.equal((await parse(await post({}))).status, 400);
  assert.equal((await parse(await route.POST(req('POST', { rawBody: '{nope' })))).status, 400);
  assert.equal((await parse(await post({ token, content: '   ' }))).status, 400);
  const tooLong = await parse(await post({ token, content: 'x'.repeat(281) }));
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error, /280/);
  assert.equal(raw('social_approvals', tokenId).redeemedAt, null);
  assert.equal(tweets.length, 0);
});

test('POST on a revoked link or a post no longer awaiting approval does not publish', async () => {
  const p = await pendingPost();
  const a = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  await approval.revokeApprovalsForPost(p.id);
  const revoked = await parse(await post({ token: a.token }));
  assert.equal(revoked.body.state, 'revoked');
  const q = await pendingPost('c1', { status: 'draft' });
  const b = await approval.signApprovalToken({ postId: q.id, clientId: 'c1', platform: 'x' });
  const notPending = await parse(await post({ token: b.token }));
  assert.equal(notPending.status, 409);
  assert.equal(notPending.body.state, 'already-posted');
  assert.equal(tweets.length, 0);
});

test('token minted for client B cannot publish client A\'s post (post lookup is client-scoped => not-found)', async () => {
  const p = await pendingPost('c1');
  const { token } = await approval.signApprovalToken({ postId: p.id, clientId: 'c2', platform: 'x' });
  const res = await parse(await post({ token }));
  assert.equal(res.status, 404);
  assert.equal(res.body.state, 'not-found');
  assert.equal(tweets.length, 0);
  assert.equal(raw('social_posts', p.id).status, 'awaiting_approval');
});

test('publish failure: link stays burned, post marked failed, result "failed" (200, ok:false)', async () => {
  tweetError = Object.assign(new Error('bad'), { code: 400, data: { detail: 'nope' } });
  const p = await pendingPost();
  const { token, tokenId } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  const res = await parse(await post({ token }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.state, 'failed');
  assert.equal(raw('social_posts', p.id).status, 'failed');
  assert.equal(raw('social_approvals', tokenId).result, 'failed');
  tweetError = null;
  const retry = await parse(await post({ token }));
  assert.equal(retry.body.state, 'already-posted');
  assert.equal(tweets.length, 0);
});

test('unknown POST action is rejected 400 (no publish)', async () => {
  const p = await pendingPost();
  const { token } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  const res = await parse(await post({ token, action: 'bogus' }));
  assert.equal(res.status, 400);
  assert.equal(tweets.length, 0);
});

test('POST publish is refused 409 while a remix is rendering and the link is NOT burned', async () => {
  const p = await pendingPost('c1', {});
  ctx.adminDb._patch('social_posts', p.id, { remixPending: { jobId: 'j1', status: 'rendering' } });
  const { token, tokenId } = await approval.signApprovalToken({ postId: p.id, clientId: 'c1', platform: 'x' });
  const res = await parse(await post({ token }));
  assert.equal(res.status, 409);
  assert.equal(raw('social_approvals', tokenId).redeemedAt, null);
  assert.equal(tweets.length, 0);
});
