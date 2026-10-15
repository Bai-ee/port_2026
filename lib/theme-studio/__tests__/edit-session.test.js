import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditSession } from '../edit-session.js';

function fakeStore() {
  const calls = [];
  return {
    calls,
    updateDraft: (fn, opts) => calls.push(['update', opts]),
    commitTransient: () => calls.push(['commit']),
  };
}

test('a drag of many input events is transient and produces exactly one commit', () => {
  const store = fakeStore();
  const s = createEditSession(store);
  for (let i = 0; i < 25; i++) s.apply((d) => d, { kind: 'drag', label: 'master-hue' });
  assert.equal(s.isOpen, true);
  assert.equal(store.calls.filter((c) => c[0] === 'update').length, 25);
  assert.ok(store.calls.every((c) => c[0] !== 'update' || c[1].transient === true));
  assert.equal(store.calls.filter((c) => c[0] === 'commit').length, 0);
  assert.equal(s.end(), true);
  assert.equal(store.calls.filter((c) => c[0] === 'commit').length, 1);
  assert.equal(s.end(), false, 'blur after pointerup must not commit twice');
  assert.equal(store.calls.filter((c) => c[0] === 'commit').length, 1);
});

test('keyboard nudges coalesce through a key and never open a transient', () => {
  const store = fakeStore();
  const s = createEditSession(store);
  s.apply((d) => d, { kind: 'key', coalesceKey: 'master-hue' });
  s.apply((d) => d, { kind: 'key', coalesceKey: 'master-hue' });
  assert.deepEqual(store.calls.map((c) => c[1] && c[1].coalesceKey), ['master-hue', 'master-hue']);
  assert.ok(store.calls.every((c) => !c[1] || !c[1].transient));
  assert.equal(s.end(), false);
  assert.equal(store.calls.some((c) => c[0] === 'commit'), false);
});

test('a discrete edit during an open drag closes the drag first', () => {
  const store = fakeStore();
  const s = createEditSession(store);
  s.apply((d) => d, { kind: 'drag' });
  s.apply((d) => d, { kind: 'set', label: 'hex' });
  assert.deepEqual(store.calls.map((c) => c[0]), ['update', 'commit', 'update']);
  assert.equal(s.isOpen, false);
});
