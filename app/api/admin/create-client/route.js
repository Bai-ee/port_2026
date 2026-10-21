import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { createAdminClient } = require('../../../../api/_lib/client-provisioning.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const companyName = String(body.companyName || '').trim();
  if (!companyName) {
    return json({ error: 'Provide a client name.' }, 400);
  }

  let result;
  try {
    result = await createAdminClient({
      adminUid: decoded.uid,
      adminEmail: decoded.email || '',
      companyName,
      ideaDescription: body.ideaDescription || '',
      websiteUrl: typeof body.websiteUrl === 'string' ? body.websiteUrl : '',
      onboardingSteps: body.onboardingSteps && typeof body.onboardingSteps === 'object' ? body.onboardingSteps : null,
    });
  } catch (err) {
    return json({ error: err.message || 'Could not create client.' }, err.status || 500);
  }

  // Same hand-off as signup (app/api/clients/provision): after() keeps the
  // invocation alive long enough to pass the queued run to the worker.
  const runId = result.initialRun?.runId;
  if (runId && result.initialRunCreated) {
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
          logError('admin_create_client_worker_trigger_failed', {
            clientId: result.clientId,
            runId,
            httpStatus: response.status,
            detail: detail.trim() || null,
          });
        } else {
          logInfo('admin_create_client_worker_trigger_accepted', { clientId: result.clientId, runId, httpStatus: response.status });
        }
      } catch (error) {
        logWarn('admin_create_client_worker_trigger_throw', {
          clientId: result.clientId,
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  return json({
    ok: true,
    clientId: result.clientId,
    client: result.client,
    runId: runId || null,
  });
}
