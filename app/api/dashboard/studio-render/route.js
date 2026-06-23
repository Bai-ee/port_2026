import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const renderJobs = require('../../../../api/_lib/studio-render-jobs.cjs');

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

async function triggerRenderWorker(request) {
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('host') || 'localhost:3000';
  const workerUrl = `${proto}://${host}/api/worker/render-studio`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': process.env.WORKER_SECRET || '',
      },
      body: JSON.stringify({ source: 'dashboard-studio-render' }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.warn(`[studio-render] worker trigger failed: ${response.status} ${detail.trim()}`);
    }
  } catch (err) {
    console.warn(`[studio-render] worker trigger threw: ${err?.message}`);
  } finally {
    clearTimeout(timer);
  }
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
  // shape). It is queued, then the single-lease worker drains render_jobs
  // serially so multiple clients cannot stampede the one-GPU Cloud Run service.
  const { jobId } = await renderJobs.createRenderJob({
    clientId: context.clientId,
    recipe: body,
    postId: body?.postId ? String(body.postId).slice(0, 120) : null,
  });
  await triggerRenderWorker(request);
  return json({ ok: true, queued: true, jobId }, 202);
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
