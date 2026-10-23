import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { startInstagramOAuthFlow, getInstagramAppCredentials } from '../../../../features/social-posting/instagram-oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');

// Social Accounts card — per-client Instagram connect (Instagram Login).
// Admin-only, same as the X per-client connect in ../x-oauth. Connecting
// spends nothing; publishing stays gated by platforms.js `live`.

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
    throw Object.assign(new Error('Admin access required for Instagram account management.'), { status: 403 });
  }
  return decoded;
}

// Must match a "Valid OAuth Redirect URI" registered on the Meta app
// (Instagram API → Set up Instagram business login).
function callbackRedirectUri(request) {
  const override = (process.env.INSTAGRAM_OAUTH_REDIRECT_URI || '').trim();
  if (override) return override;
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;
  return `${origin}/api/social-posting/instagram-oauth/callback`;
}

export async function GET(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const { appId, appSecret } = getInstagramAppCredentials();
  return json({ ok: true, configured: Boolean(appId && appSecret), callbackUrl: callbackRedirectUri(request) });
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
  try {
    if (body?.action === 'start') {
      const clientId = String(body.clientId || '');
      if (!clientId) return json({ error: 'clientId is required.' }, 400);
      const { url } = await startInstagramOAuthFlow(callbackRedirectUri(request), decoded?.email || null, clientId);
      return json({ ok: true, url });
    }
    return json({ error: `Unknown action: ${body?.action || ''}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Instagram connect failed.' }, err.status || 500);
  }
}
