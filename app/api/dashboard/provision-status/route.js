import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');

const ADMIN_EMAIL = 'bryanballi@gmail.com';

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

// Lightweight check used to gate the dashboard behind the website-URL prompt for
// users who have no assigned dashboard yet. One users-doc read — not the full
// bootstrap. Returns whether the signed-in user already owns a provisioned client.
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  try {
    const ctx = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email });
    const isAdmin = String(decoded.email || '').toLowerCase() === ADMIN_EMAIL;
    return json({ hasDashboard: Boolean(ctx.ownClientId), isAdmin });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unauthorized.' },
      error?.status || 401
    );
  }
}
