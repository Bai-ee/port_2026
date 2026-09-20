// Invoice Studio design-layer plan Q0 — theme-schema.js contract tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_SCHEMA_VERSION, BUILTIN_THEME_PRESETS, normalizeTheme, themeToCss, themeFontsHref,
} from '../theme-schema.js';
import { GOOGLE_FONT_CATALOG } from '../../../text-layers.js';

test('exactly three built-in presets: ledger, editorial, studio-dark', () => {
  assert.deepEqual(BUILTIN_THEME_PRESETS.map((t) => t.id).sort(), ['editorial', 'ledger', 'studio-dark']);
});

test('every preset font id exists in the shared Studio font catalog', () => {
  const catalogIds = new Set(GOOGLE_FONT_CATALOG.map((f) => f.id));
  for (const theme of BUILTIN_THEME_PRESETS) {
    assert.ok(catalogIds.has(theme.fonts.display), `${theme.id}.fonts.display "${theme.fonts.display}" not in catalog`);
    assert.ok(catalogIds.has(theme.fonts.body), `${theme.id}.fonts.body "${theme.fonts.body}" not in catalog`);
    assert.ok(catalogIds.has(theme.fonts.mono), `${theme.id}.fonts.mono "${theme.fonts.mono}" not in catalog`);
  }
});

test('every preset declares version, paper, margins, and a why', () => {
  for (const theme of BUILTIN_THEME_PRESETS) {
    assert.equal(theme.version, THEME_SCHEMA_VERSION);
    assert.ok(['letter', 'a4', 'fluid'].includes(theme.paper));
    assert.ok(['tight', 'normal', 'wide'].includes(theme.margins));
    assert.ok(theme.why && theme.why.length > 0);
  }
});

test('normalizeTheme(null/undefined/non-object) -> null (Default)', () => {
  assert.equal(normalizeTheme(null), null);
  assert.equal(normalizeTheme(undefined), null);
  assert.equal(normalizeTheme('ledger'), null);
  assert.equal(normalizeTheme(42), null);
});

test('normalizeTheme(unknown id) -> null', () => {
  assert.equal(normalizeTheme({ id: 'neon-cyberpunk' }), null);
});

test('normalizeTheme(known id) returns the canonical frozen preset, ignoring tampered fields', () => {
  const tampered = { id: 'ledger', colors: { paper: '#ff00ff', ink: '#00ff00', inkSoft: '#000', accent: '#000', line: '#000' } };
  const result = normalizeTheme(tampered);
  assert.equal(result, BUILTIN_THEME_PRESETS.find((t) => t.id === 'ledger'));
  assert.equal(result.colors.paper, '#f7f5ef'); // the real preset's color, not the tampered one
});

test('themeToCss(null) -> empty string', () => {
  assert.equal(themeToCss(null), '');
});

test('themeToCss(theme) scopes rules to the theme id and sets every color/font token', () => {
  const theme = BUILTIN_THEME_PRESETS.find((t) => t.id === 'studio-dark');
  const css = themeToCss(theme);
  assert.match(css, /data-invoice-theme="studio-dark"/);
  assert.match(css, /--ink:#f5f5f0/);
  assert.match(css, /--bg:#121212/);
  assert.match(css, /font-family:'Unbounded'/);
});

test('themeToCss emits @page geometry matching the preset paper/margins', () => {
  const letterTheme = BUILTIN_THEME_PRESETS.find((t) => t.id === 'ledger'); // paper:'letter', margins:'normal'
  assert.match(themeToCss(letterTheme), /@page\{size:letter;margin:14mm;\}/);
  const fluidTheme = BUILTIN_THEME_PRESETS.find((t) => t.id === 'studio-dark'); // paper:'fluid'
  assert.match(themeToCss(fluidTheme), /@page\{margin:14mm;\}/);
  assert.doesNotMatch(themeToCss(fluidTheme), /size:/);
});

test('themeFontsHref(null) -> empty string', () => {
  assert.equal(themeFontsHref(null), '');
});

test('themeFontsHref(theme) builds a css2 URL covering every distinct catalog font', () => {
  const theme = BUILTIN_THEME_PRESETS.find((t) => t.id === 'editorial'); // display+mono distinct, body distinct
  const href = themeFontsHref(theme);
  assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(href, /family=Playfair\+Display/);
  assert.match(href, /family=Work\+Sans/);
  assert.match(href, /family=Space\+Mono/);
  assert.match(href, /display=swap$/);
});

test('themeFontsHref dedupes when two roles share a catalog font', () => {
  const theme = { ...BUILTIN_THEME_PRESETS[0], fonts: { display: 'space-mono', body: 'space-mono', mono: 'space-mono' } };
  const href = themeFontsHref(theme);
  assert.equal(href.match(/family=Space\+Mono/g).length, 1);
});
