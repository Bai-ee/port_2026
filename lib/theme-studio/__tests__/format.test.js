import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNumberInput, valueText, stepDecimals, roundTo, formatOklch, formatRatio, formatClock, saveMessage, signedNumber,
} from '../format.js';

test('hue input wraps and announces', () => {
  const r = parseNumberInput('370', { min: 0, max: 360, wrap: true });
  assert.equal(r.ok, true);
  assert.equal(r.value, 10);
  assert.equal(r.adjusted, 'wrapped');
  assert.match(r.message, /wrapped/);
  assert.equal(parseNumberInput('-30', { min: 0, max: 360, wrap: true }).value, 330);
  assert.equal(parseNumberInput('360', { min: 0, max: 360, wrap: true }).adjusted, 'none');
  assert.equal(parseNumberInput('201.5°', { min: 0, max: 360, wrap: true }).value, 201.5);
});

test('non-hue input clamps and announces', () => {
  const r = parseNumberInput('2.4', { min: 0, max: 1.5 });
  assert.equal(r.value, 1.5);
  assert.equal(r.adjusted, 'clamped');
  assert.match(r.message, /1\.5/);
  assert.equal(parseNumberInput('-3', { min: 0, max: 1.5 }).value, 0);
  assert.equal(parseNumberInput('0,75', { min: 0, max: 1.5 }).value, 0.75);
});

test('garbage is rejected, never coerced', () => {
  for (const t of ['', '  ', 'abc', '1e5', 'NaN', 'Infinity', '--3', '1.2.3', null, undefined]) {
    const r = parseNumberInput(t, { min: 0, max: 10 });
    assert.equal(r.ok, false, String(t));
    assert.equal(r.value, null);
  }
});

test('value text and rounding helpers', () => {
  assert.equal(valueText('degrees', 201), '201 degrees');
  assert.equal(valueText('percent', 0.5), '50 percent');
  assert.equal(valueText('turns', 0.8), '0.8 turns');
  assert.equal(stepDecimals(0.05), 2);
  assert.equal(stepDecimals(1), 0);
  assert.equal(stepDecimals(0.005), 3);
  assert.equal(roundTo(-0.0000001, 2), 0);
  assert.equal(Object.is(roundTo(-0.0000001, 2), -0), false);
  assert.equal(signedNumber(-0.5, 2), '−0.5');
  assert.equal(signedNumber(6, 0), '+6');
});

test('formatters', () => {
  assert.equal(formatOklch({ l: 0.68, c: 0.116, h: 200.7, a: 1 }), 'L 0.680  C 0.116  H 200.7');
  assert.match(formatOklch({ l: 0.5, c: 0, h: 10, a: 0.5 }), /A 0\.5$/);
  assert.equal(formatRatio(4.5), '4.50:1');
  assert.equal(formatRatio(NaN), '-');
  assert.match(formatClock('2026-10-14T14:02:00'), /^\d{2}:\d{2}$/);
  assert.equal(formatClock('nope'), '');
});

test('save feedback always says local and reports failure honestly', () => {
  assert.match(saveMessage({ ok: true, savedAt: '2026-10-14T14:02:00' }), /Draft saved \d{2}:\d{2}\. Local to this browser only\./);
  assert.match(saveMessage({ ok: false, error: 'storage unavailable' }), /Could not save: storage unavailable/);
  assert.match(saveMessage(undefined), /Could not save/);
});
