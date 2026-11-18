// Pure helpers for scripts/mixtapes/restore-mixtapes.mjs (no filesystem or process I/O):
// the V6 restore chain, length forcing, output format, clip-risk check, idempotency key,
// candidate listing and the restore.json / REPORT.md builders.
import { createHash } from 'node:crypto';
import { HIGH_SHELF, afftdn, balanceIsConsistent, azimuthFilter, buildCleanup } from './restore-chains.js';
import { fmtTime, isLosslessSource, selectOutputCodec } from './trim-io-helpers.js';

export const RESTORE_VERSION = 1; // bump when the chain, format rules or restore.json contract change
export const NR_DB = 6;
export const NF_FLOOR_DB = -50; // never assume a floor quieter than this (gentle, never aggressive)
export const GS = 8;
export const AIR_MAX_ROLLOFF_HZ = 13000;
export const CLIP_RISK_DBFS = -0.1;
export const RESTORED_EXTS = ['wav', 'flac', 'aif', 'aiff'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** afftdn noise floor: min(diagnosed, -50 dB), clamped to [-80, -20]. Falls back to -50 when not measured. */
export function resolveNf(diagNf) {
  const v = Number.isFinite(diagNf) ? Math.min(diagNf, NF_FLOOR_DB) : NF_FLOOR_DB;
  return Math.round(clamp(v, -80, -20) * 10) / 10;
}

/** Exact-length forcing: pad with silence if short, cut if long, so output samples === n. */
export function lengthForce(n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`bad sample count ${n}`);
  return `apad=whole_len=${n},atrim=end_sample=${n}`;
}

/** Hum lines that were proven by the diagnostics (a family was identified); depth is capped at 20 dB. */
export function provenHumLines(diag) {
  if (!diag?.hum?.base) return [];
  return (diag.hum.lines || []).map((l) => ({ freq: l.freq, gainDb: -Math.min(l.medianPromDb, 20) }));
}

/**
 * Build the V6 restore chain.
 * @param {object} diag diagnostics JSON
 * @param {number} totalSamples sample count of the trimmed input (output is forced to exactly this)
 * @returns {{ chain:string, chainHash:string, chainLabel:string, steps:{hum:object[], balanceDb:number|null, azimuth:number|null, air:boolean}, nfUsedDb:number }}
 */
export function buildRestoreChain(diag, totalSamples) {
  const cleanup = buildCleanup({ ...diag, hum: { lines: provenHumLines(diag).length ? diag.hum.lines : [] } }); // HP, proven hum notches, balance (if consistent), azimuth (if warranted)
  const parts = [...cleanup.parts];
  const nfUsedDb = resolveNf(diag?.hiss?.nfDb);
  parts.push(afftdn(NR_DB, nfUsedDb, GS));
  const rolloff = diag?.bandwidth?.rolloffHz;
  const air = Number.isFinite(rolloff) && rolloff < AIR_MAX_ROLLOFF_HZ;
  if (air) parts.push(HIGH_SHELF);
  parts.push(lengthForce(totalSamples));
  const chain = parts.join(',');
  const sr = diag?.input?.sampleRate || 44100;
  const az = azimuthFilter(diag?.azimuth, sr);
  return {
    chain,
    chainHash: chainHash(chain),
    chainLabel: air ? 'Clean-up + gentle hiss + air' : 'Clean-up + gentle hiss',
    steps: {
      hum: provenHumLines(diag),
      balanceDb: balanceIsConsistent(diag) ? diag.channels.whole.balanceDb : null,
      azimuth: az ? diag.azimuth.lagSamples : null,
      air,
    },
    nfUsedDb,
  };
}

/** First 12 hex of sha256(chain string). */
export function chainHash(chain) {
  return createHash('sha256').update(chain).digest('hex').slice(0, 12);
}

/**
 * Output format for a restored tape, derived from the trimmed input's probe.
 * 16-bit PCM/FLAC (and anything lossy-decoded) -> s16 with triangular_hp dither;
 * 24/32-bit int -> s32/24 without dither; float WAV -> float, no format filter.
 * @returns {{ filter:string|null, codecArgs:string[], ext:string, dither:boolean, bits:number }}
 */
export function outputFormat(probe, srcExt) {
  const codec = selectOutputCodec(probe, srcExt);
  const isFloat = /pcm_f(32|64)/.test(probe.codec);
  if (isFloat && codec.ext === 'wav') return { filter: null, codecArgs: codec.args, ext: codec.ext, dither: false, bits: 32 };
  const deep = probe.bits > 16 && isLosslessSource(probe) && !isFloat;
  if (deep || (!isLosslessSource(probe) && probe.bits > 16)) {
    return { filter: 'aformat=sample_fmts=s32', codecArgs: codec.args, ext: codec.ext, dither: false, bits: 24 };
  }
  return { filter: 'aresample=osf=s16:dither_method=triangular_hp', codecArgs: codec.args, ext: codec.ext, dither: true, bits: 16 };
}

/** Full -af value: f32 internal processing, the chain, then the output-format filter. */
export function renderFilter(chain, format) {
  return ['aformat=sample_fmts=fltp', chain, format.filter].filter(Boolean).join(',');
}

/** Parse the highest per-channel "Peak level dB" from ffmpeg astats output; null when none found. */
export function parseAstatsPeak(text) {
  let peak = null;
  for (const m of String(text).matchAll(/Peak level dB:\s+(-?[\d.]+|-inf)/g)) {
    const v = m[1] === '-inf' ? -200 : Number(m[1]);
    if (peak === null || v > peak) peak = v;
  }
  return peak;
}

/** True when the measured output peak is too hot (clip risk): the tape fails, no silent gain. */
export function isClipRisk(peakDbfs) {
  return !Number.isFinite(peakDbfs) || peakDbfs > CLIP_RISK_DBFS;
}

/** Idempotency: an existing restore.json is current for (trimmed sha, RESTORE_VERSION[, chainHash]). */
export function isUpToDate(prev, { trimmedSha256, restoreVersion = RESTORE_VERSION, chainHash: hash = null, diagVersion = null }) {
  if (!prev || !prev.source || !prev.output) return false;
  if (prev.source.trimmedSha256 !== trimmedSha256 || prev.restoreVersion !== restoreVersion) return false;
  // restore.json written before diagVersion existed used diagnostics v1
  if (diagVersion !== null && (prev.diagVersion ?? 1) !== diagVersion) return false;
  return hash === null || prev.chainHash === hash;
}

// ---------- listing ----------

/**
 * Restorable names directly inside _trimmed: `<stem>.trimmed.(wav|flac|aif|aiff)`, no dot-files.
 * @returns {{ name:string, stem:string }[]} sorted; stem is the ORIGINAL tape stem (REC020)
 */
export function listTrimmedNames(names) {
  const re = new RegExp(`^(.+)\\.trimmed\\.(${RESTORED_EXTS.join('|')})$`, 'i');
  return names
    .filter((n) => !n.startsWith('.') && re.test(n))
    .map((name) => ({ name, stem: re.exec(name)[1] }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** --only: exact trimmed filename or the original stem (case-insensitive). */
export function matchesOnly(entry, only) {
  if (!only) return true;
  const o = only.toLowerCase();
  return entry.name.toLowerCase() === o || entry.stem.toLowerCase() === o;
}

/** Why a trim.json cannot feed the restorer, or null when it can. */
export function trimJsonProblem(trimJson, trimmedName) {
  if (!trimJson || !trimJson.output) return 'trim.json has no rendered output (ALL_SILENT / NO_TRIM)';
  if (trimJson.output.name !== trimmedName) return `trim.json output is ${trimJson.output.name}, not ${trimmedName}`;
  if (!/^[0-9a-f]{64}$/.test(trimJson.output.sha256 || '')) return 'trim.json output has no sha256';
  if (!Number.isInteger(trimJson.output.samples) || trimJson.output.samples <= 0) return 'trim.json output has no sample count';
  return null;
}

// ---------- restore.json + report ----------

/** Build the restore.json contract (the publisher depends on these field names). */
export function buildRestoreJson({ plan, diag, source, output, diagVersion = null, createdAt = new Date().toISOString() }) {
  return {
    restoreVersion: RESTORE_VERSION,
    diagVersion,
    chainHash: plan.chainHash,
    chain: plan.chain,
    chainLabel: plan.chainLabel,
    steps: plan.steps,
    diagSummary: {
      integratedLufs: diag.loudness.integratedLufs,
      truePeakDbtp: diag.loudness.truePeakDbtp,
      balanceDb: diag.channels.whole.balanceDb,
      humHz: diag.hum.base ? diag.hum.f0 : null,
      rolloffHz: diag.bandwidth.rolloffHz,
      nfUsedDb: plan.nfUsedDb,
    },
    source: {
      trimmedName: source.trimmedName,
      trimmedSha256: source.trimmedSha256,
      trimJsonName: source.trimJsonName,
      originalName: source.originalName,
    },
    output: {
      name: output.name,
      sha256: output.sha256,
      samples: output.samples,
      sampleRate: output.sampleRate,
      channels: output.channels,
      durationS: output.durationS,
      peakDbfs: output.peakDbfs,
    },
    createdAt,
  };
}

/** Markdown overview of all restore.json reports. */
export function buildRestoreReportMd(reports) {
  const rows = [...reports].sort((a, b) => (a.source.trimmedName < b.source.trimmedName ? -1 : 1));
  const f = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : 'n/a');
  const lines = [
    '# Mixtape restore report',
    '',
    `${rows.length} tape(s). Trimmed masters and originals are never modified; restored copies live beside this file.`,
    '',
    '| Tape | Duration | Chain | Hum | Balance dB | Azimuth | Peak dBFS | Level LUFS |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const hum = r.steps.hum.length ? `${r.steps.hum.length} line(s)` : 'none';
    lines.push(`| ${r.output.name.replace(/\|/g, '\\|')} | ${fmtTime(r.output.durationS).slice(0, 8)} | ${r.chainLabel} (${r.chainHash}) | ${hum} | ${r.steps.balanceDb === null ? '-' : f(r.steps.balanceDb, 2)} | ${r.steps.azimuth === null ? '-' : f(r.steps.azimuth, 2)} | ${f(r.output.peakDbfs)} | ${f(r.diagSummary.integratedLufs)} |`);
  }
  return lines.join('\n') + '\n';
}

