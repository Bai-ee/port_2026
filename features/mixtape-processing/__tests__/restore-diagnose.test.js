import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fft, ifft, welchPsd, bandPower, channelStats, interChannelLag, summarizeLags, scanHum, rolloffHz, hissEstimate,
  parseEbur128Summary, BlockScanner, pickExcerpts, quietestWindows, spreadStarts, joinStartFromTrim, median, mad,
} from '../restore-diagnose.js';

const SR = 44100;

function rng(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

/** White noise, brick-wall low-passed (and optionally high-passed) in the frequency domain. */
function bandNoise(n, loHz, hiHz, seed, delaySamples = 0) {
  const r = rng(seed);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = gauss(r);
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const kk = k <= n / 2 ? k : n - k;
    const f = (kk * SR) / n;
    if (f < loHz || f > hiHz) { re[k] = 0; im[k] = 0; continue; }
    const ph = (-2 * Math.PI * (k <= n / 2 ? k : k - n) * delaySamples) / n; // circular fractional delay
    const c = Math.cos(ph), s = Math.sin(ph);
    const a = re[k], b = im[k];
    re[k] = a * c - b * s; im[k] = a * s + b * c;
  }
  ifft(re, im);
  return Float32Array.from(re, (v) => v * 0.2);
}

test('fft: sine lands in its bin with amplitude N/2; ifft round-trips', () => {
  const n = 1024, bin = 37;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * bin * i) / n));
  const im = new Float64Array(n);
  const orig = Float64Array.from(re);
  fft(re, im);
  assert.ok(Math.abs(Math.hypot(re[bin], im[bin]) - n / 2) < 1e-6);
  assert.ok(Math.hypot(re[bin + 3], im[bin + 3]) < 1e-6);
  ifft(re, im);
  for (let i = 0; i < n; i += 97) assert.ok(Math.abs(re[i] - orig[i]) < 1e-9);
  assert.throws(() => fft(new Float64Array(100), new Float64Array(100)));
});

test('welchPsd: full-scale sine sums to 0.5 and peaks at the right frequency', () => {
  const n = 65536 * 3;
  const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR));
  const psd = welchPsd(x, 8192);
  const total = bandPower(psd, 8192, SR, 0, SR / 2);
  assert.ok(Math.abs(total - 0.5) < 0.01, `total ${total}`);
  let pk = 0;
  for (let k = 1; k < psd.length; k++) if (psd[k] > psd[pk]) pk = k;
  assert.ok(Math.abs((pk * SR) / 8192 - 1000) < SR / 8192);
});

test('channelStats: DC offset and 1.5 dB balance are detected', () => {
  const r = rng(3);
  const n = SR * 2;
  const g = 10 ** (1.5 / 20);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = (r() - 0.5) * 0.4; L[i] = v * g + 0.02; R[i] = v - 0.01; }
  const s = channelStats(L, R);
  assert.ok(Math.abs(s.dcL - 0.02) < 0.002 && Math.abs(s.dcR + 0.01) < 0.002, `dc ${s.dcL} ${s.dcR}`);
  assert.ok(Math.abs(s.balanceDb - 1.5) < 0.15, `balance ${s.balanceDb}`);
  assert.ok(s.correlation > 0.9);
});

test('interChannelLag: 0.4-sample delay detected, consistent across excerpts', () => {
  const lags = [];
  for (let e = 0; e < 8; e++) {
    const n = 65536; // ~1.5 s, circular-delayed so the shift is exact
    const L = bandNoise(n, 2000, 12000, 10 + e, 0);
    const R = bandNoise(n, 2000, 12000, 10 + e, 0.4);
    lags.push(interChannelLag(L, R, 8).lag);
  }
  const s = summarizeLags(lags);
  assert.ok(Math.abs(s.lagSamples - 0.4) < 0.1, `lag ${s.lagSamples}`);
  assert.equal(s.consistent, true);
});

test('interChannelLag: integer lags and sign (R delayed => positive)', () => {
  const L = bandNoise(32768, 2000, 12000, 5, 0);
  const R = bandNoise(32768, 2000, 12000, 5, 3);
  assert.ok(Math.abs(interChannelLag(L, R, 8).lag - 3) < 0.05);
  assert.ok(Math.abs(interChannelLag(R, L, 8).lag + 3) < 0.05);
});

test('summarizeLags: scattered lags are not consistent', () => {
  assert.equal(summarizeLags([0.1, 0.9, -0.5, 0.4, -0.3]).consistent, false);
});

function humExcerpt(seed, f0, harmonics, amp = 0.01) {
  const n = SR * 12;
  const r = rng(seed);
  const x = new Float32Array(n);
  // pink-ish background: low-passed noise louder at low freq, so the floor is not flat
  const bg = bandNoise(65536, 20, 8000, seed + 100);
  for (let i = 0; i < n; i++) {
    let v = bg[i % bg.length] * 0.5 + (r() - 0.5) * 0.002;
    for (const k of harmonics) v += (amp / k) * Math.sin((2 * Math.PI * k * f0 * i) / SR);
    x[i] = v;
  }
  return x;
}

test('scanHum: 61 Hz hum with harmonics -> base 60, f0 ~61, harmonics proven', () => {
  const psds = [];
  for (let e = 0; e < 8; e++) psds.push(welchPsd(humExcerpt(e + 1, 61 + (e % 3) * 0.05, [1, 2, 3, 5]), 65536));
  const h = scanHum(psds, 65536, SR);
  assert.equal(h.base, 60);
  assert.ok(Math.abs(h.f0 - 61.05) < 0.3, `f0 ${h.f0}`);
  const ks = h.lines.map((l) => l.k);
  for (const k of [1, 2, 3, 5]) assert.ok(ks.includes(k), `harmonic ${k} in ${ks}`);
  assert.ok(!ks.includes(4) && !ks.includes(7), `unexpected ${ks}`);
});

test('scanHum: 50 Hz detected as 50', () => {
  const psds = [];
  for (let e = 0; e < 6; e++) psds.push(welchPsd(humExcerpt(e + 20, 50.2, [1, 2, 4]), 65536));
  const h = scanHum(psds, 65536, SR);
  assert.equal(h.base, 50);
  assert.ok(Math.abs(h.f0 - 50.2) < 0.3);
});

test('scanHum: no hum -> base null, no lines', () => {
  const psds = [];
  for (let e = 0; e < 6; e++) psds.push(welchPsd(humExcerpt(e + 40, 50, [], 0), 65536));
  const h = scanHum(psds, 65536, SR);
  assert.equal(h.base, null);
  assert.equal(h.lines.length, 0);
});

test('rolloffHz: low-passed noise reports ~ its cutoff; full-band reports null', () => {
  const x = bandNoise(65536 * 4, 0, 9000, 7);
  const psd = welchPsd(x, 16384);
  const ro = rolloffHz(psd, 16384, SR);
  assert.ok(ro && ro > 8000 && ro < 10500, `rolloff ${ro}`);
  const full = welchPsd(bandNoise(65536 * 4, 0, SR / 2, 8), 16384);
  assert.equal(rolloffHz(full, 16384, SR), null);
});

test('hissEstimate: clamps nf to [-80, -20]', () => {
  const quiet = welchPsd(bandNoise(65536, 6000, 16000, 9).map((v) => v * 1e-4), 8192);
  const e = hissEstimate([quiet], 8192, SR, -50);
  assert.equal(e.nfDb, -80);
  const loud = welchPsd(bandNoise(65536, 6000, 16000, 9).map((v) => v * 20), 8192);
  assert.equal(hissEstimate([loud], 8192, SR, -50).nfDb, -20);
});

test('parseEbur128Summary: reads I, LRA, true peak', () => {
  const txt = `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -10.4 LUFS
    Threshold: -20.5 LUFS

  Loudness range:
    LRA:         6.2 LU
    LRA low:   -14.2 LUFS

  True peak:
    Peak:       -1.3 dBFS
`;
  assert.deepEqual(parseEbur128Summary(txt), { integratedLufs: -10.4, lra: 6.2, truePeakDbtp: -1.3 });
  assert.equal(parseEbur128Summary('nothing').integratedLufs, null);
});

test('BlockScanner + picks: finds the hat-heavy, bass-heavy and quiet blocks, avoids the join', () => {
  const sr = 8000; // small rate keeps the test quick; 1 s blocks
  const total = 200;
  const sc = new BlockScanner(sr);
  for (let s = 0; s < total; s++) {
    const L = new Float32Array(sr);
    const hats = s >= 120 && s < 145 ? 0.2 : 0.01;
    const bass = s >= 60 && s < 85 ? 0.3 : 0.01;
    const quiet = s >= 150 && s < 180;
    for (let i = 0; i < sr; i++) {
      const t = i / sr;
      L[i] = (quiet ? 0.1 : 1) * (hats * Math.sin(2 * Math.PI * 3500 * t) + bass * Math.sin(2 * Math.PI * 80 * t) + 0.05 * Math.sin(2 * Math.PI * 500 * t));
    }
    sc.push(L, L);
  }
  const { blocks, sums } = sc.finish();
  assert.equal(blocks.length, total);
  assert.equal(sums.n, total * sr);
  // sr=8000 has no 6-16 kHz content, so hatsS is only checked for being picked and non-overlapping
  const p = pickExcerpts(blocks, total, null);
  assert.equal(p.introS, 0);
  assert.ok(p.bassS >= 45 && p.bassS <= 70, `bass ${p.bassS}`);
  assert.ok(p.quietS >= 140 && p.quietS <= 160, `quiet ${p.quietS}`);
  assert.ok(p.hatsS !== null);
  const picks = [0, p.hatsS, p.bassS, p.quietS];
  for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) assert.ok(Math.abs(picks[i] - picks[j]) >= 20, `overlap ${picks}`);
  // join avoidance: join at 70 s (excerpt start 60) pushes the bass pick out of 58..82
  const q = pickExcerpts(blocks, total, 60);
  assert.ok(q.bassS + 20 <= 58 || q.bassS >= 82, `bass near join ${q.bassS}`);
});

test('quietestWindows: picks non-overlapping lowest 2 s windows, skips the last 10 s', () => {
  const blocks = Array.from({ length: 60 }, (_, i) => ({ rmsPow: i >= 20 && i < 24 ? 1e-6 : i >= 55 ? 1e-9 : 0.01 }));
  const w = quietestWindows(blocks, 3, 60);
  assert.equal(w.length, 3);
  assert.ok(w.every((x) => x.startS <= 48), JSON.stringify(w));
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) assert.ok(Math.abs(w[i].startS - w[j].startS) >= 2);
});

test('spreadStarts / joinStartFromTrim / median / mad', () => {
  const s = spreadStarts(12, 5721.5, 2, 0.25);
  assert.equal(s.length, 12);
  assert.ok(s[0] >= 10 && s[11] <= 5721.5 - 10 - 2);
  assert.equal(joinStartFromTrim({ keep: [{ startS: 0, endS: 2852.9 }, { startS: 2867.9, endS: 5736.5 }] }), 2842.9);
  assert.equal(joinStartFromTrim({ keep: [{ startS: 0, endS: 100 }] }), null);
  assert.equal(joinStartFromTrim(null), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(mad([1, 2, 3, 4, 100]), 1);
});
