import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const glbAssets = require('../../../../api/_lib/studio-glb-assets.cjs');

// Studio GLB asset library — Phase 3 GLB import (docs/plans/ORIGINAL-STUDIO-
// CINEMATIC-SETS-4K-PLAN.md "GLB import and asset safety"). Admin-only for
// every action, including reads: this manages real Storage spend/CORS
// config and accepts arbitrary uploaded binary files, the same elevated-
// access bar as the Archive/Publishing and Site Recreate cards (see
// CLAUDE.md's card entries) — not merely gated by the Studio Elements
// preview flag, which a non-admin visitor can reach if the env flag is on
// globally.
//
// Upload bytes never pass through this Vercel function — createUploadUrl
// mints a v4 signed PUT URL and the browser PUTs directly to Storage;
// confirm downloads the (size-capped) object once, server-side, to
// validate it before it's ever added to the library.

export const dynamic = 'force-dynamic';

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function makeReqShim(request) {
  return {
    headers: {
      get: (name) => request.headers.get(name),
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

async function requireAdmin(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const ok = await isAdminEmail(decoded?.email);
  if (!ok) { const e = new Error('Forbidden: admin access required.'); e.status = 403; throw e; }
  return decoded;
}

export async function GET(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const action = new URL(request.url).searchParams.get('action') || 'list';
  try {
    if (action === 'list') {
      const assets = await glbAssets.listAssets({ limit: 50 });
      return json({ ok: true, assets, maxUploadBytes: glbAssets.MAX_GLB_UPLOAD_BYTES, caps: glbAssets.SAFETY_CAPS });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Studio asset request failed.' }, 500);
  }
}

export async function POST(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const action = new URL(request.url).searchParams.get('action');
  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  try {
    if (action === 'request-upload') {
      const { fileName, sizeBytes } = body;
      if (!fileName) return json({ error: 'fileName is required.' }, 400);
      const result = await glbAssets.createUploadUrl({ fileName, sizeBytes });
      return json({ ok: true, ...result });
    }

    if (action === 'confirm') {
      const { assetId, storagePath, fileName } = body;
      if (!assetId || !storagePath) return json({ error: 'assetId and storagePath are required.' }, 400);
      const doc = await glbAssets.confirmUpload({ assetId, storagePath, fileName });
      return json({ ok: true, asset: doc });
    }

    if (action === 'delete') {
      const { assetId } = body;
      if (!assetId) return json({ error: 'assetId is required.' }, 400);
      const result = await glbAssets.deleteAsset(assetId);
      return json({ ok: true, ...result });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Studio asset request failed.' }, 400);
  }
}
