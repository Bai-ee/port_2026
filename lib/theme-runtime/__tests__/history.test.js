import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, HISTORY_CAP, COALESCE_MS } from '../history.js';

const clock = () => { let t = 0; return { now: () => t, advance: (ms) => { t += ms; } }; };
const d = (n) => ({ n });

test('defaults match the contract (cap 100, coalesce window 400 ms)', () => {
  assert.equal(HISTORY_CAP, 100);
  assert.equal(COALESCE_MS, 400);
});

test('reset seeds a single entry: nothing to undo or redo', () => {
  const h = createHistory();
  h.reset(d(0));
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.current().n, 0);
});

test('push / undo / redo walk the list; pushing after undo drops the redo branch', () => {
  const h = createHistory();
  h.reset(d(0));
  h.push(d(1)); h.push(d(2));
  assert.equal(h.current().n, 2);
  assert.equal(h.undo().n, 1);
  assert.equal(h.undo().n, 0);
  assert.equal(h.undo(), null);
  assert.equal(h.redo().n, 1);
  h.push(d(9));
  assert.equal(h.canRedo, false);
  assert.equal(h.current().n, 9);
  assert.equal(h.undo().n, 1);
});

test('pushing the same object is a no-op', () => {
  const h = createHistory();
  const a = d(0);
  h.reset(a);
  assert.equal(h.push(a), 'noop');
  assert.equal(h.size, 1);
});

test('keyboard coalescing: same key within 400 ms merges into one entry', () => {
  const c = clock();
  const h = createHistory({ now: c.now });
  h.reset(d(0));
  assert.equal(h.push(d(1), { coalesceKey: 'hue' }), 'pushed');
  c.advance(100);
  assert.equal(h.push(d(2), { coalesceKey: 'hue' }), 'coalesced');
  c.advance(399);
  assert.equal(h.push(d(3), { coalesceKey: 'hue' }), 'coalesced', 'window slides with each press');
  assert.equal(h.size, 2);
  assert.equal(h.current().n, 3);
  assert.equal(h.undo().n, 0, 'one undo reverts all merged presses');
});

test('coalescing does not merge past 400 ms, across keys, or without a key', () => {
  const c = clock();
  const h = createHistory({ now: c.now });
  h.reset(d(0));
  h.push(d(1), { coalesceKey: 'hue' });
  c.advance(401);
  assert.equal(h.push(d(2), { coalesceKey: 'hue' }), 'pushed');
  c.advance(10);
  assert.equal(h.push(d(3), { coalesceKey: 'intensity' }), 'pushed');
  c.advance(10);
  assert.equal(h.push(d(4)), 'pushed');
  c.advance(10);
  assert.equal(h.push(d(5)), 'pushed');
  assert.equal(h.size, 6);
});

test('undo/redo breaks a coalescing run', () => {
  const c = clock();
  const h = createHistory({ now: c.now });
  h.reset(d(0));
  h.push(d(1), { coalesceKey: 'k' });
  h.undo();
  h.redo();
  c.advance(10);
  assert.equal(h.push(d(2), { coalesceKey: 'k' }), 'pushed');
});

test('cap: 100 undo steps are kept, the oldest are dropped', () => {
  const h = createHistory();
  h.reset(d(0));
  for (let i = 1; i <= 150; i += 1) h.push(d(i));
  assert.equal(h.size, 101);
  let undos = 0;
  while (h.undo()) undos += 1;
  assert.equal(undos, 100);
  assert.equal(h.current().n, 50, 'entries 0..49 were dropped');
});
