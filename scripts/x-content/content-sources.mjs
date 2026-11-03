#!/usr/bin/env node
// Show or set a client's content sources (client_configs/{clientId}.contentSources, see
// features/x-content-inventory/content-sources.js): the clients whose content it may use, the bucket each source's
// rows show in, and the access ('full' = may edit; 'read' = read-only).
//
// DEFAULT IS A DRY RUN: prints the current list, the proposed list and the row count per source. Nothing is written.
// --apply (OWNER ONLY): writes the proposed list (merge; touches no other field).
//
// Usage:
//   node scripts/x-content/content-sources.mjs --client <id>                          # show
//   node scripts/x-content/content-sources.mjs --client <id> --set <src:bucket[:access],...>          # dry run
//   node scripts/x-content/content-sources.mjs --client <id> --set <src:bucket[:access],...> --apply  # OWNER ONLY
//   access defaults to full. --set ""  clears the list.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireClientArg } from './_client-arg.mjs';
import { normalizeContentSources, readContentSources } from '../../features/x-content-inventory/content-sources.js';
import { listBuckets } from '../../features/x-content-inventory/bucket-store.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

const clientId = requireClientArg();
const argv = process.argv.slice(2);
const si = argv.indexOf('--set');
const apply = argv.includes('--apply');
const db = fb.adminDb;

const fmt = (list) => (list.length ? list.map((e) => `${e.clientId}:${e.bucketId || '-'}:${e.access}`).join(', ') : '(none)');
const current = await readContentSources(clientId, { db });
console.log(`client   ${clientId}`);
console.log(`current  ${fmt(current)}`);

if (si > -1) {
  const raw = String(argv[si + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, bucketId, access] = s.split(':');
    return { clientId: id, bucketId: bucketId || null, access: access || 'full' };
  });
  const next = normalizeContentSources(raw, clientId);
  const dropped = raw.filter((x) => !next.some((e) => e.clientId === x.clientId));
  if (dropped.length) console.log(`ignored  ${dropped.map((x) => x.clientId).join(', ')} (invalid, duplicate or self)`);
  const buckets = new Set((await listBuckets(clientId, { db })).map((b) => b.id));
  for (const e of next) {
    if (!(await db.collection('clients').doc(e.clientId).get()).exists) { console.error(`unknown client: ${e.clientId}`); process.exit(1); }
    if (e.bucketId && !buckets.has(e.bucketId)) { console.error(`unknown bucket for ${clientId}: ${e.bucketId}`); process.exit(1); }
    const rows = (await db.collection('x_content_packages').where('clientId', '==', e.clientId).count().get()).data().count;
    console.log(`source   ${e.clientId} -> bucket ${e.bucketId || '(own)'}, ${e.access}  ${rows} rows`);
  }
  console.log(`proposed ${fmt(next)}`);
  if (!apply) {
    console.log('dry run — pass --apply to write.');
  } else {
    await db.collection('client_configs').doc(clientId).set({ contentSources: next }, { merge: true });
    console.log(`written  ${fmt(await readContentSources(clientId, { db }))}`);
  }
}
process.exit(0);
