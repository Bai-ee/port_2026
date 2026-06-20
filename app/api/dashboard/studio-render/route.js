import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const renderJobs = require('../../../../api/_lib/studio-render-jobs.cjs');
const { renderAndStoreStudioVideo } = require('../../../../api/_lib/studio-render-core.cjs');

export const maxDuration = 180;

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

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  if (!context.clientId) { const e = new Error('No clientId on user record.'); e.status = 404; throw e; }
  return { decoded, context };
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  // The request body IS the render recipe (services/studio-render/recipe.mjs
  // shape). All render + storage + studioCaptures logic lives in the shared
  // core so the worker pipeline produces identical refs.
  const result = await renderAndStoreStudioVideo({
    clientId: context.clientId,
    recipe: body,
    postId: body?.postId ? String(body.postId).slice(0, 120) : null,
  });

  if (!result.ok) {
    return json({ error: result.error, jobId: result.jobId }, result.status || 502);
  }
  return json({ ok: true, capture: result.capture, jobId: result.jobId });
}

// Poll a single render job (?jobId=) or list recent jobs for the client.
export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const clientId = context.clientId;
  const jobId = new URL(request.url).searchParams.get('jobId');

  try {
    if (jobId) {
      const job = await renderJobs.getRenderJob(jobId, clientId);
      if (!job) return json({ error: 'Render job not found.' }, 404);
      return json({ ok: true, job });
    }
    const jobs = await renderJobs.listRenderJobs(clientId, 20);
    return json({ ok: true, jobs });
  } catch (err) {
    return json({ error: `Could not read render jobs: ${err.message}` }, 500);
  }
}
