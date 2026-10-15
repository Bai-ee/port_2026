// Master v2 edit helpers: contrast, surface depth, hue spread, global mode settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../edit.js';
import { BASELINE_DEFINITION as B } from '../baseline.js';
import { resolveBoth } from '../resolve.js';
import { validateDefinition, normalizeDefinition, hashDefinition } from '../validate.js';
import { ROLE_IDS, getRoleDef } from '../roles.js';
import { MODES } from '../constants.js';

const canon = (d) => JSON.stringify(normalizeDefinition(d));
const tweakable = (id) => E.isTweakRole(id);

test('defaults are identity: same object, same resolved output', () => {
  assert.equal(E.setContrast(B, 1), B);
  assert.equal(E.setSurfaceDepth(B, 'dark', 0), B);
  assert.equal(E.setHueSpread(B, 1), B);
  assert.equal(E.setModeSettingsAll(B, { lightnessShift: 0, chromaScale: 1 }), B);
  const there = E.setSurfaceDepth(E.setContrast(B, 1.3), 'dark', 0.05);
  const back = E.setSurfaceDepth(E.setContrast(there, 1), 'dark', 0);
  assert.equal(canon(back), canon(B), 'returning both knobs to default restores the baseline exactly');
  assert.equal(hashDefinition(back), hashDefinition(B));
  assert.deepEqual(resolveBoth(back).light.tokens, resolveBoth(B).light.tokens);
  assert.deepEqual(resolveBoth(back).dark.tokens, resolveBoth(B).dark.tokens);
});

test('an unused knob never appears in the canonical form (production stays byte-identical)', () => {
  assert.equal(B.modes.light.settings.contrast, undefined);
  assert.equal(normalizeDefinition(B).modes.dark.settings.surfaceDepth, undefined);
  const d = E.setContrast(B, 1.2);
  assert.equal(d.modes.light.settings.contrast, 1.2);
  assert.equal(d.modes.dark.settings.contrast, 1.2);
  assert.equal(d.modes.light.settings.surfaceDepth, undefined);
});

test('edited definitions are already canonical and validate cleanly', () => {
  for (const d of [E.setContrast(B, 1.37), E.setSurfaceDepth(B, 'dark', -0.08), E.setHueSpread(B, 0.4)]) {
    assert.equal(JSON.stringify(d), canon(d));
    const r = validateDefinition(d);
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, []);
  }
});

test('contrast moves ONLY auto surfaces / text / dashboard roles', () => {
  const d = E.setContrast(B, 1.4);
  for (const m of MODES) {
    for (const id of ROLE_IDS) {
      const a = B.modes[m].roles[id];
      const b = d.modes[m].roles[id];
      if (a.link === 'auto' && tweakable(id)) continue;
      assert.equal(b, a, `${m}.${id} must keep identity`);
    }
  }
  assert.ok(d.modes.light.roles['text-strong'].base.l < B.modes.light.roles['text-strong'].base.l, 'dark ink gets darker');
  assert.ok(d.modes.dark.roles['text-strong'].base.l > B.modes.dark.roles['text-strong'].base.l, 'light ink gets lighter');
  assert.ok(d.modes.dark.roles.page.base.l < B.modes.dark.roles.page.base.l);
  assert.equal(d.modes.light.roles.accent, B.modes.light.roles.accent, 'accent is not a contrast role');
});

test('contrast leaves custom, locked and object-linked roles alone', () => {
  let d = E.setRoleCustom(B, 'light', 'page', { l: 0.9, c: 0.01, h: 40, a: 1 });
  d = E.setLocked(d, 'dark', 'text', true);
  const e = E.setContrast(d, 0.6);
  assert.equal(e.modes.light.roles.page, d.modes.light.roles.page);
  assert.equal(e.modes.dark.roles.text, d.modes.dark.roles.text);
  assert.equal(e.modes.light.roles['text-secondary'], d.modes.light.roles['text-secondary'], 'object link untouched');
  assert.notEqual(e.modes.light.roles.surface.base.l, d.modes.light.roles.surface.base.l);
});

test('contrast bounds clamp and ignore non-finite input', () => {
  assert.equal(E.setContrast(B, 99).modes.light.settings.contrast, 1.5);
  assert.equal(E.setContrast(B, -3).modes.dark.settings.contrast, 0.5);
  assert.equal(E.setContrast(B, NaN), B);
  assert.equal(E.setContrast(B, '1.2'), B);
  const extreme = E.setContrast(B, 1.5);
  for (const m of MODES) for (const id of ROLE_IDS) {
    const l = extreme.modes[m].roles[id].base.l;
    assert.ok(l >= 0 && l <= 1, `${m}.${id} l in [0,1]`);
  }
});

test('contrast is lossless across drags: 1 -> 1.5 -> 1 restores the baseline', () => {
  let d = E.setContrast(B, 1.5);
  d = E.setContrast(d, 0.5);
  d = E.setContrast(d, 1);
  assert.equal(canon(d), canon(B));
});

test('hand-edited base lightness moves relative to its current value', () => {
  const edited = E.setRoleBase(B, 'light', 'text', { l: 0.3 });
  const up = E.setContrast(edited, 1.2);
  assert.equal(up.modes.light.roles.text.base.l, 0.26);
  const down = E.setContrast(up, 1);
  assert.equal(down.modes.light.roles.text.base.l, 0.3);
});

test('contrast can target one palette', () => {
  const d = E.setContrast(B, 1.3, ['dark']);
  assert.equal(d.modes.light, B.modes.light);
  assert.equal(d.modes.dark.settings.contrast, 1.3);
});

test('surface depth: dark auto surfaces only, sign and bounds', () => {
  const d = E.setSurfaceDepth(B, 'dark', 0.05);
  for (const id of ['page', 'surface', 'raised', 'inset']) {
    assert.ok(d.modes.dark.roles[id].base.l < B.modes.dark.roles[id].base.l, id);
  }
  assert.equal(d.modes.light, B.modes.light);
  assert.equal(d.modes.dark.roles.text, B.modes.dark.roles.text);
  assert.equal(d.modes.dark.roles.chrome, B.modes.dark.roles.chrome, 'depth is the four solid surfaces');
  const lift = E.setSurfaceDepth(B, 'dark', -0.05);
  assert.ok(lift.modes.dark.roles.page.base.l > B.modes.dark.roles.page.base.l);
  assert.equal(E.setSurfaceDepth(B, 'dark', 5).modes.dark.settings.surfaceDepth, 0.15);
  assert.equal(E.setSurfaceDepth(B, 'dark', -5).modes.dark.settings.surfaceDepth, -0.15);
  assert.equal(E.setSurfaceDepth(B, 'dark', Infinity), B);
  assert.equal(E.setSurfaceDepth(B, 'sepia', 0.1), B);
});

test('surface depth skips custom / locked surfaces and composes with contrast', () => {
  const custom = E.setRoleCustom(B, 'dark', 'page', { l: 0.2, c: 0.01, h: 40, a: 1 });
  const d = E.setSurfaceDepth(custom, 'dark', 0.1);
  assert.equal(d.modes.dark.roles.page, custom.modes.dark.roles.page);
  const both = E.setSurfaceDepth(E.setContrast(B, 1.2), 'dark', 0.04);
  const other = E.setContrast(E.setSurfaceDepth(B, 'dark', 0.04), 1.2);
  assert.equal(canon(both), canon(other), 'order of the two knobs does not matter');
});

test('hue spread scales the three offsets from the baseline and reads back', () => {
  assert.equal(E.getHueSpread(B), 1);
  const d = E.setHueSpread(B, 0.5);
  assert.deepEqual(d.offsets, { accentBright: 3, support1: 43, support2: 71 });
  assert.equal(E.getHueSpread(d), 0.5);
  const wide = E.setHueSpread(B, 2);
  assert.equal(wide.offsets.support2, 180, 'offsets stay within +-180');
  assert.deepEqual(E.setHueSpread(B, 0).offsets, { accentBright: 0, support1: 0, support2: 0 });
  assert.equal(E.setHueSpread(B, 9).offsets.support1, E.setHueSpread(B, 2).offsets.support1, 'clamped to 2');
  assert.equal(E.setHueSpread(B, NaN), B);
});

test('setModeSettingsAll writes both palettes and clamps', () => {
  const d = E.setModeSettingsAll(B, { lightnessShift: 0.05, chromaScale: 1.5 });
  for (const m of MODES) assert.deepEqual(d.modes[m].settings, { lightnessShift: 0.05, chromaScale: 1.5 });
  assert.equal(E.setModeSettingsAll(B, { lightnessShift: 9 }).modes.dark.settings.lightnessShift, 0.15);
});

test('resetMode clears the tweak fields together with the role bases', () => {
  const d = E.setSurfaceDepth(E.setContrast(B, 1.4), 'dark', 0.06);
  const r = E.resetMode(d, 'dark');
  assert.equal(JSON.stringify(r.modes.dark), JSON.stringify(B.modes.dark));
  assert.equal(r.modes.light.settings.contrast, 1.4, 'the other palette keeps its knob');
});

test('copyMode with settings carries the tweak fields only on a full copy', () => {
  const d = E.setContrast(B, 1.4, ['light']);
  const full = E.copyMode(d, 'light', 'dark', { settings: true });
  assert.equal(full.modes.dark.settings.contrast, 1.4);
  const subset = E.copyMode(d, 'light', 'dark', { settings: true, roleIds: ['page'] });
  assert.equal(subset.modes.dark.settings.contrast, undefined);
});

test('validate: bounds clamp with a warning, defaults are omitted, unknown keys still dropped', () => {
  const raw = JSON.parse(JSON.stringify(B));
  raw.modes.light.settings.contrast = 9;
  raw.modes.dark.settings.surfaceDepth = -9;
  raw.modes.dark.settings.bogus = 1;
  const r = validateDefinition(raw);
  assert.equal(r.ok, true);
  assert.equal(r.definition.modes.light.settings.contrast, 1.5);
  assert.equal(r.definition.modes.dark.settings.surfaceDepth, -0.2);
  assert.ok(r.warnings.some((w) => w.code === 'CLAMPED' && w.path.endsWith('settings.contrast')));
  assert.ok(r.warnings.some((w) => w.code === 'UNKNOWN_KEY' && w.path.endsWith('settings.bogus')));
  raw.modes.light.settings.contrast = 1;
  raw.modes.dark.settings.surfaceDepth = 0;
  assert.equal(validateDefinition(raw).definition.modes.light.settings.contrast, undefined);
  raw.modes.light.settings.contrast = NaN;
  assert.equal(validateDefinition(raw).errors[0].code, 'NONFINITE');
});

test('every tweak role resolves to a valid role and group', () => {
  for (const id of ROLE_IDS) assert.equal(typeof E.isTweakRole(id), 'boolean');
  for (const id of ['page', 'surface', 'raised', 'inset']) assert.equal(getRoleDef(id).group, 'surfaces');
});
