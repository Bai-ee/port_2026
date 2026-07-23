import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as stdlib from 'three-stdlib';
import {
  createGLTFLoaderBundle, disposeGLTFLoaderBundle, parseGLBBuffer,
  normalizeGLBTransform, applyMaterialOverride,
} from '../glb-loader.js';

const bundle = () => createGLTFLoaderBundle({ THREE, stdlib });

/**
 * Build a real, self-contained GLB ArrayBuffer in memory via three-stdlib's
 * own GLTFExporter — no fixture file, no network. This is the same
 * production export/parse round-trip a real uploaded asset goes through,
 * just generated on the fly, so these tests exercise the REAL GLTFLoader
 * parse path (parseGLBBuffer), not a hand-rolled substitute.
 *
 * `clip` is a FACTORY `(mesh) => AnimationClip`, not a pre-built clip — a
 * KeyframeTrack's name must be prefixed with its target object's own uuid
 * (`` `${mesh.uuid}.position` ``, not a bare `.position`); GLTFExporter
 * resolves that prefix to find which glTF node the channel's `target.node`
 * should point at, and silently emits a NODE-LESS (and therefore, on
 * reload, TRACK-LESS) channel without it. An earlier version of this
 * helper took a pre-built clip and every caller used the bare-`.position`
 * form — every animation clip in this whole test file round-tripped with
 * `tracks: []`, so every assertion here was unknowingly exercising an
 * empty clip (name/mixer-clock/action-lifecycle only, never a real
 * animated value). Caught live, in an actual browser, on an actual
 * uploaded asset that visibly didn't move — not by any of these unit
 * tests, which is exactly the gap the fix below closes.
 */
function buildGLB({ position = [0, 0, 0], scale = [1, 1, 1], clip = null } = {}) {
  return new Promise((resolve, reject) => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, metalness: 0.4, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const builtClip = typeof clip === 'function' ? clip(mesh) : clip;
    const exporter = new stdlib.GLTFExporter();
    exporter.parse(
      scene,
      (result) => resolve(result),
      (err) => reject(err),
      { binary: true, animations: builtClip ? [builtClip] : [] }
    );
  });
}

test('parseGLBBuffer: round-trips a real in-memory-exported GLB (real GLTFLoader parse, no network)', async () => {
  const buffer = await buildGLB({ position: [2, 0, 0] });
  const gltf = await parseGLBBuffer(bundle(), buffer);
  assert.ok(gltf.scene.isObject3D);
  assert.equal(gltf.scene.children.length, 1);
  assert.equal(gltf.animations.length, 0);
});

test('parseGLBBuffer: animation clips survive the round-trip WITH their tracks intact, and actually animate the target mesh', async () => {
  const buffer = await buildGLB({
    position: [2, 0, 0],
    clip: (mesh) => new THREE.AnimationClip('Spin', 1, [
      new THREE.VectorKeyframeTrack(`${mesh.uuid}.position`, [0, 1], [2, 0, 0, 4, 0, 0]),
    ]),
  });
  const gltf = await parseGLBBuffer(bundle(), buffer);
  assert.deepEqual(gltf.animations.map((a) => a.name), ['Spin']);
  // The name surviving is necessary but not sufficient — assert the track
  // itself survived and genuinely drives the mesh's position, not just
  // that a same-named, empty clip came back.
  assert.equal(gltf.animations[0].tracks.length, 1, 'the clip must round-trip with its track intact, not empty');
  const mesh = gltf.scene.children[0];
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
  mixer.update(0.5);
  assert.ok(Math.abs(mesh.position.x - 3) < 1e-6, `mixer.update should have moved the mesh to x=3 (halfway 2->4), got ${mesh.position.x}`);
});

test('parseGLBBuffer: malformed bytes reject rather than hang or throw synchronously', async () => {
  const garbage = new TextEncoder().encode('not a glb').buffer;
  await assert.rejects(() => parseGLBBuffer(bundle(), garbage));
});

test('disposeGLTFLoaderBundle: does not throw on a real bundle or on a missing/partial one', () => {
  assert.doesNotThrow(() => disposeGLTFLoaderBundle(bundle()));
  assert.doesNotThrow(() => disposeGLTFLoaderBundle(null));
  assert.doesNotThrow(() => disposeGLTFLoaderBundle({}));
});

// ── normalizeGLBTransform ────────────────────────────────────────────────
// Verified as a genuine INTEGRATION check, not just "trust the returned
// numbers": build the exact two-nested-group hierarchy factories.js's
// glb-import factory will build from these numbers, update its world
// matrices for real, and re-measure the RESULTING bounding sphere — proving
// the recenter-then-scale composition actually produces a unit sphere at
// the origin, not just that normalizeGLBTransform's own arithmetic looks
// plausible in isolation.

function applyNormalization(THREE_, scene, { offset, scale }) {
  const recenter = new THREE_.Group();
  recenter.position.set(...offset);
  recenter.add(scene);
  const scaled = new THREE_.Group();
  scaled.scale.setScalar(scale);
  scaled.add(recenter);
  scaled.updateMatrixWorld(true);
  return scaled;
}

test('normalizeGLBTransform: an off-center, non-unit mesh normalizes to a unit sphere at the origin', () => {
  const geo = new THREE.BoxGeometry(2, 2, 2); // half-extent sqrt(3) ≈ 1.732 at scale 1
  const mesh = new THREE.Mesh(geo);
  mesh.position.set(5, -3, 2); // arbitrary, far off-center
  mesh.scale.set(4, 4, 4); // arbitrary, far from unit
  mesh.updateMatrixWorld(true);
  const scene = new THREE.Group();
  scene.add(mesh);

  const result = normalizeGLBTransform(THREE, scene, 1);
  assert.ok(result.scale > 0);
  assert.ok(result.radius > 0);

  const normalized = applyNormalization(THREE, scene, result);
  const box = new THREE.Box3().setFromObject(normalized);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.y) < 1e-6 && Math.abs(center.z) < 1e-6, `center should be at the origin, got ${center.toArray()}`);
  assert.ok(Math.abs(sphere.radius - 1) < 1e-6, `bounding sphere radius should be 1, got ${sphere.radius}`);
});

test('normalizeGLBTransform: respects a non-default targetRadius', () => {
  const geo = new THREE.SphereGeometry(3, 8, 8);
  const mesh = new THREE.Mesh(geo);
  mesh.position.set(1, 1, 1);
  const scene = new THREE.Group();
  scene.add(mesh);

  const result = normalizeGLBTransform(THREE, scene, 2.5);
  const normalized = applyNormalization(THREE, scene, result);
  const box = new THREE.Box3().setFromObject(normalized);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  assert.ok(Math.abs(sphere.radius - 2.5) < 1e-6, `expected radius 2.5, got ${sphere.radius}`);
});

test('normalizeGLBTransform: an empty scene (no geometry) returns a safe zero result, not NaN/Infinity', () => {
  const scene = new THREE.Group();
  const result = normalizeGLBTransform(THREE, scene, 1);
  assert.deepEqual(result, { offset: [0, 0, 0], scale: 1, radius: 0 });
});

// ── applyMaterialOverride ────────────────────────────────────────────────

test('applyMaterialOverride: enabling sets tint/metalness/roughness; disabling restores the original values exactly', () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0x336699, metalness: 0.1, roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const root = new THREE.Group();
  root.add(mesh);
  const originalHex = mat.color.getHex();

  applyMaterialOverride(root, { enabled: true, tint: '#ff0000', metalness: 0.8, roughness: 0.2 });
  assert.equal(mat.color.getHexString(), 'ff0000');
  assert.equal(mat.metalness, 0.8);
  assert.equal(mat.roughness, 0.2);

  applyMaterialOverride(root, { enabled: false });
  assert.equal(mat.color.getHex(), originalHex);
  assert.equal(mat.metalness, 0.1);
  assert.equal(mat.roughness, 0.9);
});

test('applyMaterialOverride: the material object identity never changes (exactly one material per mesh for disposal to find)', () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const root = new THREE.Group();
  root.add(mesh);
  applyMaterialOverride(root, { enabled: true, tint: '#00ff00', metalness: 0.5, roughness: 0.5 });
  assert.equal(mesh.material, mat, 'override must mutate the existing material in place, never swap/clone it');
});

test('applyMaterialOverride: a material without color/metalness/roughness (e.g. a shared-geometry mesh with no material) is skipped safely', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.ShadowMaterial()); // no metalness/roughness
  const root = new THREE.Group();
  root.add(mesh);
  assert.doesNotThrow(() => applyMaterialOverride(root, { enabled: true, tint: '#ff0000', metalness: 1, roughness: 1 }));
});

test('applyMaterialOverride: multi-material meshes (material array) are left untouched, not crashed on', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
  const root = new THREE.Group();
  root.add(mesh);
  assert.doesNotThrow(() => applyMaterialOverride(root, { enabled: true, tint: '#ff0000', metalness: 1, roughness: 1 }));
});

test('applyMaterialOverride: the original-values cache is captured once and reused across repeated calls', () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0x123456 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const root = new THREE.Group();
  root.add(mesh);
  applyMaterialOverride(root, { enabled: true, tint: '#ff0000', metalness: 0.5, roughness: 0.5 });
  const cacheAfterFirst = root.userData.originalMaterialValues;
  applyMaterialOverride(root, { enabled: true, tint: '#00ff00', metalness: 0.9, roughness: 0.1 });
  assert.equal(root.userData.originalMaterialValues, cacheAfterFirst, 'cache object identity should be stable across calls');
  applyMaterialOverride(root, { enabled: false });
  assert.equal(mat.color.getHex(), 0x123456, 'restoring must use the ORIGINAL value captured before any override, not the most recent override value');
});
