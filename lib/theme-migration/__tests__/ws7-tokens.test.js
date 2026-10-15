// WS7: token hygiene for the public JSX files, plus proof that the baseline
// light values behind the substituted tokens equal the legacy literals they
// replaced (so the light baseline looks the same).

import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_NAMES } from '../../theme/tokens.js';
import runtime from '../../theme/production/resolved.runtime.generated.js';
import { parseLiteral } from '../../theme/dev/scan-literals.js';
import {
  allThemedFiles, PINNED_FILES, read,
} from './ws7-helpers.js';

const KNOWN = new Set(TOKEN_NAMES);
const FILES = [...allThemedFiles(), ...PINNED_FILES, 'components/looper/LooperLandingPage.jsx'];

test('every --t-* reference in the WS7 files is a real token', () => {
  const bad = [];
  for (const file of new Set(FILES)) {
    for (const m of read(file).matchAll(/--t-[a-z0-9-]+/g)) {
      if (!KNOWN.has(m[0])) bad.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the tokens the logo, blend and CTA seams rely on exist in the manifest', () => {
  for (const name of ['--t-logo-blend', '--t-logo-filter', '--t-logo-filter-muted', '--t-gradient-accent', '--t-on-solid', '--t-text-inverse']) {
    assert.ok(KNOWN.has(name), `${name} must exist in the token manifest`);
  }
});

const light = runtime.light.tokens;
const rgbOf = (token) => parseLiteral(light[token]);

test('baseline light base colours equal the legacy ink and paper literals they replace', () => {
  const same = (token, legacy, tol = 1) => {
    const a = rgbOf(token);
    const b = parseLiteral(legacy);
    assert.ok(a && b, `${token} / ${legacy} must parse`);
    for (const ch of ['r', 'g', 'b']) assert.ok(Math.abs(a[ch] - b[ch]) <= tol, `${token} ${ch}: ${a[ch]} vs ${b[ch]}`);
  };
  same('--t-text', '#2a2420', 0); // rgba(42,36,32,a) family (color-mix bases)
  same('--t-text-strong', '#0a0a0a', 0); // black dividers, #0a0a0a headings
  same('--t-text-body', '#1a1a1a', 0); // rgba(26,26,26,a) family
  same('--t-text-eyebrow', 'rgb(90,83,70)', 0); // rgba(90,83,70,a) eyebrow labels
  same('--t-surface', '#ffffff', 0); // white glass fills
  same('--t-on-solid', '#ffffff', 0); // white text on the gradient CTA
  same('--t-raised', 'rgb(254,253,249)', 1); // inner page shell bg
  same('--t-deco-2', 'rgb(102,184,164)', 0); // auth page teal tint
  same('--t-deco-4', 'rgb(171,148,218)', 0); // auth page lavender tint
  same('--t-accent-bright', '#00d2e6', 1); // hsl(185,100%,45%)
  same('--t-support-2', '#ff00c3', 1); // hsl(314,100%,50%)
});

test('baseline named alpha tokens equal the legacy ink and glass alphas they replace', () => {
  const alphaOf = (t) => rgbOf(t).a;
  const near = (a, b) => Math.abs(a - b) < 0.006;
  assert.ok(near(alphaOf('--t-border-faint'), 0.08));
  assert.ok(near(alphaOf('--t-border-subtle'), 0.12));
  assert.ok(near(alphaOf('--t-text-secondary'), 0.72));
  assert.ok(near(alphaOf('--t-glass-soft'), 0.5));
  assert.ok(near(alphaOf('--t-glass'), 0.62));
  assert.ok(near(alphaOf('--t-glass-highlight'), 0.45));
  assert.ok(near(alphaOf('--t-chrome'), 0.55));
  const border = rgbOf('--t-glass-border');
  assert.deepEqual([border.r, border.g, border.b], [212, 196, 171]);
  assert.ok(near(border.a, 0.82));
});

test('logo tokens keep the light look and invert in dark mode', () => {
  assert.equal(runtime.light.tokens['--t-logo-blend'], 'darken');
  assert.equal(runtime.light.tokens['--t-logo-filter'], 'none');
  assert.match(runtime.light.tokens['--t-logo-filter-muted'], /grayscale\(1\)/);
  assert.equal(runtime.dark.tokens['--t-logo-blend'], 'lighten');
  assert.match(runtime.dark.tokens['--t-logo-filter'], /invert\(1\)/);
});
