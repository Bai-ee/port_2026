// Pure helpers for scripts/mixtapes/trim-mixtapes.mjs (no filesystem or process I/O).
import { createHash } from 'node:crypto';
import path from 'node:path';

export const AUDIO_EXTS = ['wav', 'flac', 'aif', 'aiff', 'mp3', 'm4a', 'ogg', 'opus'];
export const NAS_HOST = '192.168.1.6';
export const ANALYSIS_RATE = 16000;
export const WINDOW_MS = 100;
export const WINDOW_FRAMES = (ANALYSIS_RATE * WINDOW_MS) / 1000; // 1600
export const CLIP_LEVEL = 0.999;
export const CLIPPING_MIN_SAMPLES = 100;

const LOSSLESS_CODECS = new Set(['flac', 'alac', 'wavpack', 'ape', 'tta']);

// ---------- listing ----------

/** True when a directory entry name is an audio file we should process. */
export function isProcessableAudioName(name) {
  if (!name || name === '.DS_Store' || name.startsWith('._')) return false;
  const lower = name.toLowerCase();
  if (lower.endsWith('.noise.wav')) return false;
  if (/\.trimmed\.[^.]+$/.test(lower)) return false; // our own outputs
  const ext = path.extname(name).slice(1).toLowerCase();
  return AUDIO_EXTS.includes(ext);
}

/** Filter + sort names (directly in src). `only` is a case-insensitive substring. */
export function filterAudioNames(names, only) {
  const needle = only ? only.toLowerCase() : null;
  return names
    .filter(isProcessableAudioName)
    .filter((n) => !needle || n.toLowerCase().includes(needle))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function stemOf(name) {
  return path.basename(name, path.extname(name));
}

/**
 * Group names by lowercased stem. Stems shared by more than one file (a.wav + a.mp3)
 * would clobber each other's outputs, so they are returned as collisions, not processed.
 * @returns {{ ok: string[], collisions: string[][] }}
 */
export function partitionStemCollisions(names) {
  const groups = new Map();
  for (const n of names) {
    const k = stemOf(n).toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  const ok = [];
  const collisions = [];
  for (const g of groups.values()) (g.length > 1 ? collisions.push(g) : ok.push(g[0]));
  return { ok: ok.sort(), collisions };
}

/** Tapes with these flags get a .trim.json but no rendered output. */
export const NO_RENDER_FLAGS = ['ALL_SILENT', 'NO_TRIM', 'NO_SUSTAINED_RUN'];
export function shouldSkipRender(flags) {
  return NO_RENDER_FLAGS.some((f) => (flags || []).includes(f));
}

// ---------- mount safety ----------

/** Parse macOS `mount` output into [{device, mountpoint, fstype}]. */
export function parseMountOutput(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^(.*?) on (.*) \((\w+)(?:[,)].*)?$/.exec(line.trim());
    if (m) out.push({ device: m[1], mountpoint: m[2], fstype: m[3] });
  }
  return out;
}

/** Mount entry with the longest mountpoint that is a path-prefix of `target`. */
export function findMountForPath(mounts, target) {
  let best = null;
  for (const m of mounts) {
    const mp = m.mountpoint.replace(/\/+$/, '') || '/';
    const hit = mp === '/' || target === mp || target.startsWith(mp + '/');
    if (hit && (!best || mp.length > best.mountpoint.length)) best = { ...m, mountpoint: mp };
  }
  return best;
}

/** True only for smbfs mounts served by the NAS host. */
export function isNasSmbMount(mount, host = NAS_HOST) {
  if (!mount || mount.fstype !== 'smbfs') return false;
  const esc = host.replace(/\./g, '\\.');
  return new RegExp(`(?:^|[/@])${esc}(?:[:/]|$)`).test(mount.device);
}

// ---------- hashing ----------

export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function paramsHash(params) {
  return createHash('sha256').update(stableStringify(params)).digest('hex').slice(0, 16);
}

// ---------- time formatting ----------

export function fmtTime(s) {
  const ms = Math.round(Math.max(0, s) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(sec)}.${p(r, 3)}`;
}

// ---------- ffprobe parsing ----------

const FMT_BITS = { u8: 8, u8p: 8, s16: 16, s16p: 16, s32: 32, s32p: 32, flt: 32, fltp: 32, dbl: 64, dblp: 64, s64: 64, s64p: 64 };

/** Normalize ffprobe JSON into the fields we use. */
export function parseProbe(json) {
  const s = (json.streams && json.streams[0]) || {};
  const sampleRate = Number(s.sample_rate);
  const raw = Number(s.bits_per_raw_sample);
  const bps = Number(s.bits_per_sample);
  const bits = raw > 0 ? raw : bps > 0 ? bps : FMT_BITS[s.sample_fmt] || 16;
  const durationS = Number(s.duration) > 0 ? Number(s.duration) : Number(json.format && json.format.duration) || 0;
  let totalSamples = Math.round(durationS * sampleRate);
  const dts = Number(s.duration_ts);
  const tb = /^(\d+)\/(\d+)$/.exec(s.time_base || '');
  if (dts > 0 && tb && Number(tb[2]) > 0) totalSamples = Math.round((dts * Number(tb[1]) / Number(tb[2])) * sampleRate);
  return {
    codec: s.codec_name || '',
    sampleRate,
    channels: Number(s.channels) || 1,
    sampleFmt: s.sample_fmt || '',
    bits,
    durationS: totalSamples && sampleRate ? totalSamples / sampleRate : durationS,
    totalSamples,
  };
}

// ---------- output codec selection ----------

export function isLosslessSource(probe) {
  return probe.codec.startsWith('pcm_') || LOSSLESS_CODECS.has(probe.codec);
}

/**
 * @returns {{ codec:string, ext:string, args:string[], lossless:boolean }}
 * wav -> matching pcm (+ -rf64 auto); aif(f) -> pcm be; flac -> flac same depth;
 * everything else (mp3/m4a/ogg/opus) -> flac s16, or 24-bit when the source is deeper than 16.
 */
export function selectOutputCodec(probe, srcExt) {
  const ext = String(srcExt).replace(/^\./, '').toLowerCase();
  const lossless = isLosslessSource(probe);
  const flacArgs = (bits) =>
    bits > 16
      ? { codec: 'flac', ext: 'flac', args: ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'] }
      : { codec: 'flac', ext: 'flac', args: ['-c:a', 'flac', '-sample_fmt', 's16'] };

  if ((ext === 'wav' || ext === 'aif' || ext === 'aiff') && probe.codec.startsWith('pcm_')) {
    const be = ext !== 'wav';
    let kind; // s16 | s24 | s32 | f32 | f64
    if (/pcm_f64/.test(probe.codec)) kind = 'f64';
    else if (/pcm_f32/.test(probe.codec)) kind = 'f32';
    else if (/pcm_s24/.test(probe.codec)) kind = 's24';
    else if (/pcm_s32/.test(probe.codec)) kind = 's32';
    else kind = 's16'; // s16 and u8 (u8 is widened)
    if (be && (kind === 'f32' || kind === 'f64')) kind = 's24'; // AIFF has no float PCM we rely on
    const codec = `pcm_${kind}${be ? 'be' : 'le'}`;
    return { codec, ext, args: ['-c:a', codec, ...(ext === 'wav' ? ['-rf64', 'auto'] : [])], lossless };
  }
  return { ...flacArgs(probe.bits), lossless };
}

/** PCM codec for the .noise.wav sample, native-ish depth. */
export function noiseCodec(probe) {
  if (/f32|f64|flt|dbl/.test(probe.codec + probe.sampleFmt)) return 'pcm_f32le';
  return probe.bits > 16 ? 'pcm_s24le' : 'pcm_s16le';
}

// ---------- filtergraph ----------

/**
 * Convert keep segments (seconds) to integer sample ranges at the native rate.
 * Segments touching the analysed start/end snap to 0 / totalSamples.
 */
export function keepToSamples(keep, sampleRate, totalSamples, detectDurationS) {
  const out = [];
  for (const k of keep) {
    const S = k.startS <= 1e-9 ? 0 : Math.max(0, Math.min(totalSamples, Math.round(k.startS * sampleRate)));
    const E = k.endS >= detectDurationS - 1e-6 ? totalSamples : Math.max(0, Math.min(totalSamples, Math.round(k.endS * sampleRate)));
    if (E > S) out.push({ S, E });
  }
  return out;
}

export const END_FADE_CURVES = ['tri', 'qsin', 'esin', 'hsin', 'log', 'exp', 'par', 'cub'];

/** Throws on a bad endFadeOutS / endFadeCurve. */
export function validateEndFadeParams({ endFadeOutS, endFadeCurve }) {
  if (typeof endFadeOutS !== 'number' || !Number.isFinite(endFadeOutS) || endFadeOutS < 0) throw new Error('endFadeOutS must be a finite number >= 0');
  if (!END_FADE_CURVES.includes(endFadeCurve)) throw new Error(`endFadeCurve must be one of ${END_FADE_CURVES.join(', ')}`);
}

/** Samples covered by the end fade of the last segment (0 when disabled). */
export function endFadeSamples(segments, sampleRate, endFadeOutS) {
  if (!segments.length || !(endFadeOutS > 0)) return 0;
  const last = segments[segments.length - 1];
  return Math.min(last.E - last.S, Math.round(endFadeOutS * sampleRate));
}

/** Report record, in output time: { seconds, curve, startS }, or null when disabled. */
export function endFadeReport(segments, sampleRate, endFadeOutS, curve) {
  const n = endFadeSamples(segments, sampleRate, endFadeOutS);
  if (!n) return null;
  return { seconds: n / sampleRate, curve, startS: (expectedSamples(segments) - n) / sampleRate };
}

/**
 * One filtergraph over K copies of the same input (-i f -i f ...; avoids asplit
 * buffering whole mixes in RAM). Fades at every cut edge, none at true file start.
 * The LAST segment ends with an end fade (endFade = { seconds, curve }, default none)
 * that replaces the cut fade there, even at the true end of the file; if the segment is
 * shorter than the fade, it fades over the whole segment. Output label: [out].
 */
export function buildFiltergraph(segments, sampleRate, totalSamples, fadeMs = 50, endFade = null) {
  const fade = fadeMs / 1000;
  const labels = [];
  const lastIdx = segments.length - 1;
  const parts = segments.map(({ S, E }, i) => {
    let f = `[${i}:a]atrim=start_sample=${S}:end_sample=${E},asetpts=PTS-STARTPTS`;
    if (S > 0) f += `,afade=t=in:d=${fade}`;
    const len = (E - S) / sampleRate;
    if (i === lastIdx && endFade && endFade.seconds > 0) {
      const d = Math.min(len, endFade.seconds);
      f += `,afade=t=out:st=${(len - d).toFixed(6)}:d=${d}:curve=${endFade.curve}`;
    } else if (E < totalSamples) {
      const st = Math.max(0, len - fade);
      f += `,afade=t=out:st=${st.toFixed(6)}:d=${fade}`;
    }
    labels.push(`[s${i}]`);
    return `${f}[s${i}]`;
  });
  const tail = segments.length === 1 ? `[s0]anull[out]` : `${labels.join('')}concat=n=${segments.length}:v=0:a=1[out]`;
  return [...parts, tail].join(';');
}

export function expectedSamples(segments) {
  return segments.reduce((n, { S, E }) => n + (E - S), 0);
}

// ---------- analysis accumulator ----------

/** Turns an f32le interleaved stream into per-100 ms max-channel dB windows + clip count. */
export class WindowAccumulator {
  constructor(channels) {
    this.channels = channels;
    this.pending = Buffer.alloc(0);
    this.sumsq = new Float64Array(channels);
    this.ch = 0;
    this.frames = 0;
    this.windows = [];
    this.clipped = 0;
  }
  push(chunk) {
    const buf = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const usable = buf.length - (buf.length % 4);
    this.pending = Buffer.from(buf.subarray(usable));
    if (!usable) return;
    const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable));
    for (let i = 0; i < f.length; i++) {
      const x = f[i];
      this.sumsq[this.ch] += x * x;
      if (x >= CLIP_LEVEL || x <= -CLIP_LEVEL) this.clipped++;
      if (++this.ch === this.channels) {
        this.ch = 0;
        if (++this.frames === WINDOW_FRAMES) this._emit(WINDOW_FRAMES);
      }
    }
  }
  _emit(n) {
    let max = 0;
    for (let c = 0; c < this.channels; c++) max = Math.max(max, this.sumsq[c] / n);
    const rms = Math.sqrt(max);
    this.windows.push(rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120);
    this.sumsq.fill(0);
    this.frames = 0;
  }
  /** Flush a trailing partial window if it is at least half a window. */
  finish() {
    if (this.frames >= WINDOW_FRAMES / 2) this._emit(this.frames);
    return { windowsDb: Float32Array.from(this.windows), clipped: this.clipped };
  }
}

// ---------- report ----------

export function buildReportMd(reports) {
  const rows = [...reports].sort((a, b) => (a.source.name < b.source.name ? -1 : 1));
  const hms = (s) => fmtTime(s).slice(0, 8);
  const lines = [
    '# Mixtape trim report',
    '',
    `${rows.length} tape(s). Originals are never modified; trimmed copies live beside this file.`,
    '',
    '| Tape | Duration in -> out | Cuts | Flags |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const out = r.output ? hms(r.output.durationS) : 'not rendered';
    const kinds = {};
    for (const c of r.cuts || []) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    const cuts = (r.cuts || []).length ? Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ') : 'none';
    const flags = (r.flags || []).length ? r.flags.join(', ') : '-';
    lines.push(`| ${r.source.name.replace(/\|/g, '\\|')} | ${hms(r.source.durationS)} -> ${out} | ${cuts} | ${flags} |`);
  }
  return lines.join('\n') + '\n';
}
