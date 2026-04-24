import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb                             = require('../../../../api/_lib/firebase-admin.cjs');
const { buildAuthRequestShim, verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { reseedIntakeForClient }      = require('../../../../api/_lib/client-provisioning.cjs');
// Importing the runner registers source modules and exposes listRegisteredSourceMeta
const { listRegisteredSourceMeta }   = require('../../../../api/_lib/intelligence-runner.cjs');
const { getMaster, appendEvent }     = require('../../../../features/intelligence/_store');
const { normalizeSourceSetting }     = require('../../../../api/_lib/intelligence-bootstrap-utils.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

export async function POST(request) {
  // Auth
  let decoded;
  try {
    decoded = await verifyRequestUser(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  // Parse body
  let websiteUrl;
  try {
    const body = await request.json().catch(() => ({}));
    websiteUrl = String(body.websiteUrl || '').trim();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!websiteUrl) {
    return json({ error: 'websiteUrl is required.' }, 400);
  }

  // Resolve clientId from the authenticated user's record
  const userDoc = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    return json({ error: 'User record not found.' }, 404);
  }
  const clientId = userDoc.data()?.clientId;
  if (!clientId) {
    return json({ error: 'No client associated with this account.' }, 404);
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
    return json(
      { error: err instanceof Error ? err.message : 'Reseed failed.' },
      500
    );
  }

  logInfo('reseed_intake_queued', {
    clientId,
    uid: decoded.uid,
    runId: result.runId || null,
    websiteUrl,
  });

  const proto        = request.headers.get('x-forwarded-proto') || 'http';
  const host         = request.headers.get('host')              || 'localhost:3000';
  const workerSecret = process.env.WORKER_SECRET                || '';

  if (!workerSecret) {
    logWarn('reseed_worker_secret_missing', { clientId, runId: result.runId || null });
  }

  // Fire-and-forget: trigger the intake brief worker (unchanged)
  fetch(`${proto}://${host}/api/worker/run-brief`, {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-worker-secret': workerSecret },
    body:    JSON.stringify({ runId: result.runId }),
  })
    .then((r) => {
      if (!r.ok) {
        logWarn('reseed_worker_trigger_failed', {
          clientId,
          runId: result.runId || null,
          httpStatus: r.status,
        });
      } else {
        logInfo('reseed_worker_trigger_accepted', {
          clientId,
          runId: result.runId || null,
          httpStatus: r.status,
        });
      }
    })
    .catch((err) => logError('reseed_worker_trigger_throw', {
      clientId,
      runId: result.runId || null,
      error: err?.message || String(err),
    }));

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

      logInfo('intelligence_fanout_start', {
        clientId,
        runId: result.runId,
        sources: sourcesToRun.map((s) => s.id),
      });

      for (const { id: sourceId } of sourcesToRun) {
        fetch(`${proto}://${host}/api/intelligence/run`, {
          method:  'POST',
          headers: { 'content-type': 'application/json', 'x-worker-secret': workerSecret },
          body:    JSON.stringify({ clientId, sourceId, runId: result.runId }),
        })
          .then((r) => {
            if (!r.ok) {
              logWarn('intelligence_fanout_trigger_failed', {
                clientId,
                sourceId,
                httpStatus: r.status,
                runId: result.runId,
              });
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
              }).catch((e) => logWarn('intelligence_fanout_append_event_failed', {
                clientId,
                sourceId,
                runId: result.runId,
                error: e?.message || String(e),
              }));
            }
          })
          .catch((err) => {
            logError('intelligence_fanout_trigger_error', {
              clientId,
              sourceId,
              error: err?.message || String(err),
              runId: result.runId,
            });
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
            }).catch((e) => logWarn('intelligence_fanout_append_event_failed', {
              clientId,
              sourceId,
              runId: result.runId,
              error: e?.message || String(e),
            }));
          });
      }
    } catch (err) {
      logError('intelligence_fanout_resolution_failed', {
        clientId,
        error: err?.message || String(err),
        runId: result.runId,
      });
    }
  })();

  return json(result);
}
