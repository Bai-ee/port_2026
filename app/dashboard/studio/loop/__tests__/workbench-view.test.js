import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_MIN, ZOOM_MAX, clampZoom, stepZoomButton, stepZoomWheel, zoomLabel,
  VERDICT_FILL, VERDICT_INK, loopVerdict,
  PHASE_CANDIDATE_COLORS, phaseCandidateColor,
  pickLabelStride,
  formatTransportTime,
  buildPhaseOptions,
  okLine, errorLine, staleLine,
  regionMembership,
} from '../workbench-view.js';

// ── zoom ─────────────────────────────────────────────────────────────────

test('clampZoom: clamps into [ZOOM_MIN, ZOOM_MAX]; non-finite falls back to ZOOM_MIN', () => {
  assert.equal(clampZoom(0.2), ZOOM_MIN);
  assert.equal(clampZoom(999), ZOOM_MAX);
  assert.equal(clampZoom(8), 8);
  assert.equal(clampZoom(NaN), ZOOM_MIN);
  assert.equal(clampZoom(undefined), ZOOM_MIN);
});

test('stepZoomButton: multiplies/divides by 1.6x and clamps at the bounds', () => {
  assert.equal(stepZoomButton(1, +1), 1.6);
  assert.equal(stepZoomButton(1.6, -1), 1);
  assert.equal(stepZoomButton(1, -1), ZOOM_MIN); // can't go below fit
  assert.equal(stepZoomButton(ZOOM_MAX, +1), ZOOM_MAX); // can't exceed max
});

test('stepZoomWheel: ctrl/cmd+wheel steps by 1.12x, negative deltaY (wheel-up) zooms in', () => {
  assert.equal(stepZoomWheel(1, -1), 1.12);
  assert.ok(Math.abs(stepZoomWheel(1.12, 1) - 1) < 1e-9);
});

test('zoomLabel: "fit" at ZOOM_MIN, "{n}x" otherwise', () => {
  assert.equal(zoomLabel(1), 'fit');
  assert.equal(zoomLabel(0.5), 'fit'); // clamped
  assert.equal(zoomLabel(4), '4x');
  assert.equal(zoomLabel(1.6), '1.6x');
  assert.equal(zoomLabel(64), '64x');
});

// ── verdict colors ───────────────────────────────────────────────────────

test('loopVerdict: prefers the report verdict; falls back to unknown/incomplete by completeness', () => {
  assert.equal(loopVerdict({ complete: true, reportVerdict: 'warn' }), 'warn');
  assert.equal(loopVerdict({ complete: true, reportVerdict: null }), 'unknown');
  assert.equal(loopVerdict({ complete: false, reportVerdict: null }), 'incomplete');
  assert.equal(loopVerdict({ complete: false }), 'incomplete');
});

test('VERDICT_FILL/VERDICT_INK: every verdict key present', () => {
  for (const k of ['pass', 'warn', 'fail', 'unknown', 'incomplete']) {
    assert.ok(VERDICT_FILL[k], `missing fill for ${k}`);
    assert.ok(VERDICT_INK[k], `missing ink for ${k}`);
  }
});

// ── phase-candidate colors ────────────────────────────────────────────────

test('phaseCandidateColor: cycles the 4-color palette by phase % 4, handles negatives', () => {
  assert.equal(phaseCandidateColor(0), PHASE_CANDIDATE_COLORS[0]);
  assert.equal(phaseCandidateColor(1), PHASE_CANDIDATE_COLORS[1]);
  assert.equal(phaseCandidateColor(4), PHASE_CANDIDATE_COLORS[0]);
  assert.equal(phaseCandidateColor(-1), PHASE_CANDIDATE_COLORS[3]);
  assert.equal(phaseCandidateColor(NaN), PHASE_CANDIDATE_COLORS[0]);
});

// ── label stride ───────────────────────────────────────────────────────

test('pickLabelStride: first stride whose spacing clears MIN_LABEL_PX', () => {
  assert.equal(pickLabelStride(100), 1); // plenty of room already
  assert.equal(pickLabelStride(60), 1);
  assert.equal(pickLabelStride(30), 2); // 30*2=60 >= 56
  assert.equal(pickLabelStride(10), 8); // 10*8=80 >= 56, 10*4=40 too small
  assert.equal(pickLabelStride(0.5), 64); // falls through to the largest stride
});

// ── transport time ───────────────────────────────────────────────────────

test('formatTransportTime: m:ss.ss (2dp centiseconds)', () => {
  assert.equal(formatTransportTime(0), '0:00.00');
  assert.equal(formatTransportTime(3.841), '0:03.84');
  assert.equal(formatTransportTime(65.5), '1:05.50');
  assert.equal(formatTransportTime(-4), '0:00.00');
  assert.equal(formatTransportTime(NaN), '0:00.00');
});

test('formatTransportTime: centisecond rounding carries into seconds/minutes', () => {
  assert.equal(formatTransportTime(59.999), '1:00.00');
  assert.equal(formatTransportTime(119.996), '2:00.00');
});

// ── grid phase options ───────────────────────────────────────────────────

test('buildPhaseOptions: leading auto entry + one per candidate', () => {
  const opts = buildPhaseOptions({
    downbeatSource: 'beat_this',
    selectedPhase: 2,
    candidates: [
      { phase: 0, score: 0.9123, reason: 'onset strength' },
      { phase: 2, score: 0.5, reason: 'fallback' },
    ],
  });
  assert.equal(opts.length, 3);
  assert.equal(opts[0].value, null);
  assert.match(opts[0].label, /auto — beat_this, phase 2/);
  assert.equal(opts[1].value, 0);
  assert.match(opts[1].label, /phase 0 · score 0.912 · onset strength/);
  assert.equal(opts[2].value, 2);
});

test('buildPhaseOptions: degrades gracefully with no candidates/unknown source', () => {
  const opts = buildPhaseOptions({});
  assert.equal(opts.length, 1);
  assert.equal(opts[0].value, null);
});

// ── status line helpers ───────────────────────────────────────────────────

test('status line helpers: fixed tone prefixes', () => {
  assert.equal(okLine('loops written'), '[OK] loops written');
  assert.equal(errorLine('slice failed'), '[ERROR] slice failed');
  assert.equal(staleLine('grid moved'), '[STALE] grid moved');
});

// ── region membership ─────────────────────────────────────────────────────

test('regionMembership: no region bounds -> always inside', () => {
  assert.equal(regionMembership(0, 4, null, null), 'inside');
  assert.equal(regionMembership(100, 104, undefined, undefined), 'inside');
});

test('regionMembership: before/after/inside/spanning classification', () => {
  // region is [10, 90)
  assert.equal(regionMembership(0, 5, 10, 90), 'before');
  assert.equal(regionMembership(95, 100, 10, 90), 'after');
  assert.equal(regionMembership(20, 30, 10, 90), 'inside');
  assert.equal(regionMembership(5, 15, 10, 90), 'spanning'); // straddles region start
  assert.equal(regionMembership(85, 95, 10, 90), 'spanning'); // straddles region end
});
