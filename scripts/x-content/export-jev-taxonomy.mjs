#!/usr/bin/env node
// Emit the Jev question set as plain JSON for the Archive worker to vendor.
//
// WHY THIS EXISTS: the worker is TypeScript in `Bai-ee/assetManager` and cannot
// import `features/x-content-inventory/jev-taxonomy.js`. Without a shared
// artifact the two sides keep their own copy of the vocabulary and drift —
// which is not hypothetical here: the first two X corpora were tagged by two
// hand-written taggers and shared 1 topic label out of 28, which made every
// benchmark topic read as "0% of your output".
//
// THIS module is the source. The JSON is a build output. The worker's copy is a
// vendored artifact. Regenerate on every vocabulary change or the two sides
// silently disagree.
//
// COST: zero. Pure local computation, no network.
//
// Usage:
//   node scripts/x-content/export-jev-taxonomy.mjs            # write the artifact
//   node scripts/x-content/export-jev-taxonomy.mjs --stdout   # print, write nothing
//   node scripts/x-content/export-jev-taxonomy.mjs --check    # exit 1 if stale (CI)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportForWorker } from '../../features/x-content-inventory/jev-taxonomy.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const OUT = path.join(REPO, 'features/x-content-inventory/jev-taxonomy.export.json');

const args = new Set(process.argv.slice(2));
const toStdout = args.has('--stdout');
const checkOnly = args.has('--check');

const payload = exportForWorker();
const serialized = `${JSON.stringify(payload, null, 2)}\n`;

if (toStdout) {
  process.stdout.write(serialized);
  process.exit(0);
}

/** Everything that is actually the contract, with the timestamp removed.
 *
 * `generatedAt` changes on every run. Comparing the whole file would rewrite
 * the artifact each time it is generated and fill the history with diffs that
 * carry no vocabulary change — and would make `--check` fail in CI for no
 * reason at all. The timestamp rides along for humans; it is not the contract. */
function contractOf(obj) {
  const { generatedAt, ...rest } = obj ?? {};
  return JSON.stringify(rest);
}

const previous = existsSync(OUT) ? (() => {
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return null; }
})() : null;

const unchanged = previous && contractOf(previous) === contractOf(payload);

if (checkOnly) {
  if (!previous) {
    console.error(`Missing ${path.relative(REPO, OUT)} — run: node scripts/x-content/export-jev-taxonomy.mjs`);
    process.exit(1);
  }
  if (!unchanged) {
    console.error(`${path.relative(REPO, OUT)} is stale. The worker would vendor a vocabulary this repo no longer uses.`);
    console.error('Run: node scripts/x-content/export-jev-taxonomy.mjs');
    process.exit(1);
  }
  console.log(`${path.relative(REPO, OUT)} is current (${payload.questions.length} questions).`);
  process.exit(0);
}

if (unchanged) {
  console.log(`${path.relative(REPO, OUT)} already current — not rewriting (${payload.questions.length} questions).`);
  process.exit(0);
}

writeFileSync(OUT, serialized);

const blocked = payload.questions.filter((q) => q.blocked);
const gates = payload.questions.filter((q) => q.gate);
console.log(`Wrote ${path.relative(REPO, OUT)}`);
console.log(`  ${payload.questions.length} questions · ${gates.length} gate · ${blocked.length} blocked`);
for (const q of blocked) console.log(`  ⚠ ${q.id}: ${q.blocked}`);
console.log('');
console.log('Vendor this into the worker (Bai-ee/assetManager, feat/archive-master-plan) so');
console.log('`JevDecisionService.decide(assetState, question, choices)` is called with these');
console.log('questions and these choices — not a second, hand-written copy of them.');
