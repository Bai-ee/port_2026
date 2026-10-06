#!/usr/bin/env node
// Sync the Video Remix feed (EditVideos renders) into the Rendered Videos bucket.
//
// Same logic as the 'sync-rendered-videos' route action (features/rendered-videos/sync.js),
// runnable by the owner from the Mac. Adds genre/era enrichment from the local
// UE artists.json, which the server cannot read. Machine fields only — never
// overwrites story, edits, approval, status, rights set by a human, or posting history.
//
// Usage: node scripts/x-content/sync-rendered-videos.mjs [--client <id>] [--artists <path>]
// WRITES to production Firestore (x_content_packages). No X / LLM / paid calls.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { syncRenderedVideos } from '../../features/rendered-videos/sync.js';
import { upsertPackage } from '../../features/x-content-inventory/store.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
void fb.adminDb; // init Hitloop app BEFORE the named EditVideos bridge app
const bridge = require(path.join(REPO, 'api/_lib/editvideos-bridge.cjs'));

const clientId = arg('--client', process.env.DISCOGS_X_CLIENT_ID || 'bryan-balli-WUoltG84');
const artistsPath = arg('--artists', path.join(REPO, '../EditVideos/arweave-video-generator/website/artists.json'));
const ueArtists = existsSync(artistsPath) ? JSON.parse(readFileSync(artistsPath, 'utf8')) : [];

const metaRef = fb.adminDb.collection('content_buckets').doc(clientId).collection('meta').doc('rendered-videos');

const result = await syncRenderedVideos({
  async listVideos() {
    const videos = [];
    let cursor = null;
    for (let i = 0; i < 50; i += 1) {
      const page = await bridge.listRenderedVideos({ limit: 200, startAfter: cursor });
      videos.push(...page.videos);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return videos;
  },
  async listMediaJobs(jobIds) {
    const map = new Map();
    for (let i = 0; i < jobIds.length; i += 30) {
      const snap = await fb.adminDb.collection('media_jobs').where('editJobId', 'in', jobIds.slice(i, i + 30)).get();
      for (const d of snap.docs) { const j = d.data(); if (j.editJobId) map.set(String(j.editJobId), j); }
    }
    return map;
  },
  async readExisting(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 300) {
      const refs = ids.slice(i, i + 300).map((id) => fb.adminDb.collection('x_content_packages').doc(id));
      const snaps = refs.length ? await fb.adminDb.getAll(...refs) : [];
      for (const s of snaps) if (s.exists) out.set(s.id, { id: s.id, ...(s.data() || {}) });
    }
    return out;
  },
  upsert: (pkg) => upsertPackage(pkg, { returnPackages: false }),
  readMeta: async () => (await metaRef.get()).data() || null,
  writeMeta: (obj) => metaRef.set(obj, { merge: true }),
  now: () => Date.now(),
  ueArtists: Array.isArray(ueArtists) ? ueArtists : (ueArtists.artists || []),
  concurrency: 8,
}, { force: true });

console.log(JSON.stringify(result));
process.exit(0);
