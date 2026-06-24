import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import JSZip from 'jszip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { readResponseBuffer, safeFetch } = require('../../../../api/_lib/safe-fetch.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

// Same-origin download proxy for a single deliverable. The brief renders in a
// script-sandboxed iframe and the asset URLs are cross-origin Firebase Storage
// (CORS-blocked, so a plain <a download> opens instead of saving and can't be
// renamed). This route fetches the asset server-side and streams it back with
// Content-Disposition: attachment + a descriptive filename, so a plain anchor
// downloads the file with the right name and no new tab.
//
// SSRF guard: only the configured Firebase Storage bucket is fetchable. The
// tokenized Storage URL is itself the access capability, so this route remains
// unauthenticated for public brief downloads, but it must not become a public
// arbitrary Storage zip proxy.
const EXPECTED_BUCKET = String(
  process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
  ''
)
  .replace(/^gs:\/\//i, '')
  .trim()
  .toLowerCase();
const SITE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://hitloop.agency').hostname.toLowerCase();
  } catch {
    return 'hitloop.agency';
  }
})();

const MAX_FILES = 8;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_INPUT_BYTES = 50 * 1024 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_REQUESTS = 30;
const PUBLIC_ASSET_RE = /^\/img\/[-a-z0-9_./@]+?\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm)$/i;

function bucketFromAssetUrl(u) {
  const hostname = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?...
  if (hostname === 'firebasestorage.googleapis.com') {
    const bIndex = parts.indexOf('b');
    return bIndex >= 0 ? parts[bIndex + 1] || '' : '';
  }

  // https://storage.googleapis.com/<bucket>/<path>
  if (hostname === 'storage.googleapis.com') {
    return parts[0] || '';
  }

  // https://<bucket>.storage.googleapis.com/<path>
  if (hostname.endsWith('.storage.googleapis.com')) {
    return hostname.slice(0, -'.storage.googleapis.com'.length);
  }

  // https://<bucket>.firebasestorage.app/<path>
  if (hostname.endsWith('.firebasestorage.app')) {
    return hostname.slice(0, -'.firebasestorage.app'.length);
  }

  return '';
}

function isAllowedAssetUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:') return false;
    if (u.hostname.toLowerCase() === SITE_HOST && PUBLIC_ASSET_RE.test(u.pathname)) return true;
    if (!EXPECTED_BUCKET) return false;
    return bucketFromAssetUrl(u).toLowerCase() === EXPECTED_BUCKET;
  } catch {
    return false;
  }
}

function safeName(name, fallback) {
  return String(name || fallback || 'deliverable')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || fallback || 'deliverable';
}

async function fetchAsset(url) {
  const res = await safeFetch(url, {
    timeoutMs: 15000,
    maxBytes: MAX_ASSET_BYTES,
    fetchOptions: { headers: { 'user-agent': 'HitloopDeliverableFile/1.0' } },
  });
  if (!res.ok) throw new Error(`Upstream responded ${res.status}.`);
  return { buf: await readResponseBuffer(res, MAX_ASSET_BYTES), contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

export async function GET(request) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit({
    key: `deliverable-file:${ip}`,
    limit: RATE_LIMIT_REQUESTS,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    failOpen: false,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many download requests. Try again shortly.' },
      {
        status: 429,
        headers: {
          'cache-control': 'no-store',
          'retry-after': String(RATE_LIMIT_WINDOW_SECONDS),
        },
      },
    );
  }

  const sp = request.nextUrl.searchParams;
  // Pair each `u` (asset url) with the same-index `n` (filename). One pair → the
  // single file streams back; multiple pairs → a zip bundles them all.
  const requestedUrls = sp.getAll('u').slice(0, MAX_FILES + 1);
  if (!EXPECTED_BUCKET && !SITE_HOST) {
    return NextResponse.json({ error: 'Deliverable downloads are not configured.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (!requestedUrls.length || requestedUrls.length > MAX_FILES || requestedUrls.some((url) => !isAllowedAssetUrl(url))) {
    return NextResponse.json({ error: 'Invalid asset url.' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const urls = requestedUrls.slice(0, MAX_FILES);
  const names = sp.getAll('n');

  // Single asset — stream it straight back.
  if (urls.length === 1) {
    let asset;
    try {
      asset = await fetchAsset(urls[0]);
    } catch (err) {
      return NextResponse.json({ error: err.message || 'Could not fetch the asset.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
    }
    return new Response(asset.buf, {
      status: 200,
      headers: {
        'content-type': asset.contentType,
        'content-disposition': `attachment; filename="${safeName(names[0], 'deliverable')}"`,
        'cache-control': 'no-store',
      },
    });
  }

  // Multiple assets — bundle into a zip (server-side fetch is not CORS-bound).
  const zip = new JSZip();
  const used = new Set();
  let added = 0;
  let totalBytes = 0;
  for (const [i, url] of urls.entries()) {
    try {
      const { buf } = await fetchAsset(url);
      totalBytes += buf.length;
      if (totalBytes > MAX_ZIP_INPUT_BYTES) {
        return NextResponse.json({ error: 'Deliverable bundle is too large.' }, { status: 413, headers: { 'cache-control': 'no-store' } });
      }
      let name = safeName(names[i], `asset-${i + 1}`);
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        name = dot > 0 ? `${name.slice(0, dot)}-${i + 1}${name.slice(dot)}` : `${name}-${i + 1}`;
      }
      used.add(name);
      zip.file(name, buf);
      added += 1;
    } catch {
      // Skip an asset that fails; the rest still bundle.
    }
  }
  if (!added) {
    return NextResponse.json({ error: 'Could not fetch any assets.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new Response(zipBuffer, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safeName(sp.get('zn'), 'deliverables')}.zip"`,
      'cache-control': 'no-store',
    },
  });
}
