#!/usr/bin/env node
// Backfill 320px thumbs for discogs-* packages (Content Engine v2 §5b).
//
// DEFAULT IS A DRY RUN: lists discogs-* packages without `thumbRef` and checks
// whether publish-staging/discogs/<id>/image-1x1.jpg exists. Nothing is written
// unless --write (OWNER ONLY). Zero X / LLM / paid calls; Hitloop Firestore +
// Storage only.
//
// Usage:
//   node scripts/x-content/backfill-discogs-thumbs.mjs --client <clientId>
//   node scripts/x-content/backfill-discogs-thumbs.mjs --client <clientId> --write   # OWNER ONLY

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { thumbPathFor, makeThumbJpeg, uploadThumb } from '../../features/x-content-inventory/thumbs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const write = process.argv.includes('--write');
const clientId = arg('client', process.env.HITLOOP_CLIENT_ID || '');
if (!clientId) { console.error('--client <clientId> is required (thumbs live under content-thumbs/<clientId>/).'); process.exit(2); }

require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
const { upsertPackage } = await import('../../features/x-content-inventory/store.js');

const bucket = fb.adminStorage.bucket();
const snap = await fb.adminDb.collection('x_content_packages').orderBy('__name__').startAt('discogs-').endAt('discogs-').get();
const todo = snap.docs.filter((d) => !d.data().thumbRef);
console.log(`Discogs thumb backfill (${write ? 'WRITE' : 'DRY RUN'}) | discogs packages: ${snap.size} | missing thumbRef: ${todo.length}`);

let ok = 0; let missing = 0; let failed = 0;
for (const d of todo) {
  const relId = d.id.replace(/^discogs-/, '');
  const src = `publish-staging/discogs/${relId}/image-1x1.jpg`;
  const [exists] = await bucket.file(src).exists();
  if (!exists) { missing += 1; console.log(`  - ${d.id}: no source image`); continue; }
  if (!write) { ok += 1; continue; }
  try {
    const [buf] = await bucket.file(src).download();
    const jpeg = await makeThumbJpeg(buf, { enforceMaxInput: false });
    const ref = thumbPathFor(clientId, d.id);
    await uploadThumb(bucket, ref, jpeg);
    await upsertPackage({ id: d.id, ...d.data(), thumbRef: ref }, { returnPackages: false });
    ok += 1;
  } catch (e) { failed += 1; console.log(`  ! ${d.id}: ${e.message}`); }
}
console.log(`${write ? 'written' : 'would write'}: ${ok} | no source: ${missing} | failed: ${failed}`);
if (!write) console.log('dry run: nothing written. Re-run with --write (owner only).');
