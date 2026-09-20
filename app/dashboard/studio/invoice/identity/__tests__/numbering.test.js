// Invoice Studio design-layer plan Q2, Lane B — numbering.js. Tested against
// a fake window.localStorage (this repo's node:test runner has no DOM — see
// draft-storage.test.js for the same pattern this mirrors).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reserveNextNumber, readNumberingStore, getRecentNumbers, isDuplicateNumber,
  formatNumberFromPattern, bucketKey, NUMBERING_STORAGE_KEY,
} from '../numbering.js';

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

test('readNumberingStore() with nothing stored -> empty v1 shape', () => {
  withFakeWindow(() => {
    const store = readNumberingStore();
    assert.equal(store.v, 1);
    assert.deepEqual(store.counters, {});
    assert.deepEqual(store.recent, []);
  });
});

test('formatNumberFromPattern renders YYYY/YY/MM/seq:N tokens', () => {
  const now = new Date();
  const year = String(now.getFullYear());
  assert.equal(formatNumberFromPattern('INV-{YYYY}-{seq:3}', 7), `INV-${year}-007`);
  assert.equal(formatNumberFromPattern('{seq:1}', 42), '42');
  assert.equal(formatNumberFromPattern('{YY}', 1), year.slice(-2));
});

test('reserveNextNumber mints a sequential number and persists the counter', () => {
  withFakeWindow(() => {
    const first = reserveNextNumber('invoice', 'INV-{YYYY}-{seq:3}');
    const second = reserveNextNumber('invoice', 'INV-{YYYY}-{seq:3}');
    assert.notEqual(first, second);
    assert.ok(first.endsWith('-001'));
    assert.ok(second.endsWith('-002'));
  });
});

test('reserveNextNumber scopes counters by docKind + normalized pattern (§3.5 bucket key)', () => {
  withFakeWindow(() => {
    const invoiceNum = reserveNextNumber('invoice', 'INV-{seq:2}');
    const quoteNum = reserveNextNumber('quote', 'INV-{seq:2}');
    // Same pattern, different docKind -> independent counters, both start at 1.
    assert.ok(invoiceNum.endsWith('-01'));
    assert.ok(quoteNum.endsWith('-01'));

    const store = readNumberingStore();
    assert.equal(store.counters[bucketKey('invoice', 'INV-{seq:2}')], 1);
    assert.equal(store.counters[bucketKey('quote', 'INV-{seq:2}')], 1);
  });
});

test('reserveNextNumber falls back to "invoice" for an unknown docKind', () => {
  withFakeWindow(() => {
    const number = reserveNextNumber('bogus-kind', 'X-{seq:2}');
    const store = readNumberingStore();
    assert.ok(bucketKey('invoice', 'X-{seq:2}') in store.counters);
    assert.ok(number.endsWith('-01'));
  });
});

test('reserveNextNumber normalizes a malformed pattern via model.js before bucketing', () => {
  withFakeWindow(() => {
    // {bogus} is not a recognized token -> normalizeNumberPattern() falls
    // back to DEFAULT_NUMBER_PATTERN ('INV-{YYYY}-{seq:3}') before this
    // module ever buckets/persists anything, so a garbage pattern can't
    // silently mint its own permanent counter bucket.
    const number = reserveNextNumber('invoice', '{bogus}-{seq:2}');
    assert.match(number, /^INV-\d{4}-\d{3}$/);
  });
});

test('reserveNextNumber is idempotent-safe against back-to-back calls (never repeats)', () => {
  withFakeWindow(() => {
    const numbers = new Set();
    for (let i = 0; i < 5; i += 1) numbers.add(reserveNextNumber('invoice', 'R-{seq:2}'));
    assert.equal(numbers.size, 5);
  });
});

test('getRecentNumbers() returns most-recent first and reserveNextNumber persists docKind/createdAt', () => {
  withFakeWindow(() => {
    reserveNextNumber('invoice', 'A-{seq:2}');
    reserveNextNumber('quote', 'B-{seq:2}');
    const recent = getRecentNumbers();
    assert.equal(recent.length, 2);
    assert.equal(recent[0].docKind, 'quote');
    assert.equal(recent[1].docKind, 'invoice');
    assert.ok(Number.isFinite(recent[0].createdAt));
  });
});

test('isDuplicateNumber: false for a number that has never been reserved', () => {
  withFakeWindow(() => {
    assert.equal(isDuplicateNumber('NOPE-001'), false);
    assert.equal(isDuplicateNumber(''), false);
    assert.equal(isDuplicateNumber(null), false);
  });
});

test('isDuplicateNumber: false immediately after reserving that exact number (it is recent[0])', () => {
  withFakeWindow(() => {
    const number = reserveNextNumber('invoice', 'D-{seq:2}');
    assert.equal(isDuplicateNumber(number), false);
  });
});

test('isDuplicateNumber: true when the number matches an OLDER reservation, not the latest', () => {
  withFakeWindow(() => {
    const first = reserveNextNumber('invoice', 'E-{seq:2}');
    reserveNextNumber('invoice', 'E-{seq:2}'); // now recent[0], first is recent[1]
    assert.equal(isDuplicateNumber(first), true);
  });
});

test('reserveNextNumber persistence survives a fresh read (round-trips through the v1 storage key)', () => {
  withFakeWindow((ls) => {
    reserveNextNumber('invoice', 'P-{seq:2}');
    const raw = JSON.parse(ls.getItem(NUMBERING_STORAGE_KEY));
    assert.equal(raw.v, 1);
    assert.equal(typeof raw.counters, 'object');
    assert.equal(raw.recent.length, 1);
  });
});

test('readNumberingStore() never throws with no window/localStorage present', () => {
  const previous = globalThis.window;
  delete globalThis.window;
  try {
    assert.deepEqual(readNumberingStore(), { v: 1, counters: {}, recent: [] });
    // reserveNextNumber must still return a usable number even when storage
    // is unavailable — persistence is best-effort, the reservation itself
    // is not.
    const number = reserveNextNumber('invoice', 'NOSTORE-{seq:2}');
    assert.match(number, /^NOSTORE-01$/);
  } finally {
    if (previous !== undefined) globalThis.window = previous;
  }
});
