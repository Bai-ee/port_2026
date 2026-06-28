import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Pre-digest VIDEO worker. Runs ~40 min BEFORE the daily-digest cron and kicks
// off a fresh RANDOM Video Remix render for the digest home client, so by the
// time the digest sends the new video has rendered and can ride in the email's
// "Post content" block. Video render is async (the live EditVideos GitHub
// Action renders over minutes), so it cannot be produced inline at send time —
// this primes it ahead. Mirrors the pre-digest-refresh worker pattern.
//
// Only runs when the digest's `videoPosts` toggle is on (the feature that uses
// the result). Best-effort: any failure is reported, never blocks anything.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const require = createRequire(import.meta.url);
const { getHeaderValue, safeSecretEquals } = require('../../../../api/_lib/auth.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const mediaJobs = require('../../../../api/_lib/media-jobs.cjs');
const mediaRecipe = require('../../../../api/_lib/media-recipe.cjs');
const { enqueueVideoJob, triggerWorker, listSourceFolders } = require('../../../../api/_lib/editvideos-bridge.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Vercel cron sends CRON_SECRET as a Bearer token; fail closed in production. */
function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') return false;
    return true; // allow in dev/preview
  }
  const provided = getHeaderValue(request.headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

/** Shuffle + take up to n folders (>=1). */
function pickRandomFolders(folders, n) {
  const arr = [...folders];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(1, Math.min(n, arr.length)));
}

/**
 * Enqueue ONE random Video Remix render for a client (random source folders +
 * random audio via house defaults). Returns a status object; never throws.
 */
export async function triggerRandomRemix(clientId) {
  if (!clientId) return { ok: false, error: 'no clientId' };

  let folders = [];
  try {
    const raw = await listSourceFolders();
    folders = (Array.isArray(raw) ? raw : [])
      .map((f) => (typeof f === 'string' ? f : (f?.name || f?.folder || f?.path || '')))
      .filter(Boolean);
  } catch (err) {
    return { ok: false, error: `listSourceFolders failed: ${err.message}` };
  }
  if (!folders.length) return { ok: false, error: 'no source folders available' };

  const picked = pickRandomFolders(folders, 6);
  let recipe;
  try {
    // Minimal recipe: random folders. Omitting `artist` => random audio. Output
    // is locked by validateRemixRecipe (720/30/30).
    recipe = mediaRecipe.validateRemixRecipe({ sourceFolders: picked });
  } catch (err) {
    return { ok: false, error: `recipe invalid: ${err.message}` };
  }

  let jobId;
  try {
    ({ jobId } = await mediaJobs.createMediaJob({ clientId, type: 'video-remix', recipe }));
  } catch (err) {
    return { ok: false, error: `createMediaJob failed: ${err.message}` };
  }

  let editJobId = null;
  try {
    ({ editJobId } = await enqueueVideoJob(recipe));
    await mediaJobs.setMediaJobEditRef(jobId, editJobId);
    // Kick the (throttled) EditVideos worker now so the render starts promptly.
    triggerWorker().then((r) => {
      if (!r?.triggered) logWarn('pre_digest_video_worker_not_triggered', { reason: r?.reason || r?.status });
    }).catch(() => {});
  } catch (err) {
    // Job is queued; the backstop media-reconcile cron can still pick it up.
    logWarn('pre_digest_video_enqueue_failed', { error: err.message });
  }

  return { ok: true, clientId, jobId, editJobId, folders: picked };
}

async function handle(request) {
  if (!hasValidCronSecret(request)) return json({ error: 'Unauthorized.' }, 401);

  let homeClientId = null;
  let cfg = null;
  try {
    const configClientId = await digestConfig.resolveDigestClientId();
    cfg = await digestConfig.getDigestConfig(configClientId);
    homeClientId = cfg.homeClientId || configClientId;
  } catch (err) {
    logError('pre_digest_video_client_resolve_error', { error: err.message });
    return json({ error: `Could not resolve digest home client: ${err.message}` }, 500);
  }
  if (!homeClientId) return json({ error: 'No digest home client configured.' }, 404);

  // Only prime a video when the feature that uses it is enabled.
  if (cfg?.include?.videoPosts === false) {
    return json({ ok: true, skipped: 'videoPosts off', clientId: homeClientId });
  }

  logInfo('pre_digest_video_start', { clientId: homeClientId });
  const res = await triggerRandomRemix(homeClientId);
  logInfo('pre_digest_video_done', { clientId: homeClientId, ok: res.ok, jobId: res.jobId });
  return json(res, res.ok ? 200 : 207);
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
