// Lead Gen — Asset Manager
// Downloads images to clients/{slug}/assets/, converts large files to WebP,
// and handles GBP photo fallback when the scraped site has no usable images.
// Server-only. Requires: sharp, fs/promises, path.

import { mkdir, writeFile } from 'fs/promises';
import { existsSync }       from 'fs';
import path                 from 'path';
import { ensureClientFolder, assetsDir as clientAssetsDir, clientRoot } from './client-folder.js';

// On Vercel, only /tmp is writable; local dev uses cwd/clients.
const CLIENTS_ROOT  = process.env.VERCEL
  ? '/tmp/clients'
  : path.join(process.cwd(), 'clients');
const FETCH_TIMEOUT = 12_000;
const MIN_BYTES     = 2_000;   // skip tiny icons / spacers
const MAX_BYTES     = 5_000_000; // don't download files > 5MB
const WEBP_THRESHOLD = 300_000;  // convert to WebP if > 300KB

// ─── SLUG ────────────────────────────────────────────────────────────────────

export function makeClientSlug(prospect) {
  const name = (prospect.name || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const id = String(prospect.placeId || '').slice(4, 12).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${name}-${id}`;
}

// ─── DIRECTORY SETUP ─────────────────────────────────────────────────────────

export async function ensureClientDir(slug) {
  await ensureClientFolder(slug);
  return { clientDir: clientRoot(slug), assetsDir: clientAssetsDir(slug) };
}

export function clientDir(slug) {
  return clientRoot(slug);
}

// ─── IMAGE DOWNLOAD ──────────────────────────────────────────────────────────

async function fetchImageBuffer(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BballiBot/1.0)' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BYTES) throw new Error('File too large');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength < MIN_BYTES) throw new Error('File too small (likely icon)');
    return { buffer, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

function safeFilename(url, prefix, ext) {
  const urlObj = new URL(url);
  const base   = path.basename(urlObj.pathname).replace(/[^a-z0-9._-]/gi, '-').slice(0, 40);
  const name   = base || `${prefix}-${Date.now()}`;
  return ext ? name.replace(/\.[^.]+$/, '') + '.' + ext : name;
}

async function saveImage(buffer, contentType, destDir, filename) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // sharp unavailable in this context — save as-is
    const dest = path.join(destDir, filename);
    await writeFile(dest, buffer);
    return filename;
  }

  const isWebpAlready = contentType.includes('webp') || filename.endsWith('.webp');

  if (!isWebpAlready && buffer.byteLength > WEBP_THRESHOLD) {
    const webpName = filename.replace(/\.[^.]+$/, '') + '.webp';
    const dest = path.join(destDir, webpName);
    await sharp(buffer).webp({ quality: 82 }).toFile(dest);
    return webpName;
  }

  const dest = path.join(destDir, filename);
  await writeFile(dest, buffer);
  return filename;
}

// ─── DOWNLOAD ALL ASSETS ─────────────────────────────────────────────────────

// assetInventory shape (from content-scraper):
// { logo: {url,alt}, heroImages:[{url,alt}], sectionImages:[{url,alt,section}],
//   teamPhotos:[{url,alt}], galleryImages:[{url,alt}], ogImage: string|null }
export async function downloadAssets(slug, assetInventory) {
  const { assetsDir } = await ensureClientDir(slug);
  const manifest = { logo: null, heroImages: [], sectionImages: [], teamPhotos: [], galleryImages: [], ogImage: null };

  async function dl(url, prefix, refObj) {
    if (!url) return null;
    try {
      const { buffer, contentType } = await fetchImageBuffer(url);
      const rawName = safeFilename(url, prefix, null);
      const saved   = await saveImage(buffer, contentType, assetsDir, rawName);
      return { ...refObj, localPath: `assets/${saved}`, filename: saved };
    } catch (err) {
      return { ...refObj, localPath: null, downloadError: err.message };
    }
  }

  // Logo
  if (assetInventory.logo?.url) {
    manifest.logo = await dl(assetInventory.logo.url, 'logo', assetInventory.logo);
    // Rename saved file to logo.{ext} for clarity
    if (manifest.logo?.filename) {
      const ext  = path.extname(manifest.logo.filename) || '.png';
      const dest = path.join(assetsDir, `logo${ext}`);
      if (!existsSync(dest)) {
        const src = path.join(assetsDir, manifest.logo.filename);
        try {
          const { renameSync } = await import('fs');
          renameSync(src, dest);
          manifest.logo.filename  = `logo${ext}`;
          manifest.logo.localPath = `assets/logo${ext}`;
        } catch { /* rename failed — keep original name */ }
      }
    }
  }

  // Hero images (up to 3)
  for (const img of (assetInventory.heroImages || []).slice(0, 3)) {
    const result = await dl(img.url, 'hero', img);
    if (result) manifest.heroImages.push(result);
  }

  // Section images (up to 8)
  for (const img of (assetInventory.sectionImages || []).slice(0, 8)) {
    const result = await dl(img.url, 'section', img);
    if (result) manifest.sectionImages.push(result);
  }

  // Team photos (up to 6)
  for (const img of (assetInventory.teamPhotos || []).slice(0, 6)) {
    const result = await dl(img.url, 'team', img);
    if (result) manifest.teamPhotos.push(result);
  }

  // OG image
  if (assetInventory.ogImage) {
    manifest.ogImage = await dl(assetInventory.ogImage, 'og', { url: assetInventory.ogImage });
  }

  return manifest;
}

// ─── GBP PHOTO FALLBACK ───────────────────────────────────────────────────────
// Used when the scraped site has no hero/section images.
// Requires GOOGLE_PLACES_API_KEY env var.

export async function fetchGbpPhotos(placeId, { maxPhotos = 5, slug } = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !placeId) return [];

  try {
    // Get photo references from Places Details
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=photos&key=${apiKey}`;
    const res  = await fetch(detailsUrl);
    const data = await res.json();
    const refs = (data?.result?.photos || []).slice(0, maxPhotos).map(p => p.photo_reference);
    if (!refs.length) return [];

    const { assetsDir } = await ensureClientDir(slug);
    const saved = [];

    for (let i = 0; i < refs.length; i++) {
      const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${refs[i]}&key=${apiKey}`;
      try {
        const { buffer, contentType } = await fetchImageBuffer(photoUrl);
        const filename = await saveImage(buffer, contentType, assetsDir, `gbp-${i + 1}.jpg`);
        saved.push({ localPath: `assets/${filename}`, filename, source: 'gbp' });
      } catch { /* skip individual photo failures */ }
    }

    return saved;
  } catch {
    return [];
  }
}

// ─── ASSET MANIFEST BUILDER (no download — just URL → targetFile planning) ───

function extFromUrl(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase().slice(0, 5);
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext) ? ext : '.jpg';
  } catch { return '.jpg'; }
}

export function buildAssetManifest(assets) {
  const manifest = { logo: null, heroImages: [], sectionImages: [], teamPhotos: [], ogImage: null };

  if (assets.logo?.url) {
    const ext = extFromUrl(assets.logo.url);
    manifest.logo = { ...assets.logo, targetFile: `assets/logo${ext}`, localPath: `assets/logo${ext}` };
  }

  (assets.heroImages || []).slice(0, 3).forEach((img, i) => {
    const ext = extFromUrl(img.url);
    manifest.heroImages.push({ ...img, targetFile: `assets/hero-${i + 1}${ext}`, localPath: `assets/hero-${i + 1}${ext}` });
  });

  (assets.sectionImages || []).slice(0, 5).forEach((img, i) => {
    const ext = extFromUrl(img.url);
    manifest.sectionImages.push({ ...img, targetFile: `assets/section-${i + 1}${ext}`, localPath: `assets/section-${i + 1}${ext}` });
  });

  (assets.teamPhotos || []).slice(0, 4).forEach((img, i) => {
    const ext = extFromUrl(img.url);
    manifest.teamPhotos.push({ ...img, targetFile: `assets/team-${i + 1}${ext}`, localPath: `assets/team-${i + 1}${ext}` });
  });

  if (assets.ogImage) {
    const ext = extFromUrl(assets.ogImage);
    manifest.ogImage = { url: assets.ogImage, targetFile: `assets/og-image${ext}`, localPath: `assets/og-image${ext}` };
  }

  return manifest;
}

// ─── GBP PHOTO URLS (no download — returns Places API photo URLs) ─────────────

export async function getGbpPhotoUrls(placeId, { maxPhotos = 3 } = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !placeId) return [];
  try {
    const res  = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=photos&key=${apiKey}`);
    const data = await res.json();
    const refs = (data?.result?.photos || []).slice(0, maxPhotos).map(p => p.photo_reference);
    return refs.map(ref => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${encodeURIComponent(ref)}&key=${apiKey}`);
  } catch { return []; }
}

// ─── DOWNLOAD ASSETS TO BUFFERS (for Vercel deploy bundling) ─────────────────
// Returns [{ targetFile, buffer, contentType }] — failed downloads are skipped.

export async function downloadAssetsToBuffers(manifest) {
  if (!manifest) return [];

  const entries = [
    manifest.logo        ? { item: manifest.logo }                              : null,
    ...(manifest.heroImages    || []).map(img => ({ item: img })),
    ...(manifest.sectionImages || []).slice(0, 4).map(img => ({ item: img })),
    ...(manifest.teamPhotos    || []).slice(0, 3).map(img => ({ item: img })),
  ].filter(e => e?.item?.url && e?.item?.targetFile);

  const results = await Promise.allSettled(
    entries.map(async ({ item }) => {
      const { buffer, contentType } = await fetchImageBuffer(item.url);

      let finalBuffer  = buffer;
      let finalFile    = item.targetFile;

      if (buffer.byteLength > WEBP_THRESHOLD && !item.targetFile.endsWith('.svg')) {
        try {
          const sharp = (await import('sharp')).default;
          finalBuffer = await sharp(buffer).webp({ quality: 82 }).toBuffer();
          finalFile   = item.targetFile.replace(/\.[^.]+$/, '.webp');
        } catch { /* sharp unavailable — keep original */ }
      }

      return { targetFile: finalFile, buffer: finalBuffer, contentType };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

// ─── ASSET MANIFEST FROM DISK ────────────────────────────────────────────────

export async function listDownloadedAssets(slug) {
  const assetsDir = path.join(CLIENTS_ROOT, slug, 'assets');
  try {
    const { readdir } = await import('fs/promises');
    const files = await readdir(assetsDir);
    return files.filter(f => /\.(jpg|jpeg|png|webp|svg|gif)$/i.test(f));
  } catch {
    return [];
  }
}
