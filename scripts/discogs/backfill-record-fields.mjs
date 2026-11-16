#!/usr/bin/env node
// Fill x_content_packages/discogs-{id}.record ({ artists, title, label, catno, year }) for a client's Discogs record
// items that have neither discogsSummary nor record, so their posts can be written in full
// (features/social-posting/post-format.js). Source: Discogs' public release endpoint (no token, ~25 req/min).
// The full bundle + discogsSummary still come from scripts/discogs/refresh-releases.mjs (needs DISCOGS_TOKEN).
//
// DEFAULT IS A DRY RUN: fetches and prints, writes nothing. --write merges only the `record` field.
//   node scripts/discogs/backfill-record-fields.mjs --client <id> [--write] [--limit N]
// Run from a checkout that has .env.local (Firebase admin).

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null; };
const client = arg('--client');
const write = argv.includes('--write');
const limit = Number(arg('--limit')) || 0;
if (!client) { console.error('Usage: backfill-record-fields.mjs --client <id> [--write] [--limit N]'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const names = (list, key = 'name') => (Array.isArray(list) ? list.map((x) => String(x?.[key] ?? '').trim()).filter(Boolean) : []);

async function fetchRelease(id) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`https://api.discogs.com/releases/${id}`, { headers: { 'User-Agent': 'RecordFieldsBackfill/1.0', Accept: 'application/json' } });
    if (res.status === 429) { await sleep(60_000); continue; }
    if (!res.ok) return { error: res.status };
    return { release: await res.json() };
  }
  return { error: 429 };
}

const db = fb.adminDb;
const snap = await db.collection('x_content_packages').where('clientId', '==', client).get();
let todo = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => /^discogs-\d+$/.test(p.id) && !p.discogsSummary && !p.record);
if (limit) todo = todo.slice(0, limit);
console.log(`${todo.length} record item(s) without release fields for ${client} · ${write ? 'WRITE' : 'dry run'}`);

let ok = 0; let failed = 0;
for (const p of todo) {
  const id = p.id.slice('discogs-'.length);
  // eslint-disable-next-line no-await-in-loop
  const { release: r, error } = await fetchRelease(id);
  if (!r) { failed += 1; console.log(`  ${id}: fetch failed (${error})`); continue; }
  const record = {
    artists: names(r.artists),
    title: r.title || null,
    label: names(r.labels)[0] || null,
    catno: names(r.labels, 'catno')[0] || null,
    year: Number(r.year) > 0 ? Number(r.year) : null,
    source: 'discogs-public',
  };
  console.log(`  ${id}: ${record.artists.join(', ')} | ${record.title} | ${record.label} | ${record.catno} · ${record.year ?? '?'}`);
  if (write) {
    // eslint-disable-next-line no-await-in-loop
    await db.collection('x_content_packages').doc(p.id).set({ record }, { merge: true });
  }
  ok += 1;
  // eslint-disable-next-line no-await-in-loop
  await sleep(2600);
}
console.log(`${write ? 'written' : 'would write'} ${ok}, failed ${failed}`);
process.exit(0);
