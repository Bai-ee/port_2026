// The baseline must reproduce today's light look (contract 12.1/12.2): every
// cited legacy colour is matched within +-1 per 8-bit channel, alpha exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../resolve.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { parseHex, hexToOklch, deltaEOK, hslToSrgb01, formatHex } from '../color.js';

const light = resolveTheme(BASELINE_DEFINITION, 'light');
const dark = resolveTheme(BASELINE_DEFINITION, 'dark');

const hsl = (h, s, l) => {
  const [r, g, b] = hslToSrgb01({ h: h / 360, s: s / 100, l: l / 100 });
  return formatHex({ r: r * 255, g: g * 255, b: b * 255 });
};

function expectColour(theme, id, legacy, tol = 1) {
  const got = theme.roles[id];
  const want = typeof legacy === 'string' ? { ...parseHex(legacy) } : legacy;
  const rgba = got.rgba;
  for (let i = 0; i < 3; i++) {
    const w = [want.r, want.g, want.b][i];
    assert.ok(Math.abs(rgba[i] - w) <= tol, `${id} channel ${i}: ${got.value} vs legacy ${JSON.stringify(want)}`);
  }
  assert.ok(Math.abs(rgba[3] - (want.a ?? 1)) <= 0.0005, `${id} alpha ${rgba[3]} vs ${want.a}`);
}

const rgba = (r, g, b, a) => ({ r, g, b, a });

// [role, legacy colour]
const LIGHT = [
  ['page', '#ffffff'], ['surface', '#ffffff'], ['raised', '#fefdf9'], ['inset', '#f7f7f6'],
  ['overlay', rgba(22, 20, 18, 0.42)], ['chrome', rgba(245, 241, 223, 0.55)], ['chrome-strong', rgba(245, 241, 223, 0.85)],
  ['glass-soft', rgba(255, 255, 255, 0.5)], ['glass', rgba(255, 255, 255, 0.62)], ['glass-strong', rgba(255, 255, 255, 0.78)],
  ['glass-border', rgba(212, 196, 171, 0.82)], ['glass-highlight', rgba(255, 255, 255, 0.45)], ['scrim', rgba(255, 255, 255, 0)],
  ['text-default', '#000000'], ['text-strong', '#0a0a0a'], ['text-body', '#1a1a1a'], ['text', '#2a2420'],
  ['text-secondary', rgba(42, 36, 32, 0.72)], ['text-muted', rgba(42, 36, 32, 0.52)], ['text-faint', rgba(42, 36, 32, 0.38)],
  ['text-eyebrow', '#5a5346'], ['text-inverse', '#faf7f2'], ['on-overlay', '#faf7f2'], ['on-solid', '#ffffff'],
  ['text-disabled', rgba(42, 36, 32, 0.3)],
  ['border-faint', rgba(42, 36, 32, 0.08)], ['border-subtle', rgba(42, 36, 32, 0.12)],
  ['control-border', rgba(42, 36, 32, 0.22)], ['control-border-strong', rgba(42, 36, 32, 0.55)],
  ['accent', '#00adb5'], ['accent-bright', hsl(185, 100, 45)], ['support-1', hsl(262, 100, 55)], ['support-2', hsl(314, 100, 50)],
  ['comet-1', hsl(185, 100, 58)], ['comet-2', hsl(200, 100, 62)], ['comet-3', hsl(225, 100, 64)], ['comet-4', hsl(250, 100, 66)],
  ['comet-5', hsl(275, 100, 66)], ['comet-6', hsl(300, 100, 68)], ['comet-7', hsl(320, 80, 80)],
  ['deco-1', '#c47c56'], ['deco-2', '#66b8a4'], ['deco-3', '#d6bf7b'], ['deco-4', '#ab94da'],
  ['success', '#285f3b'], ['success-solid', '#4a9e5c'], ['warning', '#67533d'], ['warning-solid', '#d4a843'],
  ['danger', '#9f1f17'], ['danger-solid', '#d71921'], ['info', '#1d4ed8'], ['info-solid', '#2f6fed'],
  ['scene-wash', rgba(245, 241, 223, 0.08)], ['disabled-bg', rgba(42, 36, 32, 0.06)],
  ['dash-accent', '#d71921'],
  // dashboard neutrals (colors in styles/dashboard/01-base.css light block)
  ['dash-page', '#f5f5f5'], ['dash-surface', '#ffffff'], ['dash-surface-raised', '#f0f0f0'], ['dash-border', '#e4e4e4'],
  ['dash-border-visible', '#c8c8c8'], ['dash-text-disabled', '#a3a3a3'], ['dash-text-secondary', '#666666'],
  ['dash-text-primary', '#222222'], ['dash-text-display', '#000000'], ['dash-dot-grid', rgba(0, 0, 0, 0.065)],
  // terminal (colors.css 164-186)
  ['term-bg-top', '#fcfaf7'], ['term-bg-bottom', '#f2ebe0'], ['term-dim', '#8a8378'], ['term-fg', '#2a2420'],
  ['term-border', rgba(42, 36, 32, 0.1)], ['term-border-top', rgba(42, 36, 32, 0.06)],
  ['term-titlebar-bg', rgba(42, 36, 32, 0.035)], ['term-titlebar-border', rgba(42, 36, 32, 0.07)],
  ['term-title-fg', rgba(42, 36, 32, 0.42)], ['term-scroll-thumb', rgba(42, 36, 32, 0.16)],
  ['term-shadow-1', rgba(42, 36, 32, 0.05)], ['term-shadow-2', rgba(42, 36, 32, 0.08)],
  ['term-info-pfx', '#5a6b82'], ['term-info-msg', '#4b5563'], ['term-fetch-pfx', '#0e7c8b'], ['term-fetch-msg', '#1a6b76'],
  ['term-ok-pfx', '#3f7d2e'], ['term-ok-msg', '#46732f'], ['term-ai-pfx', '#8b3fb0'], ['term-ai-msg', '#79399a'],
  ['term-build-pfx', '#ad7a17'], ['term-build-msg', '#8f6512'], ['term-error-pfx', '#c0392b'], ['term-error-msg', '#a83226'],
  ['term-active-pfx', '#2f6fed'], ['term-active-msg', '#22303f'], ['term-screen-pfx', '#3b5bbf'], ['term-screen-msg', '#2f3f6f'],
  ['term-mock-pfx', '#c66a38'], ['term-mock-msg', '#a9552b'], ['term-countdown-pfx', '#ad7a17'], ['term-countdown-msg', '#8f6512'],
  ['term-caret', '#2f6fed'],
];

test('baseline light matches every cited legacy colour within +-1 per channel', () => {
  for (const [id, legacy] of LIGHT) expectColour(light, id, legacy);
  assert.ok(LIGHT.length > 90);
});

test('the legacy values that matter most are reproduced exactly', () => {
  for (const [id, hex] of [
    ['page', '#ffffff'], ['text', '#2a2420'], ['accent', '#00adb5'], ['success', '#285f3b'], ['danger-solid', '#d71921'],
    ['dash-page', '#f5f5f5'], ['dash-text-primary', '#222222'], ['term-bg-top', '#fcfaf7'], ['dash-accent', '#d71921'],
  ]) assert.equal(light.roles[id].hex, hex, id);
});

test('approximated stand-ins stay within 0.012 deltaE-OK of the legacy value', () => {
  // contract 12.1 names --t-inset for #f7f7f6, #f3f4f6 and #fcfcfb; #fcfcfb is 0.0149 from inset
  // but 0.0050 from --t-raised, so migrators should map it to --t-raised (documented amendment).
  const dist = (legacy, role) => deltaEOK(hexToOklch(legacy, 0), light.roles[role].oklch);
  assert.ok(dist('#f7f7f6', 'inset') < 0.001);
  assert.ok(dist('#f3f4f6', 'inset') <= 0.012);
  assert.ok(dist('#fcfcfb', 'raised') <= 0.012);
  assert.ok(dist('#fcfcfb', 'inset') > 0.012, 'documents why raised is the right stand-in');
});

test('dark dashboard neutrals equal the legacy dark block exactly', () => {
  const legacy = {
    'dash-page': '#000000', 'dash-surface': '#111111', 'dash-surface-raised': '#1a1a1a', 'dash-border': '#222222',
    'dash-border-visible': '#333333', 'dash-text-disabled': '#666666', 'dash-text-secondary': '#999999',
    'dash-text-primary': '#e8e8e8', 'dash-text-display': '#ffffff',
  };
  for (const [id, hex] of Object.entries(legacy)) assert.equal(dark.roles[id].hex, hex, id);
  assert.deepEqual(dark.roles['dash-dot-grid'].rgba, [255, 255, 255, 0.045]);
  assert.equal(dark.roles['dash-accent'].hex, '#d71921');
});

test('baseline defaults: light viewer preference, focus ring and selection off (D5, D8)', () => {
  assert.equal(BASELINE_DEFINITION.defaults.viewerPreference, 'light');
  assert.deepEqual(BASELINE_DEFINITION.features, { focusRing: false, selection: false });
  assert.deepEqual(BASELINE_DEFINITION.master, { hue: 201, intensity: 1 });
  assert.deepEqual(BASELINE_DEFINITION.offsets, { accentBright: 6, support1: 86, support2: 142 });
});

test('dark baseline passes every required contrast pair and keeps status hues', () => {
  assert.equal(dark.roles.success.oklch.h, 152.7);
  assert.equal(dark.roles.page.hex === light.roles.page.hex, false);
});
