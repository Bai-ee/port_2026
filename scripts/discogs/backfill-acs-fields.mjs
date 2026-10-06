// Backfill ACS additive fields onto existing discogs-* x_content_packages and
// their social_posts (packageId join key). Only ADDS missing fields; never overwrites.
// Usage: node scripts/discogs/backfill-acs-fields.mjs [--dry-run]
// Reads FIREBASE_ADMIN_* from .env.local. No X calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildAcsFields, mergeMissing, packageId, packageIdPatch, DISCOGS_SOURCE } from '../../features/discogs-ingest/draft-builder.js';

const DRY = process.argv.includes('--dry-run');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

/** Rebuild the ingest request shape from a stored package (variants are recovered from assetRefs). */
function reqFromPackage(pkg, releaseId) {
  const variants = {};
  for (const ref of pkg.assetRefs || []) {
    const m = String(ref).match(/\/(video|image)-(9x16|1x1)\.(mp4|jpg)$/);
    if (m) (variants[m[1]] ||= {})[m[2]] = ref;
  }
  const [artist = '', label = ''] = pkg.entities || [];
  return { releaseId, discogsUrl: pkg.cta, artist, label, year: pkg.eraYear == null ? '' : String(pkg.eraYear), variants };
}

const show = (o) => JSON.stringify(o);

async function main() {
  console.log(DRY ? 'DRY RUN: no writes.' : 'LIVE RUN: adding missing fields only.');
  const snap = await db.collection('x_content_packages').get();
  const pkgs = snap.docs.filter((d) => d.id.startsWith('discogs-'));
  console.log(`packages: ${pkgs.length} discogs-* of ${snap.size}`);
  let pkgChanges = 0;
  for (const d of pkgs) {
    const pkg = d.data();
    const releaseId = Number(d.id.slice('discogs-'.length));
    if (!Number.isInteger(releaseId) || !pkg.cta) { console.log(`SKIP ${d.id}: cannot derive releaseId/url`); continue; }
    const add = mergeMissing(pkg, buildAcsFields(reqFromPackage(pkg, releaseId)));
    const keys = Object.keys(add);
    if (!keys.length) { console.log(`ok   ${d.id}: nothing to add`); continue; }
    pkgChanges += 1;
    console.log(`pkg  ${d.id}: +${keys.join(',')}`);
    if (DRY) console.log(`       ${show(add)}`);
    else await d.ref.set(add, { merge: true });
  }

  const posts = await db.collection('social_posts').where('source', '==', DISCOGS_SOURCE).get();
  console.log(`social_posts: ${posts.size} with source=${DISCOGS_SOURCE}`);
  let postChanges = 0;
  for (const d of posts.docs) {
    const p = d.data();
    const rid = p.sourceRef?.releaseId;
    if (!Number.isInteger(rid)) { console.log(`SKIP post ${d.id}: no sourceRef.releaseId`); continue; }
    if (p.packageId) { console.log(`ok   post ${d.id}: packageId=${p.packageId}`); continue; }
    if (!pkgs.some((x) => x.id === packageId(rid))) console.log(`warn post ${d.id}: no package ${packageId(rid)} found`);
    postChanges += 1;
    console.log(`post ${d.id}: +packageId=${packageIdPatch(rid).packageId}`);
    if (!DRY) await d.ref.set(packageIdPatch(rid), { merge: true });
  }
  console.log(`\nsummary: ${pkgChanges} package(s) and ${postChanges} post(s) ${DRY ? 'would change' : 'changed'}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
