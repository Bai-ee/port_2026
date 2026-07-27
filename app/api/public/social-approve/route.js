import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { getSocialPost, publishApprovedPost, updateSocialPost } from '../../../../features/social-posting/twitter-service.js';
import { getSocialAccount } from '../../../../features/social-posting/social-accounts.js';

const require = createRequire(import.meta.url);
const {
  readApproval,
  recordApprovalResult,
  redeemApprovalToken,
  verifyApprovalToken,
} = require('../../../../api/_lib/social-approval.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The "Post to X" email button — both halves on ONE function. Vercel Hobby caps
// a deployment at 12 serverless functions, so preview and publish share a route
// instead of being two.
//
//   GET  ?token=…  → read-only preview for the approval page. Never writes,
//                    never redeems, never publishes.
//   POST {token, content?} → validates optional edited copy, redeems the
//                            single-use token, saves the edit, then publishes.
//
// The security property is unchanged and is the one that matters: **a GET can
// never publish.** Email scanners and link prefetchers issue GETs, so the
// publish path sits behind an explicit POST that only the approval page's
// button fires. Two separate routes were never what made this safe — the
// method split is. Keep any future read-only helper on GET; never move a write
// onto it.

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function limited(request, bucket) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit({ key: `${bucket}:ip:${ip}`, limit: 30, windowSeconds: 3600 });
  return { ip, allowed: limit.allowed };
}

// ── GET: read-only preview ───────────────────────────────────────────────────
export async function GET(request) {
  const { allowed } = await limited(request, 'social-approve-preview');
  if (!allowed) return json({ state: 'error', error: 'Too many requests. Try again later.' }, 429);

  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return json({ error: 'Missing token.' }, 400);

  let decoded;
  try {
    decoded = verifyApprovalToken(token);
  } catch (err) {
    const state = err?.code === 'expired' ? 'expired' : err?.code === 'server' ? 'server' : 'invalid';
    return json({ state, error: err.message }, 200);
  }

  let approval;
  try {
    approval = await readApproval(token);
  } catch (err) {
    return json({ state: err?.code === 'server' ? 'server' : 'invalid', error: err.message }, 200);
  }
  if (!approval) return json({ state: 'not-found' }, 200);
  if (approval.revokedAt) return json({ state: 'revoked' }, 200);
  if (approval.redeemedAt) return json({ state: approval.result === 'failed' ? 'failed' : 'already-posted' }, 200);
  if (Date.now() > (approval.expiresAt || 0)) return json({ state: 'expired' }, 200);

  const [post, account, clientSnap] = await Promise.all([
    getSocialPost(decoded.clientId, decoded.postId),
    getSocialAccount(decoded.clientId, decoded.platform).catch(() => null),
    fb.adminDb.collection('clients').doc(decoded.clientId).get(),
  ]);
  if (!post) return json({ state: 'not-found' }, 200);

  const clientData = clientSnap.exists ? clientSnap.data() : {};
  const clientName = clientData?.companyName || clientData?.name || clientData?.dashboardTitle || decoded.clientId;

  return json({
    state: 'ready',
    clientName,
    handle: account?.username || null,
    platform: decoded.platform,
    caption: post.content || '',
    videoUrl: post.mediaUrl || null,
  });
}

// ── POST: redeem + publish ───────────────────────────────────────────────────
export async function POST(request) {
  const { ip, allowed } = await limited(request, 'social-approve');
  if (!allowed) {
    return json({ ok: false, state: 'error', error: 'Too many attempts. Try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, state: 'error', error: 'Invalid JSON body.' }, 400);
  }

  const token = String(body?.token || '');
  if (!token) return json({ ok: false, state: 'error', error: 'Missing token.' }, 400);
  let editedContent = null;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'content')) {
    editedContent = String(body.content || '').trim();
    if (!editedContent) {
      return json({ ok: false, state: 'error', error: 'Post copy is required.' }, 400);
    }
    if (editedContent.length > 280) {
      return json({ ok: false, state: 'error', error: 'X posts must be 280 characters or fewer.' }, 400);
    }
  }

  const ua = request.headers.get('user-agent') || null;

  let decoded;
  try {
    decoded = await redeemApprovalToken(token, { ip, ua });
  } catch (err) {
    const code = err?.code || 'invalid';
    const state = ['not-found', 'expired', 'revoked', 'already-posted', 'server'].includes(code) ? code : 'invalid';
    return json({ ok: false, state, error: err.message }, err.status || 400);
  }

  // Token is burned — from here on, the outcome is terminal. A publish failure
  // is recorded but the token is NOT un-burned (re-approve from the dashboard
  // is the recovery path, not a retried click on this link).
  try {
    if (editedContent != null) {
      await updateSocialPost(decoded.clientId, decoded.postId, { content: editedContent });
    }
    await publishApprovedPost(decoded.clientId, decoded.postId, { source: 'email' });
    await recordApprovalResult(decoded.tokenId, 'posted');
    return json({ ok: true, state: 'posted' });
  } catch (err) {
    await recordApprovalResult(decoded.tokenId, 'failed');
    return json({ ok: false, state: 'failed', error: err.message || 'Failed to publish.' });
  }
}
