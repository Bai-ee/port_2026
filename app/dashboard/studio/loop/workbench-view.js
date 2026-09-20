// Loop Studio — pure view-logic helpers for the wavesurfer-backed waveform
// strip + rail (zoom math, verdict/phase color maps, bar-ruler label
// stride, transport time formatting, grid phase-option building, status-
// line tone/text). Same standalone-module tier as loop-engine.js: no React,
// no DOM, no wavesurfer import — every export is a plain function of
// primitive/plain-object arguments, directly testable under node:test.
// Ported 1:1 from the slice_track workbench's own constants/formulas
// (see the port-spec inventory this branch was built against).

// ── Zoom ─────────────────────────────────────────────────────────────────
// `factor` is a multiple of "fit" (the whole track visible, factor 1) —
// NOT wavesurfer's own `minPxPerSec`; the caller multiplies factor by the
// fit-px-per-second it measured for the current container width to get the
// `minPxPerSec` it actually passes to wavesurfer.

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 64;
export const ZOOM_BUTTON_FACTOR = 1.6;
export const ZOOM_WHEEL_FACTOR = 1.12;

/** Clamp a zoom factor into `[ZOOM_MIN, ZOOM_MAX]`; non-finite input falls back to ZOOM_MIN. */
export function clampZoom(factor) {
  const n = Number(factor);
  if (!Number.isFinite(n)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

/** One ± zoom-button step (±1.6x per the port spec), clamped. `direction` > 0 zooms in. */
export function stepZoomButton(current, direction) {
  const base = clampZoom(current);
  return clampZoom(direction >= 0 ? base * ZOOM_BUTTON_FACTOR : base / ZOOM_BUTTON_FACTOR);
}

/** One ctrl/cmd+wheel zoom step (1.12x per tick per the port spec). `deltaY` < 0 zooms in (wheel-up). */
export function stepZoomWheel(current, deltaY) {
  const base = clampZoom(current);
  return clampZoom(deltaY < 0 ? base * ZOOM_WHEEL_FACTOR : base / ZOOM_WHEEL_FACTOR);
}

/** Readout text: "fit" at ZOOM_MIN, else "{n}x" (whole numbers bare, else 1dp). */
export function zoomLabel(factor) {
  const f = clampZoom(factor);
  if (f <= ZOOM_MIN + 1e-9) return 'fit';
  const rounded = Math.round(f * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}x`;
}

// ── Verdict colors ──────────────────────────────────────────────────────

export const VERDICT_FILL = {
  pass: 'rgba(79,180,119,0.16)',
  warn: 'rgba(166,117,43,0.16)',
  fail: 'rgba(252,0,35,0.16)',
  unknown: 'rgba(52,129,240,0.14)',
  incomplete: 'rgba(252,0,35,0.14)',
};

export const VERDICT_INK = {
  pass: '#4fb477',
  warn: '#a6752b',
  fail: '#fc0023',
  unknown: '#3481f0',
  incomplete: '#fc0023',
};

/** verdict = the report's verdict if verified, else "unknown" (complete) / "incomplete" (partial tail). */
export function loopVerdict({ complete, reportVerdict } = {}) {
  if (reportVerdict) return reportVerdict;
  return complete ? 'unknown' : 'incomplete';
}

// ── Downbeat-phase-candidate colors ─────────────────────────────────────

export const PHASE_CANDIDATE_COLORS = ['#3481f0', '#37aec4', '#a6752b', '#fc0023'];

/** Color for a non-winning phase candidate marker, keyed by `phase % 4` (handles negative phase defensively). */
export function phaseCandidateColor(phase) {
  const n = Number(phase);
  const idx = Number.isFinite(n) ? (((Math.trunc(n) % 4) + 4) % 4) : 0;
  return PHASE_CANDIDATE_COLORS[idx];
}

// ── Bar-ruler label stride ──────────────────────────────────────────────

export const LABEL_STRIDE_CANDIDATES = [1, 2, 4, 8, 16, 32, 64];
export const MIN_LABEL_PX = 56;

/** First stride (bars between numbered ticks) whose pixel spacing is >= MIN_LABEL_PX at the given px-per-bar. */
export function pickLabelStride(pxPerBar) {
  const px = Number.isFinite(pxPerBar) && pxPerBar > 0 ? pxPerBar : 0;
  for (let i = 0; i < LABEL_STRIDE_CANDIDATES.length; i += 1) {
    const stride = LABEL_STRIDE_CANDIDATES[i];
    if (px * stride >= MIN_LABEL_PX) return stride;
  }
  return LABEL_STRIDE_CANDIDATES[LABEL_STRIDE_CANDIDATES.length - 1];
}

// ── Transport time readout ──────────────────────────────────────────────

/** "m:ss.ss" (2dp centiseconds) — the transport dock's time readout, distinct from loop-engine's 3dp formatSeconds. */
export function formatTransportTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(total / 60);
  const remainder = total - minutes * 60;
  let secs = Math.floor(remainder);
  let centis = Math.round((remainder - secs) * 100);
  let mins = minutes;
  if (centis >= 100) { centis -= 100; secs += 1; }
  if (secs >= 60) { secs -= 60; mins += 1; }
  return `${mins}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

// ── Grid phase-candidate select options ─────────────────────────────────

/**
 * Builds the Grid card's phase-select option list: an "auto" entry (labeled
 * with the current downbeat source + selected phase) followed by one entry
 * per `downbeat_phase_candidates` (each `{ phase, score, reason }` from the
 * engine). `value: null` for "auto"; `value: candidate.phase` for the rest —
 * mirrors the workbench's own phase_override semantics (null = auto).
 */
export function buildPhaseOptions({ downbeatSource, selectedPhase, candidates } = {}) {
  const options = [{
    value: null,
    label: `auto — ${downbeatSource || 'unknown'}, phase ${Number.isFinite(selectedPhase) ? selectedPhase : '?'}`,
  }];
  (Array.isArray(candidates) ? candidates : []).forEach((c) => {
    options.push({
      value: c.phase,
      label: `phase ${c.phase} · score ${Number.isFinite(c.score) ? c.score.toFixed(3) : c.score} · ${c.reason || ''}`,
    });
  });
  return options;
}

// ── Status line tone/text ───────────────────────────────────────────────

export const STATUS_TONE_COLOR = {
  ok: '#15803d',
  error: '#b91c1c',
  stale: '#b45309',
  busy: '#3481f0',
  idle: '#8a8a8a',
};

export function okLine(text) { return `[OK] ${text}`; }
export function errorLine(text) { return `[ERROR] ${text}`; }
export function staleLine(reason) { return `[STALE] ${reason}`; }

// ── Musical-region bounds (for dimming out-of-region waveform ends) ─────

/**
 * Classifies a loop clip's [startSeconds, endSeconds) span against the
 * engine's detected musical region [regionStartSeconds, regionEndSeconds)
 * (either bound may be `null`/`undefined` when the engine found none —
 * always "inside" in that case). Returns `'inside' | 'before' | 'after' |
 * 'spanning'` — 'spanning' only when the clip straddles a region edge
 * (rare given bar-aligned cuts, but not assumed away).
 */
export function regionMembership(startSeconds, endSeconds, regionStartSeconds, regionEndSeconds) {
  const hasStart = Number.isFinite(regionStartSeconds);
  const hasEnd = Number.isFinite(regionEndSeconds);
  const beforeStart = hasStart && endSeconds <= regionStartSeconds;
  const afterEnd = hasEnd && startSeconds >= regionEndSeconds;
  if (beforeStart) return 'before';
  if (afterEnd) return 'after';
  const straddleStart = hasStart && startSeconds < regionStartSeconds && endSeconds > regionStartSeconds;
  const straddleEnd = hasEnd && startSeconds < regionEndSeconds && endSeconds > regionEndSeconds;
  if (straddleStart || straddleEnd) return 'spanning';
  return 'inside';
}
