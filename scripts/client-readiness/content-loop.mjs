#!/usr/bin/env node
// Content-loop readiness per client (features/client-readiness). READ-ONLY by default.
//
//   node scripts/client-readiness/content-loop.mjs                       # report every client (reads only)
//   node scripts/client-readiness/content-loop.mjs --client <id>         # report one client (reads only)
//   node scripts/client-readiness/content-loop.mjs --client <id> --enable-loop           # DRY RUN: prints the write
//   node scripts/client-readiness/content-loop.mjs --client <id> --enable-loop --write   # sets clients/{id}.contentLoop.enabled = true
//   node scripts/client-readiness/content-loop.mjs --client <id> --disable-loop --write  # sets it back to false
//
// The override exists for a client the owner runs on purpose before its Brain/plan/X are all in place
// (e.g. the home client while its Brain is `stale`). Writes one field on one doc; never touches X.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readClientReadiness, resolveClientXHandle } from '../../features/client-readiness/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const clientArg = argv.includes('--client') ? String(argv[argv.indexOf('--client') + 1] || '').trim() : '';

function line(r, h) {
  const missing = r.missing.map((m) => m.input).join(', ') || '-';
  return `${r.clientId.padEnd(36)} ${(r.ready ? 'READY' : 'not ready').padEnd(10)} override=${r.override} brain=${r.brainStatus || 'none'} missing=${missing} handle=${h.handle ? `@${h.handle} (${h.source})` : 'none'}`;
}

async function main() {
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;
  const enable = flag('--enable-loop');
  const disable = flag('--disable-loop');
  if ((enable || disable) && !clientArg) throw new Error('--enable-loop/--disable-loop need --client <id>.');
  if (enable && disable) throw new Error('Pick one of --enable-loop / --disable-loop.');

  const ids = clientArg ? [clientArg] : (await db.collection('clients').select().get()).docs.map((d) => d.id);
  for (const id of ids) console.log(line(await readClientReadiness(db, id), await resolveClientXHandle(db, id)));

  if (!enable && !disable) return;
  const r = await readClientReadiness(db, clientArg);
  if (!r.exists) throw new Error(`clients/${clientArg} does not exist; refusing to create it.`);
  const patch = { contentLoop: { enabled: enable } };
  if (!flag('--write')) {
    console.log(`\nDRY RUN — would set clients/${clientArg}.contentLoop.enabled = ${enable} (1 doc, merge). Add --write to apply.`);
    return;
  }
  await db.collection('clients').doc(clientArg).set(patch, { merge: true });
  console.log(`\nwrote clients/${clientArg}.contentLoop.enabled = ${enable}`);
  console.log(line(await readClientReadiness(db, clientArg), await resolveClientXHandle(db, clientArg)));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
