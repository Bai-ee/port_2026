'use strict';

// social-approval.cjs — single-use HMAC approval tokens for the "Post to X"
// email button (Social Auto-Publish, approval mode). Same signed-payload
// shape as calendar-oauth.cjs's signState/verifyState. The Firestore doc in
// social_approvals/{tokenId} is the actual single-use gate — the token itself
// is only a bearer credential that must also match live doc state (so a
// forwarded/copy-pasted link burns exactly once, same as the original).

const crypto = require('crypto');
const fb = require('./firebase-admin.cjs');

const COLLECTION = 'social_approvals';
const TTL_MS = 48 * 60 * 60 * 1000; // 48h

function secret() {
  const explicit = process.env.SOCIAL_APPROVAL_SECRET;
  if (explicit) return explicit;
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw Object.assign(new Error('SOCIAL_APPROVAL_SECRET is not configured on the server.'), { status: 500, code: 'server' });
  }
  // Dev-only fallback so local runs work without extra env setup.
  return process.env.CRON_SECRET || 'dev-only-insecure-social-approval-secret';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function ref(tokenId) {
  return fb.adminDb.collection(COLLECTION).doc(tokenId);
}

// Mints a token AND writes its Firestore burn record. postId|clientId|platform
// are bound into the signed payload so the token cannot be replayed against a
// different post/client/platform than the one it was minted for.
async function signApprovalToken({ postId, clientId, platform }) {
  if (!postId || !clientId || !platform) {
    throw Object.assign(new Error('postId, clientId, and platform are all required.'), { status: 400 });
  }
  const nonce = crypto.randomBytes(12).toString('hex');
  const ts = Date.now();
  const payload = `${postId}|${clientId}|${platform}|${nonce}|${ts}`;
  const sig = sign(payload);
  const token = Buffer.from(`${payload}|${sig}`).toString('base64url');
  const tokenId = `apv_${nonce}`;
  const expiresAt = ts + TTL_MS;
  await ref(tokenId).set({
    tokenId,
    postId,
    clientId,
    platform,
    createdAt: ts,
    expiresAt,
    redeemedAt: null,
    redeemedIp: null,
    redeemedUa: null,
    revokedAt: null,
    result: null,
  });
  return { token, tokenId, expiresAt };
}

// Signature + TTL check only — does not touch Firestore. Used by the
// read-only preview route, and as the first step of redeemApprovalToken.
function verifyApprovalToken(token) {
  let decoded;
  try {
    decoded = Buffer.from(String(token || ''), 'base64url').toString('utf8');
  } catch {
    decoded = '';
  }
  const parts = decoded.split('|');
  if (parts.length !== 6) {
    throw Object.assign(new Error('Malformed approval token.'), { status: 400, code: 'invalid' });
  }
  const [postId, clientId, platform, nonce, tsStr, sig] = parts;
  const payload = `${postId}|${clientId}|${platform}|${nonce}|${tsStr}`;
  const expected = sign(payload);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Invalid approval token.'), { status: 400, code: 'invalid' });
  }
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Date.now() - ts > TTL_MS) {
    throw Object.assign(new Error('This approval link has expired.'), { status: 410, code: 'expired' });
  }
  return { postId, clientId, platform, tokenId: `apv_${nonce}` };
}

// Burns the token inside a transaction (rejects missing/expired/redeemed/
// revoked). Does NOT publish — the caller publishes after this resolves, then
// calls recordApprovalResult. A failed publish is recorded but NOT un-burned;
// re-approving from the dashboard is the recovery path, not a retried click.
async function redeemApprovalToken(token, { ip = null, ua = null } = {}) {
  const decoded = verifyApprovalToken(token);
  const docRef = ref(decoded.tokenId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      throw Object.assign(new Error('Approval link not found.'), { status: 404, code: 'not-found' });
    }
    const data = snap.data();
    if (data.revokedAt) {
      throw Object.assign(new Error('This approval link was revoked.'), { status: 410, code: 'revoked' });
    }
    if (data.redeemedAt) {
      throw Object.assign(new Error('This post has already been published.'), { status: 409, code: 'already-posted' });
    }
    if (Date.now() > (data.expiresAt || 0)) {
      throw Object.assign(new Error('This approval link has expired.'), { status: 410, code: 'expired' });
    }
    tx.set(docRef, { redeemedAt: Date.now(), redeemedIp: ip, redeemedUa: ua }, { merge: true });
  });
  return decoded;
}

async function recordApprovalResult(tokenId, result) {
  await ref(tokenId).set({ result }, { merge: true });
}

// Read-only lookup for the preview route. Accepts a full token (decodes it,
// never touching Firestore with anything unverified) or a raw tokenId.
async function readApproval(tokenIdOrToken) {
  let tokenId = String(tokenIdOrToken || '');
  if (!tokenId.startsWith('apv_')) {
    tokenId = verifyApprovalToken(tokenIdOrToken).tokenId;
  }
  const snap = await ref(tokenId).get();
  return snap.exists ? snap.data() : null;
}

async function revokeApprovalsForClient(clientId) {
  if (!clientId) return { revoked: 0 };
  const snap = await fb.adminDb.collection(COLLECTION)
    .where('clientId', '==', clientId)
    .where('redeemedAt', '==', null)
    .get();
  const batch = fb.adminDb.batch();
  let revoked = 0;
  const now = Date.now();
  snap.forEach((doc) => {
    if (doc.data().revokedAt) return;
    batch.set(doc.ref, { revokedAt: now }, { merge: true });
    revoked += 1;
  });
  if (revoked > 0) await batch.commit();
  return { revoked };
}

// Closes out the email link for one post — called after a dashboard
// approve/reject so a still-unburned token can't publish (or re-publish) the
// same post through the other channel. Best-effort from the caller's side
// (the post's own status change is the primary gate; this just retires the
// now-redundant token so the email button reads "revoked" instead of a stale
// "ready").
async function revokeApprovalsForPost(postId) {
  if (!postId) return { revoked: 0 };
  const snap = await fb.adminDb.collection(COLLECTION)
    .where('postId', '==', postId)
    .where('redeemedAt', '==', null)
    .get();
  const batch = fb.adminDb.batch();
  let revoked = 0;
  const now = Date.now();
  snap.forEach((doc) => {
    if (doc.data().revokedAt) return;
    batch.set(doc.ref, { revokedAt: now }, { merge: true });
    revoked += 1;
  });
  if (revoked > 0) await batch.commit();
  return { revoked };
}

module.exports = {
  signApprovalToken,
  verifyApprovalToken,
  redeemApprovalToken,
  recordApprovalResult,
  readApproval,
  revokeApprovalsForClient,
  revokeApprovalsForPost,
  APPROVAL_TTL_MS: TTL_MS,
};
