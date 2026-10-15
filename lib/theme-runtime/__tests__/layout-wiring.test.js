// Static guards for the JSX wiring that cannot be rendered in plain `node --test` (no Next, no DOM):
// app/layout.jsx (contract §8.1), ThemeRuntime and ThemeStudioMount (§8.4, §15.2).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import runtime from '../../theme/production/resolved.runtime.generated.js';
import { getBootstrapScript } from '../../theme/bootstrap-source.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const layout = read('app/layout.jsx');
const themeRuntime = read('components/theme/ThemeRuntime.jsx');
const mount = read('components/theme/ThemeStudioMount.jsx');

test('layout: <html> is suppressHydrationWarning and carries SSR theme attributes only for a non-system default', () => {
  const html = layout.slice(layout.indexOf('<html'), layout.indexOf('<head>'));
  assert.match(html, /suppressHydrationWarning/);
  assert.match(layout, /THEME_DEFAULT_PREF === 'system'\s*\?\s*\{\}/);
  assert.match(layout, /'data-theme': THEME_DEFAULT_PREF, 'data-theme-pref': THEME_DEFAULT_PREF/);
});

test('layout: the bootstrap <script> is the first (only) child of <head>', () => {
  const head = layout.slice(layout.indexOf('<head>'), layout.indexOf('</head>'));
  const first = head.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim().replace(/^<head>\s*/, '');
  assert.ok(first.startsWith('<script'), 'first child of <head> is the bootstrap script');
  assert.match(head, /dangerouslySetInnerHTML=\{\{ __html: THEME_BOOTSTRAP_SCRIPT \}\}/);
  assert.match(layout, /getBootstrapScript\(\{ defaultPreference: THEME_DEFAULT_PREF \}\)/);
});

test('layout: CSS import order is colors.css, theme.generated.css, bridge.css', () => {
  const a = layout.indexOf("import '../colors.css'");
  const b = layout.indexOf("import '../styles/theme/theme.generated.css'");
  const c = layout.indexOf("import '../styles/theme/bridge.css'");
  assert.ok(a > -1 && b > a && c > b, `order colors(${a}) < generated(${b}) < bridge(${c})`);
});

test('layout: body background/color use the theme tokens', () => {
  assert.match(layout, /background: 'var\(--t-page\)'/);
  assert.match(layout, /color: 'var\(--t-text-default\)'/);
});

test('layout: ThemeRuntime precedes SmoothScroll; ThemeStudioMount is inside AuthProvider', () => {
  const body = layout.slice(layout.indexOf('<body'));
  assert.ok(body.indexOf('<ThemeRuntime />') > -1);
  assert.ok(body.indexOf('<ThemeRuntime />') < body.indexOf('<SmoothScroll />'));
  const open = body.indexOf('<AuthProvider>');
  const close = body.indexOf('</AuthProvider>');
  const mountAt = body.indexOf('<ThemeStudioMount />');
  assert.ok(open > -1 && mountAt > open && mountAt < close);
});

test('layout: viewport export has colorScheme and light/dark themeColor from the generated page tokens', () => {
  assert.match(layout, /export const viewport = \{/);
  assert.match(layout, /colorScheme: THEME_DEFAULT_PREF === 'system' \? 'light dark' : THEME_DEFAULT_PREF/);
  assert.match(layout, /\(prefers-color-scheme: light\)/);
  assert.match(layout, /\(prefers-color-scheme: dark\)/);
  assert.match(runtime.light.tokens['--t-page'], /^#[0-9a-f]{6}$/);
  assert.match(runtime.dark.tokens['--t-page'], /^#[0-9a-f]{6}$/);
});

test('layout: the page imports only the slim runtime data, never the 150 KB resolved JSON', () => {
  assert.match(layout, /resolved\.runtime\.generated\.js/);
  assert.doesNotMatch(layout + themeRuntime + mount, /resolved\.generated\.json/);
});

test('baseline server render: default preference light => data-theme/pref light, script constant', () => {
  assert.equal(runtime.defaults.viewerPreference, 'light');
  assert.equal(getBootstrapScript({ defaultPreference: 'light' }), getBootstrapScript({ defaultPreference: runtime.defaults.viewerPreference }));
});

test('ThemeRuntime: main-bundle imports only (no draft store, no engine), scene bridge wired per §9.2', () => {
  assert.doesNotMatch(themeRuntime, /draft-store|applier|lib\/theme\/(resolve|css|report|edit|index)/);
  assert.match(themeRuntime, /import \{ sceneBridge \} from '\.\.\/\.\.\/lib\/theme-scene\/scene-bridge\.js'/);
  assert.match(themeRuntime, /sceneBridge\.setProduction\(\{ light: runtimeData\.light\.scene, dark: runtimeData\.dark\.scene \}\)/);
  assert.match(themeRuntime, /sceneBridge\.setMode\(/);
  assert.match(themeRuntime, /return null;/);
});

test('ThemeStudioMount: lazy Studio boundary, gate, launcher id and shortcut per §8.4', () => {
  assert.match(mount, /dynamic\(\(\) => import\('\.\.\/theme-studio\/ThemeStudio'\), \{ ssr: false/);
  assert.match(mount, /isStudioEnabled\(/);
  assert.match(mount, /nodeEnv: process\.env\.NODE_ENV/);
  assert.match(mount, /const LAUNCHER_ID = 'theme-studio-launcher'/);
  assert.match(mount, /altKey && event\.shiftKey && event\.code === 'KeyT'/);
  // the engine-importing store is only reachable through a dynamic import
  assert.doesNotMatch(mount, /^import .*draft-store/m);
  assert.match(mount, /import\('\.\.\/\.\.\/lib\/theme-runtime\/draft-store'\)/);
  assert.match(mount, /if \(!enabled\) return null;/);
});

test('main-bundle modules never statically import the engine', () => {
  for (const f of ['pref-store.js', 'hooks.js', 'index.js', 'storage.js', 'read-token.js', 'dom-attrs.js', 'site-draft.js', 'registry.js', 'select.js', 'studio-gate.js']) {
    const src = fs.readFileSync(path.join(root, 'lib/theme-runtime', f), 'utf8');
    const imports = src.match(/^import .* from '[^']+';$/gm) || [];
    for (const line of imports) {
      assert.doesNotMatch(line, /theme\/(resolve|css|report|edit|index|validate|export|guide|migrate|scene)\.js/, `${f}: ${line}`);
      assert.doesNotMatch(line, /draft-store|applier|production\.js|draft-hooks/, `${f}: ${line}`);
    }
  }
});
