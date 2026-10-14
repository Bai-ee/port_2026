#!/usr/bin/env node
// One-time seed of the home client's X growth priors into its OWN stored config (multi-client Phase 4.4).
//
// The code no longer defaults any client to @bai_ee / @seb__design / the curated quote-target watchlist.
// The home client keeps today's behaviour by storing those values itself, at
// client_configs/{clientId}.marketingBriefConfig.xGrowth:
//   ownHandle 'bai_ee', benchmarkHandles ['seb__design'], timezone 'America/Chicago', watchlist HOME_SEED_WATCHLIST
//
// Rules: DRY RUN by default (prints what it would write); --client <id> is required (no default client);
// fills ONLY fields that are currently empty, never overwrites; --write applies with a merge write inside a
// transaction (re-planned against the live doc). The Client Brain still owns the handle fields afterwards.
//
// Usage:
//   node scripts/x-content/seed-home-priors.mjs --client <id>            # dry run
//   node scripts/x-content/seed-home-priors.mjs --client <id> --write    # apply (owner go only)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HOME_SEED_WATCHLIST } from '../../features/x-quote-targets/watchlist.js';

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const HOME_PRIORS = Object.freeze({
  ownHandle: 'bai_ee',
  benchmarkHandles: Object.freeze(['seb__design']),
  timezone: 'America/Chicago',
  watchlist: HOME_SEED_WATCHLIST,
});

const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : v === undefined || v === null || String(v).trim() === '');

/**
 * Pure planner: which prior fields to write into an existing xGrowth block. Only empty fields are filled.
 * @param {object|null} xGrowth  current client_configs/{id}.marketingBriefConfig.xGrowth (or null)
 * @param {object} [priors]
 * @returns {{patch:object, fill:string[], keep:string[]}}
 */
export function planHomePriors(xGrowth, priors = HOME_PRIORS) {
  const current = xGrowth && typeof xGrowth === 'object' ? xGrowth : {};
  const patch = {};
  const fill = [];
  const keep = [];
  for (const field of ['ownHandle', 'benchmarkHandles', 'timezone', 'watchlist']) {
    if (isEmpty(current[field])) {
      const v = priors[field];
      patch[field] = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? { ...x } : x)) : v;
      fill.push(field);
    } else {
      keep.push(field);
    }
  }
  return { patch, fill, keep };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? String(process.argv[i + 1] || '').trim() : '';
}

function describe(plan) {
  return {
    fill: plan.fill.map((f) => (f === 'watchlist' ? `watchlist (${plan.patch.watchlist.length} accounts)` : `${f} = ${JSON.stringify(plan.patch[f])}`)),
    keepExisting: plan.keep,
  };
}

async function main() {
  const write = process.argv.includes('--write');
  const clientId = arg('--client');
  if (!CLIENT_ID_RE.test(clientId)) throw new Error('--client <id> is required (no default client).');

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;

  if (!(await db.collection('clients').doc(clientId).get()).exists) throw new Error(`clients/${clientId} does not exist.`);
  const ref = db.collection('client_configs').doc(clientId);
  const snap = await ref.get();
  const plan = planHomePriors(snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null);

  console.log(JSON.stringify({
    mode: write ? 'WRITE' : 'DRY RUN (nothing written)',
    target: `client_configs/${clientId}.marketingBriefConfig.xGrowth`,
    ...describe(plan),
  }, null, 2));

  if (!plan.fill.length) {
    console.log('\nNothing to seed: every prior field is already set.');
    return;
  }
  if (!write) {
    console.log(`\nTo apply (owner go only): node scripts/x-content/seed-home-priors.mjs --client ${clientId} --write`);
    return;
  }

  // Re-plan against the live doc inside a transaction so a concurrent save is never overwritten.
  const written = await db.runTransaction(async (tx) => {
    const live = await tx.get(ref);
    const p = planHomePriors(live.exists ? live.data()?.marketingBriefConfig?.xGrowth ?? null : null);
    if (p.fill.length) tx.set(ref, { marketingBriefConfig: { xGrowth: p.patch } }, { merge: true });
    return p.fill;
  });
  console.log(`\nwrote ${written.length ? written.join(', ') : 'nothing (already set)'} to client_configs/${clientId}.marketingBriefConfig.xGrowth`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
}
