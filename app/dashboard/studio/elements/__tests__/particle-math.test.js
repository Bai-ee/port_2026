import test from 'node:test';
import assert from 'node:assert/strict';
import { computeParticleTarget, computeParticleColor, lerpTowardTarget, hslToRgb, DEFAULT_PARTICLE_PARAMS } from '../particle-math.js';

// ── Independent oracle — ox.jsx's per-particle formula, transcribed
// straight from its source (lines 279-307) with zero shared code against
// particle-math.js, so agreement between the two is a real cross-check that
// the extraction is faithful, not a test of the module against itself. ────

const GOLDEN = 2.39996322972865332;

function oracleTarget(i, count, time, p) {
  const t = i * (1 / count);
  const u = i * GOLDEN + time * p.flow * 0.5;
  const phi = Math.acos(1 - 2 * t);
  const v = phi * 2 + time * 0.4;
  const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
  const r1 = p.torusMajorRadius + p.torusTubeRadius * 0.2 * Math.sin(time * 0.5) * p.torusPulse;
  const x4 = r1 * cu, y4 = r1 * su, z4 = p.torusTubeRadius * cv, w4 = p.torusTubeRadius * sv;
  const d = 2 - w4;
  const x = x4 / d, y = y4 / d, z = z4 / d;
  const waveAmpY = p.waveAmplitude * (p.torusPulse > 0 ? Math.sin(time * 0.3) : 1);
  const waveZ = Math.cos(time * 0.4);
  const wave = Math.sin(x * 5 + time) * Math.cos(y * 5 - time * 0.7) * p.chaos;
  return {
    x: x * p.scale + wave * p.waveAmplitude,
    y: y * p.scale + wave * waveAmpY,
    z: z * p.scale * 0.8 + wave * waveZ,
    wave,
  };
}

function oracleColor(i, count, time, wave, p) {
  const t = i * (1 / count);
  const hue = (p.hueOffset + t * 0.8 + time * p.hueSpeed + wave * 0.05) % 1;
  return { h: hue, s: p.saturation, l: p.lightness + wave * 0.15 };
}

const SAMPLE_PARAMS = [
  DEFAULT_PARTICLE_PARAMS,
  { ...DEFAULT_PARTICLE_PARAMS, chaos: 0.3, flow: 1.2, waveAmplitude: 1.5, torusPulse: 0 },
  { ...DEFAULT_PARTICLE_PARAMS, torusMajorRadius: 2, torusTubeRadius: 0.5, hueOffset: 0.25 },
];

test('computeParticleTarget matches ox.jsx\'s formula (independent oracle), across indices/times/params', () => {
  const count = 2500;
  SAMPLE_PARAMS.forEach((params) => {
    [0, 1, 500, 2499].forEach((i) => {
      [0, 0.5, 3.14159, 42].forEach((time) => {
        const actual = computeParticleTarget(i, count, time, params);
        const expected = oracleTarget(i, count, time, params);
        assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x mismatch @ i=${i} t=${time}`);
        assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y mismatch @ i=${i} t=${time}`);
        assert.ok(Math.abs(actual.z - expected.z) < 1e-9, `z mismatch @ i=${i} t=${time}`);
        assert.ok(Math.abs(actual.wave - expected.wave) < 1e-9, `wave mismatch @ i=${i} t=${time}`);
      });
    });
  });
});

test('computeParticleColor matches ox.jsx\'s formula (independent oracle)', () => {
  const count = 2500;
  SAMPLE_PARAMS.forEach((params) => {
    [0, 1, 500, 2499].forEach((i) => {
      const time = 1.75;
      const { wave } = computeParticleTarget(i, count, time, params);
      const actual = computeParticleColor(i, count, time, wave, params);
      const expected = oracleColor(i, count, time, wave, params);
      assert.ok(Math.abs(actual.h - (expected.h < 0 ? expected.h + 1 : expected.h)) < 1e-9);
      assert.equal(actual.s, expected.s);
      assert.ok(Math.abs(actual.l - expected.l) < 1e-9);
    });
  });
});

test('computeParticleTarget: deterministic — identical inputs always produce identical output', () => {
  const a = computeParticleTarget(17, 1000, 3.2, DEFAULT_PARTICLE_PARAMS);
  const b = computeParticleTarget(17, 1000, 3.2, DEFAULT_PARTICLE_PARAMS);
  assert.deepEqual(a, b);
});

test('computeParticleTarget: varying `time` moves the particle (this is an animated formula, not a static one)', () => {
  const a = computeParticleTarget(5, 1000, 0, DEFAULT_PARTICLE_PARAMS);
  const b = computeParticleTarget(5, 1000, 10, DEFAULT_PARTICLE_PARAMS);
  assert.notDeepEqual(a, b);
});

test('computeParticleColor: hue always lands in [0, 1)', () => {
  for (let i = 0; i < 50; i += 1) {
    const time = i * 3.3;
    const { wave } = computeParticleTarget(i, 50, time, DEFAULT_PARTICLE_PARAMS);
    const { h } = computeParticleColor(i, 50, time, wave, { ...DEFAULT_PARTICLE_PARAMS, hueOffset: 0.9 });
    assert.ok(h >= 0 && h < 1, `hue ${h} out of [0,1) at i=${i}`);
  }
});

test('lerpTowardTarget: moves partway from current to target by `factor`, reaches target at factor=1, stays put at factor=0', () => {
  assert.equal(lerpTowardTarget(0, 10, 0.5), 5);
  assert.equal(lerpTowardTarget(0, 10, 1), 10);
  assert.equal(lerpTowardTarget(0, 10, 0), 0);
  assert.equal(lerpTowardTarget(4, 4, 0.3), 4);
});

test('hslToRgb: known color values', () => {
  assert.deepEqual(hslToRgb(0, 0, 1), { r: 1, g: 1, b: 1 }); // white
  assert.deepEqual(hslToRgb(0, 0, 0), { r: 0, g: 0, b: 0 }); // black
  assert.deepEqual(hslToRgb(0, 0, 0.5), { r: 0.5, g: 0.5, b: 0.5 }); // gray (s=0 short-circuits to l,l,l)
  const red = hslToRgb(0, 1, 0.5);
  assert.ok(Math.abs(red.r - 1) < 1e-9 && Math.abs(red.g) < 1e-9 && Math.abs(red.b) < 1e-9);
});
