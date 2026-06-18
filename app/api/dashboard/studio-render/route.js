import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { saveBufferArtifact } = require('../../../../api/_lib/storage-artifacts.cjs');
const renderJobs = require('../../../../api/_lib/studio-render-jobs.cjs');

export const maxDuration = 180;

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_STORED_CAPTURES = 40;
const RENDER_TIMEOUT_MS = 150000;

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

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  if (!context.clientId) { const e = new Error('No clientId on user record.'); e.status = 404; throw e; }
  return { decoded, context };
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

export async function POST(request) {
  const renderUrl = String(process.env.STUDIO_RENDER_URL || '').replace(/\/+$/, '');
  const renderSecret = String(process.env.STUDIO_RENDER_SECRET || '');
  if (!renderUrl || !renderSecret) {
    return json({ error: 'Studio render service is not configured.' }, 503);
  }

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

  const sourceUrl = String(body?.url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(sourceUrl)) {
    return json({ error: 'A valid http(s) URL is required.' }, 400);
  }

  // The request body IS the render recipe (services/studio-render/recipe.mjs
  // shape). The render service normalizes + clamps it; here we only derive
  // labels/metadata for persistence.
  const recipe = body;
  const seconds = clamp(recipe?.output?.seconds, 2, 12, 8);
  const viewportId = String(recipe?.device?.viewport || 'desktop').slice(0, 40);
  const backdropId = String(recipe?.device?.backdrop || '').slice(0, 40);
  const templateId = String(recipe?.preset || '').slice(0, 80);
  const environmentMode = String(recipe?.environment?.mode || 'gradient').slice(0, 20);
  const environmentPreset = String(recipe?.environment?.preset || '').slice(0, 40);
  const environmentBlur = String(recipe?.environment?.blur ?? '');
  // Optional pairing — a render kicked off for a specific social post.
  const postId = body?.postId ? String(body.postId).slice(0, 120) : null;
  const clientId = context.clientId;

  // Durable job record so this render is queue-able + pollable (GET ?jobId=).
  let jobId = null;
  try {
    ({ jobId } = await renderJobs.createRenderJob({ clientId, recipe, postId }));
    await renderJobs.markRenderJobRendering(jobId);
  } catch {
    // Job tracking is best-effort — never block a render on it.
    jobId = null;
  }

  let response;
  try {
    response = await fetchWithTimeout(`${renderUrl}/render`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-render-secret': renderSecret,
      },
      body: JSON.stringify(recipe),
    }, RENDER_TIMEOUT_MS);
  } catch (err) {
    const message = err?.name === 'AbortError'
      ? 'Studio render timed out before Cloud Run returned a video.'
      : `Studio render request failed: ${err?.message || err}`;
    await renderJobs.failRenderJob(jobId, { message });
    return json({ error: message, jobId }, 502);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text.slice(0, 500);
    try { detail = JSON.parse(text)?.error || detail; } catch {}
    const message = detail || `Studio render failed with HTTP ${response.status}.`;
    await renderJobs.failRenderJob(jobId, { message });
    return json({ error: message, jobId }, response.status === 429 ? 429 : 502);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    await renderJobs.failRenderJob(jobId, { message: 'Studio render returned an empty video.' });
    return json({ error: 'Studio render returned an empty video.', jobId }, 502);
  }
  if (buffer.length > MAX_VIDEO_BYTES) {
    await renderJobs.failRenderJob(jobId, { message: 'Studio render video exceeds 40MB.' });
    return json({ error: 'Studio render video exceeds 40MB.', jobId }, 413);
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
    return json({ ok: true, capture: ref, jobId });
  } catch (err) {
    await renderJobs.failRenderJob(jobId, { message: `Video storage failed: ${err.message}` });
    return json({ error: `Video storage failed: ${err.message}`, jobId }, 500);
  }
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
