// Scope-restricted randomization — docs/plans/STUDIO-ROADMAP-NEXT-PHASE-
// SONNET-HANDOFF.md Slice 1 "unified randomization scope control". The
// existing randomize entry points (elements/scene-elements.js
// randomizeAllElements, ClothStudio.jsx's randomizeSelectedElement/
// randomizeFx) each reroll a WHOLE bucket (material/motion/appearance) or a
// whole Look preset. The new scopes this file adds — Motion only, Colors
// only, Lighting only, Camera only — need to reroll a NARROWER slice than
// that: e.g. "Motion only" must leave material/appearance untouched even
// though they share the same instance, and "Colors only" must leave
// metalness/roughness untouched even though they live in the SAME `material`
// bucket a color field does. Pure logic — no React, no three.js — same
// discipline as every other elements/ module, so every scope is directly
// unit-testable and reproducible from a seed.
//
// Scope, stated precisely: this covers the 4 NEW single-domain scopes plus
// the lock-transparency report "Unlocked values only" needs. "Entire set"
// and "Unlocked values only" themselves are COMPOSED from these plus the
// pre-existing randomizeAllElements/randomizeFx — that composition lives in
// ClothStudio.jsx (Slice 1 wiring), not here, because the Look domain's full
// FX-treatment jitter depends on FX_PRESETS/LOOK_JITTER_SCALE, which are
// ClothStudio.jsx-local constants, not catalog/schema data. "Selected
// element", "Elements only", and "Look only" are UNCHANGED — they keep using
// their existing entry points.

import { getElementDefinition } from './catalog.js';
import { normalizeElementInstance } from './schema.js';
import { snapToStep } from './randomize.js';
import { DEFAULT_INTENSITY, rollNumeric, rollCategorical } from './intensity.js';
import { isRenderableInstance, findControlStep } from './scene-elements.js';

// A curated Look-domain color palette. Every OTHER color randomization in
// this app rolls from a curated hex list, never raw RGB (elements/catalog.js
// per-type `tintPalette`/`randomRanges.material.color` is the same idiom) —
// this is that idiom's Look-domain equivalent (background/light-can/FX
// colors aren't tied to any element catalog entry, so there's no existing
// randomRanges list to reuse for them).
export const LOOK_COLOR_PALETTE = [
  '#ffffff', '#101114', '#7dd3fc', '#f4c9d8', '#ffe08a', '#c9f7d0',
  '#e6dcff', '#dfeef8', '#ff5fce', '#9aa0a8', '#eaf6ff', '#f4c98a',
];

/** Which keys in `def.fieldSpec[bucket]` are color-typed — the set "Colors only" is allowed to touch inside that bucket. */
export function colorKeysForBucket(def, bucket) {
  const spec = def?.fieldSpec?.[bucket] || {};
  return Object.keys(spec).filter((k) => spec[k]?.type === 'color');
}

/**
 * Roll only `keys` within `bucket` — the subset of what a full
 * randomizeInstanceFields bucket-roll would touch. Needed because a type's
 * `material` bucket can mix a color field with non-color fields (metalness/
 * roughness) that a narrower scope must leave alone. Returns
 * `{ instance, changed }` — `changed` is this one bucket's own boolean, not
 * a changedGroups list, since the caller already knows which bucket/keys it
 * asked for.
 */
export function rollBucketKeys(instance, def, rand, bucket, keys, tier = DEFAULT_INTENSITY) {
  const bucketRanges = def?.randomRanges?.[bucket] || {};
  const patch = {};
  let changed = false;
  (keys || []).forEach((key) => {
    const range = bucketRanges[key];
    if (!Array.isArray(range) || !range.length) return;
    const current = instance[bucket]?.[key];
    let v;
    if (typeof range[0] === 'number' && typeof range[1] === 'number' && range.length === 2) {
      const step = findControlStep(def, bucket, key);
      const rolled = rollNumeric(rand, current, range, tier);
      v = step ? snapToStep(rolled, step) : rolled;
    } else {
      v = rollCategorical(rand, current, range, tier);
    }
    patch[key] = v;
    if (v !== current) changed = true;
  });
  const next = normalizeElementInstance({ ...instance, [bucket]: { ...instance[bucket], ...patch } }, instance.type);
  return { instance: next, changed };
}

/**
 * "Motion only" scope (Elements domain) — every renderable, unlocked
 * instance's `motion` bucket only; `material`/`appearance` are forced into
 * lockedGroups regardless of the instance's own group locks (there's nothing
 * for those buckets to roll under this scope), while `motion` itself is
 * still skipped if the user's own `random.groups.motion` lock is set. The
 * primary glass element is excluded, same precedent as randomizeAllElements
 * (elements/scene-elements.js) — its randomize path is flat-field
 * (`rotSpeed`), not bucketed; ClothStudio.jsx's Motion-only dispatcher rolls
 * that one field directly, the same way it already handles the primary for
 * "Elements only"/"Selected element".
 */
export function randomizeMotionOnly(extraInstances, { primaryId, deriveRand, intensity = DEFAULT_INTENSITY } = {}) {
  const changedById = {};
  const instances = (extraInstances || []).map((inst) => {
    if (inst.id === primaryId) return inst;
    if (!isRenderableInstance(inst, primaryId)) return inst;
    if (inst.random?.locked) return inst;
    const def = getElementDefinition(inst.type);
    if (!def) return inst;
    if (inst.random?.groups?.motion) return inst;
    const rand = deriveRand(inst.id);
    const { instance: next, changed } = rollBucketKeys(inst, def, rand, 'motion', Object.keys(def.randomRanges?.motion || {}), intensity);
    if (changed) changedById[inst.id] = ['motion'];
    return next;
  });
  return { instances, changedById };
}

/**
 * "Colors only" scope, Elements-domain half (the Look-domain half is
 * randomizeLookColors below — ClothStudio.jsx's dispatcher calls both and
 * pushes both stacks in the same cross-scope transaction). Only the
 * color-typed keys inside `material` are touched — metalness/roughness/etc.
 * are left alone even though they share the same bucket. Skips an instance
 * entirely if its `material` group is locked (color lives inside that
 * bucket, so the existing per-group lock already covers it).
 */
export function randomizeElementColorsOnly(extraInstances, { primaryId, deriveRand, intensity = DEFAULT_INTENSITY } = {}) {
  const changedById = {};
  const instances = (extraInstances || []).map((inst) => {
    if (inst.id === primaryId) return inst;
    if (!isRenderableInstance(inst, primaryId)) return inst;
    if (inst.random?.locked) return inst;
    if (inst.random?.groups?.material) return inst;
    const def = getElementDefinition(inst.type);
    if (!def) return inst;
    const colorKeys = colorKeysForBucket(def, 'material');
    if (!colorKeys.length) return inst;
    const rand = deriveRand(inst.id);
    const { instance: next, changed } = rollBucketKeys(inst, def, rand, 'material', colorKeys, intensity);
    if (changed) changedById[inst.id] = ['material'];
    return next;
  });
  return { instances, changedById };
}

/**
 * "Colors only" scope, Look-domain half — every color field in the Look
 * snapshot that isn't tied to any element catalog entry: all 4 light-can
 * colors, the flat background color, the two FX treatment ink/paper colors,
 * and the cloth sheet's own base color. Rolls unconditionally (no Look-field
 * lock concept exists yet — see computeLockSkipReport below) from
 * LOOK_COLOR_PALETTE, same curated-palette idiom as every element's own
 * `tintPalette`/`randRanges.material.color`.
 */
export function randomizeLookColors({ lightCans, bgColor, fx, mat }, { rand, intensity = DEFAULT_INTENSITY } = {}) {
  const nextLightCans = (lightCans || []).map((can) => ({ ...can, color: rollCategorical(rand, can.color, LOOK_COLOR_PALETTE, intensity) }));
  const nextBgColor = rollCategorical(rand, bgColor, LOOK_COLOR_PALETTE, intensity);
  const nextFx = { ...fx, colA: rollCategorical(rand, fx.colA, LOOK_COLOR_PALETTE, intensity), colB: rollCategorical(rand, fx.colB, LOOK_COLOR_PALETTE, intensity) };
  const nextMat = { ...mat, baseColor: rollCategorical(rand, mat.baseColor, LOOK_COLOR_PALETTE, intensity) };
  const changed = [];
  const lightingChanged = (nextLightCans || []).some((c, i) => c.color !== lightCans[i].color);
  if (lightingChanged) changed.push('lighting');
  if (nextBgColor !== bgColor) changed.push('background');
  if (nextFx.colA !== fx.colA || nextFx.colB !== fx.colB) changed.push('fx');
  if (nextMat.baseColor !== mat.baseColor) changed.push('material');
  return { lightCans: nextLightCans, bgColor: nextBgColor, fx: nextFx, mat: nextMat, changed };
}

// Safe randomization ranges for the Lighting/Camera/Diffusion Camera domains
// — deliberately the same bounds as their shipped sliders (ClothStudio.jsx:
// can intensity/angle/height ~3789-3791, env intensity ~3754, shot camera
// angle/height/distance/fov ~3809-3812), same "randomize can never produce
// an out-of-spec value" discipline every element catalog entry already
// follows for its own randRanges.
const CAN_RANGES = { intensity: [0, 3], az: [-180, 180], el: [-80, 85] };
const CAN_STEPS = { intensity: 0.05, az: 5, el: 5 };
const ENV_INTENSITY_RANGE = [0, 2.5];
const ENV_INTENSITY_STEP = 0.05;

/**
 * "Lighting only" scope (Look domain subset) — every light can's color +
 * intensity + angle + height, plus the environment/IBL intensity.
 * Deliberately does NOT touch `lightTemplate` (no template-name swap under
 * this scope — swapping the whole rig is a bigger change than "lighting
 * only" implies) or any non-lighting Look field (fx/mat/bg/sceneId).
 */
export function randomizeLighting({ lightCans, envIntensity }, { rand, intensity = DEFAULT_INTENSITY } = {}) {
  const nextLightCans = (lightCans || []).map((can) => ({
    ...can,
    color: rollCategorical(rand, can.color, LOOK_COLOR_PALETTE, intensity),
    intensity: snapToStep(rollNumeric(rand, can.intensity, CAN_RANGES.intensity, intensity), CAN_STEPS.intensity),
    az: snapToStep(rollNumeric(rand, can.az, CAN_RANGES.az, intensity), CAN_STEPS.az),
    el: snapToStep(rollNumeric(rand, can.el, CAN_RANGES.el, intensity), CAN_STEPS.el),
  }));
  const nextEnvIntensity = snapToStep(rollNumeric(rand, envIntensity, ENV_INTENSITY_RANGE, intensity), ENV_INTENSITY_STEP);
  return { lightCans: nextLightCans, envIntensity: nextEnvIntensity };
}

// Shot camera ranges mirror its shipped sliders exactly (ClothStudio.jsx
// ~3809-3812). Diffusion Camera ranges are new (Slice 1 introduces the
// feature) — normalized [0,1] strength-style controls plus a symmetric
// [-1,1] foreground/background bias, chosen to be internally consistent
// with every other 0-1 "amount" slider already in this Studio (fx bloom/
// grain/vignette, material clarity/opacity, etc.) rather than modeled on any
// pre-existing shipped control.
const SHOTCAM_RANGES = { az: [-180, 180], el: [-80, 85], dist: [1.2, 8], fov: [20, 90] };
const SHOTCAM_STEPS = { az: 5, el: 5, dist: 0.1, fov: 1 };
const DIFFUSION_CAMERA_RANGES = {
  focusDistance: [0.5, 4.5], aperture: [0, 1], falloff: [0, 1],
  diffusionRadius: [0, 1], highlightBloom: [0, 1], foregroundBias: [-1, 1], backgroundBias: [-1, 1],
};
const DIFFUSION_CAMERA_STEPS = {
  focusDistance: 0.05, aperture: 0.02, falloff: 0.02, diffusionRadius: 0.02, highlightBloom: 0.02, foregroundBias: 0.02, backgroundBias: 0.02,
};

/**
 * "Camera only" scope — shot-camera az/el/dist/fov (unconditionally — this
 * scope's whole point is to move the camera around, whether or not
 * `shotCam.use` currently has it live) plus Diffusion Camera's numeric
 * fields, skipped whole when `diffusionCamera.locked` (its own standalone
 * lock — see elements/scene-recipe.js sanitizeDiffusionCamera). Never
 * auto-flips `shotCam.use` as a side effect of randomizing — that's a
 * separate, explicit user action.
 */
export function randomizeCamera({ shotCam, diffusionCamera }, { rand, intensity = DEFAULT_INTENSITY } = {}) {
  const nextShotCam = { ...shotCam };
  Object.keys(SHOTCAM_RANGES).forEach((key) => {
    nextShotCam[key] = snapToStep(rollNumeric(rand, shotCam[key], SHOTCAM_RANGES[key], intensity), SHOTCAM_STEPS[key]);
  });
  const shotCamChanged = Object.keys(SHOTCAM_RANGES).some((key) => nextShotCam[key] !== shotCam[key]);

  let nextDiffusionCamera = diffusionCamera;
  let diffusionChanged = false;
  if (!diffusionCamera?.locked) {
    const patch = {};
    Object.keys(DIFFUSION_CAMERA_RANGES).forEach((key) => {
      patch[key] = snapToStep(rollNumeric(rand, diffusionCamera[key], DIFFUSION_CAMERA_RANGES[key], intensity), DIFFUSION_CAMERA_STEPS[key]);
    });
    nextDiffusionCamera = { ...diffusionCamera, ...patch };
    diffusionChanged = Object.keys(DIFFUSION_CAMERA_RANGES).some((key) => nextDiffusionCamera[key] !== diffusionCamera[key]);
  }

  const changed = [];
  if (shotCamChanged) changed.push('shotCam');
  if (diffusionChanged) changed.push('diffusionCamera');
  return { shotCam: nextShotCam, diffusionCamera: nextDiffusionCamera, changed };
}

/**
 * Lock-transparency report for "Unlocked values only" (roadmap: "reports
 * only unlocked groups/fields changed"). "Entire set" and "Unlocked values
 * only" run the IDENTICAL underlying randomize composition this slice —
 * every scope already respects locks by design, so there's no differently-
 * behaving "ignore locks" mode to contrast against. This is their one real,
 * honest difference: Unlocked-only additionally surfaces exactly what got
 * skipped and why, instead of only reporting what changed.
 */
export function computeLockSkipReport(extraInstances, { primaryId, diffusionCameraLocked = false } = {}) {
  const elements = [];
  (extraInstances || []).forEach((inst) => {
    if (inst.id === primaryId) return;
    if (!isRenderableInstance(inst, primaryId)) return;
    if (inst.random?.locked) {
      elements.push({ id: inst.id, name: inst.name, reason: 'whole-element locked' });
      return;
    }
    Object.keys(inst.random?.groups || {})
      .filter((g) => inst.random.groups[g])
      .forEach((g) => elements.push({ id: inst.id, name: inst.name, reason: `${g} group locked` }));
  });
  const camera = diffusionCameraLocked ? [{ reason: 'Diffusion Camera locked' }] : [];
  return { elements, camera };
}
