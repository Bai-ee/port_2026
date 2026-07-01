'use strict';

// media-reconcile.cjs — reconcile a Hitloop media_job against the LIVE
// EditVideos render result, then surface it into the client's dashboard_state.
//
// Shared by the user-facing route (app/api/dashboard/media — polled on job GET)
// and the cron backstop (app/api/worker/media-reconcile). Pure server logic; it
// reaches Firestore through firebase-admin.cjs and the EditVideos bridge.
//
// On EditVideos `completed`: append a normalized video_remix capture to
// dashboard_state.{clientId}.mediaCaptures (dedupe on jobId, cap last 40),
// clear mediaVideoPending, and mark the media_job `done`.
// On EditVideos `failed`: failMediaJob + leave mediaVideoPending with an error
// flag so the card can show a visible failure.

const fb = require('./firebase-admin.cjs');
const mediaJobs = require('./media-jobs.cjs');
const { getVideoJob } = require('./editvideos-bridge.cjs');

const MAX_STORED_CAPTURES = 40;
const TERMINAL = new Set(['done', 'failed']);

// Same transaction pattern as studio-render-core.appendCaptureRef: dedupe on the
// capture's jobId, cap to the last N, and clear the pending marker atomically.
async function appendMediaCapture(clientId, capture) {
  const docRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const current = Array.isArray(snap.data()?.mediaCaptures) ? snap.data().mediaCaptures : [];
    const deduped = current.filter((item) => item?.jobId !== capture.jobId);
    const next = [...deduped, capture].slice(-MAX_STORED_CAPTURES);
    tx.set(docRef, { mediaCaptures: next, mediaVideoPending: null }, { merge: true });
  });
}

async function markPendingFailed(clientId, jobId, message) {
  const docRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const pending = snap.data()?.mediaVideoPending;
    if (!pending || pending.jobId !== jobId) return;
    tx.set(docRef, {
      mediaVideoPending: { ...pending, status: 'failed', error: String(message || 'Render failed.').slice(0, 300) },
    }, { merge: true });
  }).catch(() => {});
}

/**
 * Reconcile a single media_job against its linked EditVideos render.
 * @param {object} job        the media_jobs doc data
 * @param {string} clientId   owning client
 * @returns {Promise<{status:'completed'|'failed'|'pending'|'skipped', capture?:object}>}
 */
async function reconcileMediaJob(job, clientId) {
  if (!job || !job.editJobId) return { status: 'skipped' };
  if (TERMINAL.has(job.status)) return { status: 'skipped' };

  let result;
  try {
    result = await getVideoJob(job.editJobId);
  } catch {
    // Bridge unconfigured or transient — degrade quietly, try again later.
    return { status: 'pending' };
  }
  if (!result) return { status: 'pending' };

  if (result.status === 'completed' && result.videoUrl) {
    const capture = {
      type: 'video_remix',
      variant: 'video',
      label: 'Video Remix',
      downloadUrl: result.videoUrl,
      storagePath: null,
      contentType: 'video/mp4',
      durationSeconds: Number(job.recipe?.durationSeconds) || 30,
      sourceFolders: Array.isArray(job.recipe?.sourceFolders) ? job.recipe.sourceFolders : [],
      arweaveSourceUrl: null,
      jobId: job.jobId,
      editJobId: job.editJobId,
      createdAt: new Date().toISOString(),
      // Provenance for the SAVED ASSETS metadata line: the FULL set of settings
      // that produced this remix, so the card can show set-vs-rendered detail.
      // recipeFull is the validated recipe (validateRemixRecipe output); recipe is
      // the trimmed summary. `full: true` marks the richer snapshot so the card can
      // fall back to the legacy compact line for captures made before this change.
      // A null field = not pinned by the operator → the EditVideos worker auto-picks
      // it (random logo/audio/artist), which is exactly what troubleshooting needs.
      createdWith: (() => {
        const rf = job.recipeFull || {};
        return {
          full: true,
          // legacy keys (kept for any existing reader)
          artist: rf.artist || null,
          mix: rf.useTrax ? 'Tracks' : (rf.mixTitle || null),
          filter: rf.filter?.key || job.recipe?.filter || null,
          orderSegments: Number(job.recipe?.manualOrderSegments)
            || (Array.isArray(rf.videoOrder) ? rf.videoOrder.length : 0),
          // The actual clip/image filenames when a manual order was set (auto mode
          // leaves this null — the worker random-picks clips from the folders).
          clips: Array.isArray(rf.videoOrder) && rf.videoOrder.length
            ? rf.videoOrder.map((v) => v && v.videoName).filter(Boolean)
            : null,
          // full settings snapshot
          useTrax: !!rf.useTrax,
          filterIntensity: (rf.filter && rf.filter.intensity != null) ? Number(rf.filter.intensity) : null,
          overlay: rf.overlay?.enabled ? (rf.overlay.effect || 'on') : null,
          topLogo: rf.logos?.top || null,
          endLogo: rf.logos?.end || null,
          useArtistImage: (rf.useArtistImage != null) ? !!rf.useArtistImage : null,
          endText: rf.endCard?.text || null,
          audioUrl: rf.arweaveAudioUrl || null,
          output: rf.output ? `${rf.output.width}x${rf.output.height}` : null,
          duration: Number(rf.output?.durationSeconds) || Number(job.recipe?.durationSeconds) || 30,
        };
      })(),
    };
    await appendMediaCapture(clientId, capture);
    await mediaJobs.completeMediaJob(job.jobId, capture);
    return { status: 'completed', capture };
  }

  if (result.status === 'failed') {
    await mediaJobs.failMediaJob(job.jobId, result.error || 'EditVideos render failed.');
    await markPendingFailed(clientId, job.jobId, result.error || 'EditVideos render failed.');
    return { status: 'failed' };
  }

  return { status: 'pending' };
}

module.exports = { reconcileMediaJob, appendMediaCapture };
