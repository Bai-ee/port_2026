#!/usr/bin/env node
// One-shot backfill for multi-client Phase 3a: stamp `clientId` on every x_content_packages row that has none.
// DRY RUN BY DEFAULT: reads the whole collection, prints counts + sample ids, writes nothing.
//
//   node scripts/x-content/backfill-package-client.mjs                                   # dry run (reads only)
//   node scripts/x-content/backfill-package-client.mjs --write --client bryan-balli-WUoltG84
//
// Idempotent: only rows WITHOUT a clientId are touched (merge, one field), so a re-run writes 0. Rows that already
// carry a clientId are counted and never changed. Batches of ≤400 writes. Never touches X, the meta doc, or any
// other collection. Keep a pre-write export (scratchpad, never the repo) before --write.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLLECTION = 'x_content_packages';
export const BATCH_MAX = 400;
const PAGE = 1000;
const SAMPLE = 10;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

/**
 * Pure: what the backfill would do over these rows.
 * @param {{id:string, clientId?:unknown}[]} rows
 * @returns {{total:number, missing:string[], byClient:Record<string,number>, batches:string[][]}}
 */
export function planBackfill(rows) {
  const missing = [];
  const byClient = {};
  for (const r of rows || []) {
    const c = typeof r?.clientId === 'string' ? r.clientId.trim() : '';
    if (c) byClient[c] = (byClient[c] || 0) + 1;
    else missing.push(r.id);
  }
  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH_MAX) batches.push(missing.slice(i, i + BATCH_MAX));
  return { total: (rows || []).length, missing, byClient, batches };
}

/** Reads every row's id + clientId, paged by document id. */
export async function readAllRows(db) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection(COLLECTION).orderBy('__name__').select('clientId').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) rows.push({ id: d.id, clientId: d.get('clientId') });
    if (snap.docs.length < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

/** Writes `clientId` onto the planned rows only. Returns the number of docs written. */
export async function applyBackfill(db, plan, clientId) {
  let written = 0;
  for (const ids of plan.batches) {
    const batch = db.batch();
    for (const id of ids) batch.set(db.collection(COLLECTION).doc(id), { clientId }, { merge: true });
    await batch.commit();
    written += ids.length;
  }
  return written;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? String(process.argv[i + 1] || '').trim() : '';
}

async function main() {
  const write = process.argv.includes('--write');
  const clientId = arg('--client');
  if (write && !CLIENT_ID_RE.test(clientId)) throw new Error('--write needs --client <id> (no default).');

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;

  if (write && !(await db.collection('clients').doc(clientId).get()).exists) throw new Error(`clients/${clientId} does not exist.`);

  const plan = planBackfill(await readAllRows(db));
  console.log(JSON.stringify({
    mode: write ? 'WRITE' : 'DRY RUN (nothing written)',
    collection: COLLECTION,
    totalRows: plan.total,
    rowsWithoutClientId: plan.missing.length,
    rowsWithClientId: plan.byClient,
    batches: plan.batches.length,
    sampleIdsWithoutClientId: plan.missing.slice(0, SAMPLE),
  }, null, 2));
  if (!write) {
    console.log(`\nTo apply: node scripts/x-content/backfill-package-client.mjs --write --client <id>  (would write ${plan.missing.length} docs)`);
    return;
  }
  const written = await applyBackfill(db, plan, clientId);
  const after = planBackfill(await readAllRows(db));
  console.log(`\nwrote clientId=${clientId} on ${written} docs; rows still without clientId: ${after.missing.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
}
