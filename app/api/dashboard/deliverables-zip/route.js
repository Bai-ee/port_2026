import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import JSZip from 'jszip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { readResponseBuffer, safeFetch } = require('../../../../api/_lib/safe-fetch.cjs');

// SSRF guard: the client passes asset URLs, so only allow https on the known
// Firebase Storage hosts (the bucket these deliverables live in). Anything else
// is rejected before a server-side fetch is ever made.
const ALLOWED_HOST_SUFFIXES = [
  'firebasestorage.app',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
];
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_INPUT_BYTES = 60 * 1024 * 1024;

function isAllowedAssetUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:') return false;
    const hostname = u.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

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

function safeName(name, fallback) {
  return String(name || fallback || 'asset')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || fallback || 'asset';
}

export async function POST(request) {
  // Auth: scope to a real client workspace before doing any fetching.
  try {
    const decoded = await verifyRequestUser(makeReqShim(request));
    const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
    if (!context.clientId) {
      return json({ error: 'No client workspace was found.' }, 404);
    }
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const assets = Array.isArray(body.assets) ? body.assets.slice(0, 24) : [];
  const allowed = assets.filter((a) => a && isAllowedAssetUrl(a.url));
  if (!allowed.length) {
    return json({ error: 'No valid deliverable assets to bundle.' }, 400);
  }

  // Server-side fetch is not CORS-bound, so the Storage download URLs that the
  // browser cannot read are fetchable here.
  const zip = new JSZip();
  const used = new Set();
  let added = 0;
  let totalBytes = 0;
  for (const [i, a] of allowed.entries()) {
    try {
      const res = await safeFetch(a.url, {
        timeoutMs: 15000,
        maxBytes: MAX_ASSET_BYTES,
        fetchOptions: {
          headers: { 'user-agent': 'HitloopDeliverablesZip/1.0' },
        },
      });
      if (!res.ok) continue;
      const buf = await readResponseBuffer(res, MAX_ASSET_BYTES);
      totalBytes += buf.length;
      if (totalBytes > MAX_ZIP_INPUT_BYTES) {
        return json({ error: 'Deliverable bundle is too large.' }, 413);
      }
      let name = safeName(a.name, `asset-${i + 1}`);
      // De-dupe filenames so zip entries never collide.
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        name = dot > 0 ? `${name.slice(0, dot)}-${i + 1}${name.slice(dot)}` : `${name}-${i + 1}`;
      }
      used.add(name);
      zip.file(name, buf);
      added += 1;
    } catch {
      // Skip an asset that fails to fetch; the rest still bundle.
    }
  }

  if (!added) {
    return json({ error: 'Could not fetch any deliverable assets.' }, 502);
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipName = safeName(body.zipName, 'deliverables');
  return new Response(zipBuffer, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${zipName}.zip"`,
      'cache-control': 'no-store',
    },
  });
}
