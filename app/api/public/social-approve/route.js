import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { publishApprovedPost } from '../../../../features/social-posting/twitter-service.js';

const require = createRequire(import.meta.url);
const { redeemApprovalToken, recordApprovalResult } = require('../../../../api/_lib/social-approval.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The "Post to X" email button. Publishing must never happen on a GET — email
// scanners prefetch links, and the button here lands on a page (see
// app/post-approval/[token]/page.jsx) that POSTs on an explicit click.

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  return json({ error: 'Method not allowed. Publishing requires a POST.' }, 405);
}

export async function POST(request) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit({ key: `social-approve:ip:${ip}`, limit: 30, windowSeconds: 3600 });
  if (!limit.allowed) {
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

  const ua = request.headers.get('user-agent') || null;

  let decoded;
  try {
    decoded = await redeemApprovalToken(token, { ip, ua });
  } catch (err) {
    const code = err?.code || 'invalid';
    const state = ['not-found', 'expired', 'revoked', 'already-posted', 'server'].includes(code) ? code : 'invalid';
    return json({ ok: false, state, error: err.message }, err.status || 400);
  }

  // Token is burned — from here on, the outcome is terminal. A publish
  // failure is recorded but the token is NOT un-burned (re-approve from the
  // dashboard is the recovery path, not a retried click on this link).
  try {
    await publishApprovedPost(decoded.clientId, decoded.postId, { source: 'email' });
    await recordApprovalResult(decoded.tokenId, 'posted');
    return json({ ok: true, state: 'posted' });
  } catch (err) {
    // A revoke that lost the race with a stale click lands here as
    // 'not-pending' (see publishApprovedPost's guard) — the post itself is
    // fine (handled elsewhere), nothing failed. Record any non-'failed'
    // value so the preview route's redeemed-branch also reads it as
    // "already handled" rather than "failed" (its check is result==='failed').
    const alreadyHandled = err?.code === 'not-pending';
    await recordApprovalResult(decoded.tokenId, alreadyHandled ? 'already-handled' : 'failed');
    return json({ ok: false, state: alreadyHandled ? 'already-posted' : 'failed', error: err.message || 'Failed to publish.' });
  }
}
