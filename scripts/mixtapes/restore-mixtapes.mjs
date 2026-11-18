#!/usr/bin/env node
// Restore trimmed cassette mixes (Phase 2b): V6 chain = clean-up + gentle hiss + air.
// Usage: node scripts/mixtapes/restore-mixtapes.mjs [--src DIR] [--dry-run | --write] [--only NAME|STEM]
//        [--force] [--staging DIR] [--allow-local-src]
// Reads <src>/_trimmed/<stem>.trimmed.* (+ .trim.json), writes <src>/_restored/ only with --write.
// Trimmed masters and originals are never modified.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fmtTime } from '../../features/mixtape-processing/trim-io-helpers.js';
import {
  RESTORE_VERSION, buildRestoreChain, buildRestoreJson, buildRestoreReportMd, isClipRisk, isUpToDate, listTrimmedNames,
  matchesOnly, outputFormat, parseAstatsPeak, renderFilter, trimJsonProblem,
} from '../../features/mixtape-processing/restore-plan.js';
import { DIAG_VERSION, runDiagnostics, summaryText } from './lib/diagnose-run.mjs';
import { FFMPEG, acquireLock, checkNasMount, ffmpegBase, niceRun, probeFile, publishToDir, sha256Of, stageInput } from './lib/staging.mjs';

const DEFAULT_SRC = '/Volumes/bryan/Mix_Tapes_For_Processing';
const cleanup = { work: null, lockDir: null, partFile: null, restoredDir: null }; // work dir, lock and in-flight NAS .part, for signal handlers

function parseArgs(argv) {
  const o = { src: DEFAULT_SRC, write: false, only: null, force: false, staging: path.join(os.homedir(), 'mixtape-work'), allowLocalSrc: false };
  const need = (i) => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') o.src = need(i++);
    else if (a === '--dry-run') dry = true;
    else if (a === '--write') o.write = true;
    else if (a === '--only') o.only = need(i++);
    else if (a === '--force') o.force = true;
    else if (a === '--staging') o.staging = need(i++);
    else if (a === '--allow-local-src') o.allowLocalSrc = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (dry && o.write) throw new Error('--dry-run and --write are mutually exclusive');
  o.staging = path.resolve(o.staging.replace(/^~(?=$|\/)/, os.homedir()));
  o.src = path.resolve(o.src);
  return o;
}

const HELP = `restore-mixtapes: restore trimmed cassette mixes (clean-up + gentle hiss + air); masters untouched
  --src <dir>          source dir (default ${DEFAULT_SRC}); reads <src>/_trimmed
  --dry-run            stage, diagnose and print the planned chain, no render, no NAS writes (DEFAULT)
  --write              render + publish to <src>/_restored (requires smbfs mount from 192.168.1.6)
  --only <name|stem>   exact trimmed filename or original stem (e.g. REC020)
  --force              reprocess / overwrite existing outputs
  --staging <dir>      local work dir (default ~/mixtape-work)
  --allow-local-src    TESTS ONLY: skip the smbfs mount check`;

const readJson = async (file) => JSON.parse(await fsp.readFile(file, 'utf8'));
const writeJsonAtomic = async (file, obj) => {
  const part = path.join(path.dirname(file), `.${path.basename(file)}.part`);
  await fsp.writeFile(part, JSON.stringify(obj, null, 2) + '\n');
  await fsp.rename(part, file);
};

/** Diagnostics for the staged tape, cached at <staging>/diag/<stem>.diag.json keyed on the trimmed sha256. */
async function diagnoseCached(staged, trimmedPath, trimJson, staging, name) {
  const cache = path.join(staging, 'diag', `${path.basename(name, path.extname(name))}.diag.json`);
  try {
    const prev = await readJson(cache);
    if (prev.diagVersion === DIAG_VERSION && prev.input?.sha256 === staged.sha256) { console.log(`   diagnostics: cached ${cache}`); return prev; }
  } catch { /* none or unreadable: run */ }
  const diag = await runDiagnostics(staged.file, {
    input: { path: trimmedPath, name, size: staged.size, sha256: staged.sha256 }, trimJson, log: (m) => console.log(`   ${m}`),
  });
  await fsp.mkdir(path.dirname(cache), { recursive: true });
  await writeJsonAtomic(cache, diag);
  return diag;
}

/** Peak (dBFS, both channels) of the rendered output via astats. */
async function measurePeak(file) {
  const { stderr } = await niceRun(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'info', '-i', file, '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-']);
  return parseAstatsPeak(stderr);
}

async function rebuildReport(restoredDir) {
  const reports = [];
  for (const n of (await fsp.readdir(restoredDir)).filter((x) => x.endsWith('.restore.json') && !x.startsWith('.'))) {
    try { reports.push(await readJson(path.join(restoredDir, n))); } catch { /* skip unreadable */ }
  }
  const part = path.join(restoredDir, '.REPORT.md.part');
  await fsp.writeFile(part, buildRestoreReportMd(reports));
  await fsp.rename(part, path.join(restoredDir, 'REPORT.md'));
}

// ---------- per tape ----------

async function processTape(entry, opts) {
  const { name, stem } = entry;
  const trimmedDir = path.join(opts.src, '_trimmed');
  const restoredDir = path.join(opts.src, '_restored');
  const trimmedPath = path.join(trimmedDir, name);
  const trimJsonName = `${stem}.trim.json`;
  console.log(`\n== ${name}`);

  let trimJson;
  try { trimJson = await readJson(path.join(trimmedDir, trimJsonName)); } catch { console.log(`   skipped: no readable ${trimJsonName}`); return 'skipped'; }
  const problem = trimJsonProblem(trimJson, name);
  if (problem) { console.log(`   skipped: ${problem}`); return 'skipped'; }
  const expectSha = trimJson.output.sha256;

  const jsonPath = path.join(restoredDir, `${stem}.restore.json`);
  if (!opts.force && fs.existsSync(jsonPath)) {
    try {
      const prev = await readJson(jsonPath);
      if (isUpToDate(prev, { trimmedSha256: expectSha, diagVersion: DIAG_VERSION }) && fs.existsSync(path.join(restoredDir, prev.output.name))) {
        console.log(`   already restored (same trimmed sha, restore v${RESTORE_VERSION}), skipping`);
        return 'skipped';
      }
    } catch { /* unreadable json: reprocess */ }
  }

  const st = await fsp.stat(trimmedPath);
  await fsp.mkdir(opts.staging, { recursive: true });
  const freeBytes = async () => { const f = await fsp.statfs(opts.staging); return f.bavail * f.bsize; };
  // staged input + rendered output + f32 working size (stereo-ish upper bound)
  const f32Bytes = trimJson.output.samples * 2 * 4;
  const need = st.size * 3 + f32Bytes;
  if ((await freeBytes()) < need) { console.log(`   skipped: needs ${(need / 1e9).toFixed(1)} GB free in staging`); return 'skipped'; }

  const workRoot = path.join(opts.staging, 'restore');
  const work = path.join(workRoot, stem);
  if (!stem || !work.startsWith(workRoot + path.sep)) throw new Error('bad staging path');
  cleanup.work = work;
  try {
    await fsp.mkdir(work, { recursive: true });
    const staged = await stageInput(trimmedPath, work, { expectSha, log: (m) => console.log(`   ${m}`) });
    if (staged.sha256 !== expectSha) throw new Error(`trimmed file sha256 ${staged.sha256.slice(0, 12)} does not match trim.json output ${expectSha.slice(0, 12)}`);
    const probe = await probeFile(staged.file);
    if (probe.totalSamples !== trimJson.output.samples) throw new Error(`trimmed sample count ${probe.totalSamples} != trim.json ${trimJson.output.samples}`);

    const diag = await diagnoseCached(staged, trimmedPath, trimJson, opts.staging, name);
    console.log(summaryText(diag).split('\n').map((l) => `   ${l}`).join('\n'));

    const plan = buildRestoreChain(diag, probe.totalSamples);
    const format = outputFormat(probe, path.extname(name));
    const outName = `${stem}.restored.${format.ext}`;
    console.log(`   plan: ${plan.chainLabel}  chain ${plan.chainHash}`);
    console.log(`   chain: ${plan.chain}`);
    console.log(`   steps: hum ${plan.steps.hum.length ? plan.steps.hum.map((h) => `${h.freq} Hz ${h.gainDb} dB`).join(', ') : 'none'}; balance ${plan.steps.balanceDb ?? 'none'}; azimuth ${plan.steps.azimuth ?? 'none'}; air ${plan.steps.air ? 'yes' : 'skipped (full band)'}; nf ${plan.nfUsedDb} dB`);
    console.log(`   output: ${outName}  ${probe.totalSamples} samples (${fmtTime(probe.durationS)}), ${format.bits}-bit${format.dither ? ' + triangular_hp dither' : ''}, no loudness change`);

    if (!opts.force && fs.existsSync(jsonPath)) {
      try { if (isUpToDate(await readJson(jsonPath), { trimmedSha256: expectSha, chainHash: plan.chainHash, diagVersion: DIAG_VERSION })) { console.log('   already restored (same chain hash), skipping'); return 'skipped'; } } catch { /* reprocess */ }
    }

    if (!opts.write) {
      const dir = path.join(opts.staging, 'restore', 'reports');
      await fsp.mkdir(dir, { recursive: true });
      await writeJsonAtomic(path.join(dir, `${stem}.restore-plan.json`), { restoreVersion: RESTORE_VERSION, ...plan, output: { name: outName, samples: probe.totalSamples, bits: format.bits, dither: format.dither }, trimmedSha256: expectSha });
      console.log(`   dry-run: no render. plan -> ${path.join(dir, `${stem}.restore-plan.json`)}`);
      return 'ok';
    }

    // ---- write mode ----
    const outPath = path.join(work, outName);
    await fsp.rm(outPath, { force: true });
    console.log('   rendering (one ffmpeg pass)...');
    await niceRun(FFMPEG, [...ffmpegBase, '-y', '-i', staged.file, '-af', renderFilter(plan.chain, format), '-map_metadata', '0', ...format.codecArgs, outPath]);
    const outProbe = await probeFile(outPath);
    if (outProbe.totalSamples !== probe.totalSamples) throw new Error(`rendered sample count ${outProbe.totalSamples} != input ${probe.totalSamples}`);
    if (outProbe.sampleRate !== probe.sampleRate || outProbe.channels !== probe.channels) throw new Error('rendered rate/channels differ from input');
    const peakDbfs = await measurePeak(outPath);
    if (isClipRisk(peakDbfs)) throw new Error(`CLIP_RISK: output peak ${peakDbfs} dBFS is above -0.1 dBFS; not published (no silent gain applied)`);
    const outSha = await sha256Of(outPath);

    if (!fs.existsSync(opts.src)) throw new Error('src vanished');
    await checkNasMount(opts.src, opts.allowLocalSrc);
    // only <src>/_restored, non-recursive: never create parents under /Volumes
    await fsp.mkdir(restoredDir).catch((e) => { if (e.code !== 'EEXIST') throw e; });
    cleanup.restoredDir = restoredDir;
    cleanup.partFile = `.${outName}.part`;
    try { await publishToDir(outPath, restoredDir, outName, opts.force); } catch (e) {
      await fsp.rm(path.join(restoredDir, `.${outName}.part`), { force: true }).catch(() => {});
      throw e;
    } finally { cleanup.partFile = null; }
    console.log(`   wrote ${path.join(restoredDir, outName)}`);
    const report = buildRestoreJson({
      plan, diag, diagVersion: DIAG_VERSION,
      source: { trimmedName: name, trimmedSha256: expectSha, trimJsonName, originalName: trimJson.source?.name ?? null },
      output: { name: outName, sha256: outSha, samples: outProbe.totalSamples, sampleRate: outProbe.sampleRate, channels: outProbe.channels, durationS: outProbe.totalSamples / outProbe.sampleRate, peakDbfs },
    });
    await writeJsonAtomic(jsonPath, report); // json last: it is the idempotency marker
    await rebuildReport(restoredDir);
    console.log(`   wrote ${jsonPath}  (peak ${peakDbfs} dBFS)`);
    return 'ok';
  } finally {
    // keep the verified staged input for dry-runs (re-use); drop it after a write
    if (opts.write) await fsp.rm(work, { recursive: true, force: true });
    cleanup.work = null;
  }
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  const trimmedDir = path.join(opts.src, '_trimmed');
  if (!fs.existsSync(trimmedDir)) throw new Error(`no _trimmed directory in ${opts.src}`);
  const entries = listTrimmedNames(await fsp.readdir(trimmedDir)).filter((e) => matchesOnly(e, opts.only));
  console.log(`mode: ${opts.write ? 'WRITE' : 'dry-run'}  src: ${opts.src}  tapes: ${entries.length}  restore v${RESTORE_VERSION}`);
  if (opts.write) await checkNasMount(opts.src, opts.allowLocalSrc); // fail fast before any work

  const release = await acquireLock(opts.staging);
  cleanup.lockDir = opts.staging;
  const tally = { ok: 0, skipped: 0, failed: [] };
  try {
    for (const e of entries) {
      try { tally[await processTape(e, opts)]++; } catch (err) { tally.failed.push(e.name); console.error(`\n!! ${e.name}: ${err.message}`); }
    }
  } finally { await release(); }
  console.log(`\nsummary: ${tally.ok} ok, ${tally.skipped} skipped, ${tally.failed.length} failed${tally.failed.length ? ` (${tally.failed.join(', ')})` : ''}`);
  return tally.failed.length ? 1 : 0;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { // remove an in-flight NAS .part, only a bare dotfile name inside the verified _restored dir
      if (cleanup.partFile && cleanup.restoredDir && /^\.[^/\\]+\.part$/.test(cleanup.partFile) && path.basename(cleanup.restoredDir) === '_restored') fs.rmSync(path.join(cleanup.restoredDir, cleanup.partFile), { force: true });
    } catch { /* best effort */ }
    try { if (cleanup.work && cleanup.lockDir) fs.rmSync(cleanup.work, { recursive: true, force: true }); } catch { /* best effort */ }
    try { if (cleanup.lockDir) fs.rmSync(path.join(cleanup.lockDir, '.lock'), { force: true }); } catch { /* best effort */ }
    process.exit(130);
  });
}

main().then((c) => process.exit(c), (e) => { console.error(`error: ${e.message}`); process.exit(1); });
