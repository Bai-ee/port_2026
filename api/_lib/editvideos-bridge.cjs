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

// Folders that are never valid source folders for a remix (case-insensitive).
const EXCLUDED_FOLDERS = ['logos', 'paper_backgrounds', 'mixes', 'videos'];

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
  const filterIntensity = recipe.filter?.intensity != null
    ? Number(recipe.filter.intensity)
    : 0.8;

  return {
    jobId,
    status: 'pending',
    // artist:null is valid → the EditVideos worker uses random Arweave audio.
    artist: null,
    mixTitle,
    duration: 30,
    videoFilter: recipe.filter?.key ? String(recipe.filter.key) : null,
    filterIntensity,
    useTrax: false,
    selectedFolders,
    enableOverlay: !!recipe.overlay?.enabled,
    overlayEffect: recipe.overlay?.enabled && recipe.overlay?.effect
      ? String(recipe.overlay.effect)
      : null,
    topLogo: null,
    endLogo: null,
    // No Underground-Existence artist thumbnails on the Hitloop path.
    useArtistImage: false,
    customEndMedia: null,
    endTextOverlay: null,
    videoOrder: null,
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

/**
 * List real EditVideos source folder names. Cached in-module for ~60s so the
 * dashboard does not trigger a full bucket scan on every load.
 * @returns {Promise<string[]>}
 */
async function listSourceFolders() {
  const now = Date.now();
  if (_folderCache.folders && now - _folderCache.at < FOLDER_CACHE_TTL_MS) {
    return _folderCache.folders;
  }

  const [files] = await bridgeBucket().getFiles();
  const folderSet = new Set();

  for (const file of files) {
    if (file.name.endsWith('.keep')) continue;
    const parts = file.name.split('/');
    if (parts.length > 1) {
      const top = parts[0];
      if (!top.startsWith('.')) folderSet.add(top);
    }
    if (parts.length > 2) {
      const nested = `${parts[0]}/${parts[1]}`;
      if (!nested.includes('.')) folderSet.add(nested);
    }
  }

  const folders = Array.from(folderSet).filter((f) => !isExcludedFolder(f));
  _folderCache = { at: now, folders };
  return folders;
}

module.exports = {
  mapRecipeToVideoJob,
  enqueueVideoJob,
  triggerWorker,
  getVideoJob,
  listSourceFolders,
  APP_NAME,
  JOBS_COLLECTION,
};
