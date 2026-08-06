// Real-GLB T-shirt primary shape — the THREE.js-consuming build layer.
// Turns a loaded GLTF scene (from elements/glb-loader.js's existing
// loadGLBFromUrl, unmodified) into a bone-skinned group driven by the
// lattice simulation (elements/tshirt-glb-lattice.js, pure). Like
// factories.js/glb-loader.js, THREE is passed in (never imported at module
// scope) so this stays constructible in plain Node for tests — building
// geometry/Skeleton/Bone objects is pure CPU-side three.js, no DOM/WebGL
// needed, the same precedent glb-loader.js's own header documents.

import { combineBounds, buildLatticeTopology, computeSkinBinding } from './tshirt-glb-lattice.js';
import { createSimState } from './tshirt-mesh.js';

const LATTICE_COLS = 7;
const LATTICE_ROWS = 9;
const LATTICE_LAYERS = 2;
const LATTICE_PIN_ROWS = 2; // collar/shoulder hanger-grip band
const SKIN_BIND_K = 4;

/** Every real THREE.Mesh under `root` (not Group/Object3D/Bone/etc.), in traversal order — the same 4 parts every time for this asset, but generic over any GLB. */
function collectMeshes(root) {
  const meshes = [];
  root.traverse((c) => { if (c.isMesh) meshes.push(c); });
  return meshes;
}

/**
 * Builds the bone lattice, converts every mesh under `gltfScene` into a
 * SkinnedMesh with skinIndex/skinWeight attributes, and returns the group —
 * but deliberately does NOT construct the Skeleton or call `.bind()` yet.
 *
 * CORRECTION (found live, master task round 5): `SkinnedMesh.bind(skeleton)`
 * (no explicit bindMatrix) captures `mesh.matrixWorld` AT THAT MOMENT as the
 * bind matrix, and `new THREE.Skeleton(bones)` likewise captures each bone's
 * CURRENT `matrixWorld` as its inverse bind matrix. ClothStudio.jsx wraps
 * `built.root` in an outer normalization group (recenter + scale-to-radius-1,
 * via elements/glb-loader.js normalizeGLBTransform) AFTER this function
 * returns — if binding happened here, before that reparenting, the skinning
 * shader's `bindMatrix`/`boneInverses` would reflect the OLD (unwrapped)
 * transform while the bones' actual per-frame `matrixWorld` reflects the
 * NEW (wrapped) one, so the wrapper's scale/offset gets baked into the
 * per-vertex skinning math A SECOND time on top of the normal
 * modelMatrix — with this asset's ~0.056 normalization scale, that squares
 * to ~0.003, collapsing the whole garment to an invisible speck. Splitting
 * `buildTshirtSkinnedGroup` (topology/attributes only) from
 * `finalizeTshirtBinding` (Skeleton + bind, called by the caller AFTER the
 * full parent chain — including the wrapper — has run
 * `updateMatrixWorld(true)`) is the fix: both captures then reflect the
 * SAME, final coordinate space the mesh will actually render in.
 */
export function buildTshirtSkinnedGroup(THREE, gltfScene) {
  const meshes = collectMeshes(gltfScene);
  if (!meshes.length) throw new Error('tshirt GLB has no mesh geometry');

  // Combined LOCAL-space bounds across every mesh (all identity-transformed
  // relative to gltfScene per this asset's own node dump — see the Phase 1
  // inspection; combineBounds itself doesn't assume that, it just unions
  // whatever boxes it's given).
  const boxes = meshes.map((m) => {
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    return { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] };
  });
  const bounds = combineBounds(boxes, 0.06);

  const lattice = buildLatticeTopology({
    min: bounds.min, max: bounds.max,
    cols: LATTICE_COLS, rows: LATTICE_ROWS, layers: LATTICE_LAYERS, pinRows: LATTICE_PIN_ROWS,
  });
  const sim = createSimState(lattice);

  // Bones as a flat (non-hierarchical) set, all direct children of one
  // armature Group added at the SAME hierarchy point as the meshes (a
  // sibling of gltfScene's own root, added to the returned `root` alongside
  // it) — this is what makes plain `mesh.bind(skeleton)` (no explicit
  // bindMatrix) correct: bones and meshes share the same parent transform.
  const armature = new THREE.Group();
  armature.name = 'tshirt-lattice-armature';
  const bones = [];
  for (let i = 0; i < lattice.vertexCount; i += 1) {
    const bone = new THREE.Bone();
    bone.position.set(lattice.positions[i * 3], lattice.positions[i * 3 + 1], lattice.positions[i * 3 + 2]);
    bones.push(bone);
    armature.add(bone);
  }

  const root = new THREE.Group();
  root.name = 'tshirt-glb-root';
  root.add(gltfScene);
  root.add(armature);

  const skinnedMeshes = meshes.map((mesh) => {
    const posAttr = mesh.geometry.attributes.position;
    const { skinIndex, skinWeight } = computeSkinBinding(posAttr.array, lattice.positions, SKIN_BIND_K);
    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

    const skinned = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
    skinned.name = mesh.name;
    skinned.frustumCulled = false; // deformed every frame — cached bounds would go stale (same fix as the procedural mesh)
    return skinned; // NOT bound yet — see finalizeTshirtBinding
  });

  // Replace the loaded (non-skinned) meshes with their skinned counterparts,
  // in place, under the SAME parent(s) they were loaded under — preserves
  // whatever grouping the asset itself authored.
  meshes.forEach((mesh, i) => {
    const parent = mesh.parent;
    parent.remove(mesh);
    parent.add(skinnedMeshes[i]);
  });

  return {
    root, armature, bones, skeleton: null, sim, lattice,
    meshes: skinnedMeshes,
  };
}

/**
 * Second half of the split described in buildTshirtSkinnedGroup's own
 * comment — call this ONLY after `built.root`'s full final parent chain
 * (including any outer normalization wrapper) has had
 * `updateMatrixWorld(true)` run, so the Skeleton's boneInverses and each
 * mesh's bindMatrix both capture the coordinate space the mesh will
 * actually render in. Mutates `built` in place (sets `built.skeleton`) and
 * returns it for convenience.
 */
export function finalizeTshirtBinding(THREE, built) {
  const skeleton = new THREE.Skeleton(built.bones);
  built.meshes.forEach((mesh) => mesh.bind(skeleton));
  built.skeleton = skeleton;
  return built;
}

/** Disposes every geometry/material/texture this group owns exactly once. Bones/Skeleton hold no disposable GPU resources of their own. */
export function disposeTshirtSkinnedGroup(built) {
  if (!built) return;
  built.meshes.forEach((mesh) => {
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      if (!m) return;
      m.map?.dispose();
      m.normalMap?.dispose();
      m.roughnessMap?.dispose();
      m.metalnessMap?.dispose();
      m.userData?.logoUniforms?.uLogoMap?.value?.dispose?.();
      m.dispose();
    });
  });
}

/** Writes the current lattice sim state into the bones' local positions — call once per frame after stepping the sim. Bones are flat (no parent-child chaining among themselves), so sim position IS the bone's local position directly. */
export function applyLatticeToBones(bones, sim) {
  for (let i = 0; i < bones.length; i += 1) {
    bones[i].position.set(sim.position[i * 3], sim.position[i * 3 + 1], sim.position[i * 3 + 2]);
  }
}

// ── Front print (Phase 6) ────────────────────────────────────────────────
// The real asset's 4 meshes share ONE material and this mesh's own UVs are
// a multi-tile atlas where front/back are NOT cleanly separable (measured
// empirically during Phase 1 — a front-facing/chest-height vertex sample
// spanned nearly the mesh's entire U range). So the print is placed via
// WORLD-SPACE projection (built-in `modelMatrix`/rest-pose `position`,
// `normal`) instead of the mesh's native UVs — the same "never separate
// from the fabric" guarantee the procedural mesh's own UV-space decal had
// (anchored to REST-POSE position, always drawn from the mesh's OWN raw
// `position`/`normal` attributes — unaffected by skinning, which only ever
// WRITES a separate `transformed` variable, never reassigns `position`
// itself) — the print still deforms with the garment because the
// FRAGMENT's world position naturally follows wherever the skinned surface
// currently is; only the decal's OWN anchor stays fixed to the bind pose,
// which is what "doesn't slide around under wind" requires.
const TSHIRT_GLB_VERTEX_PARS = `
varying vec3 vDecalWorldPos;
varying vec3 vDecalWorldNormal;
`;
const TSHIRT_GLB_VERTEX_BODY = `
vDecalWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
vDecalWorldNormal = normalize(mat3(modelMatrix) * normal);
`;
const TSHIRT_GLB_FRAG_PARS = `
uniform sampler2D uLogoMap;
uniform float uHasLogo;
uniform vec3 uDecalCenterWorld;
uniform vec2 uDecalHalfSizeWorld;
uniform float uLogoX;
uniform float uLogoY;
uniform float uLogoScale;
uniform float uLogoRotation;
uniform float uLogoOpacity;
uniform float uLogoAspect;
varying vec3 vDecalWorldPos;
varying vec3 vDecalWorldNormal;
`;
const TSHIRT_GLB_FRAG_BODY = `
if (uHasLogo > 0.5 && vDecalWorldNormal.z > 0.35) {
  vec2 rel = vDecalWorldPos.xy - uDecalCenterWorld.xy - vec2(uLogoX, uLogoY) * uDecalHalfSizeWorld * 2.0;
  float tsRad = -uLogoRotation;
  float tsCr = cos(tsRad), tsSr = sin(tsRad);
  vec2 tsRotated = vec2(rel.x * tsCr - rel.y * tsSr, rel.x * tsSr + rel.y * tsCr);
  float tsFitX = uLogoAspect > 1.0 ? uLogoAspect : 1.0;
  float tsFitY = uLogoAspect > 1.0 ? 1.0 : 1.0 / max(uLogoAspect, 0.0001);
  vec2 tsUv = tsRotated / (uDecalHalfSizeWorld * max(uLogoScale, 0.0001) * vec2(tsFitX, tsFitY)) * 0.5 + 0.5;
  if (tsUv.x >= 0.0 && tsUv.x <= 1.0 && tsUv.y >= 0.0 && tsUv.y <= 1.0) {
    vec4 tsLogoTex = texture2D(uLogoMap, vec2(tsUv.x, 1.0 - tsUv.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, tsLogoTex.rgb, tsLogoTex.a * uLogoOpacity);
  }
}
`;

/**
 * Empirically measures a stable front-chest world-space anchor for the
 * print: the centroid of vertices that are BOTH in a chest-height Y band
 * (fractions of the mesh's own world bbox height) AND strongly front-facing
 * (world normal z > `normalThreshold`), plus a half-size derived as a FIXED
 * proportion of the mesh's overall world bbox (not the cluster's own raw
 * extent, which — measured during Phase 1 — is too wide/leaks toward the
 * sleeves for this asset's actual topology). Must be called AFTER the
 * mesh's full parent chain (including any outer normalization wrapper) has
 * had `updateMatrixWorld(true)` run, so `mesh.matrixWorld` is final.
 */
export function computeFrontPrintRegion(THREE, mesh, opts = {}) {
  const {
    yMinFrac = -0.12, yMaxFrac = 0.30, normalThreshold = 0.6,
    chestWidthFrac = 0.42, chestHeightFrac = 0.34,
  } = opts;
  const posAttr = mesh.geometry.attributes.position;
  const normAttr = mesh.geometry.attributes.normal;
  const worldBox = new THREE.Box3().setFromObject(mesh);
  const worldSize = worldBox.getSize(new THREE.Vector3());
  const worldCenter = worldBox.getCenter(new THREE.Vector3());
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const chestYMin = worldCenter.y + worldSize.y * yMinFrac;
  const chestYMax = worldCenter.y + worldSize.y * yMaxFrac;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  let sumX = 0, sumY = 0, sumZ = 0, count = 0;
  for (let i = 0; i < posAttr.count; i += 1) {
    p.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    if (p.y < chestYMin || p.y > chestYMax) continue;
    n.fromBufferAttribute(normAttr, i).applyMatrix3(nm).normalize();
    if (n.z < normalThreshold) continue;
    sumX += p.x; sumY += p.y; sumZ += p.z; count += 1;
  }
  const centerWorld = count > 0
    ? [sumX / count, sumY / count, sumZ / count]
    : [worldCenter.x, worldCenter.y, worldCenter.z];
  return {
    centerWorld,
    halfSizeWorld: [worldSize.x * chestWidthFrac * 0.5, worldSize.y * chestHeightFrac * 0.5],
    sampleCount: count,
  };
}

/**
 * Converts every mesh's material to MeshPhysicalMaterial (a strict
 * superset of the glTF-loaded MeshStandardMaterial — same precedent as
 * elements/factories.js's own procedural-mesh material swap in round 2 of
 * the correction cycle, needed here too so Clearcoat/Iridescence/Sheen have
 * a real property to map onto). ALL meshes currently share ONE loaded
 * material (verified in Phase 1 — every primitive references material
 * index 0) — cloning per-mesh here is what lets the identified front mesh
 * get the logo shader injection WITHOUT it silently bleeding onto the
 * other 3 parts (sleeves/trim/lining), which sharing one material object
 * would do.
 */
export function buildGarmentMaterials(THREE, meshes, { frontMeshName = 'Object_5' } = {}) {
  let frontMesh = meshes.find((m) => m.name === frontMeshName);
  if (!frontMesh) {
    // Honest fallback if this asset's own part naming ever changes: the
    // largest mesh by vertex count is the most likely "main body" surface.
    frontMesh = meshes.reduce((a, b) => (
      b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a
    ));
  }
  meshes.forEach((mesh) => {
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    if (mesh === frontMesh) {
      const uniforms = {
        uLogoMap: { value: null }, uHasLogo: { value: 0 },
        uLogoX: { value: 0 }, uLogoY: { value: 0 }, uLogoScale: { value: 1 },
        uLogoRotation: { value: 0 }, uLogoOpacity: { value: 1 }, uLogoAspect: { value: 1 },
        uDecalCenterWorld: { value: new THREE.Vector3() }, uDecalHalfSizeWorld: { value: new THREE.Vector2(1, 1) },
      };
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + TSHIRT_GLB_VERTEX_PARS)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + TSHIRT_GLB_VERTEX_BODY);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + TSHIRT_GLB_FRAG_PARS)
          .replace('#include <map_fragment>', '#include <map_fragment>\n' + TSHIRT_GLB_FRAG_BODY);
      };
      // Same program-cache-key correctness fix as the procedural mesh
      // (round 1's Codex finding) — without it, this front material can
      // silently reuse a program compiled for one of the visually-similar
      // non-logo materials and skip onBeforeCompile entirely.
      mat.customProgramCacheKey = () => 'tshirt-glb-front-with-logo';
      mat.userData.logoUniforms = uniforms;
    }
    mesh.material = mat;
  });
  return frontMesh;
}

/** Applies the primary sheet's shared material dials to EVERY garment mesh — same properties, same values, across body/trim/lining, matching one real fabric look. */
export function applyGarmentMaterialState(meshes, { mat, envIntensity }) {
  meshes.forEach((mesh) => {
    const m = mesh.material;
    if (!m) return;
    m.color.set(mat.baseColor);
    let roughness = mat.roughness;
    let clearcoat = mat.clearcoat;
    if (mat.finish === 'matte') { roughness = Math.max(roughness, 0.7); clearcoat *= 0.15; }
    else if (mat.finish === 'satin') { roughness = Math.min(1, roughness + 0.28); clearcoat *= 0.5; }
    m.roughness = roughness;
    m.metalness = mat.metalness;
    m.clearcoat = clearcoat;
    m.clearcoatRoughness = mat.coatRoughness;
    m.iridescence = mat.iridescence;
    m.sheen = mat.sheen;
    m.envMapIntensity = envIntensity;
  });
}

/** Applies the T-Shirt Print controls (elements/primary-cloth.js DEFAULT_TSHIRT_PRINT shape) to the front mesh's logo uniforms — `hasLogo` gates on the texture actually being the CURRENTLY wanted one, same "don't show a stale/previous logo" discipline the procedural mesh's tshirtUpdateMaterial already established. */
export function applyPrintState(frontMesh, { tshirtPrint, logoTexture, logoAspect }) {
  const u = frontMesh?.material?.userData?.logoUniforms;
  if (!u) return;
  u.uHasLogo.value = logoTexture ? 1 : 0;
  u.uLogoMap.value = logoTexture || null;
  u.uLogoAspect.value = logoAspect || 1;
  u.uLogoX.value = tshirtPrint.x;
  u.uLogoY.value = tshirtPrint.y;
  u.uLogoScale.value = tshirtPrint.scale;
  u.uLogoRotation.value = (tshirtPrint.rotation * Math.PI) / 180;
  u.uLogoOpacity.value = tshirtPrint.opacity;
}
