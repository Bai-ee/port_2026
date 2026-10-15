import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_NAMES } from '../../theme/tokens.js';
import {
  BRIDGE_CSS, OWNED_CSS, read, parseRules, tokenRefs, collectCustomProps,
} from './ws5-helpers.js';

const TOKEN_SET = new Set(TOKEN_NAMES);
const TERM_KINDS = ['info', 'fetch', 'ok', 'ai', 'build', 'error', 'active', 'screen', 'mock', 'countdown'];
const TERM_NAMES = [
  'bg', 'border', 'border-top', 'shadow', 'titlebar-bg', 'titlebar-border', 'title-fg', 'scroll-thumb', 'fg', 'dim', 'caret',
  ...TERM_KINDS.flatMap((k) => [`${k}-pfx`, `${k}-msg`]),
];
const ROOT_ALIAS_SELECTOR = ':root, [data-theme-scope]';

const aliasRefOnly = /^var\((--t-[a-z0-9-]+)\)$/;

test('bridge.css declares every root alias on ":root, [data-theme-scope]"', () => {
  const rules = parseRules(read(BRIDGE_CSS));
  assert.equal(rules.length, 1, 'bridge.css holds exactly one alias rule');
  assert.equal(rules[0].selector.replace(/\s+/g, ' '), ROOT_ALIAS_SELECTOR);
  const names = rules[0].decls.map((d) => d.name);
  for (const n of ['--accent', '--success', '--warning', ...TERM_NAMES.map((t) => `--term-${t}`)]) {
    assert.ok(names.includes(n), `bridge.css is missing ${n}`);
  }
  assert.equal(new Set(names).size, names.length, 'no alias is declared twice');
});

test('every bridge alias is a plain var() of a manifest token, with the contract mapping', () => {
  const { decls } = parseRules(read(BRIDGE_CSS))[0];
  const byName = Object.fromEntries(decls.map((d) => [d.name, d.value]));
  for (const d of decls) {
    const m = aliasRefOnly.exec(d.value);
    assert.ok(m, `${d.name} must be var(--t-*), got ${d.value}`);
    assert.ok(TOKEN_SET.has(m[1]), `${d.name} -> ${m[1]} is not in TOKEN_NAMES`);
  }
  // contract section 10.1 plus the section 18 item 5 resolution (dash-accent, not danger-solid)
  assert.equal(byName['--accent'], 'var(--t-dash-accent)');
  assert.equal(byName['--success'], 'var(--t-success-solid)');
  assert.equal(byName['--warning'], 'var(--t-warning-solid)');
  for (const t of TERM_NAMES) assert.equal(byName[`--term-${t}`], `var(--t-term-${t})`);
});

test('colors.css keeps the --term-* block as the same aliases, also on [data-theme-scope]', () => {
  const bridge = Object.fromEntries(parseRules(read(BRIDGE_CSS))[0].decls.map((d) => [d.name, d.value]));
  const rule = parseRules(read('colors.css')).find((r) => r.decls.some((d) => d.name === '--term-bg'));
  assert.ok(rule, 'colors.css still declares the terminal palette');
  assert.ok(rule.selector.split(',').map((s) => s.trim()).includes('[data-theme-scope]'), `selector ${rule.selector}`);
  assert.ok(rule.selector.split(',').map((s) => s.trim()).includes(':root'));
  const term = Object.fromEntries(rule.decls.filter((d) => d.name.startsWith('--term-')).map((d) => [d.name, d.value]));
  assert.deepEqual(Object.keys(term).sort(), TERM_NAMES.map((t) => `--term-${t}`).sort());
  for (const [n, v] of Object.entries(term)) assert.equal(v, bridge[n], `${n} differs between colors.css and bridge.css`);
});

test('01-base.css: one mode-agnostic [data-dashboard-theme] alias block replaces the two mode blocks (contract 10.2)', () => {
  const css = read('styles/dashboard/01-base.css');
  assert.ok(!/\[data-dashboard-theme="(dark|light)"\]\s*\{\s*--page/.test(css), 'old per-mode token blocks are gone');
  const rule = parseRules(css).find((r) => r.selector === '[data-dashboard-theme]' && r.decls.some((d) => d.name === '--page'));
  assert.ok(rule, 'alias block exists');
  const got = Object.fromEntries(rule.decls.map((d) => [d.name, d.value]));
  assert.deepEqual(got, {
    '--page': 'var(--t-dash-page)',
    '--surface': 'var(--t-dash-surface)',
    '--surface-raised': 'var(--t-dash-surface-raised)',
    '--border': 'var(--t-dash-border)',
    '--border-visible': 'var(--t-dash-border-visible)',
    '--text-disabled': 'var(--t-dash-text-disabled)',
    '--text-secondary': 'var(--t-dash-text-secondary)',
    '--text-primary': 'var(--t-dash-text-primary)',
    '--text-display': 'var(--t-dash-text-display)',
    '--dot-grid-color': 'var(--t-dash-dot-grid)',
  });
  // the shell keeps its own rule and the attribute is still the hook
  const shell = parseRules(css).find((r) => r.selector === '[data-dashboard-theme]' && r.decls.some((d) => d.name === 'background'));
  assert.ok(shell, '[data-dashboard-theme] base rule still exists');
});

test('01-base.css no longer declares --accent/--success/--warning (they live in bridge.css only)', () => {
  const rules = parseRules(read('styles/dashboard/01-base.css'));
  for (const r of rules) {
    for (const d of r.decls) assert.ok(!['--accent', '--success', '--warning'].includes(d.name), `${d.name} redeclared in ${r.selector}`);
  }
});

const FAMILIES = [
  { prefix: '--bb-', file: 'styles/brain-builder.css', scope: '#brain-builder-page', colourNames: ['ink', 'ink-soft', 'ink-muted', 'line', 'surface', 'page', 'success', 'warning', 'danger', 'accent'] },
  { prefix: '--vrk-', file: 'styles/dashboard/10-video-remix.css', scope: '.vrk-scope', colourNames: ['ink', 'ink-soft', 'ink-muted', 'line', 'surface', 'surface-strong', 'success', 'danger', 'a', 'b', 'c'] },
  { prefix: '--sg-', file: 'styles/dashboard/09-market-signals.css', scope: '.signals-sg', colourNames: ['ink', 'ink-soft', 'ink-muted', 'line', 'line-soft', 'surface-strong', 'a', 'b', 'c', 'success', 'warning', 'danger'] },
  { prefix: '--pilot-', file: 'styles/dashboard/03-strategy-builder.css', scope: '#strategy-builder-card-shell.dashboard-modal-pilot', colourNames: ['surface', 'surface-strong', 'surface-soft', 'line', 'line-soft', 'ink', 'muted', 'disabled', 'highlight'] },
];

for (const fam of FAMILIES) {
  test(`${fam.prefix}* colour variables are re-pointed at manifest tokens (no literals) in ${fam.scope}`, () => {
    const rule = parseRules(read(fam.file)).find((r) => r.selector === fam.scope && r.decls.some((d) => d.name.startsWith(fam.prefix)));
    assert.ok(rule, `${fam.scope} rule not found`);
    const got = Object.fromEntries(rule.decls.filter((d) => d.name.startsWith(fam.prefix)).map((d) => [d.name, d.value]));
    for (const n of fam.colourNames) {
      const v = got[`${fam.prefix}${n}`];
      assert.ok(v, `${fam.prefix}${n} missing`);
      assert.match(v, /var\(--t-/, `${fam.prefix}${n} must reference a theme token: ${v}`);
      assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v), `${fam.prefix}${n} still holds a literal: ${v}`);
      for (const ref of tokenRefs(v)) assert.ok(TOKEN_SET.has(ref), `${fam.prefix}${n} -> unknown ${ref}`);
    }
  });
}

test('the contract mapping holds for the scoped families (--bb/--vrk/--sg/--pilot)', () => {
  const get = (file, scope) => Object.fromEntries(
    parseRules(read(file)).find((r) => r.selector === scope && r.decls.some((d) => /^--(bb|vrk|sg|pilot)-/.test(d.name)))
      .decls.map((d) => [d.name, d.value]),
  );
  const bb = get('styles/brain-builder.css', '#brain-builder-page');
  assert.deepEqual(
    [bb['--bb-ink'], bb['--bb-ink-soft'], bb['--bb-ink-muted'], bb['--bb-line'], bb['--bb-surface'], bb['--bb-page'], bb['--bb-success'], bb['--bb-warning'], bb['--bb-danger'], bb['--bb-accent']],
    ['var(--t-text)', 'var(--t-text-secondary)', 'var(--t-text-muted)', 'var(--t-border-subtle)', 'var(--t-surface)', 'var(--t-inset)', 'var(--t-success)', 'var(--t-warning)', 'var(--t-danger)', 'var(--t-accent)'],
  );
  const vrk = get('styles/dashboard/10-video-remix.css', '.vrk-scope');
  assert.deepEqual(
    [vrk['--vrk-ink'], vrk['--vrk-ink-soft'], vrk['--vrk-ink-muted'], vrk['--vrk-line'], vrk['--vrk-surface'], vrk['--vrk-surface-strong'], vrk['--vrk-success'], vrk['--vrk-danger'], vrk['--vrk-a'], vrk['--vrk-b'], vrk['--vrk-c']],
    ['var(--t-text)', 'var(--t-text-secondary)', 'var(--t-text-muted)', 'var(--t-border-subtle)', 'var(--t-glass)', 'var(--t-glass-strong)', 'var(--t-success)', 'var(--t-danger)', 'var(--t-accent-bright)', 'var(--t-support-1)', 'var(--t-support-2)'],
  );
  const sg = get('styles/dashboard/09-market-signals.css', '.signals-sg');
  assert.deepEqual(
    [sg['--sg-ink'], sg['--sg-ink-soft'], sg['--sg-ink-muted'], sg['--sg-line'], sg['--sg-surface-strong'], sg['--sg-a'], sg['--sg-b'], sg['--sg-c'], sg['--sg-success'], sg['--sg-warning'], sg['--sg-danger']],
    ['var(--t-text)', 'var(--t-text-secondary)', 'var(--t-text-muted)', 'var(--t-border-subtle)', 'var(--t-glass-strong)', 'var(--t-accent-bright)', 'var(--t-support-1)', 'var(--t-support-2)', 'var(--t-success)', 'var(--t-warning)', 'var(--t-danger)'],
  );
  const pilot = get('styles/dashboard/03-strategy-builder.css', '#strategy-builder-card-shell.dashboard-modal-pilot');
  assert.deepEqual(
    [pilot['--pilot-surface'], pilot['--pilot-surface-strong'], pilot['--pilot-line'], pilot['--pilot-ink'], pilot['--pilot-muted'], pilot['--pilot-disabled'], pilot['--pilot-highlight']],
    ['var(--t-glass)', 'var(--t-glass-strong)', 'var(--t-border-subtle)', 'var(--t-text)', 'var(--t-text-secondary)', 'var(--t-text-muted)', 'var(--t-glass-highlight)'],
  );
});

test('.brief-kit is pinned: its tokens stay literal and are not re-pointed (contract 10.3, X2)', () => {
  const rule = parseRules(read('styles/dashboard/11-creative-brief.css')).find((r) => r.decls.some((d) => d.name === '--ink'));
  assert.ok(rule, '.brief-kit variable block exists');
  assert.ok(rule.decls.some((d) => d.name === '--brand' && d.value.toLowerCase() === '#116dff'));
  assert.equal(tokenRefs(read('styles/dashboard/11-creative-brief.css')).length, 0, '.brief-kit references no theme token');
});

test('no theme variable is declared with the --t- prefix in any WS5 file (the namespace belongs to the generator)', () => {
  for (const f of [...OWNED_CSS, BRIDGE_CSS]) {
    for (const r of parseRules(read(f))) for (const d of r.decls) assert.ok(!d.name.startsWith('--t-'), `${f}: ${d.name}`);
  }
});

test('the dashboard stylesheet import order is unchanged (load-bearing cascade)', () => {
  const imports = [...read('styles/dashboard/index.css').matchAll(/@import\s+'\.\/([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports, [
    '01-base.css', '02-style-guide-survey.css', '03-strategy-builder.css', '04-data-quality.css',
    '05-seo-performance.css', '06-intake-onboarding.css', '07-modals-misc.css', '08-ui-kit-interactions.css',
    '09-market-signals.css', '10-video-remix.css', '11-creative-brief.css',
  ]);
});

test('custom-property collection sees the bridge (sanity for the other WS5 suites)', () => {
  const t = collectCustomProps([BRIDGE_CSS]);
  assert.equal(t['--accent'], 'var(--t-dash-accent)');
});
