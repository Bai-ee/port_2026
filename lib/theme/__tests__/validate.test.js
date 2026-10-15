import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDefinition, parseDefinition, normalizeDefinition, hashDefinition, canonicalize } from '../validate.js';
import { createBaseline, BASELINE_DEFINITION } from '../baseline.js';
import { ROLE_IDS } from '../roles.js';

const codes = (list) => list.map((i) => i.code);
const withPath = (list, code) => list.find((i) => i.code === code);

test('the baseline is valid with no issues', () => {
  const r = validateDefinition(BASELINE_DEFINITION);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.definition, JSON.parse(JSON.stringify(BASELINE_DEFINITION)));
});

test('malformed JSON text -> JSON_PARSE (never throws)', () => {
  for (const text of ['{', '', 'not json', '{"a":', '[1,', undefined, null, 42]) {
    const r = parseDefinition(text);
    assert.equal(r.ok, false);
    assert.equal(r.definition, null);
    assert.equal(r.errors[0].code, 'JSON_PARSE');
  }
  assert.equal(parseDefinition('﻿' + JSON.stringify(BASELINE_DEFINITION)).ok, true, 'BOM is tolerated');
});

test('wrong top-level types -> NOT_AN_OBJECT', () => {
  for (const v of [null, [], 'x', 5, true, undefined]) {
    const r = validateDefinition(v);
    assert.equal(r.ok, false);
    assert.equal(r.definition, null);
    assert.equal(r.errors[0].code, 'NOT_AN_OBJECT');
  }
});

test('version: missing / bad -> BAD_VERSION, newer -> UNSUPPORTED_VERSION', () => {
  const noVersion = createBaseline();
  delete noVersion.version;
  assert.ok(codes(validateDefinition(noVersion).errors).includes('BAD_VERSION'));
  for (const v of ['1', 1.5, 0, -1, null, NaN]) {
    const d = createBaseline();
    d.version = v;
    assert.ok(codes(validateDefinition(d).errors).includes('BAD_VERSION'), String(v));
  }
  const future = createBaseline();
  future.version = 2;
  const r = validateDefinition(future);
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes('UNSUPPORTED_VERSION'));
  const wrongSchema = createBaseline();
  wrongSchema.schema = 'something.else';
  assert.ok(codes(validateDefinition(wrongSchema).errors).includes('BAD_SCHEMA'));
});

test('missing fields are defaulted from the baseline with a warning', () => {
  const d = createBaseline();
  delete d.master;
  delete d.modes.light.roles.accent;
  delete d.modes.dark.roles.text.base;
  delete d.scene.dark.follow.hueSpan;
  delete d.offsets.support2;
  delete d.meta.name;
  const r = validateDefinition(d);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.warnings.length >= 5);
  assert.ok(r.warnings.every((w) => w.code === 'MISSING_FIELD_DEFAULTED'), JSON.stringify(r.warnings.map((w) => w.code)));
  assert.deepEqual(r.definition.master, { hue: 201, intensity: 1 });
  assert.deepEqual(r.definition.modes.light.roles.accent, BASELINE_DEFINITION.modes.light.roles.accent);
  assert.deepEqual(r.definition.modes.dark.roles.text.base, BASELINE_DEFINITION.modes.dark.roles.text.base);
  assert.equal(r.definition.scene.dark.follow.hueSpan, 0.8);
  assert.equal(r.definition.offsets.support2, 142);
  assert.equal(r.definition.meta.name, 'Baseline');
  const minimal = validateDefinition({ schema: 'hitloop.theme', version: 1 });
  assert.equal(minimal.ok, true);
  assert.equal(Object.keys(minimal.definition.modes.light.roles).length, ROLE_IDS.length);
});

test('NaN / Infinity / strings / null are rejected with NONFINITE (never coerced)', () => {
  for (const bad of [NaN, Infinity, -Infinity, '12', null, {}, [], true]) {
    const d = createBaseline();
    d.master.hue = bad;
    const r = validateDefinition(d);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.definition, null);
    assert.equal(withPath(r.errors, 'NONFINITE').path, 'master.hue');
  }
  const d = createBaseline();
  d.modes.dark.roles.accent.base.l = Infinity;
  d.modes.light.roles.text.custom = { l: 'x', c: 0, h: 0, a: 1 };
  const r = validateDefinition(d);
  assert.ok(r.errors.some((e) => e.path === 'modes.dark.roles.accent.base.l' && e.code === 'NONFINITE'));
  assert.ok(r.errors.some((e) => e.path === 'modes.light.roles.text.custom.l' && e.code === 'NONFINITE'));
});

test('out-of-range numbers are clamped with a CLAMPED warning', () => {
  const d = createBaseline();
  d.master.intensity = 9;
  d.neutral.tintStrength = -3;
  d.offsets.support1 = 500;
  d.modes.light.settings.lightnessShift = 1;
  d.modes.dark.roles.page.base.l = 2;
  d.scene.light.follow.opacityMul = 99;
  const r = validateDefinition(d);
  assert.equal(r.ok, true);
  assert.equal(r.definition.master.intensity, 1.5);
  assert.equal(r.definition.neutral.tintStrength, 0);
  assert.equal(r.definition.offsets.support1, 180);
  assert.equal(r.definition.modes.light.settings.lightnessShift, 0.15);
  assert.equal(r.definition.modes.dark.roles.page.base.l, 1);
  assert.equal(r.definition.scene.light.follow.opacityMul, 3);
  assert.equal(r.warnings.filter((w) => w.code === 'CLAMPED').length, 6);
});

test('hue anywhere finite is wrapped silently', () => {
  const d = createBaseline();
  d.master.hue = -45.678;
  d.modes.light.roles['dash-accent'].custom.h = 725;
  const r = validateDefinition(d);
  assert.equal(r.ok, true);
  assert.equal(r.definition.master.hue, 314.32);
  assert.equal(r.definition.modes.light.roles['dash-accent'].custom.h, 5);
  assert.deepEqual(r.warnings, []);
});

test('unknown keys and unknown role ids are dropped with UNKNOWN_KEY', () => {
  const d = createBaseline();
  d.extra = 1;
  d.master.sparkle = true;
  d.modes.light.roles['not-a-role'] = { link: 'auto', base: { l: 0, c: 0, a: 1 } };
  d.modes.dark.roles.text.bogus = 1;
  const r = validateDefinition(d);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.filter((w) => w.code === 'UNKNOWN_KEY').length, 4);
  assert.equal('extra' in r.definition, false);
  assert.equal('not-a-role' in r.definition.modes.light.roles, false);
  assert.equal('bogus' in r.definition.modes.dark.roles.text, false);
});

test('link rules: LINK_TARGET_MISSING, LINK_CYCLE, CUSTOM_MISSING, LOCKED_NOT_CUSTOM, BAD_LINK', () => {
  let d = createBaseline();
  d.modes.light.roles['text-muted'].link = { to: 'nope', a: 0.5 };
  assert.ok(codes(validateDefinition(d).errors).includes('LINK_TARGET_MISSING'));
  d = createBaseline();
  d.modes.light.roles['text-muted'].link = { a: 0.5 };
  assert.ok(codes(validateDefinition(d).errors).includes('LINK_TARGET_MISSING'));

  d = createBaseline();
  d.modes.light.roles.accent.link = { to: 'accent-pressed' };
  const cyc = validateDefinition(d);
  assert.equal(cyc.errors.filter((e) => e.code === 'LINK_CYCLE').length, 1, 'one error per cycle');

  d = createBaseline();
  d.modes.light.roles.text.link = { to: 'text' };
  assert.ok(codes(validateDefinition(d).errors).includes('LINK_CYCLE'), 'self link');

  d = createBaseline();
  d.modes.light.roles.accent.link = 'custom';
  assert.ok(codes(validateDefinition(d).errors).includes('CUSTOM_MISSING'));

  d = createBaseline();
  d.modes.light.roles.text.locked = true;
  assert.ok(codes(validateDefinition(d).errors).includes('LOCKED_NOT_CUSTOM'));

  d = createBaseline();
  d.modes.light.roles.text.link = 7;
  assert.ok(codes(validateDefinition(d).errors).includes('BAD_LINK'));

  d = createBaseline();
  d.modes.light.roles.text.locked = 'yes';
  assert.ok(codes(validateDefinition(d).errors).includes('BAD_TYPE'));
});

test('enum fields are validated', () => {
  const d = createBaseline();
  d.defaults.viewerPreference = 'auto';
  d.neutral.hueSource = 'sky';
  d.scene.dark.source = 'magic';
  d.meta.status = 'final';
  const r = validateDefinition(d);
  assert.equal(r.errors.filter((e) => e.code === 'BAD_ENUM').length, 4);
});

test('canonicalisation: rounding, key order, idempotence', () => {
  const d = createBaseline();
  d.master.hue = 200.123456;
  d.modes.light.roles.accent.base = { a: 1, c: 0.123456789, l: 0.6812345 };
  d.neutral = { hue: 56, hueSource: 'fixed', tintStrength: 1.000049 };
  const r = validateDefinition(d);
  assert.equal(r.definition.master.hue, 200.12);
  assert.deepEqual(r.definition.modes.light.roles.accent.base, { l: 0.6812, c: 0.1235, a: 1 });
  assert.equal(r.definition.neutral.tintStrength, 1);
  assert.deepEqual(Object.keys(r.definition.neutral), ['tintStrength', 'hueSource', 'hue']);
  assert.deepEqual(Object.keys(r.definition.modes.light.roles), [...ROLE_IDS]);
  const again = validateDefinition(r.definition);
  assert.deepEqual(again.definition, r.definition);
  assert.equal(JSON.stringify(again.definition), JSON.stringify(r.definition));
  assert.deepEqual(canonicalize(canonicalize(d)), canonicalize(d));
});

test('hash: stable, key-order independent, ignores meta.updatedAt, sensitive to real changes', () => {
  const h = hashDefinition(BASELINE_DEFINITION);
  assert.match(h, /^[0-9a-f]{8}$/);
  const d = createBaseline();
  d.meta.updatedAt = '2030-01-01T00:00:00.000Z';
  assert.equal(hashDefinition(d), h);
  const e = createBaseline();
  e.master.hue = 202;
  assert.notEqual(hashDefinition(e), h);
  const f = createBaseline();
  f.meta.name = 'Renamed';
  assert.notEqual(hashDefinition(f), h);
});

test('normalizeDefinition never throws and falls back to the baseline for garbage', () => {
  for (const v of [null, undefined, 5, 'x', [], { version: 'nope' }]) {
    const n = normalizeDefinition(v);
    assert.equal(n.schema, 'hitloop.theme');
    assert.equal(Object.keys(n.modes.light.roles).length, ROLE_IDS.length);
  }
});

test('locked custom roles validate; custom keeps a hue at zero chroma', () => {
  const d = createBaseline();
  d.modes.light.roles.accent = { link: 'custom', base: { l: 0.5, c: 0, a: 1 }, custom: { l: 0.5, c: 0, h: 123, a: 1 }, locked: true };
  const r = validateDefinition(d);
  assert.equal(r.ok, true);
  assert.equal(r.definition.modes.light.roles.accent.custom.h, 123);
  assert.equal(r.definition.modes.light.roles.accent.locked, true);
});

test('whole missing sections default once each (no per-field warning storm)', () => {
  for (const [label, mutate, path] of [
    ['scene.light', (d) => delete d.scene.light, 'scene.light'],
    ['scene', (d) => delete d.scene, 'scene'],
    ['modes.dark', (d) => delete d.modes.dark, 'modes.dark'],
    ['modes.light.roles', (d) => delete d.modes.light.roles, 'modes.light.roles'],
    ['modes.light.settings', (d) => delete d.modes.light.settings, 'modes.light.settings'],
    ['defaults', (d) => delete d.defaults, 'defaults'],
    ['neutral', (d) => delete d.neutral, 'neutral'],
  ]) {
    const d = createBaseline();
    mutate(d);
    const r = validateDefinition(d);
    assert.equal(r.ok, true, `${label}: ${JSON.stringify(r.errors)}`);
    assert.deepEqual(r.warnings.map((w) => w.path), [path], label);
    assert.deepEqual(r.definition, JSON.parse(JSON.stringify(BASELINE_DEFINITION)), label);
  }
});

test('wrong-typed sections are errors, not crashes', () => {
  for (const key of ['meta', 'master', 'modes', 'scene', 'offsets', 'neutral', 'features', 'defaults']) {
    const d = createBaseline();
    d[key] = 'nope';
    const r = validateDefinition(d);
    assert.equal(r.ok, false, key);
    assert.ok(r.errors.some((e) => e.code === 'NOT_AN_OBJECT' && e.path === key), key);
  }
  const d = createBaseline();
  d.modes.light.roles.text = 5;
  assert.ok(validateDefinition(d).errors.some((e) => e.code === 'NOT_AN_OBJECT' && e.path === 'modes.light.roles.text'));
  const e = createBaseline();
  e.scene.dark.custom.secondary = { l: 'x', c: 0, h: 0 };
  assert.ok(validateDefinition(e).errors.some((x) => x.code === 'NONFINITE'));
});
