import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefStore, DEFAULT_PREFERENCE } from '../pref-store.js';
import { STORAGE_KEYS } from '../../theme/constants.js';
import {
  createFakeDocument, createFakeStorage, createManualScheduler, createFakeMatchMedia, createFakeWindow,
} from './helpers.js';

function make(over = {}) {
  const doc = over.document || createFakeDocument();
  const storage = over.storage || createFakeStorage();
  const scheduler = over.scheduler || createManualScheduler();
  const win = over.win || createFakeWindow();
  const mm = over.matchMedia || createFakeMatchMedia(false);
  const store = createPrefStore({
    document: doc, storage, scheduler, win, matchMedia: mm, defaultPreference: over.defaultPreference || 'light',
  });
  return { store, doc, storage, scheduler, win, mm };
}

test('production default preference is dark (owner flip of contract D5, 2026-10-17)', () => {
  assert.equal(DEFAULT_PREFERENCE, 'dark');
});

test('initial value: data-theme-pref attribute wins over storage and default', () => {
  const doc = createFakeDocument();
  doc.documentElement.setAttribute('data-theme-pref', 'dark');
  const { store } = make({ document: doc, storage: createFakeStorage({ [STORAGE_KEYS.pref]: 'system' }) });
  assert.equal(store.getSnapshot().preference, 'dark');
  assert.equal(store.getSnapshot().resolvedMode, 'dark');
});

test('initial value: storage when there is no attribute', () => {
  const { store, doc } = make({ storage: createFakeStorage({ [STORAGE_KEYS.pref]: 'dark' }) });
  assert.equal(store.getSnapshot().preference, 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-pref'), 'dark');
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
});

test('initial value: default when storage is empty or holds garbage', () => {
  assert.equal(make().store.getSnapshot().preference, 'light');
  assert.equal(make({ storage: createFakeStorage({ [STORAGE_KEYS.pref]: 'purple' }) }).store.getSnapshot().preference, 'light');
  assert.equal(make({ defaultPreference: 'dark' }).store.getSnapshot().resolvedMode, 'dark');
});

test('invalid attribute is ignored (falls through to storage then default)', () => {
  const doc = createFakeDocument();
  doc.documentElement.setAttribute('data-theme-pref', 'neon');
  const { store } = make({ document: doc, storage: createFakeStorage({ [STORAGE_KEYS.pref]: 'dark' }) });
  assert.equal(store.getSnapshot().preference, 'dark');
});

test('setPreference normalises, persists, applies <html> attributes and notifies once per frame', () => {
  const { store, doc, storage, scheduler } = make();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.setPreference('dark');
  store.setPreference('system');
  store.setPreference('dark');
  assert.equal(storage.map.get(STORAGE_KEYS.pref), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-pref'), 'dark');
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
  assert.equal(calls, 0, 'notification is rAF-batched');
  scheduler.frame();
  assert.equal(calls, 1, 'three sets in a frame => one notification');
  assert.equal(store.getSnapshot().preference, 'dark');
});

test('invalid preference input is ignored (keeps current)', () => {
  const { store } = make();
  store.setPreference('dark');
  store.setPreference('blue');
  store.setPreference(undefined);
  assert.equal(store.getSnapshot().preference, 'dark');
});

test('mode switch holds data-theme-switching for two frames, then releases', () => {
  const { store, doc, scheduler } = make();
  store.setPreference('dark');
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), true);
  scheduler.frame();
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), true, 'still held after frame 1');
  scheduler.frame();
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), false);
});

test('a preference change that does not change the mode does not suppress transitions', () => {
  const { store, doc } = make();
  store.setPreference('system'); // OS is light => resolved stays light
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), false);
  assert.equal(store.getSnapshot().preference, 'system');
});

test('snapshot is referentially stable until a field changes', () => {
  const { store, scheduler } = make();
  const a = store.getSnapshot();
  assert.equal(store.getSnapshot(), a);
  store.setPreference('light'); // no change in any field
  scheduler.frame();
  assert.equal(store.getSnapshot(), a);
  store.setPreference('dark');
  assert.notEqual(store.getSnapshot(), a);
  const b = store.getSnapshot();
  assert.equal(store.getSnapshot(), b);
});

test('server snapshot is constant and matches the production default', () => {
  const { store } = make();
  const s1 = store.getServerSnapshot();
  const s2 = store.getServerSnapshot();
  assert.equal(s1, s2);
  assert.deepEqual({ ...s1 }, { preference: 'dark', systemMode: 'light', resolvedMode: 'dark', storageAvailable: true });
  store.setPreference('dark');
  assert.equal(store.getServerSnapshot(), s1, 'server snapshot never changes with client state');
});

test('unsubscribe stops notifications', () => {
  const { store, scheduler } = make();
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  off();
  store.setPreference('dark');
  scheduler.frame();
  assert.equal(calls, 0);
});

test('mode change dispatches theme:tokens-changed', () => {
  const { store, doc, scheduler } = make();
  store.setPreference('dark');
  scheduler.frame();
  assert.equal(doc._events.length, 1);
  store.setPreference('dark');
  scheduler.frame();
  assert.equal(doc._events.length, 1, 'no event when nothing changed');
});

test('preview override changes data-theme only, is not persisted, and clears', () => {
  const { store, doc, storage, scheduler } = make();
  store.setPreviewOverride('dark');
  scheduler.frame();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-pref'), 'light', 'real preference attribute untouched');
  assert.equal(storage.map.has(STORAGE_KEYS.pref), false);
  assert.equal(store.getSnapshot().resolvedMode, 'dark');
  store.setPreviewOverride(null);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
});

test('start() adopts a preference another tab stored after the bootstrap ran (missed storage event)', () => {
  const doc = createFakeDocument();
  doc.documentElement.setAttribute('data-theme-pref', 'light');
  const storage = createFakeStorage();
  const { store } = make({ document: doc, storage });
  assert.equal(store.getSnapshot().preference, 'light');
  storage.setItem(STORAGE_KEYS.pref, 'dark'); // no event delivered: listener not attached yet
  store.start();
  assert.equal(store.getSnapshot().preference, 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(storage.getItem(STORAGE_KEYS.pref), 'dark', 'adopt only, no write-back');
});

test('start() ignores an empty or invalid stored value', () => {
  const doc = createFakeDocument();
  doc.documentElement.setAttribute('data-theme-pref', 'dark');
  const { store } = make({ document: doc, storage: createFakeStorage({ [STORAGE_KEYS.pref]: 'purple' }) });
  store.start();
  assert.equal(store.getSnapshot().preference, 'dark');
});
