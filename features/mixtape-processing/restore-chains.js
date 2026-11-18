// Pure helpers for scripts/mixtapes/make-samples.mjs (no filesystem or process I/O):
// ffmpeg filter-chain strings, level-match gain math and the true-peak clamp.

export const TARGET_LUFS = -14;
export const TP_CEILING_DB = -1;
export const PREROLL_S = 5;
export const EXCERPT_S = 20;

/** 4th-order Butterworth high-pass at 22 Hz (two cascaded biquads). */
export const HP_FILTER = 'highpass=f=22:t=q:w=0.5412,highpass=f=22:t=q:w=1.3066';

const num = (v, d = 4) => String(Math.round(v * 10 ** d) / 10 ** d);

/** Narrow notch for one proven hum line; depth capped at 20 dB. */
export function humNotch(freq, promDb) {
  return `equalizer=f=${num(freq, 3)}:t=q:w=30:g=-${num(Math.min(promDb, 20), 2)}`;
}

/** True when whole-tape and excerpt-median balance agree in sign and both exceed the threshold. */
export function balanceIsConsistent(diag, thresholdDb = 0.5) {
  const w = diag?.channels?.whole?.balanceDb;
  const e = diag?.channels?.excerptMedianBalanceDb;
  return Number.isFinite(w) && Number.isFinite(e) && Math.abs(w) > thresholdDb && Math.abs(e) > thresholdDb && Math.sign(w) === Math.sign(e);
}

/** Linear channel gains {gL, gR}; balanceDb = L - R. The louder channel is attenuated by the full difference. */
export function balanceGains(balanceDb) {
  const g = 10 ** (-Math.abs(balanceDb) / 20);
  return balanceDb < 0 ? { gL: 1, gR: g } : { gL: g, gR: 1 };
}

/** Azimuth filter (lag = R relative to L, samples; positive = R late so L is delayed). Null when below threshold/inconsistent. */
export function azimuthFilter(az, sampleRate = 44100, minLag = 0.5) {
  if (!az || !az.consistent || !Number.isFinite(az.lagSamples) || Math.abs(az.lagSamples) < minLag) return null;
  const os = 8;
  const n = Math.round(Math.abs(az.lagSamples) * os);
  if (n === 0) return null;
  const delays = az.lagSamples > 0 ? `${n}S|0S` : `0S|${n}S`;
  return `aresample=${sampleRate * os},adelay=delays=${delays},aresample=${sampleRate}`;
}

/** V1 clean-up chain (string) from a diagnostics object. Returns { chain, parts }. */
export function buildCleanup(diag) {
  const parts = [HP_FILTER];
  for (const l of diag?.hum?.lines || []) parts.push(humNotch(l.freq, l.medianPromDb));
  if (balanceIsConsistent(diag)) {
    const { gL, gR } = balanceGains(diag.channels.whole.balanceDb);
    parts.push(`pan=stereo|c0=${num(gL)}*c0|c1=${num(gR)}*c1`);
  }
  const az = azimuthFilter(diag?.azimuth, diag?.input?.sampleRate || 44100);
  if (az) parts.push(az);
  return { chain: parts.join(','), parts };
}

/** afftdn variants; nf already resolved by the caller (override recorded separately). */
export const afftdn = (nr, nf, gs, extra = '') => `afftdn=nr=${nr}:nf=${nf}:tn=1:gs=${gs}:nl=min${extra}`;
export const ANLMDN = 'anlmdn=s=0.0007:p=0.002:r=0.006:m=11';
export const HIGH_SHELF = 'highshelf=f=10000:t=q:w=0.7:g=2';

/** Whole-tape V5 gain in dB: min(target - I, ceiling - TP). */
export function finalMasterGainDb(integratedLufs, truePeakDbtp, target = TARGET_LUFS, ceiling = TP_CEILING_DB) {
  return Math.min(target - integratedLufs, ceiling - truePeakDbtp);
}

export const volumeFilter = (db) => `volume=${num(db, 3)}dB`;

/**
 * Level-match gains for one excerpt. measured = { V0:{lufs,tp}, ... } of the unmatched renders.
 * matchIds are matched to V0's LUFS. If any matched file would exceed the TP ceiling, ALL
 * (including V0) are lowered by the same excess so relative levels stay equal.
 * @returns {{ gains: Record<string,number>, clampDb: number }}
 */
export function matchGains(measured, matchIds, ceiling = TP_CEILING_DB) {
  const target = measured.V0.lufs;
  const gains = { V0: 0 };
  for (const id of matchIds) gains[id] = target - measured[id].lufs;
  let excess = 0;
  for (const id of Object.keys(gains)) excess = Math.max(excess, measured[id].tp + gains[id] - ceiling);
  if (excess > 0) for (const id of Object.keys(gains)) gains[id] -= excess;
  return { gains, clampDb: excess };
}

/** Residual gain = its parent's final gain (never matched on its own). */
export function residualGain(gains, parentId) {
  return gains[parentId];
}

/** Final encode filter for review FLAC: 16-bit with triangular_hp dither. */
export const FLAC_DITHER = 'aresample=osf=s16:dither_method=triangular_hp';

/** Wrap a chain for excerpt rendering: filters, then drop the pre-roll and reset timestamps. */
export function excerptChain(chain, prerollS) {
  const trim = `atrim=start=${prerollS},asetpts=PTS-STARTPTS`;
  return chain ? `${chain},${trim}` : trim;
}
