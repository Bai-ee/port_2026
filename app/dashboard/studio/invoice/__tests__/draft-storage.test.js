// Invoice Studio design-layer plan Q0 — useInvoiceDraft.js's storage/v1->v2
// migration logic (design-layer plan §3.4). Tested directly against the
// exported pure storage functions (no window/DOM in this repo's plain
// node:test runner — see package.json's "test" script) rather than through
// the React hook itself, which needs a renderer this repo doesn't wire up
// for node:test. A minimal in-memory localStorage fake is installed on
// `globalThis.window` for the duration of each test and removed after.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readStoredDraft, writeStoredDraft, clearStoredDraft, migrateV1ToV2, STORAGE_KEY_V1, STORAGE_KEY_V2,
} from '../useInvoiceDraft.js';

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

test('readStoredDraft() with nothing stored -> null', () => {
  withFakeWindow(() => {
    assert.equal(readStoredDraft(), null);
  });
});

test('writeStoredDraft then readStoredDraft round-trips invoice/sections/theme under the v2 key', () => {
  withFakeWindow((ls) => {
    const invoice = { invoiceNumber: 'INV-1' };
    const sections = { include: { cover: true }, order: ['cover'] };
    const theme = { id: 'ledger' };
    writeStoredDraft(invoice, sections, theme);
    const raw = JSON.parse(ls.getItem(STORAGE_KEY_V2));
    assert.equal(raw.v, 2);
    assert.deepEqual(raw.invoice, invoice);
    assert.deepEqual(raw.sections, sections);
    assert.deepEqual(raw.theme, theme);

    const stored = readStoredDraft();
    assert.deepEqual(stored.invoice, invoice);
    assert.deepEqual(stored.sections, sections);
    // normalizeTheme() only trusts a known builtin id — 'ledger' round-trips
    // as the CANONICAL preset object (theme-schema.test.js pins this
    // identity), not the bare {id:'ledger'} that was written.
    assert.equal(stored.theme.id, 'ledger');
    assert.ok(stored.theme.colors);
  });
});

test('writeStoredDraft(invoice, sections, null) -> readStoredDraft() theme is null (Default)', () => {
  withFakeWindow(() => {
    writeStoredDraft({ invoiceNumber: 'INV-2' }, { include: {}, order: [] }, null);
    const stored = readStoredDraft();
    assert.equal(stored.theme, null);
  });
});

test('a v1 draft migrates to v2 with theme:null, and v1 is removed only after the v2 write', () => {
  withFakeWindow((ls) => {
    const v1Invoice = { invoiceNumber: 'INV-LEGACY' };
    const v1Sections = { include: { cover: true }, order: ['cover'] };
    ls.setItem(STORAGE_KEY_V1, JSON.stringify({ v: 1, invoice: v1Invoice, sections: v1Sections, savedAt: 1 }));

    assert.equal(ls.getItem(STORAGE_KEY_V2), null);
    const stored = readStoredDraft();
    assert.deepEqual(stored.invoice, v1Invoice);
    assert.deepEqual(stored.sections, v1Sections);
    assert.equal(stored.theme, null);

    // v2 now exists...
    const v2Raw = JSON.parse(ls.getItem(STORAGE_KEY_V2));
    assert.equal(v2Raw.v, 2);
    assert.equal(v2Raw.theme, null);
    assert.deepEqual(v2Raw.invoice, v1Invoice);
    // ...and only NOW is v1 gone.
    assert.equal(ls.getItem(STORAGE_KEY_V1), null);
  });
});

test('migrateV1ToV2() is a no-op once v2 already exists (readStoredDraft never re-migrates)', () => {
  withFakeWindow((ls) => {
    ls.setItem(STORAGE_KEY_V1, JSON.stringify({ v: 1, invoice: { invoiceNumber: 'STALE' }, sections: null, savedAt: 1 }));
    writeStoredDraft({ invoiceNumber: 'CURRENT' }, { include: {}, order: [] }, null);
    const stored = readStoredDraft();
    assert.equal(stored.invoice.invoiceNumber, 'CURRENT');
    // v1 is untouched — readStoredDraft() only calls migrateV1ToV2() when v2
    // is absent, and it was not.
    assert.notEqual(ls.getItem(STORAGE_KEY_V1), null);
  });
});

test('migrateV1ToV2() ignores a malformed/legacy-shaped v1 blob without throwing', () => {
  withFakeWindow((ls) => {
    ls.setItem(STORAGE_KEY_V1, 'not json');
    assert.equal(migrateV1ToV2(), null);
    assert.equal(readStoredDraft(), null);

    ls.setItem(STORAGE_KEY_V1, JSON.stringify({ v: 1 })); // no `invoice`
    assert.equal(migrateV1ToV2(), null);
  });
});

test('clearStoredDraft() removes both the v2 key and any leftover v1 key', () => {
  withFakeWindow((ls) => {
    ls.setItem(STORAGE_KEY_V1, JSON.stringify({ v: 1, invoice: {}, sections: null }));
    writeStoredDraft({ invoiceNumber: 'X' }, { include: {}, order: [] }, null);
    clearStoredDraft();
    assert.equal(ls.getItem(STORAGE_KEY_V1), null);
    assert.equal(ls.getItem(STORAGE_KEY_V2), null);
    assert.equal(readStoredDraft(), null);
  });
});

test('readStoredDraft() never throws with no window/localStorage present', () => {
  const previous = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(readStoredDraft(), null);
  } finally {
    if (previous !== undefined) globalThis.window = previous;
  }
});
