import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline, resolveTheme, hexToOklch } from '../../theme/index.js';
import {
  normalizeHexInput, editRoleHex, editRoleOklch, hueTrackStops, hueTrackGradient, axisTrackGradient,
} from '../color-fields.js';

test('hex input is normalised or rejected', () => {
  assert.equal(normalizeHexInput('#ABC'), '#aabbcc');
  assert.equal(normalizeHexInput('abc'), '#aabbcc');
  assert.equal(normalizeHexInput(' #00ADB5 '), '#00adb5');
  for (const bad of ['', '#12', '#12345', '#1234567', 'ggg', null, 'rgb(1,2,3)', '#11223344']) {
    assert.equal(normalizeHexInput(bad), null, String(bad));
  }
});

test('editing a custom role by hex lands on that hex and keeps alpha', () => {
  const d0 = createBaseline();
  const cur = resolveTheme(d0, 'light').roles['text-muted'].oklch;
  const d1 = editRoleHex(d0, 'light', 'text-muted', '#336699', cur);
  const r = resolveTheme(d1, 'light').roles['text-muted'];
  assert.equal(r.hex, '#336699');
  assert.equal(r.source, 'custom');
  assert.ok(Math.abs(r.oklch.a - cur.a) < 1e-9);
});

test('hex of an achromatic colour keeps the previous hue', () => {
  const d0 = createBaseline();
  const cur = { l: 0.7, c: 0.1, h: 123, a: 1 };
  const d1 = editRoleHex(d0, 'light', 'support-1', '#808080', cur);
  assert.equal(d1.modes.light.roles['support-1'].custom.h, 123);
  assert.equal(hexToOklch('#808080', 123).h, 123);
});

test('invalid hex returns the same definition', () => {
  const d0 = createBaseline();
  assert.equal(editRoleHex(d0, 'light', 'accent', 'zzz', { l: 1, c: 0, h: 0, a: 1 }), d0);
  assert.equal(editRoleHex(d0, 'light', 'accent', '#fff', null), d0);
});

test('OKLCH edits merge into the current value; status roles never change hue', () => {
  const d0 = createBaseline();
  const cur = resolveTheme(d0, 'light').roles.danger.oklch;
  const d1 = editRoleOklch(d0, 'light', 'danger', { l: 0.4, h: 200 }, cur);
  const c = d1.modes.light.roles.danger.custom;
  assert.equal(c.l, 0.4);
  assert.equal(c.h, Math.round(cur.h * 100) / 100);
  const acc = resolveTheme(d0, 'light').roles.accent.oklch;
  const d2 = editRoleOklch(d0, 'light', 'accent', { h: 10 }, acc);
  assert.equal(d2.modes.light.roles.accent.custom.h, 10);
  assert.equal(editRoleOklch(d0, 'light', 'nope', { l: 0.4 }, acc), d0);
});

test('hue track covers the full circle with valid hex stops', () => {
  const stops = hueTrackStops(0.7, 0.12, 12);
  assert.equal(stops.length, 13);
  assert.equal(stops[0].h, 0);
  assert.equal(stops[12].h, 360);
  for (const s of stops) assert.match(s.hex, /^#[0-9a-f]{6}$/);
  assert.equal(stops[0].hex, stops[12].hex, 'wraps seamlessly');
  assert.match(hueTrackGradient(0.7, 0.12), /^linear-gradient\(to right, #[0-9a-f]{6} 0%/);
  assert.match(axisTrackGradient('c', { l: 0.7, c: 0.1, h: 30 }), /^linear-gradient/);
});
