// Element / Look / Render preset kinds — docs/plans/STUDIO-ROADMAP-NEXT-
// PHASE-SONNET-HANDOFF.md Slice 2 "Curated Set Generators + Preset Kinds".
// Scene Template already exists (elements/templates.js); this module adds
// the plan's three remaining preset KINDS — Element Preset, Look Preset,
// Render Preset — as three parallel sets of functions/constants, one per
// kind. Pure logic (no React, no three.js, no localStorage access at the
// call boundary — callers pass strings in/out), mirroring templates.js's
// EXACT style: schema versioning, the "next collision-safe id" scan idiom,
// MAX_* caps, name clamping.
//
// Scope, stated precisely (same as templates.js): LOCAL (localStorage)
// persistence only. `scope: 'local'` on every preset this module creates.
// Cloud persistence, admin-only Global promotion, and thumbnail capture are
// explicitly NOT implemented here.
//
// templates.js is IMPORT-ONLY from this module — never modified. Its
// generic, kind-agnostic list operations (addTemplate, findTemplate,
// renameTemplate, updateTemplateRecipe, duplicateTemplate, archiveTemplate,
// unarchiveTemplate, listActiveTemplates, listArchivedTemplates,
// exportTemplateJSON, serializeTemplateList, migrateTemplate) never
// hardcode `kind` and work unchanged for these new kinds — a UI wiring this
// module up should import those directly from templates.js rather than
// duplicating them here. NOTE: `parseTemplateListJSON` is the one exception
// — its internal validity check requires `kind === 'scene'`
// (templates.js's own `isValidTemplate`), so passing an element/look/render
// preset list through it will silently filter every entry out. That
// function is NOT reused here for that reason; a kind-aware equivalent
// (mirroring this module's own `importPresetJSON` parameterization) would
// need to be added before a UI relies on parsing a persisted preset list
// back from raw JSON.
//
// Only `createSceneTemplate` and `isValidTemplate` are Scene-Template-
// specific (hardcode `kind: 'scene'`) in templates.js — this module supplies
// their per-kind siblings: createElementPreset/createLookPreset/
// createRenderPreset and isValidElementPreset/isValidLookPreset/
// isValidRenderPreset. `importTemplateJSON` is similarly Scene-Template-
// specific (hardcodes `migrated.kind !== 'scene'`), so this module has its
// own single parameterized `importPresetJSON(list, json, now, { kind,
// createFn })` rather than three copy-pasted siblings.
//
// Recipe sanitizers (`sanitize<Kind>PresetRecipe`) follow scene-recipe.js's
// own "validate every nested field individually, never trust raw input,
// drop invalid members rather than rejecting the whole object" discipline —
// reusing scene-recipe.js's `isFiniteNum`/`isHexColor`/`isBool`/
// `sanitizeLightCans`/`sanitizeShotCam`/`sanitizeDiffusionCamera` rather than
// reimplementing those checks. `fx`/`mat` need per-known-key type checks but
// this module doesn't have the enum id lists those two fields validate
// against in ClothStudio.jsx (TREATMENTS/FX_PRESETS/FINISHES/material preset
// ids) — those two are shallow-typed (any key present on the fallback shape
// is kept when the raw value's type/format matches), never enum-checked.

import {
  TEMPLATE_SCHEMA_VERSION,
  migrateTemplate,
  addTemplate,
} from './templates.js';
import {
  isFiniteNum,
  isHexColor,
  isBool,
  sanitizeLightCans,
  sanitizeShotCam,
  sanitizeDiffusionCamera,
} from './scene-recipe.js';

const MAX_NAME_LENGTH = 60;

function clampPresetName(raw, fallback) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (s || fallback).slice(0, MAX_NAME_LENGTH);
}

/** Generic "scan existing ids for the next free N" idiom — same as templates.js's nextTemplateId, just parameterized by prefix. */
function nextPresetId(existingIds, prefix) {
  let maxN = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existingIds || []) {
    const m = re.exec(String(id || ''));
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return `${prefix}-${maxN + 1}`;
}

/** Shallow, fallback-shape-driven type check — for sub-objects (`fx`/`mat`) whose full enum id lists (TREATMENTS/FX_PRESETS/FINISHES/material presets) this module does not have access to. Keeps any key present on `fallback` whose raw value's type matches (hex-string keys must be valid hex; other strings just non-empty; booleans/numbers type-checked via isBool/isFiniteNum). Never enum-validates. Never throws. */
function sanitizeShallowTypedObject(raw, fallback) {
  const fb = (fallback && typeof fallback === 'object') ? fallback : {};
  const out = { ...fb };
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(fb).forEach((key) => {
    const rv = raw[key];
    const fv = fb[key];
    if (typeof fv === 'boolean') {
      if (isBool(rv)) out[key] = rv;
    } else if (typeof fv === 'number') {
      if (isFiniteNum(rv)) out[key] = rv;
    } else if (typeof fv === 'string') {
      if (isHexColor(fv)) {
        if (isHexColor(rv)) out[key] = rv;
      } else if (typeof rv === 'string' && rv) {
        out[key] = rv;
      }
    }
  });
  return out;
}

function sanitizeStringField(raw, fallback) {
  return (typeof raw === 'string' && raw) ? raw : fallback;
}

// ─────────────────────────────────────────────────────────────────────────
// Element Preset — recipe: { type: string, values: { material?, motion?,
// appearance? } }. The SAME { type, values } shape catalog.js's own built-in
// per-type `presets` arrays already use (e.g.
// ELEMENT_CATALOG['kinetic-rings'].presets[0]) — directly usable by
// scene-elements.js's existing `applyPresetToInstance`. Deliberately no
// `transform` (position/rotation/scale) — captures the selected element's
// PARAMETERS only, matching every built-in catalog preset's own precedent.
// ─────────────────────────────────────────────────────────────────────────

export const ELEMENT_PRESETS_KEY = 'holocloth-studio-element-presets-v1';
export const MAX_ELEMENT_PRESETS = 40;

export function nextElementPresetId(existingIds) {
  return nextPresetId(existingIds, 'element');
}

export function createElementPreset(list, { name, recipe, now }) {
  const id = nextElementPresetId((list || []).map((t) => t.id));
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id,
    scope: 'local',
    kind: 'element',
    name: clampPresetName(name, 'Untitled Element Preset'),
    recipe: recipe && typeof recipe === 'object' ? recipe : {},
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function isValidElementPreset(t) {
  if (!t || typeof t !== 'object') return false;
  if (t.schemaVersion !== TEMPLATE_SCHEMA_VERSION) return false;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (t.scope !== 'local') return false;
  if (t.kind !== 'element') return false;
  if (typeof t.name !== 'string' || !t.name) return false;
  if (!t.recipe || typeof t.recipe !== 'object') return false;
  if (typeof t.createdAt !== 'number') return false;
  if (typeof t.updatedAt !== 'number') return false;
  return true;
}

/** No deep validation of values.material/motion/appearance — applyPresetToInstance + normalizeElementInstance already fully validate/clamp when the preset is actually applied, same as catalog.js's own built-in presets, which are never separately re-validated at rest either. */
export function sanitizeElementPresetRecipe(raw, fallback) {
  const fb = (fallback && typeof fallback === 'object') ? fallback : {};
  const fbValues = (fb.values && typeof fb.values === 'object') ? fb.values : {};
  const r = (raw && typeof raw === 'object') ? raw : {};
  const rValues = (r.values && typeof r.values === 'object') ? r.values : {};

  const out = {
    type: (typeof r.type === 'string' && r.type) ? r.type : (typeof fb.type === 'string' ? fb.type : ''),
    values: {},
  };
  ['material', 'motion', 'appearance'].forEach((key) => {
    if (rValues[key] && typeof rValues[key] === 'object') {
      out.values[key] = rValues[key];
    } else if (fbValues[key] && typeof fbValues[key] === 'object') {
      out.values[key] = fbValues[key];
    }
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Look Preset — recipe: { fx, fxPresetId, mat, envId, envIntensity, bgMode,
// bgColor, sceneId, lightCans, lightTemplate, lookSeed, shotCam,
// diffusionCamera, camSeed }. Captures the Look scope's full state
// (materials/environment/background/lighting/camera-look/Diffusion Camera),
// independent of any one element instance or the render/export settings.
// ─────────────────────────────────────────────────────────────────────────

export const LOOK_PRESETS_KEY = 'holocloth-studio-look-presets-v1';
export const MAX_LOOK_PRESETS = 40;

export function nextLookPresetId(existingIds) {
  return nextPresetId(existingIds, 'look');
}

export function createLookPreset(list, { name, recipe, now }) {
  const id = nextLookPresetId((list || []).map((t) => t.id));
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id,
    scope: 'local',
    kind: 'look',
    name: clampPresetName(name, 'Untitled Look Preset'),
    recipe: recipe && typeof recipe === 'object' ? recipe : {},
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function isValidLookPreset(t) {
  if (!t || typeof t !== 'object') return false;
  if (t.schemaVersion !== TEMPLATE_SCHEMA_VERSION) return false;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (t.scope !== 'local') return false;
  if (t.kind !== 'look') return false;
  if (typeof t.name !== 'string' || !t.name) return false;
  if (!t.recipe || typeof t.recipe !== 'object') return false;
  if (typeof t.createdAt !== 'number') return false;
  if (typeof t.updatedAt !== 'number') return false;
  return true;
}

const DEFAULT_LOOK_SHOT_CAM = { use: false, az: 0, el: 0, dist: 3, fov: 40 };
const DEFAULT_LOOK_DIFFUSION_CAMERA = {
  enabled: false, locked: false, focalTarget: 'origin',
  focusDistance: 2.2, aperture: 0.4, falloff: 0.5, diffusionRadius: 0.3,
  highlightBloom: 0.2, foregroundBias: 0, backgroundBias: 0,
};
const DEFAULT_LOOK_LIGHT_CANS = [
  { on: false, color: '#ffffff', intensity: 1, az: 35, el: 40 },
  { on: false, color: '#ffffff', intensity: 1, az: -140, el: 15 },
  { on: false, color: '#ffffff', intensity: 1, az: -35, el: 20 },
  { on: false, color: '#ffffff', intensity: 1, az: 180, el: 60 },
];

export function sanitizeLookPresetRecipe(raw, fallback) {
  const fb = (fallback && typeof fallback === 'object') ? fallback : {};
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    fx: sanitizeShallowTypedObject(r.fx, (fb.fx && typeof fb.fx === 'object') ? fb.fx : {}),
    fxPresetId: sanitizeStringField(r.fxPresetId, typeof fb.fxPresetId === 'string' ? fb.fxPresetId : ''),
    mat: sanitizeShallowTypedObject(r.mat, (fb.mat && typeof fb.mat === 'object') ? fb.mat : {}),
    envId: sanitizeStringField(r.envId, typeof fb.envId === 'string' ? fb.envId : 'room'),
    envIntensity: isFiniteNum(r.envIntensity) ? r.envIntensity : (isFiniteNum(fb.envIntensity) ? fb.envIntensity : 1),
    bgMode: sanitizeStringField(r.bgMode, typeof fb.bgMode === 'string' ? fb.bgMode : 'color'),
    bgColor: isHexColor(r.bgColor) ? r.bgColor : (isHexColor(fb.bgColor) ? fb.bgColor : '#000000'),
    sceneId: sanitizeStringField(r.sceneId, typeof fb.sceneId === 'string' ? fb.sceneId : ''),
    lightCans: sanitizeLightCans(
      r.lightCans,
      (Array.isArray(fb.lightCans) && fb.lightCans.length === 4) ? fb.lightCans : DEFAULT_LOOK_LIGHT_CANS,
    ),
    lightTemplate: sanitizeStringField(r.lightTemplate, typeof fb.lightTemplate === 'string' ? fb.lightTemplate : 'studio'),
    lookSeed: isFiniteNum(r.lookSeed) ? r.lookSeed : (isFiniteNum(fb.lookSeed) ? fb.lookSeed : 1),
    shotCam: sanitizeShotCam(r.shotCam, (fb.shotCam && typeof fb.shotCam === 'object') ? fb.shotCam : DEFAULT_LOOK_SHOT_CAM),
    diffusionCamera: sanitizeDiffusionCamera(
      r.diffusionCamera,
      (fb.diffusionCamera && typeof fb.diffusionCamera === 'object') ? fb.diffusionCamera : DEFAULT_LOOK_DIFFUSION_CAMERA,
    ),
    camSeed: isFiniteNum(r.camSeed) ? r.camSeed : (isFiniteNum(fb.camSeed) ? fb.camSeed : 1),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Render Preset — recipe: { videoSeconds, videoFormat, frameId, clothAspect,
// artworkRatio, elementQualityTier }. Export/render settings only — never
// materials/lighting/camera (that's Look Preset's job).
// ─────────────────────────────────────────────────────────────────────────

export const RENDER_PRESETS_KEY = 'holocloth-studio-render-presets-v1';
export const MAX_RENDER_PRESETS = 40;

export function nextRenderPresetId(existingIds) {
  return nextPresetId(existingIds, 'render');
}

export function createRenderPreset(list, { name, recipe, now }) {
  const id = nextRenderPresetId((list || []).map((t) => t.id));
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id,
    scope: 'local',
    kind: 'render',
    name: clampPresetName(name, 'Untitled Render Preset'),
    recipe: recipe && typeof recipe === 'object' ? recipe : {},
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function isValidRenderPreset(t) {
  if (!t || typeof t !== 'object') return false;
  if (t.schemaVersion !== TEMPLATE_SCHEMA_VERSION) return false;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (t.scope !== 'local') return false;
  if (t.kind !== 'render') return false;
  if (typeof t.name !== 'string' || !t.name) return false;
  if (!t.recipe || typeof t.recipe !== 'object') return false;
  if (typeof t.createdAt !== 'number') return false;
  if (typeof t.updatedAt !== 'number') return false;
  return true;
}

export function sanitizeRenderPresetRecipe(raw, fallback) {
  const fb = (fallback && typeof fallback === 'object') ? fallback : {};
  const r = (raw && typeof raw === 'object') ? raw : {};
  const artworkRatioFallback = (isFiniteNum(fb.artworkRatio) || fb.artworkRatio === null) ? fb.artworkRatio : null;
  return {
    videoSeconds: isFiniteNum(r.videoSeconds) ? r.videoSeconds : (isFiniteNum(fb.videoSeconds) ? fb.videoSeconds : 5),
    videoFormat: (typeof r.videoFormat === 'string' && r.videoFormat) ? r.videoFormat : (typeof fb.videoFormat === 'string' ? fb.videoFormat : 'mp4'),
    frameId: (typeof r.frameId === 'string' && r.frameId) ? r.frameId : (typeof fb.frameId === 'string' ? fb.frameId : 'off'),
    clothAspect: (typeof r.clothAspect === 'string' && r.clothAspect) ? r.clothAspect : (typeof fb.clothAspect === 'string' ? fb.clothAspect : 'auto'),
    artworkRatio: (isFiniteNum(r.artworkRatio) || r.artworkRatio === null) ? r.artworkRatio : artworkRatioFallback,
    elementQualityTier: (typeof r.elementQualityTier === 'string' && r.elementQualityTier) ? r.elementQualityTier : (typeof fb.elementQualityTier === 'string' ? fb.elementQualityTier : 'draft'),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Shared import — one generic, parameterized function rather than three
// copy-pasted siblings (templates.js's own `importTemplateJSON` hardcodes
// `migrated.kind !== 'scene'`, so it can't be reused directly for these
// kinds). Same "Not a valid X." error-message style templates.js already
// uses. Always assigns a FRESH id via `createFn` and resets
// archived/timestamps — an import is always a new, active local preset,
// never a silent overwrite of something already saved.
// ─────────────────────────────────────────────────────────────────────────

export function importPresetJSON(list, json, now, { kind, createFn }) {
  let raw;
  try { raw = JSON.parse(json); } catch { return { list, error: 'Not valid JSON.' }; }
  const migrated = migrateTemplate(raw);
  if (!migrated) return { list, error: 'Unrecognized or unsupported template schema version.' };
  if (migrated.kind !== kind || !migrated.recipe || typeof migrated.recipe !== 'object') {
    const label = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} Preset`;
    return { list, error: `Not a valid ${label}.` };
  }
  const imported = createFn(list, { name: migrated.name, recipe: migrated.recipe, now });
  return { list: addTemplate(list, imported), error: null };
}

/**
 * Kind-aware sibling of templates.js's own parseTemplateListJSON — that
 * function's internal validity check requires `kind === 'scene'`
 * (templates.js's own isValidTemplate), so it silently returns an empty list
 * for any element/look/render preset list read back from localStorage. This
 * is the fix the module header flags as needed before a UI can persist/load
 * a preset list: same parse-then-migrate-then-validate shape, parameterized
 * by which kind's own isValid<Kind>Preset function to check against instead.
 */
export function parsePresetListJSON(json, { isValidFn }) {
  let raw;
  try { raw = JSON.parse(json || '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const migrated = migrateTemplate(entry);
    if (migrated && isValidFn(migrated)) out.push(migrated);
  }
  return out;
}
