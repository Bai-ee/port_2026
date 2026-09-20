import test from 'node:test';
import assert from 'node:assert/strict';
import {
  samplesPerBar, clampBpm, computeLoops, loopIndexAtSample, formatSeconds,
  nextPhraseWaitMs,
} from '../loop-engine.js';

// ── samplesPerBar ────────────────────────────────────────────────────────

test('samplesPerBar: exact (unrounded) float, matches the formula directly', () => {
  assert.equal(samplesPerBar({ sampleRate: 44100, bpm: 120, meter: 4 }), 44100 * (60 / 120) * 4);
  const frac = samplesPerBar({ sampleRate: 44100, bpm: 125.3, meter: 4 });
  assert.ok(!Number.isInteger(frac), 'fractional bpm should produce a fractional samples-per-bar');
});

// ── clampBpm ─────────────────────────────────────────────────────────────

test('clampBpm: clamps into [30, 300] and defaults non-finite to 120', () => {
  assert.equal(clampBpm(10), 30);
  assert.equal(clampBpm(500), 300);
  assert.equal(clampBpm(150), 150);
  assert.equal(clampBpm(NaN), 120);
  assert.equal(clampBpm(undefined), 120);
  assert.equal(clampBpm(Infinity), 120);
  assert.equal(clampBpm('not a number'), 120);
});

// ── computeLoops: origin formula (non-drifting boundaries) ────────────────

test('computeLoops: boundary(i) is computed from the origin, not accumulated — no drift by loop 100', () => {
  const sampleRate = 44100;
  const bpm = 125.3;
  const meter = 4;
  const barsPerLoop = 1;
  const offsetSamples = 0;

  const spb = samplesPerBar({ sampleRate, bpm, meter });
  const loopLen = spb * barsPerLoop;
  // Origin-formula boundary at bar-multiple 101, computed independently of computeLoops.
  const expectedBoundary100Start = Math.round(offsetSamples + 100 * loopLen);
  const expectedBoundary101 = Math.round(offsetSamples + 101 * loopLen);

  const { loops, warnings } = computeLoops({
    totalSamples: expectedBoundary101, sampleRate, bpm, meter, barsPerLoop, offsetSamples,
  });

  assert.equal(loops.length, 101, 'expected exactly 101 complete loops with no trailing partial');
  assert.deepEqual(warnings, []);
  assert.equal(loops[100].index, 100);
  assert.equal(loops[100].startSample, expectedBoundary100Start);
  assert.equal(loops[100].endSample, expectedBoundary101);

  // Naive accumulation (round each loop's own length, then sum) drifts away
  // from the origin formula for a fractional samplesPerBar.
  const naiveAccumulatedStart100 = Math.round(loopLen) * 100;
  assert.notEqual(
    loops[100].startSample,
    naiveAccumulatedStart100,
    'origin-formula boundary should differ from naive per-loop-rounded accumulation',
  );
});

test('computeLoops: every loop start equals its own boundary(i), never the previous loop end + rounded length', () => {
  const sampleRate = 48000;
  const bpm = 91.7;
  const barsPerLoop = 2;
  const spb = samplesPerBar({ sampleRate, bpm, meter: 4 });
  const loopLen = spb * barsPerLoop;
  const totalSamples = Math.round(loopLen * 20);

  const { loops } = computeLoops({ totalSamples, sampleRate, bpm, meter: 4, barsPerLoop, offsetSamples: 0 });
  loops.forEach((loop, i) => {
    assert.equal(loop.startSample, Math.round(i * loopLen));
    assert.equal(loop.endSample, Math.round((i + 1) * loopLen));
    assert.equal(loop.durationSamples, loop.endSample - loop.startSample);
    assert.equal(loop.durationSeconds, loop.durationSamples / sampleRate);
  });
});

// ── computeLoops: trailing partial warning ─────────────────────────────────

test('computeLoops: trailing region >= 5% of a loop length is dropped and warned about', () => {
  const sampleRate = 44100;
  const bpm = 120;
  const barsPerLoop = 1;
  const loopLen = samplesPerBar({ sampleRate, bpm, meter: 4 }) * barsPerLoop; // 88200
  const totalSamples = loopLen * 3 + 5000; // 5000 / 88200 ≈ 5.67% >= 5%

  const { loops, warnings } = computeLoops({ totalSamples, sampleRate, bpm, meter: 4, barsPerLoop });
  assert.equal(loops.length, 3);
  assert.ok(warnings.some((w) => /trailing/i.test(w)), 'expected a trailing-partial warning');
});

test('computeLoops: trailing region < 5% of a loop length is dropped silently (no warning)', () => {
  const sampleRate = 44100;
  const bpm = 120;
  const barsPerLoop = 1;
  const loopLen = samplesPerBar({ sampleRate, bpm, meter: 4 }) * barsPerLoop; // 88200
  const totalSamples = loopLen * 3 + 1000; // 1000 / 88200 ≈ 1.13% < 5%

  const { loops, warnings } = computeLoops({ totalSamples, sampleRate, bpm, meter: 4, barsPerLoop });
  assert.equal(loops.length, 3);
  assert.deepEqual(warnings, []);
});

// ── computeLoops: offset shifting ──────────────────────────────────────────

test('computeLoops: offsetSamples > 0 shifts every boundary and warns about the leading region', () => {
  const sampleRate = 44100;
  const bpm = 120;
  const barsPerLoop = 1;
  const offsetSamples = 20000;
  const loopLen = samplesPerBar({ sampleRate, bpm, meter: 4 }) * barsPerLoop;
  const totalSamples = offsetSamples + loopLen * 2;

  const { loops, warnings } = computeLoops({ totalSamples, sampleRate, bpm, meter: 4, barsPerLoop, offsetSamples });
  assert.equal(loops.length, 2);
  assert.equal(loops[0].startSample, offsetSamples);
  assert.equal(loops[0].endSample, Math.round(offsetSamples + loopLen));
  assert.ok(warnings.some((w) => /leading/i.test(w)), 'expected a leading-region warning');
});

test('computeLoops: offsetSamples = 0 never produces a leading-region warning', () => {
  const sampleRate = 44100;
  const bpm = 120;
  const barsPerLoop = 1;
  const loopLen = samplesPerBar({ sampleRate, bpm, meter: 4 }) * barsPerLoop;
  const { warnings } = computeLoops({ totalSamples: loopLen * 2, sampleRate, bpm, meter: 4, barsPerLoop, offsetSamples: 0 });
  assert.ok(!warnings.some((w) => /leading/i.test(w)));
});

// ── computeLoops: invalid input safety ─────────────────────────────────────

test('computeLoops: invalid input never throws and returns an empty, warned result', () => {
  const base = { totalSamples: 100000, sampleRate: 44100, bpm: 120, meter: 4, barsPerLoop: 1 };

  const cases = [
    { ...base, totalSamples: 0 },
    { ...base, totalSamples: -1 },
    { ...base, sampleRate: 0 },
    { ...base, sampleRate: -44100 },
    { ...base, bpm: 0 },
    { ...base, bpm: -1 },
    { ...base, barsPerLoop: 0 },
    { ...base, barsPerLoop: 0.5 },
    { ...base, barsPerLoop: undefined },
    { ...base, totalSamples: NaN },
    { ...base, bpm: Infinity },
  ];

  cases.forEach((input) => {
    const result = computeLoops(input);
    assert.deepEqual(result.loops, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /invalid/i);
  });
});

test('computeLoops: unbounded loop count — emits every complete loop that fits', () => {
  const sampleRate = 8000;
  const bpm = 240; // fast tempo, short bars, to keep the fixture cheap
  const barsPerLoop = 1;
  const loopLen = samplesPerBar({ sampleRate, bpm, meter: 4 }) * barsPerLoop;
  const totalSamples = Math.round(loopLen * 500);

  const { loops } = computeLoops({ totalSamples, sampleRate, bpm, meter: 4, barsPerLoop });
  assert.equal(loops.length, 500);
  assert.equal(loops[0].index, 0);
  assert.equal(loops[499].index, 499);
});

// ── loopIndexAtSample ───────────────────────────────────────────────────────

test('loopIndexAtSample: half-open interval edges and not-found cases', () => {
  const loops = [
    { index: 0, startSample: 0, endSample: 100 },
    { index: 1, startSample: 100, endSample: 250 },
  ];
  assert.equal(loopIndexAtSample(loops, 0), 0);
  assert.equal(loopIndexAtSample(loops, 99), 0);
  assert.equal(loopIndexAtSample(loops, 100), 1, 'endSample is exclusive on the previous loop, inclusive as the next loop start');
  assert.equal(loopIndexAtSample(loops, 249), 1);
  assert.equal(loopIndexAtSample(loops, 250), -1, 'endSample itself is out of range');
  assert.equal(loopIndexAtSample(loops, -1), -1);
  assert.equal(loopIndexAtSample([], 5), -1);
  assert.equal(loopIndexAtSample(loops, NaN), -1);
  assert.equal(loopIndexAtSample(null, 5), -1);
});

// ── formatSeconds ────────────────────────────────────────────────────────

test('formatSeconds: M:SS.mmm formatting including carry and guard cases', () => {
  assert.equal(formatSeconds(3.84), '0:03.840');
  assert.equal(formatSeconds(0), '0:00.000');
  assert.equal(formatSeconds(65.5), '1:05.500');
  assert.equal(formatSeconds(-5), '0:00.000');
  assert.equal(formatSeconds(NaN), '0:00.000');
  assert.equal(formatSeconds(59.9996), '1:00.000', 'millisecond rounding to 1000 must carry into seconds/minutes');
});

// ── nextPhraseWaitMs (4-bar quantized loop switching) ────────────────────

test('nextPhraseWaitMs: waits out the remainder of the current phrase', () => {
  // 120bpm, 4/4, 4 bars => 8000ms phrase
  assert.equal(nextPhraseWaitMs({ nowMs: 1000, clockStartMs: 0, bpm: 120 }), 7000);
  assert.equal(nextPhraseWaitMs({ nowMs: 7999, clockStartMs: 0, bpm: 120 }), 1);
});

test('nextPhraseWaitMs: a request exactly on a boundary starts now', () => {
  assert.equal(nextPhraseWaitMs({ nowMs: 0, clockStartMs: 0, bpm: 120 }), 0);
  assert.equal(nextPhraseWaitMs({ nowMs: 8000, clockStartMs: 0, bpm: 120 }), 0);
  assert.equal(nextPhraseWaitMs({ nowMs: 24000, clockStartMs: 0, bpm: 120 }), 0);
});

test('nextPhraseWaitMs: successive requests land on ONE grid, a phrase apart', () => {
  const clockStartMs = 0;
  const first = 3000 + nextPhraseWaitMs({ nowMs: 3000, clockStartMs, bpm: 120 });
  const second = 9000 + nextPhraseWaitMs({ nowMs: 9000, clockStartMs, bpm: 120 });
  assert.equal(first, 8000);
  assert.equal(second, 16000);
  assert.equal(second - first, 8000);
});

test('nextPhraseWaitMs: follows bpm, meter and bar count', () => {
  assert.equal(nextPhraseWaitMs({ nowMs: 0.5, clockStartMs: 0, bpm: 60, meter: 4, bars: 4 }), 15999.5);
  assert.equal(nextPhraseWaitMs({ nowMs: 1000, clockStartMs: 0, bpm: 120, meter: 3, bars: 4 }), 5000);
  assert.equal(nextPhraseWaitMs({ nowMs: 1000, clockStartMs: 0, bpm: 120, meter: 4, bars: 1 }), 1000);
});

test('nextPhraseWaitMs: no grid / bad input starts immediately', () => {
  assert.equal(nextPhraseWaitMs({ nowMs: 1000, clockStartMs: null, bpm: 120 }), 0);
  assert.equal(nextPhraseWaitMs({ nowMs: 1000, clockStartMs: 0, bpm: 0 }), 0);
  assert.equal(nextPhraseWaitMs({ nowMs: 1000, clockStartMs: 0, bpm: NaN }), 0);
  assert.equal(nextPhraseWaitMs({ nowMs: 1000, clockStartMs: 2000, bpm: 120 }), 0);
});
