import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, relativeLuminance, composite } from '../contrast.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('known pairs', () => {
  near(contrastRatio('#000000', '#ffffff'), 21, 1e-9);
  near(contrastRatio('#ffffff', '#ffffff'), 1, 1e-12);
  const g777 = contrastRatio('#777777', '#ffffff');
  assert.equal(Math.round(g777 * 100) / 100, 4.48);
  assert.ok(g777 < 4.5, '#777 on white fails AA');
  assert.ok(contrastRatio('#767676', '#ffffff') >= 4.54);
  near(contrastRatio('#ffffff', '#000000'), 21, 1e-9);
});

test('relative luminance anchors', () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  near(relativeLuminance({ r: 255, g: 255, b: 255 }), 1, 1e-12);
  near(relativeLuminance({ r: 255, g: 0, b: 0 }), 0.2126, 1e-9);
});

test('alpha is composited before measuring (rgba(42,36,32,.52) on white)', () => {
  const c = composite({ r: 42, g: 36, b: 32, a: 0.52 }, { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual([c.r, c.g, c.b], [144, 141, 139]);
  assert.equal(c.a, 1);
  const ratio = contrastRatio({ r: 42, g: 36, b: 32, a: 0.52 }, '#ffffff');
  assert.equal(Math.round(ratio * 100) / 100, 3.3);
  // identical to measuring the composited colour directly
  near(ratio, contrastRatio(c, '#ffffff'), 1e-12);
});

test('composite order matters (layers go bottom -> top)', () => {
  const page = { r: 255, g: 255, b: 255, a: 1 };
  const glass = { r: 0, g: 0, b: 0, a: 0.5 };
  const tint = { r: 255, g: 0, b: 0, a: 0.5 };
  const a = composite(tint, composite(glass, page));
  const b = composite(glass, composite(tint, page));
  assert.notDeepEqual([a.r, a.g, a.b], [b.r, b.g, b.b]);
  assert.deepEqual([a.r, a.g, a.b], [192, 64, 64]);
});

test('translucent background is flattened on white before comparison; bad hex throws a clear error', () => {
  assert.ok(contrastRatio('#000000', { r: 0, g: 0, b: 0, a: 0.1 }) > 1);
  assert.throws(() => contrastRatio('red', '#fff'), /invalid colour/);
});
