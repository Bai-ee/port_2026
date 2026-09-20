// Run directly — this path is NOT covered by `npm test`'s glob (see
// looper-flow.js's header comment):
//   node --test components/looper/__tests__/looper-flow.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TRACK_BYTES,
  formatMb,
  validateTrackFile,
  buildResultLines,
  resolveSourcePath,
  formatBpm,
} from '../looper-flow.js';

// ── formatMb ─────────────────────────────────────────────────────────────

test('formatMb: converts bytes to a one-decimal MB string', () => {
  assert.equal(formatMb(12_582_912), '12.0'); // 12 MB exactly
  assert.equal(formatMb(1_500_000), '1.4');
});

test('formatMb: non-numeric input degrades to 0.0, never throws', () => {
  assert.equal(formatMb(undefined), '0.0');
  assert.equal(formatMb(null), '0.0');
});

// ── validateTrackFile ────────────────────────────────────────────────────

test('validateTrackFile: rejects a missing file', () => {
  const result = validateTrackFile(null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no file selected/i);
});

test('validateTrackFile: rejects a file over the 100MB cap', () => {
  const file = { name: 'huge.wav', size: MAX_TRACK_BYTES + 1, type: 'audio/wav' };
  const result = validateTrackFile(file);
  assert.equal(result.ok, false);
  assert.match(result.reason, /too large/i);
  assert.match(result.reason, /max 100 MB/);
});

test('validateTrackFile: accepts a known extension even with no MIME type (common for drag-drop)', () => {
  const file = { name: 'track.aiff', size: 1024, type: '' };
  assert.deepEqual(validateTrackFile(file), { ok: true });
});

test('validateTrackFile: accepts an audio/* MIME type even with an unrecognized extension', () => {
  const file = { name: 'track.weird', size: 1024, type: 'audio/x-custom' };
  assert.deepEqual(validateTrackFile(file), { ok: true });
});

test('validateTrackFile: rejects a non-audio file with no matching extension', () => {
  const file = { name: 'notes.txt', size: 1024, type: 'text/plain' };
  const result = validateTrackFile(file);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported file type/i);
});

test('validateTrackFile: extension check is case-insensitive', () => {
  const file = { name: 'TRACK.WAV', size: 1024, type: '' };
  assert.deepEqual(validateTrackFile(file), { ok: true });
});

// ── buildResultLines ─────────────────────────────────────────────────────

test('buildResultLines: empty/absent analysis produces no lines', () => {
  assert.deepEqual(buildResultLines(null), []);
  assert.deepEqual(buildResultLines({}), []);
});

test('buildResultLines: reports downbeat count, singular vs plural', () => {
  assert.deepEqual(
    buildResultLines({ downbeat_times_seconds: [1] }),
    ['1 downbeat'],
  );
  assert.deepEqual(
    buildResultLines({ downbeat_times_seconds: [1, 2, 3] }),
    ['3 downbeats'],
  );
});

test('buildResultLines: includes classification when present', () => {
  const lines = buildResultLines({ classification: 'likely_constant_needs_manual_downbeat_correction' });
  assert.deepEqual(lines, ['classification: likely_constant_needs_manual_downbeat_correction']);
});

test('buildResultLines: omits region when it spans the whole track', () => {
  const analysis = {
    region_start_seconds: 0,
    region_end_seconds: 64,
    duration_seconds: 64,
  };
  assert.deepEqual(buildResultLines(analysis), []);
});

test('buildResultLines: includes region when it does NOT span the whole track', () => {
  const analysis = {
    region_start_seconds: 4.2,
    region_end_seconds: 60,
    duration_seconds: 64,
  };
  assert.deepEqual(buildResultLines(analysis), ['region 4.20s – 60.00s']);
});

test('buildResultLines: includes every warning verbatim, prefixed', () => {
  const analysis = { warnings: ['low confidence beat grid', 'clipped audio detected'] };
  assert.deepEqual(buildResultLines(analysis), [
    'warning: low confidence beat grid',
    'warning: clipped audio detected',
  ]);
});

test('buildResultLines: combines every field in order (downbeats, classification, region, warnings)', () => {
  const analysis = {
    downbeat_times_seconds: [1, 2],
    classification: 'confident',
    region_start_seconds: 1,
    region_end_seconds: 10,
    duration_seconds: 64,
    warnings: ['w1'],
  };
  assert.deepEqual(buildResultLines(analysis), [
    '2 downbeats',
    'classification: confident',
    'region 1.00s – 10.00s',
    'warning: w1',
  ]);
});

// ── resolveSourcePath ────────────────────────────────────────────────────

test('resolveSourcePath: prefers top-level source_path', () => {
  const analysis = { source_path: '/a/b.wav', uploaded: { path: '/a/other.wav' } };
  assert.equal(resolveSourcePath(analysis), '/a/b.wav');
});

test('resolveSourcePath: falls back to uploaded.path when source_path is absent', () => {
  const analysis = { uploaded: { path: '/a/other.wav' } };
  assert.equal(resolveSourcePath(analysis), '/a/other.wav');
});

test('resolveSourcePath: returns null when neither is present', () => {
  assert.equal(resolveSourcePath({}), null);
  assert.equal(resolveSourcePath(null), null);
});

// ── formatBpm ────────────────────────────────────────────────────────────

test('formatBpm: formats a finite BPM to two decimals', () => {
  assert.equal(formatBpm(120), '120.00');
  assert.equal(formatBpm(97.5), '97.50');
});

test('formatBpm: degrades to an em dash for a missing/non-finite BPM', () => {
  assert.equal(formatBpm(undefined), '—');
  assert.equal(formatBpm(NaN), '—');
});
