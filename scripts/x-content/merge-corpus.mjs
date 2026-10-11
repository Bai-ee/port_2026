#!/usr/bin/env node
// Refresh a committed X corpus (docs/audits/{bai-ee,seb-design}-x-corpus.json) by merge.
// Pulls fresh rows via ingest-corpus.mjs (local bird, free), merges with mergeRowsById.
//
//   node scripts/x-content/merge-corpus.mjs --handle bai_ee --tz -5 --days 65 [--dry-run]
//
// Never calls the X API / ScrapeCreators. Writes only when ingest succeeds.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRowsById } from '../../features/x-strategy/corpus-rows.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = {
  bai_ee: 'docs/audits/bai-ee-x-corpus.json',
  seb__design: 'docs/audits/seb-design-x-corpus.json',
};

function parseArgs(argv) {
  const out = { tz: 0, days: 65, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--handle') out.handle = String(argv[++i] || '').replace(/^@+/, '');
    else if (a === '--tz') out.tz = Number(argv[++i]) || 0;
    else if (a === '--days') out.days = Number(argv[++i]) || 65;
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

const viewsCount = (rows) => rows.filter((r) => r.views !== null && r.views !== undefined).length;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rel = FILES[args.handle];
  if (!rel) {
    process.stderr.write(`ERROR: --handle must be one of ${Object.keys(FILES).join(', ')}\n`);
    process.exit(1);
  }
  const target = path.join(ROOT, rel);
  const scratch = process.env.MERGE_CORPUS_TMP_DIR || path.join(tmpdir(), 'merge-corpus');
  mkdirSync(scratch, { recursive: true });
  const tmpOut = path.join(scratch, `${args.handle}-incoming.json`);

  const run = spawnSync(
    process.execPath,
    [
      ...(existsSync(path.join(ROOT, '.env.local')) ? ['--env-file=.env.local'] : []),
      'scripts/x-content/ingest-corpus.mjs',
      '--handle', args.handle, '--tz', String(args.tz), '--days', String(args.days), '--out', tmpOut,
    ],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (run.status !== 0 || !existsSync(tmpOut)) {
    process.stderr.write('ingest failed (bird unavailable / 429 / no posts) — corpus left unchanged.\n');
    process.exit(1);
  }

  const existing = JSON.parse(readFileSync(target, 'utf8'));
  const incoming = JSON.parse(readFileSync(tmpOut, 'utf8'));
  const merged = mergeRowsById(existing, incoming);

  const existingIds = new Map(existing.map((r) => [String(r.id), r]));
  const mergedIds = new Map(merged.map((m) => [String(m.id), m]));
  let updated = 0;
  let viewsKept = 0;
  let isNew = 0;
  for (const r of incoming) {
    const prev = existingIds.get(String(r.id));
    if (!prev) { isNew += 1; continue; }
    if (JSON.stringify(prev) !== JSON.stringify(mergedIds.get(String(r.id)))) updated += 1;
    if ((r.views === null || r.views === undefined) && prev.views !== null && prev.views !== undefined) viewsKept += 1;
  }

  process.stdout.write(
    `\n@${args.handle}: existing=${existing.length} incoming=${incoming.length} new=${isNew} updated=${updated} views-kept=${viewsKept}\n` +
    `  merged=${merged.length} rows-with-views ${viewsCount(existing)} -> ${viewsCount(merged)}\n`,
  );
  if (viewsCount(merged) < viewsCount(existing)) {
    process.stderr.write('ABORT: views count would decrease.\n');
    process.exit(1);
  }
  if (args.dryRun) {
    process.stdout.write('Dry run: nothing written.\n');
    return;
  }
  writeFileSync(target, JSON.stringify(merged, null, 2), 'utf8'); // existing files have no trailing newline
  process.stdout.write(`Wrote ${rel}\n`);
}

main();
