import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_NAMES, ROLE_TOKEN_NAMES, COMPOSITE_TOKENS, tokenForRole } from '../tokens.js';
import { ROLE_DEFS, ROLE_IDS, GROUPS, getRoleDef, isRoleId } from '../roles.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { resolveBoth } from '../resolve.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('TOKEN_NAMES: unique, --t- prefixed, roles first then composites', () => {
  assert.equal(new Set(TOKEN_NAMES).size, TOKEN_NAMES.length);
  for (const n of TOKEN_NAMES) assert.match(n, /^--t-[a-z0-9]+(-[a-z0-9]+)*$/, n);
  assert.deepEqual(TOKEN_NAMES.slice(0, ROLE_TOKEN_NAMES.length), [...ROLE_TOKEN_NAMES]);
  assert.deepEqual(TOKEN_NAMES.slice(ROLE_TOKEN_NAMES.length), [...COMPOSITE_TOKENS]);
  assert.equal(tokenForRole('text-muted'), '--t-text-muted');
  assert.equal(tokenForRole('nope'), null);
  assert.ok(isRoleId('accent') && !isRoleId('--t-accent') && getRoleDef('nope') === null);
});

test('the public token names other workstreams rely on exist (contract 4)', () => {
  const must = [
    'page', 'surface', 'raised', 'inset', 'overlay', 'chrome', 'chrome-strong', 'glass-soft', 'glass', 'glass-strong', 'glass-border',
    'glass-highlight', 'scrim', 'text-default', 'text-strong', 'text-body', 'text', 'text-secondary', 'text-muted', 'text-faint',
    'text-eyebrow', 'text-inverse', 'on-accent', 'on-solid', 'text-disabled', 'accent-text', 'border-faint', 'border-subtle',
    'control-border', 'control-border-strong', 'focus', 'accent', 'accent-hover', 'accent-pressed', 'accent-soft', 'accent-soft-border',
    'accent-bright', 'support-1', 'support-2', 'selection-bg', 'selection-fg', 'comet-1', 'comet-7', 'deco-1', 'deco-4',
    'success', 'success-bg', 'success-border', 'success-solid', 'warning', 'warning-bg', 'warning-border', 'warning-solid',
    'danger', 'danger-bg', 'danger-border', 'danger-solid', 'info', 'info-bg', 'info-border', 'info-solid', 'disabled-bg', 'shadow',
    'scene-wash', 'dash-page', 'dash-surface', 'dash-surface-raised', 'dash-border', 'dash-border-visible', 'dash-text-disabled',
    'dash-text-secondary', 'dash-text-primary', 'dash-text-display', 'dash-dot-grid', 'dash-accent', 'term-bg-top', 'term-bg-bottom',
    'term-border', 'term-border-top', 'term-titlebar-bg', 'term-titlebar-border', 'term-title-fg', 'term-scroll-thumb', 'term-fg',
    'term-dim', 'term-shadow-1', 'term-shadow-2', 'term-caret', 'term-info-pfx', 'term-countdown-msg',
  ];
  for (const id of must) assert.ok(ROLE_IDS.includes(id), `missing role ${id}`);
  for (const n of ['--t-gradient-accent', '--t-term-bg', '--t-term-shadow', '--t-shadow-sm', '--t-shadow-md', '--t-shadow-lg', '--t-blend-deco',
    '--t-logo-blend', '--t-logo-filter', '--t-logo-filter-muted', '--t-scene-bg', '--t-scene-base', '--t-scene-secondary',
    '--t-scene-highlight', '--t-scene-fallback']) assert.ok(COMPOSITE_TOKENS.includes(n), n);
  for (const k of ['info', 'fetch', 'ok', 'ai', 'build', 'error', 'active', 'screen', 'mock', 'countdown']) {
    assert.ok(ROLE_IDS.includes(`term-${k}-pfx`) && ROLE_IDS.includes(`term-${k}-msg`), k);
  }
});

test('every role has css, group, hue rule, scale, ranges for both modes and a usage string', () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  assert.equal(new Set(ROLE_IDS).size, ROLE_IDS.length);
  for (const d of ROLE_DEFS) {
    assert.equal(d.css, `--t-${d.id}`);
    assert.ok(groups.has(d.group), d.id);
    assert.ok(['solid', 'alpha'].includes(d.kind), d.id);
    assert.ok(['tint', 'master', 'offset', 'fixed'].includes(d.hue.src), d.id);
    if (d.hue.src === 'offset') assert.ok(['accentBright', 'support1', 'support2'].includes(d.hue.key), d.id);
    else assert.ok(Number.isFinite(d.hue.value), d.id);
    assert.ok(['tint', 'int', 'none'].includes(d.scale), d.id);
    assert.equal(typeof d.modeSettings, 'boolean');
    assert.equal(typeof d.contrast, 'boolean');
    assert.ok(typeof d.usage === 'string' && d.usage.length > 3, `${d.id} usage`);
    for (const mode of ['light', 'dark']) {
      const r = d.ranges[mode];
      assert.ok(r && r.l.length === 2 && r.c.length === 2 && r.a.length === 2, `${d.id} ${mode}`);
      assert.ok(r.l[0] <= r.l[1] && r.c[0] <= r.c[1] && r.a[0] <= r.a[1], `${d.id} ${mode}`);
    }
  }
  assert.ok(Object.isFrozen(ROLE_DEFS));
});

test('status and semantic roles are fixed-hue and never follow the master', () => {
  const fixed = ROLE_DEFS.filter((d) => d.hue.src === 'fixed').map((d) => d.id);
  for (const id of ['success', 'warning', 'danger', 'info', 'success-solid', 'danger-bg', 'term-ok-pfx', 'dash-accent']) assert.ok(fixed.includes(id), id);
  for (const d of ROLE_DEFS.filter((x) => x.group === 'status')) assert.equal(d.modeSettings, false, d.id);
  for (const d of ROLE_DEFS.filter((x) => x.hue.src === 'master' || x.hue.src === 'offset')) {
    assert.ok(['accent', 'decorative', 'text'].includes(d.group), d.id);
  }
});

test('baseline defines every role in both modes, in ROLE_DEFS order, and sits inside every authoring range', () => {
  const pair = resolveBoth(BASELINE_DEFINITION);
  for (const mode of ['light', 'dark']) {
    assert.deepEqual(Object.keys(BASELINE_DEFINITION.modes[mode].roles), [...ROLE_IDS]);
    for (const d of ROLE_DEFS) {
      const o = pair[mode].roles[d.id].oklch;
      const r = d.ranges[mode];
      const tol = 0.00006;
      assert.ok(o.l >= r.l[0] - tol && o.l <= r.l[1] + tol, `${mode}.${d.id} l=${o.l} not in ${r.l}`);
      assert.ok(o.c >= r.c[0] - tol && o.c <= r.c[1] + tol, `${mode}.${d.id} c=${o.c} not in ${r.c}`);
      assert.ok(o.a >= r.a[0] - tol && o.a <= r.a[1] + tol, `${mode}.${d.id} a=${o.a} not in ${r.a}`);
    }
  }
});

test('alpha-flagged roles emit rgba(), solid roles emit #rrggbb', () => {
  const pair = resolveBoth(BASELINE_DEFINITION);
  for (const mode of ['light', 'dark']) {
    for (const d of ROLE_DEFS) {
      const v = pair[mode].tokens[d.css];
      if (d.kind === 'alpha') assert.match(v, /^rgba\(\d+, \d+, \d+, [\d.]+\)$/, d.id);
      else if (pair[mode].roles[d.id].kind === 'solid') assert.match(v, /^#[0-9a-f]{6}$/, d.id);
    }
  }
});

// Guards typos in code written by the other workstreams: any `var(--t-x)` or `--t-x:` found in app
// styles / components must exist in TOKEN_NAMES.
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

test('every --t-* token referenced in styles, components, app and root files exists in TOKEN_NAMES', () => {
  const files = [
    ...walk(path.join(root, 'styles'), ['.css']),
    ...walk(path.join(root, 'components'), ['.jsx', '.js', '.css']),
    ...walk(path.join(root, 'app'), ['.jsx', '.js', '.css']),
    ...walk(path.join(root, 'lib/theme-runtime'), ['.js']),
    ...walk(path.join(root, 'lib/theme-scene'), ['.js']),
    ...walk(path.join(root, 'lib/theme-studio'), ['.js']),
    ...fs.readdirSync(root).filter((f) => /\.(jsx|js|css)$/.test(f) && !/^(next|eslint|postcss|tailwind)/.test(f)).map((f) => path.join(root, f)),
  ];
  const known = new Set(TOKEN_NAMES);
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:var\(\s*|(?<![\w-])(?=--t-))(--t-[a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      if (!known.has(m[1])) bad.push(`${path.relative(root, f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});
