import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { cancelRun } = require('../../../../api/_lib/run-lifecycle.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

export async function POST(request) {
  // Auth
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Forbidden.' }, { status: err.status || 403 });
  }
  if (!context.userProfile) {
    return NextResponse.json({ error: 'User record not found.' }, { status: 404 });
  }
  const clientId = context.clientId;
  if (!clientId) {
    return NextResponse.json({ error: 'No client associated with this account.' }, { status: 404 });
  }

  // Find the active run via dashboard_state.latestRunId
  const dashSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  const latestRunId = dashSnap.exists ? dashSnap.data()?.latestRunId : null;
  if (!latestRunId) {
    return NextResponse.json({ error: 'No active run found.' }, { status: 404 });
  }

  // Verify the run is actually active before attempting cancel
  const runSnap = await fb.adminDb.collection('brief_runs').doc(latestRunId).get();
  if (!runSnap.exists) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }
  const runStatus = runSnap.data()?.status;
  if (!['queued', 'running'].includes(runStatus)) {
    return NextResponse.json(
      { error: `Run is not active (status: "${runStatus}"). Nothing to cancel.` },
      { status: 409 }
    );
  }

  try {
    const result = await cancelRun(latestRunId, clientId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cancel failed.' },
      { status: 500 }
    );
  }
}
