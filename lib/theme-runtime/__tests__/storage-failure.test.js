import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefStore } from '../pref-store.js';
import { createSafeStorage } from '../storage.js';
import { createDraftStore } from '../draft-store.js';
import {
  createFakeDocument, createFakeStorage, createManualScheduler, createFakeMatchMedia, createFakeWindow, createFakeSceneBridge,
} from './helpers.js';

test('createSafeStorage: getItem/setItem/removeItem throwing never throws and flips available', () => {
  const failures = [];
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('y'); }, removeItem() { throw new Error('z'); } };
  const s = createSafeStorage(bad, { onFail: (e) => failures.push(e.message) });
  assert.equal(s.available, true);
  assert.equal(s.get('k'), null);
  assert.equal(s.available, false);
  assert.equal(s.set('k', 'v'), false);
  assert.equal(s.remove('k'), false);
  assert.equal(failures.length, 1, 'onFail fires once');
});

test('createSafeStorage: accessor that throws (blocked site data) is contained', () => {
  const s = createSafeStorage(() => { throw new DOMException('denied', 'SecurityError'); });
  assert.equal(s.get('k'), null);
  assert.equal(s.set('k', 'v'), false);
  assert.equal(s.available, false);
});

test('createSafeStorage: null storage (SSR) is contained', () => {
  const s = createSafeStorage(() => null);
  assert.equal(s.get('k'), null);
  assert.equal(s.available, false);
});

test('pref store: getItem throws at init -> default preference, storageAvailable false, no throw', () => {
  const storage = createFakeStorage();
  storage.failGet = true;
  const store = createPrefStore({
    document: createFakeDocument(), storage, scheduler: createManualScheduler(),
    win: createFakeWindow(), matchMedia: createFakeMatchMedia(false), defaultPreference: 'light',
  });
  assert.equal(store.getSnapshot().preference, 'light');
  assert.equal(store.getSnapshot().storageAvailable, false);
});

test('pref store: setItem throws -> preference still applies in-memory and on <html>', () => {
  const storage = createFakeStorage();
  storage.failSet = true;
  const doc = createFakeDocument();
  const scheduler = createManualScheduler();
  const store = createPrefStore({
    document: doc, storage, scheduler, win: createFakeWindow(), matchMedia: createFakeMatchMedia(false), defaultPreference: 'light',
  });
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  assert.doesNotThrow(() => store.setPreference('dark'));
  scheduler.frame();
  assert.equal(store.getSnapshot().preference, 'dark');
  assert.equal(store.getSnapshot().storageAvailable, false);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.ok(notified >= 1);
});

test('pref store: storage accessor throws entirely', () => {
  const store = createPrefStore({
    document: createFakeDocument(), storage: () => { throw new Error('blocked'); }, scheduler: createManualScheduler(),
    win: createFakeWindow(), matchMedia: createFakeMatchMedia(true), defaultPreference: 'system',
  });
  assert.equal(store.getSnapshot().preference, 'system');
  assert.equal(store.getSnapshot().resolvedMode, 'dark');
  assert.doesNotThrow(() => store.setPreference('light'));
  assert.equal(store.getSnapshot().storageAvailable, false);
});

test('pref store: matchMedia missing or throwing -> treated as light', () => {
  for (const mm of [null, () => { throw new Error('nope'); }]) {
    const store = createPrefStore({
      document: createFakeDocument(), storage: createFakeStorage(), scheduler: createManualScheduler(),
      win: createFakeWindow(), matchMedia: mm, defaultPreference: 'system',
    });
    assert.equal(store.getSnapshot().resolvedMode, 'light');
  }
});

test('draft store: writes failing -> storageAvailable false, saveDraft reports it, nothing throws', () => {
  const storage = createFakeStorage();
  const scheduler = createManualScheduler();
  const store = createDraftStore({
    storage, scheduler, document: createFakeDocument(), win: null, ChannelCtor: null,
    getSceneBridge: () => createFakeSceneBridge(),
  });
  store.startDraft();
  storage.failSet = true;
  store.updateDraft((d) => ({ ...d, master: { ...d.master, hue: 10 } }));
  assert.doesNotThrow(() => scheduler.advance(500));
  assert.equal(store.getSnapshot().storageAvailable, false);
  const res = store.saveDraft();
  assert.equal(res.ok, false);
  assert.match(res.error, /storage/i);
  assert.equal(store.getSnapshot().dirty, true, 'a failed save leaves the draft dirty');
  assert.equal(store.getSnapshot().draft.master.hue, 10, 'in-memory draft is intact');
});
