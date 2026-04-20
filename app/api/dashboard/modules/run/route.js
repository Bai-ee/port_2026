import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 300;

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { runModules } = require('../../../../../features/scout-intake/runner');
const { updateModuleState } = require('../../../../../api/_lib/run-lifecycle.cjs');

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
 * POST /api/dashboard/modules/run
 *
 * Runs one or more card modules for the signed-in user.
 * Already-succeeded modules are skipped unless force=true.
 *
 * Body: { cardIds: string[], force?: boolean }
 * Response: { ok, runId, queuedModules, skippedModules, results }
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

  let cardIds, force;
  try {
    const body = await request.json();
    cardIds = Array.isArray(body.cardIds) ? body.cardIds : [];
    force = Boolean(body.force);
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (cardIds.length === 0) {
    return json({ error: 'cardIds must be a non-empty array.' }, 400);
  }

  const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  if (!configSnap.exists) return json({ error: 'No client config.' }, 404);
  const websiteUrl =
    configSnap.data()?.sourceInputs?.websiteUrl ||
    configSnap.data()?.websiteUrl ||
    null;
  if (!websiteUrl) return json({ error: 'No websiteUrl in client config.' }, 400);

  // Filter out already-succeeded modules unless force=true
  const dashSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  const currentModules = dashSnap.exists ? (dashSnap.data()?.modules || {}) : {};

  const skippedModules = [];
  const moduleIds = cardIds.filter((cardId) => {
    if (!force && currentModules[cardId]?.status === 'succeeded') {
      skippedModules.push(cardId);
      return false;
    }
    return true;
  });

  if (moduleIds.length === 0) {
    return json({
      ok: true,
      runId: null,
      queuedModules: [],
      skippedModules,
      results: [],
      message: 'All requested modules already succeeded. Pass force=true to rerun.',
    });
  }

  const { randomUUID } = require('crypto');
  const runId = randomUUID();

  const { results } = await runModules({ clientId, runId, websiteUrl, moduleIds });

  await updateModuleState(clientId, results, runId);

  return json({
    ok: results.every((r) => r.ok),
    runId,
    queuedModules: moduleIds,
    skippedModules,
    results,
  });
}
