// Loop Studio — pure sample math (same standalone-module tier as
// timeline.js/bg-cover.js: no React, no DOM, no Web Audio import — every
// function here is a plain deterministic transform of its arguments,
// directly testable under node:test).
//
// ── The loopcore invariant ──────────────────────────────────────────────
// Loop boundaries are computed from the ORIGIN, never accumulated:
//
//   boundary(i) = Math.round(offsetSamples + i * samplesPerBar * barsPerLoop)
//
// A naive implementation that instead walked forward summing each loop's
// own (already-rounded) duration would drift: rounding error from loop 1
// carries into loop 2's start, loop 2's into loop 3's, etc., so by loop 100
// the boundary can be several samples off the "true" bar grid. Computing
// every boundary directly from `i` (the absolute bar-multiple index since
// the origin) means each loop's start/end is independently exact — no
// error ever compounds across loops, regardless of how many loops are in
// the track.

/** Exact (unrounded) sample length of one bar at `bpm`/`meter`. */
export function samplesPerBar({ sampleRate, bpm, meter = 4 }) {
  return sampleRate * (60 / bpm) * meter;
}

/** Finite-number BPM clamp to [30, 300]; non-finite input falls back to 120 (a neutral default, not a min/max guess). */
export function clampBpm(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 120;
  return Math.min(300, Math.max(30, n));
}

/**
 * Slices `[0, totalSamples)` into consecutive, non-overlapping loops of
 * `barsPerLoop` bars each, using the origin formula above. Returns
 * `{ loops, warnings }` — never throws, never returns a partial/malformed
 * loop.
 *
 * `loops[k]` = `{ index, startSample, endSample, durationSamples, durationSeconds }`.
 * `index` is 0-based and sequential over the EMITTED array (`loops[k].index
 * === k`) — a separate concern from the internal bar-multiple `i` used to
 * evaluate `boundary(i)`, which starts at whatever `i0` the leading
 * `offsetSamples` region requires (see below).
 *
 * Emission walks `i` upward from the smallest `i0` with `boundary(i0) >= 0`
 * (for the normal `offsetSamples >= 0` case that's `i0 = 0`, since
 * `boundary(0) === Math.round(offsetSamples) >= 0` already; a negative
 * `offsetSamples` — not a case the UI produces today, but not rejected
 * here — skips forward to the first non-negative boundary), emitting a
 * loop for every `i` where `boundary(i + 1) <= totalSamples`. Loop count is
 * unbounded — every complete loop that fits is emitted.
 *
 * `warnings` (string[]) accumulates:
 *   - a leading-region warning when `offsetSamples > 0` actually leaves
 *     samples before the first loop boundary (i.e. `boundary(i0) > 0`);
 *   - a trailing-partial warning when the region after the last emitted
 *     loop's end is >= 5% of one loop's (unrounded) length — that partial
 *     loop is dropped, never emitted as a short final loop.
 *
 * Invalid input (`bpm`/`sampleRate`/`totalSamples` <= 0 or non-finite,
 * `barsPerLoop` < 1 or non-finite) returns `{ loops: [], warnings: ['invalid …'] }`.
 */
export function computeLoops({ totalSamples, sampleRate, bpm, meter = 4, barsPerLoop, offsetSamples = 0 }) {
  const validCore = Number.isFinite(sampleRate) && sampleRate > 0
    && Number.isFinite(bpm) && bpm > 0
    && Number.isFinite(totalSamples) && totalSamples > 0
    && Number.isFinite(barsPerLoop) && barsPerLoop >= 1;
  if (!validCore) {
    return { loops: [], warnings: ['invalid input: sampleRate, bpm, and totalSamples must be positive finite numbers, and barsPerLoop must be a finite number >= 1'] };
  }

  const spb = samplesPerBar({ sampleRate, bpm, meter });
  const loopLen = spb * barsPerLoop;
  if (!Number.isFinite(loopLen) || loopLen <= 0) {
    return { loops: [], warnings: ['invalid input: computed loop length is not a positive finite number'] };
  }

  const offset = Number.isFinite(offsetSamples) ? offsetSamples : 0;
  const boundary = (i) => Math.round(offset + i * loopLen);

  // Smallest i with boundary(i) >= 0 — for offset >= 0 this is always i = 0.
  let i0 = 0;
  if (offset < 0) {
    i0 = Math.ceil(-offset / loopLen);
    while (boundary(i0) < 0) i0 += 1; // rounding-edge guard
  }

  const warnings = [];
  const leadingSamples = boundary(i0);
  if (offset > 0 && leadingSamples > 0) {
    warnings.push(`leading region of ${leadingSamples} sample(s) before the first loop boundary (offsetSamples > 0)`);
  }

  const loops = [];
  let i = i0;
  while (boundary(i + 1) <= totalSamples) {
    const startSample = boundary(i);
    const endSample = boundary(i + 1);
    loops.push({
      index: loops.length,
      startSample,
      endSample,
      durationSamples: endSample - startSample,
      durationSeconds: (endSample - startSample) / sampleRate,
    });
    i += 1;
  }

  const trailingStart = boundary(i);
  const trailingSamples = totalSamples - trailingStart;
  if (trailingSamples > 0 && trailingSamples / loopLen >= 0.05) {
    warnings.push(`trailing partial loop of ${trailingSamples} sample(s) dropped (< one full loop)`);
  }

  return { loops, warnings };
}

/** Index of the loop whose `[startSample, endSample)` contains `sample`, else -1. */
export function loopIndexAtSample(loops, sample) {
  if (!Array.isArray(loops) || !Number.isFinite(sample)) return -1;
  for (let i = 0; i < loops.length; i += 1) {
    const loop = loops[i];
    if (sample >= loop.startSample && sample < loop.endSample) return loop.index;
  }
  return -1;
}

/** `M:SS.mmm` display string (e.g. `0:03.840`). Non-finite/negative input displays as `0:00.000`. */
export function formatSeconds(s) {
  const total = Number.isFinite(s) && s > 0 ? s : 0;
  const wholeMinutes = Math.floor(total / 60);
  const remainder = total - wholeMinutes * 60;
  let seconds = Math.floor(remainder);
  let millis = Math.round((remainder - seconds) * 1000);
  let minutes = wholeMinutes;

  if (millis >= 1000) { millis -= 1000; seconds += 1; }
  if (seconds >= 60) { seconds -= 60; minutes += 1; }

  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Milliseconds to wait before a newly requested loop should start, so it lands
 * on the downbeat of the next `bars`-bar phrase of the grid that opened at
 * `clockStartMs`.
 *
 * Pure: the caller supplies its own clock reading, so this is testable without
 * timers or an AudioContext. Returns 0 when there is no grid to wait for (no
 * clock yet, or a bpm/meter/bars that can't describe a phrase) — the caller
 * then starts immediately, which is the right behaviour for "nothing is
 * playing yet".
 */
export function nextPhraseWaitMs({ nowMs, clockStartMs, bpm, meter = 4, bars = 4 }) {
  const valid = Number.isFinite(nowMs) && Number.isFinite(clockStartMs)
    && Number.isFinite(bpm) && bpm > 0
    && Number.isFinite(meter) && meter > 0
    && Number.isFinite(bars) && bars > 0;
  if (!valid) return 0;
  const phraseMs = (60000 / bpm) * meter * bars;
  if (!Number.isFinite(phraseMs) || phraseMs <= 0) return 0;
  const elapsed = nowMs - clockStartMs;
  if (elapsed < 0) return 0;
  const into = elapsed % phraseMs;
  // Exactly on a boundary: go now, don't wait a whole phrase.
  return into === 0 ? 0 : phraseMs - into;
}
