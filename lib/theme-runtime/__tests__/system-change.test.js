import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefStore } from '../pref-store.js';
import { STORAGE_KEYS } from '../../theme/constants.js';
import {
  createFakeDocument, createFakeStorage, createManualScheduler, createFakeMatchMedia, createFakeWindow,
} from './helpers.js';

function make(pref, osDark = false) {
  const doc = createFakeDocument();
  const mm = createFakeMatchMedia(osDark);
  const scheduler = createManualScheduler();
  const store = createPrefStore({
    document: doc, storage: createFakeStorage(pref ? { [STORAGE_KEYS.pref]: pref } : {}), scheduler,
    win: createFakeWindow(), matchMedia: mm, defaultPreference: 'light',
  });
  store.start();
  return { store, doc, mm, scheduler };
}

test('OS change applies when preference is system', () => {
  const { store, doc, mm, scheduler } = make('system', false);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  mm.mql.set(true);
  scheduler.frame();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-pref'), 'system');
  assert.equal(store.getSnapshot().resolvedMode, 'dark');
  mm.mql.set(false);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
});

test('OS change is ignored for an explicit light preference (snapshot tracks systemMode only)', () => {
  const { store, doc, mm } = make('light', false);
  mm.mql.set(true);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(doc.documentElement.style.colorScheme, 'light');
  assert.equal(store.getSnapshot().resolvedMode, 'light');
  assert.equal(store.getSnapshot().systemMode, 'dark');
});

test('OS change is ignored for an explicit dark preference', () => {
  const { store, doc, mm } = make('dark', true);
  mm.mql.set(false);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(store.getSnapshot().resolvedMode, 'dark');
  assert.equal(store.getSnapshot().systemMode, 'light');
});

test('switching to system after an OS change picks up the current OS mode', () => {
  const { store, doc, mm } = make('light', false);
  mm.mql.set(true);
  store.setPreference('system');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
});

test('OS change under system uses transition suppression', () => {
  const { doc, mm, scheduler } = make('system', false);
  mm.mql.set(true);
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), true);
  scheduler.frame(); scheduler.frame();
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), false);
});

test('stop() detaches the matchMedia listener; start() is idempotent', () => {
  const { store, mm } = make('system', false);
  store.start();
  assert.equal(mm.mql.listenerCount, 1);
  store.stop();
  assert.equal(mm.mql.listenerCount, 0);
});

test('legacy addListener-only MediaQueryList is supported', () => {
  const listeners = new Set();
  const legacy = { matches: false, addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f) };
  const doc = createFakeDocument();
  const store = createPrefStore({
    document: doc, storage: createFakeStorage({ [STORAGE_KEYS.pref]: 'system' }), scheduler: createManualScheduler(),
    win: createFakeWindow(), matchMedia: () => legacy, defaultPreference: 'light',
  });
  store.start();
  assert.equal(listeners.size, 1);
  for (const f of listeners) f({ matches: true });
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
});
