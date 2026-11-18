// Pure analysis helpers for scripts/mixtapes/diagnose-tape.mjs (no filesystem or process I/O).
// All sample arrays are Float32Array/Float64Array of mono frames unless noted.

// ---------- small stats ----------

export function median(a) {
  if (!a.length) return NaN;
  const s = Array.from(a).sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation. */
export function mad(a) {
  const m = median(a);
  return median(Array.from(a, (x) => Math.abs(x - m)));
}

export const toDb = (p) => (p > 0 ? Math.max(-200, 10 * Math.log10(p)) : -200);
export const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Interleaved f32le Buffer -> { L, R } (stereo) as fresh Float32Arrays (alignment-safe). */
export function deinterleaveStereo(buf) {
  const frames = Math.floor(buf.length / 8);
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    L[i] = buf.readFloatLE(i * 8);
    R[i] = buf.readFloatLE(i * 8 + 4);
  }
  return { L, R };
}

// ---------- FFT ----------

const twiddleCache = new Map();
function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    t = { cos, sin };
    twiddleCache.set(n, t);
  }
  return t;
}

/** In-place iterative radix-2 forward FFT (e^{-j...}). Length must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0 || im.length !== n) throw new Error('fft length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cos[w] - im[b] * sin[w];
        const ti = re[b] * sin[w] + im[b] * cos[w];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** In-place inverse FFT (scaled by 1/n). */
export function ifft(re, im) {
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}

const hannCache = new Map();
function hann(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); // periodic
    hannCache.set(n, w);
  }
  return w;
}

/**
 * Welch PSD, Hann window, 50% overlap. Returns one-sided power per bin (length nperseg/2+1),
 * normalised so the sum over bins equals the mean-square of the signal (a full-scale sine
 * sums to 0.5, i.e. -3 dBFS). Signals shorter than nperseg are zero-padded to one segment.
 */
export function welchPsd(x, nperseg) {
  const w = hann(nperseg);
  let wss = 0;
  for (let i = 0; i < nperseg; i++) wss += w[i] * w[i];
  const bins = nperseg / 2 + 1;
  const acc = new Float64Array(bins);
  const hop = nperseg / 2;
  const re = new Float64Array(nperseg);
  const im = new Float64Array(nperseg);
  let segs = 0;
  for (let s = 0; s === 0 || s + nperseg <= x.length; s += hop) {
    for (let i = 0; i < nperseg; i++) { const v = s + i < x.length ? x[s + i] : 0; re[i] = v * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) / (nperseg * wss);
      acc[k] += k === 0 || k === nperseg / 2 ? p : 2 * p;
    }
    segs++;
  }
  for (let k = 0; k < bins; k++) acc[k] /= segs;
  return acc;
}

/** Sum of PSD power (linear) between two frequencies. */
export function bandPower(psd, nperseg, sr, loHz, hiHz) {
  const bw = sr / nperseg;
  const lo = Math.max(0, Math.ceil(loHz / bw));
  const hi = Math.min(psd.length - 1, Math.floor(hiHz / bw));
  let p = 0;
  for (let k = lo; k <= hi; k++) p += psd[k];
  return p;
}

// ---------- channel statistics ----------

/** DC, RMS, balance, correlation for one stereo excerpt/block. */
export function channelStats(L, R) {
  let sL = 0, sR = 0, sLL = 0, sRR = 0, sLR = 0;
  const n = L.length;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    sL += l; sR += r; sLL += l * l; sRR += r * r; sLR += l * r;
  }
  return finishChannelStats({ n, sL, sR, sLL, sRR, sLR });
}

/** Sums -> report. Sums can be accumulated across blocks/excerpts. */
export function finishChannelStats({ n, sL, sR, sLL, sRR, sLR }) {
  const rmsL = Math.sqrt(sLL / n), rmsR = Math.sqrt(sRR / n);
  const denom = Math.sqrt(sLL * sRR);
  return {
    dcL: sL / n,
    dcR: sR / n,
    rmsLDb: 20 * Math.log10(rmsL || 1e-10),
    rmsRDb: 20 * Math.log10(rmsR || 1e-10),
    balanceDb: 20 * Math.log10((rmsL || 1e-10) / (rmsR || 1e-10)), // + means left louder
    correlation: denom > 0 ? sLR / denom : 0,
    monoSumDb: toDb(1 + (2 * sLR) / (sLL + sRR || 1)), // 0 dB = uncorrelated, +3 = identical, <0 = cancelling
  };
}

// ---------- inter-channel delay (azimuth) ----------

/**
 * Lag (in samples) of R relative to L: positive means R is delayed (R[n] ~ L[n - lag]).
 * Integer cross-correlation over +/-maxLag with parabolic sub-sample interpolation.
 * @returns {{ lag:number, peak:number }} peak = normalised correlation at the best integer lag
 */
export function interChannelLag(L, R, maxLag = 8) {
  const n = Math.min(L.length, R.length);
  const c = new Float64Array(2 * maxLag + 1);
  let eL = 0, eR = 0;
  for (let i = maxLag; i < n - maxLag; i++) { eL += L[i] * L[i]; eR += R[i] * R[i]; }
  for (let d = -maxLag; d <= maxLag; d++) {
    let s = 0;
    for (let i = maxLag; i < n - maxLag; i++) s += L[i] * R[i + d];
    c[d + maxLag] = s;
  }
  let best = 0;
  for (let i = 1; i < c.length; i++) if (c[i] > c[best]) best = i;
  let frac = 0;
  if (best > 0 && best < c.length - 1) {
    const a = c[best - 1], b = c[best], d = c[best + 1];
    const den = a - 2 * b + d;
    if (den < 0) frac = (0.5 * (a - d)) / den;
    if (!(Math.abs(frac) <= 0.5)) frac = 0;
  }
  const norm = Math.sqrt(eL * eR);
  return { lag: best - maxLag + frac, peak: norm > 0 ? c[best] / norm : 0 };
}

/** Aggregate per-excerpt lags: median, MAD, consistent when MAD < 0.15 sample. */
export function summarizeLags(lags, madThreshold = 0.15) {
  const m = median(lags);
  const d = mad(lags);
  return { lagSamples: m, madSamples: d, consistent: lags.length > 0 && d < madThreshold, n: lags.length };
}

// ---------- hum scan ----------

const HUM_BANDS = { 50: [47, 53], 60: [57, 63] };
export const HUM_PROMINENCE_DB = 6;
export const HUM_PRESENT_FRACTION = 0.6;

/**
 * Prominence (dB) of a spectral line near freq: peak bin power within +/-halfWidth Hz versus the
 * median power of the side bands at 1.5..4 x halfWidth on each side. Returns { promDb, peakHz }.
 */
export function lineProminence(psd, nperseg, sr, freq, halfWidthHz) {
  const bw = sr / nperseg;
  const hw = Math.max(halfWidthHz, 2.5 * bw);
  const idx = (hz) => Math.round(hz / bw);
  const lo = Math.max(1, idx(freq - hw)), hi = Math.min(psd.length - 2, idx(freq + hw));
  if (hi < lo) return { promDb: -Infinity, peakHz: freq };
  let pk = lo;
  for (let k = lo; k <= hi; k++) if (psd[k] > psd[pk]) pk = k;
  const sides = [];
  for (let k = idx(freq - 4 * hw); k <= idx(freq - 1.5 * hw); k++) if (k >= 1 && k < psd.length) sides.push(psd[k]);
  for (let k = idx(freq + 1.5 * hw); k <= idx(freq + 4 * hw); k++) if (k >= 1 && k < psd.length) sides.push(psd[k]);
  const floor = median(sides);
  return { promDb: floor > 0 ? toDb(psd[pk]) - toDb(floor) : psd[pk] > 0 ? 60 : -Infinity, peakHz: pk * bw };
}

/**
 * Per-excerpt hum fundamental: strongest line in 47-53 Hz and 57-63 Hz.
 * @returns {{ base:50|60, f0:number, promDb:number, cand:object }}
 */
export function findHumFundamental(psd, nperseg, sr) {
  const bw = sr / nperseg;
  const cand = {};
  for (const [base, [lo, hi]] of Object.entries(HUM_BANDS)) {
    let best = { promDb: -Infinity, peakHz: Number(base) };
    for (let hz = lo; hz <= hi; hz += bw) {
      const r = lineProminence(psd, nperseg, sr, hz, 3 * bw);
      if (r.promDb > best.promDb) best = r;
    }
    cand[base] = best;
  }
  const base = cand[50].promDb >= cand[60].promDb ? 50 : 60;
  return { base, f0: cand[base].peakHz, promDb: cand[base].promDb, cand };
}

/**
 * Hum report over many excerpts. psds: array of Welch PSDs (same nperseg/sr).
 * A harmonic is "proven" when prominence >= 6 dB in >= 60% of excerpts.
 * Harmonic k is searched around k*f0 with half-width max(0.3% of the line, 2.5 bins); each excerpt
 * uses its own drifted f0 when it picked the winning base, else the median f0.
 */
export function scanHum(psds, nperseg, sr, { maxHarmonic = 20 } = {}) {
  const per = psds.map((p) => findHumFundamental(p, nperseg, sr));
  const votes = { 50: 0, 60: 0 };
  for (const r of per) if (r.promDb >= HUM_PROMINENCE_DB) votes[r.base]++;
  const candidateBase = votes[50] === votes[60]
    ? (median(per.map((r) => r.cand[50].promDb)) >= median(per.map((r) => r.cand[60].promDb)) ? 50 : 60)
    : votes[50] > votes[60] ? 50 : 60;
  const f0s = per.filter((r) => r.base === candidateBase).map((r) => r.f0);
  const f0Med = f0s.length ? median(f0s) : candidateBase;
  const bw = sr / nperseg;
  const lines = [];
  for (let k = 1; k <= maxHarmonic && k * f0Med < sr / 2 - 50; k++) {
    const proms = [];
    const freqs = [];
    psds.forEach((p, i) => {
      const f0 = per[i].base === candidateBase ? per[i].f0 : f0Med;
      const r = lineProminence(p, nperseg, sr, k * f0, Math.max(0.003 * k * f0, 2.5 * bw));
      proms.push(r.promDb);
      freqs.push(r.peakHz);
    });
    const present = proms.filter((v) => v >= HUM_PROMINENCE_DB).length / proms.length;
    if (present >= HUM_PRESENT_FRACTION) {
      lines.push({ k, freq: round(median(freqs), 2), medianPromDb: round(median(proms), 1), presentFraction: round(present, 2) });
    }
  }
  return {
    base: lines.length ? candidateBase : null,
    candidateBase,
    f0: round(f0Med, 3),
    f0Spread: round(f0s.length ? Math.max(...f0s) - Math.min(...f0s) : 0, 3),
    fundamentalPromDb: round(median(per.map((r) => r.promDb)), 1),
    lines,
    excerpts: psds.length,
  };
}

// ---------- bandwidth / hiss ----------

/**
 * Frequency where the long-term spectrum falls 20 dB below its 1 kHz level.
 * psd is smoothed into 1/6-octave bands first so tonal peaks do not decide the answer.
 * @returns {number|null} Hz, or null if it never falls that far below Nyquist (full bandwidth).
 */
export function rolloffHz(psd, nperseg, sr, dropDb = 20) {
  const bw = sr / nperseg;
  const bands = [];
  for (let c = 125; c < sr / 2; c *= 2 ** (1 / 6)) {
    const lo = c / 2 ** (1 / 12), hi = Math.min(c * 2 ** (1 / 12), sr / 2);
    const bins = Math.max(1, (hi - lo) / bw);
    bands.push({ c, db: toDb(bandPower(psd, nperseg, sr, lo, hi) / bins) }); // mean power per bin
  }
  let r = 0;
  for (let i = 1; i < bands.length; i++) if (Math.abs(Math.log(bands[i].c / 1000)) < Math.abs(Math.log(bands[r].c / 1000))) r = i;
  const ref = bands[r].db;
  for (let i = r + 1; i < bands.length; i++) {
    if (bands[i].db < ref - dropDb) {
      const prev = bands[i - 1];
      const t = (prev.db - (ref - dropDb)) / (prev.db - bands[i].db || 1);
      return Math.round(prev.c * (bands[i].c / prev.c) ** t); // log-interpolated crossing
    }
  }
  return null;
}

/** Power above loHz (up to min(Nyquist, 20 kHz)) in dBFS (band-limited RMS). */
export function hfLevelDb(psd, nperseg, sr, loHz = 6000) {
  return toDb(bandPower(psd, nperseg, sr, loHz, Math.min(sr / 2, 20000)));
}

/** afftdn noise-floor suggestion: mean (power) of the quiet-window HF levels, clamped to [-80,-20]. */
export function hissEstimate(quietPsds, nperseg, sr, typicalHfDb) {
  const powers = quietPsds.map((p) => bandPower(p, nperseg, sr, 6000, Math.min(sr / 2, 20000)));
  const hissHfDb = toDb(powers.reduce((a, b) => a + b, 0) / (powers.length || 1));
  return { hissHfDb: round(hissHfDb, 1), nfDb: round(clamp(hissHfDb, -80, -20), 1), typicalHfDb: round(typicalHfDb, 1), windows: powers.length };
}

// ---------- ebur128 parsing ----------

/** Parse the ebur128 Summary block (ffmpeg -v info, peak=true). Fields are null if absent. */
export function parseEbur128Summary(text) {
  const i = text.lastIndexOf('Summary:');
  const s = i >= 0 ? text.slice(i) : '';
  const num = (re) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
  return {
    integratedLufs: num(/\bI:\s+(-?[\d.]+)\s+LUFS/),
    lra: num(/\bLRA:\s+(-?[\d.]+)\s+LU\b/),
    truePeakDbtp: num(/True peak:[\s\S]*?Peak:\s+(-?[\d.]+)\s+dBFS/),
  };
}

// ---------- whole-file block scan ----------

export const BLOCK_FFT = 8192;

/**
 * Streams stereo f32 frames and records, per 1-second block: mid mean-square, bass (40-120 Hz) and
 * hats (6-16 kHz) power from one 8192-point Hann FFT at the block start, plus channel sums.
 */
export class BlockScanner {
  constructor(sr) {
    this.sr = sr;
    this.L = new Float32Array(sr);
    this.R = new Float32Array(sr);
    this.fill = 0;
    this.blocks = []; // { rmsPow, bassPow, hatsPow }
    this.sums = { n: 0, sL: 0, sR: 0, sLL: 0, sRR: 0, sLR: 0 };
  }
  /** @param {Float32Array} L @param {Float32Array} R equal length */
  push(L, R) {
    let off = 0;
    while (off < L.length) {
      const take = Math.min(this.sr - this.fill, L.length - off);
      this.L.set(L.subarray(off, off + take), this.fill);
      this.R.set(R.subarray(off, off + take), this.fill);
      this.fill += take;
      off += take;
      if (this.fill === this.sr) { this._block(); this.fill = 0; }
    }
  }
  _block() {
    const { sr, L, R, sums } = this;
    const mid = new Float32Array(sr);
    let pow = 0;
    for (let i = 0; i < sr; i++) {
      const l = L[i], r = R[i];
      sums.sL += l; sums.sR += r; sums.sLL += l * l; sums.sRR += r * r; sums.sLR += l * r;
      mid[i] = (l + r) / 2;
      pow += mid[i] * mid[i];
    }
    sums.n += sr;
    const psd = welchPsd(mid.subarray(0, BLOCK_FFT), BLOCK_FFT);
    this.blocks.push({ rmsPow: pow / sr, bassPow: bandPower(psd, BLOCK_FFT, sr, 40, 120), hatsPow: bandPower(psd, BLOCK_FFT, sr, 6000, 16000) });
  }
  /** A trailing partial block (<1 s) is dropped. */
  finish() { return { blocks: this.blocks, sums: this.sums }; }
}

// ---------- excerpt picking ----------

export const PICK_LEN_S = 20;

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/**
 * Pick 20 s excerpt starts from 1 s blocks. Candidates stay >=10 s from the file start/end,
 * stay clear of the join (+/-12 s around the join point), and never overlap an earlier pick.
 * introS is always 0. joinS is itself an excerpt start (join point minus 10 s) and is passed through.
 */
export function pickExcerpts(blocks, durationS, joinS = null) {
  const len = PICK_LEN_S;
  const taken = [[0, len]];
  const avoid = joinS != null ? [[joinS + len / 2 - 12, joinS + len / 2 + 12]] : [];
  const meanOver = (key, s) => { let t = 0; for (let i = s; i < s + len; i++) t += blocks[i][key]; return t / len; };
  const maxStart = Math.min(Math.floor(durationS - 10 - len), blocks.length - len);
  const pick = (key, dir) => {
    let best = null;
    for (let s = 10; s <= maxStart; s++) {
      if (taken.some(([a, b]) => overlaps(s, s + len, a, b))) continue;
      if (avoid.some(([a, b]) => overlaps(s, s + len, a, b))) continue;
      const v = meanOver(key, s);
      if (best === null || (dir > 0 ? v > best.v : v < best.v)) best = { s, v };
    }
    if (best) taken.push([best.s, best.s + len]);
    return best ? best.s : null;
  };
  const hatsS = pick('hatsPow', +1);
  const bassS = pick('bassPow', +1);
  const quietS = pick('rmsPow', -1);
  return { introS: 0, hatsS, bassS, quietS, joinS };
}

/** Quietest non-overlapping 2 s windows (starts at whole seconds), excluding the last 10 s. */
export function quietestWindows(blocks, count = 10, durationS = blocks.length) {
  const cand = [];
  const last = Math.min(blocks.length - 2, Math.floor(durationS - 10 - 2));
  for (let s = 0; s <= last; s++) cand.push({ s, p: (blocks[s].rmsPow + blocks[s + 1].rmsPow) / 2 });
  cand.sort((a, b) => a.p - b.p);
  const out = [];
  for (const c of cand) {
    if (out.length >= count) break;
    if (out.every((o) => Math.abs(o.s - c.s) >= 2)) out.push(c);
  }
  return out.map((o) => ({ startS: o.s, rmsDb: round(toDb(o.p), 1) }));
}

/** `count` excerpt starts spread over [10, dur-10-len]; frac in [0,0.4] shifts them to avoid another spread. */
export function spreadStarts(count, durationS, lenS, frac = 0) {
  const lo = 10, hi = durationS - 10 - lenS;
  if (hi <= lo) return [Math.max(0, (durationS - lenS) / 2)];
  const step = (hi - lo) / count;
  return Array.from({ length: count }, (_, i) => lo + (i + 0.5 + frac) * step);
}

/** Join excerpt start from a .trim.json report: first keep segment's end minus 10 s, in output time. */
export function joinStartFromTrim(trimJson) {
  const k = trimJson && Array.isArray(trimJson.keep) && trimJson.keep.length > 1 ? trimJson.keep[0] : null;
  if (!k) return null;
  return Math.max(0, k.endS - k.startS - 10);
}
