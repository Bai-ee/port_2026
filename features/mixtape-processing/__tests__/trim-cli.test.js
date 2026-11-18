import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WindowAccumulator, buildFiltergraph, buildReportMd, expectedSamples, filterAudioNames, findMountForPath, fmtTime,
  END_FADE_CURVES, endFadeReport, endFadeSamples, isNasSmbMount, keepToSamples, validateEndFadeParams, parseMountOutput, parseProbe, paramsHash, partitionStemCollisions, selectOutputCodec, shouldSkipRender, stableStringify,
} from '../trim-io-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../../../scripts/mixtapes/trim-mixtapes.mjs');
const DETECT = path.resolve(here, '../trim-detect.js');
const FFMPEG = process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg';

test('listing filter: audio only, case-insensitive, excludes junk, sorted, --only', () => {
  const names = ['b.WAV', 'a.flac', '._a.flac', '.DS_Store', 'a.noise.wav', 'notes.txt', 'c.Mp3', '_trimmed', 'd.opus', 'e.aiff', 'f.m4a', 'g.ogg', 'h.aif'];
  assert.deepEqual(filterAudioNames(names), ['a.flac', 'b.WAV', 'c.Mp3', 'd.opus', 'e.aiff', 'f.m4a', 'g.ogg', 'h.aif']);
  assert.deepEqual(filterAudioNames(names, 'B.w'), ['b.WAV']);
});

test('listing excludes *.trimmed.* outputs', () => {
  assert.deepEqual(filterAudioNames(['a.wav', 'a.trimmed.wav', 'b.TRIMMED.flac', 'c.flac']), ['a.wav', 'c.flac']);
});

test('stem collisions are grouped case-insensitively and not processed', () => {
  const r = partitionStemCollisions(['a.wav', 'a.mp3', 'B.flac', 'b.WAV', 'c.wav']);
  assert.deepEqual(r.ok, ['c.wav']);
  assert.deepEqual(r.collisions.map((g) => [...g].sort()), [['a.mp3', 'a.wav'], ['B.flac', 'b.WAV']]);
});

test('NO_SUSTAINED_RUN, ALL_SILENT and NO_TRIM skip render', () => {
  for (const f of ['NO_SUSTAINED_RUN', 'ALL_SILENT', 'NO_TRIM']) assert.equal(shouldSkipRender(['CLIPPING', f]), true);
  assert.equal(shouldSkipRender(['CLIPPING', 'MANY_CUTS']), false);
  assert.equal(shouldSkipRender([]), false);
});

test('mount parsing: longest prefix wins and smbfs from NAS host is recognised', () => {
  const text = [
    '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
    '//bryan@192.168.1.6/share on /Volumes/bryan (smbfs, nodev, nosuid, mounted by me)',
    '//guest@192.168.1.99/other on /Volumes/other share (smbfs, nodev)',
    '/dev/disk5 on /Volumes/USB (msdos, local)',
  ].join('\n');
  const mounts = parseMountOutput(text);
  assert.equal(mounts.length, 4);
  const nas = findMountForPath(mounts, '/Volumes/bryan/Mix_Tapes_For_Processing');
  assert.equal(nas.mountpoint, '/Volumes/bryan');
  assert.equal(isNasSmbMount(nas), true);
  assert.equal(isNasSmbMount(findMountForPath(mounts, '/Volumes/other share/x')), false); // wrong host
  assert.equal(isNasSmbMount(findMountForPath(mounts, '/Volumes/USB/x')), false); // not smbfs
  assert.equal(isNasSmbMount(findMountForPath(mounts, '/tmp/x')), false); // root apfs
  assert.equal(findMountForPath(mounts, '/Volumes/bryanX/y').mountpoint, '/'); // no partial-name match
  assert.equal(isNasSmbMount(null), false);
});

test('output codec selection', () => {
  const p = (codec, bits, extra = {}) => ({ codec, bits, sampleFmt: '', sampleRate: 44100, channels: 2, ...extra });
  const wav16 = selectOutputCodec(p('pcm_s16le', 16), 'wav');
  assert.deepEqual(wav16.args, ['-c:a', 'pcm_s16le', '-rf64', 'auto']);
  assert.equal(selectOutputCodec(p('pcm_s24le', 24), '.WAV').codec, 'pcm_s24le');
  assert.equal(selectOutputCodec(p('pcm_f32le', 32), 'wav').codec, 'pcm_f32le');
  const aif = selectOutputCodec(p('pcm_s16be', 16), 'aiff');
  assert.equal(aif.codec, 'pcm_s16be');
  assert.equal(aif.ext, 'aiff');
  assert.ok(!aif.args.includes('-rf64'));
  assert.equal(selectOutputCodec(p('pcm_s24be', 24), 'aif').codec, 'pcm_s24be');
  const f24 = selectOutputCodec(p('flac', 24), 'flac');
  assert.deepEqual(f24.args, ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24']);
  assert.equal(f24.lossless, true);
  assert.deepEqual(selectOutputCodec(p('flac', 16), 'flac').args, ['-c:a', 'flac', '-sample_fmt', 's16']);
  const mp3 = selectOutputCodec(p('mp3', 16, { sampleFmt: 'fltp' }), 'mp3');
  assert.equal(mp3.ext, 'flac');
  assert.equal(mp3.lossless, false);
  assert.ok(mp3.args.includes('s16'));
});

test('parseProbe derives bits and exact sample count', () => {
  const p = parseProbe({ streams: [{ codec_name: 'pcm_s24le', sample_rate: '48000', channels: 2, sample_fmt: 's32', bits_per_raw_sample: '24', duration: '10.0', duration_ts: 480000, time_base: '1/48000' }], format: {} });
  assert.equal(p.bits, 24);
  assert.equal(p.totalSamples, 480000);
  assert.equal(parseProbe({ streams: [{ codec_name: 'mp3', sample_rate: '44100', sample_fmt: 'fltp', duration: '2.0' }], format: {} }).totalSamples, 88200);
});

test('keepToSamples snaps edges; filtergraph fades only at cut edges', () => {
  const total = 44100 * 100;
  const segs = keepToSamples([{ startS: 0, endS: 40 }, { startS: 50, endS: 99.95 }, { startS: 99.96, endS: 100 }], 44100, total, 100);
  assert.deepEqual(segs[0], { S: 0, E: 40 * 44100 });
  assert.equal(segs[2].E, total);
  const fg = buildFiltergraph(segs, 44100, total, 50);
  const first = fg.split(';')[0];
  assert.match(first, /^\[0:a\]atrim=start_sample=0:end_sample=1764000,asetpts=PTS-STARTPTS,afade=t=out:st=39\.950000:d=0\.05\[s0\]$/);
  assert.ok(!first.includes('afade=t=in'));
  const last = fg.split(';')[2];
  assert.ok(last.includes('afade=t=in') && !last.includes('afade=t=out'));
  assert.match(fg, /\[s0\]\[s1\]\[s2\]concat=n=3:v=0:a=1\[out\]$/);
  assert.equal(expectedSamples(segs), segs.reduce((n, x) => n + x.E - x.S, 0));
  const single = buildFiltergraph([{ S: 0, E: total }], 44100, total);
  assert.match(single, /\[s0\]anull\[out\]$/);
  assert.ok(!single.includes('afade'));
});

test('end fade: last segment only, qsin, replaces the cut fade', () => {
  const sr = 44100;
  const total = sr * 100;
  const segs = [{ S: 0, E: 40 * sr }, { S: 50 * sr, E: total }];
  const ef = { seconds: 5, curve: 'qsin' };
  const fg = buildFiltergraph(segs, sr, total, 50, ef);
  const parts = fg.split(';');
  assert.equal(parts[0], '[0:a]atrim=start_sample=0:end_sample=1764000,asetpts=PTS-STARTPTS,afade=t=out:st=39.950000:d=0.05[s0]');
  assert.equal(parts[1], '[1:a]atrim=start_sample=2205000:end_sample=4410000,asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st=45.000000:d=5:curve=qsin[s1]');
  assert.equal((fg.match(/curve=qsin/g) || []).length, 1);
  assert.equal(parts[2], '[s0][s1]concat=n=2:v=0:a=1[out]');
  // last segment ends at a cut (not the file end): end fade replaces the 50 ms fade
  const cutEnd = buildFiltergraph([{ S: 0, E: 60 * sr }], sr, total, 50, ef);
  assert.match(cutEnd, /afade=t=out:st=55\.000000:d=5:curve=qsin\[s0\]/);
  assert.ok(!cutEnd.includes('d=0.05'));
  assert.deepEqual(endFadeReport(segs, sr, 5, 'qsin'), { seconds: 5, curve: 'qsin', startS: 85 });
});

test('end fade: single-segment tape fades out and nothing else', () => {
  const sr = 44100;
  const total = sr * 60;
  const fg = buildFiltergraph([{ S: 0, E: total }], sr, total, 50, { seconds: 5, curve: 'qsin' });
  assert.equal(fg, '[0:a]atrim=start_sample=0:end_sample=2646000,asetpts=PTS-STARTPTS,afade=t=out:st=55.000000:d=5:curve=qsin[s0];[s0]anull[out]');
});

test('end fade: last segment shorter than endFadeOutS fades over the whole segment', () => {
  const sr = 44100;
  const total = sr * 100;
  const segs = [{ S: 0, E: 40 * sr }, { S: 50 * sr, E: 52 * sr }];
  const fg = buildFiltergraph(segs, sr, total, 50, { seconds: 5, curve: 'qsin' });
  assert.match(fg.split(';')[1], /afade=t=in:d=0\.05,afade=t=out:st=0\.000000:d=2:curve=qsin\[s1\]$/);
  assert.equal(endFadeSamples(segs, sr, 5), 2 * sr);
  assert.deepEqual(endFadeReport(segs, sr, 5, 'qsin'), { seconds: 2, curve: 'qsin', startS: 40 });
});

test('end fade: endFadeOutS=0 keeps the old 50 ms behaviour', () => {
  const sr = 44100;
  const total = sr * 100;
  const segs = [{ S: 0, E: 40 * sr }, { S: 50 * sr, E: total }];
  assert.equal(buildFiltergraph(segs, sr, total, 50, null), buildFiltergraph(segs, sr, total, 50));
  assert.ok(!buildFiltergraph(segs, sr, total, 50, null).split(';')[1].includes('afade=t=out'));
  assert.equal(endFadeReport(segs, sr, 0, 'qsin'), null);
  assert.equal(endFadeSamples(segs, sr, 0), 0);
});

test('end fade params validation: numeric seconds and allowlisted curve', () => {
  for (const c of END_FADE_CURVES) validateEndFadeParams({ endFadeOutS: 5, endFadeCurve: c });
  validateEndFadeParams({ endFadeOutS: 0, endFadeCurve: 'qsin' });
  assert.throws(() => validateEndFadeParams({ endFadeOutS: -1, endFadeCurve: 'qsin' }));
  assert.throws(() => validateEndFadeParams({ endFadeOutS: '5', endFadeCurve: 'qsin' }));
  assert.throws(() => validateEndFadeParams({ endFadeOutS: 5, endFadeCurve: 'bogus' }));
});

test('paramsHash is key-order independent and value sensitive', () => {
  assert.equal(paramsHash({ a: 1, b: { c: 2, d: 3 } }), paramsHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(paramsHash({ a: 1 }), paramsHash({ a: 2 }));
  assert.equal(paramsHash({ a: 1 }).length, 16);
  assert.equal(stableStringify({ b: [1, { z: 1, y: 2 }], a: null }), '{"a":null,"b":[1,{"y":2,"z":1}]}');
});

test('fmtTime and REPORT.md builder', () => {
  assert.equal(fmtTime(3725.5), '01:02:05.500');
  const md = buildReportMd([
    { source: { name: 'b|x.wav', durationS: 3600 }, output: null, cuts: [], flags: ['ALL_SILENT'] },
    { source: { name: 'a.wav', durationS: 3600 }, output: { durationS: 3300 }, cuts: [{ kind: 'head' }, { kind: 'gap' }, { kind: 'gap' }], flags: [] },
  ]);
  const lines = md.split('\n');
  assert.ok(lines.some((l) => l === '| a.wav | 01:00:00 -> 00:55:00 | 1 head, 2 gap | - |'));
  assert.ok(lines.some((l) => l === '| b\\|x.wav | 01:00:00 -> not rendered | none | ALL_SILENT |'));
  assert.ok(md.indexOf('| a.wav') < md.indexOf('| b\\|x.wav'));
});

test('WindowAccumulator: dB per 100 ms window, max of channels, clip count', () => {
  const frames = 1600 * 3;
  const f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { f[2 * i] = 0.1; f[2 * i + 1] = i < 1600 ? 0.5 : 0; }
  f[2] = 1.0; // one clipped sample in window 0 (also raises its right channel? no: this is left)
  const acc = new WindowAccumulator(2);
  const b = Buffer.from(f.buffer);
  acc.push(b.subarray(0, 1001)); // split mid-sample to exercise carry-over
  acc.push(b.subarray(1001));
  const { windowsDb, clipped } = acc.finish();
  assert.equal(windowsDb.length, 3);
  assert.ok(Math.abs(windowsDb[1] - 20 * Math.log10(0.1)) < 0.01);
  assert.ok(windowsDb[0] > -7 && windowsDb[0] < -5.5); // right channel 0.5 dominates (~ -6 dB)
  assert.equal(clipped, 1);
  const silent = new WindowAccumulator(1);
  silent.push(Buffer.alloc(1600 * 4));
  assert.equal(silent.finish().windowsDb[0], -120);
});

// ---------- end to end (local tmp dir, explicit --allow-local-src) ----------

const haveDetect = fs.existsSync(DETECT);
test('end to end: synthetic tape dry-run, write, idempotent re-run', { skip: haveDetect ? false : 'features/mixtape-processing/trim-detect.js not present yet (Module A); e2e skipped' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtape-e2e-'));
  try {
    const src = path.join(root, 'src');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(src);
    // hiss 10 s, music 35 s, hiss 10 s (side flip), music 35 s, hiss 10 s; mono 16 kHz, 100 s.
    const hiss = (i) => `[${i}]aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`;
    const tone = (i) => `[${i}]aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`;
    const inputs = [];
    const defs = [['n', 10], ['t', 35], ['n', 10], ['t', 35], ['n', 10]];
    defs.forEach(([k, d], i) => inputs.push('-f', 'lavfi', '-i', k === 'n' ? `anoisesrc=d=${d}:a=0.001:r=16000:seed=${i + 1}` : `sine=f=${300 + i * 50}:d=${d}:r=16000,tremolo=f=2:d=0.7,volume=0.5`));
    const fc = defs.map(([k], i) => (k === 'n' ? hiss(i) : tone(i))).join(';') + ';[a0][a1][a2][a3][a4]concat=n=5:v=0:a=1[o]';
    const gen = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...inputs, '-filter_complex', fc, '-map', '[o]', '-c:a', 'pcm_s16le', path.join(src, 'Tape One.wav')]);
    assert.equal(gen.status, 0, String(gen.stderr));

    const run = (...extra) => spawnSync('node', [CLI, '--src', src, '--staging', staging, '--allow-local-src', ...extra], { encoding: 'utf8' });

    const dry = run();
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.ok(fs.existsSync(path.join(staging, 'reports', 'Tape One.trim.json')));
    assert.ok(!fs.existsSync(path.join(src, '_trimmed')), 'dry-run must not write to src');
    assert.ok(!fs.existsSync(path.join(staging, '.lock')));
    assert.ok(!fs.existsSync(path.join(staging, 'work', 'Tape One')), 'staging dir cleaned');

    const w = run('--write');
    assert.equal(w.status, 0, w.stdout + w.stderr);
    const td = path.join(src, '_trimmed');
    const report = JSON.parse(fs.readFileSync(path.join(td, 'Tape One.trim.json'), 'utf8'));
    assert.equal(report.source.name, 'Tape One.wav');
    assert.ok(report.keep.length >= 1);
    assert.ok(report.output && report.output.samples > 0, 'rendered');
    assert.ok(report.output.samples < 100 * 16000, 'output shorter than source');
    assert.ok(fs.existsSync(path.join(td, report.output.name)));
    assert.ok(fs.existsSync(path.join(td, 'REPORT.md')));
    assert.ok(fs.readFileSync(path.join(td, 'REPORT.md'), 'utf8').includes('Tape One.wav'));
    assert.ok(fs.readdirSync(td).every((n) => !n.endsWith('.part')));
    assert.ok(fs.existsSync(path.join(src, 'Tape One.wav')), 'original untouched');
    assert.equal(report.renderVersion, 1);
    assert.equal(report.endFade.curve, 'tri');
    assert.equal(report.endFade.seconds, 5);
    assert.ok(Math.abs(report.endFade.startS - (report.output.durationS - 5)) < 1e-6);
    {
      // last 0.5 s must be >= 20 dB quieter than the 5-6 s-before-end region
      const dec = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-i', path.join(td, report.output.name), '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 1 << 28 });
      assert.equal(dec.status, 0);
      const f = new Float32Array(dec.stdout.buffer.slice(dec.stdout.byteOffset, dec.stdout.byteOffset + dec.stdout.length - (dec.stdout.length % 4)));
      const rmsDb = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += f[i] * f[i]; return 20 * Math.log10(Math.sqrt(t / (b - a)) || 1e-9); };
      const n = f.length, sr = 16000;
      const loud = rmsDb(n - 6 * sr, n - 5 * sr);
      const quiet = rmsDb(n - sr / 2, n);
      assert.ok(loud - quiet >= 20, `end fade only ${(loud - quiet).toFixed(1)} dB quieter`);
    }

    // steady loud tone tail (no modulation) is buzz and must be cut with that reason
    const src2 = path.join(root, 'src2');
    fs.mkdirSync(src2);
    const fc2 = '[0]aformat=sample_fmts=s16:channel_layouts=mono[a0];[1]aformat=sample_fmts=s16:channel_layouts=mono[a1];[2]aformat=sample_fmts=s16:channel_layouts=mono[a2];[3]aformat=sample_fmts=s16:channel_layouts=mono[a3];[a0][a1][a2][a3]concat=n=4:v=0:a=1[o]';
    const in2 = ['-f', 'lavfi', '-i', 'anoisesrc=d=10:a=0.001:r=16000:seed=1',
      '-f', 'lavfi', '-i', 'sine=f=300:d=35:r=16000,tremolo=f=2:d=0.7,volume=0.5',
      '-f', 'lavfi', '-i', 'anoisesrc=d=10:a=0.001:r=16000:seed=2',
      '-f', 'lavfi', '-i', 'sine=f=440:d=30:r=16000,volume=0.5'];
    const gen2 = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...in2, '-filter_complex', fc2, '-map', '[o]', '-c:a', 'pcm_s16le', path.join(src2, 'Buzz Tail.wav')]);
    assert.equal(gen2.status, 0, String(gen2.stderr));
    const st2 = path.join(root, 'staging2');
    const d2 = spawnSync('node', [CLI, '--src', src2, '--staging', st2, '--allow-local-src'], { encoding: 'utf8' });
    assert.equal(d2.status, 0, d2.stdout + d2.stderr);
    const r2 = JSON.parse(fs.readFileSync(path.join(st2, 'reports', 'Buzz Tail.trim.json'), 'utf8'));
    assert.ok(r2.cuts.some((c) => c.reason === 'stationary buzz'), JSON.stringify(r2.cuts));

    const again = run('--write');
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /already processed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('write mode without --allow-local-src refuses a non-smbfs src', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtape-guard-'));
  try {
    const r = spawnSync('node', [CLI, '--src', root, '--staging', path.join(root, 'st'), '--write'], { encoding: 'utf8' });
    // Module A may be absent (import failure also exits 1); either way nothing may be created.
    assert.equal(r.status, 1);
    assert.ok(!fs.existsSync(path.join(root, '_trimmed')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--params windowMs is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtape-params-'));
  try {
    const r = spawnSync('node', [CLI, '--src', root, '--staging', path.join(root, 'st'), '--params', '{"windowMs":200}'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /windowMs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e2e: stem collision fails the run and is not processed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtape-coll-'));
  try {
    const src = path.join(root, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.wav'), 'x');
    fs.writeFileSync(path.join(src, 'a.mp3'), 'y');
    const r = spawnSync('node', [CLI, '--src', src, '--staging', path.join(root, 'st'), '--allow-local-src'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /stem collision: a\.wav, a\.mp3|stem collision: a\.mp3, a\.wav/);
    assert.match(r.stdout, /tapes: 0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
