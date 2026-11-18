import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTrim, DETECTOR_VERSION, DEFAULT_PARAMS } from '../trim-detect.js';

const WIN_S = 0.1;

/** Deterministic PRNG so synthetic tapes are reproducible. */
function rng(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a dB array (100 ms windows) from segments:
 *   { s, db, jitter }       steady level +/- jitter (uniform)
 *   { s, from, to, jitter } linear ramp
 * Returns the array plus a helper for the start time of each labelled segment.
 */
function tape(segments, seed = 1) {
  const rand = rng(seed);
  const out = [];
  const starts = {};
  for (const seg of segments) {
    if (seg.name) starts[seg.name] = out.length * WIN_S;
    const n = Math.round(seg.s / WIN_S);
    const jitter = seg.jitter ?? 1;
    for (let i = 0; i < n; i++) {
      const base = seg.db !== undefined ? seg.db : seg.from + ((seg.to - seg.from) * i) / n;
      out.push(base + (rand() * 2 - 1) * jitter);
    }
  }
  return { db: Float32Array.from(out), at: starts };
}

const hiss = (s, db = -60, extra = {}) => ({ s, db, jitter: 1, ...extra });
const music = (s, db = -20, extra = {}) => ({ s, db, jitter: 4, ...extra });

function assertInvariants(r, db) {
  let prevEnd = 0;
  for (const k of r.keep) {
    assert.ok(k.startS >= 0 && k.endS <= r.durationS + 1e-9, 'keep within [0,duration]');
    assert.ok(k.endS > k.startS, 'keep has positive length');
    assert.ok(k.startS >= prevEnd, 'keep sorted and non-overlapping');
    prevEnd = k.endS;
  }
  for (const c of r.cuts) assert.ok(c.startS >= 0 && c.endS <= r.durationS + 1e-9 && c.endS > c.startS);
  assert.equal(r.detectorVersion, DETECTOR_VERSION);
  if (db) {
    // Cut ceiling: no window at or above cutCeilingDb inside a cut (listed dropped islands excepted).
    const ceil = r.params.cutCeilingDb;
    for (const c of r.cuts) {
      if (c.reason === 'stationary buzz') continue; // buzz is exempt from the ceiling
      for (let i = Math.round(c.startS * 10); i < Math.round(c.endS * 10); i++) {
        if (db[i] < ceil) continue;
        const t0 = i * WIN_S;
        assert.ok(
          r.droppedIslands.some((d) => t0 >= d.startS - 1e-6 && t0 < d.endS + 1e-6),
          `window at ${t0}s (${db[i]} dB) inside ${c.kind} cut is not a listed island`,
        );
      }
    }
  }
}

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ~${expected}, got ${actual}`);

test('dense 60 min mix with 1% scattered hiss windows: nothing inside the music is cut', () => {
  const t = tape([music(3600)], 7);
  const rand = rng(99);
  for (let i = 0; i < t.db.length; i++) if (rand() < 0.01) t.db[i] = -60;
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.deepEqual(r.keep, [{ startS: 0, endS: 3600 }]);
  assert.deepEqual(r.cuts, []);
  assert.ok(r.flags.includes('NO_TRIM'));
});

test('dense mix with hiss head/tail and scattered hiss: only head and tail are cut', () => {
  const t = tape([hiss(30, -60, { name: 'm' }), music(3600), hiss(30, -60, { name: 'e' })], 3);
  const rand = rng(5);
  for (let i = 400; i < t.db.length - 400; i++) if (rand() < 0.01) t.db[i] = -60;
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.equal(r.keep.length, 1);
  assert.deepEqual(r.cuts.map((c) => c.kind), ['head', 'tail']);
  near(r.keep[0].startS, 29, 0.2);
  near(r.keep[0].endS, 3631, 0.2);
});

test('leader -70, hiss -55, music -20: head trimmed to music start minus pad, hiss not active', () => {
  const t = tape(
    [{ s: 40, db: -70, jitter: 0.5 }, hiss(40, -55), music(600, -20, { name: 'm' }), hiss(30, -55)],
    11,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.thresholdDb > -55, 'hiss sits below the active threshold');
  assert.equal(r.keep.length, 1);
  near(r.keep[0].startS, t.at.m - 1, 0.05, 'head start');
  assert.equal(r.cuts[0].kind, 'head');
});

test('20 s false start, 5 s gap, then real music: false start dropped and listed', () => {
  const t = tape([hiss(10), music(20, -20, { name: 'fs' }), hiss(5), music(300, -20, { name: 'real' }), hiss(10)], 4);
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.equal(r.droppedIslands.length, 1);
  near(r.droppedIslands[0].startS, t.at.fs, 0.2);
  near(r.droppedIslands[0].endS, t.at.fs + 20, 0.2);
  near(r.keep[0].startS, t.at.real - 1, 0.1);
});

test('side flip: 40 s hiss gap with a 0.3 s clunk is cut, clunk not kept as an island', () => {
  const t = tape(
    [
      hiss(10),
      music(300),
      hiss(20, -60, { name: 'gap' }),
      { s: 0.3, db: -15, jitter: 0 },
      hiss(19.7),
      music(300, -20, { name: 'b' }),
      hiss(10),
    ],
    8,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.equal(r.keep.length, 2);
  const gap = r.cuts.find((c) => c.kind === 'gap');
  assert.ok(gap, 'gap cut exists');
  near(gap.startS, t.at.gap + 0.5, 0.2);
  near(gap.endS, t.at.b - 0.5, 0.2);
  assert.ok(r.droppedIslands.some((d) => d.startS >= t.at.gap && d.endS <= t.at.gap + 20.5));
  assert.ok(gap.startS < t.at.gap + 20 && gap.endS > t.at.gap + 20.3, 'cut covers the clunk');
});

test('12 s quiet breakdown is NOT cut (at -45, and at -52 which is under threshold but above floor+6)', () => {
  for (const level of [-45, -52]) {
    const t = tape([hiss(10), music(200), hiss(12, level, { jitter: 0.5 }), music(200), hiss(10)], 2);
    const r = detectTrim(t.db);
    assertInvariants(r, t.db);
    assert.equal(r.keep.length, 1, `breakdown at ${level} dB`);
    assert.equal(r.cuts.filter((c) => c.kind === 'gap').length, 0);
  }
});

test('DJ fade-out over 20 s: tail keeps the fade down to floor+4', () => {
  const t = tape(
    [hiss(10), music(200), { s: 20, from: -20, to: -60, jitter: 0, name: 'fade' }, hiss(30)],
    6,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  const end = r.keep[r.keep.length - 1].endS;
  // -56 dB (floor+4) is reached 18 s into the fade; pad adds 1 s.
  assert.ok(end >= t.at.fade + 18, `tail end ${end} keeps the fade`);
  assert.ok(end <= t.at.fade + 20.5, `tail end ${end} stops near the fade end`);
});

test('fade extension is capped at fadeExtendMaxS', () => {
  const t = tape([hiss(10), music(200), { s: 120, from: -20, to: -60, jitter: 0, name: 'fade' }, hiss(30)], 6);
  const r = detectTrim(t.db);
  const end = r.keep[r.keep.length - 1].endS;
  // Fade (-20 to -60 dB over 120 s) falls under the threshold at this point; at most 15 s extension + 1 s pad.
  const crossS = ((-20 - r.thresholdDb) / 40) * 120;
  assert.ok(end <= t.at.fade + crossS + DEFAULT_PARAMS.fadeExtendMaxS + DEFAULT_PARAMS.padHeadTailS + 0.2, `end ${end}`);
});

test('all-silent tape: ALL_SILENT, keep empty', () => {
  const r = detectTrim(tape([hiss(600)], 9).db);
  assertInvariants(r);
  assert.ok(r.flags.includes('ALL_SILENT'));
  assert.deepEqual(r.keep, []);
  const digital = detectTrim(new Float32Array(6000).fill(-200));
  assert.ok(digital.flags.includes('ALL_SILENT') && digital.flags.includes('DIGITAL_SILENCE_FLOOR'));
  assert.deepEqual(detectTrim([]).keep, []);
});

test('no hiss anywhere (music start to end): NO_TRIM', () => {
  const r = detectTrim(tape([music(600)], 12).db);
  assertInvariants(r);
  assert.ok(r.flags.includes('NO_TRIM'));
  assert.deepEqual(r.keep, [{ startS: 0, endS: 600 }]);
});

test('low headroom (music -40, hiss -55): LOW_HEADROOM + NO_TRIM, full keep, no cuts', () => {
  const t = tape(
    [hiss(40, -55), { s: 150, db: -40, jitter: 1 }, hiss(30, -55), { s: 150, db: -40, jitter: 1, name: 'b' }, hiss(20, -55)],
    13,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.flags.includes('LOW_HEADROOM'));
  assert.ok(r.flags.includes('NO_TRIM'));
  assert.deepEqual(r.keep, [{ startS: 0, endS: r.durationS }]);
  assert.deepEqual(r.cuts, []);
});

test('noise sample comes from the interior gap with edges excluded, not from the leader', () => {
  const t = tape(
    [
      { s: 30, db: -70, jitter: 0.5 },
      music(200),
      { s: 40, db: -66, jitter: 0.5, name: 'gap' },
      music(200, -20, { name: 'b' }),
      hiss(10, -66),
    ],
    14,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  const gap = r.cuts.find((c) => c.kind === 'gap');
  assert.ok(r.noiseSample, 'noise sample found');
  assert.ok(r.noiseSample.startS >= gap.startS + 0.5 - 1e-9);
  assert.ok(r.noiseSample.endS <= gap.endS - 0.5 + 1e-9);
  assert.ok(r.noiseSample.endS - r.noiseSample.startS >= 3);
});

test('noise sample falls back to head hiss and skips the quieter leader', () => {
  const t = tape([{ s: 30, db: -70, jitter: 0.5 }, hiss(30, -62, { name: 'h' }), music(300), hiss(20, -62)], 15);
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.noiseSample);
  assert.ok(r.noiseSample.startS >= t.at.h, `noise ${r.noiseSample.startS} starts after the leader`);
  assert.ok(r.noiseSample.endS <= t.at.h + 30);
});

test('hints.leaderEndS keeps the noise sample out of the leader', () => {
  const t = tape([hiss(20, -60, { name: 'lead' }), hiss(20, -60, { name: 'h' }), music(300), hiss(2, -60)], 16);
  const r = detectTrim(t.db, {}, { leaderEndS: 20 });
  assertInvariants(r, t.db);
  assert.ok(r.noiseSample.startS >= 20);
});

test('no 3 s hiss stretch: NO_NOISE_SAMPLE', () => {
  const t = tape([hiss(2), music(300), hiss(2)], 17);
  const r = detectTrim(t.db);
  assert.equal(r.noiseSample, null);
  assert.ok(r.flags.includes('NO_NOISE_SAMPLE'));
});

test('MANY_CUTS when more than manyCutsN gaps are cut', () => {
  const segs = [hiss(10)];
  for (let i = 0; i < 6; i++) segs.push(music(60), hiss(10));
  const { db } = tape(segs, 18);
  const r = detectTrim(db);
  assertInvariants(r, db);
  assert.equal(r.cuts.filter((c) => c.kind === 'gap').length, 5);
  assert.ok(r.flags.includes('MANY_CUTS'));
});

test('a 5 s dip is bridged, not cut', () => {
  const t = tape([hiss(10), music(100), hiss(5), music(100), hiss(10)], 19);
  const r = detectTrim(t.db);
  assert.equal(r.keep.length, 1);
});

test('params override defaults and are echoed back', () => {
  const t = tape([hiss(10), music(100), hiss(7), music(100), hiss(10)], 20);
  assert.equal(detectTrim(t.db).keep.length, 2);
  const r = detectTrim(t.db, { gapCutS: 10 });
  assert.equal(r.keep.length, 1);
  assert.equal(r.params.gapCutS, 10);
  assert.equal(r.params.windowMs, DEFAULT_PARAMS.windowMs);
});

// ---- Fix round 1 ----

test('REC020 regression: quiet 29 s intro, no silence anywhere -> NO_TRIM, nothing cut', () => {
  const t = tape(
    [
      { s: 29, from: -28, to: -22, jitter: 1 },
      { s: 3600, db: -14, jitter: 5 },
      { s: 60, db: -9, jitter: 0.5 },
    ],
    21,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.flags.includes('NO_TRIM'));
  assert.deepEqual(r.keep, [{ startS: 0, endS: r.durationS }]);
  assert.deepEqual(r.cuts, []);
});

test('dynamic dense mix with no hiss (-30 / -14 alternating): NO_TRIM, full keep', () => {
  const segs = [];
  for (let i = 0; i < 40; i++) segs.push({ s: 20, db: -30, jitter: 2 }, { s: 60, db: -14, jitter: 4 });
  const { db } = tape(segs, 22);
  const r = detectTrim(db);
  assertInvariants(r, db);
  assert.ok(r.flags.includes('NO_TRIM'));
  assert.deepEqual(r.keep, [{ startS: 0, endS: r.durationS }]);
});

test('digital-silence lead-in/out: interior hiss becomes the floor, gap still cut', () => {
  const t = tape(
    [
      { s: 10, db: -100, jitter: 0.5 },
      { s: 20, db: -80, jitter: 0.5 },
      hiss(20),
      music(200),
      hiss(40, -60, { name: 'gap' }),
      music(200, -20, { name: 'b' }),
      { s: 30, db: -120, jitter: 0 },
    ],
    23,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  near(r.floorDb, -60, 1.5, 'effective floor');
  assert.ok(r.rawFloorDb < -90, 'raw floor is the digital silence');
  assert.ok(r.flags.includes('DIGITAL_SILENCE_FLOOR'));
  const gap = r.cuts.find((c) => c.kind === 'gap');
  assert.ok(gap, 'gap cut exists');
  near(gap.startS, t.at.gap + 0.5, 0.5);
  near(gap.endS, t.at.b - 0.5, 0.5);
});

test('breakdowns (-45 and -52) behind a -95 leader are still not cut', () => {
  for (const level of [-45, -52]) {
    const t = tape(
      [{ s: 20, db: -95, jitter: 0.5 }, hiss(10), music(200), hiss(12, level, { jitter: 0.5 }), music(200), hiss(10)],
      24,
    );
    const r = detectTrim(t.db);
    assertInvariants(r, t.db);
    assert.equal(r.cuts.filter((c) => c.kind === 'gap').length, 0, `breakdown at ${level} dB`);
    assert.equal(r.keep.length, 1);
  }
});

test('5 s burst inside hiss (only content): NO_SUSTAINED_RUN', () => {
  const t = tape([hiss(60), music(5), hiss(60)], 25);
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.flags.includes('NO_SUSTAINED_RUN'));
});

test('a normal tape does not get NO_SUSTAINED_RUN, and rawFloorDb is reported', () => {
  const r = detectTrim(tape([hiss(10), music(300), hiss(10)], 26).db);
  assert.ok(!r.flags.includes('NO_SUSTAINED_RUN'));
  near(r.rawFloorDb, -60, 1);
  assert.equal(r.floorDb, r.rawFloorDb);
});

test('REC020 shape: ramp -28 to -22, 600 s music, flat tail -> NO_TRIM, nothing cut or dropped', () => {
  const t = tape(
    [
      { s: 29, from: -28, to: -22, jitter: 1 },
      { s: 1, db: -19, jitter: 0 },
      { s: 600, db: -10.5, jitter: 4 },
      { s: 180, db: -8.7, jitter: 0.5 },
    ],
    27,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.flags.includes('NO_TRIM') && r.flags.includes('NO_HISS_FLOOR'));
  assert.deepEqual(r.keep, [{ startS: 0, endS: r.durationS }]);
  assert.deepEqual(r.cuts, []);
  assert.deepEqual(r.droppedIslands, []);
});

test('hot tape with real hiss and a quiet intro ramp: intro is not cut', () => {
  const t = tape(
    [
      hiss(30, -58),
      { s: 20, from: -40, to: -20, jitter: 0, name: 'intro' },
      { s: 600, db: -12, jitter: 4 },
      hiss(20, -58),
    ],
    28,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.keep[0].startS <= t.at.intro, 'intro kept');
  near(r.keep[0].startS, t.at.intro - 1, 1.2, 'head start');
  assert.equal(r.cuts[0].kind, 'head');
});

test('D10 REC020 full shape: quiet intro kept, 22 min loud stationary buzz cut as tail', () => {
  const t = tape(
    [
      { s: 29, from: -28, to: -22, jitter: 1 },
      { s: 5706, db: -19, jitter: 4.3, name: 'x' }, // uniform +/-4.3 -> std ~2.5
      { s: 1320, db: -6.8, jitter: 0.01, name: 'buzz' },
    ],
    30,
  );
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.flags.includes('STATIONARY_NOISE'));
  assert.equal(r.keep.length, 1);
  assert.equal(r.keep[0].startS, 0, 'intro kept from 0');
  near(r.keep[0].endS, t.at.buzz, 1.5, 'keep ends where the buzz starts');
  assert.ok(r.keep[0].endS <= t.at.buzz + 1e-6, 'no pad into the buzz');
  assert.equal(r.cuts.length, 1);
  assert.equal(r.cuts[0].kind, 'tail');
  assert.equal(r.cuts[0].reason, 'stationary buzz');
  assert.equal(r.noiseSample, null);
});

test('D10 interior 60 s buzz at -20 between music halves: cut as a gap', () => {
  const t = tape([music(300), { s: 60, db: -20, jitter: 0.01, name: 'buzz' }, music(300, -20, { name: 'b' })], 31);
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.equal(r.keep.length, 2);
  const gap = r.cuts.find((c) => c.kind === 'gap');
  assert.ok(gap && gap.reason === 'stationary buzz');
  near(gap.startS, t.at.buzz, 1.5);
  near(gap.endS, t.at.b, 1.5);
  assert.ok(r.flags.includes('STATIONARY_NOISE'));
});

test('D10 6 s steady stretch (std 0.2) inside music is NOT cut', () => {
  const t = tape([hiss(10), music(200), { s: 6, db: -20, jitter: 0.3 }, music(200), hiss(10)], 32);
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(!r.flags.includes('STATIONARY_NOISE'));
  assert.equal(r.keep.length, 1);
  assert.equal(r.cuts.filter((c) => c.kind === 'gap').length, 0);
});

test('D10 hiss-floor tapes are unaffected (no STATIONARY_NOISE on jittery hiss)', () => {
  const r = detectTrim(tape([hiss(30), music(300), hiss(30)], 33).db);
  assert.ok(!r.flags.includes('STATIONARY_NOISE'));
});

test('D10 buzz tail with a 0.2 s spike inside: exactly one tail cut, spike not kept', () => {
  const t = tape([music(300), { s: 60, db: -7, jitter: 0.01, name: 'buzz' }, { s: 0.2, db: -20, jitter: 0 }, { s: 60, db: -7, jitter: 0.01 }], 34);
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.equal(r.keep.length, 1);
  assert.ok(r.keep[0].endS <= t.at.buzz + 1e-6);
  assert.equal(r.cuts.length, 1);
  assert.equal(r.cuts[0].kind, 'tail');
  assert.ok(r.droppedIslands.some((d) => d.reason === 'short segment adjacent to stationary buzz'));
});

test('D10 buzz cuts carry medianDb/stdDb; interior buzz gap adds STATIONARY_GAP, tail-only does not', () => {
  const gapT = tape([music(300), { s: 60, db: -20, jitter: 0.01, name: 'buzz' }, music(300)], 35);
  const g = detectTrim(gapT.db);
  const gap = g.cuts.find((c) => c.kind === 'gap');
  assert.ok(gap && gap.reason === 'stationary buzz');
  near(gap.medianDb, -20, 0.1, 'median');
  assert.ok(gap.stdDb >= 0 && gap.stdDb < 0.3, `std ${gap.stdDb}`);
  assert.ok(g.flags.includes('STATIONARY_GAP'));
  const tailT = tape([music(300), { s: 60, db: -7, jitter: 0.01 }], 36);
  const tl = detectTrim(tailT.db);
  const tail = tl.cuts.find((c) => c.kind === 'tail');
  assert.equal(typeof tail.medianDb, 'number');
  assert.equal(typeof tail.stdDb, 'number');
  assert.ok(!tl.flags.includes('STATIONARY_GAP'));
});

test('D10 documented behaviour: a 12 s steady pad (std 0.2, |step| 0.1) at -20 inside music IS cut today', () => {
  const t = tape([hiss(10), music(200), { s: 12, db: -20, jitter: 0.01 }, music(200), hiss(10)], 37);
  const r = detectTrim(t.db);
  assertInvariants(r, t.db);
  assert.ok(r.flags.includes('STATIONARY_NOISE'));
  assert.ok(r.flags.includes('STATIONARY_GAP'));
  assert.ok(r.cuts.some((c) => c.kind === 'gap' && c.reason === 'stationary buzz'));
});

test.todo('noise sample avoids the leader when the leader is >75% of the cut windows (p75 hiss reference cannot tell them apart)');
