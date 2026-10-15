import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanLiterals, findUnallowed, loadAllowlist, isAllowed, normalizeLiteral, parseLiteral, guessType, kebab,
} from '../dev/scan-literals.js';
import { mapLiteral } from '../dev/legacy-map.js';
import { resolveTheme } from '../resolve.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { hslToSrgb01, formatHex } from '../color.js';
import { applyCodemod } from '../dev/codemod.js';

const kinds = (text, opts) => scanLiterals(text, opts).map((f) => `${f.kind}:${f.literal}`);

test('finds hex / rgb / rgba / hsl / hsla / 0x literals', () => {
  const css = `
    a { color: #fff; background: #2A2420; border: 1px solid #ffffff80; fill: rgb(1, 2, 3); }
    b { background: rgba(42,36,32,.12); outline-color: hsl(185, 100%, 45%); stroke: hsla(185 100% 58% / .12); }
  `;
  assert.deepEqual(kinds(css, { type: 'css' }), [
    'hex:#fff', 'hex:#2A2420', 'hex:#ffffff80', 'rgb:rgb(1, 2, 3)',
    'rgba:rgba(42,36,32,.12)', 'hsl:hsl(185, 100%, 45%)', 'hsla:hsla(185 100% 58% / .12)',
  ]);
  assert.deepEqual(kinds("const c = new THREE.Color(0xff00aa); const d = 0X12abcd; const e = '#0af';", { type: 'js' }), ['0x:0xff00aa', '0x:0X12abcd', 'hex:#0af']);
});

test('ignores CSS ids/selectors, comments, urls, entities, dynamic values and var() usage', () => {
  const css = `
    #abc, .card #fade { color: var(--t-text); }
    /* #123456 in a comment */
    a { background: url(#frag); color: rgb(var(--x) / .5); }
    @media (min-width: 10px) { #beef { margin: 0; } }
  `;
  assert.deepEqual(kinds(css, { type: 'css' }), []);
  const js = "const a = `rgba(${r}, ${g}, ${b}, .5)`; // #fff in a comment\n/* #000 */ const l = '&#8212; <a href=\"#top\">'; const q = 'var(--t-text)';";
  assert.deepEqual(kinds(js, { type: 'js' }), []);
});

test('reports property, line and column', () => {
  const [f] = scanLiterals('a {\n  background-color: #abc;\n}', { type: 'css' });
  assert.equal(f.property, 'background-color');
  assert.equal(f.line, 2);
  assert.equal(f.column, 21);
  const [g] = scanLiterals("<div style={{ backgroundColor: '#abc' }} />", { type: 'js' });
  assert.equal(g.property, 'background-color');
  const [h] = scanLiterals('<rect fill="#abc" />', { type: 'js' });
  assert.equal(h.property, 'fill');
});

test('black shadows are mode-agnostic (exception X6): shadows skipped, black dividers are not', () => {
  const css = `
    a { box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 0 0 1px rgba(255,255,255,.5); }
    b { text-shadow: 0 1px #000; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, .3)); }
    c { border-bottom: 1px solid rgba(0,0,0,.05); background: rgba(0,0,0,.4); }
  `;
  const f = scanLiterals(css, { type: 'css' });
  const shadow = f.filter((x) => x.blackShadow).map((x) => x.literal);
  assert.deepEqual(shadow, ['rgba(0,0,0,.1)', '#000', 'rgba(0, 0, 0, .3)']);
  const left = findUnallowed(css, { type: 'css' }).map((x) => x.literal);
  assert.deepEqual(left, ['rgba(255,255,255,.5)', 'rgba(0,0,0,.05)', 'rgba(0,0,0,.4)']);
  const js = "const s = { boxShadow: '0 4px 12px rgba(0,0,0,.2)', border: '1px solid rgba(0,0,0,.1)' };";
  assert.deepEqual(findUnallowed(js, { type: 'js' }).map((x) => x.literal), ['rgba(0,0,0,.1)']);
});

test('allowlist: matches by file + normalised literal and reports the rest', () => {
  const allow = loadAllowlist([
    { file: 'components/A.jsx', literal: '#FFF', reason: 'brand', exceptionId: 'X5' },
    { file: './components/B.jsx', literal: 'rgba(0, 0, 0, 0.5)', reason: 'x', exceptionId: 'X6' },
    { nonsense: true },
  ]);
  assert.equal(allow.length, 2);
  const src = "const a = '#ffffff'; const b = 'rgba(0,0,0,.5)'; const c = '#123';";
  assert.deepEqual(findUnallowed(src, { file: 'components/A.jsx', allowlist: allow }).map((f) => f.literal), ['rgba(0,0,0,.5)', '#123']);
  assert.deepEqual(findUnallowed(src, { file: 'components/B.jsx', allowlist: allow }).map((f) => f.literal), ['#ffffff', '#123']);
  assert.deepEqual(findUnallowed(src, { file: 'components/C.jsx', allowlist: allow }).length, 3);
  assert.equal(loadAllowlist({ entries: [{ file: 'a', literal: '#fff' }] }).length, 1);
  assert.equal(isAllowed({ normalized: '#ffffff' }, 'a.css', [{ file: '*', literal: '#fff', normalizedLiteral: '#ffffff' }]), true);
});

test('normalisation and parsing', () => {
  assert.equal(normalizeLiteral('#FFF'), '#ffffff');
  assert.equal(normalizeLiteral('RGBA( 42 , 36, 32 ,0.12)'), 'rgba(42,36,32,0.12)');
  assert.equal(normalizeLiteral('rgba(42,36,32,.12)'), normalizeLiteral('rgba(42, 36, 32, 0.12)'));
  assert.deepEqual(parseLiteral('rgba(42,36,32,.5)'), { space: 'rgb', r: 42, g: 36, b: 32, a: 0.5 });
  assert.deepEqual(parseLiteral('rgb(255 0 0 / 50%)'), { space: 'rgb', r: 255, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseLiteral('hsla(185,100%,58%,.12)'), { space: 'hsl', h: 185, s: 100, l: 58, a: 0.12 });
  assert.equal(parseLiteral('#abc').r, 170);
  assert.equal(parseLiteral('nonsense'), null);
  assert.equal(kebab('backgroundColor'), 'background-color');
  assert.equal(guessType('x/y.css'), 'css');
  assert.equal(guessType('x/y.jsx'), 'js');
});

// ---------- legacy map ----------

test('mapLiteral: exact matches only; ambiguity and unknowns are reported, not guessed', () => {
  const m = (lit, prop) => mapLiteral(lit, prop);
  assert.equal(m('#2a2420').replacement, 'var(--t-text)');
  assert.equal(m('#2A2420', 'border-color').replacement, 'var(--t-text)');
  assert.equal(m('#0a0a0a').replacement, 'var(--t-text-strong)');
  assert.equal(m('#1a1a1a').replacement, 'var(--t-text-body)');
  assert.equal(m('#faf7f2').replacement, 'var(--t-text-inverse)');
  assert.equal(m('#fff', 'background').replacement, 'var(--t-surface)');
  assert.equal(m('#ffffff', 'background-color').replacement, 'var(--t-surface)');
  assert.equal(m('#fff', 'color').status, 'ambiguous', 'white text on a fill: on-accent vs on-solid');
  assert.ok(m('#fff', 'fill').suggestions.length >= 2);
  assert.equal(m('#d71921').status, 'ambiguous', 'danger-solid vs dash-accent');
  assert.equal(m('#f5f1df').status, 'ambiguous');
  assert.equal(m('#e7d9c3').status, 'ambiguous');
  assert.equal(m('#123456').status, 'unmapped');
  assert.equal(m('rgba(42,36,32,.08)').replacement, 'var(--t-border-faint)');
  assert.equal(m('rgba(42, 36, 32, 0.12)').replacement, 'var(--t-border-subtle)');
  assert.equal(m('rgba(42,36,32,.22)').replacement, 'var(--t-control-border)');
  assert.equal(m('rgba(42,36,32,.38)').replacement, 'var(--t-text-faint)');
  assert.equal(m('rgba(42,36,32,.52)').replacement, 'var(--t-text-muted)');
  assert.equal(m('rgba(42,36,32,.72)').replacement, 'var(--t-text-secondary)');
  assert.equal(m('rgba(42,36,32,.14)').replacement, 'color-mix(in srgb, var(--t-text) 14%, transparent)');
  assert.equal(m('rgba(255,255,255,.5)').replacement, 'var(--t-glass-soft)');
  assert.equal(m('rgba(255,255,255,.62)').replacement, 'var(--t-glass)');
  assert.equal(m('rgba(255,255,255,.78)').replacement, 'var(--t-glass-strong)');
  assert.equal(m('rgba(255,255,255,.45)', 'box-shadow').replacement, 'var(--t-glass-highlight)');
  assert.equal(m('rgba(255,255,255,.45)', 'background').replacement, 'color-mix(in srgb, var(--t-surface) 45%, transparent)');
  assert.equal(m('rgba(255,255,255,.3)').replacement, 'color-mix(in srgb, var(--t-surface) 30%, transparent)');
  assert.equal(m('rgba(26,26,26,.8)').replacement, 'color-mix(in srgb, var(--t-text-body) 80%, transparent)');
  assert.equal(m('rgba(90,83,70,.7)').replacement, 'color-mix(in srgb, var(--t-text-eyebrow) 70%, transparent)');
  assert.equal(m('rgba(0,0,0,.05)').replacement, 'color-mix(in srgb, var(--t-text-strong) 5%, transparent)');
  assert.equal(m('rgba(212,196,171,.82)').replacement, 'var(--t-glass-border)');
  assert.equal(m('rgba(245,241,223,.55)').replacement, 'var(--t-chrome)');
  assert.equal(m('rgba(245,241,223,.85)').replacement, 'var(--t-chrome-strong)');
  assert.equal(m('rgba(245,241,223,.3)').status, 'ambiguous', 'chrome tokens bake their alpha in');
  assert.equal(m('rgba(22,20,18,.42)').replacement, 'var(--t-overlay)');
  assert.equal(m('hsl(185, 100%, 45%)').replacement, 'var(--t-accent-bright)');
  assert.equal(m('hsl(262, 100%, 55%)').replacement, 'var(--t-support-1)');
  assert.equal(m('hsl(314, 100%, 50%)').replacement, 'var(--t-support-2)');
  assert.equal(m('hsla(185, 100%, 58%, 0.12)').replacement, 'color-mix(in srgb, var(--t-comet-1) 12%, transparent)');
  assert.equal(m('hsla(320, 80%, 80%, 0.97)').replacement, 'color-mix(in srgb, var(--t-comet-7) 97%, transparent)');
  assert.equal(m('hsl(10, 10%, 10%)').status, 'unmapped');
});

test('every mapped opaque / named-token literal equals that token in the light baseline (no hidden colour change)', () => {
  const t = resolveTheme(BASELINE_DEFINITION, 'light');
  const check = (lit, prop) => {
    const r = mapLiteral(lit, prop);
    assert.equal(r.status, 'mapped', lit);
    const id = r.token.slice(4);
    const role = t.roles[id];
    assert.ok(role, `${lit} -> ${r.token} is not a token`);
    return role;
  };
  for (const hex of ['#2a2420', '#0a0a0a', '#1a1a1a', '#faf7f2', '#285f3b', '#4a9e5c', '#67533d', '#d4a843', '#9f1f17', '#1d4ed8', '#2f6fed']) {
    assert.equal(check(hex).hex, hex, hex);
  }
  assert.equal(check('#ffffff', 'background').hex, '#ffffff');
  for (const [lit, rgba] of [
    ['rgba(42,36,32,.08)', [42, 36, 32, 0.08]], ['rgba(42,36,32,.12)', [42, 36, 32, 0.12]], ['rgba(42,36,32,.22)', [42, 36, 32, 0.22]],
    ['rgba(42,36,32,.38)', [42, 36, 32, 0.38]], ['rgba(42,36,32,.52)', [42, 36, 32, 0.52]], ['rgba(42,36,32,.72)', [42, 36, 32, 0.72]],
    ['rgba(255,255,255,.5)', [255, 255, 255, 0.5]], ['rgba(255,255,255,.62)', [255, 255, 255, 0.62]], ['rgba(255,255,255,.78)', [255, 255, 255, 0.78]],
    ['rgba(212,196,171,.82)', [212, 196, 171, 0.82]], ['rgba(245,241,223,.55)', [245, 241, 223, 0.55]], ['rgba(245,241,223,.85)', [245, 241, 223, 0.85]],
    ['rgba(22,20,18,.42)', [22, 20, 18, 0.42]], ['rgba(245,241,223,.08)', [245, 241, 223, 0.08]],
  ]) {
    const role = check(lit);
    assert.deepEqual(role.rgba, rgba, lit);
  }
  const hsl = (h, s, l) => {
    const [r, g, b] = hslToSrgb01({ h: h / 360, s: s / 100, l: l / 100 });
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  };
  for (const [lit, [h, s, l]] of [['hsl(185, 100%, 45%)', [185, 100, 45]], ['hsl(262, 100%, 55%)', [262, 100, 55]], ['hsl(314, 100%, 50%)', [314, 100, 50]]]) {
    const role = check(lit);
    const want = hsl(h, s, l);
    role.rgba.slice(0, 3).forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= 1, `${lit} channel ${i}`));
  }
  void formatHex;
});

// ---------- codemod ----------

test('codemod (CSS): rewrites only exact matches, reports the rest, leaves black shadows and selectors alone', () => {
  const css = [
    '#2a2420 { margin: 0; }',
    '.card { color: #2a2420; background: #fff; border: 1px solid rgba(42,36,32,.12); box-shadow: 0 1px 2px rgba(0,0,0,.1); }',
    '.x { color: #fff; background: #123456; border-color: rgba(42,36,32,.14); }',
  ].join('\n');
  const out = applyCodemod(css, { file: 'a.css' });
  assert.equal(out.text, [
    '#2a2420 { margin: 0; }',
    '.card { color: var(--t-text); background: var(--t-surface); border: 1px solid var(--t-border-subtle); box-shadow: 0 1px 2px rgba(0,0,0,.1); }',
    '.x { color: #fff; background: #123456; border-color: color-mix(in srgb, var(--t-text) 14%, transparent); }',
  ].join('\n'));
  const by = (s) => out.report.filter((r) => r.status === s).map((r) => r.literal);
  assert.deepEqual(by('changed'), ['#2a2420', '#fff', 'rgba(42,36,32,.12)', 'rgba(42,36,32,.14)']);
  assert.deepEqual(by('ambiguous'), ['#fff']);
  assert.deepEqual(by('unmapped'), ['#123456']);
  assert.equal(out.counts.skippedBlackShadow, 1);
  assert.equal(out.changed, true);
});

test('codemod (JSX): only the allowed style keys, only inside string values; the rest is reported as not attempted', () => {
  const jsx = [
    "const s = { color: '#2a2420', backgroundColor: '#fff', border: '1px solid rgba(42,36,32,.12)', boxShadow: '0 2px 4px rgba(0,0,0,.2), 0 0 0 1px rgba(42,36,32,.08)' };",
    '<rect fill="#fff" stroke="#2a2420" />',
    "const other = { accentColor: '#2a2420', content: '#fff' };",
    "const dyn = { color: `rgba(${r},0,0,.5)` };",
  ].join('\n');
  const out = applyCodemod(jsx, { file: 'x.jsx' });
  assert.ok(out.text.includes("color: 'var(--t-text)'"));
  assert.ok(out.text.includes("backgroundColor: 'var(--t-surface)'"));
  assert.ok(out.text.includes("border: '1px solid var(--t-border-subtle)'"));
  assert.ok(out.text.includes("boxShadow: '0 2px 4px rgba(0,0,0,.2), 0 0 0 1px var(--t-border-faint)'"));
  assert.ok(out.text.includes('<rect fill="#fff" stroke="var(--t-text)" />'), 'fill #fff is ambiguous (white text/icon on a fill)');
  assert.ok(out.text.includes("accentColor: '#2a2420'"), 'keys outside the allowed set are not touched');
  assert.ok(out.text.includes("content: '#fff'"));
  const na = out.report.filter((r) => r.status === 'not-attempted').map((r) => r.literal);
  assert.deepEqual(na, ['#2a2420', '#fff']);
  assert.ok(out.report.some((r) => r.status === 'ambiguous' && r.property === 'fill'));
});

test('codemod is idempotent and a dry run does not need file access', () => {
  const css = '.a { color: #2a2420; background: rgba(255,255,255,.3); }';
  const once = applyCodemod(css, { file: 'a.css' });
  const twice = applyCodemod(once.text, { file: 'a.css' });
  assert.equal(twice.text, once.text);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.report.filter((r) => r.status === 'changed'), []);
});
