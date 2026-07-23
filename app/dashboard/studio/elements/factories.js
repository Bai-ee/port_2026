// Browser preview element-factory registry — docs/plans/ORIGINAL-STUDIO-
// CINEMATIC-SETS-4K-PLAN.md. Each factory owns what a SINGLE live three.js
// object for one element type looks like; ClothStudio.jsx owns creation/
// removal *timing* (its element-object sync effect) and the shared scene/
// animation loop.
//
// A factory never imports 'three' or 'three-stdlib' at module scope — both
// are dynamically imported inside ClothStudio's world-init effect (matching
// this file's existing async-import convention) and passed in via `ctx`.
// That keeps this file free of import-time side effects and, as a bonus,
// makes every factory constructible in plain Node (three.js core needs no
// DOM/WebGL context to build geometries/materials) — see
// elements/__tests__/factories.test.js.
//
// ── Object structure (every factory) ──────────────────────────────────────
//   root (returned by create(), added to elementsGroup)
//     └─ motion (root.userData.motion — the ONLY thing animate() may touch)
//         └─ actual mesh(es), built/rebuilt by applyInstance()
// `root`'s own position/rotation/scale is the AUTHORED transform
// (instance.transform) and is set ONLY by applyInstance -> applyTransform.
// animate() must never read or write root.position/rotation/scale — it may
// only mutate `root.userData.motion` (or that group's children). This is
// what keeps a user's authored rotation/position/scale stable while an
// element spins/drifts: the two are different objects in the hierarchy, not
// the same property fighting between two writers every frame.
//
// ── Rebuild-vs-update split ────────────────────────────────────────────────
// applyInstance(ctx, root, instance) always does two cheap things
// (setTransform, updateMaterial) and ONE conditional expensive thing
// (rebuild geometry) — gated by comparing a per-factory "topology
// signature" (derived only from the fields that actually change the mesh
// shape/count — appearance.count, appearance.twists, appearance.borderWidth,
// and quality tier where the factory's geometry actually depends on tier)
// against what's cached on `root.userData.topologySignature`. A transform
// drag, a color/opacity/roughness/clarity change, or a motion-speed change
// never touches geometry — see elements/__tests__/factories.test.js
// "lifecycle" tests for the exact guarantees.
//
// Contract per factory:
//   create(ctx)                          -> Object3D  (root, with an empty motion child)
//   applyInstance(ctx, root, instance)    -> void
//   animate(root, instance, elapsed, dt)  -> void      (touches root.userData.motion only)
//   dispose(root)                        -> void       (frees every geometry/material/texture)
//
// `ctx = { THREE, stdlib, tier }` — `tier` is a quality.js tier id (see
// scaleSegments) controlling procedural detail.

import { scaleSegments } from './quality.js';
import { computeParticleTarget, computeParticleColor, lerpTowardTarget, DEFAULT_PARTICLE_PARAMS } from './particle-math.js';
import { mulberry32, deriveSeed } from './randomize.js';
import { loadGLBFromUrl, normalizeGLBTransform, applyMaterialOverride } from './glb-loader.js';

const DEG = Math.PI / 180;

function applyTransform(root, instance) {
  const [px, py, pz] = instance.transform.position;
  root.position.set(px, py, pz);
  const [rx, ry, rz] = instance.transform.rotation;
  root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  const [sx, sy, sz] = instance.transform.scale;
  root.scale.set(sx, sy, sz);
}

// Disposes every child's geometry + every material (and any texture
// property on that material, and — for a SkinnedMesh — its skeleton's bone
// texture) found under `object`, then empties it. Every disposable
// resource is de-duped BY REFERENCE across the whole traversal (a Set per
// resource kind: geometry, material, texture, skeleton), not just within
// one mesh/material — every one of the six procedural factories happens to
// give each mesh its own unique geometry/material (never shared), so this
// is a no-op change for them, but an uploaded GLB (glb-import) commonly
// shares a geometry or texture across multiple nodes/materials, and
// disposing the SAME underlying GPU resource twice is a real bug (three.js
// doesn't guard against it) this correction closes.
export function clearGroup(object) {
  const seenGeometries = new Set();
  const seenMaterials = new Set();
  const seenTextures = new Set();
  const seenSkeletons = new Set();
  object.traverse((child) => {
    if (child.geometry && !seenGeometries.has(child.geometry)) {
      seenGeometries.add(child.geometry);
      child.geometry.dispose();
    }
    // SkinnedMesh's skeleton (bone matrices, and a bone texture at higher
    // bone counts) is its own disposable resource, independent of geometry/
    // material — and, like geometry, can be shared across multiple
    // SkinnedMesh instances in one glTF scene.
    if (child.isSkinnedMesh && child.skeleton && !seenSkeletons.has(child.skeleton)) {
      seenSkeletons.add(child.skeleton);
      child.skeleton.dispose();
    }
    const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
    materials.forEach((mat) => {
      if (seenMaterials.has(mat)) return;
      seenMaterials.add(mat);
      Object.values(mat).forEach((v) => {
        if (!v || !v.isTexture || seenTextures.has(v)) return;
        seenTextures.add(v);
        v.dispose();
      });
      mat.dispose();
    });
  });
  while (object.children.length) object.remove(object.children[0]);
}

function createRoot(THREE) {
  const root = new THREE.Group();
  const motion = new THREE.Group();
  root.add(motion);
  root.userData.motion = motion;
  return root;
}

// ── Kinetic Rings ────────────────────────────────────────────────────────────
// 1-5 tori, deterministic per-index axis tilt (golden-angle spacing — same
// idiom this codebase already uses for particle/loop distribution, not
// Math.random()), each spinning on its own local Z at its own rate.

const GOLDEN_ANGLE = 2.39996322972865332;

function ringsCreate({ THREE }) {
  return createRoot(THREE);
}

function ringsTopologySignature(instance, tier) {
  return `${instance.appearance.count}:${tier}`;
}

function ringsRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { count } = instance.appearance;
  const { color, metalness, roughness } = instance.material;
  const tubularSegments = scaleSegments(48, tier, 12);
  const radialSegments = scaleSegments(14, tier, 6);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), metalness, roughness, clearcoat: 0.4, clearcoatRoughness: 0.2,
  });
  const rings = [];
  for (let i = 0; i < count; i += 1) {
    const radius = 0.55 + i * 0.14;
    const geo = new THREE.TorusGeometry(radius, 0.025, radialSegments, tubularSegments);
    const mesh = new THREE.Mesh(geo, mat);
    const az = i * GOLDEN_ANGLE;
    mesh.rotation.set(Math.sin(az) * 0.9, Math.cos(az) * 0.6, i * 0.35);
    motion.add(mesh);
    rings.push(mesh);
  }
  motion.userData.rings = rings;
  root.userData.material = mat;
}

function ringsUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, metalness, roughness } = instance.material;
  mat.color.set(color);
  mat.metalness = metalness;
  mat.roughness = roughness;
}

function ringsApplyInstance(ctx, root, instance) {
  const sig = ringsTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    ringsRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  ringsUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function ringsAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  const speed = instance.motion.speed;
  (root.userData.motion.userData.rings || []).forEach((mesh, i) => {
    mesh.rotation.z += speed * dt * (0.4 + i * 0.08);
  });
}

// ── Chrome Ribbon ────────────────────────────────────────────────────────────
// A flat-cross-section ExtrudeGeometry following a CatmullRom sine-wave path
// — a genuine ribbon (not a round tube). Motion drives root.userData.motion's
// rotation, never root's own.

function ribbonCreate({ THREE }) {
  return createRoot(THREE);
}

function ribbonTopologySignature(instance, tier) {
  return `${instance.appearance.twists}:${tier}`;
}

function ribbonRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { twists } = instance.appearance;
  const { color, roughness } = instance.material;
  const steps = scaleSegments(120, tier, 24);
  const width = 0.22;
  const thickness = 0.02;
  const length = 1.6;
  const N = 40;
  const points = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const x = (t - 0.5) * length;
    const y = Math.sin(t * Math.PI * 2 * twists) * 0.28;
    const z = Math.cos(t * Math.PI * 2 * twists) * 0.12;
    points.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -thickness / 2);
  shape.lineTo(width / 2, -thickness / 2);
  shape.lineTo(width / 2, thickness / 2);
  shape.lineTo(-width / 2, thickness / 2);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { steps, bevelEnabled: false, extrudePath: curve });
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 1, roughness });
  motion.add(new THREE.Mesh(geo, mat));
  root.userData.material = mat;
}

function ribbonUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.color.set(instance.material.color);
  mat.roughness = instance.material.roughness;
}

function ribbonApplyInstance(ctx, root, instance) {
  const sig = ribbonTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    ribbonRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  ribbonUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function ribbonAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  const motion = root.userData.motion;
  motion.rotation.y += instance.motion.speed * 0.3 * dt;
  motion.rotation.x = Math.sin(elapsed * instance.motion.speed * 0.5) * 0.08;
}

// ── Translucent Monoliths ────────────────────────────────────────────────────
// 1-6 frosted RoundedBoxGeometry columns in a centered row, sharing one
// transmission material (same idiom as the existing glass shell).

function monolithsCreate({ THREE }) {
  return createRoot(THREE);
}

function monolithsTopologySignature(instance, tier) {
  return `${instance.appearance.count}:${tier}`;
}

function monolithsRebuild({ THREE, stdlib, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { count } = instance.appearance;
  const { color, opacity } = instance.material;
  const { RoundedBoxGeometry } = stdlib;
  const segments = scaleSegments(4, tier, 2);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), transparent: true, opacity,
    roughness: 0.85, transmission: 0.5, thickness: 0.4, side: THREE.DoubleSide,
  });
  const spacing = 0.32;
  const startX = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i += 1) {
    const geo = new RoundedBoxGeometry(0.16, 1.0, 0.16, segments, 0.03);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(startX + i * spacing, 0, 0);
    motion.add(mesh);
  }
  root.userData.material = mat;
}

function monolithsUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.color.set(instance.material.color);
  mat.opacity = instance.material.opacity;
}

function monolithsApplyInstance(ctx, root, instance) {
  const sig = monolithsTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    monolithsRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  monolithsUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function monolithsAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  root.userData.motion.rotation.y += instance.motion.speed * 0.15 * dt;
}

// ── Liquid-Glass Lens ────────────────────────────────────────────────────────
// A flattened, thick CylinderGeometry disc — the same transmission-glass
// idiom as the Glass Petal Sphere, in a simpler lens shape. Geometry depends
// only on quality tier (no appearance fields for this type).

function lensCreate({ THREE }) {
  return createRoot(THREE);
}

function lensTopologySignature(instance, tier) {
  return `${tier}`;
}

function lensRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { tint, clarity } = instance.material;
  const segments = scaleSegments(48, tier, 16);
  const geo = new THREE.CylinderGeometry(0.45, 0.45, 0.12, segments, 1);
  const mat = new THREE.MeshPhysicalMaterial({
    transmission: 1, thickness: 0.5, ior: 1.4, roughness: clarity, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.05,
    attenuationColor: new THREE.Color(tint), attenuationDistance: 1.2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2; // disc faces the camera by default
  motion.add(mesh);
  root.userData.material = mat;
}

function lensUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.roughness = instance.material.clarity;
  mat.attenuationColor.set(instance.material.tint);
}

function lensApplyInstance(ctx, root, instance) {
  const sig = lensTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    lensRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  lensUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function lensAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  root.userData.motion.rotation.z += instance.motion.speed * 0.3 * dt;
}

// ── Floating Media Frame ─────────────────────────────────────────────────────
// A bordered plane pair (frame + content pane). The content pane uses a
// small procedurally-generated DataTexture gradient — NOT the live cloth
// artwork. Wiring the real uploaded artwork into a second surface is
// explicitly later-phase work (see the catalog description for this type);
// DataTexture (not a <canvas> CanvasTexture) keeps this factory DOM-free so
// it constructs in plain Node for tests, same as the other four. Geometry
// depends only on appearance.borderWidth — NOT tier (these are plain
// unsubdivided planes), so tier changes never trigger a rebuild here.

function makePlaceholderTexture(THREE) {
  const size = 8;
  const data = new Uint8Array(size * size * 4);
  const from = [58, 63, 82];
  const to = [125, 139, 171];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const t = (x + y) / (size * 2 - 2);
      data[i] = Math.round(from[0] + t * (to[0] - from[0]));
      data[i + 1] = Math.round(from[1] + t * (to[1] - from[1]));
      data[i + 2] = Math.round(from[2] + t * (to[2] - from[2]));
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function frameCreate({ THREE }) {
  return createRoot(THREE);
}

function frameTopologySignature(instance) {
  return `${instance.appearance.borderWidth}`;
}

function frameRebuild({ THREE }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color, opacity } = instance.material;
  const { borderWidth } = instance.appearance;
  const w = 0.7;
  const h = 0.9;
  const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.6, roughness: 0.35 });
  const frameMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), frameMat);
  motion.add(frameMesh);

  const contentMat = new THREE.MeshBasicMaterial({ map: makePlaceholderTexture(THREE), transparent: true, opacity });
  const innerW = Math.max(0.02, w - borderWidth * 2);
  const innerH = Math.max(0.02, h - borderWidth * 2);
  const contentMesh = new THREE.Mesh(new THREE.PlaneGeometry(innerW, innerH), contentMat);
  contentMesh.position.z = 0.005;
  motion.add(contentMesh);

  root.userData.frameMaterial = frameMat;
  root.userData.contentMaterial = contentMat;
}

function frameUpdateMaterial(root, instance) {
  const { frameMaterial, contentMaterial } = root.userData;
  if (frameMaterial) frameMaterial.color.set(instance.material.color);
  if (contentMaterial) contentMaterial.opacity = instance.material.opacity;
}

function frameApplyInstance(ctx, root, instance) {
  const sig = frameTopologySignature(instance);
  if (root.userData.topologySignature !== sig) {
    frameRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  frameUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function frameAnimate(root, instance, elapsed) {
  if (!instance.motion.rotate) return;
  root.userData.motion.rotation.y = Math.sin(elapsed * instance.motion.speed) * 0.25;
}

// ── Homepage Particle Hero ───────────────────────────────────────────────────
// A THREE.InstancedMesh driven entirely by elements/particle-math.js — the
// SAME stereographic-torus formula ox.jsx's homepage swarm uses (that module
// is a verified byte-faithful extraction; ox.jsx itself is untouched). The
// homepage's own camera (z=100, fov=60) and this Studio's (z=2.6, fov=40)
// are wildly different scales; STUDIO_SCALE_RATIO rescales the SHAPE params
// (mirrors placement.js's CAMERA_Z/FOV_DEG — kept in sync manually, same
// mirrored-constant pattern used throughout this codebase) so the swarm
// reads as the same shape here, not blown out or invisible.
//
// Unlike every other factory, this one carries PERSISTENT per-frame
// simulation state (root.userData.currentPositions/simTime) that survives
// across animate() calls — mirroring ox.jsx's own stateful position-lerp
// smoothing (its simTimeRef/positions arrays). That state is owned entirely
// by this factory (created in heroRebuild, mutated only in heroAnimate) and
// is discarded/recreated whenever topology (particleCount/tier) changes —
// same rebuild trigger every other factory uses, just with more to rebuild.

const STUDIO_SCALE_RATIO = 0.01639; // (Studio Z=0 frame half-height) / (homepage Z=0 frame half-height) — see catalog.js's homepage-particle-hero entry for the derivation.
// A second, empirically-tuned factor on top of STUDIO_SCALE_RATIO. The ratio
// alone reproduces the homepage swarm's SHAPE at Studio's scale, but not its
// relationship to a foreground occluder — the homepage has nothing in front
// of its particles, while Studio's opaque cloth sheet sits right in front of
// this background-depth element. At ratio alone, the swarm's TYPICAL (not
// worst-case) radius is only ~0.45 world units — well inside the sheet's own
// ~0.86x0.54 half-extents (CLOTH_ASPECTS.landscape, ClothStudio.jsx) — so
// most particles sat behind the opaque sheet and were invisible; caught live
// in the browser (the swarm visibly "disappeared" a few seconds after
// spawning, once it converged from its scattered start toward the compact
// torus shape). PARTICLE_ENVELOPE_BOOST=2 was chosen empirically (verified
// via sampling) to put ~78% of particles outside the sheet's silhouette at
// any given moment, reading as a visible halo/wrap around the artwork —
// the same design intent as Kinetic Rings, just reached differently since
// this shape's natural proportions come from ox.jsx, not a hand-picked
// anchor fraction.
const PARTICLE_ENVELOPE_BOOST = 2;
const PARTICLE_SCALE = DEFAULT_PARTICLE_PARAMS.scale * STUDIO_SCALE_RATIO * PARTICLE_ENVELOPE_BOOST;
// torusMajorRadius/torusTubeRadius are RELATIVE shape proportions (the torus
// is computed at roughly unit size, then `scale` above is the ONE absolute-
// size multiplier applied afterward — see particle-math.js's `x*scale`
// terms) — NOT independent absolute sizes. A real bug caught during live
// verification: scaling these by STUDIO_SCALE_RATIO too effectively squared
// the ratio (a ~0.0164 torus radius, THEN multiplied by a ~0.0164-scaled
// `scale`), collapsing the swarm's underlying torus/Möbius structure to
// near-invisibility while the (correctly-scaled) wave-distortion term
// dominated what little was left — it read as a tiny formless jitter near
// the origin, not a recognizable swarm. Left at ox.jsx's own defaults.
const PARTICLE_TORUS_MAJOR = DEFAULT_PARTICLE_PARAMS.torusMajorRadius;
const PARTICLE_TORUS_TUBE = DEFAULT_PARTICLE_PARAMS.torusTubeRadius;
// NOT scaled by STUDIO_SCALE_RATIO — a per-dot render size, not a shape
// dimension; scaling it down with everything else would make every particle
// sub-pixel. Chosen independently, proportionate to this Studio's other
// elements (roughly half Kinetic Rings' 0.025 tube radius).
const PARTICLE_DOT_SIZE = 0.012;
// Mirrors ox.jsx's own spawn-cloud size ((Math.random()-0.5)*100), rescaled.
const PARTICLE_SPAWN_SPREAD = 100 * STUDIO_SCALE_RATIO;
// Mirrors ox.jsx's default `runtimeProfile.positionLerp` (0.1) — how fast a
// particle's rendered position chases its freshly-computed target each frame.
const PARTICLE_POSITION_LERP = 0.1;

function heroCreate({ THREE }) {
  return createRoot(THREE);
}

function heroTopologySignature(instance, tier) {
  return `${instance.appearance.particleCount}:${tier}`;
}

function heroRebuild({ THREE, tier, sceneSeed }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const count = scaleSegments(instance.appearance.particleCount, tier, 50);
  const geo = new THREE.IcosahedronGeometry(1, 0); // cheap low-poly dot — thousands of these is fine at this poly count
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false;
  motion.add(mesh);

  // Seeded, not Math.random() — Phase 3's explicit contract: reloading or
  // rebuilding the SAME saved scene/instance must reproduce the same initial
  // spawn cloud, not a new random one each time. Derived from the scene seed
  // + this instance's own id (deriveSeed/mulberry32 — the same seeded-PRNG
  // pattern already used by randomize.js elsewhere in Studio), so two
  // different particle-hero instances in the same scene never draw from the
  // same stream. Deliberately NOT part of heroTopologySignature: a changed
  // scene seed (e.g. from an unrelated Randomize click) shouldn't force this
  // element to rebuild — only an actual topology change (count/tier) should.
  const seed = deriveSeed(sceneSeed ?? 1, instance.id, 'particle-spawn');
  const rand = mulberry32(seed);
  const currentPositions = new Float32Array(count * 3);
  for (let i = 0; i < currentPositions.length; i += 1) currentPositions[i] = (rand() - 0.5) * PARTICLE_SPAWN_SPREAD;

  root.userData.mesh = mesh;
  root.userData.material = mat;
  root.userData.count = count;
  root.userData.currentPositions = currentPositions;
  root.userData.simTime = 0;
  root.userData.dummy = new THREE.Object3D();
  root.userData.color = new THREE.Color();
}

function heroUpdateMaterial() {
  // Every particle's color is computed fresh, per-instance, per-frame in
  // heroAnimate (mirroring ox.jsx) — there is no shared material property to
  // sync here. Kept as an explicit no-op, not omitted, so heroApplyInstance's
  // orchestration matches every other factory's shape exactly.
}

function heroApplyInstance(ctx, root, instance) {
  const sig = heroTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    heroRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  heroUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function heroAnimate(root, instance, elapsed, dt) {
  const { mesh, currentPositions, count, dummy, color } = root.userData;
  if (!mesh || !currentPositions) return;
  if (!instance.motion.rotate) return; // FLOW off — freeze exactly where it is, skip the sim entirely
  root.userData.simTime = (root.userData.simTime || 0) + dt * instance.motion.speed;
  const simTime = root.userData.simTime;
  const { chaos, flow, waveAmplitude, hueSpeed, saturation } = instance.appearance;
  const params = {
    ...DEFAULT_PARTICLE_PARAMS,
    scale: PARTICLE_SCALE,
    torusMajorRadius: PARTICLE_TORUS_MAJOR,
    torusTubeRadius: PARTICLE_TORUS_TUBE,
    chaos, flow, waveAmplitude, hueSpeed, saturation,
  };
  for (let i = 0; i < count; i += 1) {
    const target = computeParticleTarget(i, count, simTime, params);
    const i3 = i * 3;
    const px = lerpTowardTarget(currentPositions[i3], target.x, PARTICLE_POSITION_LERP);
    const py = lerpTowardTarget(currentPositions[i3 + 1], target.y, PARTICLE_POSITION_LERP);
    const pz = lerpTowardTarget(currentPositions[i3 + 2], target.z, PARTICLE_POSITION_LERP);
    currentPositions[i3] = px;
    currentPositions[i3 + 1] = py;
    currentPositions[i3 + 2] = pz;
    dummy.position.set(px, py, pz);
    dummy.scale.setScalar(PARTICLE_DOT_SIZE);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const { h, s, l } = computeParticleColor(i, count, simTime, target.wave, params);
    color.setHSL(h, s, l);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ── GLB Import ───────────────────────────────────────────────────────────
// Phase 3 GLB import (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md).
// Structurally different from every other factory in one way: loading is
// ASYNC (fetch + parse over the network), where every other factory builds
// its content synchronously inside applyInstance. The topology-signature
// gate (assetId only — NOT animationClip/material/tier, none of which need
// a re-fetch) still decides WHEN to kick off a (re)load; the load itself
// runs in the background and, on success, populates root.userData.motion —
// exactly like every other factory's rebuild, just arriving a frame or few
// later instead of within the same synchronous call.
//
// Object structure, one level deeper than every other factory:
//   root -> motion -> scaled (uniform-scale wrapper) -> recenter (pivot
//   wrapper) -> gltf.scene (the loaded asset, its own internal structure
//   untouched — see glb-loader.js normalizeGLBTransform's own comment for
//   why two nested wrappers, not one, are required for correct recenter-
//   then-scale composition).

// Every loaded GLB is normalized to THIS radius (elements/glb-loader.js
// normalizeGLBTransform), not to a full unit sphere (1.0) — deliberately
// smaller. Measured directly against the real placement search
// (elements/placement.js defaultTransformForFormat): at radius 1.0, no
// (depth, scale) combination clears both frame and safe zone in ANY
// format within TRANSFORM_RANGES — genuinely too large, the same real
// constraint translucent-monoliths (localRadius 1.02) already runs into.
// 0.4 was chosen by probing downward until Landscape/Square/Reel were ALL
// comfortably feasible again (not just barely at TRANSFORM_RANGES.scale.
// min) — matches liquid-glass-lens's own established, working radius/depth
// precedent almost exactly. catalog.js's declared `bounds.localRadius`
// (0.46) is this value times a margin, same relationship every other
// type's bound has to ITS topology maximum.
const GLB_NORMALIZE_TARGET_RADIUS = 0.4;

/** `ctx.glbAssetsById[assetId]?.readUrl` — see ClothStudio.jsx's live-object-sync effect for how this map is built from the fetched asset library. */
function glbResolveAssetUrl(ctx, assetId) {
  if (!assetId) return null;
  return ctx.glbAssetsById?.[assetId]?.readUrl || null;
}

function glbTopologySignature(instance) {
  return String(instance.appearance.assetId || '');
}

function glbCreate({ THREE }) {
  return createRoot(THREE);
}

/**
 * Selects (or clears) the active AnimationMixer action for
 * `instance.appearance.animationClip`. Safe to call every applyInstance —
 * it's a no-op unless the WANTED clip name actually changed, and a
 * stale/renamed clip name (an asset was replaced since this instance was
 * authored) falls back to the static bind pose rather than throwing.
 */
function glbUpdateAnimationSelection(root, instance) {
  const { mixer, clips } = root.userData;
  if (!mixer || !clips) return;
  const wanted = instance.appearance.animationClip || '';
  if (root.userData.activeClipName === wanted) return;
  if (root.userData.activeAction) root.userData.activeAction.stop();
  root.userData.activeAction = null;
  root.userData.activeClipName = wanted;
  if (!wanted) return; // '' -> no animation selected, stays on the static bind pose
  const clip = clips.find((c) => c.name === wanted);
  if (!clip) return;
  const action = mixer.clipAction(clip);
  action.reset().play();
  root.userData.activeAction = action;
}

/**
 * Fires the async fetch+parse+normalize for the currently-selected asset.
 * Race-guarded with a monotonic `loadToken`: if the assetId changes again
 * (or the instance is removed — glbDispose bumps the token too) before this
 * resolves, the stale result is disposed into a throwaway group instead of
 * being spliced into a root that's moved on, rather than silently leaking
 * its geometries/materials/textures.
 */
async function glbLoadAsset(ctx, root, instance) {
  const token = (root.userData.loadToken || 0) + 1;
  root.userData.loadToken = token;
  const motion = root.userData.motion;
  clearGroup(motion); // immediately empty — never shows stale content while a new asset loads
  root.userData.mixer = null;
  root.userData.clips = null;
  root.userData.activeAction = null;
  root.userData.activeClipName = null;
  root.userData.originalMaterialValues = null;

  const assetId = instance.appearance.assetId;
  const url = glbResolveAssetUrl(ctx, assetId);
  if (!assetId || !url) return; // no asset selected, or its library entry isn't (yet/anymore) known — stays empty, not an error

  let gltf;
  try {
    gltf = await loadGLBFromUrl(ctx.glbLoader, url);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[glb-import] failed to load asset ${assetId}:`, err?.message || err);
    return;
  }
  if (root.userData.loadToken !== token) {
    const throwaway = new ctx.THREE.Group();
    throwaway.add(gltf.scene);
    clearGroup(throwaway);
    return;
  }

  const { offset, scale } = normalizeGLBTransform(ctx.THREE, gltf.scene, GLB_NORMALIZE_TARGET_RADIUS);
  const recenter = new ctx.THREE.Group();
  recenter.position.set(offset[0], offset[1], offset[2]);
  recenter.add(gltf.scene);
  const scaled = new ctx.THREE.Group();
  scaled.scale.setScalar(scale);
  scaled.add(recenter);
  motion.add(scaled);

  root.userData.mixer = new ctx.THREE.AnimationMixer(gltf.scene);
  root.userData.clips = gltf.animations || [];
  glbUpdateAnimationSelection(root, instance);
  applyMaterialOverride(motion, {
    enabled: instance.material.overrideEnabled,
    tint: instance.material.tint,
    metalness: instance.material.metalness,
    roughness: instance.material.roughness,
  });
}

function glbApplyInstance(ctx, root, instance) {
  const sig = glbTopologySignature(instance);
  const assetId = instance.appearance.assetId;
  // A prior attempt at THIS SAME assetId (topology signature already
  // matches) can still have failed to actually load anything — most
  // commonly right after a page reload, when ClothStudio.jsx's live-object-
  // sync effect ran before the GLB asset library had finished its own
  // fetch (ctx.glbAssetsById didn't have this id YET). glbLoadAsset gives
  // up silently in that case (by design — an unresolved asset stays
  // empty, not an error) but unconditionally still marks the topology
  // signature as "handled," so a later call with the SAME (unchanged)
  // assetId would otherwise never retry even once the asset library
  // catches up — nothing about the instance itself needs to change again
  // to justify trying. `stillUnresolved` closes that gap: as long as an
  // asset is actually selected and nothing has ever landed under motion,
  // every call is a legitimate opportunity to retry, not just the one
  // where the topology signature first changed.
  const stillUnresolved = Boolean(assetId) && root.userData.motion.children.length === 0;
  if (root.userData.topologySignature !== sig || stillUnresolved) {
    root.userData.topologySignature = sig;
    // fire-and-forget; internally race-guarded (see glbLoadAsset). Does NOT
    // also call glbUpdateAnimationSelection/applyMaterialOverride here — a
    // fresh load synchronously EMPTIES motion before awaiting the fetch, so
    // calling them on this same tick would build (and, worse, permanently
    // cache — see applyMaterialOverride's own first-call guard) an override
    // map against a still-empty scene, racing glbLoadAsset's OWN post-load
    // call and starving it once the real content actually arrives.
    // glbLoadAsset applies both itself, once, at the moment content lands.
    glbLoadAsset(ctx, root, instance);
    applyTransform(root, instance);
    return;
  }
  glbUpdateAnimationSelection(root, instance);
  applyMaterialOverride(root.userData.motion, {
    enabled: instance.material.overrideEnabled,
    tint: instance.material.tint,
    metalness: instance.material.metalness,
    roughness: instance.material.roughness,
  });
  applyTransform(root, instance);
}

function glbAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return; // "PLAY ANIMATION" off — freeze, same FLOW-off precedent as homepage-particle-hero
  root.userData.mixer?.update(dt * instance.motion.speed);
}

/**
 * clearGroup (used directly by every other type's dispose) walks the
 * CURRENT scene graph — an in-flight async load that resolves AFTER
 * disposal would still try to splice its result into a root nothing
 * references anymore. Bumping loadToken first makes glbLoadAsset's own
 * staleness check catch that case and dispose the late-arriving result
 * into a throwaway group instead.
 */
function glbDispose(root) {
  root.userData.loadToken = (root.userData.loadToken || 0) + 1;
  clearGroup(root);
}

// ── Phase 4 — Optical pack ─────────────────────────────────────────────────
// Same procedural-geometry, MeshPhysicalMaterial-only vocabulary as every
// Phase 2 element — no new rendering technique.

// ── Prismatic Slab ───────────────────────────────────────────────────────
// A beveled RoundedBoxGeometry slab. `edgeGlow` is a pragmatic
// simplification (same spirit as Floating Media Frame's placeholder
// content pane) — a literal separate emissive edge/rim mesh was judged
// unnecessary complexity for what emissiveIntensity on the one slab
// material already reads as convincingly at this element's scale.

function slabCreate({ THREE }) {
  return createRoot(THREE);
}

function slabTopologySignature(instance, tier) {
  return `${instance.appearance.thickness}:${tier}`;
}

function slabRebuild({ THREE, stdlib, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { thickness } = instance.appearance;
  const { tint, iridescence, dispersion, edgeGlow } = instance.material;
  const { RoundedBoxGeometry } = stdlib;
  const segments = scaleSegments(4, tier, 2);
  const geo = new RoundedBoxGeometry(0.6, 0.9, thickness, segments, 0.04);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint), transmission: 0.85, thickness: 0.5, ior: 1.45, roughness: 0.05,
    iridescence, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400],
    dispersion, emissive: new THREE.Color(tint), emissiveIntensity: edgeGlow,
    side: THREE.DoubleSide,
  });
  motion.add(new THREE.Mesh(geo, mat));
  root.userData.material = mat;
}

function slabUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { tint, iridescence, dispersion, edgeGlow } = instance.material;
  mat.color.set(tint);
  mat.emissive.set(tint);
  mat.iridescence = iridescence;
  mat.dispersion = dispersion;
  mat.emissiveIntensity = edgeGlow;
}

function slabApplyInstance(ctx, root, instance) {
  const sig = slabTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    slabRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  slabUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function slabAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  root.userData.motion.rotation.y += instance.motion.speed * 0.3 * dt;
}

// ── Iridescent Film ──────────────────────────────────────────────────────
// A subdivided plane whose vertices are displaced along local Z each frame
// by a traveling sine wave (amplitude/frequency/curl) — a real per-vertex
// wave (same idiom as this file's cloth-adjacent animation, not a shader
// trick), computed against a STATIC per-vertex base position array cached
// on first build so the wave is relative to the flat rest pose, never
// compounding frame over frame.

function filmCreate({ THREE }) {
  return createRoot(THREE);
}

function filmTopologySignature(instance, tier) {
  return `${tier}`; // fixed plane subdivision regardless of appearance — amplitude/frequency/curl are per-frame animate() inputs, not topology
}

function filmRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { tint, iridescence, translucency } = instance.material;
  const wSeg = scaleSegments(24, tier, 8);
  const hSeg = scaleSegments(16, tier, 6);
  const geo = new THREE.PlaneGeometry(1.2, 0.8, wSeg, hSeg);
  const basePositions = Float32Array.from(geo.attributes.position.array);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint), transmission: translucency, thickness: 0.05, roughness: 0.1,
    iridescence, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400],
    transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.geometry = geo;
  root.userData.basePositions = basePositions;
  root.userData.material = mat;
  root.userData.waveTime = 0;
}

function filmUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { tint, iridescence, translucency } = instance.material;
  mat.color.set(tint);
  mat.iridescence = iridescence;
  mat.transmission = translucency;
}

function filmApplyInstance(ctx, root, instance) {
  const sig = filmTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    filmRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  filmUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function filmAnimate(root, instance, elapsed, dt) {
  const { geometry, basePositions } = root.userData;
  if (!geometry || !basePositions) return;
  if (!instance.motion.rotate) return; // "FLUTTER" off — freeze exactly where it is
  root.userData.waveTime = (root.userData.waveTime || 0) + dt * instance.motion.speed;
  const t = root.userData.waveTime;
  const { amplitude, frequency, curl } = instance.appearance;
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const x = basePositions[i3];
    const y = basePositions[i3 + 1];
    const z = Math.sin(x * frequency * 3 + t) * Math.cos(y * frequency * 2 - t * curl) * amplitude;
    posAttr.array[i3] = x;
    posAttr.array[i3 + 1] = y;
    posAttr.array[i3 + 2] = z;
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

// ── Gel Panels ────────────────────────────────────────────────────────────
// 2-4 overlapping colored transparent planes, golden-angle-staggered
// rotation and a small fixed Z offset per panel for the "intersection
// blend" read — same deterministic (not Math.random()) index-based
// distribution idiom as Kinetic Rings.

function panelsCreate({ THREE }) {
  return createRoot(THREE);
}

// tier deliberately NOT in this signature — panelsRebuild's plane is a
// single unsubdivided PlaneGeometry(0.8, 0.8) with nothing that would ever
// benefit from more segments (unlike iridescent-film's wavy, per-frame-
// deformed plane, which legitimately does use scaleSegments), so a tier
// change must never rebuild identical geometry — same precedent as
// floating-media-frame's own signature (appearance.borderWidth only, no
// tier) for the same reason.
function panelsTopologySignature(instance) {
  return `${instance.appearance.count}`;
}

function panelsRebuild({ THREE }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { count } = instance.appearance;
  const { color, opacity } = instance.material;
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), transparent: true, opacity, transmission: 0.4, thickness: 0.1,
    roughness: 0.3, side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry(0.8, 0.8);
  const panels = [];
  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(geo, mat);
    const az = i * GOLDEN_ANGLE;
    mesh.rotation.z = az;
    mesh.position.z = (i - (count - 1) / 2) * (0.2 / Math.max(1, count - 1));
    motion.add(mesh);
    panels.push(mesh);
  }
  motion.userData.panels = panels;
  root.userData.material = mat;
  root.userData.geometry = geo;
}

function panelsUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.color.set(instance.material.color);
  mat.opacity = instance.material.opacity;
}

function panelsApplyInstance(ctx, root, instance) {
  const sig = panelsTopologySignature(instance);
  if (root.userData.topologySignature !== sig) {
    panelsRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  panelsUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function panelsAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  const speed = instance.motion.speed;
  (root.userData.motion.userData.panels || []).forEach((mesh, i) => {
    mesh.rotation.z += speed * dt * (0.3 + i * 0.05);
  });
}

// ── Phase 4 — Reflective/Sculptural pack ────────────────────────────────────
// Same procedural THREE.MeshPhysicalMaterial/MeshStandardMaterial vocabulary
// as every prior pack — no new rendering technique.

// ── Orb Constellation ────────────────────────────────────────────────────
// One InstancedMesh of a shared unit sphere, positioned via the standard
// spherical-Fibonacci-lattice formula (deterministic, evenly distributed —
// same "index-based, not Math.random()" idiom as Kinetic Rings' golden-angle
// spacing): for index i of `count`, t=(i+0.5)/count, phi=acos(1-2t),
// theta=GOLDEN_ANGLE*i places every orb's CENTER at EXACTLY `clusterRadius`
// from the origin (sin(phi)^2 + cos(theta*sin(phi))^2 + cos(phi)^2 = 1) — an
// exact, not approximate, radius per orb. Per-orb scale varies deterministically
// by index (sizeVariance) so the cluster reads as varied, not uniform beads.
// Orbit motion rotates the whole InstancedMesh as one object (like Kinetic
// Rings/Translucent Monoliths) rather than per-instance simulation — cluster
// layout (position/scale) is recomputed on every applyInstance call (cheap:
// setMatrixAt on the SAME instanced geometry, not a rebuild) so clusterSpread/
// sizeVariance react live without disposing/recreating anything.

function orbCreate({ THREE }) {
  return createRoot(THREE);
}

function orbTopologySignature(instance, tier) {
  return `${instance.appearance.count}:${tier}`;
}

const ORB_SHELL_RADIUS = 0.6; // clusterSpread=1 -> every orb center at exactly this distance from origin
const ORB_BASE_RADIUS = 0.06; // sizeVariance=0 -> every orb this radius

function orbRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { count } = instance.appearance;
  const { color, metalness, roughness, emissiveStrength } = instance.material;
  const segments = scaleSegments(16, tier, 6);
  const geo = new THREE.SphereGeometry(1, segments, segments);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), metalness, roughness, clearcoat: 0.3,
    emissive: new THREE.Color(color), emissiveIntensity: emissiveStrength,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.material = mat;
  root.userData.dummy = new THREE.Object3D();
}

/** Recomputes every orb's position/scale from clusterSpread/sizeVariance — an UPDATE, not a rebuild (same instanced geometry, just re-written matrices). */
function orbUpdateLayout(root, instance) {
  const { mesh, dummy } = root.userData;
  if (!mesh || !dummy) return;
  const { count, clusterSpread, sizeVariance } = instance.appearance;
  const clusterRadius = ORB_SHELL_RADIUS * clusterSpread;
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const phi = Math.acos(1 - 2 * t);
    const theta = GOLDEN_ANGLE * i;
    const x = clusterRadius * Math.sin(phi) * Math.cos(theta);
    const y = clusterRadius * Math.sin(phi) * Math.sin(theta);
    const z = clusterRadius * Math.cos(phi);
    const sizeFactor = 1 + sizeVariance * Math.sin(i * GOLDEN_ANGLE);
    const orbRadius = ORB_BASE_RADIUS * Math.max(0.2, sizeFactor);
    dummy.position.set(x, y, z);
    dummy.scale.setScalar(orbRadius);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function orbUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, metalness, roughness, emissiveStrength } = instance.material;
  mat.color.set(color);
  mat.emissive.set(color);
  mat.metalness = metalness;
  mat.roughness = roughness;
  mat.emissiveIntensity = emissiveStrength;
}

function orbApplyInstance(ctx, root, instance) {
  const sig = orbTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    orbRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  orbUpdateLayout(root, instance);
  orbUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function orbAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  root.userData.motion.rotation.y += instance.motion.speed * 0.25 * dt;
}

// ── Inflatable Forms ─────────────────────────────────────────────────────
// A single glossy blob — a SphereGeometry whose vertices are displaced
// RADIALLY (each vertex moved along its own already-normalized
// direction-from-origin, cached at build time as `baseDirections` + each
// vertex's own rest-pose radius) — never along a fixed axis like Iridescent
// Film's per-vertex Z-wave, since a sphere has no single "flat" axis.
// `inflation` is a uniform mesh-level scale (an UPDATE, not a geometry
// rebuild — same non-topology-field treatment as every other appearance
// field that doesn't change vertex/instance COUNT), applied to the MESH
// object AFTER formsAnimate's per-vertex wobble displacement (which writes
// directly into the geometry's own LOCAL-space position buffer) — so the
// true rendered radius is `(restRadius + wobbleDisplacement) * inflation`,
// NOT `restRadius * inflation + wobbleDisplacement` (an earlier version of
// this comment/the catalog bound got the order of operations backwards,
// caught by external review — mesh.scale multiplies the ALREADY-displaced
// local position, it doesn't distribute over the sum). Both restRadius and
// wobbleDisplacement are still along the SAME radial direction, so they add
// correctly before that one multiply — see elements/catalog.js's
// inflatable-forms bound comment for the corrected number.

// Deforming this geometry every frame means its cached `boundingSphere`
// (whatever the renderer lazily computed against the UNDEFORMED base
// sphere, the first time it needed one) goes stale the moment wobble/
// inflation push a vertex beyond it — the renderer never recomputes it on
// its own just because positions changed. Recomputing computeBoundingSphere()
// every frame would cost the same O(vertexCount) work this loop already
// does elsewhere, but the simpler, already-established fix in this exact
// file is `frustumCulled = false` (see heroCreate/orbRebuild above) — an
// O(1) flag that just stops the renderer from trusting any bounding sphere
// for this one mesh at all, so a stale bound can never cause a wrong cull.

function formsCreate({ THREE }) {
  return createRoot(THREE);
}

function formsTopologySignature(instance, tier) {
  return `${tier}`; // fixed base sphere subdivision; inflation/wobble are update-time, not topology
}

const FORMS_BASE_RADIUS = 0.4;

function formsRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color, roughness, metalness } = instance.material;
  const segments = scaleSegments(20, tier, 8);
  const geo = new THREE.SphereGeometry(FORMS_BASE_RADIUS, segments, segments);
  const posAttr = geo.attributes.position;
  const baseDirections = new Float32Array(posAttr.count * 3);
  const baseRadii = new Float32Array(posAttr.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i += 1) {
    v.fromBufferAttribute(posAttr, i);
    const r = v.length();
    baseRadii[i] = r;
    const nx = r > 0 ? v.x / r : 0;
    const ny = r > 0 ? v.y / r : 1;
    const nz = r > 0 ? v.z / r : 0;
    baseDirections[i * 3] = nx;
    baseDirections[i * 3 + 1] = ny;
    baseDirections[i * 3 + 2] = nz;
  }
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), roughness, metalness, clearcoat: 0.6, clearcoatRoughness: 0.15,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // vertices are deformed every frame (formsAnimate) — a cached boundingSphere would go stale; see this section's header comment
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.geometry = geo;
  root.userData.baseDirections = baseDirections;
  root.userData.baseRadii = baseRadii;
  root.userData.material = mat;
  root.userData.wobbleTime = 0;
}

function formsUpdateLayout(root, instance) {
  const { mesh } = root.userData;
  if (!mesh) return;
  mesh.scale.setScalar(instance.appearance.inflation);
}

function formsUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, roughness, metalness } = instance.material;
  mat.color.set(color);
  mat.roughness = roughness;
  mat.metalness = metalness;
}

function formsApplyInstance(ctx, root, instance) {
  const sig = formsTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    formsRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  formsUpdateLayout(root, instance);
  formsUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function formsAnimate(root, instance, elapsed, dt) {
  const { geometry, baseDirections, baseRadii } = root.userData;
  if (!geometry || !baseDirections) return;
  if (!instance.motion.rotate) return; // gates BOTH the slow drift-spin and the wobble displacement
  root.userData.motion.rotation.y += instance.motion.speed * 0.15 * dt;
  root.userData.wobbleTime = (root.userData.wobbleTime || 0) + dt * instance.motion.speed;
  const t = root.userData.wobbleTime;
  const { wobble } = instance.appearance;
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const nx = baseDirections[i3];
    const ny = baseDirections[i3 + 1];
    const nz = baseDirections[i3 + 2];
    const restR = baseRadii[i];
    const wave = Math.sin(restR * 14 + t * 2.2 + i * 0.013) * wobble;
    const r = restR + wave;
    posAttr.array[i3] = nx * r;
    posAttr.array[i3 + 1] = ny * r;
    posAttr.array[i3 + 2] = nz * r;
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

// ── Mirror Fragments ─────────────────────────────────────────────────────
// 2-6 thin mirror-like shard planes, EACH sharing the group's own local
// origin (no per-shard translation — only rotation.y) so the rotation-about-
// origin invariant bounds every shard exactly regardless of fan angle. Fan
// spread/camera-facing bias/reveal stagger are all rotation-only appearance
// fields (never change shard COUNT/geometry), so — like Orb Constellation's
// cluster layout — they're applied in an UPDATE step every applyInstance
// call, not gated behind the topology signature.

function mirrorCreate({ THREE }) {
  return createRoot(THREE);
}

function mirrorTopologySignature(instance) {
  return `${instance.appearance.count}`; // fixed unsubdivided shard plane — tier irrelevant, same precedent as gel-panels/floating-media-frame
}

function mirrorRebuild({ THREE }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { count } = instance.appearance;
  const { color, metalness, roughness } = instance.material;
  const geo = new THREE.PlaneGeometry(0.35, 0.55);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), metalness, roughness, side: THREE.DoubleSide,
  });
  const shards = [];
  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(geo, mat);
    motion.add(mesh);
    shards.push(mesh);
  }
  motion.userData.shards = shards;
  root.userData.geometry = geo;
  root.userData.material = mat;
}

function mirrorUpdateLayout(root, instance) {
  const shards = root.userData.motion.userData.shards;
  if (!shards) return;
  const { count, spread, cameraFacingBias } = instance.appearance;
  const step = count > 1 ? spread / (count - 1) : 0;
  const start = -spread / 2;
  shards.forEach((mesh, i) => {
    const fanAngleDeg = start + i * step;
    mesh.rotation.y = fanAngleDeg * DEG * (1 - cameraFacingBias);
  });
}

function mirrorUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, metalness, roughness } = instance.material;
  mat.color.set(color);
  mat.metalness = metalness;
  mat.roughness = roughness;
}

function mirrorApplyInstance(ctx, root, instance) {
  const sig = mirrorTopologySignature(instance);
  if (root.userData.topologySignature !== sig) {
    mirrorRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  mirrorUpdateLayout(root, instance);
  mirrorUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function mirrorAnimate(root, instance, elapsed) {
  if (!instance.motion.rotate) return;
  const speed = instance.motion.speed;
  const stagger = instance.appearance.stagger;
  const shards = root.userData.motion.userData.shards || [];
  shards.forEach((mesh, i) => {
    const phase = i * stagger * 0.6;
    mesh.rotation.z = Math.sin(elapsed * speed + phase) * 0.12;
  });
}

// ── Logo Sculpture ───────────────────────────────────────────────────────
// A single procedural abstract emblem silhouette (a symmetric rounded
// blade/petal THREE.Shape, NOT a real uploaded logo/SVG — wiring a client's
// actual brand mark is later-phase work, same "placeholder, not the real
// asset" precedent as Floating Media Frame's content pane), extruded with a
// bevel. "Plinth placement" folds into this element's own centered,
// foreground-anchored transform rather than a literal separate offset
// plinth mesh — a pragmatic simplification, same category as Prismatic
// Slab's edgeGlow standing in for a literal rim-light mesh. Unlike Gel
// Panels/Mirror Fragments, curveSegments/bevelSegments here DO genuinely
// scale the vertex count with tier, so tier correctly stays IN this
// signature alongside the two shape fields that also change geometry.

function sculptureCreate({ THREE }) {
  return createRoot(THREE);
}

function sculptureTopologySignature(instance, tier) {
  return `${instance.appearance.depth}:${instance.appearance.bevel}:${tier}`;
}

function buildEmblemShape(THREE) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.42);
  shape.quadraticCurveTo(0.22, 0.42, 0.16, 0.1);
  shape.lineTo(0.1, -0.3);
  shape.quadraticCurveTo(0.08, -0.42, 0, -0.42);
  shape.quadraticCurveTo(-0.08, -0.42, -0.1, -0.3);
  shape.lineTo(-0.16, 0.1);
  shape.quadraticCurveTo(-0.22, 0.42, 0, 0.42);
  return shape;
}

function sculptureRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { depth, bevel } = instance.appearance;
  const { tint, metalness, roughness, edgeGlow } = instance.material;
  const shape = buildEmblemShape(THREE);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: scaleSegments(4, tier, 1), curveSegments: scaleSegments(12, tier, 4), steps: 1,
  });
  geo.center();
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint), metalness, roughness, clearcoat: 0.3,
    emissive: new THREE.Color(tint), emissiveIntensity: edgeGlow,
  });
  motion.add(new THREE.Mesh(geo, mat));
  root.userData.material = mat;
}

function sculptureUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { tint, metalness, roughness, edgeGlow } = instance.material;
  mat.color.set(tint);
  mat.emissive.set(tint);
  mat.metalness = metalness;
  mat.roughness = roughness;
  mat.emissiveIntensity = edgeGlow;
}

function sculptureApplyInstance(ctx, root, instance) {
  const sig = sculptureTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    sculptureRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  sculptureUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function sculptureAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return;
  root.userData.motion.rotation.y += instance.motion.speed * 0.3 * dt;
}

// ── Phase 4 — Architectural pack ────────────────────────────────────────
// Same procedural THREE.MeshPhysicalMaterial/MeshStandardMaterial vocabulary
// as every prior pack — no new rendering technique. Translucent Monoliths
// and Floating Media Frames (docs/plans "Element library" #12-13) already
// shipped in Phase 2; this pack implements the remaining four (#14-17).
// Every bound below was independently MEASURED by running the real factory
// (create -> applyInstance -> many animate() frames at the catalog maxima,
// reading actual rendered vertex/instance positions) rather than hand-
// derived only — the discipline this exact codebase's own external review
// made mandatory after catching an order-of-operations bound bug in
// Inflatable Forms (previous pack).

// ── Light Tubes ──────────────────────────────────────────────────────────
// A thin glowing TubeGeometry along a fixed CatmullRomCurve3 path — same
// path-construction idiom as Chrome Ribbon (a circular cross-section here,
// not a flat ribbon), self-illuminated via emissive intensity (which feeds
// the existing post-processing bloom pass — no separate "bloom" control or
// literal PointLight added, same edgeGlow-stands-in-for-a-rim-light
// simplification precedent as Prismatic Slab). `curl` genuinely reshapes
// the path (a real topology field, like Chrome Ribbon's `twists`); tier
// genuinely scales tubularSegments/radialSegments — both correctly belong
// in this type's topology signature.

function tubeCreate({ THREE }) {
  return createRoot(THREE);
}

function tubeTopologySignature(instance, tier) {
  return `${instance.appearance.curl}:${tier}`;
}

const TUBE_RADIUS = 0.025;

function tubeRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { curl } = instance.appearance;
  const { color, intensity } = instance.material;
  const tubularSegments = scaleSegments(80, tier, 16);
  const radialSegments = scaleSegments(10, tier, 5);
  const length = 1.5;
  const N = 32;
  const points = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const x = (t - 0.5) * length;
    const y = Math.sin(t * Math.PI * 2 * curl) * 0.26;
    const z = Math.cos(t * Math.PI * 2 * curl) * 0.1;
    points.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubularSegments, TUBE_RADIUS, radialSegments, false);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0,
  });
  motion.add(new THREE.Mesh(geo, mat));
  root.userData.material = mat;
  root.userData.flickerTime = 0;
}

function tubeUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, intensity } = instance.material;
  mat.color.set(color);
  mat.emissive.set(color);
  mat.emissiveIntensity = intensity;
}

function tubeApplyInstance(ctx, root, instance) {
  const sig = tubeTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    tubeRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  tubeUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function tubeAnimate(root, instance, elapsed, dt) {
  const mat = root.userData.material;
  if (!mat) return;
  if (!instance.motion.rotate) return; // "LIT" off — freeze exactly where it is
  root.userData.flickerTime = (root.userData.flickerTime || 0) + dt * instance.motion.speed;
  const t = root.userData.flickerTime;
  const { intensity, flicker } = instance.material;
  // Deterministic (index-free — a single tube has one material) pseudo-flicker: two
  // mismatched sine frequencies summed, never a pure single-frequency pulse.
  const jitter = (Math.sin(t * 9.7) * 0.6 + Math.sin(t * 23.3) * 0.4) * flicker;
  mat.emissiveIntensity = Math.max(0, intensity + jitter);
  root.userData.motion.rotation.z = Math.sin(t * 0.3) * 0.05;
}

// ── Wireframe Sculpture ──────────────────────────────────────────────────
// EdgesGeometry(IcosahedronGeometry(radius, detail)) extracts the unique
// edge list of a geodesic polyhedron — every vertex, at every `detail`
// level, sits EXACTLY on the sphere of the given radius (three.js's
// PolyhedronGeometry normalizes subdivided vertices onto that sphere; this
// is how a subdivided icosahedron becomes a geodesic sphere approximation
// at all), so an edge's two ENDPOINTS are always exactly `radius` from the
// origin — an exact bound component, not approximate. Each edge becomes one
// instance of a shared unit CylinderGeometry (a real 3D strut, not a GPU
// line — "no new rendering technique," and reads more like an actual
// sculptural wireframe than a flat screen-space line would); `thickness`
// scales each instance's cross-section (X/Z) only, never geometry, so it's
// an UPDATE field like Orb Constellation's sizeVariance — only `detail`
// (edge count) and tier (which also scales the strut's own radial segment
// count) are real topology fields. Reveal-scan uses instanceColor (same
// established idiom as Homepage Particle Hero/Orb Constellation) to sweep
// a soft highlight band across the struts by their precomputed midpoint
// height, deterministically over time — never Math.random().

function wireCreate({ THREE }) {
  return createRoot(THREE);
}

function wireTopologySignature(instance, tier) {
  return `${instance.appearance.detail}:${tier}`;
}

const WIRE_RADIUS = 0.5;

function wireRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { detail } = instance.appearance;
  const { color, opacity } = instance.material;
  const base = new THREE.IcosahedronGeometry(WIRE_RADIUS, detail);
  const edges = new THREE.EdgesGeometry(base);
  base.dispose();
  const posAttr = edges.attributes.position;
  const edgeCount = posAttr.count / 2;
  const radialSegments = scaleSegments(6, tier, 4);
  const strutGeo = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 0.6,
    transparent: true, opacity, roughness: 0.4, side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(strutGeo, mat, edgeCount);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(edgeCount * 3), 3);
  mesh.frustumCulled = false; // instance transforms/colors are rewritten every applyInstance/animate — same reasoning as Inflatable Forms' deforming mesh
  motion.add(mesh);
  edges.dispose();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  const dummy = new THREE.Object3D();
  const sweepCoords = new Float32Array(edgeCount);
  let minY = Infinity;
  let maxY = -Infinity;
  const lengths = new Float32Array(edgeCount);
  const positions = new Float32Array(edgeCount * 3);
  const quats = new Array(edgeCount);
  for (let i = 0; i < edgeCount; i += 1) {
    a.fromBufferAttribute(posAttr, i * 2);
    b.fromBufferAttribute(posAttr, i * 2 + 1);
    mid.addVectors(a, b).multiplyScalar(0.5);
    dir.subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    quat.setFromUnitVectors(up, dir);
    lengths[i] = len;
    positions[i * 3] = mid.x;
    positions[i * 3 + 1] = mid.y;
    positions[i * 3 + 2] = mid.z;
    quats[i] = quat.clone();
    if (mid.y < minY) minY = mid.y;
    if (mid.y > maxY) maxY = mid.y;
  }
  const ySpan = Math.max(1e-6, maxY - minY);
  for (let i = 0; i < edgeCount; i += 1) {
    sweepCoords[i] = (positions[i * 3 + 1] - minY) / ySpan;
  }

  root.userData.mesh = mesh;
  root.userData.dummy = dummy;
  root.userData.edgeCount = edgeCount;
  root.userData.edgeLengths = lengths;
  root.userData.edgePositions = positions;
  root.userData.edgeQuats = quats;
  root.userData.sweepCoords = sweepCoords;
  root.userData.material = mat;
  root.userData.scanColor = new THREE.Color(); // reused every animate() frame — animate() has no `ctx`/THREE of its own, same precedent as heroAnimate's cached root.userData.color
  root.userData.scanTime = 0;
}

function wireUpdateLayout(root, instance) {
  const { mesh, dummy, edgeCount, edgeLengths, edgePositions, edgeQuats } = root.userData;
  if (!mesh || !dummy) return;
  const { thickness } = instance.appearance;
  for (let i = 0; i < edgeCount; i += 1) {
    dummy.position.set(edgePositions[i * 3], edgePositions[i * 3 + 1], edgePositions[i * 3 + 2]);
    dummy.quaternion.copy(edgeQuats[i]);
    dummy.scale.set(thickness, edgeLengths[i], thickness);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function wireUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, opacity } = instance.material;
  mat.color.set(color);
  mat.emissive.set(color);
  mat.opacity = opacity;
}

function wireApplyInstance(ctx, root, instance) {
  const sig = wireTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    wireRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  wireUpdateLayout(root, instance);
  wireUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

const WIRE_SCAN_BAND = 0.22;

function wireAnimate(root, instance, elapsed, dt) {
  const { mesh, edgeCount, sweepCoords, scanColor } = root.userData;
  if (!mesh || !sweepCoords) return;
  if (!instance.motion.rotate) return; // "SCAN" off — freeze exactly where it is
  root.userData.scanTime = (root.userData.scanTime || 0) + dt * instance.motion.speed;
  root.userData.motion.rotation.y = root.userData.scanTime * 0.15;
  const scanT = (root.userData.scanTime * 0.25) % 1.2 - 0.1; // sweeps past both ends so every strut fully lights and fully dims
  for (let i = 0; i < edgeCount; i += 1) {
    const d = Math.abs(sweepCoords[i] - scanT);
    const lit = Math.max(0, 1 - d / WIRE_SCAN_BAND);
    const level = 0.35 + lit * 1.4;
    scanColor.copy(mesh.material.color).multiplyScalar(level); // one reused scratch Color, not a fresh allocation per strut per frame
    mesh.setColorAt(i, scanColor);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ── Portal Plane ─────────────────────────────────────────────────────────
// A luminous ring (TorusGeometry, "circle" collapsed from the plan's
// circle/pill/arch/slit variant list to ONE canonical shape — same
// simplification precedent as every prior pack's single-canonical-shape
// types) plus a translucent inner disc using the SAME placeholder radial-
// gradient DataTexture idiom as Floating Media Frame's content pane
// (openly a placeholder, not real "interior texture" content — later-phase
// work, same disclosure). "Open/close" is a real per-frame animation
// (motion-driven pulse of the inner disc's scale/opacity), not a static
// field. Fixed shape (no appearance field changes ring/disc dimensions) —
// tier is the only real topology field (tubularSegments).

function makeRadialGradientTexture(THREE) {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist;
      const a = Math.max(0, 1 - dist);
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function portalCreate({ THREE }) {
  return createRoot(THREE);
}

function portalTopologySignature(instance, tier) {
  return `${tier}`;
}

// Sized as a HALO around the cloth sheet, not a small disc behind it — the
// sheet's own largest half-extent (CLOTH_ASPECTS.landscape, ClothStudio.jsx)
// is 0.86, so a ring at 0.5 sat entirely hidden behind the opaque sheet at
// the centered/intentional-overlap default (caught live in the browser: the
// ring was completely invisible, zoomed in, at any position on the sheet —
// not a rendering bug, a scale mistake). 1.05 (+0.04 tube = 1.09 outer)
// comfortably exceeds the sheet on every axis in every format, the same
// "visibly wraps/pokes out around the artwork" relationship Kinetic Rings
// (halo outer ~1.135) and Homepage Particle Hero already establish.
const PORTAL_RING_RADIUS = 1.05;
const PORTAL_TUBE_RADIUS = 0.04;

function portalRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color, rimIntensity, interiorOpacity } = instance.material;
  const tubularSegments = scaleSegments(48, tier, 16);
  const radialSegments = scaleSegments(12, tier, 6);
  const ringGeo = new THREE.TorusGeometry(PORTAL_RING_RADIUS, PORTAL_TUBE_RADIUS, radialSegments, tubularSegments);
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: rimIntensity, roughness: 0.3,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  motion.add(ringMesh);

  const discGeo = new THREE.CircleGeometry(PORTAL_RING_RADIUS - PORTAL_TUBE_RADIUS, scaleSegments(32, tier, 12));
  const discMat = new THREE.MeshBasicMaterial({
    map: makeRadialGradientTexture(THREE), color: new THREE.Color(color), transparent: true, opacity: interiorOpacity, side: THREE.DoubleSide,
  });
  const discMesh = new THREE.Mesh(discGeo, discMat);
  discMesh.position.z = 0.002;
  motion.add(discMesh);

  root.userData.ringMaterial = ringMat;
  root.userData.discMaterial = discMat;
  root.userData.discMesh = discMesh;
  root.userData.pulseTime = 0;
}

function portalUpdateMaterial(root, instance) {
  const { ringMaterial, discMaterial } = root.userData;
  const { color, rimIntensity, interiorOpacity } = instance.material;
  if (ringMaterial) { ringMaterial.color.set(color); ringMaterial.emissive.set(color); ringMaterial.emissiveIntensity = rimIntensity; }
  if (discMaterial) { discMaterial.color.set(color); discMaterial.opacity = interiorOpacity; }
}

function portalApplyInstance(ctx, root, instance) {
  const sig = portalTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    portalRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  portalUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function portalAnimate(root, instance, elapsed, dt) {
  const { discMesh, discMaterial } = root.userData;
  if (!discMesh || !discMaterial) return;
  if (!instance.motion.rotate) return; // "PULSE" off — freeze exactly where it is
  root.userData.pulseTime = (root.userData.pulseTime || 0) + dt * instance.motion.speed;
  const { pulseDepth } = instance.appearance;
  const { interiorOpacity } = instance.material;
  const wave = (Math.sin(root.userData.pulseTime * 1.4) + 1) / 2; // 0..1
  const scale = 1 - pulseDepth * 0.25 * wave;
  discMesh.scale.set(scale, scale, 1);
  discMaterial.opacity = interiorOpacity * (0.6 + 0.4 * wave);
}

// ── Cloth Banners ────────────────────────────────────────────────────────
// A tall, borderless PlaneGeometry panel with the SAME placeholder-gradient
// print texture as Floating Media Frame's content pane (explicitly not the
// real uploaded artwork — later-phase work, same disclosure). Wind sway is
// a per-vertex X displacement (cached base positions, same never-
// compounding idiom as Iridescent Film/Inflatable Forms) that INCREASES
// with distance from the pinned top edge — the top row (vertexY at its
// maximum) never moves, matching a real hanging banner pinned only at its
// top. `weight` inversely dampens the sway amplitude (heavier fabric swings
// less); geometry itself never depends on either appearance field, only on
// tier (subdivision needed for a convincing sway curve) — both are UPDATE-
// time inputs to animate(), not topology.
//
// CORRECTED (external review): this factory deforms geometry every frame
// exactly like Inflatable Forms/Wireframe Sculpture, but the fix applied to
// those two (mesh.frustumCulled = false, so a cached-and-then-stale
// boundingSphere can never cause a wrong cull near a frame edge) was missed
// here in the first pass — an oversight, not a different situation. Now
// applied identically in bannerRebuild.

function bannerCreate({ THREE }) {
  return createRoot(THREE);
}

function bannerTopologySignature(instance, tier) {
  return `${tier}`;
}

const BANNER_WIDTH = 0.5;
const BANNER_HEIGHT = 1.1;

function bannerRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color, opacity } = instance.material;
  const wSeg = scaleSegments(6, tier, 3);
  const hSeg = scaleSegments(18, tier, 8);
  const geo = new THREE.PlaneGeometry(BANNER_WIDTH, BANNER_HEIGHT, wSeg, hSeg);
  const basePositions = Float32Array.from(geo.attributes.position.array);
  const topY = BANNER_HEIGHT / 2;
  const mat = new THREE.MeshPhysicalMaterial({
    map: makePlaceholderTexture(THREE), color: new THREE.Color(color), transmission: 0.15, thickness: 0.02,
    roughness: 0.6, transparent: true, opacity, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // vertices are deformed every frame (bannerAnimate) — a cached boundingSphere would go stale; same fix/reasoning as Inflatable Forms and Wireframe Sculpture
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.geometry = geo;
  root.userData.basePositions = basePositions;
  root.userData.topY = topY;
  root.userData.material = mat;
  root.userData.windTime = 0;
}

function bannerUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, opacity } = instance.material;
  mat.color.set(color);
  mat.opacity = opacity;
}

function bannerApplyInstance(ctx, root, instance) {
  const sig = bannerTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    bannerRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  bannerUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function bannerAnimate(root, instance, elapsed, dt) {
  const { geometry, basePositions, topY } = root.userData;
  if (!geometry || !basePositions) return;
  if (!instance.motion.rotate) return; // "WIND" off — freeze exactly where it is
  root.userData.windTime = (root.userData.windTime || 0) + dt * instance.motion.speed;
  const t = root.userData.windTime;
  const { weight, windStrength } = instance.appearance;
  const damp = 1 / Math.max(0.3, weight);
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const x = basePositions[i3];
    const y = basePositions[i3 + 1];
    const distFromPin = Math.max(0, topY - y);
    const sway = Math.sin(y * 4 + t * 1.8) * windStrength * damp * (distFromPin / BANNER_HEIGHT);
    posAttr.array[i3] = x + sway;
    posAttr.array[i3 + 1] = y;
    posAttr.array[i3 + 2] = basePositions[i3 + 2];
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

// ── Phase 4 — Atmospheric/Surface pack ──────────────────────────────────
// Same procedural THREE.MeshPhysicalMaterial/MeshStandardMaterial/
// MeshBasicMaterial vocabulary as every prior pack — no custom shaders, no
// new rendering technique. Every bound below was independently MEASURED by
// running the real factory (create -> applyInstance -> many animate()
// frames at the catalog maxima, reading actual rendered vertex/instance
// positions), and any mesh whose geometry/instances are rewritten every
// frame gets `frustumCulled = false` applied proactively at build time —
// both disciplines this exact codebase's own external review made
// mandatory after catching, respectively, an order-of-operations bound bug
// (Inflatable Forms) and a missed culling fix (Cloth Banners) in the two
// prior packs.

// ── Particle Ribbon ──────────────────────────────────────────────────────
// An InstancedMesh of small dots flowing along a FIXED sine-wave path (same
// path formula as Chrome Ribbon/Light Tubes — not a separately-authored
// shape; "path" per the plan is not exposed as its own control here, same
// fixed-structural-shape precedent as Cloth Banners' pin points). Each
// particle's position along the path is `t_i(elapsed) = frac(i/count +
// elapsed*speed)` — a continuous, deterministic index-based cycle (same
// "index-based, not Math.random()" idiom as every other instanced type),
// so particles perpetually stream from one end to the other and wrap.
// `fade` is realized as `sin(t*PI)` — an exact bump shape that is 0 at
// both t=0/t=1 (the stream's ends) and 1 at t=0.5 (the middle) with NO
// extra parameters needed — multiplied directly into each particle's
// render scale, so particles visibly fade in as they enter and fade out
// as they approach the far end before wrapping back to the start.

function ribbonParticlesCreate({ THREE }) {
  return createRoot(THREE);
}

function ribbonParticlesTopologySignature(instance, tier) {
  return `${instance.appearance.count}:${tier}`;
}

const PARTICLE_RIBBON_PATH_LENGTH = 1.5;
const PARTICLE_RIBBON_PATH_Y = 0.26;
const PARTICLE_RIBBON_PATH_Z = 0.1;

function ribbonParticlePathPoint(t, out) {
  const x = (t - 0.5) * PARTICLE_RIBBON_PATH_LENGTH;
  const y = Math.sin(t * Math.PI * 2 * 2) * PARTICLE_RIBBON_PATH_Y; // fixed 2-cycle wave — same shape family as chrome-ribbon at twists=2
  const z = Math.cos(t * Math.PI * 2 * 2) * PARTICLE_RIBBON_PATH_Z;
  out.set(x, y, z);
  return out;
}

function ribbonParticlesRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color } = instance.material;
  const { count } = instance.appearance;
  const segments = scaleSegments(8, tier, 4);
  const geo = new THREE.IcosahedronGeometry(1, Math.max(0, segments - 6)); // cheap low-poly dot, same idiom as homepage-particle-hero
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false; // instance transforms are rewritten every frame — see this pack's own header comment
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.material = mat;
  root.userData.dummy = new THREE.Object3D();
  root.userData.point = new THREE.Vector3();
  root.userData.color = new THREE.Color();
  root.userData.flowTime = 0;
  // THREE.InstancedMesh initializes every instance's matrix to IDENTITY
  // (verified directly, not assumed) — left untouched, that's a `count`-
  // fold stack of FULL-SIZE (scale 1, the unit icosahedron's own radius)
  // dots sitting exactly at the origin, not a distributed particle stream.
  // Every other instanced type in this file (Orb Constellation, Wireframe
  // Sculpture) calls its own layout function once during applyInstance so
  // a fresh build is never left in that raw default state — do the same
  // here rather than relying on the FIRST animate() frame to fix it, since
  // an element added while motion.rotate is off (or simply the one frame
  // before animate() first runs) would otherwise render wrong.
  ribbonParticlesUpdateLayout(root, instance, 0);
}

function ribbonParticlesUpdateLayout(root, instance, flowTime) {
  const { mesh, dummy, point, color } = root.userData;
  if (!mesh || !dummy) return;
  const { count, turbulence, trailWidth } = instance.appearance;
  for (let i = 0; i < count; i += 1) {
    const t = ((i / count + flowTime * 0.2) % 1 + 1) % 1;
    ribbonParticlePathPoint(t, point);
    const jitterPhase = i * 0.37;
    point.y += Math.sin(t * 11 + flowTime * 3 + jitterPhase) * turbulence * 0.06;
    point.z += Math.cos(t * 9 + flowTime * 2.4 + jitterPhase) * turbulence * 0.06;
    const fade = Math.sin(t * Math.PI);
    dummy.position.copy(point);
    dummy.scale.setScalar(trailWidth * Math.max(0.05, fade));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.copy(mesh.material.color).multiplyScalar(0.5 + fade * 0.8);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function ribbonParticlesUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.color.set(instance.material.color);
}

function ribbonParticlesApplyInstance(ctx, root, instance) {
  const sig = ribbonParticlesTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    ribbonParticlesRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  ribbonParticlesUpdateMaterial(root, instance);
  // CORRECTED (external review): per-instance colors are derived from
  // `mesh.material.color` (see ribbonParticlesUpdateLayout below) at
  // whatever moment the layout function last ran — previously that was
  // ONLY inside animate(), which early-returns when FLOW is off, so a
  // color edit while paused updated the shared material tint but left
  // every per-instance color buffer stale (still baked from the OLD
  // color), producing an incorrect multiplicative blend. Re-running the
  // SAME layout function here (at the current, un-advanced flowTime — this
  // does not restart or skip the flow) keeps positions/scale exactly where
  // they were while refreshing colors against the just-updated material.
  ribbonParticlesUpdateLayout(root, instance, root.userData.flowTime || 0);
  applyTransform(root, instance);
}

function ribbonParticlesAnimate(root, instance, elapsed, dt) {
  const { mesh, dummy } = root.userData;
  if (!mesh || !dummy) return;
  if (!instance.motion.rotate) return; // "FLOW" off — freeze exactly where it is
  root.userData.flowTime = (root.userData.flowTime || 0) + dt * instance.motion.speed;
  ribbonParticlesUpdateLayout(root, instance, root.userData.flowTime);
}

// ── Caustic Water Light ──────────────────────────────────────────────────
// A camera-facing glowing disc (NOT a literal horizontal floor pool — this
// Studio's fixed frontal camera, placement.js CAMERA_Z, has no downward
// tilt, so a flat horizontal plane would render almost perfectly edge-on
// and be effectively invisible; a lesson learned live in THIS pack's own
// Portal Plane round, applied proactively here rather than repeated) with
// an ANIMATED procedural texture — the first animated (not build-once)
// DataTexture in this file, still just texel math (no shader code, "no new
// rendering technique" in spirit: the same category as per-vertex
// animation, applied to texture texels instead). The pattern sums two
// sine-wave grids at different angles/frequencies, offset over time — the
// classic cheap caustic approximation. Kept SMALL (32x32) so the per-frame
// texel loop is trivial; the GPU's own bilinear filtering when upscaling
// onto the disc produces the soft blur real caustics have anyway.
// `direction` rotates the two sine grids' shared axis, standing in for
// "light direction" — a real, controllable effect without a literal light.
// Fixed disc geometry (no vertex animation at all) — the SAFEST bound of
// this pack, exact from `computeBoundingSphere()`, no measurement risk.

const CAUSTIC_TEXTURE_SIZE = 32;
const CAUSTIC_DISC_RADIUS = 0.55;

function makeCausticTexture(THREE) {
  const data = new Uint8Array(CAUSTIC_TEXTURE_SIZE * CAUSTIC_TEXTURE_SIZE * 4);
  const tex = new THREE.DataTexture(data, CAUSTIC_TEXTURE_SIZE, CAUSTIC_TEXTURE_SIZE, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// CORRECTED (external review): `scale` previously only multiplied the TIME
// term fed into this function (`causticTime * scale`), never the spatial
// frequencies — at the paused initial frame (causticTime=0), that made
// `0 * scale === 0` regardless of scale's actual value, so Pattern Scale
// had literally zero effect on the very first (or any paused) render. Now
// `scale` genuinely multiplies the spatial frequencies (`ru`/`rv`'s own
// wave-argument coefficients), independent of `t` (which stays SPEED's
// own concern, never coupled to scale) — a real, always-effective spatial
// control, not a time-modulation proxy for one.
function updateCausticTexture(tex, t, contrast, directionRad, scale) {
  const size = CAUSTIC_TEXTURE_SIZE;
  const data = tex.image.data;
  const cos = Math.cos(directionRad);
  const sin = Math.sin(directionRad);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / (size - 1)) * 2 - 1;
      const v = (y / (size - 1)) * 2 - 1;
      const ru = u * cos - v * sin;
      const rv = u * sin + v * cos;
      const wave1 = Math.sin(ru * 9 * scale + t * 1.3);
      const wave2 = Math.sin(rv * 7 * scale - t * 1.7 + ru * 3 * scale);
      const combined = (wave1 + wave2) / 2; // -1..1
      const shaped = Math.pow(Math.max(0, combined), Math.max(0.2, 3 - contrast * 2)); // higher contrast -> sharper bright bands
      const dist = Math.sqrt(u * u + v * v);
      const edgeFade = Math.max(0, 1 - dist);
      const i = (y * size + x) * 4;
      const a = Math.round(255 * shaped * edgeFade);
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }
  tex.needsUpdate = true;
}

function causticCreate({ THREE }) {
  return createRoot(THREE);
}

function causticTopologySignature(instance, tier) {
  return `${tier}`; // fixed disc — contrast/scale/direction are animate()/texture-time inputs, never geometry
}

function causticRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color } = instance.material;
  const segments = scaleSegments(48, tier, 16);
  const geo = new THREE.CircleGeometry(CAUSTIC_DISC_RADIUS, segments);
  const tex = makeCausticTexture(THREE);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(color), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.material = mat;
  root.userData.texture = tex;
  root.userData.causticTime = 0;
}

function causticUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.color.set(instance.material.color);
}

function causticApplyInstance(ctx, root, instance) {
  const sig = causticTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    causticRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  causticUpdateMaterial(root, instance);
  applyTransform(root, instance);
  // The texture must reflect the CURRENT appearance even while paused
  // (motion.rotate=false) — unlike per-frame-only animation, a static
  // caustic frame is still a meaningful state to render, so this runs on
  // every applyInstance call, not gated behind animate().
  const { scale, contrast, direction } = instance.appearance;
  updateCausticTexture(root.userData.texture, root.userData.causticTime, contrast, (direction * Math.PI) / 180, scale);
}

function causticAnimate(root, instance, elapsed, dt) {
  const { texture } = root.userData;
  if (!texture) return;
  if (!instance.motion.rotate) return; // "RIPPLE" off — freeze the current pattern exactly where it is
  root.userData.causticTime = (root.userData.causticTime || 0) + dt * instance.motion.speed;
  const { scale, contrast, direction } = instance.appearance;
  updateCausticTexture(texture, root.userData.causticTime, contrast, (direction * Math.PI) / 180, scale);
}

// ── Volumetric Light Cone ────────────────────────────────────────────────
// A tapered, open-ended CylinderGeometry beam with an additive transparent
// material — self-illuminated (no real THREE.Light added — same "reads as
// light without a literal scene light" precedent as Light Tubes/Portal
// Plane/Caustic Water Light). `angle`/`length` genuinely resize the cone
// (real topology fields); `noise` is a deterministic multi-frequency
// opacity flicker (not a per-vertex geometry perturbation — kept simple
// and bounded, avoiding a new measurement-risk axis for this element);
// "target tracking" is realized as a slow, bounded sweep of the whole
// motion group's rotation (same idea as Mirror Fragments' camera-facing
// bias, a believable stand-in for tracking without literal target logic).

function coneCreate({ THREE }) {
  return createRoot(THREE);
}

function coneTopologySignature(instance, tier) {
  return `${instance.appearance.angle}:${instance.appearance.length}:${tier}`;
}

function coneRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { angle, length } = instance.appearance;
  const { color, density } = instance.material;
  const radialSegments = scaleSegments(24, tier, 10);
  const topRadius = 0.01;
  const bottomRadius = Math.tan((angle * Math.PI) / 180 / 2) * length;
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, length, radialSegments, 1, true);
  geo.translate(0, -length / 2, 0); // apex at local origin, cone opens downward along -Y
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color), transparent: true, opacity: density, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  motion.add(mesh);
  root.userData.material = mat;
  root.userData.noiseTime = 0;
}

// CORRECTED (external review): this previously only cached the new density
// in root.userData.baseDensity, never assigning it to mat.opacity — opacity
// was set ONLY inside coneAnimate, which early-returns when SWEEP is off,
// so a density change while paused had no visible effect at all. Now
// applies the base density directly here (every applyInstance call), so a
// paused cone always reflects the current DENSITY slider; coneAnimate's
// flicker still layers a bounded perturbation on top of this same base
// value whenever it actually runs.
function coneUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.color.set(instance.material.color);
  root.userData.baseDensity = instance.material.density;
  mat.opacity = instance.material.density;
}

function coneApplyInstance(ctx, root, instance) {
  const sig = coneTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    coneRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  coneUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function coneAnimate(root, instance, elapsed, dt) {
  const mat = root.userData.material;
  if (!mat) return;
  if (!instance.motion.rotate) return; // "SWEEP" off — freeze exactly where it is
  root.userData.noiseTime = (root.userData.noiseTime || 0) + dt * instance.motion.speed;
  const t = root.userData.noiseTime;
  const { noise } = instance.appearance;
  const baseDensity = root.userData.baseDensity ?? instance.material.density;
  const flicker = (Math.sin(t * 4.1) * 0.6 + Math.sin(t * 10.7) * 0.4) * noise * 0.3;
  mat.opacity = Math.max(0, Math.min(1, baseDensity + flicker));
  root.userData.motion.rotation.z = Math.sin(t * 0.25) * 0.12;
  root.userData.motion.rotation.x = Math.sin(t * 0.17) * 0.08;
}

// ── Topographic Floor ────────────────────────────────────────────────────
// A camera-facing (not literal-horizontal-floor — same visibility reasoning
// as Caustic Water Light above) subdivided PlaneGeometry, tilted by a FIXED
// structural rotation (TOPO_TILT_RAD, not exposed as a control — same
// "fixed structural, not a user field" precedent as Cloth Banners' pin
// points/Logo Sculpture's plinth) so it reads as rising terrain with real
// depth cues rather than a flat wall. Per-vertex Z-displacement (cached
// base positions, never compounding — same idiom as Iridescent Film/
// Inflatable Forms/Cloth Banners) forms the "dunes/waves" read; falloff
// toward the CENTER (so the terrain never visually collides with the
// artwork sheet it sits behind) is a fixed radial mask, not a user field —
// "falloff around the subject" in the plan describes fixed, correct
// behavior, not a tunable.

function terrainCreate({ THREE }) {
  return createRoot(THREE);
}

function terrainTopologySignature(instance, tier) {
  return `${tier}`;
}

const TERRAIN_WIDTH = 1.6;
const TERRAIN_HEIGHT = 1;
const TOPO_TILT_RAD = (55 * Math.PI) / 180;

function terrainRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color, roughness } = instance.material;
  const wSeg = scaleSegments(24, tier, 10);
  const hSeg = scaleSegments(16, tier, 8);
  const geo = new THREE.PlaneGeometry(TERRAIN_WIDTH, TERRAIN_HEIGHT, wSeg, hSeg);
  const basePositions = Float32Array.from(geo.attributes.position.array);
  const falloff = new Float32Array(basePositions.length / 3);
  const halfDiag = Math.sqrt((TERRAIN_WIDTH / 2) ** 2 + (TERRAIN_HEIGHT / 2) ** 2);
  for (let i = 0; i < falloff.length; i += 1) {
    const x = basePositions[i * 3];
    const y = basePositions[i * 3 + 1];
    const dist = Math.sqrt(x * x + y * y) / halfDiag; // 0 at center, ~1 at corners
    falloff[i] = Math.min(1, dist * 1.4); // ramps to full amplitude before the true corner, never fully 0 at center — a gentle rise, not a hard cliff
  }
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = TOPO_TILT_RAD;
  mesh.frustumCulled = false; // vertices deform every frame (terrainAnimate) — see this pack's own header comment
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.geometry = geo;
  root.userData.basePositions = basePositions;
  root.userData.falloff = falloff;
  root.userData.material = mat;
  root.userData.waveTime = 0;
}

function terrainUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  mat.color.set(instance.material.color);
  mat.roughness = instance.material.roughness;
}

function terrainApplyInstance(ctx, root, instance) {
  const sig = terrainTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    terrainRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  terrainUpdateMaterial(root, instance);
  applyTransform(root, instance);
}

function terrainAnimate(root, instance, elapsed, dt) {
  const { geometry, basePositions, falloff } = root.userData;
  if (!geometry || !basePositions) return;
  if (!instance.motion.rotate) return; // "DISPLACE" off — freeze exactly where it is
  root.userData.waveTime = (root.userData.waveTime || 0) + dt * instance.motion.speed;
  const t = root.userData.waveTime;
  const { amplitude, frequency } = instance.appearance;
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const x = basePositions[i3];
    const y = basePositions[i3 + 1];
    const wave = (Math.sin(x * frequency * 4 + t) + Math.sin(y * frequency * 3 - t * 0.7)) * 0.5;
    posAttr.array[i3] = x;
    posAttr.array[i3 + 1] = y;
    posAttr.array[i3 + 2] = wave * amplitude * falloff[i];
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

// ── Phase 4 — Hero pack (final pack) ────────────────────────────────────
// Same procedural vocabulary as every prior pack — no custom shaders, no
// new rendering technique, no new dependency. Homepage Particle Hero and
// GLB Import (docs/plans "Element library" #22-23) already shipped in
// Phase 3; this pack implements the remaining three (#24-26).
//
// All three share ONE architectural lesson learned the hard way in the
// PRIOR pack (external review caught three separate paused-state bugs,
// all from the same root cause: a field's effect lived only inside
// animate(), which early-returns while paused): every field that affects
// what a PAUSED render looks like — including ones a first instinct might
// file under "animation" (per-instance position, per-instance color) — is
// computed by ONE shared `...UpdateLayout(root, instance, t)` function,
// called with `t=0` (or the cached last-known time) from applyInstance AND
// with an advancing `t` from animate(). This is Particle Ribbon's own
// fixed architecture from the prior round, reused proactively here for
// all three new types rather than risking the same bug class a third time.

// ── Metaball / Ferrofluid Bloom ──────────────────────────────────────────
// The plan's own words ("shader-driven... isosurface") describe a real
// raymarched-SDF metaball technique — genuinely a different rendering
// technique (a custom fragment shader), which this codebase's "no new
// rendering technique" rule rules out, the same way Wireframe Sculpture's
// header comment already reasoned through for GPU fat-lines. Adapted
// instead to a cluster of `count` soft, overlapping, transmission-glass
// spheres (an InstancedMesh, same idiom as Orb Constellation) whose
// positions genuinely orbit/breathe toward a shared center — real overlap
// between neighboring blobs is what reads as "merging," not true CSG/
// isosurface blending. `attraction` sets how tightly they orbit the
// center (smaller orbit radius = more overlap = a denser-looking bloom);
// `surfaceTension` narrows the per-blob size variance (real metaballs
// trend toward uniform droplet size under higher tension). "Metallic/
// glass/ink" collapses to ONE continuous material (transmission/metalness/
// roughness sliders), same "collapse a variant list to one canonical,
// continuously-parameterized look" precedent as every prior pack's
// single-shape types.

function bloomCreate({ THREE }) {
  return createRoot(THREE);
}

function bloomTopologySignature(instance, tier) {
  return `${instance.appearance.count}:${tier}`;
}

const BLOOM_ORBIT_RADIUS = 0.35; // attraction=0 -> blobs orbit at this radius from center (loosest cluster)
const BLOOM_BASE_RADIUS = 0.13;

function bloomRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color, metalness, roughness, transmission } = instance.material;
  const segments = scaleSegments(16, tier, 6);
  const geo = new THREE.SphereGeometry(1, segments, segments);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), metalness, roughness, transmission, thickness: 0.3, clearcoat: 0.4,
  });
  const { count } = instance.appearance;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false; // instance transforms/colors are rewritten every applyInstance/animate call
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.material = mat;
  root.userData.dummy = new THREE.Object3D();
  root.userData.color = new THREE.Color();
  root.userData.pulseTime = 0;
  bloomUpdateLayout(root, instance, 0);
}

function bloomUpdateLayout(root, instance, pulseTime) {
  const { mesh, dummy, color } = root.userData;
  if (!mesh || !dummy) return;
  const { count, attraction, surfaceTension } = instance.appearance;
  const orbitRadius = BLOOM_ORBIT_RADIUS * (1 - attraction * 0.7);
  for (let i = 0; i < count; i += 1) {
    const az = i * GOLDEN_ANGLE;
    const breathe = Math.sin(pulseTime * 1.6 + i * 0.9) * 0.5 + 0.5; // 0..1, per-blob phase offset
    const r = orbitRadius * (0.5 + breathe * 0.5);
    const elevation = Math.sin(i * 2.1) * 0.5; // fixed per-index vertical spread, not time-based
    const x = Math.cos(az) * r;
    const y = elevation * orbitRadius;
    const z = Math.sin(az) * r;
    const sizeFactor = 1 - surfaceTension * 0.3 * Math.sin(i * GOLDEN_ANGLE * 1.3) ** 2; // higher tension -> less per-blob size variance
    const blobRadius = BLOOM_BASE_RADIUS * Math.max(0.5, sizeFactor);
    dummy.position.set(x, y, z);
    dummy.scale.setScalar(blobRadius);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const hue = (i / count) * 0.08; // subtle per-blob color-separation drift, deterministic by index
    color.copy(mesh.material.color).offsetHSL(hue, 0, 0);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function bloomUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, metalness, roughness, transmission } = instance.material;
  mat.color.set(color);
  mat.metalness = metalness;
  mat.roughness = roughness;
  mat.transmission = transmission;
}

function bloomApplyInstance(ctx, root, instance) {
  const sig = bloomTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    bloomRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  bloomUpdateMaterial(root, instance);
  bloomUpdateLayout(root, instance, root.userData.pulseTime || 0);
  applyTransform(root, instance);
}

function bloomAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return; // "PULSE" off — freeze exactly where it is
  root.userData.pulseTime = (root.userData.pulseTime || 0) + dt * instance.motion.speed;
  bloomUpdateLayout(root, instance, root.userData.pulseTime);
  root.userData.motion.rotation.y += instance.motion.speed * 0.08 * dt;
}

// ── Kinetic Type Totem ───────────────────────────────────────────────────
// A vertical stack of `count` identical extruded, beveled abstract glyph-
// like blocks (a rounded rectangle, NOT real editable/uploaded text — the
// plan's "editable words or short phrases" would require live font-glyph
// layout, a real new asset/rendering dependency this pack's scope doesn't
// take on, same "not the literal described input, a bounded procedural
// stand-in" precedent as Logo Sculpture's own emblem). "Stack/ring/spiral/
// wall" collapses to ONE canonical arrangement (a vertical stack, reading
// most clearly as a "totem"). `count` stands in for phrase length; each
// block's own emissive glow sweeps up the stack over time with a per-
// index phase offset — the "per-letter delay" the plan describes, realized
// as light rather than motion (keeps the stack's own POSITIONS fixed and
// simple, only glow animates, matching Wireframe Sculpture's reveal-scan
// idiom applied to a stack instead of a sphere).

function totemCreate({ THREE }) {
  return createRoot(THREE);
}

function totemTopologySignature(instance, tier) {
  return `${instance.appearance.count}:${instance.appearance.depth}:${instance.appearance.bevel}:${tier}`;
}

const TOTEM_BLOCK_WIDTH = 0.3;
const TOTEM_BLOCK_HEIGHT = 0.16;
const TOTEM_SPACING = 0.2;

function buildTotemBlockShape(THREE) {
  const w = TOTEM_BLOCK_WIDTH / 2;
  const h = TOTEM_BLOCK_HEIGHT / 2;
  const r = 0.03;
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

function totemRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { depth, bevel } = instance.appearance;
  const { tint, metalness, roughness, edgeGlow } = instance.material;
  const { count } = instance.appearance;
  const shape = buildTotemBlockShape(THREE);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: scaleSegments(3, tier, 1), curveSegments: scaleSegments(6, tier, 3), steps: 1,
  });
  geo.center();
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint), metalness, roughness, clearcoat: 0.3,
    emissive: new THREE.Color(tint), emissiveIntensity: edgeGlow,
  });
  const blocks = [];
  const totalHeight = (count - 1) * TOTEM_SPACING;
  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = i * TOTEM_SPACING - totalHeight / 2;
    motion.add(mesh);
    blocks.push(mesh);
  }
  root.userData.blocks = blocks;
  root.userData.material = mat;
  root.userData.sweepTime = 0;
  totemUpdateGlow(root, instance, 0);
}

function totemUpdateGlow(root, instance, sweepTime) {
  const { blocks, material } = root.userData;
  if (!blocks || !material) return;
  const { count } = instance.appearance;
  const { edgeGlow } = instance.material;
  // The shared material's OWN emissiveIntensity carries the base edgeGlow
  // (set in totemUpdateMaterial); the per-block sweep is realized as a
  // per-block scale pulse instead of per-instance emissive (blocks share
  // ONE material here, unlike Orb Constellation/Metaball Bloom's
  // InstancedMesh — a plain Mesh has no per-instance color channel), so
  // "glow sweep" reads as a "block lifts and swells" wave up the totem.
  blocks.forEach((mesh, i) => {
    const phase = (i / Math.max(1, count - 1)) * Math.PI * 2;
    const wave = Math.sin(sweepTime * 1.4 - phase) * 0.5 + 0.5; // 0..1
    const lift = 1 + wave * 0.15 * (edgeGlow > 0 ? 1 : 0);
    mesh.scale.setScalar(lift);
  });
}

function totemUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { tint, metalness, roughness, edgeGlow } = instance.material;
  mat.color.set(tint);
  mat.emissive.set(tint);
  mat.metalness = metalness;
  mat.roughness = roughness;
  mat.emissiveIntensity = edgeGlow;
}

function totemApplyInstance(ctx, root, instance) {
  const sig = totemTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    totemRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  totemUpdateMaterial(root, instance);
  totemUpdateGlow(root, instance, root.userData.sweepTime || 0);
  applyTransform(root, instance);
}

function totemAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return; // "SWEEP" off — freeze exactly where it is
  root.userData.sweepTime = (root.userData.sweepTime || 0) + dt * instance.motion.speed;
  totemUpdateGlow(root, instance, root.userData.sweepTime);
  root.userData.motion.rotation.y += instance.motion.speed * 0.1 * dt;
}

// ── Echo Feedback Tunnel ─────────────────────────────────────────────────
// `count` ring echoes (InstancedMesh of a shared torus, same idiom as
// Portal Plane's ring) explicitly BOUNDED — never a literal recursive
// framebuffer feedback loop, matching the plan's own stated constraint.
// Each ring's Z position continuously flows toward the camera and wraps
// (same "flow and wrap" idiom as Particle Ribbon), simulating "camera
// travel through the tunnel" WITHOUT touching the real scene camera
// (placement.js's CAMERA_Z/FOV are explicitly fixed and out of scope for
// any element to alter). `decay` shrinks each successive echo
// exponentially by depth; `hueShift` rotates each echo's color further
// from the base the deeper it recedes — both are deterministic per-INDEX
// (not per-time) characteristics, computed in the same layout function
// that also places the time-driven Z position, so a paused tunnel still
// shows the correct decay/hue falloff, not just correct positions.

function tunnelCreate({ THREE }) {
  return createRoot(THREE);
}

function tunnelTopologySignature(instance, tier) {
  return `${instance.appearance.count}:${tier}`;
}

// Sized as a HALO around the cloth sheet, same fix (and same lesson,
// applied proactively this time before shipping rather than after a
// review caught it) as Portal Plane's own ring: the sheet's own largest
// half-extent (CLOTH_ASPECTS.landscape, ClothStudio.jsx) is 0.86, so a
// nearest ring at 0.4 would sit entirely hidden behind the opaque sheet —
// caught live in the browser (zero visible rings anywhere, at any zoom).
// 1.0/0.035 keeps the nearest (largest, undecayed) echo comfortably
// bigger than the sheet on every axis, so it visibly frames the artwork
// before smaller, receding echoes shrink back behind it.
const TUNNEL_RING_RADIUS = 1;
const TUNNEL_TUBE_RADIUS = 0.035;
const TUNNEL_DEPTH_SPAN = 1.2; // total Z distance a ring travels before wrapping

function tunnelRebuild({ THREE, tier }, root, instance) {
  const motion = root.userData.motion;
  clearGroup(motion);
  const { color } = instance.material;
  const { count } = instance.appearance;
  const tubularSegments = scaleSegments(24, tier, 10);
  const radialSegments = scaleSegments(8, tier, 4);
  const geo = new THREE.TorusGeometry(TUNNEL_RING_RADIUS, TUNNEL_TUBE_RADIUS, radialSegments, tubularSegments);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 0.7, roughness: 0.35,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false; // instance transforms/colors are rewritten every applyInstance/animate call
  motion.add(mesh);
  root.userData.mesh = mesh;
  root.userData.material = mat;
  root.userData.dummy = new THREE.Object3D();
  root.userData.color = new THREE.Color();
  root.userData.flowTime = 0;
  tunnelUpdateLayout(root, instance, 0);
}

function tunnelUpdateLayout(root, instance, flowTime) {
  const { mesh, dummy, color } = root.userData;
  if (!mesh || !dummy) return;
  const { count, decay, hueShift } = instance.appearance;
  for (let i = 0; i < count; i += 1) {
    const t = ((i / count + flowTime * 0.15) % 1 + 1) % 1; // 0 (nearest) .. 1 (farthest), flows and wraps
    const z = -t * TUNNEL_DEPTH_SPAN;
    const depthFactor = Math.pow(Math.max(0.05, decay), t * count);
    dummy.position.set(0, 0, z);
    dummy.rotation.set(0, 0, i * GOLDEN_ANGLE * 0.3);
    dummy.scale.setScalar(depthFactor);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.copy(mesh.material.color).offsetHSL(hueShift * t, 0, 0);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function tunnelUpdateMaterial(root, instance) {
  const mat = root.userData.material;
  if (!mat) return;
  const { color, rimIntensity } = instance.material;
  mat.color.set(color);
  mat.emissive.set(color);
  mat.emissiveIntensity = rimIntensity;
}

function tunnelApplyInstance(ctx, root, instance) {
  const sig = tunnelTopologySignature(instance, ctx.tier);
  if (root.userData.topologySignature !== sig) {
    tunnelRebuild(ctx, root, instance);
    root.userData.topologySignature = sig;
  }
  tunnelUpdateMaterial(root, instance);
  tunnelUpdateLayout(root, instance, root.userData.flowTime || 0);
  applyTransform(root, instance);
}

function tunnelAnimate(root, instance, elapsed, dt) {
  if (!instance.motion.rotate) return; // "TRAVEL" off — freeze exactly where it is
  root.userData.flowTime = (root.userData.flowTime || 0) + dt * instance.motion.speed;
  tunnelUpdateLayout(root, instance, root.userData.flowTime);
}

export const FACTORIES = {
  'kinetic-rings': { create: ringsCreate, applyInstance: ringsApplyInstance, animate: ringsAnimate, dispose: clearGroup },
  'chrome-ribbon': { create: ribbonCreate, applyInstance: ribbonApplyInstance, animate: ribbonAnimate, dispose: clearGroup },
  'translucent-monoliths': { create: monolithsCreate, applyInstance: monolithsApplyInstance, animate: monolithsAnimate, dispose: clearGroup },
  'liquid-glass-lens': { create: lensCreate, applyInstance: lensApplyInstance, animate: lensAnimate, dispose: clearGroup },
  'floating-media-frame': { create: frameCreate, applyInstance: frameApplyInstance, animate: frameAnimate, dispose: clearGroup },
  'homepage-particle-hero': { create: heroCreate, applyInstance: heroApplyInstance, animate: heroAnimate, dispose: clearGroup },
  'glb-import': { create: glbCreate, applyInstance: glbApplyInstance, animate: glbAnimate, dispose: glbDispose },
  'prismatic-slab': { create: slabCreate, applyInstance: slabApplyInstance, animate: slabAnimate, dispose: clearGroup },
  'iridescent-film': { create: filmCreate, applyInstance: filmApplyInstance, animate: filmAnimate, dispose: clearGroup },
  'gel-panels': { create: panelsCreate, applyInstance: panelsApplyInstance, animate: panelsAnimate, dispose: clearGroup },
  'orb-constellation': { create: orbCreate, applyInstance: orbApplyInstance, animate: orbAnimate, dispose: clearGroup },
  'inflatable-forms': { create: formsCreate, applyInstance: formsApplyInstance, animate: formsAnimate, dispose: clearGroup },
  'mirror-fragments': { create: mirrorCreate, applyInstance: mirrorApplyInstance, animate: mirrorAnimate, dispose: clearGroup },
  'logo-sculpture': { create: sculptureCreate, applyInstance: sculptureApplyInstance, animate: sculptureAnimate, dispose: clearGroup },
  'light-tubes': { create: tubeCreate, applyInstance: tubeApplyInstance, animate: tubeAnimate, dispose: clearGroup },
  'wireframe-sculpture': { create: wireCreate, applyInstance: wireApplyInstance, animate: wireAnimate, dispose: clearGroup },
  'portal-plane': { create: portalCreate, applyInstance: portalApplyInstance, animate: portalAnimate, dispose: clearGroup },
  'cloth-banners': { create: bannerCreate, applyInstance: bannerApplyInstance, animate: bannerAnimate, dispose: clearGroup },
  'particle-ribbon': { create: ribbonParticlesCreate, applyInstance: ribbonParticlesApplyInstance, animate: ribbonParticlesAnimate, dispose: clearGroup },
  'caustic-water-light': { create: causticCreate, applyInstance: causticApplyInstance, animate: causticAnimate, dispose: clearGroup },
  'volumetric-light-cone': { create: coneCreate, applyInstance: coneApplyInstance, animate: coneAnimate, dispose: clearGroup },
  'topographic-floor': { create: terrainCreate, applyInstance: terrainApplyInstance, animate: terrainAnimate, dispose: clearGroup },
  'metaball-bloom': { create: bloomCreate, applyInstance: bloomApplyInstance, animate: bloomAnimate, dispose: clearGroup },
  'kinetic-type-totem': { create: totemCreate, applyInstance: totemApplyInstance, animate: totemAnimate, dispose: clearGroup },
  'echo-feedback-tunnel': { create: tunnelCreate, applyInstance: tunnelApplyInstance, animate: tunnelAnimate, dispose: clearGroup },
};

export function getFactory(type) {
  return FACTORIES[type] || null;
}
