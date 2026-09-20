import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeLoopSessionRecipe, captureLoopSessionRecipe, LOOP_SESSION_SCHEMA_VERSION, REPAIR_STRATEGY_VALUES,
} from '../loop-session.js';

// ── sanitizeLoopSessionRecipe: hopeless input ───────────────────────────────

test('sanitizeLoopSessionRecipe: rejects non-object input as null', () => {
  assert.equal(sanitizeLoopSessionRecipe(null), null);
  assert.equal(sanitizeLoopSessionRecipe(undefined), null);
  assert.equal(sanitizeLoopSessionRecipe('garbage'), null);
  assert.equal(sanitizeLoopSessionRecipe(42), null);
  assert.equal(sanitizeLoopSessionRecipe(true), null);
  assert.equal(sanitizeLoopSessionRecipe([1, 2, 3]), null);
});

// ── sanitizeLoopSessionRecipe: valid input passes through clamped ──────────

test('sanitizeLoopSessionRecipe: a fully valid recipe passes through with the right shape', () => {
  const out = sanitizeLoopSessionRecipe({
    enginePath: 'tracks/song.wav',
    sourceName: 'song.wav',
    bpm: 128.5,
    barsPerLoop: 8,
    offsetSamples: 4410,
    meter: 4,
    phaseOverride: 2,
    overlays: { beats: true, downbeats: false, phaseCandidates: true, boundaries: false, transientRisk: true, clickRisk: false },
    zoomFactor: 4,
    repairStrategy: 'zero_cross_snap',
    repeatCount: 8,
    verdictSummary: { total: 10, pass: 8, warn: 1, fail: 1 },
  });
  assert.deepEqual(out, {
    schemaVersion: LOOP_SESSION_SCHEMA_VERSION,
    enginePath: 'tracks/song.wav',
    sourceName: 'song.wav',
    bpm: 128.5,
    barsPerLoop: 8,
    offsetSamples: 4410,
    meter: 4,
    phaseOverride: 2,
    overlays: { beats: true, downbeats: false, phaseCandidates: true, boundaries: false, transientRisk: true, clickRisk: false },
    zoomFactor: 4,
    repairStrategy: 'zero_cross_snap',
    repeatCount: 8,
    verdictSummary: { total: 10, pass: 8, warn: 1, fail: 1 },
  });
});

test('sanitizeLoopSessionRecipe: empty object resolves to every safe default', () => {
  const out = sanitizeLoopSessionRecipe({});
  assert.equal(out.schemaVersion, LOOP_SESSION_SCHEMA_VERSION);
  assert.equal(out.enginePath, null);
  assert.equal(out.sourceName, null);
  assert.equal(out.bpm, 120); // clampBpm's own non-finite fallback
  assert.equal(out.barsPerLoop, 4);
  assert.equal(out.offsetSamples, 0);
  assert.equal(out.meter, 4);
  assert.equal(out.phaseOverride, null);
  assert.deepEqual(out.overlays, {
    beats: false, downbeats: false, phaseCandidates: false, boundaries: false, transientRisk: false, clickRisk: false,
  });
  assert.equal(out.zoomFactor, 1); // ZOOM_MIN
  assert.equal(out.repairStrategy, 'equal_power_crossfade');
  assert.equal(out.repeatCount, 4);
  assert.equal('verdictSummary' in out, false); // optional, omitted when absent
});

// ── sanitizeLoopSessionRecipe: clamps out-of-range fields ───────────────────

test('sanitizeLoopSessionRecipe: clamps bpm/zoomFactor to their bounds', () => {
  assert.equal(sanitizeLoopSessionRecipe({ bpm: 9999 }).bpm, 300);
  assert.equal(sanitizeLoopSessionRecipe({ bpm: -50 }).bpm, 30);
  assert.equal(sanitizeLoopSessionRecipe({ bpm: 'nope' }).bpm, 120);
  assert.equal(sanitizeLoopSessionRecipe({ zoomFactor: 999 }).zoomFactor, 64);
  assert.equal(sanitizeLoopSessionRecipe({ zoomFactor: 0 }).zoomFactor, 1);
  assert.equal(sanitizeLoopSessionRecipe({ zoomFactor: 'x' }).zoomFactor, 1);
});

test('sanitizeLoopSessionRecipe: clamps integer fields into their ranges and rounds fractional input', () => {
  assert.equal(sanitizeLoopSessionRecipe({ barsPerLoop: 999 }).barsPerLoop, 64);
  assert.equal(sanitizeLoopSessionRecipe({ barsPerLoop: 0 }).barsPerLoop, 1);
  assert.equal(sanitizeLoopSessionRecipe({ barsPerLoop: 3.6 }).barsPerLoop, 4);
  assert.equal(sanitizeLoopSessionRecipe({ meter: 1 }).meter, 2);
  assert.equal(sanitizeLoopSessionRecipe({ meter: 99 }).meter, 12);
  assert.equal(sanitizeLoopSessionRecipe({ repeatCount: 0 }).repeatCount, 1);
  assert.equal(sanitizeLoopSessionRecipe({ repeatCount: 999 }).repeatCount, 16);
});

test('sanitizeLoopSessionRecipe: phaseOverride is int-or-null, never NaN/negative', () => {
  assert.equal(sanitizeLoopSessionRecipe({ phaseOverride: null }).phaseOverride, null);
  assert.equal(sanitizeLoopSessionRecipe({}).phaseOverride, null);
  assert.equal(sanitizeLoopSessionRecipe({ phaseOverride: 7 }).phaseOverride, 7);
  assert.equal(sanitizeLoopSessionRecipe({ phaseOverride: -5 }).phaseOverride, 0);
  assert.equal(sanitizeLoopSessionRecipe({ phaseOverride: 'nope' }).phaseOverride, null);
});

test('sanitizeLoopSessionRecipe: repairStrategy falls back to the default off-list, accepts every real value', () => {
  assert.equal(sanitizeLoopSessionRecipe({ repairStrategy: 'not-a-real-strategy' }).repairStrategy, 'equal_power_crossfade');
  REPAIR_STRATEGY_VALUES.forEach((value) => {
    assert.equal(sanitizeLoopSessionRecipe({ repairStrategy: value }).repairStrategy, value);
  });
});

// ── sanitizeLoopSessionRecipe: strips unknown keys and coerces overlays ────

test('sanitizeLoopSessionRecipe: strips every unknown top-level key', () => {
  const out = sanitizeLoopSessionRecipe({ bpm: 100, __proto__: { polluted: true }, evilScript: '<script>', extra: { nested: 1 } });
  assert.equal(out.evilScript, undefined);
  assert.equal(out.extra, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'polluted'), false);
});

test('sanitizeLoopSessionRecipe: overlays coerces non-boolean values to false and ignores unknown overlay keys', () => {
  const out = sanitizeLoopSessionRecipe({ overlays: { beats: 'yes', downbeats: 1, boundaries: true, bogusOverlay: true } });
  assert.deepEqual(out.overlays, {
    beats: false, downbeats: false, phaseCandidates: false, boundaries: true, transientRisk: false, clickRisk: false,
  });
});

test('sanitizeLoopSessionRecipe: non-object overlays falls back to all-false', () => {
  const out = sanitizeLoopSessionRecipe({ overlays: 'not-an-object' });
  assert.deepEqual(out.overlays, {
    beats: false, downbeats: false, phaseCandidates: false, boundaries: false, transientRisk: false, clickRisk: false,
  });
});

// ── sanitizeLoopSessionRecipe: strings are clamped/trimmed ─────────────────

test('sanitizeLoopSessionRecipe: enginePath/sourceName are trimmed, length-capped, and null for non-strings', () => {
  assert.equal(sanitizeLoopSessionRecipe({ enginePath: '  tracks/song.wav  ' }).enginePath, 'tracks/song.wav');
  assert.equal(sanitizeLoopSessionRecipe({ enginePath: '' }).enginePath, null);
  assert.equal(sanitizeLoopSessionRecipe({ enginePath: 42 }).enginePath, null);
  assert.equal(sanitizeLoopSessionRecipe({ enginePath: 'x'.repeat(600) }).enginePath.length, 512);
  assert.equal(sanitizeLoopSessionRecipe({ sourceName: 'x'.repeat(200) }).sourceName.length, 120);
});

// ── sanitizeLoopSessionRecipe: verdictSummary is optional and clamped ──────

test('sanitizeLoopSessionRecipe: verdictSummary is omitted for garbage/missing, present+clamped when valid', () => {
  assert.equal('verdictSummary' in sanitizeLoopSessionRecipe({ verdictSummary: 'nope' }), false);
  assert.equal('verdictSummary' in sanitizeLoopSessionRecipe({ verdictSummary: null }), false);
  const out = sanitizeLoopSessionRecipe({ verdictSummary: { total: 5, pass: -1, warn: 'x', fail: 2 } });
  assert.deepEqual(out.verdictSummary, { total: 5, pass: 0, warn: 0, fail: 2 });
});

// ── captureLoopSessionRecipe ────────────────────────────────────────────────

test('captureLoopSessionRecipe: assembles a plain-state snapshot without sanitizing', () => {
  const out = captureLoopSessionRecipe({
    enginePath: 'tracks/song.wav',
    sourceName: 'song.wav',
    bpm: 128,
    barsPerLoop: 4,
    offsetSamples: 100,
    meter: 4,
    phaseOverride: null,
    overlays: { beats: true },
    zoomFactor: 2,
    repairStrategy: 'none',
    repeatCount: 4,
    verdictSummary: { total: 1, pass: 1, warn: 0, fail: 0 },
  });
  assert.equal(out.schemaVersion, LOOP_SESSION_SCHEMA_VERSION);
  assert.equal(out.enginePath, 'tracks/song.wav');
  assert.equal(out.bpm, 128);
  assert.deepEqual(out.overlays, { beats: true });
  assert.deepEqual(out.verdictSummary, { total: 1, pass: 1, warn: 0, fail: 0 });
});

test('captureLoopSessionRecipe: defaults enginePath/sourceName/phaseOverride to null and omits verdictSummary when absent', () => {
  const out = captureLoopSessionRecipe({ bpm: 120, barsPerLoop: 4, offsetSamples: 0, meter: 4 });
  assert.equal(out.enginePath, null);
  assert.equal(out.sourceName, null);
  assert.equal(out.phaseOverride, null);
  assert.equal('verdictSummary' in out, false);
});

// ── round-trip ───────────────────────────────────────────────────────────

test('round-trip: sanitizing a captured recipe is idempotent and preserves valid values', () => {
  const captured = captureLoopSessionRecipe({
    enginePath: 'tracks/song.wav',
    sourceName: 'song.wav',
    bpm: 95.25,
    barsPerLoop: 2,
    offsetSamples: -200,
    meter: 3,
    phaseOverride: 4,
    overlays: {
      beats: true, downbeats: true, phaseCandidates: false, boundaries: false, transientRisk: false, clickRisk: true,
    },
    zoomFactor: 8,
    repairStrategy: 'silence_trim',
    repeatCount: 2,
    verdictSummary: { total: 3, pass: 2, warn: 1, fail: 0 },
  });
  const sanitized = sanitizeLoopSessionRecipe(captured);
  assert.deepEqual(sanitized, captured);
  assert.deepEqual(sanitizeLoopSessionRecipe(sanitized), sanitized);
});
