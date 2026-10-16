import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE_PRESETS, PRESET_SWATCH_ROLES, presetSwatches, activePalettePreset, getPalettePreset, applyCombo,
} from '../palette-presets.js';
import {
  applyPalettePreset, createBaseline, BASELINE_DEFINITION, validateDefinition, normalizeDefinition,
  buildReport, setRoleCustom, setLocked, resolveTheme,
} from '../../theme/index.js';

const B = BASELINE_DEFINITION;
const baselineReport = buildReport(B);

test('every combo has a unique id, a name and a patch', () => {
  const ids = new Set();
  for (const p of PALETTE_PRESETS) {
    assert.ok(p.id && p.name && p.patch, p.id);
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
  }
  assert.equal(getPalettePreset('lava').name, 'Lava');
  assert.equal(getPalettePreset('nope'), null);
});

test('applying a combo yields a valid, canonical definition that is not worse than the baseline on required contrast', () => {
  for (const p of PALETTE_PRESETS) {
    const d = applyPalettePreset(createBaseline(), p);
    const v = validateDefinition(d);
    assert.deepEqual(v.errors, [], `${p.id}: ${JSON.stringify(v.errors)}`);
    assert.deepEqual(normalizeDefinition(d), d, `${p.id} not canonical`);
    const r = buildReport(d);
    assert.ok(
      r.summary.failRequired <= baselineReport.summary.failRequired,
      `${p.id}: required failures ${r.summary.failRequired} > baseline ${baselineReport.summary.failRequired}`,
    );
  }
});

test('the baseline combo is a no-op on the baseline and is reported active', () => {
  assert.equal(applyPalettePreset(B, getPalettePreset('baseline')), B);
  assert.equal(activePalettePreset(B), 'baseline');
  assert.equal(activePalettePreset(applyPalettePreset(B, getPalettePreset('moss'))), 'moss');
  assert.equal(activePalettePreset(null), null);
});

test('a combo never rewrites custom or locked roles', () => {
  let d = setRoleCustom(createBaseline(), 'light', 'accent', { l: 0.5, c: 0.2, h: 10, a: 1 });
  d = setLocked(d, 'light', 'accent', true);
  const after = applyPalettePreset(d, getPalettePreset('dusk'));
  assert.equal(after.modes.light.roles.accent, d.modes.light.roles.accent);
  assert.equal(after.master.hue, 290);
});

test('presetSwatches returns one hex per preview role, per mode', () => {
  for (const mode of ['light', 'dark']) {
    const s = presetSwatches(B, getPalettePreset('candy'), mode);
    assert.equal(s.length, PRESET_SWATCH_ROLES.length);
    for (const hex of s) assert.match(hex, /^#[0-9a-f]{6}$/i);
  }
  assert.notDeepEqual(presetSwatches(B, getPalettePreset('candy'), 'light'), presetSwatches(B, getPalettePreset('ocean'), 'light'));
});

test('applyPalettePreset ignores garbage', () => {
  assert.equal(applyPalettePreset(B, null), B);
  assert.equal(applyPalettePreset(B, { patch: { hue: NaN, offsets: 'x', modes: { light: { chromaScale: 'y' } } } }), B);
});

test('Happy Hues 14 reproduces the palette hexes exactly in the light palette', () => {
  const d = applyCombo(createBaseline(), getPalettePreset('happy-hues-14'));
  const r = resolveTheme(d, 'light').roles;
  const want = {
    page: '#fffffe', surface: '#fffffe', inset: '#e3f6f5', overlay: '#272343',
    'text-default': '#272343', text: '#2d334a', accent: '#ffd803', 'on-accent': '#272343',
    'support-1': '#bae8e8', 'support-2': '#e3f6f5',
  };
  for (const [id, hex] of Object.entries(want)) assert.equal(r[id].hex, hex, id);
  assert.equal(activePalettePreset(d), 'happy-hues-14');
});

test('switching away from an exact combo releases its pins but keeps user customs and locks', () => {
  let d = applyCombo(createBaseline(), getPalettePreset('happy-hues-14'));
  d = setRoleCustom(d, 'light', 'text', { l: 0.4, c: 0.1, h: 20, a: 1 }); // user changed a pinned role
  d = setLocked(d, 'light', 'page', true);                                  // user locked a pinned role
  const m = applyCombo(d, getPalettePreset('moss'));
  assert.equal(m.modes.light.roles.accent.link, B.modes.light.roles.accent.link);
  assert.equal(m.modes.light.roles.text, d.modes.light.roles.text);
  assert.equal(m.modes.light.roles.page, d.modes.light.roles.page);
  assert.equal(activePalettePreset(m), 'moss');
});

test('applyPalettePreset pins never rewrite a locked role', () => {
  const d = setLocked(createBaseline(), 'light', 'accent', true);
  const after = applyPalettePreset(d, getPalettePreset('happy-hues-14'));
  assert.equal(after.modes.light.roles.accent, d.modes.light.roles.accent);
});

test('combo previews ignore another exact combo\'s pins', () => {
  const d = applyCombo(createBaseline(), getPalettePreset('happy-hues-14'));
  assert.deepEqual(presetSwatches(d, getPalettePreset('moss'), 'light'), presetSwatches(B, getPalettePreset('moss'), 'light'));
});
