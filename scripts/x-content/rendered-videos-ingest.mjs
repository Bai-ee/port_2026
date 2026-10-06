#!/usr/bin/env node
// Rendered Videos -> ContentPackages (Content Engine v2 "Rendered Videos" bucket).
//
// DEFAULT IS A DRY RUN: lists completed renders from the EditVideos `videos`
// collection through the bridge (READ-ONLY), joins Hitloop `media_jobs` by
// editJobId, maps via features/rendered-videos/adapter.js, prints counts and
// writes a preview JSON. Nothing is written unless --write (OWNER ONLY).
//
// Reads (owner run): EditVideos Firestore `videos` + Hitloop Firestore `media_jobs`.
// Zero X/LLM/paid calls. Use --fixture <videos.json> to run fully offline.
//
// Usage:
//   node scripts/x-content/rendered-videos-ingest.mjs
//   node scripts/x-content/rendered-videos-ingest.mjs --fixture f.json --artists artists.json --out /private/tmp/x.json
//   node scripts/x-content/rendered-videos-ingest.mjs --write   # OWNER ONLY

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mapRenderedVideos } from '../../features/rendered-videos/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const DEFAULT_ARTISTS = '/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/website/artists.json';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const write = process.argv.includes('--write');
const fixture = arg('fixture', null);
const artistsPath = arg('artists', DEFAULT_ARTISTS);
const outPath = arg('out', '/private/tmp/rendered-videos-ingest-preview.json');
const maxPages = Number(arg('max-pages', 50));

const ueArtists = existsSync(artistsPath) ? JSON.parse(readFileSync(artistsPath, 'utf8')) : [];
const require = createRequire(import.meta.url);

let videos = [];
const mediaJobsByEditJobId = new Map();

if (fixture) {
  const f = JSON.parse(readFileSync(fixture, 'utf8'));
  videos = f.videos || f;
  for (const j of f.mediaJobs || []) if (j.editJobId) mediaJobsByEditJobId.set(String(j.editJobId), j);
} else {
  // Env first, then Hitloop adminDb BEFORE the named 'editvideos' bridge app.
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
  const bridge = require(path.join(REPO, 'api/_lib/editvideos-bridge.cjs'));
  void fb.adminDb;
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await bridge.listRenderedVideos({ limit: 200, startAfter: cursor });
    videos.push(...page.videos);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  const ids = videos.map((v) => String(v.jobId || v.id));
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await fb.adminDb.collection('media_jobs').where('editJobId', 'in', ids.slice(i, i + 30)).get();
    for (const d of snap.docs) { const j = d.data(); if (j.editJobId) mediaJobsByEditJobId.set(String(j.editJobId), j); }
  }
}

const { packages, skipped } = mapRenderedVideos(videos, { ueArtists, mediaJobsByEditJobId, now: Date.now() });

const count = (arr, f) => arr.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const origin = (p) => p.tags.find((t) => ['auto-daily', 'deliberate', 'origin-unknown'].includes(t));
console.log(`Rendered videos ingest (${write ? 'WRITE' : 'DRY RUN'})${fixture ? ` - fixture ${fixture}` : ''}`);
console.log(`videos read: ${videos.length} | packages: ${packages.length} | skipped: ${skipped.length}`);
console.log('by artist:', JSON.stringify(count(packages, (p) => p.entities[0] || 'unknown')));
console.log('origin:', JSON.stringify(count(packages, origin)));
console.log('rights:', JSON.stringify(count(packages, (p) => p.rights)));
console.log('skip reasons:', JSON.stringify(count(skipped, (s) => s.reason)));

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ packages, skipped }, null, 2));
console.log(`preview written: ${outPath}`);

if (write) {
  const { upsertPackage } = await import('../../features/x-content-inventory/store.js');
  for (const pkg of packages) await upsertPackage(pkg, { returnPackages: false });
  console.log(`wrote ${packages.length} packages`);
} else {
  console.log('dry run: nothing written. Re-run with --write (owner only) to upsert.');
}
