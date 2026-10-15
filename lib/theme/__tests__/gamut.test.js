import test from 'node:test';
import assert from 'node:assert/strict';
import { gamutMap, oklchToHex, deltaEOK, oklchToOklab, oklabToLinearSrgb, linearSrgbToOklab, hueDelta } from '../color.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { resolveBoth } from '../resolve.js';
import { setMasterHue, setIntensity, setNeutral } from '../edit.js';

const EPS = 0.0001;

function clipLab(o) {
  const lin = oklabToLinearSrgb(oklchToOklab(o));
  const c = (v) => Math.min(1, Math.max(0, v));
  return linearSrgbToOklab({ r: c(lin.r), g: c(lin.g), b: c(lin.b) });
}

test('in-gamut colours pass through unchanged', () => {
  const o = { l: 0.5, c: 0.05, h: 30 };
  const g = gamutMap(o);
  assert.equal(g.mapped, false);
  assert.equal(g.deltaE, 0);
  assert.deepEqual(g.oklch, o);
  assert.equal(g.rgb255.length, 3);
});

test('oklch(.7 .4 150) maps hue-stable with deltaE(candidate, clipped) < JND + eps', () => {
  const o = { l: 0.7, c: 0.4, h: 150 };
  const g = gamutMap(o);
  assert.equal(g.mapped, true);
  for (const ch of g.rgb255) assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255);
  assert.ok(Math.abs(hueDelta(o.h, g.oklch.h)) < 6, `hue drifted ${g.oklch.h}`);
  assert.ok(g.candidate.c < o.c, 'chroma reduced');
  assert.equal(g.candidate.l, o.l);
  assert.equal(g.candidate.h, o.h);
  assert.ok(deltaEOK(clipLab(g.candidate), g.candidate) < 0.02 + EPS);
  // the mapped colour is the clip of the candidate
  const m = clipLab(g.candidate);
  assert.ok(deltaEOK(m, g.oklch) < 1e-6);
});

test('L >= 1 is white and L <= 0 is black', () => {
  assert.deepEqual(gamutMap({ l: 1, c: 0.2, h: 40 }).rgb255, [255, 255, 255]);
  assert.deepEqual(gamutMap({ l: 1.4, c: 0.2, h: 40 }).rgb255, [255, 255, 255]);
  assert.deepEqual(gamutMap({ l: 0, c: 0.2, h: 40 }).rgb255, [0, 0, 0]);
  assert.deepEqual(gamutMap({ l: -0.3, c: 0.2, h: 40 }).rgb255, [0, 0, 0]);
  assert.equal(oklchToHex({ l: 1, c: 0, h: 0 }), '#ffffff');
  assert.equal(oklchToHex({ l: 0, c: 0, h: 0 }), '#000000');
});

test('garbage input never yields NaN', () => {
  for (const o of [{ l: NaN, c: 0.1, h: 10 }, { l: 0.5, c: NaN, h: 10 }, { l: 0.5, c: 0.1, h: NaN }, {}, { l: Infinity, c: 1, h: 1 }]) {
    const g = gamutMap(o);
    for (const ch of g.rgb255) assert.ok(Number.isFinite(ch));
    assert.ok(Number.isFinite(g.deltaE));
  }
});

test('dense sweep: every result is a valid 0-255 triplet, deterministic, and chroma never grows', () => {
  for (let l = 0.05; l < 1; l += 0.1) {
    for (let c = 0; c <= 0.5; c += 0.05) {
      for (let h = 0; h < 360; h += 30) {
        const a = gamutMap({ l, c, h });
        const b = gamutMap({ l, c, h });
        assert.deepEqual(a, b);
        for (const ch of a.rgb255) assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255);
        assert.ok(a.oklch.c <= c + EPS + 0.02, `chroma grew at ${l},${c},${h}`);
        assert.ok(Number.isFinite(a.oklch.h) && Number.isFinite(a.oklch.l));
      }
    }
  }
});

test('every baseline role maps to a valid hex at extreme hues, intensities and tints', () => {
  for (const hue of [0, 90, 180, 270, 359.99]) {
    for (const intensity of [0, 1, 1.5]) {
      for (const tint of [0, 2]) {
        let d = setMasterHue(BASELINE_DEFINITION, hue);
        d = setIntensity(d, intensity);
        d = setNeutral(d, { tintStrength: tint });
        const pair = resolveBoth(d);
        for (const mode of ['light', 'dark']) {
          for (const [id, r] of Object.entries(pair[mode].roles)) {
            assert.match(r.hex, /^#[0-9a-f]{6}$/, `${mode}.${id}`);
            assert.ok(r.rgba.every(Number.isFinite), `${mode}.${id}`);
            assert.ok(Number.isFinite(r.gamut.deltaE));
          }
        }
      }
    }
  }
});
