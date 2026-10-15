import test from 'node:test';
import assert from 'node:assert/strict';
import { toCss } from '../css.js';
import { resolveBoth } from '../resolve.js';
import { TOKEN_NAMES } from '../tokens.js';
import { BASELINE_DEFINITION, createBaseline } from '../baseline.js';
import { setViewerPreference, setFeatures, setMasterHue } from '../edit.js';

/** Split generated CSS into top-level blocks: [{ selector, body }] (handles one nested @media level). */
function blocks(css) {
  const out = [];
  const re = /^([^\n{}]+?) \{\n([\s\S]*?)\n\}/gm;
  let m;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

const declNames = (body) => [...body.matchAll(/^\s*(--t-[a-z0-9-]+):/gm)].map((x) => x[1]);

test('emits exactly TOKEN_NAMES, once, in order, in every mode block', () => {
  const css = toCss(BASELINE_DEFINITION);
  const bs = blocks(css).filter((b) => /^(:root|:root\[data-theme="(light|dark)"\], \[data-theme-scope="(light|dark)"\])$/.test(b.selector));
  assert.equal(bs.length, 3);
  for (const b of bs) assert.deepEqual(declNames(b.body), [...TOKEN_NAMES], b.selector);
  assert.equal(new Set(TOKEN_NAMES).size, TOKEN_NAMES.length);
});

test('selector shape per contract 5', () => {
  const css = toCss(BASELINE_DEFINITION);
  assert.ok(css.includes(':root {\n  color-scheme: light;'));
  assert.ok(css.includes(':root[data-theme="light"], [data-theme-scope="light"] {\n  color-scheme: light;'));
  assert.ok(css.includes(':root[data-theme="dark"], [data-theme-scope="dark"] {\n  color-scheme: dark;'));
  assert.ok(css.includes(':root[data-theme-switching], :root[data-theme-switching] *, :root[data-theme-switching] *::before, :root[data-theme-switching] *::after { transition: none !important; }'));
  assert.ok(css.startsWith('/* theme: baseline hash:'));
  assert.ok(css.endsWith('}\n'));
  assert.equal((css.match(/!important/g) || []).length, 1, '!important is used in exactly one place');
});

test('fallback media query exists only for viewerPreference "system"', () => {
  assert.ok(!toCss(BASELINE_DEFINITION).includes('@media'));
  const sys = toCss(setViewerPreference(BASELINE_DEFINITION, 'system'));
  assert.ok(sys.includes('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n    color-scheme: dark;'));
  const media = sys.slice(sys.indexOf('@media'));
  assert.deepEqual(declNames(media.slice(0, media.indexOf('\n}\n  '))).length, TOKEN_NAMES.length);
  // no-JS :root fallback: light for 'system' and 'light', dark for 'dark'
  assert.ok(sys.includes(':root {\n  color-scheme: light;'));
  const dark = toCss(setViewerPreference(BASELINE_DEFINITION, 'dark'));
  assert.ok(dark.includes(':root {\n  color-scheme: dark;'));
  assert.ok(!dark.includes('@media'));
  const pair = resolveBoth(setViewerPreference(BASELINE_DEFINITION, 'dark'));
  assert.ok(dark.includes(`--t-page: ${pair.dark.tokens['--t-page']};`));
});

test('byte-deterministic; definition input and resolved-pair input agree', () => {
  const a = toCss(BASELINE_DEFINITION);
  assert.equal(toCss(BASELINE_DEFINITION), a);
  assert.equal(toCss(createBaseline()), a);
  assert.equal(toCss(resolveBoth(BASELINE_DEFINITION)), a);
  assert.ok(!/undefined|NaN|null/.test(a));
});

test('options: header, noJsFallback, scopeOnly, custom selectors', () => {
  const noHeader = toCss(BASELINE_DEFINITION, { header: false });
  assert.ok(noHeader.startsWith(':root {'));
  const noFallback = toCss(BASELINE_DEFINITION, { noJsFallback: false });
  assert.ok(!noFallback.includes('\n:root {') && !noFallback.startsWith(':root {'));
  assert.ok(noFallback.includes(':root[data-theme="light"]'));
  const scope = toCss(BASELINE_DEFINITION, { scopeOnly: true });
  const bs = blocks(scope);
  assert.deepEqual(bs.map((b) => b.selector), ['[data-theme-scope="light"]', '[data-theme-scope="dark"]']);
  for (const b of bs) assert.deepEqual(declNames(b.body), [...TOKEN_NAMES]);
  assert.ok(!scope.includes(':root') && !scope.includes('!important') && !scope.includes('@media'));
  const custom = toCss(BASELINE_DEFINITION, { selectors: { light: '#a', dark: '#b', fallback: '#c' }, header: false });
  assert.ok(custom.startsWith('#c {') && custom.includes('#a {') && custom.includes('#b {'));
});

test('features gate the selection and focus rules', () => {
  const base = toCss(BASELINE_DEFINITION);
  assert.ok(!base.includes('::selection') && !base.includes('focus-visible'));
  const on = toCss(setFeatures(BASELINE_DEFINITION, { focusRing: true, selection: true }));
  assert.ok(on.includes(':root[data-theme] ::selection, [data-theme-scope] ::selection { background: var(--t-selection-bg); color: var(--t-selection-fg); }'));
  assert.ok(on.includes(':where(:focus-visible) { outline: 2px solid var(--t-focus); outline-offset: 2px; }'));
  assert.equal((on.match(/!important/g) || []).length, 1);
});

test('snapshot of the first light tokens (shape is a public contract)', () => {
  const css = toCss(BASELINE_DEFINITION, { header: false });
  assert.ok(css.startsWith([
    ':root {',
    '  color-scheme: light;',
    '  --t-page: #ffffff;',
    '  --t-surface: #ffffff;',
    '  --t-raised: #fefdf9;',
    '  --t-inset: #f7f7f6;',
    '  --t-overlay: rgba(22, 20, 18, 0.42);',
    '  --t-chrome: rgba(245, 241, 223, 0.55);',
  ].join('\n')));
  assert.ok(css.includes('  --t-text: #2a2420;'));
  assert.ok(css.includes('  --t-accent: #00adb5;'));
  assert.ok(css.includes('  --t-text-muted: rgba(42, 36, 32, 0.52);'));
  assert.ok(css.includes('  --t-gradient-accent: linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%);'));
});

test('a changed master hue changes the CSS and its header hash', () => {
  const a = toCss(BASELINE_DEFINITION);
  const b = toCss(setMasterHue(BASELINE_DEFINITION, 100));
  assert.notEqual(a, b);
  assert.notEqual(a.split('\n')[0], b.split('\n')[0]);
});
