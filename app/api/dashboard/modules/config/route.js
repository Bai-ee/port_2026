import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { applyModuleToggle } from '../../../../../features/scout-intake/module-toggle.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { REGISTRY } = require('../../../../../features/scout-intake/module-registry');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * POST /api/dashboard/modules/config
 *
 * Enable or disable a module card for the signed-in user.
 * Writes moduleConfig in client_configs and syncs enabled + status in dashboard_state.
 *
 * Body: { cardId: string, enabled: boolean }
 * Response: { ok: true, cardId, enabled }
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return json({ error: err.message || 'Forbidden.' }, err.status || 403);
  }
  if (!context.userProfile) return json({ error: 'No user record.' }, 404);
  const clientId = context.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  let cardId, enabled;
  try {
    const body = await request.json();
    cardId  = body.cardId;
    enabled = body.enabled;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!cardId || typeof cardId !== 'string') {
    return json({ error: 'cardId is required.' }, 400);
  }
  if (typeof enabled !== 'boolean') {
    return json({ error: 'enabled must be a boolean.' }, 400);
  }
  if (!REGISTRY[cardId]) {
    return json({ error: `Unknown cardId: "${cardId}".` }, 400);
  }

  // Nested writes (see features/scout-intake/module-toggle.mjs: the old dotted-key set() wrote a literal field no reader used).
  await applyModuleToggle(fb.adminDb, clientId, cardId, enabled, { now: fb.FieldValue.serverTimestamp() });

  return json({ ok: true, cardId, enabled });
}
