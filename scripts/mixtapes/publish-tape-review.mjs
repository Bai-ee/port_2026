#!/usr/bin/env node
// Phase 3a: build the 60 s before/after review clips for one restored tape and publish them to the public Tape Deck.
// Usage:
//   node scripts/mixtapes/publish-tape-review.mjs --only <stem> [--title "<text>"] [--src <dir>] [--staging <dir>] [--force-hash]   (dry-run: local clips + record, NO network)
//   ... --write                  upload 2 clips to Storage + write one Firestore doc (mixtape_reviews/<reviewId>)
//   ... --unpublish <reviewId>   set status 'hidden' (takedown)
//   ... --delete <reviewId> [--yes]  delete Storage objects under mixtape-reviews/<reviewId>/ and the doc (without --yes: print what would be deleted)
//   ... --write --republish      allow re-publishing a review that was hidden (createdAt of an existing doc is preserved)
// MIXTAPE_ENV_FILE=<path>: env file holding the four FIREBASE_ADMIN_* vars (default: the dev checkout's .env.local).
// --allow-local-src: permit a --src outside /Volumes (tests / local fixtures). Never writes under /Volumes.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseEbur128Summary } from '../../features/mixtape-processing/restore-diagnose.js';
import { TP_CEILING_DB, matchGains } from '../../features/mixtape-processing/restore-chains.js';
import {
  AAC_ARGS, COLLECTION, ENV_FILE_PATH, STORAGE_PREFIX, buildReviewRecord, buildTokenUrl, clipFilter, joinsFromKeep, makeReviewId,
  parseEnvText, pickClipWindow, preflightEnv, reviewPrefix, storagePathsFor, validateRestoreJson,
} from '../../features/mixtape-processing/review-clip.js';

const FFMPEG = process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg';
const DEFAULT_SRC = '/Volumes/bryan/Mix_Tapes_For_Processing';
const home = (p) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

function parseArgs(argv) {
  const o = { src: DEFAULT_SRC, staging: home('~/mixtape-work'), only: null, title: null, write: false, unpublish: null, del: null, forceHash: false, allowLocalSrc: false, republish: false, yes: false };
  const need = (i) => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') o.src = home(need(i++));
    else if (a === '--staging') o.staging = home(need(i++));
    else if (a === '--only') o.only = need(i++);
    else if (a === '--title') o.title = need(i++);
    else if (a === '--unpublish') o.unpublish = need(i++);
    else if (a === '--delete') o.del = need(i++);
    else if (a === '--write') o.write = true;
    else if (a === '--force-hash') o.forceHash = true;
    else if (a === '--allow-local-src') o.allowLocalSrc = true;
    else if (a === '--republish') o.republish = true;
    else if (a === '--yes') o.yes = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', cmd, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err = (err + c).slice(-300000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`))));
  });
}
const base = ['-hide_banner', '-nostdin', '-v', 'error', '-y'];
const baseInfo = ['-hide_banner', '-nostdin', '-v', 'info', '-y'];

async function sha256Of(file) {
  const h = createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c);
  return h.digest('hex');
}

/** Loudness of the (un-gained, faded) clip window. */
async function measureClip(file, startS, lengthS) {
  const err = await run(FFMPEG, [...baseInfo, '-ss', String(startS), '-t', String(lengthS), '-i', file, '-af', `${clipFilter(0, lengthS)},ebur128=peak=true`, '-f', 'null', '-']);
  const r = parseEbur128Summary(err);
  return { lufs: r.integratedLufs, tp: r.truePeakDbtp };
}

async function encodeClip(file, startS, lengthS, gainDb, outFile) {
  await run(FFMPEG, [...base, '-ss', String(startS), '-t', String(lengthS), '-i', file, '-af', clipFilter(gainDb, lengthS), '-vn', ...AAC_ARGS, outFile]);
}

async function readJson(file) { return JSON.parse(await fsp.readFile(file, 'utf8')); }

/** Copy src -> dest unless an identical-size/mtime copy is already staged and its recorded sha is trusted. Returns sha256. */
async function stageVerified(srcFile, destFile, expectedSha, forceHash) {
  const st = await fsp.stat(srcFile);
  const cacheFile = `${destFile}.verify.json`;
  const cache = await readJson(cacheFile).catch(() => null);
  const dst = await fsp.stat(destFile).catch(() => null);
  if (!forceHash && cache && dst && cache.size === st.size && cache.mtimeMs === st.mtimeMs && dst.size === st.size && cache.sha256 === expectedSha) return expectedSha;
  await fsp.copyFile(srcFile, destFile);
  const sha = await sha256Of(destFile);
  if (sha !== expectedSha) { await fsp.rm(destFile, { force: true }); throw new Error(`${path.basename(srcFile)}: sha256 mismatch (stale restore.json or changed file)`); }
  await fsp.writeFile(cacheFile, JSON.stringify({ size: st.size, mtimeMs: st.mtimeMs, sha256: sha }));
  return sha;
}

/** Load the production env from the dev checkout (read-only), preflight it, then init firebase-admin. */
async function initFirebase() {
  const env = parseEnvText(await fsp.readFile(ENV_FILE_PATH, 'utf8'));
  const ids = preflightEnv(env); // throws before any network
  // set exactly the four admin vars (overriding any shell values); never merge the rest of .env.local
  process.env.FIREBASE_ADMIN_PROJECT_ID = ids.projectId;
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL = env.FIREBASE_ADMIN_CLIENT_EMAIL;
  process.env.FIREBASE_ADMIN_PRIVATE_KEY = env.FIREBASE_ADMIN_PRIVATE_KEY;
  process.env.FIREBASE_ADMIN_STORAGE_BUCKET = ids.bucket;
  console.log(`firebase: project ${ids.projectId}  bucket ${ids.bucket}`);
  const require = createRequire(import.meta.url);
  const fb = require('../../api/_lib/firebase-admin.cjs');
  return { fb, bucket: fb.adminStorage.bucket(ids.bucket), db: fb.adminDb };
}

async function uploadClip(bucket, storagePath, file) {
  const token = randomUUID();
  await bucket.file(storagePath).save(await fsp.readFile(file), {
    resumable: false,
    contentType: 'audio/mp4',
    metadata: { cacheControl: 'public, max-age=86400', metadata: { firebaseStorageDownloadTokens: token } },
  });
  return buildTokenUrl(bucket.name, storagePath, token);
}

function assertReviewId(id) {
  if (!/^[a-z0-9-]{3,120}$/.test(id || '')) throw new Error('reviewId must be lowercase [a-z0-9-]');
}

async function takedown(opts) {
  const id = opts.unpublish || opts.del;
  assertReviewId(id);
  const { db, bucket } = await initFirebase();
  if (opts.unpublish) {
    await db.collection(COLLECTION).doc(id).update({ status: 'hidden', hiddenAt: new Date().toISOString() });
    console.log(`hidden: ${COLLECTION}/${id}`);
    return;
  }
  const prefix = `${reviewPrefix(id)}/`;
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new Error(`${COLLECTION}/${id} does not exist; nothing to delete`);
  const [files] = await bucket.getFiles({ prefix });
  for (const f of files) if (!f.name.startsWith(prefix)) throw new Error('refusing to delete outside the review prefix');
  console.log(`target: ${COLLECTION}/${id}  title "${snap.data().title}"  ${files.length} object(s) under ${prefix}`);
  if (!opts.yes) { console.log('dry-run: nothing deleted. Re-run with --yes to delete.'); return; }
  for (const f of files) await f.delete();
  await db.collection(COLLECTION).doc(id).delete();
  console.log(`deleted: ${files.length} object(s) under ${prefix} and ${COLLECTION}/${id}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.unpublish || opts.del) {
    if (opts.unpublish && opts.del) throw new Error('use one of --unpublish / --delete');
    return takedown(opts);
  }
  if (!opts.only) throw new Error('--only <stem> is required (one tape per run)');
  if (!opts.src.startsWith('/Volumes/') && !opts.allowLocalSrc) throw new Error('--src outside /Volumes needs --allow-local-src');
  const stem = opts.only.replace(/\.(restored|trimmed)\.[^.]+$/i, '').replace(/\.restore\.json$/i, '');

  const restore = await readJson(path.join(opts.src, '_restored', `${stem}.restore.json`));
  const problems = validateRestoreJson(restore);
  if (problems.length) throw new Error(`restore.json invalid: ${problems.join(', ')}`);
  const trim = await readJson(path.join(opts.src, '_trimmed', restore.source.trimJsonName));

  const work = path.join(opts.staging, 'reviews', stem);
  await fsp.mkdir(work, { recursive: true });
  const trimmedLocal = path.join(work, restore.source.trimmedName);
  const restoredLocal = path.join(work, restore.output.name);
  await stageVerified(path.join(opts.src, '_trimmed', restore.source.trimmedName), trimmedLocal, restore.source.trimmedSha256, opts.forceHash);
  await stageVerified(path.join(opts.src, '_restored', restore.output.name), restoredLocal, restore.output.sha256, opts.forceHash);

  const reviewId = makeReviewId(stem, restore.source.trimmedSha256);
  const clip = pickClipWindow({ durationS: restore.output.durationS, joinsS: joinsFromKeep(trim.keep), seedHex: restore.source.trimmedSha256 });
  console.log(`tape ${stem}  reviewId ${reviewId}  clip ${clip.startS}s +${clip.lengthS}s${clip.joinFree ? '' : '  (WARNING: could not avoid a join)'}`);

  const mo = await measureClip(trimmedLocal, clip.startS, clip.lengthS);
  const mr = await measureClip(restoredLocal, clip.startS, clip.lengthS);
  const { gains, clampDb } = matchGains({ V0: mo, V1: mr }, ['V1'], TP_CEILING_DB);
  const gainsDb = { original: gains.V0, restored: gains.V1 };
  console.log(`levels: original ${mo.lufs} LUFS/${mo.tp} dBTP  restored ${mr.lufs} LUFS/${mr.tp} dBTP  gains ${gainsDb.original.toFixed(2)}/${gainsDb.restored.toFixed(2)} dB  tp-clamp ${clampDb.toFixed(2)} dB`);

  const out = { original: path.join(work, 'original.m4a'), restored: path.join(work, 'restored.m4a') };
  await encodeClip(trimmedLocal, clip.startS, clip.lengthS, gainsDb.original, out.original);
  await encodeClip(restoredLocal, clip.startS, clip.lengthS, gainsDb.restored, out.restored);
  console.log(`clips: ${out.original} (${(await fsp.stat(out.original)).size} B)  ${out.restored} (${(await fsp.stat(out.restored)).size} B)`);

  const storagePaths = storagePathsFor(reviewId, restore.chainHash);
  const now = new Date().toISOString();
  const mk = (urls) => buildReviewRecord({ reviewId, title: opts.title, restore, trim, clip, gainsDb, urls, storagePaths, now });

  if (!opts.write) {
    const rec = mk({ original: '(dry-run)', restored: '(dry-run)' });
    console.log(`dry-run: would write ${COLLECTION}/${reviewId} and upload to ${STORAGE_PREFIX}/${reviewId}/${restore.chainHash}/ (no network used)`);
    console.log(JSON.stringify(rec, null, 2));
    return;
  }

  const { db, bucket } = await initFirebase();
  const ref = db.collection(COLLECTION).doc(reviewId);
  const existing = await ref.get();
  if (existing.exists && existing.data().status === 'hidden' && !opts.republish) throw new Error(`${COLLECTION}/${reviewId} is hidden (unpublished); pass --republish to publish it again`);
  const urls = {
    original: await uploadClip(bucket, storagePaths.original, out.original),
    restored: await uploadClip(bucket, storagePaths.restored, out.restored),
  };
  const rec = mk(urls);
  if (existing.exists && existing.data().createdAt) rec.createdAt = existing.data().createdAt;
  await ref.set(rec);
  console.log(`published: ${COLLECTION}/${reviewId}`);
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
