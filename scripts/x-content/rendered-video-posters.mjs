#!/usr/bin/env node
// First-frame posters for Rendered Videos packages (rv-*).
//
// DEFAULT IS A DRY RUN: lists rv-* packages lacking `posterRef` and prints what
// WOULD happen. Nothing is downloaded, extracted, uploaded or written.
// --write (OWNER ONLY): per package, downloads the MP4 from the EditVideos
// bucket, extracts one frame with ffmpeg (-ss 1), uploads it to
// posters/<jobId>.jpg in the same bucket, then sets `posterRef: ev:posters/<jobId>.jpg`.
//
// Reads Hitloop Firestore (packages). --write also reads/writes EditVideos Storage.
//
// Usage:
//   node scripts/x-content/rendered-video-posters.mjs [--limit N]
//   node scripts/x-content/rendered-video-posters.mjs --write [--limit N]   # OWNER ONLY

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { evObjectPath } from '../../features/rendered-videos/media-url.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const write = process.argv.includes('--write');
const li = process.argv.indexOf('--limit');
const limit = li > -1 ? Number(process.argv[li + 1]) || Infinity : Infinity;

const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
void fb.adminDb; // Hitloop app first, THEN the named bridge app.
const { readInventory, upsertPackage } = await import('../../features/x-content-inventory/store.js');

const { packages } = await readInventory();
const todo = packages
  .filter((p) => /^rv-/.test(p.id) && !p.posterRef && (p.assetRefs || []).some((r) => evObjectPath(r)))
  .slice(0, limit);

console.log(`Rendered video posters (${write ? 'WRITE' : 'DRY RUN'}): ${todo.length} package(s) lack a poster`);
for (const p of todo) console.log(`  ${write ? 'process' : 'would-process'} ${p.id}  ${p.title}`);
if (!write) { console.log('dry run: nothing downloaded or written. Re-run with --write (owner only).'); process.exit(0); }

const bridge = require(path.join(REPO, 'api/_lib/editvideos-bridge.cjs'));
const bucket = bridge.bridgeBucket();
let ok = 0;
for (const p of todo) {
  const videoPath = p.assetRefs.map(evObjectPath).find(Boolean);
  const jobId = p.id.replace(/^rv-/, '');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rv-poster-'));
  try {
    const mp4 = path.join(dir, 'in.mp4');
    const jpg = path.join(dir, 'poster.jpg');
    await bucket.file(videoPath).download({ destination: mp4 });
    const r = spawnSync('ffmpeg', ['-y', '-ss', '1', '-i', mp4, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', jpg], { stdio: 'pipe' });
    if (r.status !== 0) throw new Error(`ffmpeg exit ${r.status}: ${String(r.stderr).slice(-200)}`);
    const dest = `posters/${jobId}.jpg`;
    await bucket.file(dest).save(readFileSync(jpg), { contentType: 'image/jpeg', resumable: false });
    await upsertPackage({ ...p, posterRef: `ev:${dest}` }, { returnPackages: false });
    ok++;
    console.log(`  done ${p.id} -> ev:${dest}`);
  } catch (err) {
    console.log(`  FAILED ${p.id}: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`posters written: ${ok}/${todo.length}`);
