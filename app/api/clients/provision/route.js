import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { provisionClientForUser } = require('../../../../api/_lib/client-provisioning.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized.' },
      { status: 401 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provisioning failed.' },
      { status: 400 }
    );
  }

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
          console.error(`[provision] worker trigger failed for ${runId}: HTTP ${response.status} ${detail}`.trim());
        }
      } catch (error) {
        console.error(`[provision] worker trigger threw for ${runId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  return NextResponse.json(result);
}
