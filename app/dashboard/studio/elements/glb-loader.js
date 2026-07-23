// GLB loading/normalization — Phase 3 GLB import (docs/plans/ORIGINAL-
// STUDIO-CINEMATIC-SETS-4K-PLAN.md). Like factories.js, this never imports
// 'three'/'three-stdlib' at module scope — both are passed in via ctx
// (ClothStudio.jsx's world-init effect), which keeps this file free of
// import-time side effects and constructible in plain Node for tests
// (GLTFLoader.parse()/Box3 are pure CPU-side three.js — no DOM/WebGL
// needed).
//
// ── Decoder assets ──────────────────────────────────────────────────────
// Draco/KTX2 decoder binaries are self-hosted under /public/vendor/ (copied
// from node_modules/three/examples/jsm/libs — see
// scripts/copy-glb-decoders.mjs), not pulled from an external CDN, so the
// LOADING pipeline itself reaches no third-party network dependency —
// separate from (and in addition to) rejecting external references INSIDE
// an uploaded GLB (api/_lib/studio-glb-assets.cjs).

const DRACO_DECODER_PATH = '/vendor/draco/';
const KTX2_TRANSCODER_PATH = '/vendor/basis/';

/**
 * One shared loader bundle per Studio world session. DRACOLoader/KTX2Loader
 * each spin up a Web Worker on first decode — creating a bundle is
 * therefore an intentionally SESSION-scoped cost (ClothStudio.jsx's
 * world-init effect, stored on `world.glbLoader`, passed into every
 * glb-import instance's `ctx`), never per-element or per-load. `renderer`
 * is optional: without it, KTX2Loader still transcodes (CPU-side formats),
 * just without GPU-format auto-detection — pass the world's WebGLRenderer
 * when available.
 */
export function createGLTFLoaderBundle({ THREE, stdlib, renderer }) {
  const loader = new stdlib.GLTFLoader();
  const dracoLoader = new stdlib.DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  loader.setDRACOLoader(dracoLoader);
  const ktx2Loader = new stdlib.KTX2Loader();
  ktx2Loader.setTranscoderPath(KTX2_TRANSCODER_PATH);
  if (renderer) ktx2Loader.detectSupport(renderer);
  loader.setKTX2Loader(ktx2Loader);
  loader.setMeshoptDecoder(stdlib.MeshoptDecoder);
  return { loader, dracoLoader, ktx2Loader };
}

/** Terminates the shared bundle's decoder workers — call once at world teardown, never per-element. */
export function disposeGLTFLoaderBundle(bundle) {
  bundle?.dracoLoader?.dispose();
  bundle?.ktx2Loader?.dispose();
}

/**
 * Parse an in-memory GLB buffer — no network. The one real parse path,
 * used by both the live loader (after fetching bytes from Storage) and
 * tests (fixture bytes built with three-stdlib's own GLTFExporter) — so
 * tests exercise the exact same code as production, just skipping the
 * network fetch, which is the right place to draw that line.
 */
export function parseGLBBuffer(bundle, arrayBuffer) {
  return new Promise((resolve, reject) => {
    bundle.loader.parse(
      arrayBuffer,
      '',
      (gltf) => resolve(gltf),
      (err) => reject(err instanceof Error ? err : new Error(String(err) || 'Failed to parse GLB.'))
    );
  });
}

/** Fetch + parse a GLB from a URL — the live factory's path. */
export async function loadGLBFromUrl(bundle, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GLB fetch failed: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  return parseGLBBuffer(bundle, buffer);
}

/**
 * Compute the wrapper transform that recenters `scene`'s pivot to the
 * origin and uniformly scales it so its STATIC bind-pose bounding sphere
 * has radius `targetRadius` (default 1 — matches every other element
 * type's scale=1 catalog convention, elements/catalog.js `bounds.
 * localRadius`). Pure math — does NOT mutate `scene`; returns numbers for
 * the caller to apply to TWO NESTED wrapper groups: an inner one holding
 * `scene` with `position = offset` (recenter in the scene's own, still-
 * unscaled local units), and an outer one around THAT with `scale =
 * scale` (scale the already-recentered whole). Nesting in that order
 * matters — a single group's position and scale are independent
 * translate/scale columns of the SAME local-to-parent matrix, so setting
 * both on one group would scale the recentering offset itself along with
 * everything else (a point P maps to `position + scale*P`, not
 * `scale*(P - center)`); two nested groups apply them in the intended
 * order instead of fighting over one matrix.
 *
 * Honest limitation, not hidden: this bound covers the STATIC bind pose
 * only. Unlike every other Studio factory (whose bounding sphere is PROVEN
 * exact — see catalog.js's per-type comments — because their only motion
 * is rotation about a fixed origin), an uploaded GLB's own animation clips
 * can in principle translate a node beyond this bound. `targetRadius` is
 * deliberately left at exactly 1, unpadded — factories.js's glb-import
 * bounds.localRadius carries its own margin on top of this.
 */
export function normalizeGLBTransform(THREE, scene, targetRadius = 1) {
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return { offset: [0, 0, 0], scale: 1, radius: 0 };
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = sphere.radius || 0.0001; // guard against a degenerate (single-point) mesh dividing by zero
  const scale = targetRadius / radius;
  return { offset: [-center.x, -center.y, -center.z], scale, radius };
}

/**
 * Apply (or restore) a material override across every mesh under `root`
 * that has a material supporting color/metalness/roughness. Mutates each
 * mesh's EXISTING material object in place — never clones/swaps it — so
 * there is exactly one material object per mesh for factories.js's
 * disposal path (clearGroup) to find and dispose; caches the ORIGINAL
 * scalar values (not a cloned material) the first time an override is
 * applied so disabling it later restores the pristine glTF values exactly,
 * with no second material object ever needing its own disposal.
 */
export function applyMaterialOverride(root, { enabled, tint, metalness, roughness } = {}) {
  if (!root.userData.originalMaterialValues) {
    const values = new Map();
    root.traverse((child) => {
      if (child.isMesh && child.material && !Array.isArray(child.material)) {
        const mat = child.material;
        values.set(mat, {
          color: 'color' in mat && mat.color ? mat.color.getHex() : null,
          metalness: 'metalness' in mat ? mat.metalness : null,
          roughness: 'roughness' in mat ? mat.roughness : null,
        });
      }
    });
    root.userData.originalMaterialValues = values;
  }
  const values = root.userData.originalMaterialValues;
  values.forEach((orig, mat) => {
    if (enabled) {
      if (orig.color !== null) mat.color.set(tint);
      if (orig.metalness !== null) mat.metalness = metalness;
      if (orig.roughness !== null) mat.roughness = roughness;
    } else {
      if (orig.color !== null) mat.color.setHex(orig.color);
      if (orig.metalness !== null) mat.metalness = orig.metalness;
      if (orig.roughness !== null) mat.roughness = orig.roughness;
    }
  });
}
