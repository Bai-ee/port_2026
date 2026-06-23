import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const {
  buildAuthRequestShim,
  getHeaderValue,
  hasValidWorkerSecret,
  safeSecretEquals,
  verifyAdminRequest,
} = require('../../../../api/_lib/auth.cjs');
const renderJobs = require('../../../../api/_lib/studio-render-jobs.cjs');
const {
  isRetryableRenderFailure,
  renderAndStoreStudioVideo,
} = require('../../../../api/_lib/studio-render-core.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

async function authorizeRequest(request) {
  if (hasValidWorkerSecret(buildAuthRequestShim(request))) return;
  if (hasValidCronSecret(request)) return;
  await verifyAdminRequest(buildAuthRequestShim(request));
}

function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = getHeaderValue(buildAuthRequestShim(request).headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

function workerUrlFromRequest(request) {
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}/api/worker/render-studio`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function triggerNext(request, delayMs = 0) {
  const workerUrl = workerUrlFromRequest(request);
  after(async () => {
    try {
      if (delayMs > 0) await sleep(Math.min(delayMs, 240_000));
      await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-secret': process.env.WORKER_SECRET || '',
        },
        body: JSON.stringify({ source: 'render-studio-drain' }),
        cache: 'no-store',
      });
    } catch (err) {
      console.warn(`[studio-render-worker] self-trigger failed: ${err?.message}`);
    }
  });
}

export async function POST(request) {
  try {
    await authorizeRequest(request);
  } catch {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const workerId = `studio-render-worker-${Date.now()}`;
  const job = await renderJobs.claimNextRenderJob({ workerId });
  if (!job) {
    return json({ ok: true, claimed: false, message: 'No runnable render jobs.' });
  }

  let recipe = job.recipeFull || null;
  if (!recipe?.url && job.recipe?.url) {
    const { getSignupVideoRecipe } = require('../../../../api/_lib/signup-video-recipe.cjs');
    recipe = await getSignupVideoRecipe(job.recipe.url);
  }
  if (!recipe?.url) {
    await renderJobs.failRenderJob(job.id, { message: 'Render job is missing the full render recipe.' });
    triggerNext(request);
    return json({ ok: false, claimed: true, jobId: job.id, error: 'Render job is missing the full render recipe.' }, 500);
  }

  console.log(`[studio-render-worker] claimed ${job.id} for ${job.clientId}`);
  const result = await renderAndStoreStudioVideo({
    clientId: job.clientId,
    recipe,
    postId: job.postId || null,
    jobId: job.id,
    createJob: false,
  });

  if (!result.ok) {
    if (isRetryableRenderFailure(result.status, result.error)) {
      const requeue = await renderJobs.requeueRenderJob(job.id, { message: result.error });
      const delayMs = requeue?.nextAttemptAt
        ? Math.max(0, Date.parse(requeue.nextAttemptAt) - Date.now())
        : 0;
      triggerNext(request, delayMs);
      return json({ ok: false, claimed: true, requeued: true, jobId: job.id, error: result.error }, 202);
    }
    return json({ ok: false, claimed: true, jobId: job.id, error: result.error }, result.status || 502);
  }

  triggerNext(request);
  return json({ ok: true, claimed: true, jobId: job.id, capture: result.capture });
}
