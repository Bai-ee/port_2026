'use strict';

// media-assets.cjs — Firestore index over the EditVideos GCS source bucket.
//
// The bucket (via editvideos-bridge.cjs) stays the source of truth for bytes;
// this collection is a fast, query-able mirror so folder/file listings and
// counts don't require a full bucket scan on every request. Mutations write
// the bucket first, then this index; syncIndexFromBucket heals drift from a
// partial/non-atomic bucket op (move/rename/delete-folder are not
// transactional against the bucket). Global collection — the bucket is shared
// across clients, not per-client, matching editvideos-bridge.cjs's existing
// folder-scan model.
//
// Two doc shapes in one collection:
//   asset doc:  id = assetDocId(fullPath) -> { type:'asset', fullPath, folder, name, size, contentType, kind, posterPath, updated, syncedAt }
//   folder doc: id = `folder:<name>`      -> { type:'folder', folder, syncedAt }
//     (represents a folder with zero files — folders with assets are derived
//     from the asset docs' `folder` field, so a folder doc is only needed once
//     every file in it has been moved/deleted out, or it was created empty.)
//
// The Firestore dependency is reached through ctx() so tests can inject an
// in-memory fake (see __setTestContext), mirroring media-jobs.cjs.

const realFb = require('./firebase-admin.cjs');

const COLLECTION = 'media_assets';

const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);

// --- test seam -------------------------------------------------------------
let _ctx = null;
/** Inject a fake { adminDb } for tests. Pass null to restore real. */
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

// --- doc ids -----------------------------------------------------------------
function assetDocId(fullPath) {
  return Buffer.from(String(fullPath || ''), 'utf8').toString('base64url');
}

function folderDocId(folder) {
  return `folder:${String(folder || '')}`;
}

// --- pure helpers (firebase-free, unit-testable) ----------------------------
function kindForContentType(contentType, name) {
  const ct = String(contentType || '');
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('image/')) return 'image';
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'other';
}

/**
 * Deterministic poster path for a source file: `.posters/<folder>/<name>.jpg`.
 * `.jpg` is appended to the full original file name (not extension-swapped)
 * so the mapping is unambiguous and collision-free. Pure — no bucket access.
 */
function posterPathForSource(fullPath) {
  const parts = String(fullPath || '').split('/');
  if (parts.length < 2) return null;
  const name = parts.pop();
  const folder = parts.join('/');
  if (!folder || !name) return null;
  return `.posters/${folder}/${name}.jpg`;
}

// --- upsert / remove ---------------------------------------------------------
/** Upsert asset rows (merge). Not a literal Firestore WriteBatch — a
 * Promise.all of per-doc merges, which keeps this testable against the
 * lightweight fake Firestore used elsewhere in this repo. */
async function upsertAssets(rows = []) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.fullPath) : [];
  if (!list.length) return { upserted: 0 };
  const fb = ctx();
  const now = new Date().toISOString();
  await Promise.all(list.map((row) => {
    const fullPath = String(row.fullPath);
    const name = row.name || fullPath.split('/').pop();
    const folder = row.folder != null ? String(row.folder) : fullPath.split('/').slice(0, -1).join('/');
    const doc = {
      type: 'asset',
      fullPath,
      folder,
      name,
      size: Number(row.size) || 0,
      contentType: row.contentType || null,
      kind: row.kind || kindForContentType(row.contentType, name),
      posterPath: row.posterPath || null,
      updated: row.updated || now,
      syncedAt: now,
    };
    return fb.adminDb.collection(COLLECTION).doc(assetDocId(fullPath)).set(doc, { merge: true });
  }));
  return { upserted: list.length };
}

async function removeAssets(fullPaths = []) {
  const list = Array.isArray(fullPaths) ? fullPaths.filter(Boolean) : [];
  if (!list.length) return { removed: 0 };
  const fb = ctx();
  await Promise.all(list.map((fullPath) => fb.adminDb.collection(COLLECTION).doc(assetDocId(String(fullPath))).delete()));
  return { removed: list.length };
}

/**
 * Re-key asset docs after a bucket move/rename: deletes the doc at the old
 * path's id and upserts one at the new path's id, carrying the poster path
 * forward (recomputed for the new location) when the source had one.
 * @param {Array<{from:string, to:string, folder?:string}>} moves
 */
async function moveAssetDocs(moves = []) {
  const list = Array.isArray(moves) ? moves.filter((m) => m && m.from && m.to) : [];
  if (!list.length) return { moved: 0 };
  const fb = ctx();
  const now = new Date().toISOString();
  await Promise.all(list.map(async ({ from, to, folder }) => {
    const oldRef = fb.adminDb.collection(COLLECTION).doc(assetDocId(String(from)));
    const snap = await oldRef.get();
    const prev = snap.exists ? snap.data() : null;
    const name = String(to).split('/').pop();
    const targetFolder = folder != null ? String(folder) : String(to).split('/').slice(0, -1).join('/');
    const newDoc = {
      type: 'asset',
      fullPath: String(to),
      folder: targetFolder,
      name,
      size: Number(prev?.size) || 0,
      contentType: prev?.contentType || null,
      kind: prev?.kind || kindForContentType(prev?.contentType, name),
      posterPath: prev?.posterPath ? posterPathForSource(String(to)) : null,
      updated: now,
      syncedAt: now,
    };
    await fb.adminDb.collection(COLLECTION).doc(assetDocId(String(to))).set(newDoc, { merge: true });
    if (snap.exists) await oldRef.delete();
  }));
  return { moved: list.length };
}

// --- folder-only docs (represent empty folders) -----------------------------
async function ensureFolderDoc(name) {
  const folder = String(name || '');
  if (!folder) throw new Error('Folder name is required.');
  const fb = ctx();
  await fb.adminDb.collection(COLLECTION).doc(folderDocId(folder)).set({
    type: 'folder',
    folder,
    syncedAt: new Date().toISOString(),
  }, { merge: true });
  return { folder };
}

async function removeFolderDoc(name) {
  const folder = String(name || '');
  if (!folder) return { folder };
  const fb = ctx();
  await fb.adminDb.collection(COLLECTION).doc(folderDocId(folder)).delete();
  return { folder };
}

// --- reads -------------------------------------------------------------------
/**
 * Distinct folders from asset docs (counted) union folder-only docs (count 0
 * unless assets also exist there). Full-collection scan — the index is
 * expected to stay small (hundreds, not millions, of media files).
 */
async function listIndexFolders() {
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).get();
  const counts = new Map();
  const folderOnly = new Set();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.type === 'folder') {
      folderOnly.add(data.folder);
    } else if (data.type === 'asset') {
      counts.set(data.folder, (counts.get(data.folder) || 0) + 1);
    }
  }
  const names = new Set([...counts.keys(), ...folderOnly]);
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, count: counts.get(name) || 0 }));
}

/**
 * Files in a folder, newest-name-first is not guaranteed — sorted by name.
 * Single equality filter (no orderBy) — avoids needing a composite index,
 * mirroring the caution already established in media-jobs.cjs.
 */
async function listIndexFolderFiles(folder, { limit = 200 } = {}) {
  const fb = ctx();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const snap = await fb.adminDb.collection(COLLECTION).where('folder', '==', String(folder || '')).limit(safeLimit).get();
  const files = snap.docs
    .map((doc) => doc.data())
    .filter((data) => data && data.type === 'asset')
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { folder: String(folder || ''), files };
}

/**
 * Diff a fresh bucket scan (rows the caller obtained from the bridge) against
 * the current index and reconcile: new bucket files are upserted, files no
 * longer in the bucket are removed, changed files (size/updated) are
 * refreshed. Posters are not scanned by the bucket sweep (they are recorded
 * at upload time) — an existing posterPath is carried forward on update.
 * @param {Array<{fullPath,folder,name,size,contentType,updated}>} bucketRows
 * @returns {Promise<{added:number, removed:number, updated:number}>}
 */
async function syncIndexFromBucket(bucketRows = []) {
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).get();
  const existingAssets = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data && data.type === 'asset') existingAssets.set(data.fullPath, data);
  }

  const rows = Array.isArray(bucketRows) ? bucketRows : [];
  const bucketPaths = new Set(rows.map((row) => row.fullPath));

  const toUpsert = [];
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = existingAssets.get(row.fullPath);
    if (!existing) {
      added += 1;
      toUpsert.push(row);
    } else if (Number(existing.size) !== Number(row.size) || existing.updated !== row.updated) {
      updated += 1;
      toUpsert.push({ ...row, posterPath: existing.posterPath || null });
    }
  }
  const toRemove = [...existingAssets.keys()].filter((fullPath) => !bucketPaths.has(fullPath));

  if (toUpsert.length) await upsertAssets(toUpsert);
  if (toRemove.length) await removeAssets(toRemove);

  return { added, removed: toRemove.length, updated };
}

module.exports = {
  assetDocId,
  folderDocId,
  kindForContentType,
  posterPathForSource,
  upsertAssets,
  removeAssets,
  moveAssetDocs,
  ensureFolderDoc,
  removeFolderDoc,
  listIndexFolders,
  listIndexFolderFiles,
  syncIndexFromBucket,
  __setTestContext,
  COLLECTION,
};
