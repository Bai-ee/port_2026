// Invoice Studio design-layer plan Q2/Lane C — book.js's local saved
// clients/items storage (design-layer plan §3.5, L12). Same in-memory
// localStorage fake / withFakeWindow idiom as ../draft-storage.test.js
// (this repo's plain node:test runner has no jsdom/window).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readBook, listClients, listItems, saveClient, saveItem, deleteClient, deleteItem, toDraftItem, BOOK_CHANGE_EVENT,
} from '../book.js';

function makeFakeLocalStorage({ throwOnSet = false } = {}) {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(k, String(v));
    },
    removeItem: (k) => { store.delete(k); },
    _store: store,
  };
}

function withFakeWindow(fn, opts) {
  const previous = globalThis.window;
  const fakeLocalStorage = makeFakeLocalStorage(opts);
  globalThis.window = { localStorage: fakeLocalStorage };
  try {
    return fn(fakeLocalStorage);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

// ── Read with nothing stored ────────────────────────────────────────────

test('readBook() with nothing stored -> empty {clients:[], items:[]}, never throws', () => {
  withFakeWindow(() => {
    assert.deepEqual(readBook(), { clients: [], items: [] });
    assert.deepEqual(listClients(), []);
    assert.deepEqual(listItems(), []);
  });
});

// ── Save a new client/item ──────────────────────────────────────────────

test('saveClient() with a new name -> appears in the list with a generated id and updatedAt', () => {
  withFakeWindow(() => {
    const saved = saveClient({ name: 'Acme Co', contact: 'Jane', email: 'jane@acme.com', address: '1 Main St' });
    assert.ok(saved);
    assert.ok(saved.id);
    assert.ok(Number.isFinite(saved.updatedAt));
    assert.equal(saved.name, 'Acme Co');

    const list = listClients();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, saved.id);
    assert.equal(list[0].contact, 'Jane');
  });
});

test('saveItem() with a new name -> appears in the list with a generated id and updatedAt', () => {
  withFakeWindow(() => {
    const saved = saveItem({ name: 'Consulting', note: 'Hourly', qty: 2, unitPrice: 150, costLabel: '' });
    assert.ok(saved);
    assert.ok(saved.id);
    assert.ok(Number.isFinite(saved.updatedAt));

    const list = listItems();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, saved.id);
    assert.equal(list[0].qty, 2);
    assert.equal(list[0].unitPrice, 150);
  });
});

test('saveClient()/saveItem() with a blank name -> null, nothing stored', () => {
  withFakeWindow(() => {
    assert.equal(saveClient({ name: '   ' }), null);
    assert.equal(saveItem({ name: '' }), null);
    assert.deepEqual(readBook(), { clients: [], items: [] });
  });
});

// ── Dedupe / update-in-place ────────────────────────────────────────────

test('saving a client that dedupe-matches an existing one (case/whitespace-insensitive name) updates in place', () => {
  withFakeWindow(() => {
    const first = saveClient({ name: 'Acme Co', contact: 'Jane', email: 'jane@acme.com', address: 'Old address' });
    const second = saveClient({ name: '  acme co  ', contact: 'Jane B.', email: 'jane@acme.com', address: 'New address' });

    assert.equal(second.id, first.id);
    assert.ok(second.updatedAt >= first.updatedAt);

    const list = listClients();
    assert.equal(list.length, 1);
    assert.equal(list[0].contact, 'Jane B.');
    assert.equal(list[0].address, 'New address');
  });
});

test('saving an item that dedupe-matches an existing one by name updates in place (price/qty change does not fork a duplicate)', () => {
  withFakeWindow(() => {
    const first = saveItem({ name: 'Consulting', qty: 1, unitPrice: 100 });
    const second = saveItem({ name: 'Consulting', qty: 3, unitPrice: 175, costLabel: 'Included' });

    assert.equal(second.id, first.id);
    const list = listItems();
    assert.equal(list.length, 1);
    assert.equal(list[0].qty, 3);
    assert.equal(list[0].unitPrice, 175);
    assert.equal(list[0].costLabel, 'Included');
  });
});

// ── Delete ───────────────────────────────────────────────────────────────

test('deleteClient() removes only the targeted client; everything else unaffected', () => {
  withFakeWindow(() => {
    const a = saveClient({ name: 'Acme Co' });
    const b = saveClient({ name: 'Beta LLC' });
    saveItem({ name: 'Consulting', qty: 1, unitPrice: 100 });

    deleteClient(a.id);

    const clients = listClients();
    assert.equal(clients.length, 1);
    assert.equal(clients[0].id, b.id);
    assert.equal(listItems().length, 1);
  });
});

test('deleteItem() removes only the targeted item; everything else unaffected', () => {
  withFakeWindow(() => {
    saveClient({ name: 'Acme Co' });
    const i1 = saveItem({ name: 'Consulting', qty: 1, unitPrice: 100 });
    const i2 = saveItem({ name: 'Design', qty: 2, unitPrice: 80 });

    deleteItem(i1.id);

    const items = listItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, i2.id);
    assert.equal(listClients().length, 1);
  });
});

test('deleteClient()/deleteItem() on an unknown id is a no-op, never throws', () => {
  withFakeWindow(() => {
    saveClient({ name: 'Acme Co' });
    deleteClient('does-not-exist');
    deleteItem('does-not-exist');
    assert.equal(listClients().length, 1);
    assert.equal(listItems().length, 0);
  });
});

// ── Failure modes: quota-exceeded / corrupt JSON / no window ────────────

test('quota-exceeded on write -> saveClient()/saveItem() still return a record, never throw, and readBook() stays safe', () => {
  withFakeWindow(() => {
    assert.doesNotThrow(() => {
      const c = saveClient({ name: 'Acme Co' });
      assert.ok(c);
      const it = saveItem({ name: 'Consulting' });
      assert.ok(it);
    });
    // The write itself failed silently — nothing persisted this "session".
    assert.deepEqual(readBook(), { clients: [], items: [] });
    assert.doesNotThrow(() => { deleteClient('x'); deleteItem('x'); });
  }, { throwOnSet: true });
});

test('corrupt JSON in storage -> readBook()/listClients()/listItems() fall back to empty, never throw', () => {
  withFakeWindow((ls) => {
    ls._store.set('invoice-studio-book-v1', 'not json{{{');
    assert.doesNotThrow(() => {
      assert.deepEqual(readBook(), { clients: [], items: [] });
      assert.deepEqual(listClients(), []);
      assert.deepEqual(listItems(), []);
    });
    // A subsequent save still works normally (overwrites the corrupt blob).
    const saved = saveClient({ name: 'Acme Co' });
    assert.ok(saved);
    assert.equal(listClients().length, 1);
  });
});

test('unrecognized book version in storage -> treated as empty, never throws', () => {
  withFakeWindow((ls) => {
    ls.setItem('invoice-studio-book-v1', JSON.stringify({ v: 99, clients: [{ id: 'x', name: 'Stale' }], items: [] }));
    assert.deepEqual(readBook(), { clients: [], items: [] });
  });
});

test('no window/localStorage present -> every function returns a safe fallback, never throws', () => {
  const previous = globalThis.window;
  delete globalThis.window;
  try {
    assert.doesNotThrow(() => {
      assert.deepEqual(readBook(), { clients: [], items: [] });
      assert.deepEqual(listClients(), []);
      assert.deepEqual(listItems(), []);
      // saveClient/saveItem still compute + return a record even though the
      // write itself is a silent no-op with no window to persist to.
      const c = saveClient({ name: 'Acme Co' });
      assert.ok(c && c.id);
      const it = saveItem({ name: 'Consulting' });
      assert.ok(it && it.id);
      deleteClient('x');
      deleteItem('x');
    });
  } finally {
    if (previous !== undefined) globalThis.window = previous;
  }
});

// ── Round-trip ───────────────────────────────────────────────────────────

test('round-trip: several clients/items survive a save-then-re-read as the exact full set', () => {
  withFakeWindow(() => {
    const names = ['Acme Co', 'Beta LLC', 'Gamma Inc'];
    names.forEach((name) => saveClient({ name, contact: `${name} contact` }));
    const itemNames = ['Consulting', 'Design', 'Support Retainer'];
    itemNames.forEach((name, i) => saveItem({ name, qty: i + 1, unitPrice: 50 * (i + 1) }));

    const clients = listClients();
    const items = listItems();
    assert.equal(clients.length, 3);
    assert.equal(items.length, 3);
    assert.deepEqual(new Set(clients.map((c) => c.name)), new Set(names));
    assert.deepEqual(new Set(items.map((it) => it.name)), new Set(itemNames));

    // Re-read again (simulating a fresh load) — same full set.
    const clients2 = listClients();
    const items2 = listItems();
    assert.deepEqual(new Set(clients2.map((c) => c.id)), new Set(clients.map((c) => c.id)));
    assert.deepEqual(new Set(items2.map((it) => it.id)), new Set(items.map((it) => it.id)));
  });
});

// ── BOOK_CHANGE_EVENT (cross-card sync) ─────────────────────────────────
// BillToCard/LineItemsCard/StandaloneItemsCard are separate component
// instances that each load their own picker list once on mount — this event
// is what lets a save/delete in one card show up in another without a page
// reload (see book.js's own doc comment). `window` here needs a real
// EventTarget (Node's global one) rather than the plain-object fake the
// other tests use, since it must support addEventListener/dispatchEvent.

function withFakeEventWindow(fn) {
  const previous = globalThis.window;
  const fakeLocalStorage = makeFakeLocalStorage();
  class FakeWindow extends EventTarget {}
  const fakeWindow = new FakeWindow();
  fakeWindow.localStorage = fakeLocalStorage;
  globalThis.window = fakeWindow;
  try {
    return fn(fakeWindow);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test('saveClient() fires BOOK_CHANGE_EVENT on window after a successful write', () => {
  withFakeEventWindow((win) => {
    let fired = 0;
    win.addEventListener(BOOK_CHANGE_EVENT, () => { fired += 1; });
    saveClient({ name: 'Acme Co' });
    assert.equal(fired, 1);
  });
});

test('saveItem()/deleteClient()/deleteItem() each fire BOOK_CHANGE_EVENT on window', () => {
  withFakeEventWindow((win) => {
    let fired = 0;
    win.addEventListener(BOOK_CHANGE_EVENT, () => { fired += 1; });
    const c = saveClient({ name: 'Acme Co' });
    const it = saveItem({ name: 'Consulting' });
    deleteClient(c.id);
    deleteItem(it.id);
    assert.equal(fired, 4);
  });
});

test('a blank-name saveClient()/saveItem() (no-op write) does not fire BOOK_CHANGE_EVENT', () => {
  withFakeEventWindow((win) => {
    let fired = 0;
    win.addEventListener(BOOK_CHANGE_EVENT, () => { fired += 1; });
    saveClient({ name: '  ' });
    saveItem({ name: '' });
    assert.equal(fired, 0);
  });
});

// ── toDraftItem() ────────────────────────────────────────────────────────

test('toDraftItem() builds a draft-shaped row with computed total (qty * unitPrice)', () => {
  const row = toDraftItem({ name: 'Consulting', note: 'Hourly', qty: 3, unitPrice: 150, costLabel: '' });
  assert.ok(row.id);
  assert.equal(row.name, 'Consulting');
  assert.equal(row.note, 'Hourly');
  assert.equal(row.qty, 3);
  assert.equal(row.unitPrice, 150);
  assert.equal(row.total, 450);
  assert.equal(row.costLabel, '');
  assert.deepEqual(row.subItems, []);
});

test('toDraftItem() respects a costLabel override (total is not the qty*price product)', () => {
  const row = toDraftItem({ name: 'Retainer', qty: 1, unitPrice: 999, costLabel: 'Included' });
  assert.equal(row.costLabel, 'Included');
  assert.equal(row.total, 0);
});

test('toDraftItem() mints a distinct id per call', () => {
  const a = toDraftItem({ name: 'X' });
  const b = toDraftItem({ name: 'X' });
  assert.notEqual(a.id, b.id);
});
