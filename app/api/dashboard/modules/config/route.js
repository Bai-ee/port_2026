import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
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

  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) return json({ error: 'No user record.' }, 404);
  const clientId = userSnap.data()?.clientId || null;
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

  const now = fb.FieldValue.serverTimestamp();
  const clientConfigRef  = fb.adminDb.collection('client_configs').doc(clientId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);

  // Read current module status to avoid clobbering succeeded/failed state on enable
  const dashSnap = await dashboardStateRef.get();
  const currentStatus = dashSnap.exists
    ? (dashSnap.data()?.modules?.[cardId]?.status ?? 'disabled')
    : 'disabled';

  const dashUpdate = {
    [`modules.${cardId}.enabled`]: enabled,
    updatedAt: now,
  };
  // Enabling a disabled card → mark idle so the Run button appears.
  // Leave succeeded/failed/running/queued status untouched.
  if (enabled && currentStatus === 'disabled') {
    dashUpdate[`modules.${cardId}.status`] = 'idle';
  }
  // Disabling a non-succeeded card → mark disabled.
  // Leave succeeded status intact (preserve last result display).
  if (!enabled && currentStatus !== 'succeeded') {
    dashUpdate[`modules.${cardId}.status`] = 'disabled';
  }

  await Promise.all([
    clientConfigRef.set({ [`moduleConfig.${cardId}.enabled`]: enabled, updatedAt: now }, { merge: true }),
    dashboardStateRef.set(dashUpdate, { merge: true }),
  ]);

  return json({ ok: true, cardId, enabled });
}
