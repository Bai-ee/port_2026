// Tape diagnostics as an importable function (used by diagnose-tape.mjs and restore-mixtapes.mjs).
// Analyses a LOCAL file only; callers stage NAS files first.
import { fmtTime } from '../../../features/mixtape-processing/trim-io-helpers.js';
import {
  BlockScanner, channelStats, deinterleaveStereo, finishChannelStats, hfLevelDb, hissEstimate, interChannelLag, joinStartFromTrim, median,
  parseEbur128Summary, pickExcerpts, quietestWindows, round, rolloffHz, scanHum, spreadStarts, summarizeLags, welchPsd,
} from '../../../features/mixtape-processing/restore-diagnose.js';
import { FFMPEG, ffmpegBase, niceRun, probeFile } from './staging.mjs';

export const DIAG_VERSION = 1;
const HUM_N = 24, HUM_LEN_S = 12, HUM_NPERSEG = 65536;
const AZ_N = 12, AZ_LEN_S = 2;

/** Decode [startS, startS+lenS) to stereo f32 at the native rate. -ss goes BEFORE -i (fast seek). */
async function decodeExcerpt(file, startS, lenS, af) {
  const args = [...ffmpegBase, '-ss', String(startS), '-t', String(lenS), '-i', file];
  if (af) args.push('-af', af);
  args.push('-ac', '2', '-f', 'f32le', '-');
  return deinterleaveStereo((await niceRun(FFMPEG, args)).stdout);
}

async function loudness(file) {
  const { stderr } = await niceRun(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'info', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const r = parseEbur128Summary(stderr);
  if (r.integratedLufs === null) throw new Error('could not parse ebur128 summary');
  return r;
}

async function blockScan(file, sr) {
  const sc = new BlockScanner(sr);
  let pending = Buffer.alloc(0);
  await niceRun(FFMPEG, [...ffmpegBase, '-i', file, '-ac', '2', '-f', 'f32le', '-'], {
    onStdout: (chunk) => {
      const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const usable = buf.length - (buf.length % 8);
      pending = Buffer.from(buf.subarray(usable));
      if (usable) { const { L, R } = deinterleaveStereo(buf.subarray(0, usable)); sc.push(L, R); }
    },
  });
  return sc.finish();
}

function mid(L, R) {
  const m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) / 2;
  return m;
}

/**
 * Run all diagnostics on a local file.
 * @param {string} stagedPath local audio file
 * @param {{ input?: object, trimJson?: object|null, log?: (msg:string)=>void }} [opts]
 *   input: { path, name, size, sha256 } merged into result.input (provenance of the staged file).
 * @returns {Promise<object>} the diag JSON object (diagVersion, input, loudness, channels, azimuth, hum, bandwidth, hiss, picks)
 */
export async function runDiagnostics(stagedPath, { input = {}, trimJson = null, log = () => {} } = {}) {
  const probe = await probeFile(stagedPath);
  const sr = probe.sampleRate;
  const dur = probe.durationS;
  if (dur < 120) throw new Error('input too short for diagnostics (< 2 min)');
  log(`analysing ${fmtTime(dur)} ${probe.codec} ${sr} Hz ${probe.channels}ch`);

  log('pass 1/4: loudness (ebur128)');
  const loud = await loudness(stagedPath);
  log('pass 2/4: block scan (1 s blocks)');
  const { blocks, sums } = await blockScan(stagedPath, sr);

  log(`pass 3/4: ${HUM_N} x ${HUM_LEN_S} s excerpts (hum, bandwidth, balance)`);
  const humPsds = [];
  const exStats = [];
  const hfTypical = [];
  let avgPsd = null;
  for (const s of spreadStarts(HUM_N, dur, HUM_LEN_S)) {
    const { L, R } = await decodeExcerpt(stagedPath, s, HUM_LEN_S);
    exStats.push(channelStats(L, R));
    const psd = welchPsd(mid(L, R), HUM_NPERSEG);
    humPsds.push(psd);
    hfTypical.push(hfLevelDb(psd, HUM_NPERSEG, sr));
    if (!avgPsd) avgPsd = new Float64Array(psd.length);
    for (let k = 0; k < psd.length; k++) avgPsd[k] += psd[k] / HUM_N;
  }

  log(`pass 4/4: ${AZ_N} x ${AZ_LEN_S} s excerpts (azimuth) + 10 quietest windows (hiss)`);
  const lags = [];
  for (const s of spreadStarts(AZ_N, dur, AZ_LEN_S, 0.25)) {
    const { L, R } = await decodeExcerpt(stagedPath, s, AZ_LEN_S, 'highpass=f=2000');
    lags.push(interChannelLag(L, R, 8).lag);
  }
  const quiet = quietestWindows(blocks, 10, dur);
  const quietPsds = [];
  for (const w of quiet) {
    const { L, R } = await decodeExcerpt(stagedPath, w.startS, 2);
    quietPsds.push(welchPsd(mid(L, R), 8192));
  }

  const joinS = trimJson ? joinStartFromTrim(trimJson) : null;
  const whole = finishChannelStats(sums);
  const az = summarizeLags(lags);
  return {
    diagVersion: DIAG_VERSION,
    createdAt: new Date().toISOString(),
    input: { ...input, durationS: round(dur, 3), sampleRate: sr, channels: probe.channels, codec: probe.codec, bits: probe.bits },
    loudness: loud,
    channels: {
      whole: Object.fromEntries(Object.entries(whole).map(([k, v]) => [k, round(v, k.startsWith('dc') ? 6 : 3)])),
      excerptMedianBalanceDb: round(median(exStats.map((s) => s.balanceDb)), 3),
      excerptMedianCorrelation: round(median(exStats.map((s) => s.correlation)), 3),
      excerptMedianDcL: round(median(exStats.map((s) => s.dcL)), 6),
      excerptMedianDcR: round(median(exStats.map((s) => s.dcR)), 6),
    },
    azimuth: { lagSamples: round(az.lagSamples, 3), madSamples: round(az.madSamples, 3), consistent: az.consistent, n: az.n, lags: lags.map((v) => round(v, 3)) },
    hum: scanHum(humPsds, HUM_NPERSEG, sr),
    bandwidth: { rolloffHz: rolloffHz(avgPsd, HUM_NPERSEG, sr) },
    hiss: { ...hissEstimate(quietPsds, 8192, sr, median(hfTypical)), quietWindows: quiet },
    picks: pickExcerpts(blocks, dur, joinS),
  };
}

/** Short human-readable summary of a diag object. */
export function summaryText(d) {
  const f = (v, dg = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dg) : 'n/a');
  const L = [];
  L.push(`== diagnostics: ${d.input.name}  (${fmtTime(d.input.durationS)}, ${d.input.sampleRate} Hz ${d.input.channels}ch)`);
  L.push(`loudness   I ${f(d.loudness.integratedLufs)} LUFS  LRA ${f(d.loudness.lra)} LU  true peak ${f(d.loudness.truePeakDbtp)} dBTP`);
  const c = d.channels;
  L.push(`channels   DC L ${f(c.whole.dcL * 100, 3)}% R ${f(c.whole.dcR * 100, 3)}%  balance ${f(c.whole.balanceDb, 2)} dB (L-R; excerpt median ${f(c.excerptMedianBalanceDb, 2)})  corr ${f(c.whole.correlation, 2)}  mono-sum ${f(c.whole.monoSumDb, 1)} dB`);
  const a = d.azimuth;
  L.push(`azimuth    R-vs-L lag ${f(a.lagSamples, 2)} samples (MAD ${f(a.madSamples, 2)}, n=${a.n}) -> ${a.consistent ? 'consistent' : 'NOT consistent'}${a.consistent && Math.abs(a.lagSamples) >= 0.5 ? '  [correction warranted]' : ''}`);
  const h = d.hum;
  L.push(`hum        ${h.base ? `${h.base} Hz family, f0 ${f(h.f0, 2)} Hz (drift range ${f(h.f0Spread, 2)} Hz)` : `none proven (best candidate ${h.candidateBase} Hz, fundamental prominence ${f(h.fundamentalPromDb)} dB)`}`);
  for (const l of h.lines) L.push(`             k=${l.k}  ${f(l.freq, 1)} Hz  +${f(l.medianPromDb)} dB  in ${Math.round(l.presentFraction * 100)}% of excerpts`);
  L.push(`bandwidth  -20 dB below 1 kHz level at ${d.bandwidth.rolloffHz ? `${d.bandwidth.rolloffHz} Hz` : `none below Nyquist (full band)`}`);
  L.push(`hiss       HF(>6k) in 10 quietest 2 s windows ${f(d.hiss.hissHfDb)} dBFS (typical excerpt ${f(d.hiss.typicalHfDb)})  -> afftdn nf ${f(d.hiss.nfDb)} dB (upper bound: music present)`);
  const p = d.picks;
  L.push(`picks      intro ${fmtTime(p.introS)}  hats ${p.hatsS == null ? 'n/a' : fmtTime(p.hatsS)}  bass ${p.bassS == null ? 'n/a' : fmtTime(p.bassS)}  quiet ${p.quietS == null ? 'n/a' : fmtTime(p.quietS)}  join ${p.joinS == null ? 'n/a' : fmtTime(p.joinS)}`);
  return L.join('\n');
}
