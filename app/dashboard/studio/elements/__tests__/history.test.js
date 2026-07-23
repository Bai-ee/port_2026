import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, pushHistory, undoHistory, redoHistory } from '../history.js';

test('createHistory: starts empty', () => {
  assert.deepEqual(createHistory(), { undo: [], redo: [] });
});

test('pushHistory: appends to undo, clears redo', () => {
  let h = createHistory();
  h = pushHistory(h, { a: 1 });
  h = { ...h, redo: [{ stale: true }] }; // simulate a prior undo having populated redo
  h = pushHistory(h, { a: 2 });
  assert.deepEqual(h.undo, [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(h.redo, []);
});

test('pushHistory: caps the undo stack, dropping the oldest entry', () => {
  let h = createHistory();
  for (let i = 0; i < 5; i += 1) h = pushHistory(h, { i }, 3);
  assert.deepEqual(h.undo, [{ i: 2 }, { i: 3 }, { i: 4 }]);
});

test('undoHistory: no-ops with a null snapshot when undo is empty', () => {
  const h = createHistory();
  const result = undoHistory(h, { current: true });
  assert.equal(result.snapshot, null);
  assert.equal(result.history, h); // unchanged reference
});

test('redoHistory: no-ops with a null snapshot when redo is empty', () => {
  const h = createHistory();
  const result = redoHistory(h, { current: true });
  assert.equal(result.snapshot, null);
  assert.equal(result.history, h);
});

test('undoHistory then redoHistory round-trips back to the same current snapshot', () => {
  let h = createHistory();
  h = pushHistory(h, { a: 'before' });
  const current = { a: 'after' };

  const undone = undoHistory(h, current);
  assert.deepEqual(undone.snapshot, { a: 'before' });
  assert.deepEqual(undone.history.redo, [{ a: 'after' }]);
  assert.deepEqual(undone.history.undo, []);

  const redone = redoHistory(undone.history, undone.snapshot);
  assert.deepEqual(redone.snapshot, { a: 'after' });
  assert.deepEqual(redone.history.undo, [{ a: 'before' }]);
  assert.deepEqual(redone.history.redo, []);
});

test('multiple undo/redo steps preserve order (LIFO)', () => {
  let h = createHistory();
  h = pushHistory(h, { step: 1 });
  h = pushHistory(h, { step: 2 });
  let current = { step: 3 };

  let r = undoHistory(h, current);
  assert.deepEqual(r.snapshot, { step: 2 });
  h = r.history; current = r.snapshot;

  r = undoHistory(h, current);
  assert.deepEqual(r.snapshot, { step: 1 });
  h = r.history; current = r.snapshot;

  r = undoHistory(h, current); // nothing left to undo
  assert.equal(r.snapshot, null);
});
