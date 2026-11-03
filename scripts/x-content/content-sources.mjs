#!/usr/bin/env node
// Show or set a client's content sources (client_configs/{clientId}.contentSources, see
// features/x-content-inventory/content-sources.js): the clients whose content it may READ.
//
// DEFAULT IS A DRY RUN: prints the current list, the proposed list and the row count per source. Nothing is written.
// --apply (OWNER ONLY): writes the proposed list (merge; touches no other field).
//
// Usage:
//   node scripts/x-content/content-sources.mjs --client <id>                          # show
//   node scripts/x-content/content-sources.mjs --client <id> --set <idA,idB>          # dry run
//   node scripts/x-content/content-sources.mjs --client <id> --set <idA,idB> --apply  # OWNER ONLY
//   --set ""  clears the list.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireClientArg } from './_client-arg.mjs';
import { normalizeContentSources, readContentSources } from '../../features/x-content-inventory/content-sources.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

const clientId = requireClientArg();
const argv = process.argv.slice(2);
const si = argv.indexOf('--set');
const apply = argv.includes('--apply');
const db = fb.adminDb;

const current = await readContentSources(clientId, { db });
console.log(`client   ${clientId}`);
console.log(`current  ${current.length ? current.join(', ') : '(none)'}`);

if (si > -1) {
  const raw = String(argv[si + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const next = normalizeContentSources(raw, clientId);
  const dropped = raw.filter((x) => !next.includes(x));
  if (dropped.length) console.log(`ignored  ${dropped.join(', ')} (invalid, duplicate or self)`);
  for (const s of next) {
    const exists = (await db.collection('clients').doc(s).get()).exists;
    if (!exists) { console.error(`unknown client: ${s}`); process.exit(1); }
    const rows = (await db.collection('x_content_packages').where('clientId', '==', s).count().get()).data().count;
    console.log(`source   ${s}  ${rows} rows`);
  }
  console.log(`proposed ${next.length ? next.join(', ') : '(none)'}`);
  if (!apply) {
    console.log('dry run — pass --apply to write.');
  } else {
    await db.collection('client_configs').doc(clientId).set({ contentSources: next }, { merge: true });
    console.log(`written  ${(await readContentSources(clientId, { db })).join(', ') || '(none)'}`);
  }
}
process.exit(0);
