import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as stdlib from 'three-stdlib';
import { FACTORIES, getFactory, clearGroup, tshirtModelRetry } from '../factories.js';
import { createElementInstance } from '../schema.js';
import { listElementDefinitions, getElementDefinition } from '../catalog.js';
import { scaleSegments } from '../quality.js';
import { createGLTFLoaderBundle } from '../glb-loader.js';

const ctx = (tier = 'draft', sceneSeed) => ({ THREE, stdlib, tier, sceneSeed });

// Wraps a geometry's dispose() so a test can assert exactly-once disposal.
function spyDispose(geometry) {
  let calls = 0;
  const original = geometry.dispose.bind(geometry);
  geometry.dispose = () => { calls += 1; original(); };
  return () => calls;
}

test('getFactory: returns null for an unknown/unregistered type', () => {
  assert.equal(getFactory('not-a-real-type'), null);
  assert.equal(getFactory('glass-petal-sphere'), null); // singleInstanceRenderer — intentionally has no factory
});

// hanging-tshirt is the one documented exception to the "non-
// singleInstanceRenderer <=> has a factory" rule below: it's
// singleInstanceRenderer (it's now the PRIMARY T-shirt cloth shape, not an
// addable extra — see catalog.js's own comment on the entry), but it keeps a
// REAL FACTORIES entry, unlike glass-petal-sphere, because ClothStudio.jsx's
// primary-shape lifecycle effect directly reuses getFactory('hanging-
// tshirt') to build/update/animate/dispose the primary garment through the
// exact same contract a real extraInstances entry would use.
test('every non-singleInstanceRenderer catalog type has a matching factory, plus the one documented singleton exception (hanging-tshirt)', () => {
  const renderableTypes = listElementDefinitions().filter((d) => !d.singleInstanceRenderer).map((d) => d.type);
  const expectedFactoryKeys = [...renderableTypes, 'hanging-tshirt'];
  assert.deepEqual([...expectedFactoryKeys].sort(), Object.keys(FACTORIES).sort());
});

// glb-import and tshirt-model are deliberately excluded from the generic
// per-type loop below: every other type's default instance renders REAL
// synchronous geometry the instant applyInstance runs. glb-import's default
// (no asset selected yet) renders NOTHING — an empty motion group is the
// correct, honest state, not a bug — and once an asset IS selected, loading
// is genuinely async (a network fetch). tshirt-model has no "no asset
// selected" state (its URL is fixed), but its load is equally async. Neither
// fits the loop's "applyInstance -> synchronous content" assumption, so each
// gets its own dedicated block (see "GLB IMPORT" and "TSHIRT MODEL" below),
// the same treatment already given to glass-petal-sphere (excluded via its
// null getFactory()).
const GENERIC_LOOP_TYPES = Object.keys(FACTORIES).filter((t) => t !== 'glb-import' && t !== 'tshirt-model');

for (const type of GENERIC_LOOP_TYPES) {
  test(`${type}: create -> applyInstance builds content under root.userData.motion`, () => {
    const factory = getFactory(type);
    const instance = createElementInstance(type, { id: `${type}-1`, enabled: true });
    const root = factory.create(ctx());
    assert.ok(root.isObject3D);
    assert.ok(root.userData.motion?.isObject3D, 'create() should set up a root.userData.motion group');
    factory.applyInstance(ctx(), root, instance);
    assert.ok(root.userData.motion.children.length > 0, 'applyInstance should add at least one mesh under motion');
  });

  test(`${type}: applyInstance sets transform on the ROOT from instance.transform`, () => {
    const factory = getFactory(type);
    const instance = createElementInstance(type, {
      id: `${type}-1`, enabled: true,
      transform: { position: [0.3, -0.2, 0.1], rotation: [10, 20, 30], scale: [1.5, 1.5, 1.5] },
    });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, instance);
    assert.equal(root.position.x, 0.3);
    assert.equal(root.position.y, -0.2);
    assert.equal(root.position.z, 0.1);
    assert.ok(Math.abs(root.rotation.x - (10 * Math.PI) / 180) < 1e-9);
    assert.equal(root.scale.x, 1.5);
  });

  test(`${type}: dispose() empties the object and frees geometries without throwing`, () => {
    const factory = getFactory(type);
    const instance = createElementInstance(type, { id: `${type}-1`, enabled: true });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, instance);
    assert.ok(root.userData.motion.children.length > 0);
    factory.dispose(root);
    assert.equal(root.children.length, 0);
  });

  test(`${type}: dispose() frees every geometry exactly once, never more`, () => {
    const factory = getFactory(type);
    const instance = createElementInstance(type, { id: `${type}-1`, enabled: true });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, instance);
    const geometries = [];
    root.traverse((c) => { if (c.geometry) geometries.push(c.geometry); });
    const counters = geometries.map(spyDispose);
    factory.dispose(root);
    counters.forEach((count, i) => assert.equal(count(), 1, `geometry ${i} should be disposed exactly once`));
  });

  // ── Item 2: authored transform must survive animation ──────────────────

  test(`${type}: animate() never overwrites the root's authored position/rotation/scale (rotate ON, many frames)`, () => {
    const factory = getFactory(type);
    const instance = createElementInstance(type, {
      id: `${type}-1`, enabled: true,
      transform: { position: [0.4, -0.25, 0.15], rotation: [37, -52, 81], scale: [1.3, 1.3, 1.3] },
      motion: { rotate: true, speed: 2 },
    });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, instance);
    const authored = { p: root.position.toArray(), r: root.rotation.toArray().slice(0, 3), s: root.scale.toArray() };
    for (let f = 0; f < 30; f += 1) factory.animate(root, instance, f * 0.1, 0.1);
    assert.deepEqual(root.position.toArray(), authored.p, 'root position must be unchanged after animation frames');
    assert.deepEqual(root.rotation.toArray().slice(0, 3), authored.r, 'root rotation must be unchanged after animation frames');
    assert.deepEqual(root.scale.toArray(), authored.s, 'root scale must be unchanged after animation frames');
  });

  test(`${type}: animate() with rotate=true is not a total no-op somewhere in the object graph`, () => {
    const factory = getFactory(type);
    const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, motion: { rotate: true, speed: 2 } });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, instance);
    // Most factories animate by rotating something under root.userData.motion
    // (captured via .rotation below); homepage-particle-hero/wireframe-
    // sculpture/particle-ribbon instead write per-instance data directly
    // into an InstancedMesh's instanceMatrix/instanceColor buffers;
    // iridescent-film/inflatable-forms/cloth-banners/topographic-floor
    // instead mutate their own geometry's vertex position buffer in place
    // (no Object3D .rotation, no instancing); portal-plane instead scales/
    // fades a child mesh (Object3D.scale + material.opacity, no rotation,
    // no instancing, no vertex mutation); caustic-water-light instead
    // rewrites its own DataTexture's pixel data in place (no rotation, no
    // instancing, no vertex mutation, no scale/opacity change either) —
    // every one of these is snapshotted so this one generic test covers
    // every animation style without a bespoke per-type version.
    const snapshot = () => JSON.stringify({
      motion: root.userData.motion.rotation.toArray().slice(0, 3),
      children: root.userData.motion.children.map((c) => c.rotation.toArray().slice(0, 3)),
      childScales: root.userData.motion.children.map((c) => c.scale.toArray().slice(0, 3)),
      childOpacities: root.userData.motion.children.map((c) => (c.material ? c.material.opacity : null)),
      instanceMatrices: root.userData.motion.children.map((c) => (c.instanceMatrix ? Array.from(c.instanceMatrix.array.slice(0, 16)) : null)),
      instanceColors: root.userData.motion.children.map((c) => (c.instanceColor ? Array.from(c.instanceColor.array.slice(0, 24)) : null)),
      geometryPositions: root.userData.motion.children.map((c) => (c.geometry ? Array.from(c.geometry.attributes.position.array.slice(0, 24)) : null)),
      // Sampled from the CENTER of the texture, not byte 0 — a texture
      // with a circular falloff mask (Caustic Water Light) has its corner
      // texels pinned to alpha=0 always, regardless of animation, so
      // sampling the start of the array would silently pass for the wrong
      // reason (comparing two zeros).
      textureData: root.userData.motion.children.map((c) => {
        const data = c.material?.map?.image?.data;
        if (!data) return null;
        const mid = Math.floor(data.length / 2);
        return Array.from(data.slice(mid, mid + 24));
      }),
    });
    const before = snapshot();
    for (let f = 0; f < 10; f += 1) factory.animate(root, instance, f * 0.1, 0.1);
    const after = snapshot();
    assert.notEqual(after, before, 'something under root.userData.motion should visibly move when rotate is on');
  });

  // ── Item 3: rebuild-vs-update split ──────────────────────────────────────

  test(`${type}: a non-topology field change (material) preserves geometry identity — no rebuild`, () => {
    const factory = getFactory(type);
    const def = getElementDefinition(type);
    const a = createElementInstance(type, { id: `${type}-1`, enabled: true });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, a);
    const geoBefore = root.userData.motion.children[0].geometry;
    // Flip every material field this type declares to something else, keep appearance/tier fixed.
    const materialPatch = {};
    Object.keys(def.fieldSpec.material || {}).forEach((key) => {
      const spec = def.fieldSpec.material[key];
      if (spec.type === 'color') materialPatch[key] = '#123456';
      else if (spec.type === 'number') materialPatch[key] = spec.min;
      else if (spec.type === 'boolean') materialPatch[key] = !spec.default;
    });
    const b = createElementInstance(type, { id: `${type}-1`, enabled: true, material: materialPatch });
    factory.applyInstance(ctx(), root, b);
    const geoAfter = root.userData.motion.children[0].geometry;
    assert.equal(geoAfter, geoBefore, 'geometry object identity should be unchanged for a material-only edit');
  });

  test(`${type}: a transform-only change never touches geometry identity or count`, () => {
    const factory = getFactory(type);
    const a = createElementInstance(type, { id: `${type}-1`, enabled: true });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, a);
    const childCountBefore = root.userData.motion.children.length;
    const geoBefore = root.userData.motion.children[0].geometry;
    const b = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: { position: [0.9, 0.1, -0.2] } });
    factory.applyInstance(ctx(), root, b);
    assert.equal(root.userData.motion.children.length, childCountBefore);
    assert.equal(root.userData.motion.children[0].geometry, geoBefore);
  });
}

test('kinetic-rings: a topology change (count) replaces geometry AND disposes the old one exactly once', () => {
  const factory = getFactory('kinetic-rings');
  const a = createElementInstance('kinetic-rings', { id: 'r1', enabled: true, appearance: { count: 3 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const oldGeos = root.userData.motion.children.map((c) => c.geometry);
  const counters = oldGeos.map(spyDispose);

  const b = createElementInstance('kinetic-rings', { id: 'r1', enabled: true, appearance: { count: 4 } });
  factory.applyInstance(ctx(), root, b);

  assert.equal(root.userData.motion.children.length, 4);
  counters.forEach((count) => assert.equal(count(), 1));
  const newGeos = root.userData.motion.children.map((c) => c.geometry);
  newGeos.forEach((g) => assert.ok(!oldGeos.includes(g), 'new geometries must not reuse old references'));
});

test('kinetic-rings: same instance reference re-applied twice does not double-count or leak (idempotent apply)', () => {
  const factory = getFactory('kinetic-rings');
  const instance = createElementInstance('kinetic-rings', { id: 'r1', enabled: true, appearance: { count: 3 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const before = root.userData.motion.children.length;
  factory.applyInstance(ctx(), root, instance); // same reference, same content
  assert.equal(root.userData.motion.children.length, before);
});

test('kinetic-rings, translucent-monoliths, logo-sculpture, light-tubes, wireframe-sculpture, portal-plane, cloth-banners, particle-ribbon, caustic-water-light, volumetric-light-cone, topographic-floor, metaball-bloom, kinetic-type-totem, echo-feedback-tunnel, and hanging-tshirt: changing quality tier rebuilds their (tier-dependent) geometry', () => {
  ['kinetic-rings', 'translucent-monoliths', 'logo-sculpture', 'light-tubes', 'wireframe-sculpture', 'portal-plane', 'cloth-banners', 'particle-ribbon', 'caustic-water-light', 'volumetric-light-cone', 'topographic-floor', 'metaball-bloom', 'kinetic-type-totem', 'echo-feedback-tunnel', 'hanging-tshirt'].forEach((type) => {
    const factory = getFactory(type);
    const instance = createElementInstance(type, { id: `${type}-1`, enabled: true });
    const root = factory.create(ctx('draft'));
    factory.applyInstance(ctx('draft'), root, instance);
    const draftGeo = root.userData.motion.children[0].geometry;
    factory.applyInstance(ctx('ultra'), root, instance); // same instance reference, different tier
    const ultraGeo = root.userData.motion.children[0].geometry;
    assert.notEqual(ultraGeo, draftGeo, `${type} geometry should rebuild when tier changes`);
    assert.ok(ultraGeo.attributes.position.count >= draftGeo.attributes.position.count);
  });
});

test('floating-media-frame: quality tier is irrelevant to its geometry — no rebuild on tier change', () => {
  const factory = getFactory('floating-media-frame');
  const instance = createElementInstance('floating-media-frame', { id: 'f1', enabled: true });
  const root = factory.create(ctx('draft'));
  factory.applyInstance(ctx('draft'), root, instance);
  const draftGeo = root.userData.motion.children[0].geometry;
  factory.applyInstance(ctx('ultra'), root, instance);
  const ultraGeo = root.userData.motion.children[0].geometry;
  assert.equal(ultraGeo, draftGeo, 'floating-media-frame geometry does not depend on tier, so it must not rebuild');
});

// Correction (gate review): panelsTopologySignature previously included
// `tier` even though panelsRebuild's plane is a single unsubdivided
// PlaneGeometry with nothing that benefits from more segments — every
// quality change was disposing and recreating identical GPU resources.
// Same precedent/test shape as floating-media-frame above.
test('gel-panels: quality tier is irrelevant to its geometry — no rebuild on tier change', () => {
  const factory = getFactory('gel-panels');
  const instance = createElementInstance('gel-panels', { id: 'g1', enabled: true, appearance: { count: 3 } });
  const root = factory.create(ctx('draft'));
  factory.applyInstance(ctx('draft'), root, instance);
  const draftGeo = root.userData.motion.children[0].geometry;
  const draftMat = root.userData.motion.children[0].material;
  factory.applyInstance(ctx('ultra'), root, instance);
  const ultraGeo = root.userData.motion.children[0].geometry;
  const ultraMat = root.userData.motion.children[0].material;
  assert.equal(ultraGeo, draftGeo, 'gel-panels geometry does not depend on tier, so it must not rebuild');
  assert.equal(ultraMat, draftMat, 'gel-panels material identity should also survive an irrelevant tier change');
});

test('floating-media-frame: border width IS a topology field — changing it rebuilds the content pane', () => {
  const factory = getFactory('floating-media-frame');
  const a = createElementInstance('floating-media-frame', { id: 'f1', enabled: true, appearance: { borderWidth: 0.05 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const before = root.userData.motion.children[1].geometry; // content pane
  const b = createElementInstance('floating-media-frame', { id: 'f1', enabled: true, appearance: { borderWidth: 0.15 } });
  factory.applyInstance(ctx(), root, b);
  const after = root.userData.motion.children[1].geometry;
  assert.notEqual(after, before);
});

// ── Reflective/Sculptural pack (Phase 4) ─────────────────────────────────

test('orb-constellation: clusterSpread/sizeVariance are update-only — same instanced geometry, but instance matrices genuinely move', () => {
  const factory = getFactory('orb-constellation');
  const a = createElementInstance('orb-constellation', { id: 'o1', enabled: true, appearance: { count: 6, clusterSpread: 0.4, sizeVariance: 0 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const meshBefore = root.userData.motion.children[0];
  const geoBefore = meshBefore.geometry;
  const matrixBefore = Array.from(meshBefore.instanceMatrix.array);
  const b = createElementInstance('orb-constellation', { id: 'o1', enabled: true, appearance: { count: 6, clusterSpread: 1, sizeVariance: 1 } });
  factory.applyInstance(ctx(), root, b);
  const meshAfter = root.userData.motion.children[0];
  assert.equal(meshAfter.geometry, geoBefore, 'clusterSpread/sizeVariance must not rebuild geometry');
  assert.notDeepEqual(Array.from(meshAfter.instanceMatrix.array), matrixBefore, 'instance matrices should reflect the new layout');
});

test('orb-constellation: a topology change (count) replaces the InstancedMesh and disposes the old geometry exactly once', () => {
  const factory = getFactory('orb-constellation');
  const a = createElementInstance('orb-constellation', { id: 'o1', enabled: true, appearance: { count: 5 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const oldGeo = root.userData.motion.children[0].geometry;
  const counter = spyDispose(oldGeo);
  const b = createElementInstance('orb-constellation', { id: 'o1', enabled: true, appearance: { count: 9 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children[0].count, 9);
  assert.equal(counter(), 1);
  assert.notEqual(root.userData.motion.children[0].geometry, oldGeo);
});

test('inflatable-forms: inflation is a mesh-scale update, not a geometry rebuild', () => {
  const factory = getFactory('inflatable-forms');
  const a = createElementInstance('inflatable-forms', { id: 'i1', enabled: true, appearance: { inflation: 0.7 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const mesh = root.userData.motion.children[0];
  const geoBefore = mesh.geometry;
  assert.ok(Math.abs(mesh.scale.x - 0.7) < 1e-9);
  const b = createElementInstance('inflatable-forms', { id: 'i1', enabled: true, appearance: { inflation: 1.3 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(mesh.geometry, geoBefore, 'inflation must not rebuild geometry');
  assert.ok(Math.abs(mesh.scale.x - 1.3) < 1e-9);
});

// Regression (external review): the catalog bound and this factory's own
// comment previously claimed `restRadius*inflation + wobble` — wrong order
// of operations. `inflation` (mesh.scale) is applied AFTER formsAnimate's
// per-vertex wobble displacement (written directly into local-space
// geometry positions), so it multiplies the already-displaced radius:
// true max = (restRadius + wobble) * inflation. This test exercises the
// REAL factory (create -> applyInstance -> many animate() frames, at the
// catalog's own appearance maxima) and reads actual rendered vertex
// positions rather than re-deriving by hand, so it would fail against the
// old (too-small) bound the same way the external review's own probe did.
test('inflatable-forms: at maximum inflation/wobble, every rendered vertex stays within the declared catalog bound, and frustum culling is disabled (deforming geometry, no stale bounding sphere to trust)', () => {
  const factory = getFactory('inflatable-forms');
  const def = getElementDefinition('inflatable-forms');
  const instance = createElementInstance('inflatable-forms', {
    id: 'i1', enabled: true, appearance: { inflation: 1.3, wobble: 0.12 },
  });
  const root = factory.create(ctx('ultra'));
  factory.applyInstance(ctx('ultra'), root, instance);
  const mesh = root.userData.motion.children[0];
  assert.equal(mesh.frustumCulled, false, 'a mesh whose geometry deforms every frame must not rely on a cached (and therefore stale) bounding sphere for culling');

  let maxWorldRadius = 0;
  const v = new THREE.Vector3();
  for (let f = 0; f < 400; f += 1) {
    factory.animate(root, instance, f * 0.05, 0.05);
    const posAttr = mesh.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i += 1) {
      v.fromBufferAttribute(posAttr, i);
      const worldRadius = v.length() * mesh.scale.x; // mesh.scale = inflation, applied after the local-space wobble displacement
      if (worldRadius > maxWorldRadius) maxWorldRadius = worldRadius;
    }
  }
  assert.ok(maxWorldRadius <= def.bounds.localRadius, `max rendered vertex radius ${maxWorldRadius} must not exceed the declared catalog bound ${def.bounds.localRadius}`);
  assert.ok(maxWorldRadius > 0.6, 'sanity: the sweep should have found something close to the real theoretical max (~0.676), not an early/incomplete sweep');
});

test('mirror-fragments: spread/cameraFacingBias are update-only — shard geometry/material identity survives, rotation genuinely changes', () => {
  const factory = getFactory('mirror-fragments');
  const a = createElementInstance('mirror-fragments', { id: 'm1', enabled: true, appearance: { count: 4, spread: 20, cameraFacingBias: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const geoBefore = root.userData.motion.children[0].geometry;
  const rotBefore = root.userData.motion.children.map((c) => c.rotation.y);
  const b = createElementInstance('mirror-fragments', { id: 'm1', enabled: true, appearance: { count: 4, spread: 140, cameraFacingBias: 0 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children[0].geometry, geoBefore, 'spread/cameraFacingBias must not rebuild geometry');
  const rotAfter = root.userData.motion.children.map((c) => c.rotation.y);
  assert.notDeepEqual(rotAfter, rotBefore, 'shard rotation should reflect the new fan spread/bias');
});

test('mirror-fragments: a topology change (count) replaces the shard set and disposes the old shared geometry exactly once', () => {
  const factory = getFactory('mirror-fragments');
  const a = createElementInstance('mirror-fragments', { id: 'm1', enabled: true, appearance: { count: 3 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const oldGeo = root.userData.motion.children[0].geometry;
  const counter = spyDispose(oldGeo);
  const b = createElementInstance('mirror-fragments', { id: 'm1', enabled: true, appearance: { count: 5 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children.length, 5);
  assert.equal(counter(), 1);
});

test('logo-sculpture: depth/bevel ARE topology fields — changing either rebuilds the emblem geometry', () => {
  const factory = getFactory('logo-sculpture');
  const a = createElementInstance('logo-sculpture', { id: 'l1', enabled: true, appearance: { depth: 0.1, bevel: 0.01 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const before = root.userData.motion.children[0].geometry;
  const b = createElementInstance('logo-sculpture', { id: 'l1', enabled: true, appearance: { depth: 0.2, bevel: 0.04 } });
  factory.applyInstance(ctx(), root, b);
  const after = root.userData.motion.children[0].geometry;
  assert.notEqual(after, before);
});

// ── Architectural pack (Phase 4) ──────────────────────────────────────────

test('light-tubes: curl IS a topology field — changing it rebuilds the tube path', () => {
  const factory = getFactory('light-tubes');
  const a = createElementInstance('light-tubes', { id: 't1', enabled: true, appearance: { curl: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const before = root.userData.motion.children[0].geometry;
  const b = createElementInstance('light-tubes', { id: 't1', enabled: true, appearance: { curl: 3 } });
  factory.applyInstance(ctx(), root, b);
  const after = root.userData.motion.children[0].geometry;
  assert.notEqual(after, before);
});

test('light-tubes: flicker perturbs emissiveIntensity around the base intensity, never negative', () => {
  const factory = getFactory('light-tubes');
  const instance = createElementInstance('light-tubes', { id: 't1', enabled: true, material: { intensity: 1.5, flicker: 1 }, motion: { rotate: true, speed: 2 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const mat = root.userData.motion.children[0].material;
  const seen = new Set();
  for (let f = 0; f < 60; f += 1) {
    factory.animate(root, instance, f * 0.1, 0.1);
    assert.ok(mat.emissiveIntensity >= 0, 'flicker must never drive intensity negative');
    seen.add(mat.emissiveIntensity.toFixed(3));
  }
  assert.ok(seen.size > 1, 'flicker should actually vary emissiveIntensity across frames, not sit at one fixed value');
});

test('wireframe-sculpture: detail IS a topology field (edge count changes); thickness is update-only (no rebuild, but instance transforms genuinely change)', () => {
  const factory = getFactory('wireframe-sculpture');
  const a = createElementInstance('wireframe-sculpture', { id: 'w1', enabled: true, appearance: { detail: 0, thickness: 0.01 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const meshA = root.userData.motion.children[0];
  const geoA = meshA.geometry;
  const countA = meshA.count;
  const matrixA = Array.from(meshA.instanceMatrix.array);

  const b = createElementInstance('wireframe-sculpture', { id: 'w1', enabled: true, appearance: { detail: 0, thickness: 0.035 } });
  factory.applyInstance(ctx(), root, b);
  const meshB = root.userData.motion.children[0];
  assert.equal(meshB.geometry, geoA, 'thickness must not rebuild geometry');
  assert.equal(meshB.count, countA, 'thickness must not change edge/instance count');
  assert.notDeepEqual(Array.from(meshB.instanceMatrix.array), matrixA, 'instance matrices should reflect the new thickness (cross-section scale)');

  const c = createElementInstance('wireframe-sculpture', { id: 'w1', enabled: true, appearance: { detail: 2, thickness: 0.035 } });
  factory.applyInstance(ctx(), root, c);
  const meshC = root.userData.motion.children[0];
  assert.notEqual(meshC.geometry, geoA, 'detail must rebuild geometry');
  assert.ok(meshC.count > countA, 'a higher detail level must produce more edges/instances');
});

test('wireframe-sculpture: frustumCulled is disabled (instance colors/matrices are rewritten every frame — no stale cached bound to trust)', () => {
  const factory = getFactory('wireframe-sculpture');
  const instance = createElementInstance('wireframe-sculpture', { id: 'w1', enabled: true });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  assert.equal(root.userData.motion.children[0].frustumCulled, false);
});

test('wireframe-sculpture: dispose() frees the shared strut geometry exactly once despite N instances sharing it', () => {
  const factory = getFactory('wireframe-sculpture');
  const instance = createElementInstance('wireframe-sculpture', { id: 'w1', enabled: true, appearance: { detail: 0 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const geo = root.userData.motion.children[0].geometry;
  const counter = spyDispose(geo);
  factory.dispose(root);
  assert.equal(counter(), 1);
});

test('portal-plane: pulseDepth is update-only (animate()-driven amplitude, never a topology field) — geometry identity survives across the full appearance range', () => {
  const factory = getFactory('portal-plane');
  const a = createElementInstance('portal-plane', { id: 'p1', enabled: true, appearance: { pulseDepth: 0 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const ringGeoBefore = root.userData.motion.children[0].geometry;
  const b = createElementInstance('portal-plane', { id: 'p1', enabled: true, appearance: { pulseDepth: 1 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children[0].geometry, ringGeoBefore, 'pulseDepth must not rebuild the ring');
});

test('portal-plane: pulsing (motion.rotate=true) genuinely scales/fades the inner disc without ever exceeding the ring\'s own fixed radius', () => {
  const factory = getFactory('portal-plane');
  const instance = createElementInstance('portal-plane', { id: 'p1', enabled: true, appearance: { pulseDepth: 1 }, material: { interiorOpacity: 0.6 }, motion: { rotate: true, speed: 2 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const discMesh = root.userData.motion.children[1];
  const scalesSeen = new Set();
  for (let f = 0; f < 40; f += 1) {
    factory.animate(root, instance, f * 0.1, 0.1);
    scalesSeen.add(discMesh.scale.x.toFixed(3));
    assert.ok(discMesh.scale.x <= 1, 'the disc must only ever shrink from its own build-time radius, never grow past the fixed ring');
  }
  assert.ok(scalesSeen.size > 1, 'the disc scale should genuinely vary across frames while pulsing');
});

// Regression (external review): frustumCulled=false was applied to
// Inflatable Forms and Wireframe Sculpture (both deform every frame) but
// missed for Cloth Banners in the first pass — an oversight, not a
// different situation, since bannerAnimate deforms geometry identically.
// This test proves BOTH halves: (1) the geometry's own UNDEFORMED
// boundingSphere (whatever a renderer would lazily cache the first time it
// needed one, before any animate() call) really would be too small once
// wind sway runs — i.e., the bug this class of fix prevents is REAL here,
// not hypothetical — and (2) the production mesh doesn't rely on that
// cached bound at all, so it can never matter.
test('cloth-banners: the animated deformation genuinely exceeds the geometry\'s own undeformed bounding sphere, and the production mesh does not rely on it for culling', () => {
  const factory = getFactory('cloth-banners');
  const instance = createElementInstance('cloth-banners', {
    id: 'b1', enabled: true, appearance: { weight: 0.3, windStrength: 0.12 }, motion: { rotate: true, speed: 1 },
  });
  const root = factory.create(ctx('ultra'));
  factory.applyInstance(ctx('ultra'), root, instance);
  const mesh = root.userData.motion.children[0];
  assert.equal(mesh.frustumCulled, false, 'a mesh whose geometry deforms every frame must not rely on a cached (and therefore stale) bounding sphere for culling');

  // The UNDEFORMED bound — exactly what a renderer's own lazy
  // computeBoundingSphere() would have cached the first time it needed one,
  // before bannerAnimate ever ran.
  mesh.geometry.computeBoundingSphere();
  const cachedRadius = mesh.geometry.boundingSphere.radius;

  let maxAnimatedRadius = 0;
  const v = new THREE.Vector3();
  for (let f = 0; f < 400; f += 1) {
    factory.animate(root, instance, f * 0.05, 0.05);
    const posAttr = mesh.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i += 1) {
      v.fromBufferAttribute(posAttr, i);
      if (v.length() > maxAnimatedRadius) maxAnimatedRadius = v.length();
    }
  }
  assert.ok(maxAnimatedRadius > cachedRadius, `the animated deformation (max radius ${maxAnimatedRadius}) must genuinely exceed the undeformed cached bound (${cachedRadius}) — otherwise this regression would not actually be testing the stale-culling bug class`);
});

test('cloth-banners: the TOP row of vertices never moves under wind (pinned edge)', () => {
  const factory = getFactory('cloth-banners');
  const instance = createElementInstance('cloth-banners', { id: 'b1', enabled: true, appearance: { weight: 0.3, windStrength: 0.12 }, motion: { rotate: true, speed: 2 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const { geometry, topY } = root.userData;
  const posAttr = geometry.attributes.position;
  const topIndices = [];
  for (let i = 0; i < posAttr.count; i += 1) {
    if (Math.abs(posAttr.array[i * 3 + 1] - topY) < 1e-6) topIndices.push(i);
  }
  assert.ok(topIndices.length > 0, 'the geometry should have at least one row of vertices at the pinned top edge');
  const topXBefore = topIndices.map((i) => posAttr.array[i * 3]);
  for (let f = 0; f < 30; f += 1) factory.animate(root, instance, f * 0.1, 0.1);
  const topXAfter = topIndices.map((i) => posAttr.array[i * 3]);
  assert.deepEqual(topXAfter, topXBefore, 'the pinned top edge must never move under wind sway');
});

test('cloth-banners: wind sway grows with distance from the pinned top edge (bottom moves more than the middle)', () => {
  const factory = getFactory('cloth-banners');
  const instance = createElementInstance('cloth-banners', { id: 'b1', enabled: true, appearance: { weight: 0.3, windStrength: 0.12 }, motion: { rotate: true, speed: 2 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const { geometry } = root.userData;
  const posAttr = geometry.attributes.position;
  const basePositions = Float32Array.from(posAttr.array);
  let maxMidDisplacement = 0;
  let maxBottomDisplacement = 0;
  for (let f = 0; f < 60; f += 1) {
    factory.animate(root, instance, f * 0.1, 0.1);
    for (let i = 0; i < posAttr.count; i += 1) {
      const y = basePositions[i * 3 + 1];
      const disp = Math.abs(posAttr.array[i * 3] - basePositions[i * 3]);
      if (Math.abs(y) < 0.05) maxMidDisplacement = Math.max(maxMidDisplacement, disp);
      if (y < -0.5) maxBottomDisplacement = Math.max(maxBottomDisplacement, disp);
    }
  }
  assert.ok(maxBottomDisplacement > maxMidDisplacement, 'the bottom edge should sway more than the middle, since sway grows with distance from the pinned top');
});

// ── Atmospheric/Surface pack (Phase 4) ────────────────────────────────────

// Regression pinning the bug caught while calibrating this pack's bounds:
// THREE.InstancedMesh initializes every instance's matrix to IDENTITY, so
// without an explicit initial-layout call, create()+applyInstance() alone
// (no animate() ever called — e.g. the scene is paused, or this is simply
// the render before the first animation frame) would leave every particle
// as a full-size (radius 1) dot stacked at the origin instead of
// distributed along the path.
test('particle-ribbon: applyInstance alone (before any animate() call) already lays particles out along the path — never left at the InstancedMesh identity-matrix default', () => {
  const factory = getFactory('particle-ribbon');
  const instance = createElementInstance('particle-ribbon', { id: 'p1', enabled: true, appearance: { count: 12 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const mesh = root.userData.motion.children[0];
  const m4 = new THREE.Matrix4();
  const identity = new THREE.Matrix4();
  let anyNonIdentity = false;
  let anyAtOrigin = 0;
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, m4);
    if (!m4.equals(identity)) anyNonIdentity = true;
    const pos = new THREE.Vector3().setFromMatrixPosition(m4);
    if (pos.length() < 1e-6) anyAtOrigin += 1;
  }
  assert.ok(anyNonIdentity, 'at least one instance must have a real (non-identity) transform immediately after applyInstance, with no animate() call yet');
  assert.ok(anyAtOrigin < mesh.count, 'particles must not all be stacked at the origin (the InstancedMesh default) before any animation has run');
});

test('particle-ribbon: a topology change (count) replaces the InstancedMesh and disposes the old geometry exactly once', () => {
  const factory = getFactory('particle-ribbon');
  const a = createElementInstance('particle-ribbon', { id: 'p1', enabled: true, appearance: { count: 30 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const oldGeo = root.userData.motion.children[0].geometry;
  const counter = spyDispose(oldGeo);
  const b = createElementInstance('particle-ribbon', { id: 'p1', enabled: true, appearance: { count: 90 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children[0].count, 90);
  assert.equal(counter(), 1);
});

// Regression (external review): per-instance colors are derived from
// `mesh.material.color` inside ribbonParticlesUpdateLayout, but that
// function previously ran ONLY from animate() (early-returns when FLOW is
// off) or once at rebuild time — a material color change via applyInstance
// alone (while paused) updated the shared material tint but left every
// per-instance color buffer stale, baked from the OLD color (independent
// proof: blue -> red while paused left instance 0's own color at [0,0,0.5]
// instead of reflecting red).
test('particle-ribbon: a COLOR change applies to per-instance colors immediately while paused (motion.rotate=false) — never left stale from the previous color', () => {
  const factory = getFactory('particle-ribbon');
  const a = createElementInstance('particle-ribbon', { id: 'p1', enabled: true, appearance: { count: 10 }, material: { color: '#0000ff' }, motion: { rotate: false, speed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const mesh = root.userData.motion.children[0];
  const before = Array.from(mesh.instanceColor.array.slice(0, 3));
  assert.ok(before[2] > before[0], 'instance 0 should read blue-tinted from the initial blue material');
  const b = createElementInstance('particle-ribbon', { id: 'p1', enabled: true, appearance: { count: 10 }, material: { color: '#ff0000' }, motion: { rotate: false, speed: 1 } });
  factory.applyInstance(ctx(), root, b);
  const after = Array.from(mesh.instanceColor.array.slice(0, 3));
  assert.ok(after[0] > after[2], 'instance 0 must reflect the NEW red material immediately, not remain stale from the old blue material, even while paused');
});

test('caustic-water-light: appearance fields (scale/contrast/direction) update the texture even while paused (motion.rotate=false) — a static frame is still a meaningful render, not frozen-stale', () => {
  const factory = getFactory('caustic-water-light');
  const a = createElementInstance('caustic-water-light', { id: 'c1', enabled: true, appearance: { scale: 1, contrast: 0.2, direction: 0 }, motion: { rotate: false, speed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const dataBefore = Array.from(root.userData.texture.image.data.slice());
  const b = createElementInstance('caustic-water-light', { id: 'c1', enabled: true, appearance: { scale: 2.5, contrast: 0.9, direction: 270 }, motion: { rotate: false, speed: 1 } });
  factory.applyInstance(ctx(), root, b);
  const dataAfter = Array.from(root.userData.texture.image.data.slice());
  assert.notDeepEqual(dataAfter, dataBefore, 'changing appearance fields should update the texture immediately, even with RIPPLE off');
});

// Regression (external review): the combined test above changes scale,
// contrast, AND direction together — contrast/direction genuinely do
// affect the texture at causticTime=0 (paused), which masked the fact
// that scale alone did NOT (scale previously only multiplied the TIME
// term, and time is 0 while paused, so 0*anyScale===0). Isolating scale
// as the ONLY changed field is what actually catches that bug.
test('caustic-water-light: Pattern Scale ALONE (contrast/direction held fixed) changes the texture while paused — not just alongside other fields', () => {
  const factory = getFactory('caustic-water-light');
  const a = createElementInstance('caustic-water-light', { id: 'c1', enabled: true, appearance: { scale: 0.5, contrast: 0.5, direction: 45 }, motion: { rotate: false, speed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const dataBefore = Array.from(root.userData.texture.image.data.slice());
  const b = createElementInstance('caustic-water-light', { id: 'c1', enabled: true, appearance: { scale: 3, contrast: 0.5, direction: 45 }, motion: { rotate: false, speed: 1 } });
  factory.applyInstance(ctx(), root, b);
  const dataAfter = Array.from(root.userData.texture.image.data.slice());
  assert.notDeepEqual(dataAfter, dataBefore, 'Pattern Scale alone must change the rendered texture, even while paused and even with every other appearance field held fixed');
});

test('caustic-water-light: geometry never rebuilds — the disc is fixed, only its texture and material color change', () => {
  const factory = getFactory('caustic-water-light');
  const a = createElementInstance('caustic-water-light', { id: 'c1', enabled: true, appearance: { scale: 1, contrast: 0.2, direction: 0 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const geoBefore = root.userData.motion.children[0].geometry;
  const b = createElementInstance('caustic-water-light', { id: 'c1', enabled: true, appearance: { scale: 3, contrast: 1, direction: 359 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children[0].geometry, geoBefore);
});

test('volumetric-light-cone: angle and length ARE topology fields — changing either rebuilds the cone', () => {
  const factory = getFactory('volumetric-light-cone');
  const a = createElementInstance('volumetric-light-cone', { id: 'v1', enabled: true, appearance: { angle: 20, length: 0.7 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const before = root.userData.motion.children[0].geometry;
  const b = createElementInstance('volumetric-light-cone', { id: 'v1', enabled: true, appearance: { angle: 55, length: 1.3 } });
  factory.applyInstance(ctx(), root, b);
  const after = root.userData.motion.children[0].geometry;
  assert.notEqual(after, before);
});

test('volumetric-light-cone: noise flicker perturbs opacity around the base density, always clamped to [0,1]', () => {
  const factory = getFactory('volumetric-light-cone');
  const instance = createElementInstance('volumetric-light-cone', { id: 'v1', enabled: true, appearance: { noise: 1 }, material: { density: 0.5 }, motion: { rotate: true, speed: 2 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const mat = root.userData.motion.children[0].material;
  const seen = new Set();
  for (let f = 0; f < 60; f += 1) {
    factory.animate(root, instance, f * 0.1, 0.1);
    assert.ok(mat.opacity >= 0 && mat.opacity <= 1, 'opacity must always stay clamped to a valid [0,1] range');
    seen.add(mat.opacity.toFixed(3));
  }
  assert.ok(seen.size > 1, 'noise should genuinely vary opacity across frames, not sit at one fixed value');
});

// Regression (external review): coneUpdateMaterial previously only cached
// the new density in root.userData.baseDensity, never assigning it to
// mat.opacity — opacity was set ONLY inside coneAnimate, which
// early-returns when SWEEP is off, so a density change while paused had
// zero visible effect (independent proof: density 0.1 -> 0.5 while paused
// left opacity at 0.1).
test('volumetric-light-cone: DENSITY applies immediately while paused (motion.rotate=false) — no rebuild required', () => {
  const factory = getFactory('volumetric-light-cone');
  const a = createElementInstance('volumetric-light-cone', { id: 'v1', enabled: true, material: { density: 0.1 }, motion: { rotate: false, speed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const mat = root.userData.motion.children[0].material;
  assert.ok(Math.abs(mat.opacity - 0.1) < 1e-9, 'initial density must apply even while paused');
  const b = createElementInstance('volumetric-light-cone', { id: 'v1', enabled: true, material: { density: 0.5 }, motion: { rotate: false, speed: 1 } });
  factory.applyInstance(ctx(), root, b);
  assert.ok(Math.abs(mat.opacity - 0.5) < 1e-9, 'a density change must apply immediately while still paused, without needing SWEEP to run');
});

test('topographic-floor: falloff pins the CENTER vertex still — displacement grows toward the corners', () => {
  const factory = getFactory('topographic-floor');
  const instance = createElementInstance('topographic-floor', { id: 't1', enabled: true, appearance: { amplitude: 0.18, frequency: 3 }, motion: { rotate: true, speed: 2 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const { geometry, basePositions, falloff } = root.userData;
  const posAttr = geometry.attributes.position;
  let centerIndex = -1;
  let centerDist = Infinity;
  let maxFalloffIndex = 0;
  for (let i = 0; i < falloff.length; i += 1) {
    const x = basePositions[i * 3];
    const y = basePositions[i * 3 + 1];
    const dist = Math.sqrt(x * x + y * y);
    if (dist < centerDist) { centerDist = dist; centerIndex = i; }
    if (falloff[i] > falloff[maxFalloffIndex]) maxFalloffIndex = i;
  }
  let maxCenterDisplacement = 0;
  let maxCornerDisplacement = 0;
  for (let f = 0; f < 40; f += 1) {
    factory.animate(root, instance, f * 0.1, 0.1);
    maxCenterDisplacement = Math.max(maxCenterDisplacement, Math.abs(posAttr.array[centerIndex * 3 + 2]));
    maxCornerDisplacement = Math.max(maxCornerDisplacement, Math.abs(posAttr.array[maxFalloffIndex * 3 + 2]));
  }
  assert.ok(maxCornerDisplacement > maxCenterDisplacement, 'a high-falloff (corner-ish) vertex should displace more than the lowest-falloff (center) vertex');
});

test('topographic-floor: frustumCulled is disabled (geometry deforms every frame — no stale bounding sphere to trust)', () => {
  const factory = getFactory('topographic-floor');
  const instance = createElementInstance('topographic-floor', { id: 't1', enabled: true });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  assert.equal(root.userData.motion.children[0].frustumCulled, false);
});

// ── Hero pack, final pack (Phase 4) ───────────────────────────────────────
// All three types below proactively apply the lesson from the Atmospheric/
// Surface pack's own external-review correction: every field that affects
// the PAUSED look is applied via a shared `...UpdateLayout(root, instance,
// t)` function called from BOTH applyInstance (t=0 or cached) and animate
// (advancing t) — never left to animate() alone. Each type gets an
// explicit paused-state regression proving this, matching the review's own
// now-established verification shape for this exact bug class.

test('metaball-bloom: attraction/surfaceTension change per-instance layout immediately while paused (motion.rotate=false)', () => {
  const factory = getFactory('metaball-bloom');
  const a = createElementInstance('metaball-bloom', { id: 'm1', enabled: true, appearance: { count: 8, attraction: 0, surfaceTension: 0 }, motion: { rotate: false, speed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const mesh = root.userData.motion.children[0];
  const before = Array.from(mesh.instanceMatrix.array.slice(0, 48));
  const b = createElementInstance('metaball-bloom', { id: 'm1', enabled: true, appearance: { count: 8, attraction: 1, surfaceTension: 1 }, motion: { rotate: false, speed: 1 } });
  factory.applyInstance(ctx(), root, b);
  const after = Array.from(mesh.instanceMatrix.array.slice(0, 48));
  assert.notDeepEqual(after, before, 'attraction/surfaceTension must reshape the cluster immediately, even while PULSE is off');
});

// Regression (external review): the original bound (0.26) was calibrated
// only at appearance MAXIMA (count=10/attraction=1/surfaceTension=1)
// without checking which direction each field actually pushes the bound.
// `attraction` PULLS blobs toward the center — attraction=1 is the
// TIGHTEST orbit, not the loosest — and surfaceTension=1 gives the most
// size-UNIFORM (not largest) blobs. The true worst case is
// attraction=0/surfaceTension=0 (loosest orbit, largest un-shrunk blobs),
// which the original calibration never measured. This test sweeps the
// REAL worst-case combination directly (not the field-maxima combination
// that happened to be wrong here) and asserts every rendered vertex stays
// inside the declared catalog bound — the same class of proof this
// codebase's Inflatable Forms/Cloth Banners bound regressions already
// establish, applied to the combination that's actually extreme this time.
test('metaball-bloom: at its TRUE worst-case appearance combination (attraction=0, surfaceTension=0, count=10 — the loosest, largest-blob cluster, not the field-maxima combination), every rendered vertex stays within the declared catalog bound', () => {
  const factory = getFactory('metaball-bloom');
  const def = getElementDefinition('metaball-bloom');
  const instance = createElementInstance('metaball-bloom', {
    id: 'm1', enabled: true, appearance: { count: 10, attraction: 0, surfaceTension: 0 },
  });
  const root = factory.create(ctx('ultra'));
  factory.applyInstance(ctx('ultra'), root, instance);
  let maxWorldRadius = 0;
  const v = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const mesh = root.userData.motion.children[0];
  function sweep() {
    root.userData.motion.updateMatrix();
    mesh.updateMatrix();
    const posAttr = mesh.geometry.attributes.position;
    for (let inst = 0; inst < mesh.count; inst += 1) {
      mesh.getMatrixAt(inst, m4);
      for (let i = 0; i < posAttr.count; i += 1) {
        v.fromBufferAttribute(posAttr, i);
        v.applyMatrix4(m4);
        if (v.length() > maxWorldRadius) maxWorldRadius = v.length();
      }
    }
  }
  sweep();
  for (let f = 0; f < 600; f += 1) {
    factory.animate(root, instance, f * 0.05, 0.05);
    sweep();
  }
  assert.ok(maxWorldRadius <= def.bounds.localRadius, `max rendered vertex radius ${maxWorldRadius} must not exceed the declared catalog bound ${def.bounds.localRadius}`);
  assert.ok(maxWorldRadius > 0.45, 'sanity: the sweep should have found something close to the real true-worst-case max (~0.5128), not an early/incomplete sweep or the wrong (smaller) combination');
});

test('metaball-bloom: a topology change (count) replaces the InstancedMesh and disposes the old geometry exactly once', () => {
  const factory = getFactory('metaball-bloom');
  const a = createElementInstance('metaball-bloom', { id: 'm1', enabled: true, appearance: { count: 5 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const oldGeo = root.userData.motion.children[0].geometry;
  const counter = spyDispose(oldGeo);
  const b = createElementInstance('metaball-bloom', { id: 'm1', enabled: true, appearance: { count: 9 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children[0].count, 9);
  assert.equal(counter(), 1);
});

test('kinetic-type-totem: count/depth/bevel ARE topology fields — changing any of them rebuilds the shared block geometry and re-lays-out the stack', () => {
  const factory = getFactory('kinetic-type-totem');
  const a = createElementInstance('kinetic-type-totem', { id: 't1', enabled: true, appearance: { count: 3, depth: 0.06, bevel: 0.008 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const before = root.userData.blocks[0].geometry;
  assert.equal(root.userData.blocks.length, 3);
  const b = createElementInstance('kinetic-type-totem', { id: 't1', enabled: true, appearance: { count: 6, depth: 0.15, bevel: 0.028 } });
  factory.applyInstance(ctx(), root, b);
  const after = root.userData.blocks[0].geometry;
  assert.notEqual(after, before);
  assert.equal(root.userData.blocks.length, 6);
});

// Unlike Metaball Bloom's attraction/Echo Tunnel's decay (fields with an
// obviously "wrong at t=0" default if skipped), the totem's sweep wave is
// already well-defined at sweepTime=0 — the real risk here isn't a wrong
// VALUE, it's totemUpdateGlow never running at all during applyInstance
// (silently deferred to animate(), the exact bug class this pack's
// predecessor was corrected for). This proves the wave actually computed:
// with edgeGlow on, block scales must vary across the stack (not all sit
// at the THREE.Mesh default of 1), confirming totemUpdateGlow genuinely
// ran — and a second, unrelated applyInstance call (same instance, no
// field change, simulating a normal re-render) must reproduce the exact
// same scales, proving the phase is read from stable stored state
// (root.userData.sweepTime), not recomputed from a moving wall-clock.
test('kinetic-type-totem: the glow sweep genuinely computes non-default block scales during applyInstance (not deferred to animate()), and is stable across a repeat apply', () => {
  const factory = getFactory('kinetic-type-totem');
  const instance = createElementInstance('kinetic-type-totem', { id: 't1', enabled: true, appearance: { count: 5 }, material: { edgeGlow: 1 }, motion: { rotate: false, speed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const scalesAtRebuild = root.userData.blocks.map((b) => b.scale.x);
  const uniqueScales = new Set(scalesAtRebuild.map((s) => s.toFixed(4)));
  assert.ok(uniqueScales.size > 1, 'the sweep wave should produce genuinely different scales across the stack, proving totemUpdateGlow ran during applyInstance');
  factory.applyInstance(ctx(), root, instance);
  const scalesAfterReapply = root.userData.blocks.map((b) => b.scale.x);
  assert.deepEqual(scalesAfterReapply, scalesAtRebuild, 're-applying the same instance while paused must reproduce the exact same sweep phase, not drift or reset');
});

test('echo-feedback-tunnel: decay/hueShift change per-ring scale and color immediately while paused (motion.rotate=false)', () => {
  const factory = getFactory('echo-feedback-tunnel');
  const a = createElementInstance('echo-feedback-tunnel', { id: 'e1', enabled: true, appearance: { count: 8, decay: 0.95, hueShift: 0 }, motion: { rotate: false, speed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const mesh = root.userData.motion.children[0];
  const matrixBefore = Array.from(mesh.instanceMatrix.array.slice(0, 32));
  const colorBefore = Array.from(mesh.instanceColor.array.slice(0, 6));
  const b = createElementInstance('echo-feedback-tunnel', { id: 'e1', enabled: true, appearance: { count: 8, decay: 0.55, hueShift: 0.9 }, motion: { rotate: false, speed: 1 } });
  factory.applyInstance(ctx(), root, b);
  const matrixAfter = Array.from(mesh.instanceMatrix.array.slice(0, 32));
  const colorAfter = Array.from(mesh.instanceColor.array.slice(0, 6));
  assert.notDeepEqual(matrixAfter, matrixBefore, 'decay must change per-ring scale immediately, even while TRAVEL is off');
  assert.notDeepEqual(colorAfter, colorBefore, 'hueShift must change per-ring color immediately, even while TRAVEL is off');
});

test('echo-feedback-tunnel: a topology change (count) replaces the InstancedMesh and disposes the old geometry exactly once', () => {
  const factory = getFactory('echo-feedback-tunnel');
  const a = createElementInstance('echo-feedback-tunnel', { id: 'e1', enabled: true, appearance: { count: 6 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const oldGeo = root.userData.motion.children[0].geometry;
  const counter = spyDispose(oldGeo);
  const b = createElementInstance('echo-feedback-tunnel', { id: 'e1', enabled: true, appearance: { count: 12 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.motion.children[0].count, 12);
  assert.equal(counter(), 1);
});

test('every Phase 2 type is honestly capability-flagged (preview yes, final render not yet)', () => {
  Object.keys(FACTORIES).forEach((type) => {
    const def = getElementDefinition(type);
    assert.equal(def.previewSupported, true, `${type} should be previewSupported`);
    assert.equal(def.finalRenderSupported, false, `${type} should not claim finalRenderSupported yet`);
  });
});

// ── homepage-particle-hero — Phase 3. Unlike the other five factories, this
// one carries PERSISTENT per-frame simulation state (currentPositions/
// simTime) that must survive across animate() calls without being reset,
// and is rebuilt (state discarded, freshly reseeded) only on a real topology
// change (particleCount or tier) — the same rebuild trigger every other
// factory uses, just with more state riding along with it. ─────────────────

test('homepage-particle-hero: create -> applyInstance builds a single InstancedMesh with a matching instanceColor buffer', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 200 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  assert.equal(root.userData.motion.children.length, 1);
  const mesh = root.userData.motion.children[0];
  assert.ok(mesh.isInstancedMesh);
  assert.equal(mesh.count, root.userData.count);
  assert.ok(mesh.instanceColor);
  assert.equal(mesh.instanceColor.array.length, root.userData.count * 3);
  assert.equal(root.userData.currentPositions.length, root.userData.count * 3);
});

test('homepage-particle-hero: applyInstance seeds a per-instance spawn position, not all-zero', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 100 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const nonZero = Array.from(root.userData.currentPositions).some((v) => v !== 0);
  assert.ok(nonZero, 'spawn positions should not all be exactly the origin');
});

// Phase 3's explicit contract (plan lines ~503-508 / element contract line
// 156): reloading or rebuilding the SAME saved scene/instance must reproduce
// the identical initial spawn cloud — never a fresh Math.random() draw each
// time. "Not all zero" (above) cannot prove this; only actually rebuilding
// twice from the same inputs and diffing byte-for-byte can.
test('homepage-particle-hero: identical seed + instance + tier/count yields byte-identical initial spawn positions across independent rebuilds', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 150 } });

  const rootA = factory.create(ctx('draft', 42));
  factory.applyInstance(ctx('draft', 42), rootA, instance);
  const positionsA = Array.from(rootA.userData.currentPositions);

  const rootB = factory.create(ctx('draft', 42));
  factory.applyInstance(ctx('draft', 42), rootB, instance);
  const positionsB = Array.from(rootB.userData.currentPositions);

  assert.deepEqual(positionsB, positionsA, 'same sceneSeed + instance id + tier/count must reproduce the exact same spawn cloud');
});

test('homepage-particle-hero: a different sceneSeed produces a genuinely different spawn cloud (same instance/tier/count)', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 150 } });

  const rootA = factory.create(ctx('draft', 1));
  factory.applyInstance(ctx('draft', 1), rootA, instance);
  const positionsA = Array.from(rootA.userData.currentPositions);

  const rootB = factory.create(ctx('draft', 2));
  factory.applyInstance(ctx('draft', 2), rootB, instance);
  const positionsB = Array.from(rootB.userData.currentPositions);

  assert.notDeepEqual(positionsB, positionsA, 'a different sceneSeed must produce a different spawn cloud');
});

test('homepage-particle-hero: a different instance id (same sceneSeed/tier/count) produces a different spawn cloud — sibling instances never share a PRNG stream', () => {
  const factory = getFactory('homepage-particle-hero');
  const a = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 150 } });
  const b = createElementInstance('homepage-particle-hero', { id: 'h2', enabled: true, appearance: { particleCount: 150 } });

  const rootA = factory.create(ctx('draft', 7));
  factory.applyInstance(ctx('draft', 7), rootA, a);
  const positionsA = Array.from(rootA.userData.currentPositions);

  const rootB = factory.create(ctx('draft', 7));
  factory.applyInstance(ctx('draft', 7), rootB, b);
  const positionsB = Array.from(rootB.userData.currentPositions);

  assert.notDeepEqual(positionsB, positionsA, 'different instance ids must draw from different derived seeds');
});

test('homepage-particle-hero: an undefined sceneSeed (ctx built without one) still seeds deterministically, not via Math.random()', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 60 } });

  const rootA = factory.create({ THREE, stdlib, tier: 'draft' }); // no sceneSeed key at all
  factory.applyInstance({ THREE, stdlib, tier: 'draft' }, rootA, instance);
  const positionsA = Array.from(rootA.userData.currentPositions);

  const rootB = factory.create({ THREE, stdlib, tier: 'draft' });
  factory.applyInstance({ THREE, stdlib, tier: 'draft' }, rootB, instance);
  const positionsB = Array.from(rootB.userData.currentPositions);

  assert.deepEqual(positionsB, positionsA, 'a missing sceneSeed must fall back to a fixed default, not an unseeded random draw');
});

test('homepage-particle-hero: animate() advances currentPositions/simTime and writes the instanceMatrix/instanceColor buffers, without touching root\'s authored transform', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', {
    id: 'h1', enabled: true,
    transform: { position: [0.1, 0.2, -0.3], rotation: [5, 10, 15], scale: [1.2, 1.2, 1.2] },
    appearance: { particleCount: 150 },
    motion: { rotate: true, speed: 1 },
  });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const authoredPos = root.position.toArray();
  const positionsBefore = Array.from(root.userData.currentPositions);
  const matrixBefore = Array.from(root.userData.mesh.instanceMatrix.array);
  const versionBefore = root.userData.mesh.instanceMatrix.version;
  for (let f = 0; f < 20; f += 1) factory.animate(root, instance, f * 0.1, 0.1);
  assert.deepEqual(root.position.toArray(), authoredPos, 'root position must stay exactly what was authored');
  assert.ok(root.userData.simTime > 0, 'simTime should have advanced');
  assert.notDeepEqual(Array.from(root.userData.currentPositions), positionsBefore, 'particle positions should have moved from their spawn points');
  assert.notDeepEqual(Array.from(root.userData.mesh.instanceMatrix.array), matrixBefore, 'the rendered instanceMatrix buffer should reflect the moved positions');
  // `.needsUpdate` is a write-only setter (bumps the internal `.version`
  // counter three.js's renderer checks — it has no getter, so reading it
  // back is always `undefined` by design); checking `.version` incremented
  // is the correct way to prove the GPU-upload flag was actually set.
  assert.ok(root.userData.mesh.instanceMatrix.version > versionBefore, 'instanceMatrix.needsUpdate should have been set (version should have incremented)');
});

test('homepage-particle-hero: motion.rotate=false ("FLOW" off) freezes the simulation entirely — no drift, no buffer writes', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', {
    id: 'h1', enabled: true, appearance: { particleCount: 80 }, motion: { rotate: false, speed: 1 },
  });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const positionsBefore = Array.from(root.userData.currentPositions);
  const simTimeBefore = root.userData.simTime;
  for (let f = 0; f < 10; f += 1) factory.animate(root, instance, f * 0.1, 0.1);
  assert.deepEqual(Array.from(root.userData.currentPositions), positionsBefore, 'positions must not drift while FLOW is off');
  assert.equal(root.userData.simTime, simTimeBefore, 'sim time must not advance while FLOW is off');
});

test('homepage-particle-hero: a topology change (particleCount) rebuilds the mesh with the new count and re-seeds fresh state, disposing the old geometry exactly once', () => {
  const factory = getFactory('homepage-particle-hero');
  const a = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 100 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const oldGeo = root.userData.mesh.geometry;
  const disposeCount = spyDispose(oldGeo);
  const b = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 300 } });
  factory.applyInstance(ctx(), root, b);
  // draft tier scales the requested count down (scaleSegments — see
  // quality.js) — 300 * TIER_DETAIL.draft(0.6) = 180, same as every other
  // tier-dependent factory; this isn't a special case for particles.
  const expectedCount = scaleSegments(300, 'draft', 50);
  assert.equal(root.userData.count, expectedCount);
  assert.equal(root.userData.currentPositions.length, expectedCount * 3);
  assert.equal(root.userData.mesh.count, expectedCount);
  assert.equal(disposeCount(), 1);
});

test('homepage-particle-hero: changing quality tier rebuilds (tier scales particle count down at lower tiers)', () => {
  const factory = getFactory('homepage-particle-hero');
  const instance = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 1000 } });
  const root = factory.create(ctx('draft'));
  factory.applyInstance(ctx('draft'), root, instance);
  const draftCount = root.userData.count;
  factory.applyInstance(ctx('ultra'), root, instance); // same instance reference, different tier
  const ultraCount = root.userData.count;
  assert.ok(ultraCount > draftCount, 'ultra tier should render more particles than draft for the same requested count');
});

test('homepage-particle-hero: a non-topology field change (appearance.chaos) preserves the mesh/geometry identity — no rebuild', () => {
  const factory = getFactory('homepage-particle-hero');
  const a = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 120, chaos: 0.3 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, a);
  const meshBefore = root.userData.mesh;
  const b = createElementInstance('homepage-particle-hero', { id: 'h1', enabled: true, appearance: { particleCount: 120, chaos: 1.2 } });
  factory.applyInstance(ctx(), root, b);
  assert.equal(root.userData.mesh, meshBefore, 'changing chaos (a visual-flow param, not topology) must not rebuild the InstancedMesh');
});

// ── GLB IMPORT — Phase 3. Structurally different from every other factory:
// loading is genuinely ASYNC (a network fetch), so `applyInstance` fires it
// and returns immediately; content lands under root.userData.motion a tick
// or few later. Every test here exercises the REAL GLTFLoader.parse() path
// (via the same createGLTFLoaderBundle production code, fed a real
// three-stdlib GLTFExporter-built fixture) with only `fetch` itself
// stubbed — that's the one genuinely-network boundary, and the right place
// to draw the line per this file's established "test the real thing where
// it can run at all" convention (see glb-loader.test.js). ─────────────────

// `clip` is a FACTORY `(mesh) => AnimationClip`, not a pre-built clip — see
// glb-loader.test.js's buildGLB for why a bare `.position`-named track
// (this file's own earlier form) silently round-trips with NO tracks at
// all: GLTFExporter needs the target object's uuid prefix to resolve which
// glTF node a channel's `target.node` should point at.
function buildGLBArrayBuffer({ position = [0, 0, 0], clip = null } = {}) {
  return new Promise((resolve, reject) => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x336699, metalness: 0.3, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...position);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const builtClip = typeof clip === 'function' ? clip(mesh) : clip;
    const exporter = new stdlib.GLTFExporter();
    exporter.parse(scene, resolve, reject, { binary: true, animations: builtClip ? [builtClip] : [] });
  });
}

/** Swaps global.fetch for the duration of `fn`, always restoring it afterward — even on throw. */
async function withMockFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function glbCtx({ assetId = 'asset-1', readUrl = 'https://storage.example.com/asset-1.glb' } = {}) {
  return {
    THREE, stdlib, tier: 'draft',
    glbLoader: createGLTFLoaderBundle({ THREE, stdlib }),
    glbAssetsById: assetId ? { [assetId]: { readUrl } } : {},
  };
}

const fetchOkWith = (arrayBuffer) => async () => ({ ok: true, arrayBuffer: async () => arrayBuffer });

test('glb-import: create() builds an empty root/motion pair, no crash', () => {
  const factory = getFactory('glb-import');
  const root = factory.create(glbCtx());
  assert.ok(root.isObject3D);
  assert.ok(root.userData.motion?.isObject3D);
  assert.equal(root.userData.motion.children.length, 0);
});

test('glb-import: applyInstance with no assetId selected stays empty — a real, honest state, not an error', async () => {
  const factory = getFactory('glb-import');
  const instance = createElementInstance('glb-import', { id: 'g1', enabled: true });
  const root = factory.create(glbCtx());
  factory.applyInstance(glbCtx(), root, instance);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(root.userData.motion.children.length, 0);
});

test('glb-import: selecting a known asset loads, normalizes (unit bounding sphere), and populates root.userData.motion', async () => {
  const factory = getFactory('glb-import');
  const buffer = await buildGLBArrayBuffer({ position: [3, -2, 1] });
  await withMockFetch(fetchOkWith(buffer), async () => {
    const instance = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1' } });
    const root = factory.create(glbCtx());
    factory.applyInstance(glbCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 1);
    const box = new THREE.Box3().setFromObject(root.userData.motion);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Normalized to GLB_NORMALIZE_TARGET_RADIUS (0.4), not a full unit
    // sphere — see that constant's own comment in factories.js for why.
    assert.ok(Math.abs(sphere.radius - 0.4) < 1e-4, `normalized bounding sphere should be ~radius 0.4, got ${sphere.radius}`);
    assert.ok(root.userData.mixer, 'an AnimationMixer should be created even for a clip-less asset');
  });
});

test('glb-import: an unknown/unresolved assetId (not yet in glbAssetsById) stays empty rather than throwing', async () => {
  const factory = getFactory('glb-import');
  const instance = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'does-not-exist' } });
  const root = factory.create(glbCtx({ assetId: 'asset-1' })); // library only knows about 'asset-1'
  assert.doesNotThrow(() => factory.applyInstance(glbCtx({ assetId: 'asset-1' }), root, instance));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(root.userData.motion.children.length, 0);
});

// Reproduces the exact gate-review-caught reload bug: the FIRST
// applyInstance call for a given assetId can find glbAssetsById still
// empty (a real, observed live-browser timing — the asset library fetch
// hadn't resolved yet at the moment ClothStudio.jsx's live-object-sync
// effect first ran after a page reload). A naive topology-signature gate
// would mark that assetId as "already handled" and never retry even once
// the library catches up on a LATER call with the exact same (unchanged)
// instance reference — this proves it actually does.
test('glb-import: a SAME (unchanged) instance whose asset was unresolvable on the first applyInstance call successfully loads on a later call once the asset becomes resolvable', async () => {
  const factory = getFactory('glb-import');
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    const instance = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1' } });
    const root = factory.create(glbCtx({ assetId: null })); // first call: library doesn't have this asset yet
    factory.applyInstance({ THREE, stdlib, tier: 'draft', glbLoader: createGLTFLoaderBundle({ THREE, stdlib }), glbAssetsById: {} }, root, instance);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 0, 'sanity: the first call genuinely could not resolve anything');

    // SAME instance reference (not a new object) — only the ctx changed,
    // simulating the asset list having finished loading in the meantime.
    factory.applyInstance(glbCtx({ assetId: 'asset-1' }), root, instance);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 1, 'the retry (same instance, now-resolvable ctx) must actually load the asset, not stay stuck empty forever');
  });
});

test('glb-import: a failed fetch is caught and leaves an empty (not crashed) state', async () => {
  const factory = getFactory('glb-import');
  await withMockFetch(async () => ({ ok: false, status: 404 }), async () => {
    const instance = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1' } });
    const root = factory.create(glbCtx());
    assert.doesNotThrow(() => factory.applyInstance(glbCtx(), root, instance));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 0);
  });
});

test('glb-import: animation clip selection plays the named clip and stops the previous one on change', async () => {
  const factory = getFactory('glb-import');
  const clip = (mesh) => new THREE.AnimationClip('Spin', 1, [
    new THREE.VectorKeyframeTrack(`${mesh.uuid}.position`, [0, 1], [0, 0, 0, 1, 0, 0]),
  ]);
  const buffer = await buildGLBArrayBuffer({ clip });
  await withMockFetch(fetchOkWith(buffer), async () => {
    const a = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1', animationClip: 'Spin' } });
    const root = factory.create(glbCtx());
    factory.applyInstance(glbCtx(), root, a);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(root.userData.clips.map((c) => c.name), ['Spin']);
    assert.equal(root.userData.clips[0].tracks.length, 1, 'the round-tripped clip must carry its track, not just its name');
    assert.equal(root.userData.activeClipName, 'Spin');
    assert.ok(root.userData.activeAction, 'the Spin clip should be actively playing');

    const b = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1', animationClip: '' } });
    factory.applyInstance(glbCtx(), root, b);
    assert.equal(root.userData.activeAction, null, 'clearing the clip selection should stop the active action');
  });
});

test('glb-import: animate() actually moves the loaded mesh while playing (not just the mixer\'s own clock), and freezes its position exactly while PLAY ANIMATION is off', async () => {
  const factory = getFactory('glb-import');
  const clip = (mesh) => new THREE.AnimationClip('Spin', 1, [
    new THREE.VectorKeyframeTrack(`${mesh.uuid}.position`, [0, 1], [0, 0, 0, 1, 0, 0]),
  ]);
  const buffer = await buildGLBArrayBuffer({ clip });
  await withMockFetch(fetchOkWith(buffer), async () => {
    const instance = createElementInstance('glb-import', {
      id: 'g1', enabled: true, appearance: { assetId: 'asset-1', animationClip: 'Spin' }, motion: { rotate: true, speed: 1 },
    });
    const root = factory.create(glbCtx());
    factory.applyInstance(glbCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
    const mesh = [];
    root.userData.motion.traverse((c) => { if (c.isMesh) mesh.push(c); });
    assert.equal(mesh.length, 1);
    const timeBefore = root.userData.mixer.time;
    const posBefore = mesh[0].position.x;
    factory.animate(root, instance, 0.5, 0.5);
    assert.ok(root.userData.mixer.time > timeBefore, 'mixer time should advance while PLAY ANIMATION is on');
    assert.notEqual(mesh[0].position.x, posBefore, 'the mesh\'s actual position must change, not just the mixer\'s internal clock — this is the exact gap a live browser check caught: an earlier version of this test used a malformed KeyframeTrack name that round-tripped with zero tracks, so the clock advanced but nothing was ever actually animated');
    assert.ok(Math.abs(mesh[0].position.x - 0.5) < 1e-6, `expected x=0.5 halfway through the 0->1 track, got ${mesh[0].position.x}`);

    const paused = createElementInstance('glb-import', {
      id: 'g1', enabled: true, appearance: { assetId: 'asset-1', animationClip: 'Spin' }, motion: { rotate: false, speed: 1 },
    });
    factory.applyInstance(glbCtx(), root, paused);
    const frozenAt = root.userData.mixer.time;
    const frozenPos = mesh[0].position.x;
    factory.animate(root, paused, 1, 0.5);
    assert.equal(root.userData.mixer.time, frozenAt, 'mixer time must not advance while PLAY ANIMATION is off');
    assert.equal(mesh[0].position.x, frozenPos, 'the mesh position must not drift while PLAY ANIMATION is off');
  });
});

test('glb-import: material override mutates the loaded mesh material in place and restores it exactly when disabled', async () => {
  const factory = getFactory('glb-import');
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    const instance = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1' } });
    const root = factory.create(glbCtx());
    factory.applyInstance(glbCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
    const mesh = [];
    root.userData.motion.traverse((c) => { if (c.isMesh) mesh.push(c); });
    assert.equal(mesh.length, 1);
    const originalHex = mesh[0].material.color.getHex();

    const overridden = createElementInstance('glb-import', {
      id: 'g1', enabled: true, appearance: { assetId: 'asset-1' },
      material: { overrideEnabled: true, tint: '#ff0000', metalness: 0.9, roughness: 0.1 },
    });
    factory.applyInstance(glbCtx(), root, overridden);
    assert.equal(mesh[0].material.color.getHexString(), 'ff0000');

    const restored = createElementInstance('glb-import', {
      id: 'g1', enabled: true, appearance: { assetId: 'asset-1' },
      material: { overrideEnabled: false },
    });
    factory.applyInstance(glbCtx(), root, restored);
    assert.equal(mesh[0].material.color.getHex(), originalHex);
  });
});

test('glb-import: changing assetId (topology) clears previous content immediately and loads the new asset', async () => {
  const factory = getFactory('glb-import');
  const bufferA = await buildGLBArrayBuffer({ position: [1, 0, 0] });
  const bufferB = await buildGLBArrayBuffer({ position: [-1, 0, 0] });
  const c = glbCtx();
  c.glbAssetsById = {
    'asset-a': { readUrl: 'https://storage.example.com/a.glb' },
    'asset-b': { readUrl: 'https://storage.example.com/b.glb' },
  };
  await withMockFetch(async (url) => ({ ok: true, arrayBuffer: async () => (url.includes('a.glb') ? bufferA : bufferB) }), async () => {
    const a = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-a' } });
    const root = factory.create(c);
    factory.applyInstance(c, root, a);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 1);

    const b = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-b' } });
    factory.applyInstance(c, root, b);
    // Synchronous, immediate: cleared before the new load even starts.
    assert.equal(root.userData.motion.children.length, 0, 'switching assets should clear the old content immediately, not wait for the new load');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 1, 'the new asset should have loaded in');
  });
});

test('glb-import: disposing while a load is still in flight discards the late-arriving result instead of leaking or reviving the removed element', async () => {
  const factory = getFactory('glb-import');
  const buffer = await buildGLBArrayBuffer();
  let resolveFetch;
  const slowFetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  await withMockFetch(slowFetch, async () => {
    const instance = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1' } });
    const root = factory.create(glbCtx());
    factory.applyInstance(glbCtx(), root, instance);
    factory.dispose(root); // dispose BEFORE the in-flight fetch resolves
    resolveFetch({ ok: true, arrayBuffer: async () => buffer });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 0, 'a load that resolves after disposal must not splice content into the disposed root');
  });
});

// ── TSHIRT MODEL — Part B (pivot round). The real downloaded GLB
// (public/models/merch/tshirt.glb) as an optional, standalone 3D merch
// element — separate from the procedural Primary T-Shirt Cloth
// (tshirt-mesh.test.js covers that one). Same async-load shape as glb-import
// above, simplified: no assetId lookup (the URL is fixed), no animation-clip
// selection (the source file has none) — so applyInstance fires the load
// unconditionally on first call rather than waiting on a user pick. ───────

function tshirtModelCtx() {
  return { THREE, stdlib, tier: 'draft', glbLoader: createGLTFLoaderBundle({ THREE, stdlib }) };
}

// Same ctx, plus an onTshirtModelStatus that records every status report in
// order — the same bridge ClothStudio.jsx wires into `ctx` in production,
// exercised directly here so the CALLBACK contract itself (not just the
// resulting userData) is under test: correct id, correct state sequence,
// and — critically — that it never fires for a superseded/disposed load.
function tshirtModelCtxWithLog() {
  const log = [];
  const ctx = {
    THREE, stdlib, tier: 'draft', glbLoader: createGLTFLoaderBundle({ THREE, stdlib }),
    onTshirtModelStatus: (id, status) => log.push({ id, ...status }),
  };
  return { ctx, log };
}

test('tshirt-model: create() builds an empty root/motion pair, no crash', () => {
  const factory = getFactory('tshirt-model');
  const root = factory.create(tshirtModelCtx());
  assert.ok(root.isObject3D);
  assert.ok(root.userData.motion?.isObject3D);
  assert.equal(root.userData.motion.children.length, 0);
});

test('tshirt-model: applyInstance fetches the canonical fixed URL, not an asset-library lookup', async () => {
  const buffer = await buildGLBArrayBuffer();
  let requestedUrl = null;
  await withMockFetch(async (url) => { requestedUrl = url; return { ok: true, arrayBuffer: async () => buffer }; }, async () => {
    const factory = getFactory('tshirt-model');
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const root = factory.create(tshirtModelCtx());
    factory.applyInstance(tshirtModelCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(requestedUrl, '/models/merch/tshirt.glb');
    assert.ok(root.userData.motion.children.length > 0, 'the fixed asset should load without any assetId being set');
  });
});

test('tshirt-model: successful load normalizes the mesh to the documented bounding-sphere radius', async () => {
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    const factory = getFactory('tshirt-model');
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const root = factory.create(tshirtModelCtx());
    factory.applyInstance(tshirtModelCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
    const box = new THREE.Box3().setFromObject(root.userData.motion);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    assert.ok(sphere.radius <= 0.46 + 1e-6, `normalized radius should not exceed 0.46, got ${sphere.radius}`);
    assert.ok(sphere.radius > 0, 'should have real, non-degenerate geometry');
  });
});

test('tshirt-model: a failed fetch is caught, leaves an honest empty state, and records loadError instead of throwing', async () => {
  await withMockFetch(async () => { throw new Error('network down'); }, async () => {
    const factory = getFactory('tshirt-model');
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const root = factory.create(tshirtModelCtx());
    assert.doesNotThrow(() => factory.applyInstance(tshirtModelCtx(), root, instance));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 0);
    assert.ok(root.userData.loadError, 'a failed load should be recorded as an honest error state');
  });
});

// ── Async-state defect regression (Codex P1 review, Part B — two rounds).
// Round 1 replaced the original "motion.children.length === 0 means retry"
// inference with an idle/loading/loaded/error state machine, but that
// state machine still had a gap: `tshirtModelRetry` unconditionally reset
// straight to 'idle' regardless of current state, so two rapid Retry
// clicks (or the Inspector's own re-render lagging behind a fast click)
// could each independently reset to idle and each launch their own fetch
// — parallel requests, exactly the failure mode the whole fix exists to
// prevent, just reachable from Retry instead of a transform drag. Round 2
// (this one) closes that gap (tshirtModelRetry now no-ops while already
// 'loading'), adds an explicit 'disposed' state so a disposed root can
// never be reactivated by a late reconciliation call, and replaces the
// Inspector's polling bridge with a push-based callback
// (ctx.onTshirtModelStatus) so status changes reach React immediately
// instead of on up to a 400ms delay. ───────────────────────────────────────

test('tshirt-model: while a load is in flight, repeated applyInstance calls (e.g. a transform drag) never launch a second concurrent fetch', async () => {
  const buffer = await buildGLBArrayBuffer();
  let fetchCalls = 0;
  let resolveFetch;
  const slowFetch = () => { fetchCalls += 1; return new Promise((resolve) => { resolveFetch = resolve; }); };
  await withMockFetch(slowFetch, async () => {
    const factory = getFactory('tshirt-model');
    const root = factory.create(tshirtModelCtx());
    // Simulate a drag: several applyInstance calls with different transforms
    // while the very first load is still unresolved.
    for (let i = 0; i < 5; i += 1) {
      const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true, transform: { position: [i * 0.1, 0, 0] } });
      factory.applyInstance(tshirtModelCtx(), root, instance);
    }
    assert.equal(fetchCalls, 1, 'only the very first applyInstance call while idle should start a fetch — later calls while loading must not start another');
    assert.equal(root.userData.loadState, 'loading');
    // The transform from the LAST call during the drag must still have
    // taken effect even though no fetch fired for it.
    assert.equal(root.position.x, 0.4, 'transform must keep applying live even while the asset is still loading');
    resolveFetch({ ok: true, arrayBuffer: async () => buffer });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.loadState, 'loaded');
    assert.ok(root.userData.motion.children.length > 0);
    // The transform edits made mid-load must SURVIVE resolution — the
    // load itself never touches root.position.
    assert.equal(root.position.x, 0.4, 'the last transform applied during loading must still hold after the load resolves');
  });
});

test('tshirt-model: a successful resolution transitions loading → loaded and clears any error, reported through the status callback in order', async () => {
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    const factory = getFactory('tshirt-model');
    const { ctx, log } = tshirtModelCtxWithLog();
    const root = factory.create(ctx);
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    factory.applyInstance(ctx, root, instance);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.loadState, 'loaded');
    assert.equal(root.userData.loadError, null);
    assert.deepEqual(log, [
      { id: 't1', state: 'loading', error: null },
      { id: 't1', state: 'loaded', error: null },
    ], 'the status callback must report the exact loading → loaded sequence, for the correct instance id, with no error');
  });
});

test('tshirt-model: a failed resolution transitions loading → error, reported through the status callback with the failure message', async () => {
  await withMockFetch(async () => { throw new Error('network down'); }, async () => {
    const factory = getFactory('tshirt-model');
    const { ctx, log } = tshirtModelCtxWithLog();
    const root = factory.create(ctx);
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    factory.applyInstance(ctx, root, instance);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.loadState, 'error');
    assert.deepEqual(log, [
      { id: 't1', state: 'loading', error: null },
      { id: 't1', state: 'error', error: 'network down' },
    ]);
  });
});

test('tshirt-model: once a load fails, a bare applyInstance call (an unrelated instance edit) does NOT silently retry — only tshirtModelRetry does', async () => {
  const factory = getFactory('tshirt-model');
  const root = factory.create(tshirtModelCtx());
  let fetchCalls = 0;
  await withMockFetch(async () => { fetchCalls += 1; throw new Error('network down'); }, async () => {
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    factory.applyInstance(tshirtModelCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(fetchCalls, 1);
  assert.equal(root.userData.loadState, 'error');
  assert.ok(root.userData.loadError, 'the failure must be recorded for the Inspector to read');

  await withMockFetch(async () => { fetchCalls += 1; throw new Error('network down'); }, async () => {
    // An edit unrelated to retrying (e.g. moving the element) — must NOT
    // itself re-fire the fetch.
    const movedButStillBroken = createElementInstance('tshirt-model', { id: 't1', enabled: true, transform: { position: [1, 0, 0] } });
    factory.applyInstance(tshirtModelCtx(), root, movedButStillBroken);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fetchCalls, 1, 'a plain applyInstance call after a failure must not itself retry the fetch');
    assert.equal(root.userData.loadState, 'error', 'state must stay error — nothing here should have "fixed" it');
    assert.equal(root.position.x, 1, 'the transform edit itself must still take effect even though the model stays broken');
  });

  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(async () => { fetchCalls += 1; return { ok: true, arrayBuffer: async () => buffer }; }, async () => {
    const retryInstance = createElementInstance('tshirt-model', { id: 't1', enabled: true, transform: { position: [1, 0, 0] } });
    tshirtModelRetry(tshirtModelCtx(), root, retryInstance); // the ONLY sanctioned way out of 'error'
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.loadState, 'loaded');
    assert.ok(root.userData.motion.children.length > 0, 'an explicit retry should succeed once the asset is reachable again');
  });
  // Retry after failure performed exactly ONE additional fetch — total is
  // the original failed attempt (1) plus the one retry attempt (1) = 2,
  // never more.
  assert.equal(fetchCalls, 2);
});

test('tshirt-model: repeated Retry actions while the retry request is pending do not create parallel fetches', async () => {
  const factory = getFactory('tshirt-model');
  const root = factory.create(tshirtModelCtx());
  await withMockFetch(async () => { throw new Error('network down'); }, async () => {
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    factory.applyInstance(tshirtModelCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(root.userData.loadState, 'error');

  const buffer = await buildGLBArrayBuffer();
  let fetchCalls = 0;
  let resolveFetch;
  const slowFetch = () => { fetchCalls += 1; return new Promise((resolve) => { resolveFetch = resolve; }); };
  await withMockFetch(slowFetch, async () => {
    const retryInstance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    // Simulate several rapid Retry clicks landing before the first retry
    // has resolved (or before the UI has re-rendered to hide the button).
    tshirtModelRetry(tshirtModelCtx(), root, retryInstance);
    tshirtModelRetry(tshirtModelCtx(), root, retryInstance);
    tshirtModelRetry(tshirtModelCtx(), root, retryInstance);
    assert.equal(fetchCalls, 1, 'only the FIRST retry click should start a fetch — the others must no-op while one is already in flight');
    assert.equal(root.userData.loadState, 'loading');
    resolveFetch({ ok: true, arrayBuffer: async () => buffer });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.loadState, 'loaded');
    assert.equal(fetchCalls, 1, 'still exactly one fetch for the whole retry burst');
  });
});

test('tshirt-model: a material change made WHILE the load is still in flight is applied using the latest settings once the load lands, not a stale snapshot from load-start', async () => {
  const buffer = await buildGLBArrayBuffer();
  let resolveFetch;
  const slowFetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  await withMockFetch(slowFetch, async () => {
    const factory = getFactory('tshirt-model');
    const root = factory.create(tshirtModelCtx());
    const initial = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    factory.applyInstance(tshirtModelCtx(), root, initial);
    assert.equal(root.userData.loadState, 'loading');

    // Instance changes mid-flight (e.g. the user toggled material override
    // while the 10MB asset was still downloading) — applyInstance must
    // record it without starting a second fetch.
    const overridden = createElementInstance('tshirt-model', {
      id: 't1', enabled: true,
      material: { overrideEnabled: true, tint: '#ff0000', metalness: 0.9, roughness: 0.1 },
    });
    factory.applyInstance(tshirtModelCtx(), root, overridden);
    assert.equal(root.userData.loadState, 'loading', 'still only one request in flight');

    resolveFetch({ ok: true, arrayBuffer: async () => buffer });
    await new Promise((r) => setTimeout(r, 20));

    let target = null;
    root.userData.motion.traverse((c) => { if (c.isMesh && !target) target = c; });
    assert.ok(target, 'sanity: the mesh did load');
    // buildGLBArrayBuffer's fixture mesh is authored at color 0x336699 —
    // the override's tint (#ff0000) must have been applied on top of the
    // freshly-loaded mesh, proving the material call after load used the
    // LATEST instance (captured mid-flight), not whatever was current when
    // the load first started.
    assert.notEqual(target.material.color.getHex(), 0x336699, 'the override made mid-load should be applied once the load actually lands, not the stale pre-edit settings');
  });
});

test('tshirt-model: disposing while a load is still in flight transitions to \'disposed\', frees the late-arriving GLB\'s own geometry/material, and never reports status for it', async () => {
  const factory = getFactory('tshirt-model');
  const buffer = await buildGLBArrayBuffer();
  let resolveFetch;
  const slowFetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  await withMockFetch(slowFetch, async () => {
    const { ctx, log } = tshirtModelCtxWithLog();
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const root = factory.create(ctx);
    factory.applyInstance(ctx, root, instance);
    factory.dispose(root); // dispose BEFORE the in-flight fetch resolves
    assert.equal(root.userData.loadState, 'disposed');
    resolveFetch({ ok: true, arrayBuffer: async () => buffer });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 0, 'a load that resolves after disposal must not splice content into the disposed root');
    assert.deepEqual(log, [{ id: 't1', state: 'loading', error: null }], 'the late success must never report a status — only the pre-dispose "loading" entry should exist');
    // A disposed root must be fully inert — a later reconciliation call
    // (which shouldn't happen in production, but must be safe if it did)
    // must not reactivate it.
    factory.applyInstance(ctx, root, createElementInstance('tshirt-model', { id: 't1', enabled: true, transform: { position: [5, 0, 0] } }));
    assert.equal(root.position.x, 0, 'applyInstance on a disposed root must be a complete no-op, including transform');
    assert.equal(root.userData.loadState, 'disposed');
  });
});

test('tshirt-model: removing an instance mid-load (dispose) prevents a stale async completion from restoring its status or scene content — including a FAILED late resolution', async () => {
  const factory = getFactory('tshirt-model');
  let rejectFetch;
  const slowFetch = () => new Promise((_resolve, reject) => { rejectFetch = reject; });
  await withMockFetch(slowFetch, async () => {
    const { ctx, log } = tshirtModelCtxWithLog();
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const root = factory.create(ctx);
    factory.applyInstance(ctx, root, instance);
    factory.dispose(root); // the element was removed from the scene while its load was still in flight
    rejectFetch(new Error('late failure after removal'));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.loadState, 'disposed', 'must stay disposed — a late FAILURE must not flip it to error');
    assert.equal(root.userData.loadError, null, 'a late failure after disposal must not populate loadError either');
    assert.deepEqual(log, [{ id: 't1', state: 'loading', error: null }], 'no error status may be reported for a load that resolved after its element was removed');
  });
});

test('tshirt-model: material override mutates the loaded mesh material in place and restores it exactly when disabled', async () => {
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    const factory = getFactory('tshirt-model');
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const root = factory.create(tshirtModelCtx());
    factory.applyInstance(tshirtModelCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));
    let target = null;
    root.userData.motion.traverse((c) => { if (c.isMesh && !target) target = c; });
    assert.ok(target, 'sanity: a real mesh loaded');
    const originalColor = target.material.color.getHex();

    const overridden = createElementInstance('tshirt-model', {
      id: 't1', enabled: true,
      material: { overrideEnabled: true, tint: '#ff0000', metalness: 0.9, roughness: 0.1 },
    });
    factory.applyInstance(tshirtModelCtx(), root, overridden);
    assert.notEqual(target.material.color.getHex(), originalColor, 'override should mutate the material color');

    const restored = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    factory.applyInstance(tshirtModelCtx(), root, restored);
    assert.equal(target.material.color.getHex(), originalColor, 'disabling the override should restore the original material color exactly');
  });
});

test('tshirt-model: turntable spin is OFF by default and only rotates root.userData.motion (never root.rotation directly) when enabled', async () => {
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    const factory = getFactory('tshirt-model');
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    assert.equal(instance.motion.rotate, false, 'turntable spin must default to off');
    const root = factory.create(tshirtModelCtx());
    factory.applyInstance(tshirtModelCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));

    factory.animate(root, instance, 1, 1 / 60);
    assert.equal(root.userData.motion.rotation.y, 0, 'no spin while rotate is off');
    assert.equal(root.rotation.y, 0, 'animate() must never touch root.rotation directly');

    const spinning = createElementInstance('tshirt-model', { id: 't1', enabled: true, motion: { rotate: true, speed: 1 } });
    factory.animate(root, spinning, 1, 1 / 60);
    assert.ok(root.userData.motion.rotation.y > 0, 'enabling rotate should spin root.userData.motion');
    assert.equal(root.rotation.y, 0, 'animate() must still never touch root.rotation directly');
  });
});

test('tshirt-model: disposing while a load is still in flight discards the late-arriving result instead of leaking or reviving the removed element', async () => {
  const factory = getFactory('tshirt-model');
  const buffer = await buildGLBArrayBuffer();
  let resolveFetch;
  const slowFetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  await withMockFetch(slowFetch, async () => {
    const instance = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const root = factory.create(tshirtModelCtx());
    factory.applyInstance(tshirtModelCtx(), root, instance);
    factory.dispose(root); // dispose BEFORE the in-flight fetch resolves
    resolveFetch({ ok: true, arrayBuffer: async () => buffer });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.userData.motion.children.length, 0, 'a load that resolves after disposal must not splice content into the disposed root');
  });
});

test('tshirt-model: two duplicated instances load and dispose independently (own root, own token, no cross-talk)', async () => {
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    const factory = getFactory('tshirt-model');
    const instanceA = createElementInstance('tshirt-model', { id: 't1', enabled: true });
    const instanceB = createElementInstance('tshirt-model', { id: 't2', enabled: true });
    const rootA = factory.create(tshirtModelCtx());
    const rootB = factory.create(tshirtModelCtx());
    factory.applyInstance(tshirtModelCtx(), rootA, instanceA);
    factory.applyInstance(tshirtModelCtx(), rootB, instanceB);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(rootA.userData.motion.children.length > 0);
    assert.ok(rootB.userData.motion.children.length > 0);
    assert.notEqual(rootA, rootB);

    let meshA = null;
    rootA.userData.motion.traverse((c) => { if (c.isMesh && !meshA) meshA = c; });
    const geoDisposeCount = spyDispose(meshA.geometry);
    factory.dispose(rootA);
    assert.strictEqual(geoDisposeCount(), 1, 'disposing A should free its own geometry exactly once');
    assert.ok(rootB.userData.motion.children.length > 0, 'B must stay intact after A is disposed — no shared state between duplicated instances');
    factory.dispose(rootB);
  });
});

test('tshirt-model: two duplicated instances maintain fully independent lifecycle states — one failing and retrying never touches the other, and status callbacks never cross ids', async () => {
  const factory = getFactory('tshirt-model');
  const { ctx, log } = tshirtModelCtxWithLog();
  const instanceA = createElementInstance('tshirt-model', { id: 't1', enabled: true });
  const instanceB = createElementInstance('tshirt-model', { id: 't2', enabled: true });
  const rootA = factory.create(ctx);
  const rootB = factory.create(ctx);

  // A fails, B succeeds — same tick, same shared ctx/callback.
  await withMockFetch(async () => { throw new Error('A network down'); }, async () => {
    factory.applyInstance(ctx, rootA, instanceA);
    await new Promise((r) => setTimeout(r, 20));
  });
  const buffer = await buildGLBArrayBuffer();
  await withMockFetch(fetchOkWith(buffer), async () => {
    factory.applyInstance(ctx, rootB, instanceB);
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.equal(rootA.userData.loadState, 'error');
  assert.equal(rootB.userData.loadState, 'loaded');
  assert.deepEqual(log, [
    { id: 't1', state: 'loading', error: null },
    { id: 't1', state: 'error', error: 'A network down' },
    { id: 't2', state: 'loading', error: null },
    { id: 't2', state: 'loaded', error: null },
  ], 'every status report must carry the correct id — A\'s failure must never appear under t2 or vice versa');

  // Retrying A must not touch B at all.
  await withMockFetch(fetchOkWith(buffer), async () => {
    tshirtModelRetry(ctx, rootA, instanceA);
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(rootA.userData.loadState, 'loaded', 'A should recover independently via its own retry');
  assert.equal(rootB.userData.loadState, 'loaded', 'B must be completely unaffected by A\'s retry');
  assert.deepEqual(log.slice(-2), [
    { id: 't1', state: 'loading', error: null },
    { id: 't1', state: 'loaded', error: null },
  ], 'A\'s retry must report only under t1');

  factory.dispose(rootA);
  factory.dispose(rootB);
});

test('tshirt-model catalog entry: not singleInstanceRenderer, so it gets full standard add/duplicate behavior — never auto-appears with the primary cloth', () => {
  const def = getElementDefinition('tshirt-model');
  assert.ok(def, 'catalog entry must exist');
  assert.notEqual(def.singleInstanceRenderer, true, 'tshirt-model must support normal add/duplicate — it is not the primary-cloth singleton');
  assert.notEqual(def.type, 'hanging-tshirt', 'must be a distinct internal type from the primary cloth');
});

// ── clearGroup — shared-GPU-resource de-duplication (gate review
// correction). Every one of the six procedural factories happens to give
// each mesh its own unique geometry/material, so these cases never arose
// before glb-import: an uploaded GLB commonly shares a geometry or texture
// across multiple nodes/materials, and disposing the same underlying
// resource twice is a real bug three.js does not guard against. ─────────

test('clearGroup: a geometry AND material shared by two meshes (via a REAL GLTFExporter/GLTFLoader round trip — glTF meshes referenced by two nodes) is disposed exactly once each, not once per mesh', async () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const meshA = new THREE.Mesh(geo, mat);
  meshA.position.set(-1, 0, 0);
  const meshB = new THREE.Mesh(geo, mat);
  meshB.position.set(1, 0, 0);
  const scene = new THREE.Scene();
  scene.add(meshA, meshB);
  const exporter = new stdlib.GLTFExporter();
  const buffer = await new Promise((resolve, reject) => exporter.parse(scene, resolve, reject, { binary: true }));

  await withMockFetch(async () => ({ ok: true, arrayBuffer: async () => buffer }), async () => {
    const factory = getFactory('glb-import');
    const instance = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-1' } });
    const root = factory.create(glbCtx());
    factory.applyInstance(glbCtx(), root, instance);
    await new Promise((r) => setTimeout(r, 20));

    const meshes = [];
    root.userData.motion.traverse((c) => { if (c.isMesh) meshes.push(c); });
    assert.strictEqual(meshes.length, 2, 'sanity: the loaded scene really does have two meshes');
    assert.strictEqual(meshes[0].geometry, meshes[1].geometry, 'sanity: they really do share one geometry');
    assert.strictEqual(meshes[0].material, meshes[1].material, 'sanity: they really do share one material');

    const geoDisposeCount = spyDispose(meshes[0].geometry);
    const matDisposeCount = spyDispose(meshes[0].material);
    factory.dispose(root);
    assert.strictEqual(geoDisposeCount(), 1, 'the shared geometry must be disposed exactly once, not twice');
    assert.strictEqual(matDisposeCount(), 1, 'the shared material must be disposed exactly once, not twice');
  });
});

test('clearGroup: a texture shared across TWO DIFFERENT materials is disposed exactly once (direct object-graph construction — GLTFExporter cannot export textures headlessly, no `document`/canvas in Node)', () => {
  const sharedTex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  const matA = new THREE.MeshStandardMaterial({ map: sharedTex });
  const matB = new THREE.MeshStandardMaterial({ map: sharedTex });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), matA));
  root.add(new THREE.Mesh(new THREE.SphereGeometry(), matB));

  const texDisposeCount = spyDispose(sharedTex);
  clearGroup(root);
  assert.strictEqual(texDisposeCount(), 1, 'a texture shared by two DIFFERENT materials must be disposed exactly once');
});

test('clearGroup: a skeleton shared by two SkinnedMesh instances is disposed exactly once', () => {
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const geoA = new THREE.BoxGeometry();
  const geoB = new THREE.SphereGeometry();
  const mat = new THREE.MeshStandardMaterial();
  const meshA = new THREE.SkinnedMesh(geoA, mat);
  meshA.bind(skeleton);
  const meshB = new THREE.SkinnedMesh(geoB, mat);
  meshB.bind(skeleton);
  const root = new THREE.Group();
  root.add(meshA, meshB);

  let disposeCalls = 0;
  const originalDispose = skeleton.dispose.bind(skeleton);
  skeleton.dispose = () => { disposeCalls += 1; originalDispose(); };

  clearGroup(root);
  assert.strictEqual(disposeCalls, 1, 'a skeleton shared by two SkinnedMesh instances must be disposed exactly once');
});

test('clearGroup: geometry/material identity is preserved for de-dup detection ACROSS an asset-replacement clearGroup call inside glbLoadAsset (not just at final dispose)', async () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x336699 });
  const meshA = new THREE.Mesh(geo, mat);
  meshA.position.set(-1, 0, 0);
  const meshB = new THREE.Mesh(geo, mat);
  meshB.position.set(1, 0, 0);
  const scene = new THREE.Scene();
  scene.add(meshA, meshB);
  const exporter = new stdlib.GLTFExporter();
  const bufferA = await new Promise((resolve, reject) => exporter.parse(scene, resolve, reject, { binary: true }));
  const bufferB = await buildGLBArrayBuffer({ position: [5, 0, 0] }); // a different, simple single-mesh asset to switch to

  const c = glbCtx();
  c.glbAssetsById = {
    'asset-shared': { readUrl: 'https://storage.example.com/shared.glb' },
    'asset-b': { readUrl: 'https://storage.example.com/b.glb' },
  };
  await withMockFetch(async (url) => ({ ok: true, arrayBuffer: async () => (url.includes('shared.glb') ? bufferA : bufferB) }), async () => {
    const factory = getFactory('glb-import');
    const first = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-shared' } });
    const root = factory.create(c);
    factory.applyInstance(c, root, first);
    await new Promise((r) => setTimeout(r, 20));

    const meshes = [];
    root.userData.motion.traverse((ch) => { if (ch.isMesh) meshes.push(ch); });
    assert.strictEqual(meshes.length, 2);
    const geoDisposeCount = spyDispose(meshes[0].geometry);

    // Switching to a DIFFERENT asset triggers glbLoadAsset's own internal
    // clearGroup(motion) call on the OLD (shared-geometry) content — this
    // is the "asset replacement" disposal path, distinct from factory.
    // dispose()/element removal below.
    const second = createElementInstance('glb-import', { id: 'g1', enabled: true, appearance: { assetId: 'asset-b' } });
    factory.applyInstance(c, root, second);
    assert.strictEqual(geoDisposeCount(), 1, 'switching assets must dispose the OLD shared geometry exactly once, not once per mesh that referenced it');
  });
});

// ── HANGING T-SHIRT ─────────────────────────────────────────────────────
// The base garment (no logo) is fully synchronous real geometry, so it
// already runs through the generic per-type loop above. These tests cover
// what that loop can't: front+back panel structure, the hanger toggle,
// per-instance sim independence, the pin line actually holding through the
// real factory (not just tshirt-mesh.js in isolation), motion pause/resume
// freezing the whole simulation, and the logo load/dispose wiring. A real
// image decode (THREE.TextureLoader -> browser Image element) has no DOM in
// plain node:test, so the "successfully loads and shows a logo" path is
// live-browser-verified instead (see the Studio SSOT checkpoint) — these
// tests cover every code path that doesn't require an actual decoded image.

function tshirtCtx(overrides = {}) {
  return { THREE, stdlib, tier: 'draft', ...overrides };
}

test('hanging-tshirt: builds distinct front and back meshes plus a hanger group under motion', () => {
  const factory = getFactory('hanging-tshirt');
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true });
  const root = factory.create(tshirtCtx());
  factory.applyInstance(tshirtCtx(), root, instance);
  const meshes = root.userData.motion.children.filter((c) => c.isMesh);
  assert.equal(meshes.length, 2, 'front + back panel meshes');
  assert.notEqual(meshes[0].geometry, meshes[1].geometry, 'front/back are separate geometries');
  assert.notEqual(meshes[0].material, meshes[1].material, 'front/back are separate materials (only front carries the logo shader)');
  assert.ok(root.userData.hanger?.isObject3D, 'hanger group exists');
});

test('hanging-tshirt: SHOW HANGER toggle controls hanger visibility without a rebuild', () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx());
  const shown = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { hangerVisible: true } });
  factory.applyInstance(tshirtCtx(), root, shown);
  const geoBefore = root.userData.frontGeo;
  assert.equal(root.userData.hanger.visible, true);
  const hidden = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { hangerVisible: false } });
  factory.applyInstance(tshirtCtx(), root, hidden);
  assert.equal(root.userData.hanger.visible, false);
  assert.equal(root.userData.frontGeo, geoBefore, 'toggling the hanger must not rebuild the garment geometry');
});

test('hanging-tshirt: two instances own independent simulation state (duplication isolation)', () => {
  const factory = getFactory('hanging-tshirt');
  const a = factory.create(tshirtCtx());
  const b = factory.create(tshirtCtx());
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true });
  factory.applyInstance(tshirtCtx(), a, instance);
  factory.applyInstance(tshirtCtx(), b, instance);
  assert.notEqual(a.userData.sim, b.userData.sim, 'distinct sim objects');
  assert.notEqual(a.userData.sim.position, b.userData.sim.position, 'distinct position buffers');
  for (let i = 0; i < 40; i += 1) {
    factory.animate(a, instance, i * 0.016, 0.016);
  }
  assert.notDeepEqual(Array.from(a.userData.sim.position), Array.from(b.userData.sim.position), 'animating one instance must never affect the other');
});

test('hanging-tshirt: pinned shoulder/sleeve vertices never move through the real factory, across many animate() frames', () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx());
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, motion: { rotate: true, speed: 1 } });
  factory.applyInstance(tshirtCtx(), root, instance);
  const { sim } = root.userData;
  const pinSample = [...sim.pinIndices].slice(0, 5);
  const before = pinSample.map((i) => [sim.position[i * 3], sim.position[i * 3 + 1], sim.position[i * 3 + 2]]);
  for (let f = 0; f < 60; f += 1) factory.animate(root, instance, f * 0.016, 0.016);
  pinSample.forEach((i, idx) => {
    assert.deepEqual([sim.position[i * 3], sim.position[i * 3 + 1], sim.position[i * 3 + 2]], before[idx], `pinned vertex ${i} must stay exactly at its hanger position`);
  });
});

test('hanging-tshirt: motion.rotate=false (MOTION off) freezes the entire simulation exactly where it is', () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx());
  const running = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, motion: { rotate: true, speed: 1 } });
  factory.applyInstance(tshirtCtx(), root, running);
  for (let f = 0; f < 20; f += 1) factory.animate(root, running, f * 0.016, 0.016); // let it settle into a non-rest drape
  const settled = Array.from(root.userData.sim.position);
  const paused = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, motion: { rotate: false, speed: 1 } });
  factory.applyInstance(tshirtCtx(), root, paused);
  for (let f = 0; f < 30; f += 1) factory.animate(root, paused, f * 0.016, 0.016);
  assert.deepEqual(Array.from(root.userData.sim.position), settled, 'paused motion must not advance the simulation at all');
});

test('hanging-tshirt: an unresolved logoAssetId (not in ctx.logoAssetsById) stays honestly empty, no crash', async () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx({ logoAssetsById: {} }));
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { logoAssetId: 'does-not-exist' } });
  assert.doesNotThrow(() => factory.applyInstance(tshirtCtx({ logoAssetsById: {} }), root, instance));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(root.userData.logoUniforms.uHasLogo.value, 0);
  assert.equal(root.userData.logoTexture, undefined);
});

test('hanging-tshirt: clearing logoAssetId (remove logo) turns uHasLogo back off', async () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx({ logoAssetsById: {} }));
  const withId = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { logoAssetId: 'ghost' } });
  factory.applyInstance(tshirtCtx({ logoAssetsById: {} }), root, withId);
  await new Promise((r) => setTimeout(r, 10));
  const removed = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { logoAssetId: '' } });
  factory.applyInstance(tshirtCtx({ logoAssetsById: {} }), root, removed);
  assert.equal(root.userData.logoUniforms.uHasLogo.value, 0);
});

test('hanging-tshirt: dispose() never throws when no logo was ever loaded', () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx());
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true });
  factory.applyInstance(tshirtCtx(), root, instance);
  assert.doesNotThrow(() => factory.dispose(root));
  assert.equal(root.children.length, 0);
});

test('hanging-tshirt: dispose() frees a resolved logo texture exactly once', () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx());
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true });
  factory.applyInstance(tshirtCtx(), root, instance);
  let disposeCalls = 0;
  root.userData.logoTexture = { dispose: () => { disposeCalls += 1; } };
  factory.dispose(root);
  assert.equal(disposeCalls, 1);
});

// ── Codex review regressions (2026-07-29): logo library deletion did not
// reconcile shirts that never got their OWN instance reference changed, and
// a failed/in-flight replacement logo could show the PREVIOUS logo under
// the new selection. Real image decode has no DOM in plain node:test (see
// the header comment on this HANGING T-SHIRT block), so both tests inject
// a "previously loaded" state directly (same technique as the dispose test
// above) rather than going through a real successful TextureLoader decode —
// this is legitimate here because both bugs are about what happens to an
// ALREADY-loaded texture when the wanted state changes out from under it,
// not about the decode itself.

test('hanging-tshirt: a logo deleted from the library is cleared on the next applyInstance, even with the SAME instance reference (duplicate-shirt reconciliation)', async () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx({ logoAssetsById: { 'logo-1': { dataUrl: 'data:image/png;base64,fake' } } }));
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { logoAssetId: 'logo-1' } });
  factory.applyInstance(tshirtCtx({ logoAssetsById: { 'logo-1': { dataUrl: 'data:image/png;base64,fake' } } }), root, instance);
  // Simulate a previously-successful decode (real decode has no DOM in Node) —
  // this is the state the shirt would be in right after a real upload.
  let disposeCalls = 0;
  const fakeTexture = { dispose: () => { disposeCalls += 1; } };
  root.userData.logoUrlLoaded = 'data:image/png;base64,fake';
  root.userData.logoTexture = fakeTexture;
  root.userData.logoUniforms.uHasLogo.value = 1;
  root.userData.logoUniforms.uLogoMap.value = fakeTexture;

  // The library entry is gone (deleted), but `instance` itself — same
  // object reference — never changed. This is exactly the state a
  // duplicated, non-selected shirt is in after the Inspector deletes a
  // logo out from under it.
  const emptyCtx = tshirtCtx({ logoAssetsById: {} });
  factory.applyInstance(emptyCtx, root, instance);
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(root.userData.logoUniforms.uHasLogo.value, 0, 'must stop showing the deleted logo');
  assert.equal(root.userData.logoUrlLoaded, null);
  assert.equal(disposeCalls, 1, 'the deleted texture must actually be disposed, not just detached');
  assert.equal(root.userData.logoUniforms.uLogoMap.value, null, 'Codex review: the shader uniform must not keep pointing at the now-disposed texture');
});

test('hanging-tshirt: a failed replacement logo load clears the PREVIOUS logo instead of leaving it visible under the new (broken) selection', async () => {
  const factory = getFactory('hanging-tshirt');
  const root = factory.create(tshirtCtx());
  const a = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { logoAssetId: 'logo-a' } });
  factory.applyInstance(tshirtCtx({ logoAssetsById: {} }), root, a);
  // Simulate logo A having previously decoded successfully.
  let disposeCalls = 0;
  const fakeTextureA = { dispose: () => { disposeCalls += 1; } };
  root.userData.logoUrlLoaded = 'data:image/png;base64,logo-a-bytes';
  root.userData.logoTexture = fakeTextureA;
  root.userData.logoUniforms.uHasLogo.value = 1;
  root.userData.logoUniforms.uLogoMap.value = fakeTextureA;

  // Switch to logo B. Its URL resolves (so tshirtApplyInstance fires a real
  // load attempt), but THREE.TextureLoader always rejects in plain Node (no
  // DOM Image element) — the same real failure path a genuinely broken/
  // corrupt upload would hit in the browser.
  const b = createElementInstance('hanging-tshirt', { id: 't1', enabled: true, appearance: { logoAssetId: 'logo-b' } });
  const bCtx = tshirtCtx({ logoAssetsById: { 'logo-b': { dataUrl: 'data:image/png;base64,logo-b-bytes' } } });
  factory.applyInstance(bCtx, root, b);
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(root.userData.logoUniforms.uHasLogo.value, 0, 'must not keep showing logo A under the logo-B selection');
  assert.equal(root.userData.logoUrlLoaded, null);
  assert.equal(disposeCalls, 1, 'logo A\'s texture must be disposed, not left dangling');
  assert.equal(root.userData.logoUniforms.uLogoMap.value, null, 'Codex review: the shader uniform must not keep pointing at the now-disposed logo A texture');
});

test('hanging-tshirt: quality tier bounds vertex/constraint counts (performance safeguard)', () => {
  const factory = getFactory('hanging-tshirt');
  const instance = createElementInstance('hanging-tshirt', { id: 't1', enabled: true });
  const draftRoot = factory.create(tshirtCtx());
  factory.applyInstance(tshirtCtx(), draftRoot, instance);
  const ultraRoot = factory.create(tshirtCtx({ tier: 'ultra' }));
  factory.applyInstance(tshirtCtx({ tier: 'ultra' }), ultraRoot, instance);
  const draftVerts = draftRoot.userData.sim.vertexCount;
  const ultraVerts = ultraRoot.userData.sim.vertexCount;
  assert.ok(draftVerts > 0 && draftVerts < 1200, 'draft tier stays well bounded');
  assert.ok(ultraVerts > draftVerts && ultraVerts < 3200, 'ultra tier is larger but still bounded');
});

// ── DEVICE MOCKUP — beyond the generic loop above: viewport topology
// switches, accent-driven screen redraw, scroll animation semantics, and
// the material-update-without-rebuild guarantee. ─────────────────────────

test('device-mockup: each viewport builds its distinctive hardware (stand for desktop, camera pod for mobile/tablet)', () => {
  const factory = getFactory('device-mockup');
  const counts = {};
  for (const viewport of ['desktop', 'mobile', 'tablet']) {
    const instance = createElementInstance('device-mockup', { id: `dm-${viewport}`, enabled: true, appearance: { viewport } });
    const root = factory.create(ctx());
    factory.applyInstance(ctx(), root, instance);
    const device = root.userData.motion.children[0];
    counts[viewport] = device.children.length;
    factory.dispose(root);
  }
  // body + face + screen = 3; desktop adds arm+foot (5); mobile/tablet add pod+lens (5)
  assert.equal(counts.desktop, 5, 'desktop: body+face+arm+foot+screen');
  assert.equal(counts.mobile, 5, 'mobile: body+face+pod+lens+screen');
  assert.equal(counts.tablet, 5, 'tablet: body+face+pod+lens+screen');
});

test('device-mockup: changing viewport rebuilds; changing body tone does NOT rebuild; changing accent DOES (screen texture is baked)', () => {
  const factory = getFactory('device-mockup');
  const instance = createElementInstance('device-mockup', { id: 'dm-1', enabled: true });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const firstTex = root.userData.screenTexture;

  const toneChanged = createElementInstance('device-mockup', { id: 'dm-1', enabled: true, material: { color: '#1c1d20' } });
  factory.applyInstance(ctx(), root, toneChanged);
  assert.equal(root.userData.screenTexture, firstTex, 'body-tone change must not rebuild');
  assert.equal(root.userData.alumMaterial.color.getHexString(), '1c1d20', 'body tone must live-update the aluminum material');

  const accentChanged = createElementInstance('device-mockup', { id: 'dm-1', enabled: true, material: { accent: '#2d6b8a' } });
  factory.applyInstance(ctx(), root, accentChanged);
  assert.notEqual(root.userData.screenTexture, firstTex, 'accent change must redraw the screen texture');

  const sigBefore = root.userData.topologySignature;
  const viewportChanged = createElementInstance('device-mockup', { id: 'dm-1', enabled: true, material: { accent: '#2d6b8a' }, appearance: { viewport: 'mobile' } });
  factory.applyInstance(ctx(), root, viewportChanged);
  assert.notEqual(root.userData.topologySignature, sigBefore, 'viewport change must rebuild');
  factory.dispose(root);
});

test('device-mockup: scroll animates texture offset down the page; scroll off parks at the top; sway respects motion.rotate', () => {
  const factory = getFactory('device-mockup');
  const instance = createElementInstance('device-mockup', {
    id: 'dm-1', enabled: true,
    appearance: { scroll: true, scrollSpeed: 1 }, motion: { rotate: true, speed: 1 },
  });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const tex = root.userData.screenTexture;
  const top = tex.offset.y;
  assert.ok(top > 0, 'page texture starts offset to the top of the page');

  factory.animate(root, instance, 2.0, 0.016); // mid ping-pong: must have scrolled down
  assert.ok(tex.offset.y < top, `scroll must move the offset down the page, got ${tex.offset.y} vs top ${top}`);
  assert.ok(tex.offset.y >= 0, 'offset never scrolls past the bottom of the page');
  assert.notEqual(root.userData.motion.rotation.y, 0, 'sway must move the motion group when rotate is on');

  const parked = createElementInstance('device-mockup', {
    id: 'dm-1', enabled: true,
    appearance: { scroll: false, scrollSpeed: 1 }, motion: { rotate: false, speed: 1 },
  });
  root.userData.motion.rotation.y = 0;
  factory.animate(root, parked, 2.0, 0.016);
  assert.equal(tex.offset.y, top, 'scroll off must park at the top of the page');
  assert.equal(root.userData.motion.rotation.y, 0, 'sway off must leave the motion group untouched');
  factory.dispose(root);
});

test('device-mockup: deviceScreenRepeatFraction — viewport-shaped window onto a captured page, clamped for short pages', async () => {
  const { deviceScreenRepeatFraction } = await import('../factories.js');
  // Desktop screen is 1.44×0.9 wu; a 1440px-wide, 3-screen-tall capture
  // (3×900=2700px) shows exactly one third at a time.
  assert.ok(Math.abs(deviceScreenRepeatFraction('desktop', 1440, 2700) - (1 / 3)) < 1e-9);
  // Mobile: 390×844 wu screen; a 780px-wide capture (deviceScaleFactor 2)
  // of a 3-screen page (3×1688) likewise shows one third.
  assert.ok(Math.abs(deviceScreenRepeatFraction('mobile', 780, 3 * 1688) - (1 / 3)) < 1e-9);
  // A page SHORTER than one screen clamps to 1 — fills the screen, no scroll range.
  assert.equal(deviceScreenRepeatFraction('desktop', 1440, 500), 1);
  // Garbage dims fall back to the placeholder's own fraction, never NaN.
  assert.ok(deviceScreenRepeatFraction('desktop', 0, 0) > 0);
});

test('device-mockup: empty captureUrl keeps the synchronous placeholder; animate scrolls with the stored per-capture fraction', () => {
  const factory = getFactory('device-mockup');
  const instance = createElementInstance('device-mockup', { id: 'dm-cap', enabled: true, appearance: { scroll: true, scrollSpeed: 1 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  assert.equal(root.userData.screenMaterial.map, root.userData.screenTexture, 'no captureUrl -> the placeholder stays on the screen material');
  // A capture load stores its own visible fraction — animate must honor it
  // (simulate the loader's write; the real network path is browser-only).
  root.userData.screenRepeatY = 0.25;
  factory.animate(root, instance, 0, 0.016);
  const tex = root.userData.screenMaterial.map;
  assert.ok(Math.abs(tex.offset.y - 0.75) < 1e-6, `at the top of a 0.25-fraction page, offset.y must be 0.75, got ${tex.offset.y}`);
  factory.dispose(root);
});

test('device-mockup: deviceWantedScreenSource — upload wins over capture; a missing library entry falls back to PLACEHOLDER (never the stale capture)', async () => {
  const { deviceWantedScreenSource } = await import('../factories.js');
  const inst = createElementInstance('device-mockup', {
    id: 'dm-src', enabled: true,
    appearance: { captureUrl: '/api/public/studio-device-capture?id=abc', uploadAssetId: 'devscr-x' },
  });
  const lib = { 'devscr-x': { assetId: 'devscr-x', dataUrl: 'data:image/png;base64,AAA' } };
  assert.deepEqual(deviceWantedScreenSource(inst, { deviceScreenAssetsById: lib }),
    { key: 'upload:devscr-x', url: 'data:image/png;base64,AAA' }, 'upload must take priority over capture');
  assert.deepEqual(deviceWantedScreenSource(inst, { deviceScreenAssetsById: {} }),
    { key: '', url: null }, 'a selected-but-missing upload must fall back to the placeholder, not the older capture');
  const captureOnly = createElementInstance('device-mockup', {
    id: 'dm-src2', enabled: true, appearance: { captureUrl: '/api/public/studio-device-capture?id=abc' },
  });
  assert.deepEqual(deviceWantedScreenSource(captureOnly, {}),
    { key: 'capture:/api/public/studio-device-capture?id=abc', url: '/api/public/studio-device-capture?id=abc' });
  const neither = createElementInstance('device-mockup', { id: 'dm-src3', enabled: true });
  assert.deepEqual(deviceWantedScreenSource(neither, {}), { key: '', url: null });
});

test('device-mockup: captureUrl + uploadAssetId survive a normalize round trip (what scene templates/local settings actually persist)', async () => {
  const { normalizeElementInstance } = await import('../schema.js');
  const inst = createElementInstance('device-mockup', {
    id: 'dm-rt', enabled: true,
    appearance: { viewport: 'tablet', captureUrl: '/api/public/studio-device-capture?id=deadbeef', uploadAssetId: 'devscr-abc123' },
  });
  const revived = normalizeElementInstance(JSON.parse(JSON.stringify(inst)));
  assert.equal(revived.appearance.captureUrl, '/api/public/studio-device-capture?id=deadbeef');
  assert.equal(revived.appearance.uploadAssetId, 'devscr-abc123');
  assert.equal(revived.appearance.viewport, 'tablet');
});

test('device-mockup: shouldSyncElementEntry re-syncs on deviceScreenNeedsRecheck, same contract as the tshirt logo flag', async () => {
  const { shouldSyncElementEntry } = await import('../scene-elements.js');
  const inst = createElementInstance('device-mockup', { id: 'dm-sync', enabled: true });
  const settled = { type: 'device-mockup', object: null, lastInstance: inst, lastTier: 'draft', lastFormatId: 'off' };
  assert.equal(shouldSyncElementEntry(settled, inst, 'draft', 'off', {}), false, 'a settled entry with no flags must not re-sync');
  assert.equal(shouldSyncElementEntry(settled, inst, 'draft', 'off', { deviceScreenNeedsRecheck: true }), true);
});

test('device-mockup: AUTO SCROLL off holds the SCROLL POSITION dial; the timeline userData override wins while present and releases cleanly', () => {
  const factory = getFactory('device-mockup');
  const instance = createElementInstance('device-mockup', {
    id: 'dm-pos', enabled: true,
    appearance: { scroll: false, scrollPosition: 0.5 },
  });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const tex = root.userData.screenMaterial.map;
  const repeatY = root.userData.screenRepeatY;

  factory.animate(root, instance, 1.0, 0.016);
  const atHalf = (1 - repeatY) * 0.5;
  assert.ok(Math.abs(tex.offset.y - atHalf) < 1e-9, `dial at 50% must park mid-page, got ${tex.offset.y} want ${atHalf}`);

  root.userData.scrollPositionOverride = 1; // timeline blending a move to the bottom
  factory.animate(root, instance, 2.0, 0.016);
  assert.ok(Math.abs(tex.offset.y - 0) < 1e-9, 'override=1 (bottom) must beat the dial while present');

  root.userData.scrollPositionOverride = undefined; // playback stopped
  factory.animate(root, instance, 3.0, 0.016);
  assert.ok(Math.abs(tex.offset.y - atHalf) < 1e-9, 'clearing the override must return to the dial value');
  factory.dispose(root);
});

test('device-mockup: devicePrimary.scrollPosition is in the timeline lerp whitelist (keyframed page moves blend smoothly)', async () => {
  const { TIMELINE_LERP_WHITELIST } = await import('../../timeline.js');
  assert.ok(TIMELINE_LERP_WHITELIST.includes('devicePrimary.scrollPosition'));
});

test('image-layer: plane always matches the image aspect — longest edge pinned, never skewed', async () => {
  const { imageLayerPlaneSize } = await import('../factories.js');
  assert.deepEqual(imageLayerPlaneSize(1000, 1000), { width: 0.9, height: 0.9 });
  const wide = imageLayerPlaneSize(1600, 900);
  assert.ok(Math.abs(wide.width - 0.9) < 1e-9 && Math.abs(wide.height - 0.9 * (900 / 1600)) < 1e-9, 'wide image keeps 16:9');
  const tall = imageLayerPlaneSize(600, 2400);
  assert.ok(Math.abs(tall.height - 0.9) < 1e-9 && Math.abs(tall.width - 0.225) < 1e-9, 'tall image keeps 1:4');
  assert.deepEqual(imageLayerPlaneSize(0, 0), { width: 0.9, height: 0.9 }, 'garbage dims fall back to a square, never NaN');
});

test('image-layer: no upload -> placeholder plane renders synchronously; opacity live-updates without rebuild', () => {
  const factory = getFactory('image-layer');
  const instance = createElementInstance('image-layer', { id: 'il-1', enabled: true, material: { opacity: 0.6 } });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  assert.ok(root.userData.layerMesh, 'placeholder plane must exist without any upload');
  assert.equal(root.userData.layerMaterial.opacity, 0.6);
  const meshBefore = root.userData.layerMesh;
  const dimmer = createElementInstance('image-layer', { id: 'il-1', enabled: true, material: { opacity: 0.2 } });
  factory.applyInstance(ctx(), root, dimmer);
  assert.equal(root.userData.layerMaterial.opacity, 0.2);
  assert.equal(root.userData.layerMesh, meshBefore, 'an opacity change must not rebuild the mesh');
  factory.dispose(root);
});

test('device-mockup: deviceBottomLocalY — per-viewport contact point (post-nf), desktop lowest (stand foot), unknown falls back to desktop', async () => {
  const { deviceBottomLocalY } = await import('../factories.js');
  assert.ok(Math.abs(deviceBottomLocalY('desktop') - (-0.77 * 0.6)) < 1e-9);
  assert.ok(Math.abs(deviceBottomLocalY('mobile') - (-0.44 * 1.0)) < 1e-9);
  assert.ok(Math.abs(deviceBottomLocalY('tablet') - (-0.536 * 0.84)) < 1e-9);
  assert.equal(deviceBottomLocalY('vr-goggles'), deviceBottomLocalY('desktop'), 'unknown viewport falls back to desktop');
  // Seat math sanity: at the 79-set desk height (-0.68) and default scale
  // 1.45, every device's computed root Y keeps its bottom exactly on the
  // floor: rootY + bottom*scale === groundY.
  ['desktop', 'mobile', 'tablet'].forEach((vp) => {
    const rootY = -0.68 - deviceBottomLocalY(vp) * 1.45;
    assert.ok(Math.abs((rootY + deviceBottomLocalY(vp) * 1.45) - (-0.68)) < 1e-12, `${vp} seats on the floor`);
  });
});

test('device-mockup: models + finish — clay is one matte recolorable material, model swaps shell, seat bottoms track stand type', async () => {
  const { deviceBottomLocalY, DEVICE_MODELS, deviceResolveModel } = await import('../factories.js');
  // Default models ARE the original geometry — bottoms unchanged.
  assert.equal(deviceBottomLocalY('desktop', 'studio'), deviceBottomLocalY('desktop', ''), 'blank model = family default');
  assert.equal(deviceResolveModel('mobile', 'retro'), DEVICE_MODELS.mobile.flagship, 'wrong-family id falls back to the family default');
  // Stand types order sanely: arm reaches lowest, wedge is the shallowest support, slabs sit on the body edge.
  const arm = deviceBottomLocalY('desktop', 'studio');
  const column = deviceBottomLocalY('desktop', 'edge');
  const wedge = deviceBottomLocalY('desktop', 'retro');
  assert.ok(column < arm && arm < wedge, `column(${column}) < arm(${arm}) < wedge(${wedge})`);
  assert.ok(deviceBottomLocalY('mobile', 'minimal') > deviceBottomLocalY('mobile', 'compact'), 'thicker bezel slab reaches lower');

  const factory = getFactory('device-mockup');
  const c = { THREE, stdlib, tier: 'medium' };
  // Clay finish: shell material is matte (metalness 0), face shares the SAME material, color follows BODY TONE.
  const clayInst = createElementInstance('device-mockup', {
    id: 'dv-1', enabled: true,
    material: { color: '#d6d8da', clayColor: '#ff6644', claySoftness: 0.72 },
    appearance: { viewport: 'mobile', model: 'minimal', finish: 'clay' },
  });
  const root = factory.create(c);
  factory.applyInstance(c, root, clayInst);
  const shell = root.userData.alumMaterial;
  assert.equal(shell.metalness, 0, 'clay has no metalness');
  assert.ok(Math.abs(shell.roughness - 0.72) < 1e-9, 'claySoftness drives roughness');
  assert.equal(shell.color.getHexString(), 'ff6644');
  // CLAY SOFTNESS is a live dial — same topology signature, roughness updates without rebuild.
  const softer = createElementInstance('device-mockup', {
    id: 'dv-1', enabled: true,
    material: { color: '#d6d8da', clayColor: '#ff6644', claySoftness: 0.95 },
    appearance: { viewport: 'mobile', model: 'minimal', finish: 'clay' },
  });
  factory.applyInstance(c, root, softer);
  assert.equal(root.userData.alumMaterial, shell, 'no rebuild on softness change');
  assert.ok(Math.abs(shell.roughness - 0.95) < 1e-9);
  // Finish swap realistic -> rebuild: physical metal shell returns.
  const real = createElementInstance('device-mockup', {
    id: 'dv-1', enabled: true,
    material: { color: '#ff6644' },
    appearance: { viewport: 'mobile', model: 'minimal', finish: 'realistic' },
  });
  factory.applyInstance(c, root, real);
  assert.notEqual(root.userData.alumMaterial, shell, 'finish change rebuilds');
  assert.ok(root.userData.alumMaterial.metalness > 0.5, 'realistic is metal again');
  factory.dispose(root);
});

test('device-mockup: shell textures + clay color + new bases', async () => {
  const { deviceBottomLocalY, DEVICE_SHELL_TEXTURES } = await import('../factories.js');
  // New bases each land at their own drop; float has no stand (slab edge).
  const studio = deviceBottomLocalY('desktop', 'studio');
  const orbit = deviceBottomLocalY('desktop', 'orbit');
  const frame = deviceBottomLocalY('desktop', 'frame');
  const float = deviceBottomLocalY('desktop', 'float');
  assert.ok(orbit < studio, 'ring base reaches lower than the arm');
  assert.ok(float > frame && frame > studio === false ? true : frame > orbit, 'legs sit between ring and slab');
  assert.ok(float > frame, 'float (no stand) is the shallowest');
  assert.ok(deviceBottomLocalY('tablet', 'dock') < deviceBottomLocalY('tablet', 'slate'), 'dock cradle drops below the slab edge');
  assert.deepEqual(Object.keys(DEVICE_SHELL_TEXTURES), ['smooth', 'speckle', 'brushed', 'fabric', 'grip']);

  const factory = getFactory('device-mockup');
  const c = { THREE, stdlib, tier: 'medium' };
  // Textured clay with its own clayColor — body tone untouched.
  const inst = createElementInstance('device-mockup', {
    id: 'dv-2', enabled: true,
    material: { color: '#d6d8da', clayColor: '#9caf88', claySoftness: 0.8 },
    appearance: { viewport: 'desktop', model: 'orbit', finish: 'clay', shellTexture: 'speckle' },
  });
  const root = factory.create(c);
  factory.applyInstance(c, root, inst);
  const shell = root.userData.alumMaterial;
  assert.equal(shell.color.getHexString(), '9caf88', 'clay uses clayColor, not BODY TONE');
  assert.ok(shell.bumpMap, 'speckle applies a bump map');
  assert.equal(shell.bumpMap.wrapS, THREE.RepeatWrapping);
  // clayColor is a live dial — same signature, color updates without rebuild.
  const recolored = createElementInstance('device-mockup', {
    id: 'dv-2', enabled: true,
    material: { color: '#d6d8da', clayColor: '#7fa8c9', claySoftness: 0.8 },
    appearance: { viewport: 'desktop', model: 'orbit', finish: 'clay', shellTexture: 'speckle' },
  });
  factory.applyInstance(c, root, recolored);
  assert.equal(root.userData.alumMaterial, shell, 'no rebuild on clayColor change');
  assert.equal(shell.color.getHexString(), '7fa8c9');
  // Texture change -> rebuild; smooth clears the bump.
  const smooth = createElementInstance('device-mockup', {
    id: 'dv-2', enabled: true,
    material: { color: '#d6d8da', clayColor: '#7fa8c9' },
    appearance: { viewport: 'desktop', model: 'orbit', finish: 'clay', shellTexture: 'smooth' },
  });
  factory.applyInstance(c, root, smooth);
  assert.notEqual(root.userData.alumMaterial, shell, 'texture change rebuilds');
  assert.equal(root.userData.alumMaterial.bumpMap, null);
  // Realistic keeps BODY TONE even with clayColor set.
  const real = createElementInstance('device-mockup', {
    id: 'dv-2', enabled: true,
    material: { color: '#d6d8da', clayColor: '#7fa8c9' },
    appearance: { viewport: 'desktop', model: 'orbit', finish: 'realistic', shellTexture: 'brushed' },
  });
  factory.applyInstance(c, root, real);
  assert.equal(root.userData.alumMaterial.color.getHexString(), 'd6d8da', 'realistic ignores clayColor');
  assert.ok(root.userData.alumMaterial.bumpMap, 'brushed bump on metal');
  factory.dispose(root);
});

test('image-layer: renders color-exact — toneMapped off, full opacity by default', () => {
  const factory = getFactory('image-layer');
  const instance = createElementInstance('image-layer', { id: 'il-2', enabled: true });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  assert.equal(root.userData.layerMaterial.toneMapped, false, 'flat artwork must skip ACES (same rule as the device screen)');
  assert.equal(root.userData.layerMaterial.opacity, 1, 'default opacity is fully opaque');
  factory.dispose(root);
});

test('image-layer: imageLayerAlphaFixScale — well-formed PNGs untouched, globally-faded alpha solidifies', async () => {
  const { imageLayerAlphaFixScale } = await import('../factories.js');
  assert.equal(imageLayerAlphaFixScale(255), 1, 'an image with any fully-opaque pixel passes through untouched');
  assert.equal(imageLayerAlphaFixScale(0), 1, 'fully transparent image untouched (nothing to solidify)');
  assert.equal(imageLayerAlphaFixScale(NaN), 1);
  // The owner's grass PNG case: max ~250, solid fill ~242 -> lands at 255.
  const s = imageLayerAlphaFixScale(250);
  assert.ok(Math.min(255, Math.round(242 * s)) === 255, 'the ~95% solid fill becomes fully opaque');
  // Genuinely soft edge pixels keep RELATIVE softness (scaled, not clamped to 1).
  assert.ok(Math.round(100 * s) < 255, 'a 40%-of-max soft edge stays soft');
});

test('image-layer: imageLayerSolidAlphaScale — >=60% alpha lands opaque, cutout edges stay soft, keyed for re-process', async () => {
  const { imageLayerSolidAlphaScale } = await import('../factories.js');
  const s = imageLayerSolidAlphaScale(255);
  assert.equal(Math.min(255, Math.round(153 * s)), 255, '60% pattern pixel becomes fully opaque');
  assert.equal(Math.min(255, Math.round(200 * s)), 255, 'the grass tuft case (~78%) becomes fully opaque');
  assert.ok(Math.min(255, Math.round(76 * s)) < 255, 'a 30% cutout edge stays translucent');
  assert.equal(imageLayerSolidAlphaScale(0), 1);
  // solid participates in the texture dedupe key so the toggle re-runs the canvas pass
  const factory = getFactory('image-layer');
  const base = createElementInstance('image-layer', { id: 'il-3', enabled: true, appearance: { uploadAssetId: 'a1' } });
  const solid = createElementInstance('image-layer', { id: 'il-3', enabled: true, appearance: { uploadAssetId: 'a1', solid: true } });
  const c = { THREE, stdlib, tier: 'medium', deviceScreenAssetsById: { a1: { dataUrl: 'data:image/png;base64,x' } } };
  const root = factory.create(c);
  factory.applyInstance(c, root, base);
  const k1 = root.userData.appliedImageKey;
  factory.applyInstance(c, root, solid);
  assert.notEqual(root.userData.appliedImageKey, k1, 'solid toggle changes the applied key');
  factory.dispose(root);
});

// ── Device screen-source load failure, made observable (export-restore
// Phase 5) ────────────────────────────────────────────────────────────────
// The TextureLoader error callback used to swallow its failure entirely:
// the procedural placeholder silently stayed on the screen mesh and no
// caller could distinguish "still loading" from "will never load". The
// export guard then burned its whole deadline and recorded the placeholder
// — the reported "it records an example domain". The loader itself needs a
// DOM Image, so the observable surface is these pure userData helpers.

import {
  classifyScreenSourceUrl, recordScreenCaptureLoadFailure, clearScreenCaptureLoadError,
} from '../factories.js';

test('classifyScreenSourceUrl: recognizes the studio\'s own same-origin capture route, browser-local data: URLs, and everything else as foreign', () => {
  assert.equal(classifyScreenSourceUrl('/api/public/studio-device-capture?id=abc&v=1'), 'route');
  assert.equal(classifyScreenSourceUrl('data:image/png;base64,AAAA'), 'data');
  assert.equal(classifyScreenSourceUrl('https://storage.googleapis.com/bucket/shot.jpg'), 'foreign');
  assert.equal(classifyScreenSourceUrl(''), 'foreign');
  assert.equal(classifyScreenSourceUrl(undefined), 'foreign');
});

test('recordScreenCaptureLoadFailure: a failed load is RECORDED on userData (url + classified reason), not swallowed', () => {
  const userData = { appliedScreenKey: 'capture:/api/public/studio-device-capture?id=abc' };
  const recorded = recordScreenCaptureLoadFailure(userData, {
    key: 'capture:/api/public/studio-device-capture?id=abc',
    url: '/api/public/studio-device-capture?id=abc',
  });
  assert.deepEqual(recorded, { url: '/api/public/studio-device-capture?id=abc', reason: 'route' });
  assert.deepEqual(userData.screenCaptureError, recorded, 'the marker the export guard reads must be observable on userData');
});

test('recordScreenCaptureLoadFailure: clears appliedScreenKey ONLY while the failed load is still the current selection (a newer selection must never be un-applied by a stale failure)', () => {
  const current = { appliedScreenKey: 'capture:a' };
  recordScreenCaptureLoadFailure(current, { key: 'capture:a', url: 'a' });
  assert.equal(current.appliedScreenKey, null, 'a retry of the same source must actually re-attempt');

  const superseded = { appliedScreenKey: 'capture:b' };
  recordScreenCaptureLoadFailure(superseded, { key: 'capture:a', url: 'a' });
  assert.equal(superseded.appliedScreenKey, 'capture:b', 'a stale failure must not disturb a newer selection');
});

test('recordScreenCaptureLoadFailure: never nulls screenCaptureTexture — the readiness predicate compares it against the live map and would otherwise misreport a still-valid earlier capture', () => {
  const tex = { marker: 'earlier-capture' };
  const userData = { appliedScreenKey: 'capture:new', screenCaptureTexture: tex };
  recordScreenCaptureLoadFailure(userData, { key: 'capture:new', url: '/api/public/studio-device-capture?id=new' });
  assert.equal(userData.screenCaptureTexture, tex);
});

test('clearScreenCaptureLoadError: a later success (or a deliberate switch back to the placeholder) resolves the marker', () => {
  const userData = { screenCaptureError: { url: 'x', reason: 'route' } };
  clearScreenCaptureLoadError(userData);
  assert.equal(userData.screenCaptureError, null);
});

test('the screen-source failure helpers are total — a null userData is a safe no-op, never a throw inside a texture callback', () => {
  assert.equal(recordScreenCaptureLoadFailure(null, { key: 'k', url: 'u' }), null);
  assert.doesNotThrow(() => clearScreenCaptureLoadError(null));
  assert.doesNotThrow(() => clearScreenCaptureLoadError({}));
});

// ── SHARE TAB screen source (Phase 9) ────────────────────────────────────
// A getDisplayMedia stream, decoded by a detached <video> and wrapped in a
// THREE.VideoTexture by ClothStudio, enters the factory as an EXTERNALLY
// OWNED texture on ctx.deviceShare. It must resolve through the same screen-
// source path every other texture uses (so a topology rebuild re-applies it),
// must never be disposed by this factory, and must never be scrolled — it is
// a live viewport-shaped window, not a tall page.

test('deviceScreenAspect: reports each viewport\'s real screen shape and falls back to desktop for anything unknown', async () => {
  const { deviceScreenAspect } = await import('../factories.js');
  assert.ok(Math.abs(deviceScreenAspect('desktop') - (1.44 / 0.9)) < 1e-12);
  assert.ok(Math.abs(deviceScreenAspect('mobile') - (0.39 / 0.844)) < 1e-12);
  assert.ok(Math.abs(deviceScreenAspect('tablet') - (0.768 / 1.024)) < 1e-12);
  assert.ok(deviceScreenAspect('mobile') < 1, 'the phone screen is taller than it is wide');
  for (const bogus of ['nope', '', undefined, null, '__proto__', 'constructor']) {
    assert.equal(deviceScreenAspect(bogus), deviceScreenAspect('desktop'), String(bogus));
  }
});

test('isDeviceShareScreenKey: only the share source\'s own key prefix matches', async () => {
  const { isDeviceShareScreenKey, DEVICE_SHARE_SCREEN_KEY_PREFIX } = await import('../factories.js');
  assert.equal(isDeviceShareScreenKey(`${DEVICE_SHARE_SCREEN_KEY_PREFIX}1920x1080`), true);
  assert.equal(isDeviceShareScreenKey('capture:/api/public/studio-device-capture?id=abc'), false);
  assert.equal(isDeviceShareScreenKey('upload:devscr-x'), false);
  assert.equal(isDeviceShareScreenKey(''), false);
  assert.equal(isDeviceShareScreenKey(null), false);
});

test('deviceWantedScreenSource: an active share OUTRANKS a coexisting upload and capture, and keys on the source dimensions', async () => {
  const { deviceWantedScreenSource } = await import('../factories.js');
  const inst = createElementInstance('device-mockup', {
    id: 'dm-share', enabled: true,
    appearance: { captureUrl: '/api/public/studio-device-capture?id=abc', uploadAssetId: 'devscr-x' },
  });
  const texture = { fake: 'video-texture' };
  const lib = { 'devscr-x': { assetId: 'devscr-x', dataUrl: 'data:image/png;base64,AAA' } };
  const wanted = deviceWantedScreenSource(inst, {
    deviceScreenAssetsById: lib,
    deviceShare: { texture, sourceWidth: 1920, sourceHeight: 1080, fit: { repeat: { x: 0.9, y: 1 }, offset: { x: 0.05, y: 0 } } },
  });
  assert.equal(wanted.key, 'share:1920x1080');
  assert.equal(wanted.texture, texture);
  assert.equal(wanted.url, null, 'the share source is never a URL to load — it is handed in ready');
  // A surface switch to a different-sized tab must produce a DIFFERENT key,
  // or appliedScreenKey would dedupe the re-fit away.
  const switched = deviceWantedScreenSource(inst, {
    deviceScreenAssetsById: lib, deviceShare: { texture, sourceWidth: 1280, sourceHeight: 800 },
  });
  assert.notEqual(switched.key, wanted.key);
});

test('deviceWantedScreenSource: ctx WITHOUT a share texture behaves exactly as before (server render passes none)', async () => {
  const { deviceWantedScreenSource } = await import('../factories.js');
  const inst = createElementInstance('device-mockup', {
    id: 'dm-noshare', enabled: true, appearance: { captureUrl: '/api/public/studio-device-capture?id=abc' },
  });
  for (const share of [undefined, null, {}, { texture: null }]) {
    assert.deepEqual(
      deviceWantedScreenSource(inst, { deviceScreenAssetsById: {}, deviceShare: share }),
      { key: 'capture:/api/public/studio-device-capture?id=abc', url: '/api/public/studio-device-capture?id=abc' },
      JSON.stringify(share)
    );
  }
});

test('device-mockup: an active share becomes the screen material\'s map with the cover-fit crop applied — a NORMAL texture, never the alpha hole', () => {
  const factory = getFactory('device-mockup');
  const instance = createElementInstance('device-mockup', { id: 'dm-share-apply', enabled: true });
  const root = factory.create(ctx());
  factory.applyInstance(ctx(), root, instance);
  const placeholder = root.userData.screenTexture;
  assert.equal(root.userData.screenMaterial.map, placeholder);

  const shareTex = new THREE.Texture();
  let disposed = 0;
  shareTex.addEventListener('dispose', () => { disposed += 1; });
  const shareCtx = {
    ...ctx(),
    deviceShare: {
      texture: shareTex, sourceWidth: 1920, sourceHeight: 1080,
      fit: { repeat: { x: 0.9, y: 1 }, offset: { x: 0.05, y: 0 } },
    },
  };
  factory.applyInstance(shareCtx, root, instance);
  assert.equal(root.userData.screenMaterial.map, shareTex, 'the share texture is the screen map');
  assert.equal(root.userData.screenExternalTexture, shareTex, 'it is recorded as externally owned');
  assert.ok(Math.abs(shareTex.repeat.x - 0.9) < 1e-12);
  assert.equal(shareTex.repeat.y, 1);
  assert.ok(Math.abs(shareTex.offset.x - 0.05) < 1e-12);
  assert.equal(disposed, 0, 'installing the share must never dispose the placeholder\'s replacement');

  // Dropping the share puts the factory's own placeholder back and STILL
  // never disposes the caller's texture (ClothStudio owns the MediaStream
  // behind it and disposes it in stopDeviceScreenShare).
  factory.applyInstance(ctx(), root, instance);
  assert.equal(root.userData.screenMaterial.map, placeholder, 'without a share the placeholder returns');
  assert.equal(root.userData.screenExternalTexture, null);
  assert.equal(disposed, 0, 'the factory must NEVER dispose an externally-owned share texture');
  factory.dispose(root);
});

test('device-mockup: a topology rebuild (viewport change) re-applies the share texture instead of disposing it', () => {
  const factory = getFactory('device-mockup');
  const desktop = createElementInstance('device-mockup', { id: 'dm-share-rebuild', enabled: true, appearance: { viewport: 'desktop' } });
  const mobile = createElementInstance('device-mockup', { id: 'dm-share-rebuild', enabled: true, appearance: { viewport: 'mobile' } });
  const shareTex = new THREE.Texture();
  let disposed = 0;
  shareTex.addEventListener('dispose', () => { disposed += 1; });
  const shareCtx = (fit) => ({ ...ctx(), deviceShare: { texture: shareTex, sourceWidth: 1920, sourceHeight: 1080, fit } });

  const root = factory.create(ctx());
  factory.applyInstance(shareCtx({ repeat: { x: 0.9, y: 1 }, offset: { x: 0.05, y: 0 } }), root, desktop);
  assert.equal(root.userData.screenMaterial.map, shareTex);
  // Viewport change rebuilds the whole device (clearGroup disposes every
  // texture it finds on a material — which is exactly why the share texture
  // is detached before that happens).
  factory.applyInstance(shareCtx({ repeat: { x: 1, y: 0.26 }, offset: { x: 0, y: 0.37 } }), root, mobile);
  assert.equal(disposed, 0, 'the rebuild must not dispose the caller\'s live video texture');
  assert.equal(root.userData.screenMaterial.map, shareTex, 'the share is re-applied to the freshly built screen');
  assert.ok(Math.abs(shareTex.repeat.y - 0.26) < 1e-12, 'and re-stamped with the caller\'s NEW cover-fit for the phone screen');
  factory.dispose(root);
});

test('device-mockup: animate never scrolls a share texture — a live tab is a window, not a page (SWAY still applies)', () => {
  const factory = getFactory('device-mockup');
  const instance = createElementInstance('device-mockup', {
    id: 'dm-share-anim', enabled: true,
    motion: { rotate: true, speed: 1 },
    appearance: { scroll: true, scrollSpeed: 1 },
  });
  const shareTex = new THREE.Texture();
  const shareCtx = {
    ...ctx(),
    deviceShare: {
      texture: shareTex, sourceWidth: 1920, sourceHeight: 1080,
      fit: { repeat: { x: 0.9, y: 1 }, offset: { x: 0.05, y: 0 } },
    },
  };
  const root = factory.create(ctx());
  factory.applyInstance(shareCtx, root, instance);
  const offsetY = shareTex.offset.y;
  const offsetX = shareTex.offset.x;
  factory.animate(root, instance, 1.7, 0.016);
  assert.equal(shareTex.offset.y, offsetY, 'AUTO SCROLL must not slide the live crop off the frame');
  assert.equal(shareTex.offset.x, offsetX);
  assert.notEqual(root.userData.motion.rotation.y, 0, 'SWAY is a transform and still applies');
  // The manual SCROLL POSITION dial is equally inert against a live share.
  const parked = createElementInstance('device-mockup', {
    id: 'dm-share-anim', enabled: true, appearance: { scroll: false, scrollPosition: 1 },
  });
  factory.animate(root, parked, 2.2, 0.016);
  assert.equal(shareTex.offset.y, offsetY);
  factory.dispose(root);
});
