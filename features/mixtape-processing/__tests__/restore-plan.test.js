import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESTORE_VERSION, buildRestoreChain, buildRestoreJson, buildRestoreReportMd, chainHash, isClipRisk, isUpToDate, lengthForce,
  listTrimmedNames, matchesOnly, outputFormat, parseAstatsPeak, provenHumLines, renderFilter, resolveNf, trimJsonProblem,
} from '../restore-plan.js';

const N = 252318150;
const baseDiag = () => ({
  input: { sampleRate: 44100 },
  loudness: { integratedLufs: -15.9, truePeakDbtp: -1.2 },
  channels: { whole: { balanceDb: 0.1 }, excerptMedianBalanceDb: 0.1 },
  azimuth: { lagSamples: 0.1, consistent: true },
  hum: { base: null, f0: 60, lines: [] },
  bandwidth: { rolloffHz: 16000 },
  hiss: { nfDb: -60 },
});

const HP = 'highpass=f=22:t=q:w=0.5412,highpass=f=22:t=q:w=1.3066';

test('plain tape: HP, afftdn, length force; no air at full band; label drops "+ air"', () => {
  const p = buildRestoreChain(baseDiag(), N);
  assert.equal(p.chain, `${HP},afftdn=nr=6:nf=-60:tn=1:gs=8:nl=min,apad=whole_len=${N},atrim=end_sample=${N}`);
  assert.equal(p.chainLabel, 'Clean-up + gentle hiss');
  assert.deepEqual(p.steps, { hum: [], balanceDb: null, azimuth: null, air: false });
  assert.equal(p.nfUsedDb, -60);
});

test('full-band (null rolloff) skips air; rolloff 13000 skips, 12999 adds', () => {
  const d = baseDiag();
  d.bandwidth.rolloffHz = null;
  assert.equal(buildRestoreChain(d, N).steps.air, false);
  d.bandwidth.rolloffHz = 13000;
  assert.equal(buildRestoreChain(d, N).steps.air, false);
  d.bandwidth.rolloffHz = 12999;
  const p = buildRestoreChain(d, N);
  assert.equal(p.steps.air, true);
  assert.equal(p.chainLabel, 'Clean-up + gentle hiss + air');
  assert.match(p.chain, /,highshelf=f=10000:t=q:w=0\.7:g=2,apad=/);
});

test('proven hum lines become capped notches; unproven family is ignored', () => {
  const d = baseDiag();
  d.hum = { base: 60, f0: 59.89, lines: [{ freq: 59.89, medianPromDb: 8.7 }, { freq: 119.8, medianPromDb: 31 }] };
  const p = buildRestoreChain(d, N);
  assert.deepEqual(p.steps.hum, [{ freq: 59.89, gainDb: -8.7 }, { freq: 119.8, gainDb: -20 }]);
  assert.match(p.chain, new RegExp(`${HP},equalizer=f=59.89:t=q:w=30:g=-8.7,equalizer=f=119.8:t=q:w=30:g=-20,afftdn`));
  d.hum.base = null;
  assert.deepEqual(provenHumLines(d), []);
  assert.doesNotMatch(buildRestoreChain(d, N).chain, /equalizer/);
});

test('balance fix only when consistent and above 0.5 dB; attenuates the louder channel', () => {
  const d = baseDiag();
  d.channels = { whole: { balanceDb: -2.49 }, excerptMedianBalanceDb: -2.236 };
  const p = buildRestoreChain(d, N);
  assert.equal(p.steps.balanceDb, -2.49);
  assert.match(p.chain, /pan=stereo\|c0=1\*c0\|c1=0\.7508\*c1/); // R louder -> R attenuated
  d.channels.excerptMedianBalanceDb = 2.2; // sign disagrees
  assert.equal(buildRestoreChain(d, N).steps.balanceDb, null);
  d.channels = { whole: { balanceDb: 0.4 }, excerptMedianBalanceDb: 0.4 }; // below threshold
  assert.doesNotMatch(buildRestoreChain(d, N).chain, /pan=/);
});

test('azimuth only when consistent and |lag| >= 0.5', () => {
  const d = baseDiag();
  d.azimuth = { lagSamples: 0.8, consistent: true };
  const p = buildRestoreChain(d, N);
  assert.equal(p.steps.azimuth, 0.8);
  assert.match(p.chain, /aresample=352800,adelay=delays=6S\|0S,aresample=44100/);
  d.azimuth = { lagSamples: 0.8, consistent: false };
  assert.equal(buildRestoreChain(d, N).steps.azimuth, null);
  d.azimuth = { lagSamples: 0.49, consistent: true };
  assert.equal(buildRestoreChain(d, N).steps.azimuth, null);
});

test('nf: min(diag, -50) clamped to [-80, -20]; missing -> -50', () => {
  assert.equal(resolveNf(-27.3), -50);
  assert.equal(resolveNf(-50), -50);
  assert.equal(resolveNf(-62.4), -62.4);
  assert.equal(resolveNf(-95), -80);
  assert.equal(resolveNf(null), -50);
  assert.equal(resolveNf(NaN), -50);
});

test('length forcing string and validation', () => {
  assert.equal(lengthForce(1000), 'apad=whole_len=1000,atrim=end_sample=1000');
  assert.throws(() => lengthForce(0));
  assert.throws(() => lengthForce(1.5));
});

test('chainHash is first 12 hex of sha256 and changes with the chain', () => {
  const c = 'a,b';
  assert.equal(chainHash(c), createHash('sha256').update(c).digest('hex').slice(0, 12));
  assert.equal(chainHash(c).length, 12);
  const d = baseDiag();
  const a = buildRestoreChain(d, N);
  d.hiss.nfDb = -70;
  assert.notEqual(buildRestoreChain(d, N).chainHash, a.chainHash);
});

test('clip risk: above -0.1 dBFS or unmeasured fails', () => {
  assert.equal(isClipRisk(-0.1), false);
  assert.equal(isClipRisk(-0.05), true);
  assert.equal(isClipRisk(0), true);
  assert.equal(isClipRisk(-3), false);
  assert.equal(isClipRisk(null), true);
  assert.equal(isClipRisk(NaN), true);
});

test('astats peak parsing takes the highest channel', () => {
  const text = 'Channel: 1\nPeak level dB: -3.21\nChannel: 2\nPeak level dB: -0.8\nOverall\nPeak level dB: -0.8\n';
  assert.equal(parseAstatsPeak(text), -0.8);
  assert.equal(parseAstatsPeak('Peak level dB: -inf'), -200);
  assert.equal(parseAstatsPeak('nothing'), null);
});

test('idempotency key: trimmed sha + RESTORE_VERSION (+ chain hash)', () => {
  const prev = { restoreVersion: RESTORE_VERSION, chainHash: 'abc', source: { trimmedSha256: 's1' }, output: { name: 'x' } };
  assert.equal(isUpToDate(prev, { trimmedSha256: 's1' }), true);
  assert.equal(isUpToDate(prev, { trimmedSha256: 's1', chainHash: 'abc' }), true);
  assert.equal(isUpToDate(prev, { trimmedSha256: 's1', chainHash: 'zzz' }), false);
  assert.equal(isUpToDate(prev, { trimmedSha256: 's2' }), false);
  assert.equal(isUpToDate({ ...prev, restoreVersion: RESTORE_VERSION - 1 }, { trimmedSha256: 's1' }), false);
  assert.equal(isUpToDate(null, { trimmedSha256: 's1' }), false);
  assert.equal(isUpToDate({ ...prev, diagVersion: 1 }, { trimmedSha256: 's1', diagVersion: 1 }), true);
  assert.equal(isUpToDate(prev, { trimmedSha256: 's1', diagVersion: 1 }), true); // legacy json = diag v1
  assert.equal(isUpToDate({ ...prev, diagVersion: 1 }, { trimmedSha256: 's1', diagVersion: 2 }), false);
});

test('output format by source depth', () => {
  const p = (codec, bits, extra = {}) => ({ codec, bits, sampleFmt: '', sampleRate: 44100, channels: 2, ...extra });
  const w16 = outputFormat(p('pcm_s16le', 16), 'wav');
  assert.deepEqual([w16.filter, w16.dither, w16.bits, w16.ext], ['aresample=osf=s16:dither_method=triangular_hp', true, 16, 'wav']);
  assert.deepEqual(w16.codecArgs, ['-c:a', 'pcm_s16le', '-rf64', 'auto']);
  const w24 = outputFormat(p('pcm_s24le', 24), 'wav');
  assert.deepEqual([w24.filter, w24.dither, w24.bits], ['aformat=sample_fmts=s32', false, 24]);
  assert.equal(w24.codecArgs[1], 'pcm_s24le');
  const f16 = outputFormat(p('flac', 16), 'flac');
  assert.deepEqual([f16.dither, f16.ext], [true, 'flac']);
  const f24 = outputFormat(p('flac', 24), 'flac');
  assert.deepEqual([f24.dither, f24.bits, f24.ext], [false, 24, 'flac']);
  const fl = outputFormat(p('pcm_f32le', 32), 'wav');
  assert.deepEqual([fl.filter, fl.dither], [null, false]);
  assert.equal(renderFilter('X', w16), 'aformat=sample_fmts=fltp,X,aresample=osf=s16:dither_method=triangular_hp');
  assert.equal(renderFilter('X', fl), 'aformat=sample_fmts=fltp,X');
});

test('candidate listing and --only matching', () => {
  const names = ['REC020.trimmed.wav', 'b.TRIMMED.FLAC', '.REC1.trimmed.wav', 'REC020.trim.json', 'REC020.noise.wav', 'x.trimmed.mp3', 'c.trimmed.aiff', 'REPORT.md'];
  const list = listTrimmedNames(names);
  assert.deepEqual(list.map((e) => e.name), ['REC020.trimmed.wav', 'b.TRIMMED.FLAC', 'c.trimmed.aiff']);
  assert.deepEqual(list.map((e) => e.stem), ['REC020', 'b', 'c']);
  assert.equal(matchesOnly(list[0], 'rec020'), true);
  assert.equal(matchesOnly(list[0], 'REC020.trimmed.wav'), true);
  assert.equal(matchesOnly(list[0], 'REC02'), false); // exact, not substring
  assert.equal(matchesOnly(list[0], null), true);
});

test('trim.json problems', () => {
  const ok = { output: { name: 'a.trimmed.wav', sha256: 'a'.repeat(64), samples: 10 } };
  assert.equal(trimJsonProblem(ok, 'a.trimmed.wav'), null);
  assert.match(trimJsonProblem({ output: null }, 'a.trimmed.wav'), /no rendered output/);
  assert.match(trimJsonProblem(ok, 'b.trimmed.wav'), /not b\.trimmed\.wav/);
  assert.match(trimJsonProblem({ output: { ...ok.output, sha256: 'x' } }, 'a.trimmed.wav'), /sha256/);
  assert.match(trimJsonProblem({ output: { ...ok.output, samples: 0 } }, 'a.trimmed.wav'), /sample count/);
});

test('restore.json has the contract fields', () => {
  const diag = { ...baseDiag(), hum: { base: 60, f0: 59.9, lines: [] } };
  const plan = buildRestoreChain(diag, N);
  const j = buildRestoreJson({
    plan, diag,
    source: { trimmedName: 'REC020.trimmed.wav', trimmedSha256: 'a'.repeat(64), trimJsonName: 'REC020.trim.json', originalName: 'REC020.WAV' },
    output: { name: 'REC020.restored.wav', sha256: 'b'.repeat(64), samples: N, sampleRate: 44100, channels: 2, durationS: N / 44100, peakDbfs: -1.5 },
    diagVersion: 1, createdAt: 'T',
  });
  assert.deepEqual(Object.keys(j), ['restoreVersion', 'diagVersion', 'chainHash', 'chain', 'chainLabel', 'steps', 'diagSummary', 'source', 'output', 'createdAt']);
  assert.deepEqual(Object.keys(j.diagSummary), ['integratedLufs', 'truePeakDbtp', 'balanceDb', 'humHz', 'rolloffHz', 'nfUsedDb']);
  assert.deepEqual(Object.keys(j.source), ['trimmedName', 'trimmedSha256', 'trimJsonName', 'originalName']);
  assert.deepEqual(Object.keys(j.output), ['name', 'sha256', 'samples', 'sampleRate', 'channels', 'durationS', 'peakDbfs']);
  assert.equal(j.diagSummary.humHz, 59.9);
  assert.equal(buildRestoreJson({ plan, diag: baseDiag(), source: j.source, output: j.output }).diagSummary.humHz, null);
  assert.match(buildRestoreReportMd([j]), /REC020\.restored\.wav .*Clean-up \+ gentle hiss/);
});

// ---------- CLI (local tmp dirs only; never touches /Volumes) ----------

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../../../scripts/mixtapes/restore-mixtapes.mjs');
const FFMPEG = process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg';

test('CLI dry-run on a synthetic local tape plans a chain and writes nothing under src', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-cli-'));
  try {
    const src = path.join(root, 'src');
    const trimmed = path.join(src, '_trimmed');
    fs.mkdirSync(trimmed, { recursive: true });
    const wav = path.join(trimmed, 'T1.trimmed.wav');
    const gen = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=150:r=44100,aformat=channel_layouts=stereo', '-c:a', 'pcm_s16le', wav]);
    assert.equal(gen.status, 0, String(gen.stderr));
    const sha = createHash('sha256').update(fs.readFileSync(wav)).digest('hex');
    const samples = 150 * 44100;
    fs.writeFileSync(path.join(trimmed, 'T1.trim.json'), JSON.stringify({ source: { name: 'T1.WAV' }, keep: [{ startS: 0, endS: 150 }], cuts: [], output: { name: 'T1.trimmed.wav', sha256: sha, samples, durationS: 150 } }));
    const before = fs.readdirSync(src).sort().join();
    const r = spawnSync(process.execPath, [CLI, '--src', src, '--staging', path.join(root, 'stage'), '--allow-local-src', '--only', 'T1'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /mode: dry-run/);
    assert.match(r.stdout, new RegExp(`apad=whole_len=${samples},atrim=end_sample=${samples}`));
    assert.match(r.stdout, /dry-run: no render/);
    assert.equal(fs.readdirSync(src).sort().join(), before); // no _restored created
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI rejects --dry-run with --write and unknown args', () => {
  assert.notEqual(spawnSync(process.execPath, [CLI, '--dry-run', '--write'], { encoding: 'utf8' }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8' }).status, 0);
});
