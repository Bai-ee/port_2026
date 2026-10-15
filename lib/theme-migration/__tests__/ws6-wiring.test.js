// WS6 wiring + structure checks for the dashboard / admin JSX: theme state comes from the global
// runtime, #theme-toggle is Light / Dark / System, pinned surfaces carry data-theme-scope="light",
// and the fixed-light document backdrops (X1/X2/X3) were left alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { read, themedFiles } from './ws6-helpers.js';
import { TOKEN_NAMES } from '../../theme/tokens.js';

const dash = read('DashboardPage.jsx');

test('DashboardPage takes theme state from lib/theme-runtime, not local state', () => {
  assert.match(dash, /import \{ useResolvedMode, useThemePreference \} from '\.\/lib\/theme-runtime\/hooks';/);
  assert.match(dash, /const theme = useResolvedMode\(\);/);
  assert.match(dash, /const \{ preference: themePreference, setPreference: setThemePreference \} = useThemePreference\(\);/);
  assert.doesNotMatch(dash, /useState\(\s*['"]light['"]\s*\)/, "no useState('light') theme state may remain");
  assert.doesNotMatch(dash, /const \[theme, setTheme\] = useState/);
});

test('data-dashboard-theme follows the resolved mode', () => {
  assert.match(dash, /<div data-dashboard-theme=\{theme\} style=\{shellStyle\}>/);
});

test('#theme-toggle offers Light / Dark / System through setPreference and still tracks analytics', () => {
  assert.match(dash, /const setTheme = useCallback\(\(next\) => \{ setThemePreference\(next\); trackThemeChanged\(next\); \}, \[setThemePreference\]\);/);
  const group = dash.slice(dash.indexOf('<div id="theme-toggle"'));
  const block = group.slice(0, group.indexOf('</div>') + 6);
  for (const mode of ['dark', 'light', 'system']) {
    assert.ok(block.includes(`data-theme-option="${mode}"`), `missing ${mode} button`);
    assert.ok(block.includes(`onClick={() => setTheme('${mode}')}`), `${mode} button does not call setTheme`);
    assert.ok(block.includes(`themePreference === '${mode}' ? 'is-active' : ''`), `${mode} button active state must follow the preference`);
  }
  // the buttons must not carry a bare data-theme attribute (it would match [data-theme] selectors)
  assert.doesNotMatch(block, /\sdata-theme=/);
});

test('every .brief-kit mount point in the dashboard is pinned light (X2)', () => {
  const mounts = dash.match(/<div className="brief-kit"[^>]*>/g) || [];
  assert.ok(mounts.length >= 2, 'expected the two REPORT-tab brief-kit mount points');
  for (const m of mounts) {
    assert.match(m, /data-theme-scope="light"/, m);
    assert.match(m, /id="[a-z0-9-]+"/, `${m} needs a stable DOM id`);
  }
});

test('the public Studio shell is pinned light (X8)', () => {
  const studio = read('app/dashboard/studio/StudioPage.jsx');
  const i = studio.indexOf('id="studio-page-shell"');
  assert.ok(i > 0);
  assert.match(studio.slice(i, i + 120), /data-theme-scope="light"/);
});

test('fixed-light document backdrops keep their literal (X1 / X2 / X3)', () => {
  const email = read('components/AdminEmailModals.jsx');
  assert.match(email, /minHeight: 560, border: '1px solid [^']+', borderRadius: 8, background: '#fff'/, 'email preview iframe backdrop must stay #fff');
  assert.match(read('components/dashboard/InvoiceBuilderCard.jsx'), /minHeight: 640, border: '1px solid [^']+', borderRadius: 8, background: '#fff'/, 'invoice preview iframe backdrop must stay #fff');
  assert.match(dash, /minHeight: '70vh', border: 'none', background: '#fff', borderRadius: '8px'/, 'brief preview iframe backdrop must stay #fff');
  // X-post preview mimicry colours are untouched
  for (const lit of ['#0f1419', '#536471', '#1d9bf0', '#e1e8ed']) assert.ok(dash.includes(lit), `${lit} (X-post preview) was migrated`);
});

test('fixed email / invoice HTML producers are not part of the WS6 file set', () => {
  for (const f of themedFiles()) {
    assert.ok(!f.startsWith('features/email-digest') && !f.startsWith('app/api/') && !f.startsWith('app/briefs'), f);
  }
});

test('Brain Builder inline ink alphas use the scoped alias', () => {
  const bb = read('components/brain-builder/BrainBuilder.jsx');
  assert.equal((bb.match(/color: 'var\(--bb-ink-soft\)'/g) || []).length >= 2, true);
  assert.doesNotMatch(bb, /rgba\(42,\s*36,\s*32/);
});

test('OpsOverviewPage generic variables are scoped to #ops-overview-page and themed', () => {
  const ops = read('OpsOverviewPage.jsx');
  assert.match(ops, /const opsOverviewCss = `\n  #ops-overview-page \{\n    --page: var\(--t-chrome-strong\);/);
  assert.doesNotMatch(ops, /^\s*:root\s*\{/m, 'generic --page/--text variables must not be declared on :root');
  for (const v of ['--green: var(--t-success)', '--red: var(--t-danger)', '--amber: var(--t-warning)', '--blue: var(--t-info)', '--purple: var(--t-support-1)']) {
    assert.ok(ops.includes(v), `${v} missing`);
  }
});

test('Content Center palette constants are token references (no hex-alpha concatenation possible)', () => {
  const xce = read('components/dashboard/content-ui/xce-tokens.js');
  assert.doesNotMatch(xce.split('export const XCE_RADII')[0], /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  for (const file of themedFiles()) {
    const src = read(file);
    assert.doesNotMatch(src, /XCE_COLORS\.\w+\}[0-9a-fA-F]{2}\b/, `${file} appends a hex alpha to a token-valued colour`);
  }
});

test('every --t-* name referenced by the WS6 files exists in TOKEN_NAMES', () => {
  const known = new Set(TOKEN_NAMES);
  for (const file of themedFiles()) {
    const src = read(file);
    for (const m of src.matchAll(/--t-[a-z0-9-]+/g)) {
      assert.ok(known.has(m[0]), `${file}: unknown token ${m[0]}`);
    }
  }
});

test('the runtime exposes the hooks DashboardPage imports (contract 7.6)', async () => {
  const hooks = await import('../../theme-runtime/hooks.js');
  assert.equal(typeof hooks.useResolvedMode, 'function');
  assert.equal(typeof hooks.useThemePreference, 'function');
});
