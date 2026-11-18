#!/usr/bin/env node
// Trim digitized cassette DJ mixes. Originals are never modified.
// Usage: node scripts/mixtapes/trim-mixtapes.mjs [--src DIR] [--dry-run | --write] [--only SUBSTR]
//        [--force] [--staging DIR] [--params JSON] [--allow-local-src]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_PARAMS, DETECTOR_VERSION, detectTrim } from '../../features/mixtape-processing/trim-detect.js';
import {
  CLIPPING_MIN_SAMPLES, WindowAccumulator, buildFiltergraph, buildReportMd, endFadeReport, endFadeSamples, expectedSamples, filterAudioNames, validateEndFadeParams,
  findMountForPath, fmtTime, isNasSmbMount, keepToSamples, noiseCodec, paramsHash, parseMountOutput,
  parseProbe, partitionStemCollisions, selectOutputCodec, shouldSkipRender, stemOf, ANALYSIS_RATE, WINDOW_MS,
} from '../../features/mixtape-processing/trim-io-helpers.js';

const RENDER_VERSION = 1; // bump when the render (filtergraph/fades) changes
const FFMPEG = process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || '/usr/local/bin/ffprobe';
const DEFAULT_SRC = '/Volumes/bryan/Mix_Tapes_For_Processing';
const cleanup = { work: null, lockDir: null }; // current per-tape work dir + lock, for signal handlers

function parseArgs(argv) {
  const o = { src: DEFAULT_SRC, write: false, only: null, force: false, staging: path.join(os.homedir(), 'mixtape-work'), params: {}, allowLocalSrc: false };
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
    else if (a === '--params') {
      o.params = JSON.parse(need(i++));
      if (!o.params || typeof o.params !== 'object' || Array.isArray(o.params)) throw new Error('--params must be a JSON object');
      if ('windowMs' in o.params) throw new Error('--params windowMs is not allowed: window size is fixed at ' + WINDOW_MS + ' ms');
      const bad = Object.keys(o.params).filter((k) => !(k in DEFAULT_PARAMS));
      if (bad.length) throw new Error(`unknown --params keys: ${bad.join(', ')}`);
      validateEndFadeParams({ ...DEFAULT_PARAMS, ...o.params });
    } else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (dry && o.write) throw new Error('--dry-run and --write are mutually exclusive');
  o.staging = path.resolve(o.staging.replace(/^~(?=$|\/)/, os.homedir()));
  o.src = path.resolve(o.src);
  return o;
}

const HELP = `trim-mixtapes: trim empty head/tail/gaps from cassette mixes (originals untouched)
  --src <dir>          source dir (default ${DEFAULT_SRC})
  --dry-run            analyse only, no NAS writes (DEFAULT)
  --write              render + copy to <src>/_trimmed (requires smbfs mount from 192.168.1.6)
  --only <substring>   only tapes whose filename contains it
  --force              reprocess / overwrite existing outputs
  --staging <dir>      local work dir (default ~/mixtape-work)
  --params <json>      override detector params
  --allow-local-src    TESTS ONLY: skip the smbfs mount check`;

// ---------- process helpers ----------

function run(cmd, args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (c) => (onStdout ? onStdout(c) : out.push(c)));
    p.stderr.on('data', (c) => { err = (err + c).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString()) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`))));
  });
}
const nice = (cmd, args) => run('nice', ['-n', '10', cmd, ...args]);
const ffmpegBase = ['-hide_banner', '-nostdin', '-v', 'error'];

async function probeFile(file) {
  const j = await run(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=codec_name,sample_rate,channels,sample_fmt,bits_per_raw_sample,bits_per_sample,duration,duration_ts,time_base:format=duration', '-of', 'json', file]);
  const p = parseProbe(JSON.parse(j));
  if (!p.sampleRate || !p.totalSamples) throw new Error('ffprobe found no audio stream');
  return p;
}

async function md5Slice(file, S, E, sr) {
  const o = await run(FFMPEG, [...ffmpegBase, '-t', String(E / sr + 0.5), '-i', file, '-af', `atrim=start_sample=${S}:end_sample=${E},aformat=sample_fmts=s32`, '-f', 'md5', '-']);
  return o.trim();
}

// ---------- safety ----------

async function checkNasMount(src, allowLocal) {
  if (allowLocal) return;
  const real = await fsp.realpath(src);
  const mounts = parseMountOutput(await run('mount', []));
  const m = findMountForPath(mounts, real);
  if (!isNasSmbMount(m)) throw new Error(`refusing NAS write: ${real} is not on an smbfs mount from 192.168.1.6 (found ${m ? `${m.fstype} ${m.device}` : 'none'})`);
}

async function acquireLock(staging) {
  await fsp.mkdir(staging, { recursive: true });
  const lock = path.join(staging, '.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fsp.open(lock, 'wx');
      await fh.writeFile(String(process.pid));
      await fh.close();
      return async () => { await fsp.rm(lock, { force: true }); };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number((await fsp.readFile(lock, 'utf8').catch(() => '')).trim());
      let alive = false;
      if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (k) { alive = k.code === 'EPERM'; } }
      if (alive) throw new Error(`another run is active (pid ${pid}); lock ${lock}`);
      await fsp.rm(lock, { force: true }); // stale
    }
  }
  throw new Error(`could not acquire lock ${lock}`);
}

async function copyWithHash(from, to) {
  const h = createHash('sha256');
  const tap = new Transform({ transform(c, _e, cb) { h.update(c); cb(null, c); } });
  await pipeline(fs.createReadStream(from), tap, fs.createWriteStream(to));
  return h.digest('hex');
}
async function sha256Of(file) {
  const h = createHash('sha256');
  await pipeline(fs.createReadStream(file), new Transform({ transform(c, _e, cb) { h.update(c); cb(); } }));
  return h.digest('hex');
}

/**
 * Copy to <dir>/.<name>.part, verify size + sha256 by read-back, then rename.
 * An existing final with the same sha256 is accepted as-is; a different one needs --force.
 */
async function publishToNas(localFile, dir, name, force) {
  const final = path.join(dir, name);
  if (!force && fs.existsSync(final)) {
    const [have, want] = [await sha256Of(final), await sha256Of(localFile)];
    if (have === want) return want; // identical output already published
    throw new Error(`${final} already exists with different content (sha256 ${have.slice(0, 12)} != ${want.slice(0, 12)}); use --force to overwrite`);
  }
  const part = path.join(dir, `.${name}.part`);
  const size = (await fsp.stat(localFile)).size;
  const sha = await copyWithHash(localFile, part);
  const back = await fsp.stat(part);
  // NOTE: the read-back sha may be served from the macOS SMB client cache rather than the
  // NAS disk; it is still kept as a cheap guard against truncated/short writes.
  if (back.size !== size || (await sha256Of(part)) !== sha) { await fsp.rm(part, { force: true }); throw new Error(`read-back verification failed for ${name}`); }
  await fsp.rename(part, final);
  return sha;
}

// ---------- analysis ----------

function analyzeStream(staged, probe) {
  const ch = probe.channels >= 2 ? 2 : 1;
  const acc = new WindowAccumulator(ch);
  return run('nice', ['-n', '10', FFMPEG, ...ffmpegBase, '-i', staged, '-af', 'highpass=f=30', '-ac', String(ch), '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'], { onStdout: (c) => acc.push(c) })
    .then(() => acc.finish());
}

// ---------- reporting ----------

function printTape(name, probe, res, clipped) {
  const L = [`\n== ${name}  (${fmtTime(probe.durationS)}, ${probe.codec} ${probe.sampleRate} Hz ${probe.channels}ch ${probe.bits}-bit)`];
  const f = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : 'n/a');
  L.push(`   floor ${f(res.floorDb)} dB  content ${f(res.contentDb)} dB  threshold ${f(res.thresholdDb)} dB  clipped ${clipped}`);
  L.push(`   keep: ${res.keep.length ? res.keep.map((k) => `${fmtTime(k.startS)}-${fmtTime(k.endS)}`).join('  ') : '(none)'}`);
  for (const c of res.cuts) {
    const stats = typeof c.medianDb === 'number' ? `  (median ${c.medianDb} dB, std ${c.stdDb} dB)` : '';
    L.push(`   cut ${c.kind}: ${fmtTime(c.startS)}-${fmtTime(c.endS)}  ${c.reason || ''}${stats}`);
  }
  for (const d of res.droppedIslands) L.push(`   dropped island: ${fmtTime(d.startS)}-${fmtTime(d.endS)}  ${d.reason || ''}`);
  L.push(`   noise sample: ${res.noiseSample ? `${fmtTime(res.noiseSample.startS)}-${fmtTime(res.noiseSample.endS)}` : 'none'}`);
  L.push(`   flags: ${res.flags.length ? res.flags.join(', ') : '-'}`);
  console.log(L.join('\n'));
}

async function rebuildReport(trimmedDir) {
  const reports = [];
  for (const n of (await fsp.readdir(trimmedDir)).filter((x) => x.endsWith('.trim.json') && !x.startsWith('.'))) {
    try { reports.push(JSON.parse(await fsp.readFile(path.join(trimmedDir, n), 'utf8'))); } catch { /* skip unreadable */ }
  }
  const part = path.join(trimmedDir, '.REPORT.md.part');
  await fsp.writeFile(part, buildReportMd(reports));
  await fsp.rename(part, path.join(trimmedDir, 'REPORT.md'));
}

// ---------- per tape ----------

async function processTape(file, opts, merged, pHash) {
  const srcFile = path.join(opts.src, file);
  const stem = stemOf(file);
  const trimmedDir = path.join(opts.src, '_trimmed');
  const jsonPath = path.join(trimmedDir, `${stem}.trim.json`);
  const st = await fsp.stat(srcFile);

  if (!opts.force && fs.existsSync(jsonPath)) {
    try {
      const prev = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
      if (prev.source && prev.source.size === st.size && prev.source.mtimeMs === st.mtimeMs && prev.detectorVersion === DETECTOR_VERSION && prev.renderVersion === RENDER_VERSION && prev.paramsHash === pHash) {
        console.log(`\n== ${file}: already processed (same size/mtime/version/params), skipping`);
        return 'skipped';
      }
    } catch { /* unreadable json: reprocess */ }
  }

  await fsp.mkdir(opts.staging, { recursive: true });
  const freeBytes = async () => { const f = await fsp.statfs(opts.staging); return f.bavail * f.bsize; };
  if ((await freeBytes()) < st.size * 3) { console.log(`\n== ${file}: skipped, needs ${(st.size * 3 / 1e9).toFixed(1)} GB free in staging`); return 'skipped'; }

  const workRoot = path.join(opts.staging, 'work');
  const work = path.join(workRoot, stem);
  if (!stem || !work.startsWith(workRoot + path.sep)) throw new Error('bad staging path');
  cleanup.work = work;
  try {
    await fsp.rm(work, { recursive: true, force: true });
    await fsp.mkdir(work, { recursive: true });
    const staged = path.join(work, file);
    const srcSha = await copyWithHash(srcFile, staged);
    if ((await fsp.stat(staged)).size !== st.size) throw new Error('staged size mismatch');

    const probe = await probeFile(staged);
    const pcmBytes = probe.durationS * probe.sampleRate * probe.channels * 4;
    if ((await freeBytes()) < st.size + pcmBytes) {
      console.log(`\n== ${file}: skipped, needs ${((st.size + pcmBytes) / 1e9).toFixed(1)} GB free in staging (source + decoded PCM)`);
      return 'skipped';
    }
    const { windowsDb, clipped } = await analyzeStream(staged, probe);
    if (!windowsDb.length) throw new Error('analysis produced no windows');
    const res = detectTrim(windowsDb, merged, {});
    const flags = [...res.flags];
    if (clipped >= CLIPPING_MIN_SAMPLES) flags.push('CLIPPING');
    res.flags = flags;
    printTape(file, probe, res, clipped);

    const report = {
      detectorVersion: DETECTOR_VERSION, renderVersion: RENDER_VERSION, paramsHash: pHash, params: merged,
      source: { name: file, size: st.size, mtimeMs: st.mtimeMs, sha256: srcSha, codec: probe.codec, sampleRate: probe.sampleRate, channels: probe.channels, bits: probe.bits, durationS: probe.durationS },
      analysis: { floorDb: res.floorDb, contentDb: res.contentDb, thresholdDb: res.thresholdDb, clippedSamples: clipped },
      keep: res.keep, cuts: res.cuts, droppedIslands: res.droppedIslands, noiseSample: res.noiseSample, flags, output: null, createdAt: new Date().toISOString(),
    };

    if (!opts.write) {
      const dir = path.join(opts.staging, 'reports');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, `${stem}.trim.json`), JSON.stringify(report, null, 2));
      console.log(`   dry-run: report -> ${path.join(dir, `${stem}.trim.json`)}`);
      return 'ok';
    }

    // ---- write mode ----
    const toPublish = []; // [localFile, name]
    const skipRender = shouldSkipRender(flags);
    if (!skipRender) {
      const segs = keepToSamples(res.keep, probe.sampleRate, probe.totalSamples, windowsDb.length * (WINDOW_MS / 1000));
      if (!segs.length) throw new Error('no renderable segments');
      const codec = selectOutputCodec(probe, path.extname(file));
      const outName = `${stem}.trimmed.${codec.ext}`;
      const outPath = path.join(work, outName);
      const endFade = merged.endFadeOutS > 0 ? { seconds: merged.endFadeOutS, curve: merged.endFadeCurve } : null;
      const fg = buildFiltergraph(segs, probe.sampleRate, probe.totalSamples, merged.fadeMs, endFade);
      const inputs = segs.flatMap(() => ['-i', staged]);
      await nice(FFMPEG, [...ffmpegBase, '-y', ...inputs, '-filter_complex', fg, '-map', '[out]', '-map_metadata', '0', ...codec.args, outPath]);

      const outProbe = await probeFile(outPath);
      const want = expectedSamples(segs);
      if (outProbe.totalSamples !== want) throw new Error(`rendered sample count ${outProbe.totalSamples} != expected ${want}`);
      if (codec.lossless) {
        const seg0 = segs[0];
        const off = Math.min(probe.sampleRate, Math.floor((seg0.E - seg0.S) / 4));
        // with a single segment seg0 is also the last: keep the proof slice clear of the end fade
        const fadeN = segs.length === 1 ? endFadeSamples(segs, probe.sampleRate, merged.endFadeOutS) : 0;
        const len = Math.min(10 * probe.sampleRate, seg0.E - seg0.S - 2 * off, seg0.E - seg0.S - fadeN - off);
        if (len > probe.sampleRate) {
          const a = await md5Slice(staged, seg0.S + off, seg0.S + off + len, probe.sampleRate);
          const b = await md5Slice(outPath, off, off + len, probe.sampleRate);
          if (a !== b) throw new Error('lossless proof failed: source and output slice md5 differ');
        }
      }
      report.output = { name: outName, sha256: await sha256Of(outPath), durationS: want / probe.sampleRate, samples: want };
      report.endFade = endFadeReport(segs, probe.sampleRate, merged.endFadeOutS, merged.endFadeCurve);
      toPublish.push([outPath, outName]);
    }
    if (res.noiseSample) {
      const S = Math.round(res.noiseSample.startS * probe.sampleRate);
      const E = Math.min(probe.totalSamples, Math.round(res.noiseSample.endS * probe.sampleRate));
      const noisePath = path.join(work, `${stem}.noise.wav`);
      await nice(FFMPEG, [...ffmpegBase, '-y', '-i', staged, '-af', `atrim=start_sample=${S}:end_sample=${E}`, '-c:a', noiseCodec(probe), '-rf64', 'auto', noisePath]);
      toPublish.push([noisePath, `${stem}.noise.wav`]);
    }

    if (!fs.existsSync(opts.src)) throw new Error('src vanished');
    await checkNasMount(opts.src, opts.allowLocalSrc);
    // only <src>/_trimmed, non-recursive: never create parents under /Volumes
    await fsp.mkdir(trimmedDir).catch((e) => { if (e.code !== 'EEXIST') throw e; });
    for (const [local, name] of toPublish) {
      try { await publishToNas(local, trimmedDir, name, opts.force); } catch (e) {
        // best effort: drop the half-written .part, only inside the verified _trimmed dir
        await fsp.rm(path.join(trimmedDir, `.${name}.part`), { force: true }).catch(() => {});
        throw e;
      }
      console.log(`   wrote ${path.join(trimmedDir, name)}`);
    }
    const part = path.join(trimmedDir, `.${stem}.trim.json.part`);
    await fsp.writeFile(part, JSON.stringify(report, null, 2));
    await fsp.rename(part, jsonPath); // json last: it is the idempotency marker
    await rebuildReport(trimmedDir);
    console.log(`   wrote ${jsonPath}`);
    return 'ok';
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
    cleanup.work = null;
  }
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  const merged = { ...DEFAULT_PARAMS, ...opts.params, windowMs: WINDOW_MS };
  const pHash = paramsHash(merged);
  const all = filterAudioNames(await fsp.readdir(opts.src), null);
  const { ok: okNames, collisions } = partitionStemCollisions(all);
  const files = filterAudioNames(okNames, opts.only);
  console.log(`mode: ${opts.write ? 'WRITE' : 'dry-run'}  src: ${opts.src}  tapes: ${files.length}  detector v${DETECTOR_VERSION} render v${RENDER_VERSION} params ${pHash}`);
  if (opts.write) await checkNasMount(opts.src, opts.allowLocalSrc); // fail fast before any work

  const release = await acquireLock(opts.staging);
  cleanup.lockDir = opts.staging;
  const tally = { ok: 0, skipped: 0, failed: [] };
  const needle = opts.only ? opts.only.toLowerCase() : null;
  for (const g of collisions) {
    if (needle && !g.some((n) => n.toLowerCase().includes(needle))) continue;
    const msg = `stem collision: ${g.join(', ')}`;
    tally.failed.push(msg);
    console.error(`\n!! ${msg} (not processed)`);
  }
  try {
    for (const f of files) {
      try { tally[await processTape(f, opts, merged, pHash)]++; }
      catch (e) { tally.failed.push(f); console.error(`\n!! ${f}: ${e.message}`); }
    }
  } finally { await release(); }
  console.log(`\nsummary: ${tally.ok} ok, ${tally.skipped} skipped, ${tally.failed.length} failed${tally.failed.length ? ` (${tally.failed.join(', ')})` : ''}`);
  return tally.failed.length ? 1 : 0;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { if (cleanup.work) fs.rmSync(cleanup.work, { recursive: true, force: true }); } catch { /* best effort */ }
    try { if (cleanup.lockDir) fs.rmSync(path.join(cleanup.lockDir, '.lock'), { force: true }); } catch { /* best effort */ }
    process.exit(130);
  });
}

main().then((c) => process.exit(c), (e) => { console.error(`error: ${e.message}`); process.exit(1); });
