#!/usr/bin/env node
// Seed the Ideas bucket (bucketId 'client') from client-stories.json (16) and
// ue build-stories.json (6).
//
// DRY RUN is the default: maps + prints a table, touches nothing. Offline it
// cannot know what already exists, so every row shows as "new" unless you pass
// `--existing ids.json` (a JSON array of package ids) to simulate the skip.
// `--write` is OWNER-ONLY: it reads the live inventory, skips ids that already
// exist, and upserts the rest with {returnPackages:false}. It never posts and
// makes no X API calls.
//
//   node scripts/x-content/seed-ideas.mjs
//   node scripts/x-content/seed-ideas.mjs --existing ids.json
//   node scripts/x-content/seed-ideas.mjs --write        # owner only

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toIdeaPackage } from '../../features/x-content-inventory/ideas.js';
import { validatePackage } from '../../features/x-content-inventory/schema.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const readJson = (rel) => JSON.parse(readFileSync(path.join(REPO, rel), 'utf8'));

export function buildSeed() {
  return [
    ...readJson('features/x-content-inventory/client-stories.json').map((r) => toIdeaPackage(r, { kind: 'client' })),
    ...readJson('features/ue-content/build-stories.json').map((r) => toIdeaPackage(r, { kind: 'build' })),
  ];
}

/** Pure plan: which packages are new vs already present. `existingIds` is injected. */
export function planSeed(packages, existingIds = new Set()) {
  return packages.map((pkg) => {
    const v = validatePackage(pkg);
    return { pkg, ok: v.ok, errors: v.errors, exists: existingIds.has(pkg.id) };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const exIdx = argv.indexOf('--existing');
  let existing = new Set();
  if (exIdx >= 0) existing = new Set(JSON.parse(readFileSync(argv[exIdx + 1], 'utf8')));

  const packages = buildSeed();
  let store = null;
  if (write) {
    store = await import('../../features/x-content-inventory/store.js');
    const inv = await store.readInventory();
    existing = new Set(inv.packages.map((p) => p.id));
  }
  const plan = planSeed(packages, existing);

  console.log(`${write ? 'WRITE' : 'DRY RUN'} — Ideas bucket seed`);
  for (const p of plan) {
    console.log([p.exists ? 'skip' : p.ok ? 'new ' : 'BAD ', p.pkg.tags[0].padEnd(6), p.pkg.approval?.state.padEnd(7), p.pkg.id, ...(p.ok ? [] : p.errors)].join('  '));
  }
  const fresh = plan.filter((p) => !p.exists && p.ok);
  console.log(`total ${plan.length} · new ${fresh.length} · skipped ${plan.filter((p) => p.exists).length} · invalid ${plan.filter((p) => !p.ok).length}`);

  if (write) {
    for (const p of fresh) await store.upsertPackage(p.pkg, { returnPackages: false });
    console.log(`wrote ${fresh.length}`);
  } else {
    console.log('dry run — nothing written. Re-run with --write (owner only) to upsert.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
