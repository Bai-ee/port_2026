import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { getSocialPost } from '../../../../../features/social-posting/twitter-service.js';

const require = createRequire(import.meta.url);
const { readApproval, verifyApprovalToken } = require('../../../../../api/_lib/social-approval.cjs');
const { getSocialAccount } = require('../../../../../features/social-posting/social-accounts.js');
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { checkRateLimit, getClientIp } = require('../../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only — never publishes, never redeems. Feeds the public approval page
// so it can render the video/caption/target account before the user clicks.

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit({ key: `social-approve-preview:ip:${ip}`, limit: 30, windowSeconds: 3600 });
  if (!limit.allowed) {
    return json({ state: 'error', error: 'Too many attempts. Try again later.' }, 429);
  }

  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return json({ error: 'Missing token.' }, 400);

  let decoded;
  try {
    decoded = verifyApprovalToken(token);
  } catch (err) {
    const state = err?.code === 'expired' ? 'expired' : err?.code === 'server' ? 'server' : 'invalid';
    return json({ state, error: err.message }, 200);
  }

  const approval = await readApproval(token);
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
