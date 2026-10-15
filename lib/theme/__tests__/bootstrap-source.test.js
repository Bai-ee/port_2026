import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { getBootstrapScript, BOOTSTRAP_SCRIPT_HASH_NOTE } from '../bootstrap-source.js';
import { STORAGE_KEYS, DRAFT_CSS_MARKER } from '../constants.js';
import { normalizePreference, resolveMode } from '../mode.js';

const SCRIPT = {
  light: getBootstrapScript({ defaultPreference: 'light' }),
  dark: getBootstrapScript({ defaultPreference: 'dark' }),
  system: getBootstrapScript({ defaultPreference: 'system' }),
};

test('ES5 only: no arrows, let/const, template literals, classes, spread or optional chaining', () => {
  for (const [name, src] of Object.entries(SCRIPT)) {
    assert.ok(!/=>/.test(src), `${name}: arrow`);
    assert.ok(!/\b(let|const|class|async|await|import|export)\b/.test(src), `${name}: ES6 keyword`);
    assert.ok(!/`/.test(src), `${name}: template literal`);
    assert.ok(!/\.\.\./.test(src), `${name}: spread`);
    assert.ok(!/\?\./.test(src), `${name}: optional chaining`);
    assert.ok(!/\bfunction\s*\*/.test(src));
  }
});

test('under 1.6 KB, an IIFE, with the marker strings the runtime relies on', () => {
  for (const src of Object.values(SCRIPT)) {
    assert.ok(Buffer.byteLength(src) < 1600, `${Buffer.byteLength(src)} bytes`);
    assert.ok(src.startsWith('(function(){') && src.endsWith('})();'));
    for (const marker of [STORAGE_KEYS.pref, STORAGE_KEYS.active, STORAGE_KEYS.draftCss, DRAFT_CSS_MARKER, 'data-theme', 'data-theme-pref', 'theme-draft-css', 'prefers-color-scheme: dark', 'colorScheme']) {
      assert.ok(src.includes(marker), marker);
    }
    assert.ok(!src.includes('\n'));
  }
});

test('constant per default preference; invalid defaults fall back to light', () => {
  assert.equal(getBootstrapScript({ defaultPreference: 'dark' }), SCRIPT.dark);
  assert.equal(getBootstrapScript({ defaultPreference: 'dark' }), getBootstrapScript({ defaultPreference: 'dark' }));
  assert.notEqual(SCRIPT.light, SCRIPT.dark);
  assert.notEqual(SCRIPT.light, SCRIPT.system);
  assert.equal(getBootstrapScript({ defaultPreference: 'sepia' }), SCRIPT.light);
  assert.equal(getBootstrapScript(), SCRIPT.light);
  assert.ok(SCRIPT.system.includes("P='system'"));
  assert.ok(BOOTSTRAP_SCRIPT_HASH_NOTE.includes('sha256'));
});

function run(src, { stored, osDark, matchMedia = true, throwStorage = false, active, draftCss } = {}) {
  const attrs = {};
  const style = {};
  const appended = [];
  const store = {};
  if (stored !== undefined) store[STORAGE_KEYS.pref] = stored;
  if (active !== undefined) store[STORAGE_KEYS.active] = active;
  if (draftCss !== undefined) store[STORAGE_KEYS.draftCss] = draftCss;
  const doc = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, style, appendChild: (n) => appended.push(n) },
    head: { appendChild: (n) => appended.push(n) },
    createElement: () => ({}),
  };
  const sandbox = {
    document: doc,
    localStorage: {
      getItem: (k) => {
        if (throwStorage) throw new Error('blocked');
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
    },
    window: matchMedia ? { matchMedia: () => ({ matches: !!osDark }) } : {},
  };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.runInNewContext(src, sandbox);
  return { attrs, colorScheme: style.colorScheme, appended };
}

test('smoke: bootstrap agrees with the shared mode rule across the matrix', () => {
  for (const def of ['light', 'dark', 'system']) {
    for (const stored of [undefined, 'light', 'dark', 'system', 'bogus', '']) {
      for (const osDark of [true, false]) {
        for (const matchMedia of [true, false]) {
          for (const throwStorage of [false, true]) {
            const out = run(SCRIPT[def], { stored, osDark, matchMedia, throwStorage });
            const pref = throwStorage ? def : normalizePreference(stored === '' ? 'bogus' : stored, def);
            const mode = resolveMode(pref, matchMedia && osDark);
            const label = JSON.stringify({ def, stored, osDark, matchMedia, throwStorage });
            assert.equal(out.attrs['data-theme'], mode, label);
            assert.equal(out.attrs['data-theme-pref'], pref, label);
            assert.equal(out.colorScheme, mode, label);
          }
        }
      }
    }
  }
});

test('draft CSS is injected only when the active flag is "1" and the marker is exact', () => {
  const good = `${DRAFT_CSS_MARKER}hash:abc */\n:root{--t-page:#000}`;
  const a = run(SCRIPT.light, { active: '1', draftCss: good });
  assert.equal(a.appended.length, 1);
  assert.equal(a.appended[0].id, 'theme-draft-css');
  assert.equal(a.appended[0].textContent, good);
  assert.equal(run(SCRIPT.light, { active: '0', draftCss: good }).appended.length, 0);
  assert.equal(run(SCRIPT.light, { draftCss: good }).appended.length, 0);
  assert.equal(run(SCRIPT.light, { active: '1', draftCss: '/* something else */ a{}' }).appended.length, 0);
  assert.equal(run(SCRIPT.light, { active: '1' }).appended.length, 0);
  assert.equal(run(SCRIPT.light, { active: '1', draftCss: good, throwStorage: true }).appended.length, 0);
});
