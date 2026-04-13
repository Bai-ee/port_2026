import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb                             = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser }          = require('../../../../api/_lib/auth.cjs');
const { reseedIntakeForClient }      = require('../../../../api/_lib/client-provisioning.cjs');
// Importing the runner registers source modules and exposes listRegisteredSourceMeta
const { listRegisteredSourceMeta }   = require('../../../../api/_lib/intelligence-runner.cjs');
const { getMaster, appendEvent }     = require('../../../../features/intelligence/_store');
const { normalizeSourceSetting }     = require('../../../../api/_lib/intelligence-bootstrap-utils.cjs');

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
  } catch (err) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Parse body
  let websiteUrl;
  try {
    const body = await request.json().catch(() => ({}));
    websiteUrl = String(body.websiteUrl || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!websiteUrl) {
    return NextResponse.json({ error: 'websiteUrl is required.' }, { status: 400 });
  }

  // Resolve clientId from the authenticated user's record
  const userDoc = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    return NextResponse.json({ error: 'User record not found.' }, { status: 404 });
  }
  const clientId = userDoc.data()?.clientId;
  if (!clientId) {
    return NextResponse.json({ error: 'No client associated with this account.' }, { status: 404 });
  }

  // Queue reseed
  let result;
  try {
    result = await reseedIntakeForClient({
      clientId,
      uid: decoded.uid,
      websiteUrl,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reseed failed.' },
      { status: 500 }
    );
  }

  const proto        = request.headers.get('x-forwarded-proto') || 'http';
  const host         = request.headers.get('host')              || 'localhost:3000';
  const workerSecret = process.env.WORKER_SECRET                || '';

  if (!workerSecret) {
    console.error('[reseed-intake] WORKER_SECRET is not set — worker triggers will be rejected with 401.');
  }

  // Fire-and-forget: trigger the intake brief worker (unchanged)
  fetch(`${proto}://${host}/api/worker/run-brief`, {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-worker-secret': workerSecret },
    body:    JSON.stringify({ runId: result.runId }),
  })
    .then((r) => {
      if (!r.ok) console.error(`[reseed-intake] run-brief trigger returned ${r.status}`);
    })
    .catch((err) => console.error(`[reseed-intake] run-brief trigger failed: ${err?.message || err}`));

  // Fire-and-forget: registry-driven intelligence fanout with observability
  // Reads source settings from master if present; falls back to defaultEnabled per source.
  (async () => {
    try {
      const master         = await getMaster(clientId);
      const rawSettings    = master?.sourceSettings || {};
      const sourcesToRun   = listRegisteredSourceMeta().filter(({ id, defaultEnabled }) => {
        const setting = normalizeSourceSetting(rawSettings[id]);
        return rawSettings[id] !== undefined ? setting.enabled : defaultEnabled;
      });

      console.log(JSON.stringify({
        event:     'intelligence_fanout_start',
        clientId,
        runId:     result.runId,
        sources:   sourcesToRun.map((s) => s.id),
      }));

      for (const { id: sourceId } of sourcesToRun) {
        fetch(`${proto}://${host}/api/intelligence/run`, {
          method:  'POST',
          headers: { 'content-type': 'application/json', 'x-worker-secret': workerSecret },
          body:    JSON.stringify({ clientId, sourceId, runId: result.runId }),
        })
          .then((r) => {
            if (!r.ok) {
              console.error(JSON.stringify({
                event:    'intelligence_fanout_trigger_failed',
                clientId,
                sourceId,
                httpStatus: r.status,
                runId:    result.runId,
              }));
              // Append observable error event — non-fatal if this also fails
              appendEvent(clientId, {
                at:        new Date().toISOString(),
                sourceId,
                provider:  'system',
                kind:      'error',
                usd:       0,
                quotaUnits: 0,
                durationMs: null,
                note:      `fanout trigger returned HTTP ${r.status}`,
                runId:     result.runId,
              }).catch((e) => console.error(`[reseed-intake] appendEvent failed for ${sourceId}: ${e?.message}`));
            }
          })
          .catch((err) => {
            console.error(JSON.stringify({
              event:    'intelligence_fanout_trigger_error',
              clientId,
              sourceId,
              error:    err?.message || String(err),
              runId:    result.runId,
            }));
            appendEvent(clientId, {
              at:        new Date().toISOString(),
              sourceId,
              provider:  'system',
              kind:      'error',
              usd:       0,
              quotaUnits: 0,
              durationMs: null,
              note:      `fanout trigger error: ${err?.message || String(err)}`,
              runId:     result.runId,
            }).catch((e) => console.error(`[reseed-intake] appendEvent failed for ${sourceId}: ${e?.message}`));
          });
      }
    } catch (err) {
      console.error(JSON.stringify({
        event:    'intelligence_fanout_resolution_failed',
        clientId,
        error:    err?.message || String(err),
        runId:    result.runId,
      }));
    }
  })();

  return NextResponse.json(result);
}
