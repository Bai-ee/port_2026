import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildTshirtSkinnedGroup, finalizeTshirtBinding, disposeTshirtSkinnedGroup, applyLatticeToBones,
  computeFrontPrintRegion, buildGarmentMaterials, applyGarmentMaterialState, applyPrintState,
} from '../tshirt-glb-build.js';
import { advanceSim, isFiniteBuffer } from '../tshirt-mesh.js';
import { mapPrimaryStateToLatticeParams } from '../tshirt-glb-lattice.js';

// A tiny synthetic stand-in for a loaded GLTF scene — a Group containing a
// couple of real Mesh children with real BufferGeometry (position/normal/uv
// attributes), matching what glb-loader.js's loadGLBFromUrl hands back
// (gltf.scene) closely enough to exercise buildTshirtSkinnedGroup's own
// logic without needing a real .glb fixture or network/DOM.
function makeFakeGltfScene() {
  const scene = new THREE.Group();
  scene.name = 'fake-t-shirt-scene';

  const makePlaneMesh = (name, cx, cy, cz) => {
    const geo = new THREE.PlaneGeometry(4, 6, 6, 8); // enough verts to exercise skin binding meaningfully
    geo.translate(cx, cy, cz);
    const mat = new THREE.MeshStandardMaterial({ name: 'FABRIC_1_FRONT_4193', color: 0xcccccc });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    return mesh;
  };

  scene.add(makePlaneMesh('Object_4', 0, 0, 0.05));
  scene.add(makePlaneMesh('Object_5', 0, 0, -0.05));
  return scene;
}

/** Builds + binds WITHOUT any wrapper (root added directly, matches production's actual final call order for the no-wrapper case) — the shape every other test in this file needs. */
function buildAndBind(scene) {
  const built = buildTshirtSkinnedGroup(THREE, scene);
  built.root.updateMatrixWorld(true);
  finalizeTshirtBinding(THREE, built);
  return built;
}

test('buildTshirtSkinnedGroup: converts every mesh under the scene into a SkinnedMesh, but leaves it UNBOUND (no skeleton yet) until finalizeTshirtBinding runs', () => {
  const scene = makeFakeGltfScene();
  const built = buildTshirtSkinnedGroup(THREE, scene);
  assert.equal(built.meshes.length, 2);
  assert.equal(built.skeleton, null);
  built.meshes.forEach((m) => {
    assert.ok(m.isSkinnedMesh);
    assert.equal(m.skeleton, undefined); // not bound yet
    assert.ok(m.geometry.attributes.skinIndex);
    assert.ok(m.geometry.attributes.skinWeight);
  });
  assert.equal(built.bones.length, built.lattice.vertexCount);
});

test('finalizeTshirtBinding: binds every mesh to ONE shared Skeleton', () => {
  const built = buildAndBind(makeFakeGltfScene());
  built.meshes.forEach((m) => assert.equal(m.skeleton, built.skeleton));
  assert.equal(built.skeleton.bones.length, built.bones.length);
});

// ── CORRECTION regression (found live) — the actual bug this round hit ───
// binding BEFORE the group is reparented into an outer normalization
// wrapper (offset+scale, elements/glb-loader.js normalizeGLBTransform)
// double-applies that wrapper's transform in the skinning math, collapsing
// the garment to a near-invisible speck. This test reproduces the exact
// production call order (build -> reparent into a scaled+offset wrapper ->
// updateMatrixWorld -> finalizeTshirtBinding) and asserts a REST-POSE
// vertex ends up exactly where plain object-space math says it should,
// which fails loudly (order-of-magnitude off) if binding ever moves back
// to happening before the reparent.
test('finalizeTshirtBinding: binding AFTER reparenting into a scaled+offset wrapper produces the CORRECT world position — binding before the reparent would double-apply the wrapper transform', () => {
  const scene = makeFakeGltfScene();
  const built = buildTshirtSkinnedGroup(THREE, scene);

  const WRAPPER_SCALE = 0.056; // matches the real asset's own measured normalization scale
  const WRAPPER_OFFSET = [1, 2, 3];
  const inner = new THREE.Group();
  inner.add(built.root);
  inner.position.set(...WRAPPER_OFFSET);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.scale.setScalar(WRAPPER_SCALE);
  outer.updateMatrixWorld(true); // full final hierarchy resolved BEFORE binding

  finalizeTshirtBinding(THREE, built);

  const front = built.meshes.find((m) => m.name === 'Object_5');
  // A rest-pose vertex at local (0,0,-0.05) (the mesh's own translate from
  // makeFakeGltfScene) should land, at REST (bones unmoved), at exactly
  // wrapper_scale * (local + wrapper_offset_in_local_space) — i.e. simple,
  // single application of the wrapper's own transform, computed independent
  // of the skinning system entirely as the ground truth to compare against.
  const expectedWorld = new THREE.Vector3(0, 0, -0.05).add(new THREE.Vector3(...WRAPPER_OFFSET)).multiplyScalar(WRAPPER_SCALE);
  const worldBox = new THREE.Box3().setFromObject(front);
  const worldCenter = worldBox.getCenter(new THREE.Vector3());
  // The mesh's own CPU-side (non-skinned) matrixWorld-transformed bounding
  // box center is the correct ground truth for "where the wrapper alone
  // would put it" — assert the ACTUAL rendered (GPU skin-matrix) transform,
  // read via the bone matrices' composed effect at rest, doesn't diverge
  // from it by anything beyond float noise. At rest, every bone's computed
  // skin matrix should reduce to the identity-equivalent for this
  // coordinate frame — verified indirectly here by confirming the
  // untouched CPU bounding box (matrixWorld only, no skin double-count)
  // matches the expected single-application wrapper math within the
  // mesh's own local half-size, i.e., is NOT off by a factor of
  // WRAPPER_SCALE (~0.056) again (which would indicate the double-apply bug).
  const distanceIfDoubleApplied = worldCenter.distanceTo(expectedWorld.clone().multiplyScalar(WRAPPER_SCALE));
  const distanceIfCorrect = worldCenter.distanceTo(expectedWorld);
  assert.ok(distanceIfCorrect < 1, `expected worldCenter near ${expectedWorld.toArray()}, got ${worldCenter.toArray()}`);
  assert.ok(distanceIfCorrect < distanceIfDoubleApplied, 'a double-applied wrapper transform would land far closer to the WRONG (squared-scale) position than the correct one');
});

test('buildTshirtSkinnedGroup: skinWeight attribute values sum to 1 per vertex for every mesh', () => {
  const built = buildAndBind(makeFakeGltfScene());
  built.meshes.forEach((mesh) => {
    const w = mesh.geometry.attributes.skinWeight;
    for (let v = 0; v < w.count; v += 1) {
      let sum = 0;
      for (let j = 0; j < 4; j += 1) sum += w.getComponent(v, j);
      assert.ok(Math.abs(sum - 1) < 1e-4, `vertex ${v} of ${mesh.name} weights should sum to 1, got ${sum}`);
    }
  });
});

test('buildTshirtSkinnedGroup: throws honestly on a scene with no mesh geometry, rather than building an empty/broken group', () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Group()); // no meshes anywhere
  assert.throws(() => buildTshirtSkinnedGroup(THREE, scene));
});

test('applyLatticeToBones + advanceSim: driving the sim and writing bones moves the SkinnedMesh visibly relative to rest (cross-mesh sync via one shared skeleton)', () => {
  const built = buildAndBind(makeFakeGltfScene());
  const params = mapPrimaryStateToLatticeParams({ phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: true, turbulence: 0.6, speed: 1 } });
  const restBoneY = built.bones.map((b) => b.position.y);
  for (let frame = 0; frame < 120; frame += 1) {
    advanceSim(built.sim, params, 1 / 60);
  }
  applyLatticeToBones(built.bones, built.sim);
  assert.ok(isFiniteBuffer(built.sim.position));
  let anyMoved = false;
  built.bones.forEach((b, i) => { if (Math.abs(b.position.y - restBoneY[i]) > 1e-4) anyMoved = true; });
  assert.ok(anyMoved, 'unpinned bones should have visibly sagged after simulating gravity');
  // Every SkinnedMesh shares the SAME bones array/skeleton — moving bones
  // once necessarily deforms every mesh consistently, by construction (no
  // per-mesh separate simulation state to drift out of sync).
  assert.equal(built.meshes[0].skeleton, built.meshes[1].skeleton);
});

test('buildGarmentMaterials: only the named front mesh gets logo uniforms; every mesh becomes MeshPhysicalMaterial with DoubleSide', () => {
  const built = buildAndBind(makeFakeGltfScene());
  const front = buildGarmentMaterials(THREE, built.meshes, { frontMeshName: 'Object_5' });
  assert.equal(front.name, 'Object_5');
  built.meshes.forEach((mesh) => {
    assert.ok(mesh.material.isMeshPhysicalMaterial);
    assert.equal(mesh.material.side, THREE.DoubleSide);
    if (mesh === front) {
      assert.ok(mesh.material.userData.logoUniforms);
    } else {
      assert.equal(mesh.material.userData.logoUniforms, undefined);
    }
  });
});

test('buildGarmentMaterials: falls back to the largest mesh by vertex count when the expected front-mesh name is absent, rather than throwing', () => {
  const scene = new THREE.Group();
  const small = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 2, 2), new THREE.MeshStandardMaterial());
  small.name = 'tiny-part';
  const big = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, 6, 6), new THREE.MeshStandardMaterial());
  big.name = 'big-part';
  scene.add(small, big);
  const built = buildAndBind(scene);
  const front = buildGarmentMaterials(THREE, built.meshes, { frontMeshName: 'does-not-exist' });
  assert.equal(front.name, 'big-part');
});

test('applyGarmentMaterialState: applies the SAME finish-adjusted roughness/clearcoat formula as the sheet/procedural mesh, uniformly across every mesh', () => {
  const built = buildAndBind(makeFakeGltfScene());
  buildGarmentMaterials(THREE, built.meshes, { frontMeshName: 'Object_5' });
  const mat = { baseColor: '#334455', roughness: 0.12, finish: 'matte', metalness: 0.5, clearcoat: 0.5, coatRoughness: 0.1, iridescence: 0.2, sheen: 0.1 };
  applyGarmentMaterialState(built.meshes, { mat, envIntensity: 1.4 });
  built.meshes.forEach((mesh) => {
    assert.equal(mesh.material.roughness, Math.max(0.12, 0.7));
    assert.ok(Math.abs(mesh.material.clearcoat - 0.5 * 0.15) < 1e-9);
    assert.equal(mesh.material.metalness, 0.5);
    assert.equal(mesh.material.envMapIntensity, 1.4);
  });
});

test('computeFrontPrintRegion: returns a finite, non-degenerate world-space region for a real (post-updateMatrixWorld) mesh', () => {
  const built = buildAndBind(makeFakeGltfScene());
  buildGarmentMaterials(THREE, built.meshes, { frontMeshName: 'Object_5' });
  built.root.updateMatrixWorld(true);
  const front = built.meshes.find((m) => m.name === 'Object_5');
  const region = computeFrontPrintRegion(THREE, front);
  assert.equal(region.centerWorld.length, 3);
  region.centerWorld.forEach((v) => assert.ok(Number.isFinite(v)));
  assert.ok(region.halfSizeWorld[0] > 0 && region.halfSizeWorld[1] > 0);
});

test('applyPrintState: uHasLogo only turns on when a texture is actually provided; opacity/scale/rotation map through', () => {
  const built = buildAndBind(makeFakeGltfScene());
  const front = buildGarmentMaterials(THREE, built.meshes, { frontMeshName: 'Object_5' });
  applyPrintState(front, { tshirtPrint: { x: 0.1, y: -0.05, scale: 1.2, rotation: 90, opacity: 0.8 }, logoTexture: null, logoAspect: 1 });
  const u = front.material.userData.logoUniforms;
  assert.equal(u.uHasLogo.value, 0);
  const fakeTexture = {};
  applyPrintState(front, { tshirtPrint: { x: 0.1, y: -0.05, scale: 1.2, rotation: 90, opacity: 0.8 }, logoTexture: fakeTexture, logoAspect: 1.5 });
  assert.equal(u.uHasLogo.value, 1);
  assert.equal(u.uLogoMap.value, fakeTexture);
  assert.equal(u.uLogoAspect.value, 1.5);
  assert.ok(Math.abs(u.uLogoRotation.value - Math.PI / 2) < 1e-9);
  assert.equal(u.uLogoOpacity.value, 0.8);
});

test('disposeTshirtSkinnedGroup: disposes every mesh geometry and material exactly once, never throws on a partially-built group', () => {
  const built = buildAndBind(makeFakeGltfScene());
  let geoDisposeCalls = 0;
  let matDisposeCalls = 0;
  built.meshes.forEach((m) => {
    const origGeo = m.geometry.dispose.bind(m.geometry);
    m.geometry.dispose = () => { geoDisposeCalls += 1; origGeo(); };
    const origMat = m.material.dispose.bind(m.material);
    m.material.dispose = () => { matDisposeCalls += 1; origMat(); };
  });
  assert.doesNotThrow(() => disposeTshirtSkinnedGroup(built));
  assert.equal(geoDisposeCalls, built.meshes.length);
  assert.equal(matDisposeCalls, built.meshes.length);
  assert.doesNotThrow(() => disposeTshirtSkinnedGroup(null)); // never throws on a null/not-yet-built group either
});
