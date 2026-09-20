import test from 'node:test';
import assert from 'node:assert/strict';
import {
  secondsPerBeat, beatsInWindow, createMetronome,
  LOOKAHEAD_MS, SCHEDULE_WINDOW, ACCENT_HZ, BEAT_HZ,
} from '../metronome.js';

// ── grid math ────────────────────────────────────────────────────────────

test('secondsPerBeat: 60/bpm; 0 for a BPM that cannot make a grid', () => {
  assert.equal(secondsPerBeat(120), 0.5);
  assert.equal(secondsPerBeat(60), 1);
  assert.equal(secondsPerBeat(0), 0);
  assert.equal(secondsPerBeat(-120), 0);
  assert.equal(secondsPerBeat(NaN), 0);
  assert.equal(secondsPerBeat(undefined), 0);
});

test('beatsInWindow: only beats inside [from, from+window)', () => {
  const beats = beatsInWindow({ origin: 0, spb: 0.5, from: 0, window: 1.2, meter: 4 });
  assert.deepEqual(beats.map((b) => b.time), [0, 0.5, 1]);
  assert.deepEqual(beats.map((b) => b.beat), [0, 1, 2]);
});

test('beatsInWindow: window is half-open — a beat exactly at the end is next window', () => {
  const beats = beatsInWindow({ origin: 0, spb: 0.5, from: 0, window: 0.5 });
  assert.deepEqual(beats.map((b) => b.time), [0]);
});

test('beatsInWindow: consecutive windows schedule each beat exactly once', () => {
  const spb = 0.5;
  const seen = [];
  for (let from = 0; from < 4; from += SCHEDULE_WINDOW) {
    for (const b of beatsInWindow({ origin: 0, spb, from, window: SCHEDULE_WINDOW })) seen.push(b.beat);
  }
  assert.deepEqual(seen, [...new Set(seen)], 'no beat scheduled twice');
  // the walk ends at from=3.96, whose window reaches 4.08 — so beat 8 (t=4.0) is in
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('beatsInWindow: accents land on the downbeat of each bar', () => {
  // 4.1s at 120bpm covers beats 0..8 (t = 0 .. 4.0)
  const beats = beatsInWindow({ origin: 0, spb: 0.5, from: 0, window: 4.1, meter: 4 });
  assert.deepEqual(beats.filter((b) => b.accent).map((b) => b.beat), [0, 4, 8]);
  const in3 = beatsInWindow({ origin: 0, spb: 0.5, from: 0, window: 4.1, meter: 3 });
  assert.deepEqual(in3.filter((b) => b.accent).map((b) => b.beat), [0, 3, 6]);
});

test('beatsInWindow: origin offsets the whole grid', () => {
  // window is [10.6, 11.2) -> only the beat at 11.0 falls inside
  assert.deepEqual(beatsInWindow({ origin: 10, spb: 0.5, from: 10.6, window: 0.6 })
    .map((b) => b.time), [11]);
  assert.deepEqual(beatsInWindow({ origin: 10, spb: 0.5, from: 10.6, window: 1.1 })
    .map((b) => b.time), [11, 11.5]);
});

test('beatsInWindow: degenerate inputs yield nothing instead of spinning', () => {
  assert.deepEqual(beatsInWindow({ origin: 0, spb: 0, from: 0, window: 1 }), []);
  assert.deepEqual(beatsInWindow({ origin: 0, spb: 0.5, from: 0, window: 0 }), []);
});

// ── scheduler ────────────────────────────────────────────────────────────

function fakeContext() {
  const scheduled = [];
  const ctx = {
    currentTime: 0,
    state: 'running',
    resume() { ctx.state = 'running'; },
    createOscillator() {
      const osc = { frequency: { value: 0 }, connect() {}, start(t) { osc.startedAt = t; }, stop() {} };
      scheduled.push(osc);
      return osc;
    },
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    },
    destination: {},
  };
  return { ctx, scheduled };
}

test('createMetronome: start schedules clicks on the shared context, stop halts it', () => {
  const { ctx, scheduled } = fakeContext();
  const m = createMetronome({ getContext: () => ctx, getOutputNode: () => ctx.destination });
  assert.equal(m.isRunning(), false);
  assert.equal(m.start({ bpm: 120, meter: 4 }), true);
  assert.equal(m.isRunning(), true);
  assert.ok(scheduled.length > 0, 'first tick scheduled at least one click');
  m.stop();
  assert.equal(m.isRunning(), false);
});

test('createMetronome: the first click of a bar is the accent pitch', () => {
  const { ctx, scheduled } = fakeContext();
  const m = createMetronome({ getContext: () => ctx, getOutputNode: () => ctx.destination });
  m.start({ bpm: 120, meter: 4 });
  m.stop();
  assert.equal(scheduled[0].frequency.value, ACCENT_HZ);
  assert.notEqual(ACCENT_HZ, BEAT_HZ);
});

test('createMetronome: refuses a BPM that cannot make a grid, and stays stopped', () => {
  const { ctx } = fakeContext();
  const m = createMetronome({ getContext: () => ctx, getOutputNode: () => ctx.destination });
  assert.equal(m.start({ bpm: 0 }), false);
  assert.equal(m.isRunning(), false);
  assert.equal(m.start({ bpm: NaN }), false);
  assert.equal(m.isRunning(), false);
});

test('createMetronome: a suspended context is resumed on start', () => {
  const { ctx } = fakeContext();
  ctx.state = 'suspended';
  const m = createMetronome({ getContext: () => ctx, getOutputNode: () => ctx.destination });
  m.start({ bpm: 120 });
  assert.equal(ctx.state, 'running');
  m.stop();
});

test('lookahead is shorter than the window it schedules, so no beat is missed', () => {
  assert.ok(LOOKAHEAD_MS / 1000 < SCHEDULE_WINDOW);
});
