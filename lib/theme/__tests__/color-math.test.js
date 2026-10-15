import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHex, formatHex, formatRgba, srgbToLinear, linearToSrgb, hexToOklch, oklchToHex,
  oklchToOklab, oklabToOklch, linearSrgbToOklab, oklabToLinearSrgb, wrapHue, hueDelta, wrapTurns,
  deltaEOK, oklchToRgb255,
} from '../color.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

test('sanity vectors (contract 6.1)', () => {
  const white = hexToOklch('#ffffff');
  near(white.l, 1, 0.002, 'white L');
  assert.ok(white.c < 1e-4, 'white is achromatic');
  const cases = [
    ['#2a2420', 0.266, 0.012, 55.8],
    ['#00adb5', 0.68, 0.116, 200.7],
    ['#6e1aff', 0.52, 0.286, 287.4],
    ['#D71921', 0.561, 0.218, 26.8],
  ];
  for (const [hex, l, c, h] of cases) {
    const o = hexToOklch(hex);
    near(o.l, l, 0.002, `${hex} L`);
    near(o.c, c, 0.002, `${hex} C`);
    near(o.h, h, 0.3, `${hex} H`);
  }
});

test('sRGB <-> linear is the inverse pair and handles the toe', () => {
  for (let i = 0; i <= 255; i++) {
    const c = i / 255;
    near(linearToSrgb(srgbToLinear(c)), c, 1e-12);
  }
  near(srgbToLinear(0.04045), 0.04045 / 12.92, 1e-15);
  assert.equal(srgbToLinear(0), 0);
  near(srgbToLinear(1), 1, 1e-15);
});

test('hex <-> OKLCH round trip within 1/255 over a 4096-colour sweep', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  let worst = 0;
  for (let i = 0; i < 4096; i++) {
    const v = rnd();
    const rgb = { r: v & 255, g: (v >>> 8) & 255, b: (v >>> 16) & 255 };
    const hex = formatHex(rgb);
    const back = parseHex(oklchToHex(hexToOklch(hex)));
    const d = Math.max(Math.abs(back.r - rgb.r), Math.abs(back.g - rgb.g), Math.abs(back.b - rgb.b));
    worst = Math.max(worst, d);
    assert.ok(d <= 1, `${hex} drifted by ${d}`);
  }
  assert.ok(worst <= 1);
});

test('hue helpers wrap consistently (-1, 0, 359.999, 360, 721)', () => {
  assert.equal(wrapHue(-1), 359);
  assert.equal(wrapHue(0), 0);
  assert.equal(wrapHue(-0), 0);
  assert.ok(Object.is(wrapHue(-0), 0));
  assert.equal(wrapHue(359.999), 359.999);
  assert.equal(wrapHue(360), 0);
  assert.equal(wrapHue(721), 1);
  assert.equal(wrapHue(26.79), 26.79, 'in-range values are returned exactly (no float drift)');
  assert.equal(hueDelta(350, 10), 20);
  assert.equal(hueDelta(10, 350), -20);
  assert.equal(hueDelta(0, 180), 180);
  assert.equal(hueDelta(180, 0), 180);
  near(wrapTurns(1 / 6), 1 / 6, 1e-12);
  assert.equal(wrapTurns(0.5), 0.5);
  assert.equal(wrapTurns(0.75), -0.25);
  assert.equal(wrapTurns(-0.5), 0.5);
  assert.equal(wrapTurns(1), 0);
});

test('achromatic colours keep the caller hue (never atan2(0,0))', () => {
  assert.equal(hexToOklch('#808080', 123).h, 123);
  assert.equal(hexToOklch('#000000', 77).h, 77);
  assert.equal(oklabToOklch({ l: 0.5, a: 0, b: 0 }, 200).h, 200);
  assert.equal(oklabToOklch({ l: 0.5, a: 1e-6, b: 0 }, 200).h, 200);
  // a chromatic colour ignores the fallback
  near(hexToOklch('#00adb5', 5).h, 200.65, 0.3);
});

test('OKLab conversions invert each other', () => {
  const o = { l: 0.6, c: 0.12, h: 250 };
  const lab = oklchToOklab(o);
  const back = oklabToOklch(lab);
  near(back.l, o.l, 1e-12);
  near(back.c, o.c, 1e-12);
  near(back.h, o.h, 1e-9);
  const lin = { r: 0.2, g: 0.5, b: 0.7 };
  const rt = oklabToLinearSrgb(linearSrgbToOklab(lin));
  near(rt.r, lin.r, 1e-6);
  near(rt.g, lin.g, 1e-6);
  near(rt.b, lin.b, 1e-6);
  near(deltaEOK({ l: 0.5, c: 0.1, h: 30 }, { l: 0.5, c: 0.1, h: 30 }), 0, 1e-15);
  near(deltaEOK({ l: 0.6, a: 0, b: 0 }, { l: 0.5, a: 0, b: 0 }), 0.1, 1e-12);
});

test('string helpers', () => {
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseHex('#00ff0080').g, 255);
  near(parseHex('#00ff0080').a, 128 / 255, 1e-9);
  assert.equal(parseHex('nope'), null);
  assert.equal(parseHex('#12'), null);
  assert.equal(formatHex({ r: 0.4, g: 255.6, b: -3 }), '#00ff00');
  assert.equal(formatRgba({ r: 1, g: 2, b: 3, a: 0.5 }), 'rgba(1, 2, 3, 0.5)');
  assert.equal(formatRgba({ r: 1, g: 2, b: 3, a: 1 }), 'rgba(1, 2, 3, 1)');
  assert.equal(formatRgba({ r: 1, g: 2, b: 3, a: 0.12345 }), 'rgba(1, 2, 3, 0.123)');
  assert.equal(formatRgba({ r: 1, g: 2, b: 3, a: 0 }), 'rgba(1, 2, 3, 0)');
});

test('oklchToRgb255 reports out-of-gamut input without clamping', () => {
  const r = oklchToRgb255({ l: 0.7, c: 0.4, h: 150 });
  assert.equal(r.inGamut, false);
  assert.ok(r.r < 0 || r.g > 255 || r.b < 0 || r.b > 255 || r.r > 255 || r.g < 0);
  assert.equal(oklchToRgb255({ l: 0.5, c: 0.05, h: 30 }).inGamut, true);
});
