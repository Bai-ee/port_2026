import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, resolveBoth } from '../resolve.js';
import { BASELINE_DEFINITION, createBaseline } from '../baseline.js';
import { TOKEN_NAMES } from '../tokens.js';
import { ROLE_IDS } from '../roles.js';
import { validateDefinition } from '../validate.js';
import {
  setMasterHue, setIntensity, setModeSettings, setRoleCustom, setRoleLink, setRoleBase, setLocked, setNeutral,
} from '../edit.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k]);
    return out;
  }
  return v;
}

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

test('determinism: repeated calls, key order and frozen input are irrelevant', () => {
  const a = resolveTheme(BASELINE_DEFINITION, 'light');
  const b = resolveTheme(BASELINE_DEFINITION, 'light');
  assert.deepEqual(a, b);
  assert.deepEqual(resolveTheme(reverseKeys(BASELINE_DEFINITION), 'light'), a);
  assert.deepEqual(resolveTheme(deepFreeze(createBaseline()), 'dark'), resolveTheme(BASELINE_DEFINITION, 'dark'));
  const pair = resolveBoth(BASELINE_DEFINITION);
  assert.deepEqual(pair.light, a);
  assert.deepEqual(pair.dark, resolveTheme(BASELINE_DEFINITION, 'dark'));
});

test('resolved shape: tokens follow TOKEN_NAMES exactly and every role is present', () => {
  const t = resolveTheme(BASELINE_DEFINITION, 'light');
  assert.deepEqual(Object.keys(t.tokens), [...TOKEN_NAMES]);
  assert.deepEqual(Object.keys(t.roles), [...ROLE_IDS]);
  for (const name of TOKEN_NAMES) assert.equal(typeof t.tokens[name], 'string', name);
  assert.equal(t.version, 1);
  assert.equal(t.mode, 'light');
  assert.equal(t.definitionId, 'baseline');
  assert.match(t.hash, /^[0-9a-f]{8}$/);
  assert.deepEqual(t.meta, { masterHue: 201, intensity: 1, tintStrength: 1 });
  const r = t.roles.text;
  assert.deepEqual(Object.keys(r).sort(), ['css', 'gamut', 'hex', 'id', 'kind', 'locked', 'mapped', 'oklch', 'rgba', 'source', 'value'].sort());
  assert.equal(r.css, '--t-text');
  assert.equal(r.value, r.hex);
  assert.equal(t.tokens['--t-text-secondary'], 'rgba(42, 36, 32, 0.72)');
  assert.equal(t.roles['text-secondary'].kind, 'alpha');
  assert.equal(t.roles.text.kind, 'solid');
});

test('precedence 1-2: preset base, then linked generation (hue rule, intensity, tint)', () => {
  const base = resolveTheme(BASELINE_DEFINITION, 'light');
  near(base.roles.accent.oklch.h, 201);
  near(base.roles.accent.oklch.c, 0.1156, 1e-6);
  const half = resolveTheme(setIntensity(BASELINE_DEFINITION, 0.5), 'light');
  near(half.roles.accent.oklch.c, 0.0578, 1e-6, 'intensity scales accent-family chroma');
  near(half.roles.text.oklch.c, base.roles.text.oklch.c, 1e-9, 'intensity does not touch neutrals');
  const tinted = resolveTheme(setNeutral(BASELINE_DEFINITION, { tintStrength: 2 }), 'light');
  near(tinted.roles.text.oklch.c, base.roles.text.oklch.c * 2, 1e-4, 'tint scales neutrals');
  near(tinted.roles.accent.oklch.c, base.roles.accent.oklch.c, 1e-9);
  // support-1 = master + offset(86)
  near(base.roles['support-1'].oklch.h, 287);
  // linked role follows its target's FINAL value
  assert.equal(base.roles['text-secondary'].source, 'link');
  near(base.roles['text-secondary'].oklch.l, base.roles.text.oklch.l, 1e-9);
  near(base.roles['accent-hover'].oklch.l, base.roles.accent.oklch.l - 0.05, 1e-9);
  const moved = resolveTheme(setRoleBase(BASELINE_DEFINITION, 'light', 'text', { l: 0.4 }), 'light');
  near(moved.roles['text-secondary'].oklch.l, 0.4, 1e-9);
  near(moved.roles['text-secondary'].oklch.a, 0.72, 1e-9);
});

test('precedence 3: mode settings only touch roles flagged modeSettings that are auto/link and unlocked', () => {
  const d = setModeSettings(BASELINE_DEFINITION, 'light', { lightnessShift: 0.05, chromaScale: 0.5 });
  const t = resolveTheme(d, 'light');
  const b = resolveTheme(BASELINE_DEFINITION, 'light');
  near(t.roles.accent.oklch.l, b.roles.accent.oklch.l + 0.05, 1e-9);
  near(t.roles.accent.oklch.c, b.roles.accent.oklch.c * 0.5, 1e-9);
  near(t.roles['comet-3'].oklch.l, b.roles['comet-3'].oklch.l + 0.05, 1e-9);
  assert.deepEqual(t.roles.text.oklch, b.roles.text.oklch, 'text is not flagged');
  assert.deepEqual(t.roles.success.oklch, b.roles.success.oklch, 'status is not flagged');
  assert.deepEqual(t.roles['dash-page'].oklch, b.roles['dash-page'].oklch);
  // accent-hover derives from the final (shifted) accent, so it moves exactly once
  near(t.roles['accent-hover'].oklch.l, t.roles.accent.oklch.l - 0.05, 1e-9);
  // the other mode is untouched
  assert.deepEqual(resolveTheme(d, 'dark').roles.accent.oklch, resolveTheme(BASELINE_DEFINITION, 'dark').roles.accent.oklch);
  // custom accent ignores mode settings
  const c = setRoleCustom(d, 'light', 'accent', { l: 0.6, c: 0.1, h: 20, a: 1 });
  assert.deepEqual(
    { ...resolveTheme(c, 'light').roles.accent.oklch },
    { l: 0.6, c: 0.1, h: 20, a: 1 }
  );
});

test('precedence 3: a modeSettings role linked to another modeSettings role does not double-apply the shift', () => {
  let d = setModeSettings(BASELINE_DEFINITION, 'light', { lightnessShift: 0.1, chromaScale: 0.5 });
  d = setRoleLink(d, 'light', 'support-1', { to: 'accent' });
  const t = resolveTheme(d, 'light');
  near(t.roles['support-1'].oklch.l, t.roles.accent.oklch.l, 1e-9, 'link tracks target lightness');
  near(t.roles['support-1'].oklch.c, t.roles.accent.oklch.c, 1e-9, 'link tracks target chroma');
  assert.equal(t.roles['support-1'].source, 'link');
});

test('precedence 4: custom wins and ignores master hue, intensity, tint and mode settings; locked is flagged', () => {
  let d = setRoleCustom(BASELINE_DEFINITION, 'light', 'accent', { l: 0.62, c: 0.15, h: 330, a: 1 });
  d = setLocked(d, 'light', 'accent-bright', true);
  const before = resolveTheme(d, 'light');
  const moved = resolveTheme(setIntensity(setMasterHue(setModeSettings(d, 'light', { lightnessShift: 0.1 }), 10), 1.5), 'light');
  assert.deepEqual(moved.roles.accent.oklch, before.roles.accent.oklch);
  assert.equal(moved.roles.accent.hex, before.roles.accent.hex);
  assert.equal(moved.roles.accent.source, 'custom');
  assert.equal(moved.roles.accent.locked, false);
  assert.equal(moved.roles['accent-bright'].locked, true);
  assert.equal(moved.roles['accent-bright'].hex, before.roles['accent-bright'].hex, 'locked role never moves');
  assert.notEqual(moved.roles['support-1'].hex, before.roles['support-1'].hex, 'auto roles do move');
  // a linked role follows its CUSTOM target
  assert.equal(moved.roles['accent-hover'].source, 'link');
  near(moved.roles['accent-hover'].oklch.l, 0.57, 1e-9);
  near(moved.roles['accent-hover'].oklch.h, 330, 1e-9);
});

test('linked -> linked chains and cross-mode links', () => {
  let d = setRoleLink(BASELINE_DEFINITION, 'light', 'accent-soft', { to: 'accent-hover', a: 0.2 });
  const t = resolveTheme(d, 'light');
  near(t.roles['accent-soft'].oklch.l, t.roles['accent-hover'].oklch.l, 1e-9);
  near(t.roles['accent-soft'].oklch.a, 0.2, 1e-9);
  // dark text follows light text (cross-mode)
  d = setRoleLink(BASELINE_DEFINITION, 'dark', 'text', { to: 'text', mode: 'light' });
  const pair = resolveBoth(d);
  assert.equal(pair.dark.roles.text.hex, pair.light.roles.text.hex);
  assert.equal(pair.dark.roles.text.source, 'link');
  // a role linked to a dL-shifted target
  d = setRoleLink(BASELINE_DEFINITION, 'light', 'border-subtle', { to: 'accent', dL: 0.1, dC: -0.05, dH: 30, a: 0.4 });
  const r = resolveTheme(d, 'light').roles['border-subtle'];
  const a = resolveTheme(d, 'light').roles.accent;
  near(r.oklch.l, a.oklch.l + 0.1, 1e-9);
  near(r.oklch.c, a.oklch.c - 0.05, 1e-6);
  near(r.oklch.h, a.oklch.h + 30, 1e-9);
  near(r.oklch.a, 0.4, 1e-9);
});

test('cycles: edit helpers refuse them, resolve never throws or loops, validation reports LINK_CYCLE', () => {
  const refused = setRoleLink(BASELINE_DEFINITION, 'light', 'accent', { to: 'accent-hover' });
  assert.equal(refused, BASELINE_DEFINITION, 'accent -> accent-hover -> accent is refused');
  const raw = createBaseline();
  raw.modes.light.roles.accent.link = { to: 'accent-hover' }; // accent-hover already links to accent
  const v = validateDefinition(raw);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.code === 'LINK_CYCLE'));
  const t = resolveTheme(raw, 'light'); // must terminate
  assert.match(t.roles.accent.hex, /^#[0-9a-f]{6}$/);
  const cross = createBaseline();
  cross.modes.dark.roles.text.link = { to: 'text', mode: 'light' };
  cross.modes.light.roles.text.link = { to: 'text', mode: 'dark' };
  assert.ok(validateDefinition(cross).errors.some((e) => e.code === 'LINK_CYCLE'));
  assert.match(resolveTheme(cross, 'dark').roles.text.hex, /^#[0-9a-f]{6}$/);
});

test('master move never destroys custom or locked roles', () => {
  let d = setRoleCustom(BASELINE_DEFINITION, 'dark', 'accent-text', { l: 0.77, c: 0.11, h: 12, a: 1 });
  d = setLocked(d, 'dark', 'accent-text', true);
  const keep = JSON.stringify(d.modes.dark.roles['accent-text']);
  for (const h of [0, 45, 90, 180, 270, 359.99]) {
    const moved = setMasterHue(d, h);
    assert.equal(JSON.stringify(moved.modes.dark.roles['accent-text']), keep);
    assert.equal(resolveTheme(moved, 'dark').roles['accent-text'].oklch.h, 12);
  }
});

test('mode: anything but "dark" resolves light', () => {
  assert.equal(resolveTheme(BASELINE_DEFINITION, 'nope').mode, 'light');
  assert.equal(resolveTheme(BASELINE_DEFINITION, 'dark').mode, 'dark');
});

test('composite tokens: mode dependent values', () => {
  const l = resolveTheme(BASELINE_DEFINITION, 'light').tokens;
  const d = resolveTheme(BASELINE_DEFINITION, 'dark').tokens;
  assert.equal(l['--t-blend-deco'], 'multiply');
  assert.equal(d['--t-blend-deco'], 'screen');
  assert.equal(l['--t-logo-blend'], 'darken');
  assert.equal(d['--t-logo-blend'], 'lighten');
  assert.equal(l['--t-logo-filter'], 'none');
  assert.equal(d['--t-logo-filter'], 'invert(1)');
  assert.equal(l['--t-logo-filter-muted'], 'grayscale(1) opacity(.45)');
  assert.equal(d['--t-logo-filter-muted'], 'grayscale(1) invert(1) opacity(.45)');
  assert.equal(l['--t-gradient-accent'], 'linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%)');
  assert.equal(l['--t-term-bg'], 'linear-gradient(180deg, var(--t-term-bg-top) 0%, var(--t-term-bg-bottom) 100%)');
  assert.equal(l['--t-term-shadow'], '0px 4px 10px var(--t-term-shadow-1), 0px 14px 30px var(--t-term-shadow-2)');
  assert.equal(l['--t-shadow-sm'], '0 1px 2px var(--t-shadow)');
  assert.equal(l['--t-shadow-md'], '0 4px 12px var(--t-shadow)');
  assert.equal(l['--t-shadow-lg'], '0 14px 30px var(--t-shadow)');
  assert.equal(l['--t-scene-bg'], l['--t-page']);
  assert.match(l['--t-scene-fallback'], /^radial-gradient\(60% 50% at 30% 20%, #[0-9a-f]{6}33, transparent\), radial-gradient\(50% 50% at 75% 70%, #[0-9a-f]{6}26, transparent\)$/);
  assert.equal(l['--t-scene-base'], resolveTheme(BASELINE_DEFINITION, 'light').scene.swatches.base);
});
