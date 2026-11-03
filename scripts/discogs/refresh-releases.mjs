#!/usr/bin/env node
// Pull EVERYTHING Discogs has for each of a client's Discogs record items (free API, personal token):
//   full release (tracklist, credits, labels, formats, identifiers, videos, images, notes, community have/want/rating),
//   marketplace stats (lowest price, number for sale), price suggestions by condition, and the owner's collection
//   instance(s) for that release.
// Writes:
//   discogs_releases/{releaseId}            the full bundle (what the chat reads with get_item)
//   x_content_packages/discogs-{id}         .discogsSummary (compact: value, have/want, formats...) for search/sort/batch
//
// Usage:
//   node scripts/discogs/refresh-releases.mjs --client bryan-balli-WUoltG84            # dry run: fetch + print, no writes
//   node scripts/discogs/refresh-releases.mjs --client bryan-balli-WUoltG84 --write
//   ... --only 10207 (one release) | --limit 5 | --stale-days 7 (skip bundles fetched within N days)
// Token: DISCOGS_TOKEN env, else ../assetManager/.env.local (never printed). ~1.1 s per call, 4 calls per release.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDiscogsApi, fetchReleaseBundle } from '../../features/discogs-ingest/discogs-api.js';
import { summarizeDiscogsBundle } from '../../features/discogs-ingest/release-summary.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(REPO, true, { info: () => {}, error: () => {} });

function args(argv) {
  const o = { client: '', write: false, only: '', limit: 0, staleDays: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--client') o.client = argv[++i] || '';
    else if (a === '--write') o.write = true;
    else if (a === '--only') o.only = argv[++i] || '';
    else if (a === '--limit') o.limit = Number(argv[++i]) || 0;
    else if (a === '--stale-days') o.staleDays = Number(argv[++i]) || 0;
  }
  return o;
}

function token() {
  if (process.env.DISCOGS_TOKEN) return process.env.DISCOGS_TOKEN;
  try {
    const line = fs.readFileSync(path.join(REPO, '../assetManager/.env.local'), 'utf8').split('\n').find((l) => l.startsWith('DISCOGS_TOKEN='));
    return line ? line.slice('DISCOGS_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}

const o = args(process.argv.slice(2));
if (!o.client) { console.error('Usage: refresh-releases.mjs --client <clientId> [--write] [--only <releaseId>] [--limit N] [--stale-days N]'); process.exit(1); }
const tok = token();
if (!tok) { console.error('DISCOGS_TOKEN not found (env or ../assetManager/.env.local).'); process.exit(1); }

const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
const { upsertPackage } = await import(path.join(REPO, 'features/x-content-inventory/store.js'));
const db = fb.adminDb;
const api = createDiscogsApi({ token: tok });

const snap = await db.collection('x_content_packages').where('clientId', '==', o.client).limit(5000).get();
let pkgs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => /^discogs-\d+$/.test(p.id));
if (o.only) pkgs = pkgs.filter((p) => p.id === `discogs-${o.only}`);
if (o.limit) pkgs = pkgs.slice(0, o.limit);
const username = await api.identity().then((r) => r?.username || null).catch(() => null);
console.log(`${pkgs.length} Discogs record item(s) for ${o.client} · collection user ${username ? 'found' : 'unknown'} · ${o.write ? 'WRITE' : 'dry run'}`);

let done = 0; let skipped = 0; let failed = 0;
for (const p of pkgs) {
  const releaseId = p.id.slice('discogs-'.length);
  if (o.staleDays) {
    const prev = await db.collection('discogs_releases').doc(releaseId).get();
    const at = prev.exists ? Date.parse(prev.data()?.fetchedAt || '') : NaN;
    if (Number.isFinite(at) && Date.now() - at < o.staleDays * 86_400_000) { skipped += 1; continue; }
  }
  // eslint-disable-next-line no-await-in-loop
  const bundle = await fetchReleaseBundle(api, releaseId, { username });
  if (!bundle.release) { failed += 1; console.log(`  ${releaseId}: release fetch failed (${bundle.errors.release?.status ?? '?'})`); continue; }
  const summary = summarizeDiscogsBundle(bundle);
  console.log(`  ${releaseId}: ${summary.title} · ${summary.valueUsd != null ? `$${summary.valueUsd} (${summary.valueBasis})` : 'no price'} · have ${summary.have} / want ${summary.want}${bundle.errors && Object.keys(bundle.errors).length ? ` · missing ${Object.keys(bundle.errors).join(',')}` : ''}`);
  if (o.write) {
    // eslint-disable-next-line no-await-in-loop
    await db.collection('discogs_releases').doc(releaseId).set({ ...JSON.parse(JSON.stringify(bundle)), clientId: o.client, packageId: p.id });
    // eslint-disable-next-line no-await-in-loop
    await upsertPackage({ ...p, discogsSummary: summary }, { returnPackages: false, clientId: o.client });
  }
  done += 1;
}
console.log(`done ${done} · skipped (fresh) ${skipped} · failed ${failed}${o.write ? '' : ' · dry run, nothing written'}`);
process.exit(failed && !done ? 1 : 0);
