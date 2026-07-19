import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  compactXOAuthError,
  disconnectXOAuth,
  getXOAuthStatus,
  startXOAuthFlow,
  verifyBookmarkAccess,
} from '../../../../features/social-posting/x-oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');

// X Command Center auth surface. Everything here is admin-only: the OAuth
// tokens control the real @bai_ee account, and verify-bookmarks spends real,
// untracked X API credits (see docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md §0).

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function requireAdmin(request) {
  const decoded = await verifyRequestUser({
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  });
  if (!(await isAdminEmail(decoded?.email))) {
    const err = new Error('Admin access required for X account management.');
    err.status = 403;
    throw err;
  }
  return decoded;
}

function callbackRedirectUri(request) {
  const override = (process.env.X_OAUTH_REDIRECT_URI || '').trim();
  if (override) return override;
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;
  return `${origin}/api/social-posting/x-oauth/callback`;
}

export async function GET(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  try {
    const status = await getXOAuthStatus();
    return json({ ok: true, ...status, callbackUrl: callbackRedirectUri(request) });
  } catch (err) {
    return json({ error: err.message || 'Failed to read X connection status.' }, err.status || 500);
  }
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = body?.action || '';
  try {
    if (action === 'start') {
      const { url } = await startXOAuthFlow(callbackRedirectUri(request), decoded?.email || null);
      return json({ ok: true, url });
    }
    if (action === 'disconnect') {
      await disconnectXOAuth();
      return json({ ok: true });
    }
    if (action === 'verify-bookmarks') {
      // Spend-gated in the UI: the card shows an explicit confirm naming the
      // call count before this action fires.
      const result = await verifyBookmarkAccess();
      return json({ ok: true, result });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    if (err?.status) return json({ error: err.message }, err.status);
    const mapped = compactXOAuthError(err);
    return json({ error: mapped.message }, mapped.status || 500);
  }
}
