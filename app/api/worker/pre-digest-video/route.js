import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Pre-digest VIDEO worker. Runs well BEFORE the daily-digest cron and kicks
// off a fresh custom Daily Email Video render for the digest home client, so by the
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
const clipSelector = require('../../../../api/_lib/media-clip-selector.cjs');
const {
  enqueueVideoJob,
  triggerWorker,
  listSourceFolders,
  listFolderMedia,
  listOptions,
} = require('../../../../api/_lib/editvideos-bridge.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

// Code-owned production recipe for the DAILY EMAIL ONLY. This intentionally does
// not read the Video Remix UI/card settings; tweak this object when the daily
// email needs its own recurring look, source policy, or audio/branding.
const DAILY_EMAIL_VIDEO_PRODUCTION = Object.freeze({
  name: 'hitloop-daily-email-v1',
  sourceFolderCount: 1,
  // Strict source policy for daily email: do not sample from the UI-selected
  // folder pool or any fallback bucket.
  strictSourceFolders: ['skyline'],
  randomAudio: { enabled: true },
  // antiRepeatLookback: clips used by the last N video-remix jobs are only
  // re-picked after every unused eligible clip has had a turn, so runs cycle
  // through the folder instead of re-rolling the same favorites.
  videoOrder: { enabled: true, segmentCount: 6, minSizeBytes: 5 * 1024 * 1024, antiRepeatLookback: 3 },
  recipe: {
    filter: { key: 'look_hard_bw_street_doc', intensity: 0.8 },
    logos: { top: 'ue_barcode_white.png', end: 'mixtapes_white_square.png' },
    // The EditVideos worker interprets artist image as a full 5s segment, not
    // one last frame. Keep all six segments as skyline footage; use end logo
    // for the final graphic layer.
    useArtistImage: false,
  },
});

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

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const next = String(value || '').trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function buildDailyEmailSourceFolders(allFolders, production = DAILY_EMAIL_VIDEO_PRODUCTION) {
  const available = uniqueStrings(allFolders);
  const availableSet = new Set(available);
  const strict = uniqueStrings(production.strictSourceFolders);
  if (strict.length) {
    const missing = strict.filter((folder) => !availableSet.has(folder));
    if (missing.length) {
      throw new Error(`strict source folder unavailable: ${missing.join(', ')}`);
    }
    return strict;
  }

  const excluded = new Set(uniqueStrings(production.excludedSourceFolders));
  const preferred = uniqueStrings(production.preferredSourceFolders)
    .filter((folder) => availableSet.has(folder) && !excluded.has(folder));
  const pool = available.filter((folder) => !excluded.has(folder) && !preferred.includes(folder));
  const needed = Math.max(0, Number(production.sourceFolderCount || 6) - preferred.length);
  return [...preferred, ...pickRandomFolders(pool, needed)].slice(0, Math.max(1, Number(production.sourceFolderCount || 6)));
}

async function pickRandomArtistMix() {
  const options = await listOptions();
  // Only pick artists whose names survive validateRemixRecipe's ARTIST_RE —
  // a roll onto a name with e.g. "&" or "'" used to fail the whole recipe
  // and cost that day's email its fresh video.
  const artists = Array.isArray(options?.artists)
    ? options.artists.filter((artist) => (
      artist?.name
      && mediaRecipe.isValidArtistName(artist.name)
      && Array.isArray(artist.mixes)
      && artist.mixes.length
    ))
    : [];
  if (!artists.length) {
    throw new Error('random artist/mix requested but no artists with mixes are available');
  }

  const artist = artists[Math.floor(Math.random() * artists.length)];
  const mixTitle = artist.mixes[Math.floor(Math.random() * artist.mixes.length)];
  return { artist: artist.name, mixTitle };
}

async function buildDailyEmailVideoOrder(sourceFolders, clientId, production = DAILY_EMAIL_VIDEO_PRODUCTION) {
  if (!production.videoOrder?.enabled) return null;
  if (!Array.isArray(sourceFolders) || sourceFolders.length !== 1) {
    throw new Error('daily email videoOrder requires exactly one strict source folder');
  }

  const folder = sourceFolders[0];
  const segmentCount = Math.max(1, Number(production.videoOrder.segmentCount || 6));
  const media = await listFolderMedia(folder, { limit: 120 });
  const files = Array.isArray(media?.files) ? media.files : [];

  // Shuffle + anti-repeat now live in the shared selector so the Video Remix
  // card gets identical treatment (see api/_lib/media-clip-selector.cjs).
  const order = await clipSelector.buildVideoOrder({
    clientId,
    folder,
    files,
    segmentCount,
    minSizeBytes: Math.max(0, Number(production.videoOrder.minSizeBytes || 0)),
    antiRepeatLookback: production.videoOrder.antiRepeatLookback,
    deps: { listMediaJobs: mediaJobs.listMediaJobs },
  });

  // For the daily email an unfillable folder is fatal: better to report it than
  // to silently hand the worker a folder-only recipe (which renders repetitively).
  if (!order) {
    const eligible = clipSelector.eligibleClips(files, production.videoOrder.minSizeBytes).length;
    throw new Error(`not enough eligible videos in ${folder}: ${eligible}/${segmentCount}`);
  }
  return order;
}

async function buildDailyEmailRecipe(sourceFolders, clientId, production = DAILY_EMAIL_VIDEO_PRODUCTION) {
  const [audio, videoOrder] = await Promise.all([
    production.randomAudio?.enabled ? pickRandomArtistMix() : {},
    buildDailyEmailVideoOrder(sourceFolders, clientId, production),
  ]);
  return mediaRecipe.validateRemixRecipe({
    sourceFolders,
    ...(production.recipe || {}),
    ...audio,
    ...(videoOrder ? { videoOrder } : {}),
  });
}

/**
 * Enqueue ONE code-owned Daily Email Video render for a client. This is separate
 * from the UI-managed Video Remix card recipe. Returns a status object; never throws.
 */
export async function triggerDailyEmailRemix(clientId) {
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

  let picked;
  try {
    picked = buildDailyEmailSourceFolders(folders);
  } catch (err) {
    return { ok: false, error: `source folder selection failed: ${err.message}` };
  }
  if (!picked.length) return { ok: false, error: 'no eligible daily email source folders available' };

  let recipe;
  try {
    // Daily email recipe is code-owned here. Output is still locked by
    // validateRemixRecipe (720/30/30) to match the existing render contract.
    recipe = await buildDailyEmailRecipe(picked, clientId);
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
    // MUST be awaited: on Vercel the function instance can freeze the moment the
    // response is returned, so a floating dispatch promise never reaches GitHub.
    // That is why no repository_dispatch run ever appeared and every job waited
    // hours for the throttled `schedule` cron instead — which in turn made the
    // digest fall back to the previous day's video. Do not make this fire-and-forget.
    const triggered = await triggerWorker().catch((err) => ({ triggered: false, reason: err?.message }));
    if (!triggered?.triggered) {
      logWarn('pre_digest_video_worker_not_triggered', { reason: triggered?.reason || triggered?.status });
    }
  } catch (err) {
    // Job is queued; the backstop media-reconcile cron can still pick it up.
    logWarn('pre_digest_video_enqueue_failed', { error: err.message });
  }

  return {
    ok: true,
    clientId,
    jobId,
    editJobId,
    folders: picked,
    production: DAILY_EMAIL_VIDEO_PRODUCTION.name,
    selectedAudio: {
      artist: recipe.artist || null,
      mixTitle: recipe.mixTitle || null,
    },
    selectedVideoOrder: Array.isArray(recipe.videoOrder)
      ? recipe.videoOrder.map((item) => item.videoName)
      : [],
    recipe: mediaJobs.trimRecipeSummary(recipe),
  };
}

// Back-compat for any direct imports/tests using the old name.
export async function triggerRandomRemix(clientId) {
  return triggerDailyEmailRemix(clientId);
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
  const res = await triggerDailyEmailRemix(homeClientId);
  logInfo('pre_digest_video_done', { clientId: homeClientId, ok: res.ok, jobId: res.jobId, production: res.production });
  return json(res, res.ok ? 200 : 207);
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
