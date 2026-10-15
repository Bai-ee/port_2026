// Contract §8.2: the head bootstrap (ES5, run in node:vm) and the runtime pref store must agree on
// (data-theme, data-theme-pref, color-scheme) across the whole matrix.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { getBootstrapScript } from '../../theme/bootstrap-source.js';
import { STORAGE_KEYS, DRAFT_CSS_MARKER } from '../../theme/constants.js';
import { createPrefStore } from '../pref-store.js';
import { createFakeDocument, createFakeStorage, createManualScheduler, createFakeMatchMedia, createFakeWindow } from './helpers.js';

const DEFAULTS = ['light', 'dark', 'system'];
const STORED = [
  { name: 'valid light', value: 'light' },
  { name: 'valid dark', value: 'dark' },
  { name: 'valid system', value: 'system' },
  { name: 'invalid', value: 'purple' },
  { name: 'absent', value: undefined },
  { name: 'getItem throws', throws: 'getItem' },
  { name: 'accessor throws', throws: 'accessor' },
];
const OS = [
  { name: 'OS dark', dark: true },
  { name: 'OS light', dark: false },
  { name: 'no matchMedia', none: true },
];
const ACTIVE = [
  { name: 'no active flag', flag: false },
  { name: 'active + valid css', flag: true, css: `${DRAFT_CSS_MARKER}hash:abc12345 */\n:root{--t-page:#000}`, accepted: true },
  { name: 'active + css without marker', flag: true, css: ':root{--t-page:#f00}', accepted: false },
  { name: 'active + css missing', flag: true, css: undefined, accepted: false },
];

function buildStorage(stored, active) {
  const initial = {};
  if (stored.value !== undefined) initial[STORAGE_KEYS.pref] = stored.value;
  if (active.flag) initial[STORAGE_KEYS.active] = '1';
  if (active.css !== undefined) initial[STORAGE_KEYS.draftCss] = active.css;
  const storage = createFakeStorage(initial);
  if (stored.throws === 'getItem') storage.failGet = true;
  return storage;
}

function runBootstrap({ defaultPref, stored, os, active }) {
  const doc = createFakeDocument();
  const storage = buildStorage(stored, active);
  const win = os.none ? {} : { matchMedia: createFakeMatchMedia(os.dark) };
  const sandbox = { document: doc, window: win };
  if (stored.throws === 'accessor') {
    Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('SecurityError'); }, enumerable: true });
  } else {
    sandbox.localStorage = storage;
  }
  vm.runInNewContext(getBootstrapScript({ defaultPreference: defaultPref }), vm.createContext(sandbox), { timeout: 1000 });
  return doc;
}

function storeFor({ defaultPref, stored, os, active, doc }) {
  const storage = stored.throws === 'accessor'
    ? () => { throw new Error('SecurityError'); }
    : buildStorage(stored, active);
  const mm = os.none ? null : createFakeMatchMedia(os.dark);
  return createPrefStore({
    document: doc, storage, scheduler: createManualScheduler(), win: createFakeWindow(), matchMedia: mm, defaultPreference: defaultPref,
  });
}

const attrsOf = (doc) => ({
  theme: doc.documentElement.getAttribute('data-theme'),
  pref: doc.documentElement.getAttribute('data-theme-pref'),
  scheme: doc.documentElement.style.colorScheme,
});

let combos = 0;
for (const defaultPref of DEFAULTS) {
  for (const stored of STORED) {
    for (const os of OS) {
      for (const active of ACTIVE) {
        combos += 1;
        test(`bootstrap == runtime: default=${defaultPref} | stored=${stored.name} | ${os.name} | ${active.name}`, () => {
          const ctx = { defaultPref, stored, os, active };
          const booted = runBootstrap(ctx);
          const b = attrsOf(booted);

          // 1) a fresh page: the runtime store derives the SAME state from storage/default and writes the same attributes
          const freshDoc = createFakeDocument();
          const fresh = storeFor({ ...ctx, doc: freshDoc });
          const f = attrsOf(freshDoc);
          assert.deepEqual(f, b, 'attributes written by the store equal the bootstrap attributes');
          assert.equal(fresh.getSnapshot().resolvedMode, b.theme);
          assert.equal(fresh.getSnapshot().preference, b.pref);

          // 2) hydration: the store created AFTER the bootstrap reads the attribute and agrees with it
          const hydrated = storeFor({ ...ctx, doc: booted });
          assert.equal(hydrated.getSnapshot().preference, b.pref);
          assert.equal(hydrated.getSnapshot().resolvedMode, b.theme);
          assert.deepEqual(attrsOf(booted), b, 'store creation does not disturb bootstrap attributes');

          // 3) the draft style is injected iff the contract says so
          const styleEl = booted.getElementById('theme-draft-css');
          // unreadable storage => the active flag cannot be read => nothing to inject
          if (active.accepted && !stored.throws) {
            assert.ok(styleEl, 'valid draft CSS injected');
            assert.equal(styleEl.textContent, active.css);
          } else {
            assert.equal(styleEl, null, 'draft CSS not injected');
          }
        });
      }
    }
  }
}

test('matrix size is as documented (3 x 7 x 3 x 4)', () => {
  assert.equal(combos, 252);
});

test('bootstrap script is ES5-only and within the size budget', () => {
  const src = getBootstrapScript({ defaultPreference: 'light' });
  assert.ok(src.length <= 1600, `bootstrap is ${src.length} bytes`);
  assert.doesNotMatch(src, /=>|`|\blet\b|\bconst\b|\?\./);
  assert.equal(getBootstrapScript({ defaultPreference: 'light' }), src, 'constant per default preference');
});

test('bootstrap falls back to the default preference for an unknown default argument', () => {
  const doc = runBootstrap({ defaultPref: 'neon', stored: { value: undefined }, os: { dark: true }, active: { flag: false } });
  assert.deepEqual(attrsOf(doc), { theme: 'light', pref: 'light', scheme: 'light' });
});
