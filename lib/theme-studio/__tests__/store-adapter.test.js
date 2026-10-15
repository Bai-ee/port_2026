import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioStore, normalizeSnapshot, EMPTY_SNAPSHOT } from '../store-adapter.js';

test('a missing store degrades to no-ops without throwing', () => {
  const s = createStudioStore(null);
  assert.equal(s.getSnapshot(), EMPTY_SNAPSHOT);
  assert.equal(typeof s.subscribe(() => {}), 'function');
  assert.doesNotThrow(() => { s.updateDraft(() => {}); s.undo(); s.commitTransient(); s.setCompare('production'); });
  assert.equal(s.has('undo'), false);
});

test('partial snapshots are filled with defaults and stay referentially stable', () => {
  const raw = { getSnapshot: () => snap, subscribe: () => () => {}, undo: () => 'u' };
  const snap = { draft: { x: 1 }, dirty: true };
  const s = createStudioStore(raw);
  const a = s.getSnapshot();
  assert.equal(a.dirty, true);
  assert.equal(a.canUndo, false);
  assert.equal(a.editingMode, 'light');
  assert.equal(s.getSnapshot(), a);
  assert.equal(s.undo(), 'u');
  assert.equal(s.has('undo'), true);
  assert.equal(s.redo(), undefined);
});

test('bad editingMode is corrected; server snapshot falls back to getSnapshot', () => {
  assert.equal(normalizeSnapshot({ editingMode: 'sepia' }).editingMode, 'light');
  const s = createStudioStore({ getSnapshot: () => ({ editingMode: 'dark' }) });
  assert.equal(s.getServerSnapshot().editingMode, 'dark');
});
