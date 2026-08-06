// art-render-validation.mjs — Slice 4d extraction. Pure capability/param
// validation for the art-scene-v2 Proof pipeline, with ZERO dependency on
// Playwright/node:http/node:child_process/filesystem — safe to import from
// a Vercel serverless API route (app/api/dashboard/proof-render/route.js)
// without bundling the heavy Playwright package into that function.
//
// Extracted verbatim from art-render.mjs (Slice 4c); that file now imports
// and re-exports these same names, so every existing import of
// `checkCapabilities`/`validateRenderParams`/`LIMITS`/`ArtRenderError` from
// './art-render.mjs' keeps working unchanged.

import { resolveEffectiveScene, sceneAssetRequirements } from './art-scene-def.mjs';

export class ArtRenderError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ArtRenderError';
    this.details = details;
  }
}

// ── Capability enforcement (Codex re-review round 2, P1 completion) ────────
// This first real-content pass (see art-scene.mjs's own header comment)
// implements the cloth verlet sim + seeded bump texture (now genuinely
// driven by mat.bump/mat.bumpTiling, not hardcoded — see art-scene.mjs) +
// lighting/camera/solid-background/artwork/environment-IBL only. It does
// NOT implement: FX, the extra catalog
// elements (extraInstances — including data-only glass duplicates; the
// PRIMARY glass-petal-sphere itself IS rendered as of the Phase 5
// glass-parity pass), non-solid backgrounds, the frame/crop overlay, or the custom
// holographic material shader. A recipe that REQUESTS any of those must
// never produce a silently-successful Proof that just quietly omitted them
// — either the render is rejected outright (the default), or the caller
// explicitly opts into a best-effort render that still REPORTS exactly
// what was requested-but-unsupported (never silent either way). Slice 4d's
// production job-creation path (api/_lib/proof-render-jobs.cjs) never
// permits the best-effort path — an unsupported recipe is always rejected
// outright there, no `allowUnsupportedFeatures` escape hatch.
//
// ── Full field-by-field audit (every normalized art-scene-v2 field) ───────
// Genuinely rendered, no capability gate needed: mat.{baseColor, roughness,
// metalness, clearcoat, coatRoughness, sheen, iridescence, bump, bumpTiling},
// phys.* (full verlet sim), anim.* (wind), lightCans, shotCam, clothAspect
// (incl. 'auto' + artworkRatio), artworkId, bgColor, perf, lookSeed,
// envId/envIntensity (Phase 5, STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
// HANDOFF.md — real IBL: procedural RoomEnvironment for 'room', a genuine
// local .hdr load + PMREMGenerator for sunset/dusk/hall/night, envIntensity
// applied as material.envMapIntensity on both cloth materials — see
// art-scene.mjs's setupEnvironment()), glass (the PRIMARY glass-petal-
// sphere, Phase 5 glass-parity pass — verbatim petal/material port with
// fixed-timestep auto-rotate; see art-scene.mjs's glass block), diffusionCamera
// (Phase B, "Interrupted export recovery" — the vendored two-pass
// diffusion/treatment EffectComposer chain, verbatim DIFFUSION_SHADER/
// TREATMENT_SHADER, real per-frame focal-target resolution via the
// vendored diffusion-focus.js; see art-scene.mjs's composer block and this
// phase's checkpoint for the composer-activation decision).
// Provenance-only, genuinely no rendering effect at ANY value (not a gap —
// see the Slice 4c checkpoint's own reasoning for hudOn/elementLocks/
// randomizeIntensity): cam (orbit-drag toggles — no orbit interaction
// exists in a static Proof render), lightTemplate (informational label for
// how lightCans was generated — lightCans itself is already rendered),
// camSeed/sceneSeed (provenance for already-resolved concrete values),
// videoSeconds/videoFormat (the BROWSER's own local export settings,
// entirely orthogonal to this render pipeline's own fps/durationSeconds),
// elementFormatId/elementQualityTier (only meaningful once extraInstances
// is non-empty, which is separately gated below). sceneId/sceneTweaks are
// genuinely rendered once bgMode==='scene' (Slice B/C scene parity — no
// longer provenance-only). bgFx.fit/shiftY stay provenance-only (inert
// until bgMode:'image' itself renders — still gated below); bgFx.diffusion
// is genuinely rendered whenever diffusionCamera.enabled renders (feeds
// uBgDiffusion).
// Capability-gated below because this pass does NOT implement them:
// fx/fxPresetId, extraInstances, bgMode 'image'/
// 'transparent' (bgMode 'scene' IS rendered — Slice B/C scene parity),
// frameId!=='off' (the frame/crop overlay), and the 7 mat.* fields the
// custom holographic shader alone controls (holoIntensity/holoScale/
// bandFreq/saturation/hueShift/sparkle/specTint) whenever any of them
// isn't at its default.
//
// ── Phase 0.5 gate-bug fix (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
// HANDOFF.md) ───────────────────────────────────────────────────────────
// clothShape and textLayers were being silently dropped: art-recipe.mjs
// never carried them into the normalized recipe, so a 'tshirt'/'device'
// scene rendered as the wrong (flat sheet) primary shape, and a scene with
// hero text rendered with no text at all — both with zero warning/rejection.
// Both are gated below now. `tshirtPrint`/`devicePrimary`/`sceneTweaks`
// need NO separate gate — see art-recipe.mjs's normalizeScene docstring for
// the direct-inspection proof that each is fully inert unless an
// already-gated feature (clothShape/background/fx) is also active. `bgFx`
// likewise needs no separate gate — see that same docstring for why (its
// one non-inert field, `diffusion`, has only two valid states and both are
// genuinely rendered, exactly like diffusionCamera itself).
const HOLO_MATERIAL_DEFAULTS = { holoIntensity: 0, holoScale: 11, bandFreq: 0.48, saturation: 1, hueShift: 0, sparkle: 0, specTint: 1 };

// Same "is this a usable http(s) URL" check services/studio-render/recipe.mjs's
// own isValidUrl uses for the Video Promo pipeline's target url — duplicated
// (one line) rather than imported, matching this file's own established
// "two parallel pipelines, small helpers duplicated rather than cross-
// imported" convention (see art-recipe.mjs's header comment).
export const isValidHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));

// Environment/IBL (envId/envIntensity) is now fully implemented (Phase 5) —
// no capability gate for it at all. A normalized recipe's DEFAULT
// envIntensity is 0.65 (art-recipe.mjs), which used to make the literal
// default recipe report unsupported; it's now genuinely rendered like any
// other value in its already-clamped [0, 2.5] range, for every envId
// (an unrecognized envId already falls back to 'room' during
// normalization, so there is no out-of-range envId this render pass could
// ever be asked to honor).
const CAPABILITY_CHECKS = [
  // 'diffusionCamera' was removed from this list by Phase B ("Interrupted
  // export recovery" — STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md)
  // — art-scene.mjs now genuinely renders the two-pass diffusion/treatment
  // composer chain (vendored verbatim shader source + real per-frame focal
  // resolution) whenever diffusionCamera.enabled is true. 'fx' stays gated
  // (below) — the composer is built with default/inert fx values only
  // (bloom off, grain/vignette 0, treatment 'none'); a diffusionCamera-
  // enabled recipe that ALSO requests non-default fx still rejects on the
  // 'fx' check exactly as before.
  { feature: 'fx', check: (r) => Boolean(r.fx?.bloom) || (r.fx?.grain > 0) || (r.fx?.vignette > 0) || (Boolean(r.fx?.treatment) && r.fx.treatment !== 'none') || Boolean(r.fxPresetId) },
  // 'glass' (the PRIMARY glass-petal-sphere, r.glass) was removed from this
  // list by the Phase 5 glass-parity pass — art-scene.mjs now genuinely
  // renders it (verbatim petal geometry/material port, fixed-timestep
  // auto-rotate, clarity/transmission/tint/scale/position/rotationOffset all
  // honored; deterministic-regression evidence in art-render.test.mjs).
  // Data-only glass DUPLICATES still arrive via extraInstances and stay
  // gated below.
  { feature: 'extraInstances', check: (r) => Array.isArray(r.extraInstances) && r.extraInstances.length > 0 },
  // Slice B/C scene-background parity: bgMode 'scene' is genuinely rendered
  // now (procedural backdrop + fog + ground + pano/groundTex — see
  // art-scene.mjs's scene-background block), so the old blanket
  // `bgMode !== 'color'` gate is gone. 'image' (a browser-local uploaded
  // background image, never uploaded anywhere this server can see) and
  // 'transparent' (alpha has no representation in an H.264 MP4) remain
  // precisely gated — Slice D scope. Scene-asset availability is checked
  // separately below against the COMPOSED effective scene.
  { feature: 'background-image', check: (r) => r.bgMode === 'image' },
  { feature: 'background-transparent', check: (r) => r.bgMode === 'transparent' },
  // Capture Frame parity round: a KNOWN frame is genuinely rendered now
  // (native-resolution crop — see art-scene-def.mjs resolveFrameRender);
  // only a present-but-unknown id rejects, precisely, never a silent
  // fall-back to full canvas (art-recipe.mjs sets frameIdInvalid).
  { feature: 'frame-unknown', check: (r) => r.frameIdInvalid === true },
  // Slice E: clothShape 'tshirt' is genuinely rendered (the vendored
  // hanging-tshirt factory runs IN the page). Slice F1: the device SHELL
  // with its deterministic placeholder screen renders too — what remains
  // gated is each SCREEN SOURCE, by name, until it has a real render path.
  //
  // 'device-screen-live' LIFTED (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
  // HANDOFF.md, "Live website frames on the device screen" checkpoint): the
  // gate existed only because nothing could render a live URL — art-
  // render.mjs now genuinely captures a real scrolling frame sequence from
  // devicePrimary.liveUrl (services/studio-render/live-site-capture.mjs's
  // captureDeviceLiveFrames, reusing render.mjs's own proven capture
  // reasoning) and art-scene.mjs plays those frames on the device screen,
  // output-frame-mapped to captured-frame exactly like the Video Promo
  // pipeline's scene.mjs already does. This is a genuine architecture
  // change from every other gate in this file: a live site can change
  // between two renders of the "same" recipe (not deterministic) — an
  // explicit, accepted tradeoff for showing the REAL site, not a bug. Only
  // a REQUESTED-but-unusable URL still rejects, precisely — never a silent
  // placeholder fallback (same "a sourced screen must render its source or
  // fail" discipline as device-screen-still-invalid below).
  {
    feature: 'device-screen-live',
    check: (r) => {
      if (r.clothShape !== 'device') return false;
      const wantsLive = r.devicePrimary?.live === true || Boolean(r.devicePrimary?.liveUrl);
      return wantsLive && !isValidHttpUrl(r.devicePrimary?.liveUrl);
    },
  },
  { feature: 'device-screen-capture', check: (r) => r.clothShape === 'device' && Boolean(r.devicePrimary?.captureUrl) },
  { feature: 'device-screen-upload', check: (r) => r.clothShape === 'device' && Boolean(r.devicePrimary?.uploadAssetId) },
  // Slice F2: a present-but-malformed pinned-still reference is a PRECISE
  // rejection, never a silent placeholder fallback (a sourced screen must
  // render its source or fail). A VALID screenStill needs no gate — it IS
  // the supported path (existence/ownership are checked at job creation
  // against Storage, which a pure capability function cannot do).
  { feature: 'device-screen-still-invalid', check: (r) => r.clothShape === 'device' && r.devicePrimary?.screenStillInvalid === true },
  { feature: 'textLayers', check: (r) => Array.isArray(r.textLayers) && r.textLayers.some((l) => l?.on !== false) },
  {
    feature: 'holographicMaterial',
    check: (r) => {
      const m = r.mat || {};
      return Object.entries(HOLO_MATERIAL_DEFAULTS).some(([key, def]) => (m[key] ?? def) !== def);
    },
  },
];

/**
 * Returns `{ supported, unsupportedFeatures }` for `recipe` against exactly
 * what this render pass implements. `unsupportedFeatures` is always a
 * complete list (never short-circuits at the first match) so a caller/report
 * sees everything that was requested but will be skipped, not just one item.
 */
export function checkCapabilities(recipe) {
  const unsupportedFeatures = CAPABILITY_CHECKS.filter(({ check }) => check(recipe)).map(({ feature }) => feature);
  // Scene-asset availability (Slice B/C) — judged from the COMPOSED
  // effective scene (preset + sceneTweaks), never the preset alone: a tweak
  // can add or remove a pano/groundTex requirement. Normalized recipes can
  // only ever reference allowlisted assets (sanitizeSceneTweaks +
  // SCENE_PRESET_IDS enforce that upstream), so these fire only for a RAW/
  // un-normalized recipe naming something outside the vendored tables —
  // precise, per-asset rejection instead of a mid-render 404.
  if (recipe?.bgMode === 'scene') {
    const requirements = sceneAssetRequirements(resolveEffectiveScene(recipe));
    if (requirements.unknownPano) unsupportedFeatures.push(`scene-pano:${requirements.unknownPano}`);
    if (requirements.unknownGroundTex) unsupportedFeatures.push(`scene-ground-texture:${requirements.unknownGroundTex}`);
  }
  return { supported: unsupportedFeatures.length === 0, unsupportedFeatures };
}

// ── Local render control validation (Codex re-review round 2, P2) ─────────
// width/height/fps/durationSeconds/warmupFrames all get string-interpolated
// into generated HTML (art-scene.mjs's buildSceneHtml) and drive real local
// compute (Playwright frame captures, ffmpeg encode) — every one of them is
// strictly validated HERE, before any of that work starts. Slice 4d's API
// route calls the SAME validateRenderParams before ever creating a job, so
// an invalid/excessive request is rejected at request time, not discovered
// later by a worker.
export const LIMITS = {
  MIN_DIMENSION: 16, MAX_DIMENSION: 1920,
  MAX_FPS: 60,
  MAX_DURATION_SECONDS: 30,
  MAX_WARMUP_FRAMES: 60,
  // Deliberately tighter than MAX_FPS * MAX_DURATION_SECONDS (60 * 30 = 1800)
  // — an independent cap, not a mechanical product of the other two, so it
  // can genuinely reject a combo where fps and durationSeconds are each
  // individually within their own limit but jointly excessive.
  MAX_TOTAL_FRAMES: 900,
  // Independent of the individual caps above — stops a caller from maxing
  // out width AND height AND fps AND duration simultaneously even though
  // each individual value is within its own allowed range.
  //
  // Raised from the original 500,000,000 (Phase 4, STUDIO-DETERMINISTIC-
  // FINAL-RENDER-SONNET-HANDOFF.md) — that value was sized for the small
  // 640×360 Proof profile alone and would reject every real Final Render
  // preset. Worst case across FINAL_RENDER_PRESETS (below) at Studio's own
  // max duration option (15s, VIDEO_SECONDS_OPTIONS in art-recipe.mjs):
  // landscape 1920×1080 @ 60fps × 15s = 900 frames = 1,866,240,000. 2 billion
  // leaves ~7% headroom without opening the door to an arbitrary client-
  // controlled blow-up — FINAL_RENDER_PRESETS is still a fixed, small,
  // allowlisted set (Phase 4's own non-negotiable), not a raised ceiling on
  // free-form width/height/fps/duration combinations. Phase 6's own
  // measured wall-time/memory/cost-per-preset pass is the empirical check
  // on whether the CPU-only container can actually sustain this within
  // TOTAL_RENDER_DEADLINE_MS — this constant only establishes what's
  // syntactically reachable, not that it's been proven fast/cheap enough.
  MAX_PIXEL_FRAME_BUDGET: 2_000_000_000,
};

// ── Final Render presets (Phase 4) — "an allowlisted, server-validated
// preset rather than arbitrary client-controlled resource values." Every
// entry is a fixed, complete {width,height,fps} tuple; a client can only
// ever select an `id` from this list (app/api/dashboard/proof-render/
// route.js's 'create-final' action resolves it server-side — the request
// body never carries raw width/height/fps for this action at all).
// Duration/aspect ARE still caller-chosen (Studio's own VIDEO_SECONDS_OPTIONS
// / clothAspect, "reuse the Studio's selected duration/aspect where
// supported") but bounded by the existing validateRenderParams/LIMITS below,
// same as every other render request.
//
// 4K is deliberately NOT included yet — the handoff's own Phase 4 guidance:
// "4K, 30 FPS only after measured canary evidence supports the deadline and
// memory budget," which Phase 6 has not yet produced. Landscape/square/
// portrait 1080p dimensions mirror ClothStudio.jsx's own established
// RESOLUTION_TIERS 1x numbers (elements/video-export.js) so "1080p" means
// the SAME concrete pixel size Quick Export already uses that word for.
export const FINAL_RENDER_PRESETS = [
  { id: 'landscape-1080p-30', label: '1080p Landscape · 30fps', width: 1920, height: 1080, fps: 30 },
  { id: 'landscape-1080p-60', label: '1080p Landscape · 60fps', width: 1920, height: 1080, fps: 60 },
  { id: 'square-1080p-30', label: '1080p Square · 30fps', width: 1080, height: 1080, fps: 30 },
  { id: 'square-1080p-60', label: '1080p Square · 60fps', width: 1080, height: 1080, fps: 60 },
  { id: 'portrait-1080p-30', label: '1080p Portrait · 30fps', width: 1080, height: 1350, fps: 30 },
  { id: 'portrait-1080p-60', label: '1080p Portrait · 60fps', width: 1080, height: 1350, fps: 60 },
  // Capture Frame parity round — the real FRAME_PRESETS catalog includes a
  // true 9:16 vertical (1080×1920, Reels/Stories/TikTok/Shorts); Final
  // Render needs a matching fixed allowlisted output. Same 1080-class
  // discipline as every other entry (4K stays behind the measured canary).
  { id: 'vertical-1080p-30', label: '1080×1920 Vertical · 30fps', width: 1080, height: 1920, fps: 30 },
  { id: 'vertical-1080p-60', label: '1080×1920 Vertical · 60fps', width: 1080, height: 1920, fps: 60 },
];

/**
 * The output-aspect FAMILY a recipe's Final Render must use (Capture Frame
 * parity round): an ACTIVE capture frame owns the output aspect — the
 * export IS that frame's crop — otherwise the sheet aspect decides exactly
 * as before. Server-owned: the route validates the client-selected
 * presetId against this and rejects mismatches precisely.
 */
export function finalRenderFamilyForRecipe(recipe) {
  const frameId = recipe?.frameId;
  if (frameId && frameId !== 'off') return frameId; // FRAME_PRESET ids ARE the family names (square/portrait/vertical/landscape)
  const clothAspect = recipe?.clothAspect;
  if (clothAspect === 'square') return 'square';
  if (clothAspect === 'portrait') return 'portrait';
  return 'landscape';
}

/** Resolves a Final Render preset id to its full {id,label,width,height,fps}, or null for an unknown id — the server-side gate every 'create-final' request goes through before a job is ever created. */
export function getFinalRenderPreset(id) {
  return FINAL_RENDER_PRESETS.find((p) => p.id === id) || null;
}

function assertFiniteInteger(name, value, { min, max }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ArtRenderError(`${name} must be a finite integer (got ${JSON.stringify(value)}).`);
  }
  if (value < min || value > max) {
    throw new ArtRenderError(`${name} must be between ${min} and ${max} (got ${value}).`);
  }
}

function assertFinitePositiveNumber(name, value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ArtRenderError(`${name} must be a finite positive number (got ${JSON.stringify(value)}).`);
  }
  if (value > max) {
    throw new ArtRenderError(`${name} must not exceed ${max} (got ${value}).`);
  }
}

/** Validates width/height/fps only — used by both renderArtScene and the lighter inspectScene. */
export function validateSceneDimensions({ width, height, fps }) {
  assertFiniteInteger('width', width, { min: LIMITS.MIN_DIMENSION, max: LIMITS.MAX_DIMENSION });
  assertFiniteInteger('height', height, { min: LIMITS.MIN_DIMENSION, max: LIMITS.MAX_DIMENSION });
  assertFinitePositiveNumber('fps', fps, LIMITS.MAX_FPS);
}

/**
 * Full render-parameter validation, including the bounded Proof limits and
 * the compound pixel-frame work budget. Returns the validated `totalFrames`.
 * Every failure throws `ArtRenderError` before any Playwright/ffmpeg work
 * starts — strings, NaN, Infinity, negatives, zero, and excessive values are
 * all rejected the same way, never silently coerced or clamped.
 */
export function validateRenderParams({ width, height, fps, durationSeconds, warmupFrames }) {
  validateSceneDimensions({ width, height, fps });
  assertFinitePositiveNumber('durationSeconds', durationSeconds, LIMITS.MAX_DURATION_SECONDS);
  assertFiniteInteger('warmupFrames', warmupFrames, { min: 0, max: LIMITS.MAX_WARMUP_FRAMES });

  const totalFrames = Math.round(fps * durationSeconds);
  if (totalFrames < 1) throw new ArtRenderError('durationSeconds * fps must be at least 1 frame.');
  if (totalFrames > LIMITS.MAX_TOTAL_FRAMES) {
    throw new ArtRenderError(`Total frame count ${totalFrames} exceeds the maximum of ${LIMITS.MAX_TOTAL_FRAMES}.`);
  }
  const pixelFrameBudget = width * height * totalFrames;
  if (pixelFrameBudget > LIMITS.MAX_PIXEL_FRAME_BUDGET) {
    throw new ArtRenderError(
      `Requested render exceeds the pixel-frame work budget (${pixelFrameBudget} > ${LIMITS.MAX_PIXEL_FRAME_BUDGET}). Reduce width, height, fps, or duration.`,
    );
  }
  return totalFrames;
}
