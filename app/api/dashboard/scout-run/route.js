import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { runExternalScouts } = require('../../../../features/scout-intake/external-scouts');

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
 * POST /api/dashboard/scout-run
 *
 * Runs the external scouts for the signed-in user's client using their
 * stored scoutConfig. Admin-triggerable path while we validate Phase E;
 * later this will be called automatically from runner.js.
 *
 * Returns run summary (per-scout status + timings + cost) plus the raw
 * externalSignals blob so the caller can display or verify.
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

  const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  const scoutConfig = configSnap.exists ? configSnap.data()?.scoutConfig : null;
  if (!scoutConfig) {
    return json({ error: 'No scoutConfig for this client. Regenerate first.' }, 400);
  }

  const result = await runExternalScouts({ clientId, scoutConfig });

  return json({
    ok:              result.ok,
    clientId,
    totalMs:         result.totalMs,
    totalCostUsd:    result.totalCostUsd,
    runs:            result.runs,
    externalSignals: result.externalSignals,
    runAt:           result.runAt,
  });
}
