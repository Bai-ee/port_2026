import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Backstop sweep: reconcile any in-flight media_jobs against the LIVE EditVideos
// render results so completed videos land in dashboard_state.mediaCaptures even
// if the user closed the tab before the poll finished. Also a manual/cron ping
// endpoint the EditVideos Action could later call. Metadata-only.
//
// Auth mirrors app/api/worker/render-studio/route.js: worker secret, cron
// secret, or an admin request.
export const maxDuration = 60;
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
const mediaJobs = require('../../../../api/_lib/media-jobs.cjs');
const { reconcileMediaJob } = require('../../../../api/_lib/media-reconcile.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = getHeaderValue(buildAuthRequestShim(request).headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

async function authorizeRequest(request) {
  if (hasValidWorkerSecret(buildAuthRequestShim(request))) return;
  if (hasValidCronSecret(request)) return;
  await verifyAdminRequest(buildAuthRequestShim(request));
}

export async function POST(request) {
  try {
    await authorizeRequest(request);
  } catch {
    return json({ error: 'Unauthorized.' }, 401);
  }

  let jobs;
  try {
    jobs = await mediaJobs.listInFlightMediaJobs(50);
  } catch (err) {
    return json({ ok: false, error: `Could not list in-flight media jobs: ${err?.message}` }, 500);
  }

  const summary = { scanned: jobs.length, completed: 0, failed: 0, pending: 0, errors: 0 };
  for (const job of jobs) {
    try {
      const res = await reconcileMediaJob(job, job.clientId);
      if (res.status === 'completed') summary.completed += 1;
      else if (res.status === 'failed') summary.failed += 1;
      else summary.pending += 1;
    } catch (err) {
      summary.errors += 1;
      console.warn(`[media-reconcile] job ${job.jobId} failed: ${err?.message}`);
    }
  }

  return json({ ok: true, ...summary });
}
