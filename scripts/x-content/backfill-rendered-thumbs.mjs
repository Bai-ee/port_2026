#!/usr/bin/env node
// Backfill 320px thumbnails for Rendered Videos (rv-*) packages that lack one.
//
// WHY ON THE MAC: the EditVideos bucket sends no CORS headers, so the browser
// cannot capture frames from those videos. ffmpeg reads only what it needs to
// decode one frame at ~1s (HTTP range reads), so this does not download whole files.
// New renders should get a thumb at render time (EditVideos worker; master plan §5b).
//
// Usage: node scripts/x-content/backfill-rendered-thumbs.mjs [--client <id>] [--limit N] [--concurrency 6] [--write]
// Default is a DRY RUN (lists what would be made). --write uploads to Hitloop Storage
// content-thumbs/<client>/<id>.jpg and sets package.thumbRef. No X / LLM / paid calls.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeThumbJpeg, thumbPathFor, uploadThumb } from '../../features/x-content-inventory/thumbs.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const write = process.argv.includes('--write');
const limit = Number(arg('--limit', '0')) || Infinity;
const concurrency = Number(arg('--concurrency', '6')) || 6;

require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
void fb.adminDb; // init Hitloop app BEFORE the named EditVideos bridge app
const bridge = require(path.join(REPO, 'api/_lib/editvideos-bridge.cjs'));
const clientId = arg('--client', process.env.DISCOGS_X_CLIENT_ID || 'bryan-balli-WUoltG84');
const col = fb.adminDb.collection('x_content_packages');

function grabFrame(url) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', url,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1']);
    const chunks = [];
    let err = '';
    const timer = setTimeout(() => { ff.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, 60_000);
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => { err += c; });
    ff.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length) resolve(buf); else reject(new Error(err.trim().split('\n').pop() || `ffmpeg exit ${code}`));
    });
  });
}

const snap = await col.where('__name__', '>=', 'rv-').where('__name__', '<', 'rv.').get();
const todo = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  .filter((p) => !p.thumbRef)
  .map((p) => ({ id: p.id, path: (p.assetRefs || []).map(String).find((r) => r.startsWith('ev:'))?.slice(3) }))
  .filter((p) => p.path)
  .slice(0, limit);

console.log(`rendered packages: ${snap.size} · needing thumbs: ${todo.length}${write ? '' : ' (DRY RUN)'}`);
if (!write) { console.log(todo.slice(0, 5)); process.exit(0); }

const bucket = fb.adminStorage.bucket();
let done = 0, failed = 0, i = 0;
const failures = [];
await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
  while (i < todo.length) {
    const item = todo[i++];
    try {
      const url = await bridge.signReadUrl(item.path);
      const jpeg = await makeThumbJpeg(await grabFrame(url), { enforceMaxInput: false });
      const thumbRef = thumbPathFor(clientId, item.id);
      await uploadThumb(bucket, thumbRef, jpeg);
      await col.doc(item.id).set({ thumbRef }, { merge: true });
      done += 1;
    } catch (e) {
      failed += 1;
      failures.push(`${item.id}: ${e.message}`);
    }
    if ((done + failed) % 50 === 0) console.log(`  ${done + failed}/${todo.length} (ok ${done}, failed ${failed})`);
  }
}));
console.log(`done: ${done} · failed: ${failed}`);
if (failures.length) console.log(failures.slice(0, 10).join('\n'));
process.exit(0);
