import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapIndex, pickDayPostIds, stepTarget, positionLabel, swipeStep, initialWheelState, wheelStep,
  isTypingTarget, keyStep, WHEEL_QUIET_MS, targetAfterDecide,
} from '../post-carousel-model.js';

test('wrapIndex wraps both directions', () => {
  assert.equal(wrapIndex(3, 3), 0);
  assert.equal(wrapIndex(-1, 3), 2);
  assert.equal(wrapIndex(-4, 3), 2);
  assert.equal(wrapIndex(1, 0), 0);
});

test('stepTarget wraps last->first and first->last, null for <2 posts or unknown id', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(stepTarget(ids, 'c', 1), 'a');
  assert.equal(stepTarget(ids, 'a', -1), 'c');
  assert.equal(stepTarget(ids, 'b', 1), 'c');
  assert.equal(stepTarget(['a'], 'a', 1), null);
  assert.equal(stepTarget(ids, 'zz', 1), null);
  assert.equal(stepTarget(ids, 'a', 0), null);
});

test('positionLabel is 1-based', () => {
  assert.equal(positionLabel(['a', 'b', 'c'], 'c'), '3 / 3');
  assert.equal(positionLabel(['a'], 'x'), '');
  assert.equal(positionLabel([], 'x'), '');
});

test('pickDayPostIds prefers the stage date, falls back to any group holding the post', () => {
  const groups = [
    { date: '2026-10-17', rows: [{ id: 'x' }, { id: 'y' }] },
    { date: '2026-10-18', rows: [{ id: 'a' }, { id: 'b' }] },
  ];
  assert.deepEqual(pickDayPostIds(groups, '2026-10-18', 'b'), ['a', 'b']);
  assert.deepEqual(pickDayPostIds(groups, null, 'y'), ['x', 'y']);
  assert.deepEqual(pickDayPostIds(groups, '2026-10-18', 'nope'), []);
  assert.deepEqual(pickDayPostIds(null, null, 'a'), []);
});

test('swipeStep: left = next, right = prev, small or vertical-ish ignored', () => {
  assert.equal(swipeStep(-80, 5), 1);
  assert.equal(swipeStep(80, -5), -1);
  assert.equal(swipeStep(-30, 0), 0);
  assert.equal(swipeStep(-80, 70), 0);
});

test('wheelStep: vertical ignored, horizontal accumulates to one step then locks through inertia', () => {
  let s = initialWheelState();
  let r = wheelStep(s, { deltaX: 2, deltaY: 30 }, 0);
  assert.deepEqual([r.step, r.consumed], [0, false]);
  r = wheelStep(s, { deltaX: 30, deltaY: 2 }, 1000);
  assert.deepEqual([r.step, r.consumed], [0, true]);
  r = wheelStep(r.state, { deltaX: 40, deltaY: 2 }, 1016);
  assert.equal(r.step, 1);
  // inertia tail within the quiet window: no more steps
  let steps = 0;
  for (let t = 1032; t < 1400; t += 16) {
    r = wheelStep(r.state, { deltaX: 50, deltaY: 1 }, t);
    steps += r.step;
  }
  assert.equal(steps, 0);
  // after a quiet gap a new gesture steps again, in the other direction
  const t0 = 1400 + WHEEL_QUIET_MS + 10;
  r = wheelStep(r.state, { deltaX: -70, deltaY: 0 }, t0);
  assert.equal(r.step, -1);
});

test('wheelStep: direction flip mid-gesture restarts the accumulator', () => {
  let r = wheelStep(initialWheelState(), { deltaX: 50, deltaY: 0 }, 0);
  assert.equal(r.step, 0);
  r = wheelStep(r.state, { deltaX: -20, deltaY: 0 }, 10);
  assert.equal(r.step, 0);
});

test('keyStep ignores typing targets and modified keys', () => {
  const body = { tagName: 'DIV', getAttribute: () => null };
  assert.equal(keyStep({ key: 'ArrowRight', target: body }), 1);
  assert.equal(keyStep({ key: 'ArrowLeft', target: body }), -1);
  assert.equal(keyStep({ key: 'ArrowRight', target: { tagName: 'TEXTAREA' } }), 0);
  assert.equal(keyStep({ key: 'ArrowRight', target: { tagName: 'INPUT' } }), 0);
  assert.equal(keyStep({ key: 'ArrowRight', target: { tagName: 'DIV', isContentEditable: true } }), 0);
  assert.equal(keyStep({ key: 'ArrowRight', target: body, metaKey: true }), 0);
  assert.equal(keyStep({ key: 'ArrowRight', target: body, defaultPrevented: true }), 0);
  assert.equal(keyStep({ key: 'a', target: body }), 0);
  assert.equal(isTypingTarget(null), false);
});

test('targetAfterDecide: replacement wins, else the next slot, else null', () => {
  assert.equal(targetAfterDecide(['a', 'b', 'c'], 'b', 'z'), 'z');
  assert.equal(targetAfterDecide(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(targetAfterDecide(['a', 'b', 'c'], 'c'), 'a');
  assert.equal(targetAfterDecide(['a', 'b'], 'a', 'a'), 'b');
  assert.equal(targetAfterDecide(['a'], 'a'), null);
  assert.equal(targetAfterDecide([], 'a'), null);
});
