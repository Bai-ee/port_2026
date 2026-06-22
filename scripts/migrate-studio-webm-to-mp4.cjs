'use strict';

/**
 * One-off migration: transcode every stored studio_video that is NOT MP4
 * (WebM/OGG) into H.264/MP4 so it becomes X-postable, then rewrite its
 * dashboard_state.studioCaptures[] ref to point at the new MP4.
 *
 * Idempotent: entries already video/mp4 are skipped. Safe to re-run.
 *
 * Usage (from repo root):
 *   node scripts/migrate-studio-webm-to-mp4.cjs            # apply
 *   DRY_RUN=1 node scripts/migrate-studio-webm-to-mp4.cjs  # report only
 *   CLIENT_ID=foo node scripts/migrate-studio-webm-to-mp4.cjs  # scope to one client
 *
 * Requires ffmpeg on PATH and the FIREBASE_ADMIN_* env vars (loaded from .env.local).
 */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const fb = require('../api/_lib/firebase-admin.cjs');

const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const ONLY_CLIENT = process.env.CLIENT_ID || null;

function isMp4(ref) {
  const ct = String(ref?.contentType || '').toLowerCase();
  if (ct) return ct === 'video/mp4';
  return /\.mp4(\?|$)/i.test(String(ref?.storagePath || ref?.downloadUrl || ''));
}

function transcode(inPath, outPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      outPath,
    ], { timeout: 180000, maxBuffer: 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${err.message} ${String(stderr).slice(-300)}`));
      else resolve();
    });
  });
}

function buildDownloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function migrateRef(bucket, ref) {
  const srcPath = ref.storagePath;
  if (!srcPath) return { changed: false, reason: 'no storagePath' };

  const base = path.join(os.tmpdir(), `mig-${Date.now()}-${randomUUID().slice(0, 8)}`);
  const inPath = `${base}.src`;
  const outPath = `${base}.mp4`;
  // New object path: swap the extension to .mp4 (keep a distinct name so the old
  // object is left intact as a rollback safety net).
  const mp4Path = srcPath.replace(/\.(webm|ogv|ogg)$/i, '') + '-mp4.mp4';

  try {
    await bucket.file(srcPath).download({ destination: inPath });
    await transcode(inPath, outPath);
    const mp4Buffer = await fs.readFile(outPath);

    const token = randomUUID();
    await bucket.file(mp4Path).save(mp4Buffer, {
      resumable: false,
      contentType: 'video/mp4',
      metadata: {
        cacheControl: 'private, max-age=0, no-transform',
        metadata: {
          artifactType: 'studio_video',
          transcodedFrom: srcPath,
          migratedAt: new Date().toISOString(),
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const newRef = {
      ...ref,
      storagePath: mp4Path,
      contentType: 'video/mp4',
      sizeBytes: mp4Buffer.length,
      downloadUrl: buildDownloadUrl(bucket.name, mp4Path, token),
      transcodedFrom: srcPath,
    };
    return { changed: true, newRef, mp4Path, sizeKB: Math.round(mp4Buffer.length / 1024) };
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}

async function main() {
  const db = fb.adminDb;
  const bucket = fb.adminStorage.bucket();
  console.log(`[migrate] bucket=${bucket.name} dryRun=${DRY_RUN} onlyClient=${ONLY_CLIENT || '(all)'}`);

  let docs;
  if (ONLY_CLIENT) {
    const snap = await db.collection('dashboard_state').doc(ONLY_CLIENT).get();
    docs = snap.exists ? [snap] : [];
  } else {
    const snap = await db.collection('dashboard_state').get();
    docs = snap.docs;
  }
  console.log(`[migrate] scanning ${docs.length} dashboard_state doc(s)`);

  let totalVids = 0, toMigrate = 0, migrated = 0, failed = 0;

  for (const doc of docs) {
    const data = doc.data() || {};
    const caps = Array.isArray(data.studioCaptures) ? data.studioCaptures : [];
    const vids = caps.filter((c) => c?.type === 'studio_video');
    totalVids += vids.length;

    let mutated = false;
    const nextCaps = [...caps];

    for (let i = 0; i < nextCaps.length; i += 1) {
      const ref = nextCaps[i];
      if (ref?.type !== 'studio_video' || isMp4(ref) || !ref?.storagePath) continue;
      toMigrate += 1;
      console.log(`  - ${doc.id}: ${ref.storagePath} (${ref.contentType || 'unknown'}) → mp4`);
      if (DRY_RUN) continue;
      try {
        const result = await migrateRef(bucket, ref);
        if (result.changed) {
          nextCaps[i] = result.newRef;
          mutated = true;
          migrated += 1;
          console.log(`      ✓ ${result.mp4Path} (${result.sizeKB}KB)`);
        }
      } catch (err) {
        failed += 1;
        console.error(`      ✗ ${err.message}`);
      }
    }

    if (mutated && !DRY_RUN) {
      await db.collection('dashboard_state').doc(doc.id).set({ studioCaptures: nextCaps }, { merge: true });
      console.log(`  → updated dashboard_state/${doc.id}`);
    }
  }

  console.log(`\n[migrate] done. studio_videos=${totalVids} needMigrate=${toMigrate} migrated=${migrated} failed=${failed}${DRY_RUN ? ' (DRY RUN — nothing written)' : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('[migrate] fatal:', err); process.exit(1); });
