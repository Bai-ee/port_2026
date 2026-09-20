// HoloPaper handoff §3 — useInvoicePresentation.js's storage layer, tested
// directly against the exported pure functions (no window/DOM in this
// repo's plain node:test runner — same constraint/pattern as
// draft-storage.test.js). The React hook itself (state wiring, the
// "Holo off forces interaction off" rule) is verified by hand in a real
// browser once a later phase actually renders it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readStoredPresentation, writeStoredPresentation, PRESENTATION_STORAGE_KEY,
  PRESENTATION_STORAGE_VERSION, SCENE_STATUS,
} from '../useInvoicePresentation.js';

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _store: store,
  };
}

function withFakeWindow(fn) {
  const previous = globalThis.window;
  const fakeLocalStorage = makeFakeLocalStorage();
  globalThis.window = { localStorage: fakeLocalStorage };
  try {
    return fn(fakeLocalStorage);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test('readStoredPresentation() with nothing stored -> null', () => {
  withFakeWindow(() => {
    assert.equal(readStoredPresentation(), null);
  });
});

test('readStoredPresentation() with no window/localStorage -> null (never throws)', () => {
  const previous = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(readStoredPresentation(), null);
  } finally {
    if (previous !== undefined) globalThis.window = previous;
  }
});

test('writeStoredPresentation then readStoredPresentation round-trips holoEnabled under its own v1 key', () => {
  withFakeWindow((ls) => {
    writeStoredPresentation(true);
    const raw = JSON.parse(ls.getItem(PRESENTATION_STORAGE_KEY));
    assert.equal(raw.v, PRESENTATION_STORAGE_VERSION);
    assert.equal(raw.holoEnabled, true);
    assert.deepEqual(readStoredPresentation(), { holoEnabled: true });
  });
});

test('the presentation key is separate from the invoice draft key — never bumps/reshapes draft storage', () => {
  assert.equal(PRESENTATION_STORAGE_KEY, 'invoice-studio-presentation-v1');
  assert.notEqual(PRESENTATION_STORAGE_KEY, 'invoice-studio-draft-v2');
});

test('readStoredPresentation() rejects a mismatched version or corrupt payload', () => {
  withFakeWindow((ls) => {
    ls.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify({ v: 99, holoEnabled: true }));
    assert.equal(readStoredPresentation(), null);
    ls.setItem(PRESENTATION_STORAGE_KEY, 'not json');
    assert.equal(readStoredPresentation(), null);
  });
});

test('writeStoredPresentation() coerces a non-boolean to a real boolean', () => {
  withFakeWindow((ls) => {
    writeStoredPresentation('yes');
    const raw = JSON.parse(ls.getItem(PRESENTATION_STORAGE_KEY));
    assert.equal(raw.holoEnabled, false);
  });
});

test('SCENE_STATUS exposes exactly the four documented states', () => {
  assert.deepEqual(Object.values(SCENE_STATUS).sort(), ['fallback', 'idle', 'loading', 'ready']);
});
