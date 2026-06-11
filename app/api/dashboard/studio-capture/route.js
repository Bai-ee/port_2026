import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { captureScreenshotBuffer } = require('../../../../api/_lib/browserless.cjs');
const { saveBufferArtifact } = require('../../../../api/_lib/storage-artifacts.cjs');

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
  try {
    await docRef.update({ studioCaptures: fb.FieldValue.arrayUnion(ref) });
  } catch {
    await docRef.set({ studioCaptures: [ref] }, { merge: true });
  }
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
export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const clientId = context.clientId;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const action = body?.action || 'capture';
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

  // action === 'capture'
  const url = String(body?.url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return json({ error: 'A valid http(s) URL is required.' }, 400);
  const viewportId = STUDIO_VIEWPORTS[body?.viewportId] ? body.viewportId : 'desktop';
  const preset = STUDIO_VIEWPORTS[viewportId];
  const scale = Math.min(3, Math.max(1, Number(body?.scale) || 2));
  const fullPage = Boolean(body?.fullPage);

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
      const contentType = storagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
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
