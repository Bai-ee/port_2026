import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { captureScreenshotBuffer } = require('../../../../api/_lib/browserless.cjs');
const { saveBufferArtifact } = require('../../../../api/_lib/storage-artifacts.cjs');
const { validateUrl } = require('../../../../api/_lib/safe-fetch.cjs');

export const maxDuration = 120;

// Viewport presets for Studio hi-res captures. deviceScaleFactor is applied on
// top of these from the request (clamped 1–3), so a desktop capture at scale 3
// yields a 4320×2700 source image for the promo pipeline.
const STUDIO_VIEWPORTS = {
  desktop: { width: 1440, height: 900,  isMobile: false, hasTouch: false, isLandscape: true,  label: 'Desktop' },
  mobile:  { width: 390,  height: 844,  isMobile: true,  hasTouch: true,  isLandscape: false, label: 'Mobile' },
  tablet:  { width: 768,  height: 1024, isMobile: true,  hasTouch: true,  isLandscape: false, label: 'Tablet' },
};

const MAX_SCENE_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 40 * 1024 * 1024;
const MAX_STORED_CAPTURES = 40;

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

async function listCaptureRefs(clientId) {
  const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  const list = Array.isArray(snap.data()?.studioCaptures) ? snap.data().studioCaptures : [];
  return list.slice(-MAX_STORED_CAPTURES).reverse();
}

// POST { action: 'capture', url, viewportId, fullPage, scale }
//   → browserless hi-res screenshot, persisted as a studio_capture artifact.
// POST { action: 'upload-scene', dataUrl, label }
//   → persists a client-rendered 3D scene PNG as a studio_scene artifact.
// POST multipart { action: 'upload-video', video, label, ...metadata }
//   → persists a browser-recorded WebM/MP4 as a studio_video artifact.
export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const clientId = context.clientId;

  const requestContentType = request.headers.get('content-type') || '';
  const isMultipart = requestContentType.includes('multipart/form-data');
  let body = null;
  let form = null;
  try {
    if (isMultipart) {
      form = await request.formData();
    } else {
      body = await request.json();
    }
  } catch {
    return json({ error: isMultipart ? 'Invalid form body.' : 'Invalid JSON body.' }, 400);
  }
  const field = (name, fallback = '') => {
    if (form) return form.get(name) ?? fallback;
    return body?.[name] ?? fallback;
  };
  const action = String(field('action', 'capture') || 'capture');
  const capturedAt = new Date().toISOString();
  const stamp = Date.now();

  if (action === 'upload-scene') {
    const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(body?.dataUrl || ''));
    if (!match) return json({ error: 'dataUrl must be a base64 PNG or JPEG data URL.' }, 400);
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return json({ error: 'Empty image.' }, 400);
    if (buffer.length > MAX_SCENE_UPLOAD_BYTES) return json({ error: 'Scene image exceeds 8MB.' }, 413);
    const ext = match[1] === 'jpeg' ? 'jpg' : 'png';
    const contentType = match[1] === 'jpeg' ? 'image/jpeg' : 'image/png';

    try {
      const stored = await saveBufferArtifact({
        storagePath: `clients/${clientId}/studio/scene-${stamp}.${ext}`,
        buffer,
        contentType,
        metadata: { artifactType: 'studio_scene', clientId, capturedAt },
      });
      const ref = {
        type: 'studio_scene',
        variant: 'scene',
        label: String(body?.label || '3D Scene').slice(0, 80),
        storageProvider: 'firebase-storage',
        bucket: stored.bucket,
        storagePath: stored.storagePath,
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        capturedAt,
        downloadUrl: stored.downloadUrl,
      };
      await appendCaptureRef(clientId, ref);
      return json({ ok: true, capture: ref });
    } catch (err) {
      return json({ error: `Scene upload failed: ${err.message}` }, 500);
    }
  }

  if (action === 'upload-video') {
    if (!form) return json({ error: 'Video uploads must use multipart/form-data.' }, 400);
    const file = form.get('video');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'Missing video file.' }, 400);
    const rawType = String(file.type || 'video/webm').split(';')[0].toLowerCase();
    const allowed = new Set(['video/webm', 'video/mp4', 'video/ogg']);
    if (!allowed.has(rawType)) return json({ error: 'Video must be WebM, MP4, or Ogg.' }, 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) return json({ error: 'Empty video.' }, 400);
    if (buffer.length > MAX_VIDEO_UPLOAD_BYTES) return json({ error: 'Video exceeds 40MB.' }, 413);

    const ext = rawType === 'video/mp4' ? 'mp4' : rawType === 'video/ogg' ? 'ogv' : 'webm';
    const durationSeconds = Math.max(0, Math.min(120, Number(field('durationSeconds', 0)) || 0));
    const viewportId = STUDIO_VIEWPORTS[field('viewportId')] ? String(field('viewportId')) : 'desktop';
    const backdropId = String(field('backdropId', '') || '').slice(0, 40);
    const templateId = String(field('templateId', '') || '').slice(0, 80);
    const sourceUrl = String(field('sourceUrl', '') || '').slice(0, 2048);

    try {
      const stored = await saveBufferArtifact({
        storagePath: `clients/${clientId}/studio/video-${stamp}.${ext}`,
        buffer,
        contentType: rawType,
        metadata: {
          artifactType: 'studio_video',
          clientId,
          capturedAt,
          viewportId,
          backdropId,
          templateId,
          durationSeconds: String(durationSeconds),
          sourceUrl,
        },
      });
      const ref = {
        type: 'studio_video',
        variant: 'video',
        label: String(field('label', '3D Mockup Video') || '3D Mockup Video').slice(0, 100),
        viewportId,
        backdropId,
        templateId,
        durationSeconds,
        sourceUrl,
        storageProvider: 'firebase-storage',
        bucket: stored.bucket,
        storagePath: stored.storagePath,
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        capturedAt,
        downloadUrl: stored.downloadUrl,
      };
      await appendCaptureRef(clientId, ref);
      return json({ ok: true, capture: ref });
    } catch (err) {
      return json({ error: `Video upload failed: ${err.message}` }, 500);
    }
  }

  // action === 'capture'
  const url = String(field('url', '') || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return json({ error: 'A valid http(s) URL is required.' }, 400);
  try {
    await validateUrl(url);
  } catch {
    return json({ error: 'A safe public http(s) URL is required.' }, 400);
  }
  const viewportId = STUDIO_VIEWPORTS[field('viewportId')] ? String(field('viewportId')) : 'desktop';
  const preset = STUDIO_VIEWPORTS[viewportId];
  const scale = Math.min(3, Math.max(1, Number(field('scale')) || 2));
  const fullPage = Boolean(field('fullPage'));

  const variant = {
    id: `studio-${viewportId}${fullPage ? '-full' : ''}`,
    label: `Studio ${preset.label}${fullPage ? ' Full Page' : ''}`,
    storageSuffix: `studio-${viewportId}`,
    fullPage,
    viewport: { ...preset, deviceScaleFactor: scale },
  };
  delete variant.viewport.label;

  let shot;
  try {
    shot = await captureScreenshotBuffer({ clientId, runId: `studio-${stamp}`, targetUrl: url, variant });
  } catch (err) {
    return json({ error: `Capture failed: ${err.message}` }, 502);
  }
  if (!shot.ok) {
    return json({ error: shot.warning?.message || 'Capture failed.', warning: shot.warning || null }, 502);
  }

  try {
    const stored = await saveBufferArtifact({
      storagePath: `clients/${clientId}/studio/${stamp}-${viewportId}${fullPage ? '-full' : ''}.${shot.extension}`,
      buffer: shot.buffer,
      contentType: shot.contentType,
      metadata: { artifactType: 'studio_capture', artifactVariant: variant.id, clientId, sourceUrl: url, capturedAt },
    });
    const ref = {
      type: 'studio_capture',
      variant: variant.id,
      viewportLabel: variant.label,
      viewport: { width: preset.width, height: preset.height, deviceScaleFactor: scale },
      storageProvider: 'firebase-storage',
      bucket: stored.bucket,
      storagePath: stored.storagePath,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      sourceUrl: url,
      capturedAt,
      downloadUrl: stored.downloadUrl,
    };
    await appendCaptureRef(clientId, ref);
    return json({ ok: true, capture: ref });
  } catch (err) {
    return json({ error: `Storage failed: ${err.message}` }, 500);
  }
}

// GET                → list this client's studio captures (newest first).
// GET ?proxy=1&path= → stream a stored capture same-origin so the 3D studio
//                      can use it as a WebGL texture without CORS issues.
export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const clientId = context.clientId;
  const { searchParams } = new URL(request.url);

  if (searchParams.get('proxy')) {
    const storagePath = String(searchParams.get('path') || '');
    // Only allow reads inside this client's own folder.
    if (!storagePath.startsWith(`clients/${clientId}/`)) {
      return json({ error: 'Path not permitted.' }, 403);
    }
    try {
      const [buffer] = await fb.adminStorage.bucket().file(storagePath).download();
      const contentType = storagePath.endsWith('.png')
        ? 'image/png'
        : storagePath.endsWith('.webm')
          ? 'video/webm'
          : storagePath.endsWith('.mp4')
            ? 'video/mp4'
            : storagePath.endsWith('.ogv')
              ? 'video/ogg'
              : 'image/jpeg';
      return new NextResponse(buffer, {
        status: 200,
        headers: { 'content-type': contentType, 'cache-control': 'private, max-age=300' },
      });
    } catch (err) {
      return json({ error: `Proxy read failed: ${err.message}` }, 404);
    }
  }

  try {
    const captures = await listCaptureRefs(clientId);
    return json({ ok: true, captures });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
