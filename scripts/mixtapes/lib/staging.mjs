// Shared process, lock and staged-copy helpers for the mixtape scripts (diagnose, restore).
// trim-mixtapes.mjs keeps its own copies on purpose and does not import this file.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { findMountForPath, isNasSmbMount, parseMountOutput, parseProbe } from '../../../features/mixtape-processing/trim-io-helpers.js';

export const FFMPEG = process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || '/usr/local/bin/ffprobe';
export const ffmpegBase = ['-hide_banner', '-nostdin', '-v', 'error'];

/** Run a command; stdout is collected (Buffer) or streamed to onStdout. Resolves { stdout, stderr }. */
export function run(cmd, args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (c) => (onStdout ? onStdout(c) : out.push(c)));
    p.stderr.on('data', (c) => { err = (err + c).slice(-200000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0
      ? resolve({ stdout: Buffer.concat(out), stderr: err })
      : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`))));
  });
}
export const niceRun = (cmd, args, o) => run('nice', ['-n', '10', cmd, ...args], o);

/** ffprobe the first audio stream into the normalized probe object. */
export async function probeFile(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=codec_name,sample_rate,channels,sample_fmt,bits_per_raw_sample,bits_per_sample,duration,duration_ts,time_base:format=duration', '-of', 'json', file]);
  const p = parseProbe(JSON.parse(stdout.toString()));
  if (!p.sampleRate || !p.totalSamples) throw new Error('ffprobe found no audio stream');
  return p;
}

/** Refuse unless `src` lives on the NAS smbfs mount (skipped for tests with allowLocal). */
export async function checkNasMount(src, allowLocal) {
  if (allowLocal) return;
  const real = await fsp.realpath(src);
  const mounts = parseMountOutput((await run('mount', [])).stdout.toString());
  const m = findMountForPath(mounts, real);
  if (!isNasSmbMount(m)) throw new Error(`refusing NAS write: ${real} is not on an smbfs mount from 192.168.1.6 (found ${m ? `${m.fstype} ${m.device}` : 'none'})`);
}

/** Exclusive <staging>/.lock holding our pid; stale locks are replaced. Returns a release function. */
export async function acquireLock(staging) {
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

const hashTap = (h) => new Transform({ transform(c, _e, cb) { h.update(c); cb(null, c); } });

export async function sha256Of(file) {
  const h = createHash('sha256');
  await pipeline(fs.createReadStream(file), hashTap(h), fs.createWriteStream('/dev/null'));
  return h.digest('hex');
}

/** Copy `from` to `to`, returning the sha256 of the bytes copied. */
export async function copyWithHash(from, to) {
  const h = createHash('sha256');
  await pipeline(fs.createReadStream(from), hashTap(h), fs.createWriteStream(to));
  return h.digest('hex');
}

/**
 * Copy src -> <dir>/<name> through <dir>/.<name>.part, verifying size + sha256 by read-back.
 * An existing staged copy is reused when it has the same size and its sha256 equals `expectSha`
 * (or, without expectSha, when sha256 matches a fresh hash of src).
 * @returns {{ file:string, sha256:string, size:number, reused:boolean }}
 */
export async function stageInput(src, dir, { expectSha = null, log = () => {} } = {}) {
  const name = path.basename(src);
  const final = path.join(dir, name);
  const srcStat = await fsp.stat(src);
  await fsp.mkdir(dir, { recursive: true });
  if (expectSha && fs.existsSync(final) && (await fsp.stat(final)).size === srcStat.size) {
    const have = await sha256Of(final);
    if (have === expectSha) { log(`reusing verified staged copy ${final}`); return { file: final, sha256: have, size: srcStat.size, reused: true }; }
  }
  const free = await fsp.statfs(dir);
  if (free.bavail * free.bsize < srcStat.size * 1.2 + 2e8) throw new Error(`not enough free space in ${dir} for ${(srcStat.size / 1e9).toFixed(2)} GB copy`);
  const part = path.join(dir, `.${name}.part`);
  log(`staging ${(srcStat.size / 1e9).toFixed(2)} GB -> ${final}`);
  const sha = await copyWithHash(src, part);
  const back = await fsp.stat(part);
  if (back.size !== srcStat.size || (await sha256Of(part)) !== sha) { await fsp.rm(part, { force: true }); throw new Error('staged copy failed size/sha256 verification'); }
  await fsp.rename(part, final);
  return { file: final, sha256: sha, size: srcStat.size, reused: false };
}

/**
 * Copy to <dir>/.<name>.part, verify size + sha256 by read-back, then rename onto <dir>/<name>.
 * An existing identical final is accepted; a different one needs force.
 * (The read-back may be served from the SMB client cache; it still guards against short writes.)
 */
export async function publishToDir(localFile, dir, name, force) {
  const final = path.join(dir, name);
  if (!force && fs.existsSync(final)) {
    const [have, want] = [await sha256Of(final), await sha256Of(localFile)];
    if (have === want) return want;
    throw new Error(`${final} already exists with different content (sha256 ${have.slice(0, 12)} != ${want.slice(0, 12)}); use --force to overwrite`);
  }
  const part = path.join(dir, `.${name}.part`);
  const size = (await fsp.stat(localFile)).size;
  const sha = await copyWithHash(localFile, part);
  const back = await fsp.stat(part);
  if (back.size !== size || (await sha256Of(part)) !== sha) { await fsp.rm(part, { force: true }); throw new Error(`read-back verification failed for ${name}`); }
  await fsp.rename(part, final);
  return sha;
}
