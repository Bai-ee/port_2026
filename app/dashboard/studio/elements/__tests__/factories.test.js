import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as stdlib from 'three-stdlib';
import { FACTORIES, getFactory, clearGroup } from '../factories.js';
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

test('every non-singleInstanceRenderer catalog type has a matching factory (and vice versa)', () => {
  const renderableTypes = listElementDefinitions().filter((d) => !d.singleInstanceRenderer).map((d) => d.type);
  assert.deepEqual([...renderableTypes].sort(), Object.keys(FACTORIES).sort());
});

// glb-import is deliberately excluded from the generic per-type loop below:
// every other type's default instance renders REAL synchronous geometry the
// instant applyInstance runs. glb-import's default (no asset selected yet)
// renders NOTHING — an empty motion group is the correct, honest state, not
// a bug — and once an asset IS selected, loading is genuinely async (a
// network fetch). Neither fits the loop's "applyInstance -> synchronous
// content" assumption, so it gets its own dedicated block (see "GLB
// IMPORT" below), the same treatment already given to glass-petal-sphere
// (excluded via its null getFactory()).
const GENERIC_LOOP_TYPES = Object.keys(FACTORIES).filter((t) => t !== 'glb-import');

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

test('kinetic-rings, translucent-monoliths, logo-sculpture, light-tubes, wireframe-sculpture, portal-plane, cloth-banners, particle-ribbon, caustic-water-light, volumetric-light-cone, topographic-floor, metaball-bloom, kinetic-type-totem, and echo-feedback-tunnel: changing quality tier rebuilds their (tier-dependent) geometry', () => {
  ['kinetic-rings', 'translucent-monoliths', 'logo-sculpture', 'light-tubes', 'wireframe-sculpture', 'portal-plane', 'cloth-banners', 'particle-ribbon', 'caustic-water-light', 'volumetric-light-cone', 'topographic-floor', 'metaball-bloom', 'kinetic-type-totem', 'echo-feedback-tunnel'].forEach((type) => {
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
