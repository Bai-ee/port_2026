// WS7: structural guarantees of the public-site migration (pins, logo seams,
// shared CTA gradient, GSAP-created nodes, scene mode of pinned pages).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PINNED_FILES, THEMED_FILES, allThemedFiles, read,
} from './ws7-helpers.js';

const PIN = /data-theme-scope="light"/;

test('every pinned route carries data-theme-scope="light" on its outermost element', () => {
  for (const file of PINNED_FILES) {
    const src = read(file);
    assert.equal((src.match(/data-theme-scope="light"/g) || []).length >= 1, true, `${file} is not pinned`);
  }
  assert.match(read('components/looper/LooperLandingPage.jsx'), /id="looper-page-shell"\s+data-theme-scope="light"/);
  assert.match(read('components/recreate/RecreateLandingPage.jsx'), /id="recreate-landing-shell" data-theme-scope="light"/);
  assert.match(read('app/archive/page.jsx'), /<main id="archive-page-shell" data-theme-scope="light"/);
  assert.match(read('app/capture/page.jsx'), /id="capture-root" data-theme-scope="light"/);
  assert.match(read('app/post-approval/page.jsx'), /<main id="post-approval-page" data-theme-scope="light"/);
  assert.match(read('app/preview/layout.jsx'), /id="preview-theme-pin-shell"[\s\S]*data-theme-scope="light"/);
});

test('pinned pages paint the light page so a dark root theme never shows through', () => {
  assert.match(read('components/looper/LooperLandingPage.jsx'), /background: 'var\(--t-page\)'/);
  assert.match(read('components/recreate/RecreateLandingPage.jsx'), /background: 'var\(--t-page\)'/);
  assert.match(read('app/preview/layout.jsx'), /background: 'var\(--t-page\)'/);
});

test('pinned pages keep the scene in light mode', () => {
  assert.match(read('components/recreate/RecreateLandingPage.jsx'), /<InternalPageBackground sceneMode="light" \/>/);
  assert.match(read('app/preview/intake-modal/page.jsx'), /<InternalPageBackground sceneMode="light" \/>/);
});

test('themed public files are never pinned', () => {
  for (const file of allThemedFiles()) assert.ok(!PIN.test(read(file)), `${file} must follow the theme, not pin it`);
});

test('the header signature goes through the logo blend and filter tokens', () => {
  const src = read('Header.jsx');
  assert.match(src, /mixBlendMode: 'var\(--t-logo-blend\)'/);
  assert.match(src, /filter: isSignatureLogo \? 'var\(--t-logo-filter\)' : undefined/);
  assert.ok(!/mixBlendMode: 'darken'/.test(src));
});

test('every rendered sig.png carries the logo filter token', () => {
  for (const file of THEMED_FILES) {
    const src = read(file);
    if (!src.includes('/img/sig.png')) continue;
    if (file === 'Header.jsx') continue; // covered above (default prop value, filter applied conditionally)
    assert.ok(src.includes('--t-logo-filter'), `${file} renders /img/sig.png without --t-logo-filter`);
  }
});

test('agency logos use the muted logo filter token, not a literal grayscale', () => {
  for (const file of THEMED_FILES) {
    const src = read(file);
    if (!src.includes('/img/agencies/')) continue;
    assert.ok(src.includes('--t-logo-filter-muted'), `${file} lacks --t-logo-filter-muted`);
    assert.ok(!/filter:\s*['"]?grayscale\(1\)/.test(src), `${file} still uses a literal grayscale filter`);
    assert.ok(!/opacity:\s*0\.45,\s*filter/.test(src), `${file} still sets the legacy 0.45 opacity next to the filter`);
  }
});

test('the accent gradient comes from --t-gradient-accent, never from hsl literals', () => {
  for (const file of THEMED_FILES) {
    const src = read(file);
    assert.ok(!/hsla?\(\s*(185|262|314)\b/.test(src), `${file} still contains a brand hsl stop`);
  }
  for (const file of ['SiteFooter.jsx', 'InnerPageShell.jsx', 'ReelPlayer.jsx', 'AuthPage.jsx', 'PortfolioModal.jsx', 'FAQPage.jsx', 'CaseStudiesPage.jsx', 'CreateCaseStudyModal.jsx', 'StackedSlidesSection.jsx']) {
    assert.ok(read(file).includes('var(--t-gradient-accent)'), `${file} lost the shared accent gradient`);
  }
});

test('text on the accent gradient uses --t-on-solid', () => {
  assert.match(read('SiteFooter.jsx'), /color: 'var\(--t-on-solid\)'/);
  assert.match(read('InnerPageShell.jsx'), /color: 'var\(--t-on-solid\)'/);
  assert.match(read('ReelPlayer.jsx'), /fill="var\(--t-on-solid\)"/);
});

test('shared inner-page seams use glass and raised tokens', () => {
  const surface = read('pageSurfaceSystem.js');
  assert.match(surface, /background: 'var\(--t-glass-soft\)'/);
  assert.match(surface, /border: '1px solid var\(--t-glass-border\)'/);
  assert.match(surface, /--t-glass-highlight/);
  const shell = read('InnerPageShell.jsx');
  assert.match(shell, /background: 'var\(--t-raised\)'/);
  assert.match(shell, /color-mix\(in srgb, var\(--t-raised\) 72%, transparent\)/);
  assert.match(read('Header.jsx'), /background: 'var\(--t-chrome\)'/);
});

test('GSAP-created and body-appended nodes take var() colours, never captured values', () => {
  const src = read('StackedSlidesSection.jsx');
  const start = src.indexOf('Object.assign(image.style, {');
  const end = src.indexOf('document.body.appendChild(image);');
  assert.ok(start > 0 && end > start, 'hover preview node construction not found');
  const block = src.slice(start, end);
  assert.match(block, /internalPageCreamPaperBackground/);
  assert.match(block, /var\(--t-/);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block.replace(/rgba\(0,0,0,[^)]*\)/g, '')), 'literal colour in the hover preview node');
  // no colour is read once and cached: nothing in the file resolves theme colours at runtime
  assert.ok(!/getComputedStyle\([^)]*\)\.(color|backgroundColor)/.test(src));
});

test('the cream paper helper is opaque-by-construction and follows the theme', () => {
  const src = read('pageSurfaceSystem.js');
  assert.match(src, /export const internalPageCreamPaperBackground/);
  assert.match(src, /linear-gradient\(var\(--t-chrome-strong\), var\(--t-chrome-strong\)\), var\(--t-page\)/);
  for (const file of ['StackedSlidesSection.jsx', 'FontSelector.jsx']) {
    assert.match(read(file), /import \{ internalPageCreamPaperBackground \} from '\.\/pageSurfaceSystem';/, `${file} must import the helper`);
    assert.ok(/background: internalPageCreamPaperBackground|bg: internalPageCreamPaperBackground/.test(read(file)), `${file} must use the helper`);
  }
});

test('no colour state is held in React for the public pages (hydration safe)', () => {
  for (const file of ['Header.jsx', 'SiteFooter.jsx', 'InnerPageShell.jsx', 'AuthPage.jsx', 'PortfolioModal.jsx']) {
    const src = read(file);
    assert.ok(!/useState\(\s*['"]#/.test(src), `${file} stores a colour literal in state`);
    assert.ok(!/useResolvedMode|useThemePreference/.test(src), `${file} must theme through CSS variables, not by branching markup on mode`);
  }
});
