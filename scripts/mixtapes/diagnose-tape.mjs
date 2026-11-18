#!/usr/bin/env node
// Read-only diagnostics for a trimmed cassette mix (Phase 2a, step A).
// Usage: node scripts/mixtapes/diagnose-tape.mjs --in <file> [--staging ~/mixtape-work] [--out <json>]
// Copies the input once to <staging>/diag/<stem>/ (sha256 verified), analyses the local copy,
// writes JSON + prints a short summary. Never writes to the input's directory.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stemOf } from '../../features/mixtape-processing/trim-io-helpers.js';
import { runDiagnostics, summaryText } from './lib/diagnose-run.mjs';
import { acquireLock, stageInput } from './lib/staging.mjs';

const DEFAULT_IN = '/Volumes/bryan/Mix_Tapes_For_Processing/_trimmed/REC020.trimmed.wav';
const cleanup = { lockDir: null };

function parseArgs(argv) {
  const o = { in: DEFAULT_IN, staging: path.join(os.homedir(), 'mixtape-work'), out: null };
  const need = (i) => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') o.in = need(i++);
    else if (a === '--staging') o.staging = need(i++);
    else if (a === '--out') o.out = need(i++);
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  const home = (p) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  o.in = home(o.in);
  o.staging = home(o.staging);
  if (o.out) o.out = home(o.out);
  return o;
}

const HELP = `diagnose-tape: read-only tape diagnostics (hum, azimuth, balance, rolloff, hiss, loudness)
  --in <file>        trimmed tape (default ${DEFAULT_IN})
  --staging <dir>    local work dir (default ~/mixtape-work); input is copied to <dir>/diag/<stem>/
  --out <json>       JSON output (default <staging>/diag/<stem>.diag.json)`;

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  if (!fs.existsSync(opts.in)) throw new Error(`input not found: ${opts.in}`);
  const stem = stemOf(opts.in);
  const diagRoot = path.join(opts.staging, 'diag');
  const dir = path.join(diagRoot, stem);
  if (!stem || !dir.startsWith(diagRoot + path.sep)) throw new Error('bad staging path');
  const outPath = opts.out || path.join(diagRoot, `${stem}.diag.json`);
  if (outPath === '/Volumes' || outPath.startsWith('/Volumes/')) throw new Error('--out under /Volumes is refused (read-only on the NAS)');

  const release = await acquireLock(opts.staging);
  cleanup.lockDir = opts.staging;
  try {
    const staged = await stageInput(opts.in, dir, { log: console.log });
    let trimJson = null;
    try { trimJson = JSON.parse(await fsp.readFile(path.join(path.dirname(opts.in), `${stem.replace(/\.trimmed$/, '')}.trim.json`), 'utf8')); } catch { /* optional */ }
    const result = await runDiagnostics(staged.file, {
      input: { path: opts.in, name: path.basename(opts.in), size: staged.size, sha256: staged.sha256 },
      trimJson,
      log: console.log,
    });
    // only auto-create dirs under the staging root; an explicit --out elsewhere must already exist
    if (path.dirname(outPath) === diagRoot || path.dirname(outPath).startsWith(diagRoot + path.sep)) await fsp.mkdir(path.dirname(outPath), { recursive: true });
    const part = `${outPath}.part`;
    await fsp.writeFile(part, JSON.stringify(result, null, 2) + '\n');
    await fsp.rename(part, outPath);
    console.log(`\n${summaryText(result)}\n\njson: ${outPath}`);
    return 0;
  } finally { await release(); }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { if (cleanup.lockDir) fs.rmSync(path.join(cleanup.lockDir, '.lock'), { force: true }); } catch { /* best effort */ }
    process.exit(130);
  });
}

main().then((c) => process.exit(c), (e) => { console.error(`error: ${e.message}`); process.exit(1); });
