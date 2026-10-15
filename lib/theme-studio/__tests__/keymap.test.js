import test from 'node:test';
import assert from 'node:assert/strict';
import { sliderKeyStep, matchShortcut, trapNextIndex, isNativeUndoTarget } from '../keymap.js';

const base = { value: 100, min: 0, max: 360, step: 1 };

test('arrows step, shift multiplies by 10, page keys use page, Home/End jump', () => {
  assert.equal(sliderKeyStep('ArrowRight', base), 101);
  assert.equal(sliderKeyStep('ArrowUp', base), 101);
  assert.equal(sliderKeyStep('ArrowLeft', base), 99);
  assert.equal(sliderKeyStep('ArrowDown', base), 99);
  assert.equal(sliderKeyStep('ArrowRight', { ...base, shift: true }), 110);
  assert.equal(sliderKeyStep('ArrowLeft', { ...base, shift: true }), 90);
  assert.equal(sliderKeyStep('PageUp', base), 110);
  assert.equal(sliderKeyStep('PageDown', { ...base, page: 30 }), 70);
  assert.equal(sliderKeyStep('Home', base), 0);
  assert.equal(sliderKeyStep('End', base), 360);
  assert.equal(sliderKeyStep('a', base), null);
  assert.equal(sliderKeyStep('Tab', base), null);
});

test('clamps at the ends without wrap, loops with wrap', () => {
  assert.equal(sliderKeyStep('ArrowRight', { ...base, value: 360 }), 360);
  assert.equal(sliderKeyStep('ArrowLeft', { ...base, value: 0 }), 0);
  assert.equal(sliderKeyStep('ArrowRight', { ...base, value: 360, wrap: true }), 1);
  assert.equal(sliderKeyStep('ArrowLeft', { ...base, value: 0, wrap: true }), 359);
  assert.equal(sliderKeyStep('ArrowRight', { ...base, value: 355, wrap: true, shift: true }), 5);
});

test('fractional steps stay free of float noise', () => {
  const o = { value: 0.3, min: 0, max: 1.5, step: 0.05 };
  assert.equal(sliderKeyStep('ArrowRight', o), 0.35);
  assert.equal(sliderKeyStep('ArrowRight', { ...o, value: 0.35 }), 0.4);
  assert.equal(sliderKeyStep('ArrowRight', { ...o, shift: true }), 0.8);
  assert.equal(sliderKeyStep('ArrowRight', { value: 0.1, min: 0, max: 1, step: 0.1 }), 0.2);
  assert.equal(sliderKeyStep('ArrowRight', { value: NaN, min: 0, max: 1, step: 0.1 }), null);
});

test('shortcuts: undo, redo, escape, toggle; native text undo is left alone', () => {
  assert.equal(matchShortcut({ key: 'z', ctrlKey: true }), 'undo');
  assert.equal(matchShortcut({ key: 'z', metaKey: true }), 'undo');
  assert.equal(matchShortcut({ key: 'Z', metaKey: true, shiftKey: true }), 'redo');
  assert.equal(matchShortcut({ key: 'z', ctrlKey: true, shiftKey: true }), 'redo');
  assert.equal(matchShortcut({ key: 'y', ctrlKey: true }), 'redo');
  assert.equal(matchShortcut({ key: 'Escape' }), 'escape');
  assert.equal(matchShortcut({ key: 'T', altKey: true, shiftKey: true }), 'toggle');
  assert.equal(matchShortcut({ key: 'z' }), null);
  assert.equal(matchShortcut({ key: 'z', ctrlKey: true, target: { tagName: 'TEXTAREA' } }), null);
  assert.equal(matchShortcut({ key: 'z', ctrlKey: true, target: { tagName: 'INPUT' } }), 'undo');
  assert.equal(matchShortcut(null), null);
  assert.equal(isNativeUndoTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('focus trap order wraps in both directions', () => {
  assert.equal(trapNextIndex({ count: 3, index: 2, shift: false }), 0);
  assert.equal(trapNextIndex({ count: 3, index: 0, shift: true }), 2);
  assert.equal(trapNextIndex({ count: 3, index: 1, shift: false }), 2);
  assert.equal(trapNextIndex({ count: 3, index: -1, shift: false }), 0);
  assert.equal(trapNextIndex({ count: 3, index: -1, shift: true }), 2);
  assert.equal(trapNextIndex({ count: 0, index: 0, shift: false }), -1);
});
