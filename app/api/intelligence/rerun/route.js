import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// PSI + narrator can take 30–60s; allow full headroom
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
// Runner import also registers all source modules
const { runIntelligenceSource } = require('../../../../api/_lib/intelligence-runner.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

export async function POST(request) {
  // Auth — Firebase user token
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Parse body
  let sourceId;
  try {
    const body = await request.json().catch(() => ({}));
    sourceId = String(body.sourceId || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!sourceId) {
    return NextResponse.json({ error: 'sourceId is required.' }, { status: 400 });
  }

  // Resolve clientId from user doc
  const userDoc = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    return NextResponse.json({ error: 'User record not found.' }, { status: 404 });
  }
  const clientId = userDoc.data()?.clientId;
  if (!clientId) {
    return NextResponse.json({ error: 'No client associated with this account.' }, { status: 404 });
  }

  // Run synchronously — waits for PSI fetch + narrator to complete before returning.
  // Client holds the request open while the terminal shows progress.
  const result = await runIntelligenceSource(clientId, sourceId);

  if (!result.ok) {
    console.error(`[intelligence/rerun] ${sourceId}/${clientId} failed: ${result.error}`);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  const narrativeGenerated = Boolean(result.sourceRecord?.facts?.narrative);
  console.log(`[intelligence/rerun] complete — ${sourceId}/${clientId} narrativeGenerated=${narrativeGenerated}`);

  return NextResponse.json({ ok: true, clientId, sourceId, status: result.status, narrativeGenerated });
}
