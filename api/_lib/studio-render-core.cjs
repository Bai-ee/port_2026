'use strict';

// Shared server-side studio-video render+store core. Used by the user-facing
// route (app/api/dashboard/studio-render/route.js) and by the first-run worker
// pipeline (app/api/worker/run-brief) so both produce identical studioCaptures
// refs from the same Cloud Run GPU service — no duplicated storage logic.
//
// This module is auth-agnostic: callers do their own authorization, then pass a
// resolved clientId + recipe. It never throws for an expected render failure —
// it returns { ok:false, status, error } so HTTP callers can map it and the
// worker can treat it as non-fatal.

const fb = require('./firebase-admin.cjs');
const { saveBufferArtifact } = require('./storage-artifacts.cjs');
const renderJobs = require('./studio-render-jobs.cjs');

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_STORED_CAPTURES = 40;
const RENDER_TIMEOUT_MS = 150000;
const RENDER_RETRY_DELAYS_MS = [8000, 20000];

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

async function appendCaptureRef(clientId, ref) {
  const docRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const current = Array.isArray(snap.data()?.studioCaptures) ? snap.data().studioCaptures : [];
    const deduped = current.filter((item) => item?.storagePath !== ref.storagePath);
    const next = [...deduped, ref].slice(-MAX_STORED_CAPTURES);
    tx.set(docRef, { studioCaptures: next }, { merge: true });
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRenderFailure(status, message) {
  const text = String(message || '').toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    text.includes('rate exceeded') ||
    text.includes('no available instance') ||
    text.includes('busy') ||
    text.includes('shutting down')
  );
}

// The locked launch recipe — the ONE proven config (X/Twitter format, black
// background, desktop mockup). buildLockedStudioRecipe(url) returns a recipe
// matching services/studio-render/recipe.mjs; the render service clamps it.
function buildLockedStudioRecipe(url) {
  return {
    url,
    preset: 'push-rotate-flat',
    output: { seconds: 8, fps: 30, width: 1920, height: 1200 },
    device: { viewport: 'desktop', backdrop: 'home', loop: true },
    environment: { mode: 'gradient', preset: 'studio', color: '#11141a', reflections: true },
    capture: { warmupMs: 1000 },
  };
}

// Render one studio video from `recipe` for `clientId`, store it, append the
// studioCaptures ref. Returns { ok, status, error?, capture?, jobId }.
// Never throws for expected failures (config missing, render error, storage
// error) — only unexpected programmer errors propagate.
async function renderAndStoreStudioVideo({ clientId, recipe, postId = null, jobId: existingJobId = null, createJob = true }) {
  const renderUrl = String(process.env.STUDIO_RENDER_URL || '').replace(/\/+$/, '');
  const renderSecret = String(process.env.STUDIO_RENDER_SECRET || '');
  if (!renderUrl || !renderSecret) {
    return { ok: false, status: 503, error: 'Studio render service is not configured.', jobId: null };
  }

  const sourceUrl = String(recipe?.url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(sourceUrl)) {
    return { ok: false, status: 400, error: 'A valid http(s) URL is required.', jobId: null };
  }

  // Metadata derived from the recipe for persistence (the service owns clamping).
  const seconds = clamp(recipe?.output?.seconds, 2, 12, 8);
  const viewportId = String(recipe?.device?.viewport || 'desktop').slice(0, 40);
  const backdropId = String(recipe?.device?.backdrop || '').slice(0, 40);
  const templateId = String(recipe?.preset || '').slice(0, 80);
  const environmentMode = String(recipe?.environment?.mode || 'gradient').slice(0, 20);
  const environmentPreset = String(recipe?.environment?.preset || '').slice(0, 40);
  const environmentBlur = String(recipe?.environment?.blur ?? '');

  // Durable job record so this render is queue-able + pollable. Queue workers
  // pass an existing claimed jobId; legacy direct callers may still create one.
  let jobId = existingJobId || null;
  if (!jobId && createJob !== false) {
    try {
      ({ jobId } = await renderJobs.createRenderJob({ clientId, recipe, postId }));
      await renderJobs.markRenderJobRendering(jobId);
    } catch {
      jobId = null; // job tracking is best-effort — never block a render on it.
    }
  }

  let response;
  let lastFailure = null;
  for (let attempt = 0; attempt <= RENDER_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await fetchWithTimeout(`${renderUrl}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-render-secret': renderSecret },
        body: JSON.stringify(recipe),
      }, RENDER_TIMEOUT_MS);
    } catch (err) {
      const message = err?.name === 'AbortError'
        ? 'Studio render timed out before Cloud Run returned a video.'
        : `Studio render request failed: ${err?.message || err}`;
      lastFailure = { status: 502, message };
      if (attempt < RENDER_RETRY_DELAYS_MS.length) {
        await sleep(RENDER_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      await renderJobs.failRenderJob(jobId, { message });
      return { ok: false, status: 502, error: message, jobId };
    }

    if (response.ok) break;

    const text = await response.text().catch(() => '');
    let detail = text.slice(0, 500);
    try { detail = JSON.parse(text)?.error || detail; } catch {}
    const message = detail || `Studio render failed with HTTP ${response.status}.`;
    const status = response.status === 429 ? 429 : 502;
    lastFailure = { status, message };

    if (attempt < RENDER_RETRY_DELAYS_MS.length && isRetryableRenderFailure(response.status, message)) {
      await sleep(RENDER_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    await renderJobs.failRenderJob(jobId, { message });
    return { ok: false, status, error: message, jobId };
  }

  if (!response?.ok) {
    const message = lastFailure?.message || 'Studio render failed before returning a video.';
    await renderJobs.failRenderJob(jobId, { message });
    return { ok: false, status: lastFailure?.status || 502, error: message, jobId };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    await renderJobs.failRenderJob(jobId, { message: 'Studio render returned an empty video.' });
    return { ok: false, status: 502, error: 'Studio render returned an empty video.', jobId };
  }
  if (buffer.length > MAX_VIDEO_BYTES) {
    await renderJobs.failRenderJob(jobId, { message: 'Studio render video exceeds 40MB.' });
    return { ok: false, status: 413, error: 'Studio render video exceeds 40MB.', jobId };
  }

  const capturedAt = new Date().toISOString();
  const stamp = Date.now();
  const renderMs = response.headers.get('x-render-ms') || '';
  const renderInfo = response.headers.get('x-render-info') || '';
  const videoContentType = response.headers.get('content-type') || 'video/mp4';
  const videoExt = videoContentType === 'video/webm' ? 'webm' : 'mp4';

  try {
    const stored = await saveBufferArtifact({
      storagePath: `clients/${clientId}/studio/video-cloud-${stamp}.${videoExt}`,
      buffer,
      contentType: videoContentType,
      metadata: {
        artifactType: 'studio_video',
        renderProvider: 'cloud-run-gpu',
        clientId,
        capturedAt,
        viewportId,
        backdropId,
        templateId,
        environmentMode,
        environmentPreset,
        environmentBlur,
        durationSeconds: String(seconds),
        sourceUrl,
        renderMs,
        renderInfo,
      },
    });

    const ref = {
      type: 'studio_video',
      variant: 'video',
      label: 'Cloud GPU Mockup Video',
      viewportId,
      backdropId,
      templateId,
      environmentMode,
      environmentPreset,
      durationSeconds: seconds,
      sourceUrl,
      renderProvider: 'cloud-run-gpu',
      renderMs: Number(renderMs) || null,
      storageProvider: 'firebase-storage',
      bucket: stored.bucket,
      storagePath: stored.storagePath,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      capturedAt,
      downloadUrl: stored.downloadUrl,
      jobId,
    };
    await appendCaptureRef(clientId, ref);
    await renderJobs.completeRenderJob(jobId, ref);
    return { ok: true, status: 200, capture: ref, jobId };
  } catch (err) {
    await renderJobs.failRenderJob(jobId, { message: `Video storage failed: ${err.message}` });
    return { ok: false, status: 500, error: `Video storage failed: ${err.message}`, jobId };
  }
}

module.exports = {
  renderAndStoreStudioVideo,
  buildLockedStudioRecipe,
  appendCaptureRef,
  isRetryableRenderFailure,
};
