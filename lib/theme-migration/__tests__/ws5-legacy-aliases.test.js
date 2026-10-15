import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_CSS, read, collectCustomProps, resolveLegacy, evalColor, colorDistance, tokensFor,
} from './ws5-helpers.js';

// Every legacy custom property must still resolve, through the bridge, to the colour it had before
// the migration (light baseline = today's production look). Values below are the pre-migration
// literals from colors.css / 01-base.css / the scoped families.

const FILES = [
  'colors.css', BRIDGE_CSS, 'styles/dashboard/01-base.css', 'styles/dashboard/03-strategy-builder.css',
  'styles/dashboard/09-market-signals.css', 'styles/dashboard/10-video-remix.css', 'styles/brain-builder.css',
];
const table = collectCustomProps(FILES);

// each family is declared on its own scope selector, so build per-scope tables where names collide
const only = (selector) => collectCustomProps(FILES, (s) => s === selector);

function expectColor(name, got, want, mode, tol = 1.01) {
  const tokens = tokensFor(mode);
  const a = evalColor(got, tokens);
  const b = evalColor(want, tokens);
  assert.ok(a, `${name} (${mode}) did not resolve to a colour: ${got}`);
  const d = colorDistance(a, b);
  assert.ok(d <= tol, `${name} (${mode}): ${got} differs from legacy ${want} by ${d.toFixed(2)}/255`);
}

test('root brand/status aliases resolve to the legacy values (dash-accent keeps the brand red, section 18.5)', () => {
  for (const mode of ['light', 'dark']) {
    expectColor('--accent', resolveLegacy('--accent', table, mode), '#D71921', mode, 0.5);
  }
  expectColor('--success', resolveLegacy('--success', table, 'light'), '#4A9E5C', 'light', 0.5);
  expectColor('--warning', resolveLegacy('--warning', table, 'light'), '#D4A843', 'light', 0.5);
});

const DASH = {
  light: { '--page': '#F5F5F5', '--surface': '#FFFFFF', '--surface-raised': '#F0F0F0', '--border': '#E4E4E4', '--border-visible': '#C8C8C8', '--text-disabled': '#A3A3A3', '--text-secondary': '#666666', '--text-primary': '#222222', '--text-display': '#000000', '--dot-grid-color': 'rgba(0,0,0,0.065)' },
  dark: { '--page': '#000000', '--surface': '#111111', '--surface-raised': '#1A1A1A', '--border': '#222222', '--border-visible': '#333333', '--text-disabled': '#666666', '--text-secondary': '#999999', '--text-primary': '#E8E8E8', '--text-display': '#FFFFFF', '--dot-grid-color': 'rgba(255,255,255,0.045)' },
};
for (const mode of ['light', 'dark']) {
  test(`dashboard shell neutrals resolve to the legacy [data-dashboard-theme="${mode}"] values`, () => {
    for (const [name, want] of Object.entries(DASH[mode])) {
      expectColor(name, resolveLegacy(name, table, mode), want, mode, 1.01);
    }
  });
}

const TERM = {
  '--term-border': 'rgba(42, 36, 32, 0.10)', '--term-border-top': 'rgba(42, 36, 32, 0.06)', '--term-titlebar-bg': 'rgba(42, 36, 32, 0.035)',
  '--term-titlebar-border': 'rgba(42, 36, 32, 0.07)', '--term-title-fg': 'rgba(42, 36, 32, 0.42)', '--term-scroll-thumb': 'rgba(42, 36, 32, 0.16)',
  '--term-fg': '#2a2420', '--term-dim': '#8a8378',
  '--term-info-pfx': '#5a6b82', '--term-info-msg': '#4b5563', '--term-fetch-pfx': '#0e7c8b', '--term-fetch-msg': '#1a6b76',
  '--term-ok-pfx': '#3f7d2e', '--term-ok-msg': '#46732f', '--term-ai-pfx': '#8b3fb0', '--term-ai-msg': '#79399a',
  '--term-build-pfx': '#ad7a17', '--term-build-msg': '#8f6512', '--term-error-pfx': '#c0392b', '--term-error-msg': '#a83226',
  '--term-active-pfx': '#2f6fed', '--term-active-msg': '#22303f', '--term-screen-pfx': '#3b5bbf', '--term-screen-msg': '#2f3f6f',
  '--term-mock-pfx': '#c66a38', '--term-mock-msg': '#a9552b', '--term-countdown-pfx': '#ad7a17', '--term-countdown-msg': '#8f6512',
  '--term-caret': '#2f6fed',
};
test('terminal palette aliases resolve to the legacy light console colours', () => {
  for (const [name, want] of Object.entries(TERM)) expectColor(name, resolveLegacy(name, table, 'light'), want, 'light', 1.01);
});
test('terminal composites keep their shape (gradient shell, two-layer shadow)', () => {
  const bg = resolveLegacy('--term-bg', table, 'light');
  assert.match(bg, /^linear-gradient\(180deg, #fcfaf7 0%, #f2ebe0 100%\)$/i);
  const shadow = resolveLegacy('--term-shadow', table, 'light').replace(/\s+/g, ' ');
  assert.match(shadow, /^0px 4px 10px rgba\(42, 36, 32, 0\.05\), 0px 14px 30px rgba\(42, 36, 32, 0\.08\)$/);
});

const FAMILY = {
  '--bb-': { selector: '#brain-builder-page', want: { ink: '#2a2420', 'ink-soft': 'rgba(42,36,32,0.72)', 'ink-muted': 'rgba(42,36,32,0.52)', line: 'rgba(42,36,32,0.12)', surface: '#ffffff', page: '#f7f7f6', success: '#285f3b', warning: '#67533d', danger: '#9f1f17', accent: '#00adb5' } },
  '--vrk-': { selector: '.vrk-scope', want: { ink: '#2a2420', 'ink-soft': 'rgba(42,36,32,0.72)', 'ink-muted': 'rgba(42,36,32,0.52)', line: 'rgba(42,36,32,0.12)', surface: 'rgba(255,255,255,0.62)', 'surface-strong': 'rgba(255,255,255,0.78)', success: '#285f3b', danger: '#9f1f17', a: 'hsl(185,100%,45%)', b: 'hsl(262,100%,55%)', c: 'hsl(314,100%,50%)' } },
  '--sg-': { selector: '.signals-sg', want: { ink: '#2a2420', 'ink-soft': 'rgba(42,36,32,0.72)', 'ink-muted': 'rgba(42,36,32,0.52)', line: 'rgba(42,36,32,0.12)', 'line-soft': 'rgba(42,36,32,0.14)', 'surface-strong': 'rgba(255,255,255,0.78)', a: 'hsl(185,100%,45%)', b: 'hsl(262,100%,55%)', c: 'hsl(314,100%,50%)', success: '#285f3b', warning: '#67533d', danger: '#9f1f17' } },
  '--pilot-': { selector: '#strategy-builder-card-shell.dashboard-modal-pilot', want: { surface: 'rgba(255,255,255,0.62)', 'surface-strong': 'rgba(255,255,255,0.78)', 'surface-soft': 'rgba(255,255,255,0.88)', line: 'rgba(42,36,32,0.12)', 'line-soft': 'rgba(42,36,32,0.14)', ink: '#2a2420', muted: 'rgba(42,36,32,0.72)', disabled: 'rgba(42,36,32,0.52)' } },
};
for (const [prefix, { selector, want }] of Object.entries(FAMILY)) {
  test(`${prefix}* aliases in ${selector} resolve to their pre-migration light values`, () => {
    const t = only(selector);
    for (const [k, v] of Object.entries(want)) {
      // support-1/-2 are the baseline's own +-2/255 gamut approximation of hsl(262/314) (THEME-STUDIO.md)
      expectColor(`${prefix}${k}`, resolveLegacy(`${prefix}${k}`, t, 'light'), v, 'light', 2.01);
    }
  });
}

test('pinned [data-theme-scope="dark"] subtrees recompute the aliases (root aliases are declared on the scope too)', () => {
  // the browser recomputes a var() alias on every element that declares it, so a pinned scope gets
  // its own value: model that by resolving against the scope mode instead of the page mode
  for (const mode of ['light', 'dark']) {
    const fg = evalColor(resolveLegacy('--term-fg', table, mode), tokensFor(mode));
    const bgTop = evalColor(tokensFor(mode)['--t-term-bg-top'], tokensFor(mode));
    assert.ok(fg && bgTop);
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    // terminal text is darker than its shell in light mode and lighter than it in dark mode
    assert.equal(lum(fg) < lum(bgTop), mode === 'light', `--term-fg vs shell in ${mode}`);
  }
  assert.ok(read(BRIDGE_CSS).includes('[data-theme-scope]'));
});

test('dashboard neutrals actually flip between modes (the single alias block is mode-agnostic)', () => {
  for (const name of ['--page', '--surface', '--text-primary', '--text-display']) {
    assert.notEqual(resolveLegacy(name, table, 'light'), resolveLegacy(name, table, 'dark'), `${name} should differ per mode`);
  }
});
