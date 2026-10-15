import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../edit.js';
import { BASELINE_DEFINITION, createBaseline } from '../baseline.js';
import { resolveTheme, resolveBoth } from '../resolve.js';
import { validateDefinition, normalizeDefinition } from '../validate.js';
import { ROLE_IDS } from '../roles.js';

const B = BASELINE_DEFINITION; // deep frozen: any mutation attempt throws in strict mode

test('structural sharing: untouched subtrees keep identity', () => {
  const a = E.setMasterHue(B, 120);
  assert.notEqual(a, B);
  assert.equal(a.modes, B.modes);
  assert.equal(a.scene, B.scene);
  assert.equal(a.offsets, B.offsets);
  assert.notEqual(a.master, B.master);
  const b = E.setRoleBase(B, 'dark', 'page', { l: 0.2 });
  assert.equal(b.modes.light, B.modes.light);
  assert.equal(b.modes.dark.settings, B.modes.dark.settings);
  assert.equal(b.modes.dark.roles.text, B.modes.dark.roles.text);
  assert.notEqual(b.modes.dark.roles.page, B.modes.dark.roles.page);
  assert.equal(b.scene, B.scene);
  const c = E.setSceneFollow(B, 'light', { opacityMul: 2 });
  assert.equal(c.modes, B.modes);
  assert.equal(c.scene.dark, B.scene.dark);
});

test('no-op edits return the very same object', () => {
  assert.equal(E.setMasterHue(B, 201), B);
  assert.equal(E.setMasterHue(B, 201 + 360), B);
  assert.equal(E.setIntensity(B, 1), B);
  assert.equal(E.setOffset(B, 'support1', 86), B);
  assert.equal(E.setNeutral(B, { tintStrength: 1 }), B);
  assert.equal(E.setModeSettings(B, 'light', { lightnessShift: 0 }), B);
  assert.equal(E.setRoleBase(B, 'light', 'page', { l: 1 }), B);
  assert.equal(E.setFeatures(B, { focusRing: false }), B);
  assert.equal(E.setViewerPreference(B, 'light'), B);
  assert.equal(E.setSceneSource(B, 'light', 'follow'), B);
  assert.equal(E.resetRole(B, 'light', 'accent'), B);
  assert.equal(E.resetMode(B, 'dark'), B);
  assert.equal(E.setLocked(B, 'light', 'accent', false), B);
  assert.equal(E.resetScene(B, 'dark'), B);
});

test('invalid arguments are ignored (return the same definition)', () => {
  assert.equal(E.setMasterHue(B, NaN), B);
  assert.equal(E.setMasterHue(B, '90'), B);
  assert.equal(E.setIntensity(B, Infinity), B);
  assert.equal(E.setOffset(B, 'nope', 5), B);
  assert.equal(E.setModeSettings(B, 'sepia', { chromaScale: 1 }), B);
  assert.equal(E.setRoleBase(B, 'light', 'not-a-role', { l: 0.5 }), B);
  assert.equal(E.setRoleCustom(B, 'light', 'accent', { l: 0.5 }), B);
  assert.equal(E.setRoleLink(B, 'light', 'text-muted', { to: 'ghost' }), B);
  assert.equal(E.setRoleLink(B, 'light', 'text-muted', 'weird'), B);
  assert.equal(E.setViewerPreference(B, 'auto'), B);
});

test('every edit yields an already-canonical definition (clamped + rounded)', () => {
  let d = B;
  d = E.setMasterHue(d, -13.456789);
  d = E.setIntensity(d, 7);
  d = E.setOffset(d, 'accentBright', 999);
  d = E.setNeutral(d, { tintStrength: -1, hue: 400.555, hueSource: 'master' });
  d = E.setModeSettings(d, 'dark', { lightnessShift: 0.123456, chromaScale: 5 });
  d = E.setRoleBase(d, 'light', 'accent', { l: 1.5, c: 0.123456, a: -1 });
  d = E.setRoleCustom(d, 'dark', 'focus', { l: 0.77777, c: 0.111111, h: -721.123, a: 0.55555 });
  d = E.setRoleLink(d, 'light', 'text-faint', { to: 'accent', dL: 0.123456, dH: 123.456, a: 0.3333 });
  d = E.setSceneFollow(d, 'light', { hueShiftDeg: 999, hueSpan: 0.001, opacityMul: 9 });
  d = E.setSceneCustom(d, 'dark', { base: { l: 2, c: 0.123456, h: 725 }, highlightStrength: 3, secondary: { h: 10 } });
  assert.deepEqual(normalizeDefinition(d), d);
  assert.equal(JSON.stringify(normalizeDefinition(d)), JSON.stringify(d));
  const v = validateDefinition(d);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.warnings, [], 'no clamping warnings: edit helpers already clamped');
  assert.equal(d.master.hue, 346.54);
  assert.equal(d.master.intensity, 1.5);
  assert.equal(d.offsets.accentBright, 180);
  assert.equal(d.neutral.tintStrength, 0);
  assert.equal(d.neutral.hue, 40.56);
  assert.equal(d.modes.dark.settings.chromaScale, 2);
  assert.deepEqual(d.modes.light.roles.accent.base, { l: 1, c: 0.1235, a: 0 });
  assert.deepEqual(d.modes.dark.roles.focus.custom, { l: 0.7778, c: 0.1111, h: 358.88, a: 0.5556 });
});

test('setRoleCustom keeps lock status and never touches other roles', () => {
  let d = E.setLocked(B, 'light', 'accent', true);
  d = E.setRoleCustom(d, 'light', 'accent', { l: 0.5, c: 0.1, h: 100, a: 1 });
  assert.equal(d.modes.light.roles.accent.locked, true);
  assert.deepEqual(d.modes.light.roles.accent.custom, { l: 0.5, c: 0.1, h: 100, a: 1 });
  assert.equal(d.modes.light.roles.text, B.modes.light.roles.text);
});

test('"Make custom" and "Lock" freeze the CURRENT resolved value (no visual jump)', () => {
  const before = resolveTheme(B, 'light').roles['accent-hover'];
  const custom = E.setRoleLink(B, 'light', 'accent-hover', 'custom');
  const after = resolveTheme(custom, 'light').roles['accent-hover'];
  assert.equal(after.hex, before.hex);
  assert.equal(after.source, 'custom');
  const locked = E.setLocked(B, 'dark', 'support-1', true);
  assert.equal(resolveTheme(locked, 'dark').roles['support-1'].hex, resolveTheme(B, 'dark').roles['support-1'].hex);
  assert.equal(locked.modes.dark.roles['support-1'].link, 'custom');
  assert.equal(locked.modes.dark.roles['support-1'].locked, true);
  // lock survives and blocks a link change; unlock keeps the custom value
  assert.equal(E.setRoleLink(locked, 'dark', 'support-1', 'auto'), locked);
  const unlocked = E.setLocked(locked, 'dark', 'support-1', false);
  assert.equal(unlocked.modes.dark.roles['support-1'].locked, undefined);
  assert.equal(unlocked.modes.dark.roles['support-1'].link, 'custom');
  const auto = E.setRoleLink(unlocked, 'dark', 'support-1', 'auto');
  assert.equal(auto.modes.dark.roles['support-1'].link, 'auto');
});

test('links: cycles refused, cross-mode links resolve, sanitised', () => {
  assert.equal(E.wouldCycle(B, 'light', 'accent', { to: 'accent-pressed' }), true);
  assert.equal(E.wouldCycle(B, 'light', 'accent', { to: 'text' }), false);
  assert.equal(E.setRoleLink(B, 'light', 'accent', { to: 'accent' }), B);
  const d = E.setRoleLink(B, 'dark', 'accent', { to: 'accent', mode: 'light', dL: 0.2, dX: 9 });
  assert.deepEqual(d.modes.dark.roles.accent.link, { to: 'accent', mode: 'light', dL: 0.2 });
  assert.equal(E.setRoleLink(d, 'light', 'accent', { to: 'accent', mode: 'dark' }), d, 'light.accent -> dark.accent -> light.accent');
});

test('copyMode: skips locked destination roles, never copies the lock, rebases cross-mode links', () => {
  let d = E.setRoleCustom(B, 'dark', 'text', { l: 0.5, c: 0.01, h: 10, a: 1 });
  d = E.setLocked(d, 'dark', 'text', true);
  d = E.setRoleBase(d, 'light', 'accent', { l: 0.61 });
  d = E.setLocked(d, 'light', 'focus', true);
  const copied = E.copyMode(d, 'light', 'dark');
  assert.deepEqual(copied.modes.dark.roles.text, d.modes.dark.roles.text, 'locked destination untouched');
  assert.equal(copied.modes.dark.roles.accent.base.l, 0.61);
  assert.equal(copied.modes.dark.roles.page.base.l, 1);
  assert.equal(copied.modes.dark.roles.focus.locked, undefined, 'lock flag is not copied');
  assert.equal(copied.modes.dark.roles.focus.link, 'custom');
  assert.equal(copied.modes.light, d.modes.light, 'source untouched');
  assert.equal(copied.modes.dark.settings, d.modes.dark.settings, 'settings only with { settings:true }');
  const only = E.copyMode(d, 'light', 'dark', { roleIds: ['accent'] });
  assert.equal(only.modes.dark.roles.accent.base.l, 0.61);
  assert.equal(only.modes.dark.roles.page, d.modes.dark.roles.page);
  const forced = E.copyMode(d, 'light', 'dark', { roleIds: ['text'], skipLocked: false });
  assert.deepEqual(forced.modes.dark.roles.text.base, d.modes.light.roles.text.base);
  assert.equal(E.copyMode(d, 'light', 'light'), d);
  const withSettings = E.copyMode(E.setModeSettings(d, 'light', { lightnessShift: 0.05 }), 'light', 'dark', { settings: true, roleIds: [] });
  assert.equal(withSettings.modes.dark.settings.lightnessShift, 0.05);
  // rebase of cross-mode links
  let x = E.setRoleLink(B, 'dark', 'accent', { to: 'accent', mode: 'light' });
  x = E.copyMode(x, 'dark', 'light', { roleIds: ['accent'] });
  assert.equal(x.modes.light.roles.accent.link, 'auto', 'a rebased self link would be a cycle, so the copy is skipped');
});

test('linkModes: dark follows light; locked skipped; cycles skipped', () => {
  let d = E.setLocked(B, 'dark', 'accent', true);
  const l = E.linkModes(d, 'light', 'dark', ['accent', 'text', 'page']);
  assert.equal(l.modes.dark.roles.accent, d.modes.dark.roles.accent);
  assert.deepEqual(l.modes.dark.roles.text.link, { to: 'text', mode: 'light' });
  const pair = resolveBoth(l);
  assert.equal(pair.dark.roles.text.hex, pair.light.roles.text.hex);
  assert.equal(pair.dark.roles.page.hex, pair.light.roles.page.hex);
  // linking back the other way would close a cycle and is skipped
  const back = E.linkModes(l, 'dark', 'light', ['text']);
  assert.equal(back.modes.light.roles.text, l.modes.light.roles.text);
  assert.equal(E.linkModes(B, 'light', 'light', ['text']), B);
  assert.equal(validateDefinition(l).ok, true);
});

test('resetRole / resetMode / resetScene return to the baseline; resetMode keeps locked roles', () => {
  let d = E.setRoleBase(B, 'light', 'page', { l: 0.95 });
  d = E.setRoleCustom(d, 'light', 'accent', { l: 0.5, c: 0.1, h: 100, a: 1 });
  d = E.setLocked(d, 'light', 'accent', true);
  d = E.setModeSettings(d, 'light', { lightnessShift: 0.1, chromaScale: 0.5 });
  const r = E.resetRole(d, 'light', 'page');
  assert.deepEqual(r.modes.light.roles.page, B.modes.light.roles.page);
  assert.equal(r.modes.light.roles.accent, d.modes.light.roles.accent);
  const m = E.resetMode(d, 'light');
  assert.deepEqual(m.modes.light.settings, B.modes.light.settings);
  assert.deepEqual(m.modes.light.roles.page, B.modes.light.roles.page);
  assert.deepEqual(m.modes.light.roles.accent, d.modes.light.roles.accent, 'locked role survives resetMode');
  assert.equal(m.modes.dark, d.modes.dark);
  // an explicit single-role reset DOES unlock (explicit user action)
  const single = E.resetRole(d, 'light', 'accent');
  assert.deepEqual(single.modes.light.roles.accent, B.modes.light.roles.accent);
  const sc = E.resetScene(E.setSceneFollow(B, 'light', { hueSpan: 0.3 }), 'light');
  assert.deepEqual(sc.scene.light, B.scene.light);
});

test('master moves never destroy custom or locked roles (property check over many hues)', () => {
  let d = E.setRoleCustom(B, 'light', 'accent', { l: 0.6, c: 0.14, h: 321.5, a: 1 });
  d = E.setLocked(d, 'dark', 'danger-solid', true);
  for (let h = 0; h < 360; h += 17) {
    const m = E.setIntensity(E.setMasterHue(d, h), (h % 150) / 100);
    assert.deepEqual(m.modes.light.roles.accent, d.modes.light.roles.accent);
    assert.deepEqual(m.modes.dark.roles['danger-solid'], d.modes.dark.roles['danger-solid']);
  }
});

test('scene setters clamp and merge', () => {
  const f = E.setSceneFollow(B, 'dark', { saturationMul: 5, lightnessDelta: -9, hueSpan: 0 });
  assert.deepEqual(
    [f.scene.dark.follow.saturationMul, f.scene.dark.follow.lightnessDelta, f.scene.dark.follow.hueSpan],
    [1.5, -0.5, 0.05]
  );
  const c = E.setSceneCustom(B, 'light', { secondary: { l: 0.5 } });
  assert.deepEqual(c.scene.light.custom.secondary, { l: 0.5, c: B.scene.light.custom.base.c, h: B.scene.light.custom.base.h });
  assert.equal(E.setSceneCustom(c, 'light', { secondary: null }).scene.light.custom.secondary, null);
  assert.equal(E.setSceneSource(B, 'light', 'neon'), B);
});

test('edits never mutate their input (input is deep frozen) and ROLE_IDS stay complete', () => {
  const d = E.copyMode(E.linkModes(E.setRoleCustom(B, 'light', 'accent', { l: 0.5, c: 0.1, h: 3, a: 1 }), 'light', 'dark', ['page']), 'light', 'dark', { roleIds: ['accent'] });
  assert.deepEqual(Object.keys(d.modes.dark.roles), [...ROLE_IDS]);
  assert.deepEqual(B, createBaseline());
});
