// art-scene-def.mjs — Phase 5 scene/background parity (Slice B/C). Pure
// scene-definition logic over the vendored ClothStudio tables: preset
// lookup, sceneTweaks composition (verbatim port of ClothStudio.jsx's
// composeSceneDef), and the asset-requirement resolution both the
// capability check (art-render-validation.mjs) and the renderer
// (art-render.mjs / buildSceneHtml) share — ONE composition path, so
// "supported" is always decided from the SAME effective scene the render
// would actually draw (a tweak can add or remove pano/groundTex, so
// support can never be judged from the preset alone).
//
// Zero Playwright/fs dependency — safe for the Vercel route bundle, same
// purity contract as art-render-validation.mjs.

import { SCENE_PRESETS, GROUND_TEXTURES, PANO_PLATES, FRAME_PRESETS } from './vendor/scene-presets.mjs';
import { computeCropSourceResolution } from './vendor/elements/video-export.js';

export { SCENE_PRESETS, GROUND_TEXTURES, PANO_PLATES, FRAME_PRESETS };

// ── Capture Frame parity (Final Render frame/crop round) ──────────────────
// The Studio's capture frame is a CROP: the largest centered rect of the
// frame's aspect, inset by a 0.92 safety margin, cut out of the live stage.
// Quick Export renders the stage at a boosted resolution chosen so that the
// crop lands EXACTLY on the frame's native pixel size (never upscaled) —
// elements/video-export.js computeCropSourceResolution inverts the margin
// math. Final Render reproduces the SAME contract deterministically: the
// recipe carries the live stage's aspect (`stageAspect`, captured at
// submission — composition depends on it, so it must be pinned), the page
// renders at the computed source resolution with the camera at the STAGE
// aspect (preserving what the user composed), and each captured frame is a
// pure region copy of the crop rect at native target resolution.

// Verbatim mirror of ClothStudio.jsx's computeFrameRect (the 0.92 margin
// MUST match — art-recipe.test.mjs's frame drift-guard extracts the real
// source text and fails if the live implementation changes shape).
export const FRAME_RECT_MARGIN = 0.92;
export function computeFrameRect(cw, ch, aspect) {
  let w = cw * FRAME_RECT_MARGIN;
  let h = w / aspect;
  if (h > ch * FRAME_RECT_MARGIN) { h = ch * FRAME_RECT_MARGIN; w = h * aspect; }
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

// Server-owned bound on the boosted SOURCE render (never client-supplied):
// a 16:9 stage feeding a 9:16 crop needs a ~3712×2087 source — real, and
// the cost native-resolution cropping inherently carries — but an extreme
// stage aspect must not be able to demand an unbounded canvas.
export const MAX_FRAME_SOURCE_DIMENSION = 4320;

/**
 * Resolves everything a framed render needs, or throws-by-return: null when
 * frameId is 'off' (full-canvas render, unchanged), `{ error }` when the
 * combination is genuinely unrenderable (precise message, never a silent
 * fallback). `stageAspect` is the recipe's captured live-stage aspect.
 */
export function resolveFrameRender({ frameId, stageAspect, targetWidth, targetHeight }) {
  if (!frameId || frameId === 'off') return null;
  const frame = Object.hasOwn(FRAME_PRESETS, frameId) ? FRAME_PRESETS[frameId] : null;
  if (!frame || !frame.w) return { error: `Unknown capture frame '${frameId}' — cannot derive a crop.` };
  if (frame.w !== targetWidth || frame.h !== targetHeight) {
    return { error: `Capture frame '${frameId}' renders at exactly ${frame.w}×${frame.h}; requested ${targetWidth}×${targetHeight}.` };
  }
  const aspect = Number.isFinite(stageAspect) && stageAspect > 0 ? stageAspect : 16 / 9;
  const source = computeCropSourceResolution({
    stageWidth: Math.round(aspect * 10_000), stageHeight: 10_000,
    targetWidth, targetHeight,
  });
  if (!source) return { error: 'Could not derive a crop source resolution for this stage aspect.' };
  if (source.width > MAX_FRAME_SOURCE_DIMENSION || source.height > MAX_FRAME_SOURCE_DIMENSION) {
    return { error: `The captured stage aspect (${aspect.toFixed(3)}) needs a ${source.width}×${source.height} source for a native-resolution '${frameId}' crop — over the ${MAX_FRAME_SOURCE_DIMENSION}px bound. Use a stage aspect closer to the frame's own.` };
  }
  const rect = computeFrameRect(source.width, source.height, frame.w / frame.h);
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    cropRect: rect,
    targetWidth,
    targetHeight,
  };
}

// Every pano plate id the system can reference — preset-embedded plus the
// Scene Lab's own selectable list (a sceneTweaks.pano can name any of
// these). A Set: absent id is always undefined, no prototype-chain lookup.
export const SCENE_PANO_IDS = new Set([
  ...Object.values(SCENE_PRESETS).map((p) => p.pano).filter(Boolean),
  ...PANO_PLATES.map((p) => p.id).filter(Boolean),
]);

export const GROUND_TEXTURE_IDS = new Set(Object.keys(GROUND_TEXTURES));

/**
 * Verbatim port of ClothStudio.jsx's composeSceneDef — preset + user
 * sceneTweaks → the effective scene definition. Field-presence semantics
 * matter: an ABSENT tweak leaves the preset value; `pano: ''` /
 * `groundTex: ''` explicitly REMOVE the preset's plate/surface; fogOn
 * toggles fog wholesale with color/density fallbacks.
 */
export function composeSceneDef(base, tweaks) {
  const sc = { ...(base || {}) };
  const t = tweaks || {};
  ['panoBlur', 'panoRotY', 'panoIntensity', 'ground', 'groundTint', 'groundY'].forEach((k) => {
    if (t[k] !== undefined) sc[k] = t[k];
  });
  if (t.pano !== undefined) sc.pano = t.pano || undefined;
  if (t.groundTex !== undefined) sc.groundTex = t.groundTex || undefined;
  if (t.fogOn !== undefined) {
    sc.fog = t.fogOn
      ? { color: t.fogColor || sc.fog?.color || '#20242c', density: t.fogDensity ?? sc.fog?.density ?? 0.05 }
      : null;
  } else if ((t.fogColor !== undefined || t.fogDensity !== undefined) && sc.fog) {
    sc.fog = { color: t.fogColor ?? sc.fog.color, density: t.fogDensity ?? sc.fog.density };
  }
  return sc;
}

/**
 * The one effective-scene resolution every consumer uses: preset (falling
 * back to 'thriller' exactly like ClothStudio's own
 * `getSceneDef(sceneId) || SCENE_PRESETS.thriller`) composed with the
 * recipe's normalized sceneTweaks.
 */
export function resolveEffectiveScene(recipe) {
  // Object.hasOwn, not a bare property read (Codex Slice-B/C P2 hardening):
  // this function is part of the RAW-recipe validation contract, and a bare
  // `SCENE_PRESETS['__proto__']` resolves to a real truthy value via the
  // prototype chain — a raw sceneId of '__proto__'/'constructor'/'toString'
  // would silently compose over Object.prototype instead of falling back to
  // 'thriller'. Same footgun BUILTIN_ENV_HDR_ASSETS' Map already closed on
  // the render side.
  const base = (typeof recipe?.sceneId === 'string' && Object.hasOwn(SCENE_PRESETS, recipe.sceneId))
    ? SCENE_PRESETS[recipe.sceneId]
    : SCENE_PRESETS.thriller;
  return composeSceneDef(base, recipe?.sceneTweaks);
}

/**
 * What a composed effective scene needs beyond pure procedural drawing:
 * `{ pano: '/hdr/x_2k.hdr'|null, groundTex: {key, map, rough, repeat}|null }`.
 * `unknownPano`/`unknownGroundTex` name anything referenced that is NOT in
 * the vendored tables — the capability layer turns those into precise
 * per-asset rejections instead of a mid-render 404.
 */
export function sceneAssetRequirements(effective) {
  const pano = effective?.pano || null;
  const groundTexKey = effective?.groundTex || null;
  // Object.hasOwn, same P2 hardening as resolveEffectiveScene above: a raw
  // groundTex of '__proto__'/'constructor'/'toString' must be an UNKNOWN
  // texture (precise rejection), never a truthy prototype-chain object this
  // spread would then smear into a nonsense requirement.
  const groundTexKnown = typeof groundTexKey === 'string' && Object.hasOwn(GROUND_TEXTURES, groundTexKey);
  const groundTex = groundTexKnown ? { key: groundTexKey, ...GROUND_TEXTURES[groundTexKey] } : null;
  return {
    pano: pano && SCENE_PANO_IDS.has(pano) ? pano : null,
    groundTex,
    unknownPano: pano && !SCENE_PANO_IDS.has(pano) ? pano : null,
    unknownGroundTex: groundTexKey && !groundTexKnown ? groundTexKey : null,
  };
}
