#!/usr/bin/env node
// Audition samples for tape restoration (Phase 2a, step B). Local-only: never writes under /Volumes.
// Usage: node scripts/mixtapes/make-samples.mjs --diag <json> [--out ~/mixtape-work/samples/<stem>] [--staging ~/mixtape-work] [--nf -50]
// Reads audio from the staged local copy (<staging>/diag/<stem>/<name>), renders sequentially under nice.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEbur128Summary, round } from '../../features/mixtape-processing/restore-diagnose.js';
import {
  ANLMDN, EXCERPT_S, FLAC_DITHER, HIGH_SHELF, PREROLL_S, TARGET_LUFS, TP_CEILING_DB, afftdn, buildCleanup, excerptChain,
  finalMasterGainDb, matchGains, residualGain, volumeFilter,
} from '../../features/mixtape-processing/restore-chains.js';

const FFMPEG = process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg';
const DEFAULT_NF = -50; // diag nfDb is an upper bound when music is present everywhere
const home = (p) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

function parseArgs(argv) {
  const o = { diag: null, out: null, staging: path.join(os.homedir(), 'mixtape-work'), nf: DEFAULT_NF, in: null };
  const need = (i) => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--diag') o.diag = need(i++);
    else if (a === '--out') o.out = need(i++);
    else if (a === '--staging') o.staging = need(i++);
    else if (a === '--in') o.in = need(i++);
    else if (a === '--nf') o.nf = Number(need(i++));
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.diag) throw new Error('--diag <json> is required');
  if (!Number.isFinite(o.nf) || o.nf < -80 || o.nf > -20) throw new Error('--nf must be in [-80, -20]');
  o.diag = home(o.diag);
  o.staging = home(o.staging);
  if (o.in) o.in = home(o.in);
  if (o.out) o.out = home(o.out);
  return o;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', cmd, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err = (err + c).slice(-300000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`))));
  });
}
const base = ['-hide_banner', '-nostdin', '-v', 'error', '-y'];
const baseInfo = ['-hide_banner', '-nostdin', '-v', 'info', '-y'];

async function measure(file) {
  const err = await run(FFMPEG, [...baseInfo, '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const r = parseEbur128Summary(err);
  return { lufs: r.integratedLufs, tp: r.truePeakDbtp };
}

/** Render one excerpt variant to f32 WAV: seek before -i, 5 s pre-roll warm-up discarded by atrim. */
async function render(input, startS, chain, outFile) {
  const ss = Math.max(0, startS - PREROLL_S);
  const preroll = startS - ss;
  await run(FFMPEG, [...base, '-ss', String(ss), '-t', String(preroll + EXCERPT_S), '-i', input, '-af', excerptChain(chain, preroll),
    '-ac', '2', '-c:a', 'pcm_f32le', outFile]);
}

async function sha256Of(file) {
  const h = createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c);
  return h.digest('hex');
}

async function acquireLock(dir) {
  const lock = path.join(dir, '.lock');
  try {
    const fh = await fsp.open(lock, 'wx');
    await fh.writeFile(String(process.pid));
    await fh.close();
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number((await fsp.readFile(lock, 'utf8').catch(() => '')).trim());
    let alive = false;
    if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (k) { alive = k.code === 'EPERM'; } }
    if (alive) throw new Error(`another run is active (pid ${pid}); lock ${lock}`);
    await fsp.rm(lock, { force: true });
    return acquireLock(dir);
  }
  return async () => { await fsp.rm(lock, { force: true }); };
}

const fmt = (m) => (m && m.lufs != null ? `${round(m.lufs, 1)} LUFS / ${round(m.tp, 1)} dBTP` : 'n/a');

async function main() {
  const t0 = Date.now();
  const o = parseArgs(process.argv.slice(2));
  const diag = JSON.parse(await fsp.readFile(o.diag, 'utf8'));
  const stem = diag.input.name.replace(/\.[^.]+$/, '');
  const stemShort = stem.split('.')[0];
  const input = o.in || path.join(o.staging, 'diag', stem, diag.input.name);
  const outDir = o.out || path.join(o.staging, 'samples', stemShort);
  for (const p of [input, outDir]) if (p.startsWith('/Volumes/')) throw new Error(`refusing to use a path under /Volumes: ${p}`);
  const st = await fsp.stat(input).catch(() => null);
  if (!st) throw new Error(`staged input missing: ${input} (run diagnose-tape.mjs first)`);
  if (st.size !== diag.input.size) throw new Error('staged input size differs from diagnostics');
  if ((await sha256Of(input)) !== diag.input.sha256) throw new Error('staged input sha256 differs from diagnostics');

  const wavDir = path.join(outDir, 'wav');
  const flacDir = path.join(outDir, 'flac');
  const rawDir = path.join(outDir, '.raw');
  await fsp.mkdir(wavDir, { recursive: true });
  await fsp.mkdir(flacDir, { recursive: true });
  await fsp.mkdir(rawDir, { recursive: true });
  const unlock = await acquireLock(outDir);

  try {
    const p = diag.picks || {};
    const excerpts = [['intro', p.introS], ['hats', p.hatsS], ['bass', p.bassS], ['join', p.joinS]].filter(([, s]) => Number.isFinite(s))
      .map(([name, startS]) => ({ name, startS }));
    const NF = o.nf;
    const { chain: v1 } = buildCleanup(diag);
    const v2 = `${v1},${afftdn(6, NF, 8)}`;
    const v3 = `${v1},${afftdn(12, NF, 10)}`;
    const v4 = `${v1},${ANLMDN}`;
    const v5Gain = finalMasterGainDb(diag.loudness.integratedLufs, diag.loudness.truePeakDbtp);
    const hasV6 = diag.bandwidth?.rolloffHz < 13000;

    // id -> { chain, parent (for gain), match }
    const defs = [
      { id: 'V0', chain: '', match: false },
      { id: 'V1', chain: v1, match: true },
      { id: 'V2', chain: v2, match: true },
      { id: 'V3', chain: v3, match: true },
      { id: 'V4', chain: v4, match: true },
      ...(hasV6 ? [{ id: 'V6', chain: `${v2},${HIGH_SHELF}`, match: true }] : []),
      { id: 'R2', chain: `${v1},${afftdn(6, NF, 8, ':om=n')}`, parent: 'V2' },
      { id: 'R3', chain: `${v1},${afftdn(12, NF, 10, ':om=n')}`, parent: 'V3' },
      { id: 'R4', chain: `${v1},${ANLMDN.replace('m=11', 'm=11:o=n')}`, parent: 'V4' },
    ];
    const matchIds = defs.filter((d) => d.match && d.id !== 'V0').map((d) => d.id);
    const files = [];

    for (const ex of excerpts) {
      const exT = Date.now();
      console.log(`\n== ${ex.name} @ ${ex.startS}s`);
      const raw = {};
      const measured = {};
      for (const d of defs) {
        raw[d.id] = path.join(rawDir, `${ex.name}.${d.id}.wav`);
        await render(input, ex.startS, d.chain, raw[d.id]);
        if (d.match || d.id === 'V0') measured[d.id] = await measure(raw[d.id]);
        console.log(`  rendered ${d.id}${measured[d.id] ? `  ${fmt(measured[d.id])}` : ''}`);
      }
      const { gains, clampDb } = matchGains(measured, matchIds);
      const finals = defs.map((d) => ({ ...d, gain: d.parent ? residualGain(gains, d.parent) : gains[d.id], src: raw[d.id], rawChain: d.chain }));
      const v2raw = defs.find((d) => d.id === 'V2');
      finals.push({ id: 'V5', chain: v2raw.chain, gain: v5Gain, src: raw.V2, rawChain: v2raw.chain, label: 'louder master preview (V2 + whole-tape gain, NOT level-matched)' });

      for (const f of finals) {
        const stemName = `${ex.name}.${f.id}`;
        const wav = path.join(wavDir, `${stemName}.wav`);
        const flac = path.join(flacDir, `${stemName}.flac`);
        await run(FFMPEG, [...base, '-i', f.src, '-af', volumeFilter(f.gain), '-c:a', 'pcm_f32le', wav]);
        await run(FFMPEG, [...base, '-i', wav, '-af', FLAC_DITHER, '-c:a', 'flac', '-sample_fmt', 's16', flac]);
        const m = await measure(wav);
        const warn = m.tp != null && !f.id.startsWith('R') && m.tp > TP_CEILING_DB + 0.05 ? `TP ${round(m.tp, 2)} > ${TP_CEILING_DB}` : null;
        files.push({
          excerpt: ex.name, startS: ex.startS, lengthS: EXCERPT_S, variant: f.id, label: f.label || null,
          chain: `${f.chain ? `${f.chain},` : ''}${volumeFilter(f.gain)}`.replace(/^,/, ''),
          prerollS: Math.min(PREROLL_S, ex.startS), gainDb: round(f.gain, 3), parent: f.parent || null,
          lufs: m.lufs, truePeakDbtp: m.tp, wav: path.relative(outDir, wav), flac: path.relative(outDir, flac), warning: warn,
        });
        console.log(`  ${f.id.padEnd(3)} gain ${String(round(f.gain, 2)).padStart(6)} dB  ${fmt(m)}${warn ? `  !! ${warn}` : ''}`);
      }
      if (clampDb > 0) console.log(`  TP clamp applied: all variants lowered ${round(clampDb, 2)} dB`);
      files.forEach((x) => { if (x.excerpt === ex.name) x.tpClampDb = round(clampDb, 3); });
      console.log(`  (${((Date.now() - exT) / 1000).toFixed(0)} s)`);
    }

    const doc = {
      samplesVersion: 1, createdAt: new Date().toISOString(), diag: o.diag, input: { path: input, sha256: diag.input.sha256 },
      target: { lufs: TARGET_LUFS, truePeakDbtp: TP_CEILING_DB },
      wholeTape: { integratedLufs: diag.loudness.integratedLufs, truePeakDbtp: diag.loudness.truePeakDbtp, v5GainDb: round(v5Gain, 3) },
      nf: { diagnosticsNfDb: diag.hiss?.nfDb ?? null, usedDb: NF, override: NF !== diag.hiss?.nfDb, note: 'diagnostics nf is an upper bound (music present everywhere); override used for V2/V3/V6/R2/R3' },
      skipped: { azimuth: (buildCleanup(diag).parts.some((x) => x.includes('adelay'))) ? null : `lag ${diag.azimuth?.lagSamples} below 0.5 sample or inconsistent`, v6: hasV6 ? null : 'rolloff >= 13000 Hz' },
      excerpts, files,
    };
    await fsp.writeFile(path.join(outDir, 'samples.json'), `${JSON.stringify(doc, null, 2)}\n`);
    await fsp.rm(rawDir, { recursive: true, force: true });
    const du = await new Promise((res) => { const c = spawn('du', ['-sk', outDir]); let s = ''; c.stdout.on('data', (d) => { s += d; }); c.on('close', () => res(Number(s.split('\t')[0]) / 1024)); });
    console.log(`\ndone: ${files.length} files, ${du.toFixed(0)} MB total, ${((Date.now() - t0) / 60000).toFixed(1)} min -> ${outDir}`);
  } finally {
    await unlock();
  }
}

main().catch((e) => { console.error(`make-samples: ${e.message}`); process.exit(1); });
