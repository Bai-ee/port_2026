import test from 'node:test';
import assert from 'node:assert/strict';
import { HARMONIES, buildHarmonyPatch, shufflePatch } from '../harmony.js';
import { getPalettePreset } from '../palette-presets.js';
import {
  applyPalettePreset, createBaseline, BASELINE_DEFINITION, validateDefinition, normalizeDefinition,
  setRoleCustom, setLocked,
} from '../../theme/index.js';

const B = BASELINE_DEFINITION;
const mod = (x) => ((x % 360) + 360) % 360;

test('harmonies: five, with offsets in range and distinct from each other', () => {
  assert.deepEqual(HARMONIES.map((h) => h.id), ['complementary', 'split-complementary', 'triad', 'analogous', 'monochrome']);
  for (const h of HARMONIES) {
    const { offsets } = buildHarmonyPatch(B, { harmony: h.id, seedHue: 200 });
    const vals = [offsets.accentBright, offsets.support1, offsets.support2];
    for (const v of vals) assert.ok(v >= -180 && v <= 180, `${h.id} ${v}`);
    const m = vals.map(mod);
    for (const v of m) assert.ok(v >= 0 && v < 360);
    assert.equal(new Set(m).size, 3, `${h.id} offsets not distinct`);
  }
});

test('seed hue defaults to master hue; explicit and seed-derived hues are honoured', () => {
  assert.equal(buildHarmonyPatch(B, { harmony: 'triad' }).hue, B.master.hue);
  assert.equal(buildHarmonyPatch(B, { harmony: 'triad', seedHue: 400 }).hue, 40);
  const a = buildHarmonyPatch(B, { harmony: 'triad', seed: 5 }).hue;
  assert.equal(a, buildHarmonyPatch(B, { harmony: 'triad', seed: 5 }).hue);
});

test('every harmony and shuffle result applies to a valid, canonical definition', () => {
  const patches = [
    ...HARMONIES.map((h) => buildHarmonyPatch(B, { harmony: h.id, seedHue: 310 })),
    ...Array.from({ length: 25 }, (_, i) => shufflePatch(B, { seed: i + 1 })),
  ];
  for (const patch of patches) {
    const d = applyPalettePreset(createBaseline(), { patch });
    assert.deepEqual(validateDefinition(d).errors, []);
    assert.deepEqual(normalizeDefinition(d), d);
  }
});

test('harmony patch leaves custom and locked roles untouched', () => {
  let d = setRoleCustom(createBaseline(), 'light', 'accent', { l: 0.5, c: 0.2, h: 10, a: 1 });
  d = setLocked(d, 'dark', 'support-1', true);
  for (const patch of [buildHarmonyPatch(d, { harmony: 'complementary', seedHue: 33 }), shufflePatch(d, { seed: 9 })]) {
    const after = applyPalettePreset(d, { patch });
    assert.equal(after.modes.light.roles.accent, d.modes.light.roles.accent);
    assert.equal(after.modes.dark.roles['support-1'], d.modes.dark.roles['support-1']);
  }
});

test('shuffle is deterministic per seed, varies across seeds, and stays in range', () => {
  assert.deepEqual(shufflePatch(B, { seed: 42 }), shufflePatch(B, { seed: 42 }));
  const hues = new Set();
  for (let s = 1; s <= 20; s++) {
    const p = shufflePatch(B, { seed: s });
    hues.add(p.hue);
    assert.ok(p.hue >= 0 && p.hue <= 360);
    assert.ok(p.intensity >= 0.8 && p.intensity <= 1.2);
    assert.ok(p.neutral.hue >= 0 && p.neutral.hue < 360);
    assert.notEqual(mod(p.offsets.support1), mod(p.offsets.support2));
  }
  assert.ok(hues.size >= 15, `only ${hues.size} distinct hues`);
});

test('shuffle locks keep those parts of the draft out of the patch', () => {
  const p = shufflePatch(B, { seed: 3, locks: { hue: true, neutral: true } });
  assert.ok(!('hue' in p) && !('neutral' in p));
  assert.ok(p.offsets && p.intensity);
  const q = shufflePatch(B, { seed: 3, locks: { hue: true } });
  assert.deepEqual(q.offsets, shufflePatch(B, { seed: 3 }).offsets);
});

test('applying a harmony then resetting to the baseline combo returns the baseline', () => {
  const changed = applyPalettePreset(B, { patch: buildHarmonyPatch(B, { harmony: 'triad', seedHue: 77 }) });
  assert.notDeepEqual(changed, B);
  assert.deepEqual(applyPalettePreset(changed, getPalettePreset('baseline')), B);
  const shuffled = applyPalettePreset(B, { patch: shufflePatch(B, { seed: 11 }) });
  assert.deepEqual(applyPalettePreset(shuffled, getPalettePreset('baseline')), B);
});
