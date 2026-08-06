import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gravityToWeight, buildPrimaryTshirtInstanceRaw, extractLegacyTshirtMigration, mapPrimaryMaterialToTshirt,
  DEFAULT_TSHIRT_PRINT, PRIMARY_ARTWORK_LOGO_ID, PRIMARY_TSHIRT_INSTANCE_ID,
  TSHIRT_BEND_STIFFNESS_RATIO, TSHIRT_WIND_STRENGTH_SCALE,
} from '../primary-cloth.js';
import { normalizeElementInstance } from '../schema.js';
import { getElementDefinition } from '../catalog.js';

const DEFAULT_MAT = {
  baseColor: '#101114', roughness: 0.12, metalness: 0.35, bump: 0.79,
  finish: 'glossy', clearcoat: 0.5, coatRoughness: 0.08, iridescence: 0.35, sheen: 0.08,
};
const DEFAULT_PHYS = { gravity: 2.7, damping: 0.9, stiffness: 0.85, rebound: 0, rumple: 0.79, pinMode: 'free-float' };
const DEFAULT_ANIM = { on: true, turbulence: 0.6, speed: 1 };

// ── gravityToWeight ──────────────────────────────────────────────────────────

test('gravityToWeight: mid-range gravity maps into the tshirt weight range', () => {
  const w = gravityToWeight(DEFAULT_PHYS.gravity);
  assert.ok(w > 0 && w < 1, `expected 0..1, got ${w}`);
});

test('gravityToWeight: round-trips through the forward formula factories.js tshirtSimParams uses', () => {
  const MIN = 1.6, MAX = 3.4;
  const w = gravityToWeight(2.7);
  const gravityBack = MIN + w * (MAX - MIN);
  assert.ok(Math.abs(gravityBack - 2.7) < 1e-9);
});

test('gravityToWeight: non-finite input never throws or returns NaN', () => {
  assert.equal(Number.isFinite(gravityToWeight(NaN)), true);
  assert.equal(Number.isFinite(gravityToWeight(undefined)), true);
  assert.equal(Number.isFinite(gravityToWeight(Infinity)), true);
});

test('gravityToWeight: out-of-tshirt-range gravity (sheet slider goes to 0 and 4) does not throw — clamping is the caller\'s job (normalizeElementInstance)', () => {
  assert.equal(Number.isFinite(gravityToWeight(0)), true);
  assert.equal(Number.isFinite(gravityToWeight(4)), true);
});

// ── mapPrimaryMaterialToTshirt (Codex review — full material inheritance) ──

test('mapPrimaryMaterialToTshirt: metalness, clearcoat, coatRoughness, iridescence pass through directly (glossy finish)', () => {
  const m = mapPrimaryMaterialToTshirt(DEFAULT_MAT);
  assert.equal(m.color, DEFAULT_MAT.baseColor);
  assert.equal(m.metalness, DEFAULT_MAT.metalness);
  assert.equal(m.clearcoat, DEFAULT_MAT.clearcoat);
  assert.equal(m.coatRoughness, DEFAULT_MAT.coatRoughness);
  assert.equal(m.iridescence, DEFAULT_MAT.iridescence);
  assert.equal(m.sheen, DEFAULT_MAT.sheen);
  assert.equal(m.roughness, DEFAULT_MAT.roughness); // glossy finish: no adjustment
});

test('mapPrimaryMaterialToTshirt: matte finish reproduces the SAME roughness-floor/clearcoat-reduction formula the sheet\'s own material effect uses', () => {
  const m = mapPrimaryMaterialToTshirt({ ...DEFAULT_MAT, finish: 'matte', roughness: 0.12, clearcoat: 0.5 });
  assert.equal(m.roughness, Math.max(0.12, 0.7));
  assert.ok(Math.abs(m.clearcoat - 0.5 * 0.15) < 1e-9);
});

test('mapPrimaryMaterialToTshirt: satin finish reproduces the sheet\'s own roughness-add/clearcoat-half formula', () => {
  const m = mapPrimaryMaterialToTshirt({ ...DEFAULT_MAT, finish: 'satin', roughness: 0.3, clearcoat: 0.5 });
  assert.equal(m.roughness, Math.min(1, 0.3 + 0.28));
  assert.ok(Math.abs(m.clearcoat - 0.5 * 0.5) < 1e-9);
});

test('mapPrimaryMaterialToTshirt: matte roughness floor never exceeds 1 even from an already-high roughness', () => {
  const m = mapPrimaryMaterialToTshirt({ ...DEFAULT_MAT, finish: 'satin', roughness: 0.95 });
  assert.ok(m.roughness <= 1);
});

test('buildPrimaryTshirtInstanceRaw + normalizeElementInstance: CORRECTION (Codex review, round 4) — a Chrome-preset-style low roughness (0.06) survives the pipeline UNCLAMPED, matching the shared ROUGHNESS slider\'s real [0,1] range, not the T-shirt\'s old garment-only 0.2 floor', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: { ...DEFAULT_MAT, roughness: 0.06, finish: 'glossy' },
    phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: true, turbulence: 0.6, speed: 1 },
    tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  const instance = normalizeElementInstance(raw, 'hanging-tshirt');
  assert.equal(instance.material.roughness, 0.06);
});

test('buildPrimaryTshirtInstanceRaw + normalizeElementInstance: a Black-Cloth-preset-style roughness of exactly 0 survives the pipeline unclamped', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: { ...DEFAULT_MAT, roughness: 0, finish: 'glossy' },
    phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: true, turbulence: 0.6, speed: 1 },
    tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  const instance = normalizeElementInstance(raw, 'hanging-tshirt');
  assert.equal(instance.material.roughness, 0);
});

test('buildPrimaryTshirtInstanceRaw + normalizeElementInstance: a BUMP value of 2 (the shared slider\'s real max) survives the pipeline unclamped, matching normalStrength\'s widened [0,2] fieldSpec range', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: { ...DEFAULT_MAT, bump: 2 },
    phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: true, turbulence: 0.6, speed: 1 },
    tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  const instance = normalizeElementInstance(raw, 'hanging-tshirt');
  assert.equal(instance.material.normalStrength, 2);
});

test('buildPrimaryTshirtInstanceRaw + normalizeElementInstance: metalness/clearcoat/iridescence survive the full pipeline into the instance the factory receives', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: true, turbulence: 0.6, speed: 1 },
    tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  const instance = normalizeElementInstance(raw, 'hanging-tshirt');
  assert.equal(instance.material.metalness, DEFAULT_MAT.metalness);
  assert.ok(Math.abs(instance.material.clearcoat - DEFAULT_MAT.clearcoat) < 1e-9);
  assert.equal(instance.material.iridescence, DEFAULT_MAT.iridescence);
  assert.equal(instance.material.sheen, DEFAULT_MAT.sheen);
});

// ── buildPrimaryTshirtInstanceRaw ────────────────────────────────────────────

test('buildPrimaryTshirtInstanceRaw: shape matches the hanging-tshirt fieldSpec buckets', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: DEFAULT_PHYS, anim: DEFAULT_ANIM, tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  assert.equal(raw.type, 'hanging-tshirt');
  assert.equal(raw.id, PRIMARY_TSHIRT_INSTANCE_ID);
  assert.equal(raw.enabled, true);
  assert.ok(raw.transform && raw.material && raw.motion && raw.appearance);
  assert.equal(raw.material.color, DEFAULT_MAT.baseColor);
  assert.equal(raw.material.roughness, DEFAULT_MAT.roughness);
  assert.equal(raw.motion.rotate, true);
  assert.equal(raw.motion.speed, DEFAULT_ANIM.speed);
  assert.equal(raw.appearance.logoAssetId, '');
});

test('buildPrimaryTshirtInstanceRaw: hasArtwork:true selects the ONE primary-artwork logo id — never a browser-local logo-library id', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: DEFAULT_PHYS, anim: DEFAULT_ANIM, tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: true,
  });
  assert.equal(raw.appearance.logoAssetId, PRIMARY_ARTWORK_LOGO_ID);
});

test('buildPrimaryTshirtInstanceRaw: anim.on=false zeroes windStrength and freezes motion', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: DEFAULT_PHYS, anim: { ...DEFAULT_ANIM, on: false }, tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  assert.equal(raw.appearance.windStrength, 0);
  assert.equal(raw.motion.rotate, false);
});

test('buildPrimaryTshirtInstanceRaw: bendStiffness is derived from the single shared stiffness dial at the documented ratio', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: { ...DEFAULT_PHYS, stiffness: 0.5 }, anim: DEFAULT_ANIM, tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  assert.equal(raw.appearance.stretchStiffness, 0.5);
  assert.ok(Math.abs(raw.appearance.bendStiffness - 0.5 * TSHIRT_BEND_STIFFNESS_RATIO) < 1e-9);
});

test('buildPrimaryTshirtInstanceRaw: windStrength scale never exceeds the catalog fieldSpec max at full turbulence', () => {
  const def = getElementDefinition('hanging-tshirt');
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: DEFAULT_PHYS, anim: { ...DEFAULT_ANIM, turbulence: 1 }, tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  assert.equal(TSHIRT_WIND_STRENGTH_SCALE, def.fieldSpec.appearance.windStrength.max);
  assert.ok(raw.appearance.windStrength <= def.fieldSpec.appearance.windStrength.max);
});

test('buildPrimaryTshirtInstanceRaw: extreme primary phys/anim values normalize to a finite, bounded instance (no NaNs, nothing throws)', () => {
  const extremePhys = { ...DEFAULT_PHYS, gravity: 4, damping: 0.998, stiffness: 1 };
  const extremeAnim = { ...DEFAULT_ANIM, on: true, turbulence: 1, speed: 3 };
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: extremePhys, anim: extremeAnim, tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: true,
  });
  const instance = normalizeElementInstance(raw, 'hanging-tshirt');
  const def = getElementDefinition('hanging-tshirt');
  Object.entries(def.fieldSpec.appearance).forEach(([key, spec]) => {
    if (spec.type !== 'number') return;
    const v = instance.appearance[key];
    assert.ok(Number.isFinite(v), `${key} should be finite, got ${v}`);
    assert.ok(v >= spec.min - 1e-9 && v <= spec.max + 1e-9, `${key}=${v} outside [${spec.min}, ${spec.max}]`);
  });
});

test('buildPrimaryTshirtInstanceRaw: zero/negative-leaning primary gravity still normalizes to a finite, in-range weight', () => {
  const raw = buildPrimaryTshirtInstanceRaw({
    mat: DEFAULT_MAT, phys: { ...DEFAULT_PHYS, gravity: 0 }, anim: DEFAULT_ANIM, tshirtPrint: DEFAULT_TSHIRT_PRINT, hasArtwork: false,
  });
  const instance = normalizeElementInstance(raw, 'hanging-tshirt');
  const spec = getElementDefinition('hanging-tshirt').fieldSpec.appearance.weight;
  assert.ok(Number.isFinite(instance.appearance.weight));
  assert.ok(instance.appearance.weight >= spec.min && instance.appearance.weight <= spec.max);
});

// ── extractLegacyTshirtMigration ─────────────────────────────────────────────

test('extractLegacyTshirtMigration: empty/missing input migrates nothing', () => {
  assert.deepEqual(extractLegacyTshirtMigration(undefined), { migrated: false, tshirtPrint: null, remainingExtraInstances: [] });
  const r = extractLegacyTshirtMigration([]);
  assert.equal(r.migrated, false);
  assert.deepEqual(r.remainingExtraInstances, []);
});

test('extractLegacyTshirtMigration: no hanging-tshirt entries leaves the list untouched and unmigrated', () => {
  const list = [{ id: 'a', type: 'kinetic-rings' }, { id: 'b', type: 'chrome-ribbon' }];
  const r = extractLegacyTshirtMigration(list);
  assert.equal(r.migrated, false);
  assert.equal(r.remainingExtraInstances, list);
});

test('extractLegacyTshirtMigration: a single enabled legacy shirt migrates its garment-specific fields and is removed from extraInstances', () => {
  const list = [
    { id: 'a', type: 'kinetic-rings' },
    {
      id: 'hanging-tshirt-1', type: 'hanging-tshirt', enabled: true,
      appearance: { hangerVisible: false, logoX: 0.1, logoY: -0.05, logoScale: 1.3, logoRotation: 15, logoOpacity: 0.8, logoAssetId: 'old-logo-1' },
    },
  ];
  const r = extractLegacyTshirtMigration(list);
  assert.equal(r.migrated, true);
  assert.deepEqual(r.tshirtPrint, { hangerVisible: false, x: 0.1, y: -0.05, scale: 1.3, rotation: 15, opacity: 0.8 });
  assert.deepEqual(r.remainingExtraInstances, [{ id: 'a', type: 'kinetic-rings' }]);
});

test('extractLegacyTshirtMigration: prefers the first ENABLED legacy shirt over an earlier disabled one', () => {
  const list = [
    { id: 'hanging-tshirt-1', type: 'hanging-tshirt', enabled: false, appearance: { logoX: 0.9 } },
    { id: 'hanging-tshirt-2', type: 'hanging-tshirt', enabled: true, appearance: { logoX: 0.2 } },
  ];
  const r = extractLegacyTshirtMigration(list);
  assert.equal(r.migrated, true);
  assert.equal(r.tshirtPrint.x, 0.2);
});

test('extractLegacyTshirtMigration: multiple legacy shirts — only the first enabled one is used, but ALL are dropped from remainingExtraInstances', () => {
  const list = [
    { id: 'hanging-tshirt-1', type: 'hanging-tshirt', enabled: true, appearance: {} },
    { id: 'hanging-tshirt-2', type: 'hanging-tshirt', enabled: true, appearance: {} },
    { id: 'kinetic-rings-1', type: 'kinetic-rings', enabled: true },
  ];
  const r = extractLegacyTshirtMigration(list);
  assert.equal(r.migrated, true);
  assert.deepEqual(r.remainingExtraInstances, [{ id: 'kinetic-rings-1', type: 'kinetic-rings', enabled: true }]);
});

test('extractLegacyTshirtMigration: malformed/missing appearance fields fall back to DEFAULT_TSHIRT_PRINT, never throws', () => {
  const list = [{ id: 'hanging-tshirt-1', type: 'hanging-tshirt', enabled: true }];
  const r = extractLegacyTshirtMigration(list);
  assert.equal(r.migrated, true);
  assert.deepEqual(r.tshirtPrint, DEFAULT_TSHIRT_PRINT);
});

test('extractLegacyTshirtMigration: CORRECTION (Codex review) — an all-disabled legacy shirt does NOT activate T-shirt mode, but is still removed from extraInstances', () => {
  const list = [{ id: 'hanging-tshirt-1', type: 'hanging-tshirt', enabled: false, appearance: { logoScale: 1.5 } }];
  const r = extractLegacyTshirtMigration(list);
  assert.equal(r.migrated, false);
  assert.equal(r.tshirtPrint, null);
  assert.deepEqual(r.remainingExtraInstances, []);
});

test('extractLegacyTshirtMigration: multiple all-disabled legacy shirts do not activate T-shirt mode, and all are removed', () => {
  const list = [
    { id: 'hanging-tshirt-1', type: 'hanging-tshirt', enabled: false, appearance: {} },
    { id: 'hanging-tshirt-2', type: 'hanging-tshirt', enabled: false, appearance: {} },
    { id: 'kinetic-rings-1', type: 'kinetic-rings', enabled: true },
  ];
  const r = extractLegacyTshirtMigration(list);
  assert.equal(r.migrated, false);
  assert.deepEqual(r.remainingExtraInstances, [{ id: 'kinetic-rings-1', type: 'kinetic-rings', enabled: true }]);
});

// ── catalog wiring (task requirement #3 — "T-shirt is excluded from Add
// Element") — ClothStudio.jsx's addableElementTypes is just
// listElementDefinitions().filter(d => !d.singleInstanceRenderer), so this
// one catalog flag IS the guarantee; asserted directly here since there's no
// dedicated catalog.test.js this belongs in otherwise. ──

test('catalog: hanging-tshirt is singleInstanceRenderer — excluded from Add Element / duplication / randomize pools by the SAME generic gate glass-petal-sphere already uses', () => {
  const def = getElementDefinition('hanging-tshirt');
  assert.equal(def.singleInstanceRenderer, true);
});

