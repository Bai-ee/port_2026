import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { provisionClientForUser } = require('../../../../api/_lib/client-provisioning.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(buildAuthRequestShim(request));
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Unauthorized.' },
      401
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  let result;
  try {
    result = await provisionClientForUser({
      uid: decoded.uid,
      email: decoded.email || '',
      displayName: body.displayName || decoded.name || '',
      companyName: body.companyName || '',
      websiteUrl: body.websiteUrl || '',
      ideaDescription: body.ideaDescription || '',
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Provisioning failed.' },
      400
    );
  }

  logInfo('client_provision_result', {
    uid: decoded.uid,
    clientId: result.clientId || null,
    alreadyProvisioned: Boolean(result.alreadyProvisioned),
    runId: result.initialRun?.runId || null,
  });

  // Trigger the worker after the response has been scheduled. A plain fire-and-forget
  // fetch can be dropped when the request lifecycle ends on Vercel, which leaves the
  // run permanently queued. `after()` keeps the invocation alive long enough to hand
  // the queued run off to the worker route.
  const runId = result.initialRun?.runId;
  if (runId && !result.alreadyProvisioned) {
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const workerUrl = `${proto}://${host}/api/worker/run-brief`;
    after(async () => {
      try {
        const response = await fetch(workerUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-worker-secret': process.env.WORKER_SECRET || '',
          },
          body: JSON.stringify({ runId }),
          cache: 'no-store',
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          logError('client_provision_worker_trigger_failed', {
            clientId: result.clientId || null,
            runId,
            httpStatus: response.status,
            detail: detail.trim() || null,
          });
        } else {
          logInfo('client_provision_worker_trigger_accepted', {
            clientId: result.clientId || null,
            runId,
            httpStatus: response.status,
          });
        }
      } catch (error) {
        logWarn('client_provision_worker_trigger_throw', {
          clientId: result.clientId || null,
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  return json(result);
}
