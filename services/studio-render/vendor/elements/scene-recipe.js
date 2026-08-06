// Scene Template recipe sanitizers — docs/plans/ORIGINAL-STUDIO-CINEMATIC-
// SETS-4K-PLAN.md "Template system" § Scene Template, Phase 5. A Scene
// Template's `recipe` is only shape-checked as "an object" by
// elements/templates.js (deliberately opaque to recipe shape — see that
// module's own header). The untrusted boundary is really HERE: a recipe can
// be exported/imported as raw JSON, hand-edited, or drift across versions,
// so every NESTED member of every object/array-shaped field is validated
// individually before ClothStudio.jsx applies it to live state — a shallow
// `typeof r.x === 'object'` + spread-merge is not enough (it happily accepts
// e.g. `lightCans: [null, null, null, null]`, which then crashes the render
// loop the moment it dereferences a null can's `.on`).
//
// Every sanitizer takes (raw, fallback) and returns a fully-formed value of
// the same shape as `fallback` — invalid/missing members fall back to the
// CURRENT live value the caller passes in, never to a hardcoded default and
// never left unvalidated. This mirrors elements/schema.js's own "validate
// and normalize, never trust raw input, never reject wholesale" discipline.
// A malformed member is dropped, not allowed to crash — the recipe still
// applies everywhere it validly can.
//
// Kept free of ClothStudio.jsx's own constants (FINISHES, PIN_MODES,
// TREATMENTS) — callers pass the valid-id lists in per call, so this module
// stays a standalone, directly unit-testable pure module like every other
// file in elements/, with no risk of drifting from or duplicating those
// lists.

export const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
export const isBool = (v) => typeof v === 'boolean';

export function sanitizeVec3(raw, fallback) {
  return Array.isArray(raw) && raw.length === 3 && raw.every(isFiniteNum) ? [...raw] : [...fallback];
}

const MAT_NUMBER_KEYS = [
  'holoIntensity', 'holoScale', 'bandFreq', 'saturation', 'hueShift', 'sparkle', 'specTint',
  'iridescence', 'roughness', 'metalness', 'clearcoat', 'coatRoughness', 'sheen', 'bump', 'bumpTiling',
];
export function sanitizeMat(raw, fallback, { finishes, presetIds }) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  // '' is the legitimate "Custom" value (no preset selected, INITIAL_MAT's
  // own default) — not itself a key in presetIds, so it's allowed alongside
  // real preset ids rather than validated against that list.
  if (raw.preset === '' || (presetIds || []).includes(raw.preset)) out.preset = raw.preset;
  if ((finishes || []).includes(raw.finish)) out.finish = raw.finish;
  if (isHexColor(raw.baseColor)) out.baseColor = raw.baseColor;
  MAT_NUMBER_KEYS.forEach((k) => { if (isFiniteNum(raw[k])) out[k] = raw[k]; });
  return out;
}

const PHYS_NUMBER_KEYS = ['gravity', 'damping', 'stiffness', 'rebound', 'rumple'];
export function sanitizePhys(raw, fallback, { pinModeIds }) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  PHYS_NUMBER_KEYS.forEach((k) => { if (isFiniteNum(raw[k])) out[k] = raw[k]; });
  if ((pinModeIds || []).includes(raw.pinMode)) out.pinMode = raw.pinMode;
  return out;
}

export function sanitizeAnim(raw, fallback) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  if (isBool(raw.on)) out.on = raw.on;
  if (isFiniteNum(raw.turbulence)) out.turbulence = raw.turbulence;
  if (isFiniteNum(raw.speed)) out.speed = raw.speed;
  return out;
}

export function sanitizeCam(raw, fallback) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  ['rotX', 'rotY', 'pan'].forEach((k) => { if (isBool(raw[k])) out[k] = raw[k]; });
  return out;
}

export function sanitizeGlass(raw, fallback) {
  const out = { ...fallback, position: [...fallback.position], rotationOffset: [...fallback.rotationOffset] };
  if (!raw || typeof raw !== 'object') return out;
  if (isBool(raw.on)) out.on = raw.on;
  if (isFiniteNum(raw.scale)) out.scale = raw.scale;
  if (isBool(raw.rotate)) out.rotate = raw.rotate;
  if (isFiniteNum(raw.rotSpeed)) out.rotSpeed = raw.rotSpeed;
  if (isHexColor(raw.tint)) out.tint = raw.tint;
  if (isFiniteNum(raw.clarity)) out.clarity = raw.clarity;
  // transmission maps directly to MeshPhysicalMaterial.transmission, which
  // has a real, physically-meaningful hard bound ([0,1] — Three.js clamps
  // internally, but an out-of-range stored value would still misrepresent
  // "how transparent this looked" on export/round-trip) — clamped here,
  // unlike the plain isFiniteNum-only fields above, per this round's own
  // "clamped or rejected through the established schema/sanitizer
  // boundary" requirement. Missing/invalid falls back to the CURRENT live
  // value (same discipline as every other field here), which for a
  // scene that predates this field is DEFAULT_GLASS.transmission (1) —
  // see ClothStudio.jsx's own comment on that default.
  if (isFiniteNum(raw.transmission)) out.transmission = Math.min(1, Math.max(0, raw.transmission));
  out.position = sanitizeVec3(raw.position, fallback.position);
  out.rotationOffset = sanitizeVec3(raw.rotationOffset, fallback.rotationOffset);
  return out;
}

// T-shirt primary-shape print placement (task requirement #8 — Scene
// Template round-trip). Same shape as elements/primary-cloth.js
// DEFAULT_TSHIRT_PRINT.
export function sanitizeTshirtPrint(raw, fallback) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  if (isBool(raw.hangerVisible)) out.hangerVisible = raw.hangerVisible;
  ['x', 'y', 'scale', 'rotation', 'opacity'].forEach((k) => { if (isFiniteNum(raw[k])) out[k] = raw[k]; });
  return out;
}

export function sanitizeShotCam(raw, fallback) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  if (isBool(raw.use)) out.use = raw.use;
  ['az', 'el', 'dist', 'fov'].forEach((k) => { if (isFiniteNum(raw[k])) out[k] = raw[k]; });
  return out;
}

// Diffusion Camera — docs/plans/STUDIO-ROADMAP-NEXT-PHASE-SONNET-HANDOFF.md
// Slice 1. A camera/look/post-processing feature (never an element mesh —
// see ClothStudio.jsx's composer chain), so it gets its own top-level recipe
// key, same treatment as `shotCam` (sanitizeShotCam above), not a nested
// field on any element instance. `focalTarget` is a REFERENCE — `'origin'`
// or an element instance id — resolved at render time against whatever
// instances currently exist, same "reference, not catalog-fixed data"
// precedent as glb-import's `appearance.assetId` (catalog.js). `locked` is
// this feature's own standalone lock (it has no element instance to hang a
// `random.groups` entry off of) — respected by both the Camera-only and
// Look-only randomize paths.
const DIFFUSION_CAMERA_NUMBER_KEYS = [
  'focusDistance', 'aperture', 'falloff', 'diffusionRadius', 'highlightBloom', 'foregroundBias', 'backgroundBias',
];
export function sanitizeDiffusionCamera(raw, fallback) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  if (isBool(raw.enabled)) out.enabled = raw.enabled;
  if (isBool(raw.locked)) out.locked = raw.locked;
  if (typeof raw.focalTarget === 'string' && raw.focalTarget.trim()) out.focalTarget = raw.focalTarget.trim().slice(0, 64);
  DIFFUSION_CAMERA_NUMBER_KEYS.forEach((k) => { if (isFiniteNum(raw[k])) out[k] = raw[k]; });
  return out;
}

const FX_NUMBER_KEYS = ['bloomStrength', 'bloomThreshold', 'grain', 'vignette', 't1', 't2', 't3'];
export function sanitizeFx(raw, fallback, { treatmentIds }) {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  if (isBool(raw.bloom)) out.bloom = raw.bloom;
  FX_NUMBER_KEYS.forEach((k) => { if (isFiniteNum(raw[k])) out[k] = raw[k]; });
  if ((treatmentIds || []).includes(raw.treatment)) out.treatment = raw.treatment;
  if (isHexColor(raw.colA)) out.colA = raw.colA;
  if (isHexColor(raw.colB)) out.colB = raw.colB;
  return out;
}

// A light can as used by the render/HUD effects (cloneCans/LIGHT_TEMPLATES,
// ClothStudio.jsx's `lightCans.map((c) => ... c.on ...)` render loop) — the
// exact shape whose missing validation let a null-can template crash render.
export function sanitizeCan(raw, fallback) {
  return {
    on: isBool(raw?.on) ? raw.on : fallback.on,
    color: isHexColor(raw?.color) ? raw.color : fallback.color,
    intensity: isFiniteNum(raw?.intensity) ? raw.intensity : fallback.intensity,
    az: isFiniteNum(raw?.az) ? raw.az : fallback.az,
    el: isFiniteNum(raw?.el) ? raw.el : fallback.el,
  };
}

export function sanitizeLightCans(raw, fallback) {
  if (!Array.isArray(raw) || raw.length !== 4) return fallback;
  return raw.map((c, i) => sanitizeCan(c, fallback[i]));
}

// elementLocks is read downstream as `Boolean(elementLocks[id]?.locked)`
// (ClothStudio.jsx) — Boolean("yes") is true, so an unvalidated non-boolean
// `locked` value would silently be treated as locked. Every kept entry's
// `locked` must be a REAL boolean, not merely truthy; every key must be one
// of `validIds` (the ids this recipe actually restores) — an id from a
// stale/foreign recipe is dropped rather than kept as orphaned data.
export function sanitizeElementLocks(raw, validIds) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const idSet = new Set(validIds || []);
  Object.keys(raw).forEach((id) => {
    if (!idSet.has(id)) return;
    const entry = raw[id];
    if (entry && typeof entry === 'object' && isBool(entry.locked)) {
      out[id] = { locked: entry.locked };
    }
  });
  return out;
}
