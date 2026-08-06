// Diffusion Camera — focal-target resolution + CoC/blur math (Codex visual-
// correction round). A camera/look/post-processing feature (never an
// element mesh — see ClothStudio.jsx's composer chain), so this stays a
// standalone module, same tier as elements/scene-recipe.js, not nested
// under elements/ (which is specifically the catalog-element system).
//
// Two defects this fixes:
//   1. `diffusionCamera.focalTarget` was exposed in the UI and serialized,
//      but the render loop only ever sent the MANUAL `focusDistance` dial
//      to the shader — selecting a target did nothing. This module makes
//      the target real: `resolveFocalTargetId` decides which target is
//      CURRENTLY valid (never a disabled/data-only/removed instance —
//      `isFocalTargetValid`/`listDiffusionFocalTargets` are the single
//      source of truth for both the UI dropdown's option list and the
//      render loop's own fallback), and `cameraSpaceForwardDistance`
//      converts a resolved target's world position into the SAME
//      coordinate convention `linearizeDepth` (mirroring the shader's own
//      GLSL depth-linearization formula) produces from the depth buffer —
//      camera-space forward distance, not an unrelated Euclidean
//      camera-to-target distance.
//   2. The CoC/blur response was too weak to read as a visible effect at
//      any reasonable setting (see computeBlurRadiusPx's own comment for
//      the exact before/after numbers).
//
// Pure logic — no React. `cameraSpaceForwardDistance` DOES take a real
// three.js Camera/Vector3, but needs no DOM/WebGL context — it's plain
// matrix math, directly testable with `three`'s headless classes (same
// precedent elements/factories.test.js already established for real
// THREE.Scene/Camera graphs in node:test).

export const DIFFUSION_FOCAL_ORIGIN = 'origin';
export const DIFFUSION_FOCAL_MANUAL = 'manual';
export const DIFFUSION_FOCAL_PRIMARY_ARTWORK = 'primary-artwork';

/**
 * Whether `targetId` currently names a REAL, live, enabled target — never
 * true for a disabled Show/Hide-off element, a data-only glass duplicate,
 * a removed instance, or the primary Glass Petal Sphere while `glass.on`
 * is false. 'origin' (Center of scene) and 'manual' (the Focus Distance
 * dial itself) are always valid — they never depend on any live object.
 */
export function isFocalTargetValid(targetId, { glassOn = false, primaryArtworkAvailable = true, elementInstances = [], primaryElementId } = {}) {
  if (targetId === DIFFUSION_FOCAL_ORIGIN || targetId === DIFFUSION_FOCAL_MANUAL) return true;
  if (targetId === DIFFUSION_FOCAL_PRIMARY_ARTWORK) return Boolean(primaryArtworkAvailable);
  if (targetId === primaryElementId) return Boolean(glassOn);
  const inst = (elementInstances || []).find((i) => i.id === targetId);
  return Boolean(inst?.enabled);
}

/**
 * The deterministic fallback a stored/selected focalTarget resolves to
 * once it no longer names a currently-valid target — ALWAYS 'origin'
 * (Center of scene), never whatever distance happened to be computed last
 * frame. Called fresh every frame by the render loop (never cached), so a
 * target that becomes invalid (the user hides it) and later becomes valid
 * again (they re-enable it) recovers on its own with no special-case code.
 */
export function resolveFocalTargetId(targetId, ctx) {
  return isFocalTargetValid(targetId, ctx) ? targetId : DIFFUSION_FOCAL_ORIGIN;
}

/**
 * The Focal Target dropdown's full option list — ids/labels for every
 * CURRENTLY valid target, in a stable display order. Built from the exact
 * same validity rule `isFocalTargetValid` uses, so the UI can never offer
 * an option the render loop would immediately reject and fall back from
 * (Codex review: "Do not show disabled, data-only, removed, or
 * non-rendered instances as valid targets").
 */
export function listDiffusionFocalTargets({ glassOn = false, primaryArtworkAvailable = true, elementInstances = [], primaryElementId, primaryElementLabel = 'Glass Petal Sphere', primaryArtworkLabel = 'Primary artwork / cloth' } = {}) {
  const targets = [
    { id: DIFFUSION_FOCAL_ORIGIN, label: 'Center of scene' },
    { id: DIFFUSION_FOCAL_MANUAL, label: 'Manual (Focus Distance)' },
  ];
  if (primaryArtworkAvailable) targets.push({ id: DIFFUSION_FOCAL_PRIMARY_ARTWORK, label: primaryArtworkLabel });
  (elementInstances || []).forEach((inst) => {
    if (inst.id === primaryElementId) {
      if (glassOn) targets.push({ id: inst.id, label: inst.name || primaryElementLabel });
      return;
    }
    if (inst.enabled) targets.push({ id: inst.id, label: inst.name || inst.id });
  });
  return targets;
}

/**
 * Camera-space forward distance to `worldPosition` — the SAME coordinate
 * convention `linearizeDepth` below produces from a pixel's depth-buffer
 * value: a point exactly on a surface the camera renders, at this many
 * world units along the camera's own forward axis. NOT Euclidean
 * camera-to-target distance (which would disagree with the depth buffer
 * for any target off the exact center of the frame).
 *
 * Requires `camera.matrixWorldInverse` to be current for THIS frame —
 * call `camera.updateMatrixWorld()` first if anything in the camera's own
 * transform chain (orbit controls, a shot-cam dial) moved this frame.
 */
export function cameraSpaceForwardDistance(camera, worldPosition) {
  const local = worldPosition.clone().applyMatrix4(camera.matrixWorldInverse);
  return -local.z;
}

/**
 * Mirrors DIFFUSION_SHADER's own GLSL depth-linearization exactly (same
 * formula, same inputs: `rawDepth` in [0,1] from tDepth, `near`/`far` from
 * the active camera) — lets JS-side tests assert against the shader's
 * real math without a WebGL context. A rawDepth of 1.0 (the untouched
 * clear/background — nothing drew there) linearizes to exactly `far`,
 * which is the background-depth policy computeCircleOfConfusion below
 * relies on (see its own comment).
 */
export function linearizeDepth(rawDepth, near, far) {
  const zN = rawDepth * 2 - 1;
  return (2 * near * far) / (far + near - zN * (far - near));
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const clampSigned = (v) => Math.min(1, Math.max(-1, v));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Circle-of-confusion strength in [0,1] at world distance `dist`, given
 * the current focus plane/falloff/bias — mirrors DIFFUSION_SHADER's
 * fragment shader exactly (same magic numbers: falloff maps [0,1] to a
 * [0.15, 3.0] world-unit band width; bias maps [-1,1] to a [0,2]
 * multiplier). coc===0 is perfectly sharp; coc===1 is maximum blur.
 *
 * Background policy: a pixel at the far plane (dist===far, i.e. rawDepth
 * was 1.0 — see linearizeDepth) is NOT special-cased here — it just
 * produces a very large `diff`, which saturates coc to 1.0 through the
 * exact same math real geometry uses. That's the deliberate fix for the
 * original `rawDepth < 0.999999` gate, which skipped the backdrop
 * entirely (it could never blur, no matter the focus distance — flat,
 * always perfectly sharp, undermining any focused-subject-vs-blurred-
 * surroundings read). A perfectly flat backdrop colour is visually
 * unaffected by blurring (averaging N identical samples reproduces the
 * same colour) — this only ever becomes visible once the backdrop
 * actually has detail (a gradient, bgTexture image, or a verification
 * grid), which is exactly where a real depth-of-field lens would show it.
 * tDepth itself is never modified by the blur, so the treatment pass's
 * own depth===1.0 tone-mapping skip is completely unaffected.
 */
export function computeCircleOfConfusion({ dist, focusDistance, falloff, foregroundBias = 0, backgroundBias = 0 }) {
  const diff = dist - focusDistance;
  const falloffDist = lerp(0.15, 3.0, clamp01(falloff));
  let coc = clamp01(Math.abs(diff) / Math.max(falloffDist, 0.0001));
  const biasAmt = diff < 0 ? (1 + clampSigned(foregroundBias)) : (1 + clampSigned(backgroundBias));
  coc = clamp01(coc * Math.max(biasAmt, 0));
  return coc;
}

/**
 * Blur radius in pixels for a given CoC strength — mirrors
 * DIFFUSION_SHADER's own `maxRadiusPx` mapping exactly.
 *
 * BEFORE this round: `mix(1,18,diffusionRadius) * mix(0.3,1,aperture)` —
 * at the shipped defaults (diffusionRadius 0.3, aperture 0.4) that's
 * ≈3.5px maximum radius, imperceptible on any real render target; even at
 * BOTH sliders maxed it only reached 18px.
 * AFTER: `mix(1,40,diffusionRadius) * mix(0.4,1,aperture)` — minimum
 * settings stay subtle (≈0.4px, matching the master task's own "minimum
 * can remain subtle"), the shipped defaults already reach ≈8px (a real,
 * visible softening), the curve's own MIDPOINT (0.5/0.5) reaches ≈14px
 * ("midrange must be clearly perceptible"), and maximum reaches 40px — an
 * unmistakable focused-subject-vs-blurred-surroundings result at the
 * same fixed 8-tap cost (this changes the DISTANCE between taps, not
 * their count — no measurable perf regression; see the round's docs for
 * the live frame-time comparison).
 */
export function computeBlurRadiusPx(coc, { diffusionRadius, aperture }) {
  const maxRadiusPx = lerp(1, 40, clamp01(diffusionRadius)) * lerp(0.4, 1, clamp01(aperture));
  return coc * maxRadiusPx;
}
