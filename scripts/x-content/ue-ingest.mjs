#!/usr/bin/env node
// UE mixes -> ContentPackages. DEFAULT IS A DRY RUN: reads a local artists.json,
// maps mixes (features/ue-content/adapter.js), prints a table and writes a JSON
// preview to a scratch path. Nothing touches Firestore unless --write.
//
// COST: zero. No network, no X API, no LLM, no Arweave/gateway fetch.
//
// Usage:
//   node scripts/x-content/ue-ingest.mjs
//   node scripts/x-content/ue-ingest.mjs --artists <path> --videos <dir> --out <file>
//   node scripts/x-content/ue-ingest.mjs --write        # OWNER ONLY: upserts packages (+ build stories)

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mapArtists, buildVideoIndex } from '../../features/ue-content/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const DEFAULT_ARTISTS = '/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/website/artists.json';
const DEFAULT_VIDEOS = '/Users/bballi/Documents/Repos/Crazy_Critters/Overlord/Videos/undergroundEx';
const DEFAULT_REVIEWS = path.join(repo, 'docs/audits/cesar-ramirez-mix-reviews.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const write = process.argv.includes('--write');
const artistsPath = arg('artists', DEFAULT_ARTISTS);
const videosDir = arg('videos', DEFAULT_VIDEOS);
const outPath = arg('out', path.join(os.tmpdir(), 'ue-ingest-preview.json'));

const artists = JSON.parse(readFileSync(artistsPath, 'utf8'));
const videoIndex = existsSync(videosDir) ? buildVideoIndex(readdirSync(videosDir)) : {};
const reviews = existsSync(DEFAULT_REVIEWS) ? JSON.parse(readFileSync(DEFAULT_REVIEWS, 'utf8')).reviews : [];
const buildStories = JSON.parse(readFileSync(path.join(repo, 'features/ue-content/build-stories.json'), 'utf8'));

const { packages, skipped } = mapArtists(artists, { videoIndex, reviews });

const pad = (s, n) => String(s).slice(0, n).padEnd(n);
console.log(`UE ingest (${write ? 'WRITE' : 'DRY RUN'}) - ${artistsPath}`);
console.log(`videos indexed for: ${Object.keys(videoIndex).join(', ') || 'none'}\n`);
console.log(`${pad('ACTION', 13)}${pad('ARTIST / TITLE', 64)}${pad('FORMAT', 7)}RIGHTS`);
for (const p of packages) console.log(`${pad('would-create', 13)}${pad(p.title, 64)}${pad(p.format, 7)}${p.rights}`);
for (const s of skipped) console.log(`${pad('skipped', 13)}${pad(`${s.artist} - ${s.title}`, 64)}${s.reason}`);
for (const b of buildStories) console.log(`${pad('build-story', 13)}${pad(b.title, 64)}${pad(b.format, 7)}${b.rights}`);

const count = (arr, f) => arr.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
console.log('\nmixes:', packages.length, 'created |', skipped.length, 'skipped | build stories:', buildStories.length);
console.log('rights:', JSON.stringify(count(packages, (p) => p.rights)), '| format:', JSON.stringify(count(packages, (p) => p.format)));
console.log('skip reasons:', JSON.stringify(count(skipped, (s) => s.reason.replace(/\s*\(.*$/, '').replace(/^known defect:.*/, 'known defect').trim())));

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ packages, buildStories, skipped }, null, 2));
console.log(`\npreview written: ${outPath}`);

if (write) {
  const { upsertPackage } = await import('../../features/x-content-inventory/store.js');
  for (const pkg of [...packages, ...buildStories]) {
    await upsertPackage(pkg, { returnPackages: false });
  }
  console.log(`wrote ${packages.length + buildStories.length} packages`);
} else {
  console.log('dry run: nothing written. Re-run with --write (owner only) to upsert.');
}
