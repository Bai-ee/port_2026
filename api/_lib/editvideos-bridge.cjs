'use strict';

// editvideos-bridge.cjs — cross-project bridge into the LIVE EditVideos render
// pipeline (Firebase project editvideos-63486).
//
// Hitloop does NOT run FFmpeg. It enqueues a `videoJobs/{jobId}` doc into the
// EditVideos Firebase using that project's EXACT existing schema; the already
// deployed EditVideos GitHub Action (cron */1) claims, renders with the proven
// ArweaveVideoGenerator engine, uploads the MP4, and writes back
// status:'completed' + videoUrl. Hitloop only reads that result and reconciles
// it into dashboard_state.mediaCaptures.
//
// This module lazily inits a SECOND, NAMED firebase-admin app ('editvideos') so
// it never collides with Hitloop's default app (api/_lib/firebase-admin.cjs).
// Write intent is limited to `videoJobs` docs; everything else is read-only.
//
// Source schema: /Users/bballi/.../EditVideos/arweave-video-generator/api/generate-video.js
// Parser mirror: /Users/bballi/.../EditVideos/arweave-video-generator/worker/firebase-admin.js

const { randomUUID } = require('crypto');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const APP_NAME = 'editvideos';
const JOBS_COLLECTION = 'videoJobs';
const FOLDER_CACHE_TTL_MS = 60 * 1000;
const SIGNED_UPLOAD_TTL_MS = 15 * 60 * 1000;
const SIGNED_READ_TTL_MS = 60 * 60 * 1000;
const FOLDER_MEDIA_CACHE_TTL_MS = 2 * 60 * 1000;
const CORS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_UPLOAD_FILES = 25;
const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 50 * 1024 * 1024;

// Folders that are never valid source folders for a remix (case-insensitive).
const EXCLUDED_FOLDERS = ['logos', 'paper_backgrounds', 'mixes', 'videos'];
const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
const ORIENTATIONS = new Set(['auto', 'square', 'portrait', 'landscape']);
const DEFAULT_UPLOAD_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://hitloop.agency',
  'https://www.hitloop.agency',
];

// --- credential parsing (mirror EditVideos worker/firebase-admin.js exactly) ---
function parseServiceAccount() {
  const rawEnv = process.env.EDITVIDEOS_FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!rawEnv) throw new Error('EditVideos bridge not configured');
  let raw = rawEnv.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  raw = raw.replace(/\n/g, '\\n');
  // Tolerate a stray trailing literal `\n` that some env-paste flows append
  // after the closing brace (Vercel stores the clean value; .env.local may not).
  raw = raw.replace(/\\n\s*$/, '');
  return JSON.parse(raw);
}

// --- lazy named-app init ----------------------------------------------------
let _app = null;
let _db = null;
let _storage = null;

function bridgeApp() {
  if (_app) return _app;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) {
    _app = existing;
    return _app;
  }
  const serviceAccount = parseServiceAccount();
  const storageBucket = process.env.EDITVIDEOS_FIREBASE_BUCKET;
  _app = initializeApp(
    {
      credential: cert(serviceAccount),
      storageBucket,
    },
    APP_NAME
  );
  return _app;
}

function bridgeDb() {
  if (!_db) _db = getFirestore(bridgeApp());
  return _db;
}

function bridgeBucket() {
  if (!_storage) _storage = getStorage(bridgeApp());
  return _storage.bucket();
}

// --- pure mapping (firebase-free, unit-testable) ----------------------------
/**
 * Map a validated Hitloop remix recipe → an EditVideos videoJobs doc body.
 * Pure: no firebase, no serverTimestamp (createdAt is left for the writer to
 * stamp). Throws on an empty selectedFolders — the EditVideos worker requires
 * at least one real folder.
 *
 * Source schema fields: see EditVideos api/generate-video.js (jobData).
 */
function mapRecipeToVideoJob(recipe = {}, { jobId } = {}) {
  const selectedFolders = Array.isArray(recipe.sourceFolders)
    ? recipe.sourceFolders.map((f) => String(f)).filter(Boolean)
    : [];
  if (selectedFolders.length === 0) {
    throw new Error('mapRecipeToVideoJob: selectedFolders must be non-empty.');
  }

  const mixTitle = recipe.mixTitle ? String(recipe.mixTitle) : 'Hitloop Video Remix';
  const rawIntensity = recipe.filter?.intensity != null
    ? Number(recipe.filter.intensity)
    : 0.8;
  const filterIntensity = Math.min(1, Math.max(0, Number.isFinite(rawIntensity) ? rawIntensity : 0.8));

  return {
    jobId,
    status: 'pending',
    // artist:null is valid → the EditVideos worker uses random Arweave audio.
    artist: recipe.artist ? String(recipe.artist) : null,
    mixTitle,
    duration: 30,
    videoFilter: recipe.filter?.key ? String(recipe.filter.key) : null,
    filterIntensity,
    useTrax: !!recipe.useTrax,
    selectedFolders,
    enableOverlay: !!recipe.overlay?.enabled,
    overlayEffect: recipe.overlay?.enabled && recipe.overlay?.effect
      ? String(recipe.overlay.effect)
      : null,
    topLogo: recipe.logos?.top ? String(recipe.logos.top) : null,
    endLogo: recipe.logos?.end ? String(recipe.logos.end) : null,
    // Optional Underground-Existence artist thumbnail end-card.
    useArtistImage: !!recipe.useArtistImage,
    customEndMedia: null,
    endTextOverlay: recipe.endCard?.text ? String(recipe.endCard.text) : null,
    videoOrder: Array.isArray(recipe.videoOrder)
      ? recipe.videoOrder.map((item, index) => ({
        segmentIndex: Number.isFinite(Number(item?.segmentIndex)) ? Number(item.segmentIndex) : index,
        videoName: String(item?.videoName || ''),
      }))
      : null,
    completedAt: null,
    videoUrl: null,
    error: null,
    metadata: {
      fileName: null,
      fileSize: null,
      mixTitle,
    },
  };
}

// --- options discovery (filters/overlays static, artists/logos live) --------
const FILTER_OPTIONS = [
  { key: 'look_hard_bw_street_doc', label: 'Hard B&W Street Doc' },
  { key: 'look_gritty_neon_club', label: 'Gritty Neon Club' },
  { key: 'look_faded_90s_tape', label: 'Faded 90s Tape' },
  { key: 'look_camcorder_ghost', label: 'Camcorder Ghost' },
  { key: 'look_club_cinematic_dirty', label: 'Club Cinematic Dirty' },
  { key: 'look_neon_nightclub', label: 'Neon Nightclub' },
  { key: 'look_zine_posterized_color', label: 'Zine Posterized Color' },
  { key: 'look_pixel_grit_vertical', label: 'Pixel Grit' },
  { key: 'look_sodium_streetlight', label: 'Sodium Streetlight' },
];

const OVERLAY_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'analog_film', label: 'Analog Film' },
  { value: 'gritt', label: 'Gritt' },
  { value: 'noise', label: 'Noise' },
  { value: 'retro_dust', label: 'Retro Dust' },
  { value: 'random', label: 'Random' },
];

const OPTIONS_CACHE_TTL_MS = 60 * 1000;
let _optionsCache = { at: 0, options: null };

/**
 * Read available artists + their mix titles from the EditVideos Firebase.
 * Mirrors EditVideos api/artists.js: system/artists doc, data.artists array of
 * { artistName, mixes:[{ mixTitle, mixArweaveURL, ... }] }. Degrades to [].
 * @returns {Promise<Array<{name:string, mixes:string[]}>>}
 */
async function listArtists() {
  try {
    const snap = await bridgeDb().collection('system').doc('artists').get();
    if (!snap.exists) return [];
    const data = snap.data() || {};
    if (!Array.isArray(data.artists)) return [];
    return data.artists
      .filter((a) => a && a.artistName)
      .map((a) => ({
        name: String(a.artistName),
        mixes: Array.isArray(a.mixes)
          ? a.mixes.map((m) => (m && m.mixTitle ? String(m.mixTitle) : null)).filter(Boolean)
          : [],
      }));
  } catch {
    return [];
  }
}

/**
 * List logo filenames from the EditVideos bucket `logos/` folder. Returns png/jpg
 * basenames only (excludes serial_logo.png and svgs). Degrades to [].
 * @returns {Promise<string[]>}
 */
async function listLogos() {
  try {
    const [files] = await bridgeBucket().getFiles({ prefix: 'logos/' });
    const names = new Set();
    for (const file of files) {
      const base = String(file.name).split('/').pop();
      if (!base) continue;
      const lower = base.toLowerCase();
      if (lower === 'serial_logo.png') continue;
      if (lower.endsWith('.svg')) continue;
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
        names.add(base);
      }
    }
    return Array.from(names);
  } catch {
    return [];
  }
}

/**
 * Build the full options payload for the Video Remix params tab. Filters/overlays
 * are static; artists + logos are read live (degrade to []). Cached ~60s.
 * @returns {Promise<{filters:Array, overlays:Array, artists:Array, logos:string[]}>}
 */
async function listOptions() {
  const now = Date.now();
  if (_optionsCache.options && now - _optionsCache.at < OPTIONS_CACHE_TTL_MS) {
    return _optionsCache.options;
  }
  const [artists, logos] = await Promise.all([listArtists(), listLogos()]);
  const options = {
    filters: FILTER_OPTIONS,
    overlays: OVERLAY_OPTIONS,
    artists,
    logos,
  };
  _optionsCache = { at: now, options };
  return options;
}

// --- enqueue ----------------------------------------------------------------
/**
 * Enqueue a render into the live EditVideos pipeline.
 * @param {object} recipe  a validated Hitloop remix recipe
 * @returns {Promise<{ editJobId: string }>}
 */
async function enqueueVideoJob(recipe) {
  const editJobId = randomUUID();
  const body = mapRecipeToVideoJob(recipe, { jobId: editJobId });
  body.createdAt = FieldValue.serverTimestamp();
  await bridgeDb().collection(JOBS_COLLECTION).doc(editJobId).set(body);
  return { editJobId };
}

/**
 * Fire the EditVideos GitHub Action immediately via repository_dispatch — the
 * same trigger EditVideos' own generate-video API uses. Without this, a queued
 * videoJobs doc only renders when GitHub's scheduled cron fires, which is heavily
 * throttled on free tier (observed 90+ min stale). Fire-and-forget; best-effort.
 * @returns {Promise<{triggered:boolean, status?:number, reason?:string}>}
 */
async function triggerWorker() {
  const token = process.env.EDITVIDEOS_GITHUB_TOKEN;
  const repo = process.env.EDITVIDEOS_GITHUB_REPO;
  if (!token || !repo) return { triggered: false, reason: 'github dispatch not configured' };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'process-video-job' }),
    });
    return { triggered: res.status === 204, status: res.status };
  } catch (err) {
    return { triggered: false, reason: err?.message || 'dispatch failed' };
  }
}

// --- read result ------------------------------------------------------------
/**
 * Read the completion-relevant fields of a videoJobs doc.
 * @returns {Promise<{status,videoUrl,error,completedAt}|null>}
 */
async function getVideoJob(editJobId) {
  if (!editJobId) return null;
  const snap = await bridgeDb().collection(JOBS_COLLECTION).doc(String(editJobId)).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    status: data.status || null,
    videoUrl: data.videoUrl || null,
    error: data.error || null,
    completedAt: data.completedAt || null,
  };
}

// --- folder discovery (mirror EditVideos api/video-folders.js) ---------------
let _folderCache = { at: 0, folders: null };
let _folderDetailsCache = { at: 0, folders: null };
let _folderMediaCache = new Map();
let _corsCache = { at: 0, ok: false };

function isExcludedFolder(folderName) {
  const lower = String(folderName).toLowerCase();
  if (EXCLUDED_FOLDERS.includes(lower)) return true;
  if (lower === 'mixes/baiee' || lower === 'mixes/bai-ee') return true;
  if (lower.includes('/baiee') || lower.includes('/bai-ee')) {
    // Allow nested retro/noise/grit folders even under baiee paths.
    if (!lower.includes('retro') && !lower.includes('noise') && !lower.includes('grit')) {
      return true;
    }
  }
  return false;
}

function invalidateFolderCache() {
  _folderCache = { at: 0, folders: null };
  _folderDetailsCache = { at: 0, folders: null };
  _folderMediaCache = new Map();
}

function displayNameForFolder(folderName) {
  return String(folderName)
    .split('/')
    .pop()
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isMediaFilePath(fileName) {
  const lower = String(fileName || '').toLowerCase();
  const ext = lower.split('.').pop();
  return VIDEO_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

function sanitizeExistingFolderPath(name) {
  if (typeof name !== 'string') throw new Error('Folder name must be a string.');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name must not be empty.');
  if (trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Folder name has an invalid path.');
  }
  const parts = trimmed.split('/');
  if (parts.length > 2 || parts.some((part) => !/^[A-Za-z0-9_-]{1,120}$/.test(part))) {
    throw new Error('Folder name has invalid characters.');
  }
  if (isExcludedFolder(trimmed)) throw new Error('Folder is not available for remix source media.');
  return trimmed;
}

function sanitizeNewFolderName(name) {
  if (typeof name !== 'string') throw new Error('New folder name must be a string.');
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!safe) throw new Error('New folder name must include letters or numbers.');
  if (isExcludedFolder(safe)) throw new Error('That folder name is reserved.');
  return safe;
}

function sanitizeUploadFile(file, index) {
  if (!file || typeof file !== 'object') throw new Error('Each upload file must be an object.');
  const originalName = String(file.name || '').trim();
  if (!originalName) throw new Error('Upload file name is required.');
  const contentType = String(file.type || 'application/octet-stream').trim().slice(0, 120);
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) throw new Error(`Upload file has invalid size: ${originalName}`);

  const ext = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : '';
  const isVideo = VIDEO_EXTENSIONS.has(ext);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  if (!isVideo && !isImage) throw new Error(`Unsupported media type: ${originalName}`);
  const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES;
  if (size > maxBytes) {
    const limitMb = isVideo ? 500 : 50;
    throw new Error(`${originalName} is larger than the ${limitMb}MB upload limit.`);
  }

  const base = originalName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'media';
  return {
    originalName,
    contentType,
    size,
    kind: isVideo ? 'video' : 'image',
    safeName: `user_upload_${Date.now()}_${index}_${base}.${ext}`,
  };
}

function uploadCorsOrigins() {
  const configured = String(process.env.EDITVIDEOS_UPLOAD_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').trim().replace(/\/$/, '');
  return Array.from(new Set([...DEFAULT_UPLOAD_CORS_ORIGINS, siteUrl, vercelUrl, ...configured].filter(Boolean)));
}

function corsRuleCovers(rule, origins) {
  const ruleOrigins = Array.isArray(rule?.origin) ? rule.origin : [];
  const methods = Array.isArray(rule?.method) ? rule.method.map((m) => String(m).toUpperCase()) : [];
  const headers = Array.isArray(rule?.responseHeader) ? rule.responseHeader.map((h) => String(h).toLowerCase()) : [];
  return origins.every((origin) => ruleOrigins.includes(origin) || ruleOrigins.includes('*'))
    && ['OPTIONS', 'PUT', 'GET', 'HEAD'].every((method) => methods.includes(method))
    && ['content-type', 'x-goog-resumable'].every((header) => headers.includes(header));
}

async function ensureUploadCors() {
  const now = Date.now();
  if (_corsCache.ok && now - _corsCache.at < CORS_CACHE_TTL_MS) return;

  const bucket = bridgeBucket();
  const origins = uploadCorsOrigins();
  const desiredRule = {
    origin: origins,
    method: ['OPTIONS', 'PUT', 'GET', 'HEAD'],
    responseHeader: ['Content-Type', 'Content-Length', 'x-goog-resumable'],
    maxAgeSeconds: 3600,
  };

  const [metadata] = await bucket.getMetadata();
  const currentCors = Array.isArray(metadata?.cors) ? metadata.cors : [];
  if (!currentCors.some((rule) => corsRuleCovers(rule, origins))) {
    await bucket.setMetadata({ cors: [...currentCors, desiredRule] });
  }
  _corsCache = { at: now, ok: true };
}

async function discoverSourceFolderDetails() {
  const now = Date.now();
  if (_folderDetailsCache.folders && now - _folderDetailsCache.at < FOLDER_CACHE_TTL_MS) {
    return _folderDetailsCache.folders;
  }

  const [files] = await bridgeBucket().getFiles();
  const folders = new Map();

  for (const file of files) {
    if (file.name.endsWith('.keep')) continue;
    const parts = file.name.split('/');
    const candidates = [];
    if (parts.length > 1 && !parts[0].startsWith('.')) candidates.push(parts[0]);
    if (parts.length > 2) {
      const nested = `${parts[0]}/${parts[1]}`;
      if (!nested.includes('.')) candidates.push(nested);
    }
    for (const folder of candidates) {
      if (isExcludedFolder(folder)) continue;
      const current = folders.get(folder) || {
        name: folder,
        displayName: displayNameForFolder(folder),
        count: 0,
        type: folder.includes('/') ? 'nested' : 'root',
      };
      if (isMediaFilePath(file.name)) current.count += 1;
      folders.set(folder, current);
    }
  }

  const result = Array.from(folders.values()).sort((a, b) => a.name.localeCompare(b.name));
  _folderDetailsCache = { at: now, folders: result };
  _folderCache = { at: now, folders: result.map((folder) => folder.name) };
  return result;
}

/**
 * List real EditVideos source folder names. Cached in-module for ~60s so the
 * dashboard does not trigger a full bucket scan on every load.
 * @returns {Promise<string[]>}
 */
async function listSourceFolders() {
  const folders = await discoverSourceFolderDetails();
  return folders.map((folder) => folder.name);
}

async function listSourceFoldersWithCounts() {
  return discoverSourceFolderDetails();
}

async function listFolderMedia(folderName, { limit = 60 } = {}) {
  const folder = sanitizeExistingFolderPath(folderName);
  const safeLimit = Math.max(1, Math.min(120, Number(limit) || 60));
  const cacheKey = `${folder}:${safeLimit}`;
  const cached = _folderMediaCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FOLDER_MEDIA_CACHE_TTL_MS) {
    return cached.result;
  }
  const [files] = await bridgeBucket().getFiles({ prefix: `${folder}/` });
  const mediaFiles = files
    .filter((file) => isMediaFilePath(file.name))
    .slice(0, safeLimit);

  const items = await Promise.all(mediaFiles.map(async (file) => {
    let readUrl = null;
    try {
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_READ_TTL_MS,
      });
      readUrl = url;
    } catch {
      readUrl = null;
    }
    const metadata = file.metadata || {};
    const name = String(file.name).split('/').pop();
    const contentType = metadata.contentType || '';
    const ext = name.toLowerCase().split('.').pop();
    return {
      name,
      fullPath: file.name,
      size: Number(metadata.size || 0),
      contentType,
      kind: VIDEO_EXTENSIONS.has(ext) || contentType.startsWith('video/') ? 'video' : 'image',
      updated: metadata.updated || null,
      url: readUrl,
    };
  }));

  const result = { folder, files: items };
  _folderMediaCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

async function createUploadSession({ folderMode = 'existing', folderName, files = [], orientation = 'auto' } = {}) {
  const mode = folderMode === 'new' ? 'new' : 'existing';
  const targetFolder = mode === 'new'
    ? sanitizeNewFolderName(folderName)
    : sanitizeExistingFolderPath(folderName);
  const safeOrientation = ORIENTATIONS.has(String(orientation)) ? String(orientation) : 'auto';
  if (!Array.isArray(files) || files.length === 0) throw new Error('At least one file is required.');
  if (files.length > MAX_UPLOAD_FILES) throw new Error(`Upload at most ${MAX_UPLOAD_FILES} files at a time.`);

  try {
    await ensureUploadCors();
  } catch (err) {
    throw new Error(`Could not configure EditVideos upload CORS: ${err?.message || err}`);
  }

  const sessionId = randomUUID();
  const prepared = files.map((file, index) => sanitizeUploadFile(file, index));
  const uploads = await Promise.all(prepared.map(async (file) => {
    const storagePath = `${targetFolder}/${file.safeName}`;
    const bucketFile = bridgeBucket().file(storagePath);
    const [uploadUrl] = await bucketFile.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + SIGNED_UPLOAD_TTL_MS,
      contentType: file.contentType,
    });
    return {
      id: randomUUID(),
      originalName: file.originalName,
      safeName: file.safeName,
      storagePath,
      contentType: file.contentType,
      size: file.size,
      kind: file.kind,
      uploadUrl,
      method: 'PUT',
      headers: { 'content-type': file.contentType },
    };
  }));

  return {
    sessionId,
    folder: targetFolder,
    folderMode: mode,
    orientation: safeOrientation,
    expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_MS).toISOString(),
    uploads,
  };
}

// ===========================================================================
// Archive / Publishing bridge — archive-publishing card (Knowledge Officer).
//
// HITLOOP does NOT run Arweave/Turbo uploads or website deploys itself. The
// EditVideos deployed app owns those wallet-funded, irreversible operations:
//   POST {EDITVIDEOS_API_BASE}/api/archive-upload   → archive one Firebase file
//   GET  {EDITVIDEOS_API_BASE}/api/deploy-website    → estimate deploy diff
//   POST {EDITVIDEOS_API_BASE}/api/deploy-website    → deploy site (+ ArNS)
// HITLOOP reads the EditVideos `archiveManifest`/`archiveJobs` Firestore docs
// directly through the named bridge app (read-only), and calls the HTTP
// endpoints for the actual mutations. Every mutation is admin-gated in the
// route; this module only carries metadata + status + cost. See
// docs/plans/ARCHIVE_PUBLISHING_CARD_PLAN.md.
// ===========================================================================

const ARCHIVE_MANIFEST_COLLECTION = 'archiveManifest';
const ARCHIVE_MANIFEST_DOC = 'main';
const ARCHIVE_JOBS_COLLECTION = 'archiveJobs';

// Mirror EditVideos lib/ArweaveCostCalculator.js base rates so HITLOOP estimates
// match what the deployed app charges. AR price is fetched live (CoinGecko) with
// a $10/AR fallback, exactly like the EditVideos calculator.
const BYTES_PER_MB = 1024 * 1024;
const COST_PER_MB_AR = 0.0001;
const COST_PER_MB_USD = 0.10;
const AR_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
let _arPriceCache = { at: 0, price: null };

function editvideosApiBase() {
  const base = String(process.env.EDITVIDEOS_API_BASE || '').trim().replace(/\/$/, '');
  return base || null;
}

// --- pure cost math (firebase-free, unit-testable) --------------------------
/**
 * Cost breakdown for a single byte count. Pure — pass arPriceUSD explicitly.
 * Shape mirrors EditVideos calculateCost().
 */
function costForBytes(fileSizeBytes, arPriceUSD = 10) {
  const bytes = Math.max(0, Number(fileSizeBytes) || 0);
  const price = Number(arPriceUSD) > 0 ? Number(arPriceUSD) : 10;
  const sizeMB = bytes / BYTES_PER_MB;
  const costAR = sizeMB * COST_PER_MB_AR;
  const costUSD = costAR * price;
  return {
    sizeBytes: bytes,
    sizeMB: Number(sizeMB.toFixed(4)),
    sizeKB: Number((bytes / 1024).toFixed(2)),
    costAR: Number(costAR.toFixed(8)),
    costUSD: Number(costUSD.toFixed(4)),
    costUSDApprox: Number((sizeMB * COST_PER_MB_USD).toFixed(4)),
    arPriceUSD: Number(price.toFixed(2)),
  };
}

/**
 * Total cost for an array of files (each {sizeBytes|size|fileSize}). Pure.
 * @returns {{fileCount, sizeBytes, costAR, costUSD, costUSDApprox, arPriceUSD, estimatedAt:null}}
 */
function summarizeArchiveCost(files = [], arPriceUSD = 10) {
  const list = Array.isArray(files) ? files : [];
  const totalBytes = list.reduce((sum, f) => {
    const b = Number(f?.sizeBytes ?? f?.size ?? f?.fileSize) || 0;
    return sum + Math.max(0, b);
  }, 0);
  const breakdown = costForBytes(totalBytes, arPriceUSD);
  return {
    fileCount: list.length,
    sizeBytes: breakdown.sizeBytes,
    costAR: breakdown.costAR,
    costUSD: breakdown.costUSD,
    costUSDApprox: breakdown.costUSDApprox,
    arPriceUSD: breakdown.arPriceUSD,
    estimatedAt: null,
  };
}

// --- pure manifest normalization (firebase-free, unit-testable) -------------
/**
 * Normalize the EditVideos archiveManifest doc into a flat, render-ready shape.
 * Always returns { source:'editvideos', version, lastUpdated, folders, entries }.
 * `entries` is a flat array with the fields the Manifest tab renders.
 */
function normalizeArchiveManifest(raw = {}) {
  const foldersRaw = raw && typeof raw.folders === 'object' && raw.folders ? raw.folders : {};
  const entries = [];
  const folders = {};
  for (const folderName of Object.keys(foldersRaw)) {
    const files = Array.isArray(foldersRaw[folderName]?.files) ? foldersRaw[folderName].files : [];
    const normFiles = files.map((f) => {
      const entry = {
        label: String(f?.name || f?.label || 'file'),
        folder: folderName,
        sourcePath: String(f?.firebasePath || f?.sourcePath || `${folderName}/${f?.name || ''}`),
        transactionId: f?.transactionId || null,
        arweaveUrl: f?.arweaveUrl || (f?.transactionId ? `https://arweave.net/${f.transactionId}` : null),
        turboUrl: f?.turboUrl || null,
        fileSize: Number(f?.fileSize ?? f?.size) || null,
        contentType: f?.contentType || null,
        status: f?.status || (f?.transactionId ? 'confirmed' : 'unknown'),
        archivedAt: f?.archivedAt || null,
      };
      entries.push(entry);
      return entry;
    });
    folders[folderName] = { files: normFiles };
  }
  entries.sort((a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')));
  return {
    source: 'editvideos',
    version: raw?.version || '1.0.0',
    lastUpdated: raw?.lastUpdated || null,
    folders,
    entries,
  };
}

/**
 * Normalize selectable archive sources from dashboard captures + folder files
 * into a single typed list of file rows for the Archive tab. Pure.
 * @param {{mediaCaptures?:Array, studioCaptures?:Array, folderFiles?:{folder?:string,files?:Array}}} args
 */
function normalizeArchiveSources({ mediaCaptures = [], studioCaptures = [], folderFiles = null } = {}) {
  const rows = [];
  const remixes = Array.isArray(mediaCaptures) ? mediaCaptures : [];
  for (const cap of remixes) {
    if (!cap || cap.type !== 'video_remix') continue;
    rows.push({
      source: 'mediaCaptures',
      sourceLabel: 'Finished Videos',
      label: cap.label || 'Video remix',
      fileName: cap.fileName || `${cap.jobId || 'remix'}.mp4`,
      url: cap.downloadUrl || cap.url || null,
      storagePath: cap.storagePath || null,
      folder: cap.storageFolder || null,
      contentType: cap.contentType || 'video/mp4',
      sizeBytes: Number(cap.fileSize ?? cap.sizeBytes) || null,
      sourceCaptureJobId: cap.jobId || null,
      arweave: cap.arweave || null,
    });
  }
  const studio = Array.isArray(studioCaptures) ? studioCaptures : [];
  for (const cap of studio) {
    if (!cap) continue;
    rows.push({
      source: 'studioCaptures',
      sourceLabel: 'Studio Captures',
      label: cap.label || 'Studio capture',
      fileName: cap.fileName || `${cap.jobId || 'studio'}.mp4`,
      url: cap.downloadUrl || cap.url || null,
      storagePath: cap.storagePath || null,
      folder: cap.storageFolder || null,
      contentType: cap.contentType || (cap.kind === 'image' ? 'image/png' : 'video/mp4'),
      sizeBytes: Number(cap.fileSize ?? cap.sizeBytes) || null,
      sourceCaptureJobId: cap.jobId || null,
      arweave: cap.arweave || null,
    });
  }
  if (folderFiles && Array.isArray(folderFiles.files)) {
    for (const f of folderFiles.files) {
      rows.push({
        source: 'editvideosFolder',
        sourceLabel: 'Source Folders',
        label: f.name,
        fileName: f.name,
        folder: folderFiles.folder || (f.fullPath ? f.fullPath.split('/').slice(0, -1).join('/') : null),
        fullPath: f.fullPath || null,
        url: f.url || null,
        storagePath: f.fullPath || null,
        contentType: f.contentType || null,
        sizeBytes: Number(f.size) || null,
        sourceCaptureJobId: null,
        arweave: null,
      });
    }
  }
  return rows;
}

/** Normalize an EditVideos deploy-website POST result. Pure. */
function mapDeployResult(raw = {}) {
  return {
    status: raw?.success ? 'done' : 'failed',
    manifestId: raw?.manifestId || null,
    manifestUrl: raw?.manifestUrl || null,
    arweaveUrl: raw?.websiteUrl || raw?.manifestUrl || null,
    arnsUrl: raw?.arnsUrl || null,
    filesUploaded: Number(raw?.filesUploaded) || 0,
    filesUnchanged: Number(raw?.filesUnchanged) || 0,
    totalFiles: Number(raw?.totalFiles ?? raw?.filesUploaded) || 0,
    costEstimate: raw?.costEstimate || null,
    error: raw?.success ? null : (raw?.error || raw?.message || 'Deploy failed.'),
  };
}

/** Normalize an EditVideos deploy-website GET (estimate) result. Pure. */
function mapDeployEstimate(raw = {}) {
  const cost = raw?.cost || {};
  return {
    mode: 'website-deploy',
    filesChanged: Number(raw?.filesChanged) || 0,
    filesUnchanged: Number(raw?.filesUnchanged) || 0,
    totalFiles: Number(raw?.totalFiles) || 0,
    sizeBytes: Number(cost?.sizeBytes) || 0,
    costAR: Number(cost?.costAR) || 0,
    costUSD: Number(cost?.costUSD) || 0,
    arPriceUSD: Number(cost?.arPriceUSD) || 0,
    formatted: raw?.formatted || null,
    estimatedAt: null,
  };
}

// --- live AR price + estimate -----------------------------------------------
async function getArPriceUSD() {
  const now = Date.now();
  if (_arPriceCache.price && now - _arPriceCache.at < AR_PRICE_CACHE_TTL_MS) return _arPriceCache.price;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`AR price API ${res.status}`);
    const data = await res.json();
    const price = data?.arweave?.usd;
    if (price && price > 0) {
      _arPriceCache = { at: now, price };
      return price;
    }
    throw new Error('Invalid AR price');
  } catch {
    return 10; // fallback, mirrors EditVideos calculator
  }
}

/** Estimate archive cost for selected files using live AR price. */
async function estimateArchiveFiles(files = []) {
  const arPrice = await getArPriceUSD();
  const summary = summarizeArchiveCost(files, arPrice);
  summary.estimatedAt = new Date().toISOString();
  return summary;
}

// --- read EditVideos archive state (read-only via bridge app) ---------------
/** Read + normalize the EditVideos archiveManifest/main doc. Degrades to empty. */
async function getArchiveManifest() {
  const snap = await bridgeDb().collection(ARCHIVE_MANIFEST_COLLECTION).doc(ARCHIVE_MANIFEST_DOC).get();
  if (!snap.exists) return normalizeArchiveManifest({});
  return normalizeArchiveManifest(snap.data() || {});
}

/** Read a single EditVideos archiveJobs doc. Null if missing. */
async function getArchiveJob(archiveJobId) {
  if (!archiveJobId) return null;
  const snap = await bridgeDb().collection(ARCHIVE_JOBS_COLLECTION).doc(String(archiveJobId)).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

// --- mutations (proxied to the EditVideos deployed app over HTTP) -----------
function requireApiBase() {
  const base = editvideosApiBase();
  if (!base) {
    const err = new Error('EditVideos publishing API not configured (EDITVIDEOS_API_BASE).');
    err.status = 503;
    throw err;
  }
  return base;
}

/**
 * Archive ONE Firebase file to Arweave via the EditVideos archive-upload API.
 * @param {{folder:string, fileName:string}} args
 * @returns {Promise<object>} the EditVideos JSON result (transactionId/arweaveUrl/...)
 */
async function archiveFirebaseFile({ folder, fileName } = {}) {
  if (!folder || !fileName) throw new Error('folder and fileName are required to archive.');
  const base = requireApiBase();
  const res = await fetch(`${base}/api/archive-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, fileName }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || `Archive failed (${res.status}).`);
    err.status = res.status || 500;
    throw err;
  }
  return data;
}

/** Estimate a website deploy diff via the EditVideos deploy-website GET. */
async function estimateWebsiteDeploy({ websiteDir } = {}) {
  const base = requireApiBase();
  const qs = websiteDir ? `?websiteDir=${encodeURIComponent(websiteDir)}` : '';
  const res = await fetch(`${base}/api/deploy-website${qs}`, { method: 'GET' });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || `Deploy estimate failed (${res.status}).`);
    err.status = res.status || 500;
    throw err;
  }
  return mapDeployEstimate(data);
}

/** Deploy the configured website to Arweave via the EditVideos deploy-website POST. */
async function deployWebsite({ websiteDir } = {}) {
  const base = requireApiBase();
  const res = await fetch(`${base}/api/deploy-website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(websiteDir ? { websiteDir } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || `Deploy failed (${res.status}).`);
    err.status = res.status || 500;
    throw err;
  }
  return mapDeployResult(data);
}

/**
 * Update the ArNS pointer for a deployment manifest. EditVideos performs ArNS
 * inline during deploy; a standalone retry endpoint is OPTIONAL there. If it is
 * not deployed, degrade with a clear 503 so the UI shows "not available" rather
 * than crashing. Never blocks deploy success.
 */
async function updateArns({ manifestId } = {}) {
  if (!manifestId) throw new Error('manifestId is required to update ArNS.');
  const base = requireApiBase();
  const res = await fetch(`${base}/api/update-arns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId: manifestId, manifestId }),
  }).catch(() => null);
  if (!res) {
    const err = new Error('ArNS update endpoint unreachable.');
    err.status = 503;
    throw err;
  }
  if (res.status === 404) {
    const err = new Error('ArNS retry is not exposed by EditVideos; redeploy to refresh the pointer.');
    err.status = 501;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || `ArNS update failed (${res.status}).`);
    err.status = res.status || 500;
    throw err;
  }
  return {
    status: 'done',
    arnsUrl: data?.arnsUrl || null,
    arnsName: data?.arnsName || process.env.EDITVIDEOS_ARNS_NAME || null,
    manifestId,
    updatedAt: new Date().toISOString(),
    error: null,
  };
}

module.exports = {
  mapRecipeToVideoJob,
  enqueueVideoJob,
  triggerWorker,
  getVideoJob,
  listSourceFolders,
  listSourceFoldersWithCounts,
  listFolderMedia,
  createUploadSession,
  ensureUploadCors,
  invalidateFolderCache,
  listOptions,
  // archive / publishing
  costForBytes,
  summarizeArchiveCost,
  normalizeArchiveManifest,
  normalizeArchiveSources,
  mapDeployResult,
  mapDeployEstimate,
  getArPriceUSD,
  estimateArchiveFiles,
  getArchiveManifest,
  getArchiveJob,
  archiveFirebaseFile,
  estimateWebsiteDeploy,
  deployWebsite,
  updateArns,
  editvideosApiBase,
  APP_NAME,
  JOBS_COLLECTION,
  ARCHIVE_MANIFEST_COLLECTION,
  ARCHIVE_JOBS_COLLECTION,
};
