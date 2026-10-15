// WS8: token hygiene and structural guarantees for the unowned public / shared files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_NAMES } from '../../theme/tokens.js';
import runtime from '../../theme/production/resolved.runtime.generated.js';
import { parseLiteral } from '../../theme/dev/scan-literals.js';
import { WS8_FILES, read } from './ws8-helpers.js';

const KNOWN = new Set(TOKEN_NAMES);

test('every --t-* reference in the WS8 files is a real token', () => {
  const bad = [];
  for (const file of WS8_FILES) {
    for (const m of read(file).matchAll(/--t-[a-z0-9-]+/g)) if (!KNOWN.has(m[0])) bad.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('WS8 files follow the theme: none is pinned', () => {
  for (const file of WS8_FILES) assert.ok(!/data-theme-scope=/.test(read(file)), `${file} must follow the theme`);
});

test('Stripe appearance is resolved from tokens at runtime, not a literal module constant', () => {
  const src = read('components/payments/SubscribeModal.jsx');
  assert.match(src, /import \{ readToken \} from '\.\.\/\.\.\/lib\/theme-runtime\/read-token\.js'/);
  assert.match(src, /function buildStripeAppearance\(\)/);
  for (const t of ['--t-text', '--t-text-secondary', '--t-surface', '--t-border-subtle']) {
    assert.ok(src.includes(`readToken('${t}')`), `Stripe appearance must read ${t}`);
  }
  assert.match(src, /appearance: stripeAppearance/);
  assert.match(src, /useMemo\(\(\) => \(clientSecret \? buildStripeAppearance\(\) : null\), \[clientSecret\]\)/);
  assert.ok(!/var\(--t-/.test(src.slice(src.indexOf('function buildStripeAppearance'), src.indexOf('const PaymentStep'))), 'CSS variables cannot reach the Stripe iframe');
});

test('records page ink and surfaces follow the glass tokens', () => {
  const src = read('components/records/RecordsPage.jsx');
  assert.match(src, /const INK = 'var\(--t-text-body\)'/);
  assert.match(src, /border: '1px solid var\(--t-glass-border\)'/);
});

test('the glass tooltip derives its fill from the surface and text tokens', () => {
  const src = read('components/GlassTooltipLayer.jsx');
  assert.match(src, /background: color-mix\(in srgb, var\(--t-surface\) 84%, transparent\)/);
  assert.match(src, /color: color-mix\(in srgb, var\(--t-text\) 76%, transparent\)/);
});

const light = runtime.light.tokens;
test('baseline light tokens equal the legacy literals the WS8 migration replaced', () => {
  const same = (token, legacy, tol = 0) => {
    const a = parseLiteral(light[token]);
    const b = parseLiteral(legacy);
    assert.ok(a && b, `${token} / ${legacy} must parse`);
    for (const ch of ['r', 'g', 'b']) assert.ok(Math.abs(a[ch] - b[ch]) <= tol, `${token} ${ch}: ${a[ch]} vs ${b[ch]}`);
  };
  same('--t-text', '#2a2420');
  same('--t-surface', '#ffffff');
  same('--t-text-body', '#1a1a1a');
  same('--t-text-eyebrow', 'rgb(90,83,70)');
  same('--t-deco-2', 'rgb(102,184,164)'); // SubscribeModal teal tint
  same('--t-deco-4', 'rgb(171,148,218)'); // SubscribeModal violet tint
  same('--t-dash-border', '#e4e4e4'); // SubscribeModal card border
  same('--t-success-solid', '#4a9e5c'); // CalendarConnectModal connected dot
  same('--t-text-strong', '#111111', 7); // telegram-upload ink: nearest ink role (#0a0a0a vs #111, 7 levels)
});
