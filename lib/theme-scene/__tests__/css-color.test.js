import test from 'node:test';
import assert from 'node:assert/strict';
import { cssColorToRgbTriplet } from '../css-color.js';

test('hex forms', () => {
  assert.equal(cssColorToRgbTriplet('#000000'), '0, 0, 0');
  assert.equal(cssColorToRgbTriplet('#2a2420'), '42, 36, 32');
  assert.equal(cssColorToRgbTriplet('#FFF'), '255, 255, 255');
  assert.equal(cssColorToRgbTriplet('  #0f0e0a  '), '15, 14, 10');
  assert.equal(cssColorToRgbTriplet('#2a2420cc'), '42, 36, 32', '8-digit hex: alpha ignored');
});

test('rgb()/rgba() forms as emitted by toCss', () => {
  assert.equal(cssColorToRgbTriplet('rgba(42, 36, 32, 0.72)'), '42, 36, 32');
  assert.equal(cssColorToRgbTriplet('rgb(1,2,3)'), '1, 2, 3');
  assert.equal(cssColorToRgbTriplet('rgba(300, -5, 12.4, 1)'), '255, 0, 12');
});

test('unparseable values return null so the caller can fall back', () => {
  for (const v of ['', '   ', 'red', 'var(--t-text)', '#12', '#gggggg', null, undefined, 42, {}]) {
    assert.equal(cssColorToRgbTriplet(v), null, String(v));
  }
});
