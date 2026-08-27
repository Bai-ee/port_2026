'use client';

// HoloCloth Studio — the PAPER/CLOTH mode of the Mockup Studio (?tool=cloth).
// A verlet cloth simulator draped with a holographic-foil physical material:
// upload artwork onto the fabric, dial foil/iridescence/sparkle, pick a
// background, then export a still (PNG, optionally transparent) or a WebM
// motion loop — all client-side, no server render. Built from scratch on the
// repo's existing three/three-stdlib deps; shares the studio page's visual
// language (GLASS tokens + RailCard) but is fully self-contained so the
// fragile mockup-video code paths stay untouched.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, ChevronLeft, Download, Palette, Image as ImageIcon, Wind, Layers,
  RotateCcw, Zap, Video, Camera, SlidersHorizontal, Lightbulb, Disc, Focus,
  Sparkles, Shuffle, Undo2, Redo2, Cloud, Orbit, MousePointer2, RefreshCw, Aperture,
} from 'lucide-react';
import { GLASS, ui, RailCard, Slider } from './components/rail-ui';
import { getElementDefinition, listElementDefinitions, MAX_EXTRA_INSTANCES } from './elements/catalog';
import { normalizeElementInstance } from './elements/schema';
import { mulberry32, deriveSeed, snapToStep } from './elements/randomize';
import { budgetStatus, LIVE_PREVIEW_TIERS, estimateSceneCostDetailed } from './elements/quality';
import { createHistory, pushHistory, undoHistory, redoHistory } from './elements/history';
import {
  restoreExtraInstances, createSceneElement, duplicateInstance, removeInstance,
  normalizeSelection, isRenderableInstance, applyPresetToInstance, randomizeInstanceFields,
  randomizeAllElements, shouldSyncElementEntry, heroDuplicateWarnings, mergeElementLocks, restoreElementLocks,
} from './elements/scene-elements';
import {
  INTENSITY_TIERS, INTENSITY_META, DEFAULT_INTENSITY, isValidIntensity, rollNumeric, rollCategorical,
} from './elements/intensity';
import { OUTPUT_FORMATS as PLACEMENT_FORMATS, placementWarningForInstance, resolveEffectiveInstance } from './elements/placement';
import { getFactory, TSHIRT_WORLD_WIDTH, TSHIRT_WORLD_HEIGHT, tshirtModelRetry, deviceBottomLocalY, DEVICE_MODELS, deviceScreenAspect } from './elements/factories';
import { resetSim } from './elements/tshirt-mesh';
import {
  extractLegacyTshirtMigration, DEFAULT_TSHIRT_PRINT, buildPrimaryTshirtInstanceRaw, PRIMARY_ARTWORK_LOGO_ID,
} from './elements/primary-cloth';
import {
  createGLTFLoaderBundle, disposeGLTFLoaderBundle, loadGLBFromUrl, normalizeGLBTransform,
} from './elements/glb-loader';
import {
  SCENE_TEMPLATES_KEY, parseTemplateListJSON, serializeTemplateList, createSceneTemplate, addTemplate,
  findTemplate, renameTemplate, updateTemplateRecipe, duplicateTemplate, archiveTemplate, unarchiveTemplate,
  listActiveTemplates, listArchivedTemplates, exportTemplateJSON, importTemplateJSON,
} from './elements/templates';
import {
  isFiniteNum, isHexColor, sanitizeMat, sanitizePhys, sanitizeAnim, sanitizeCam,
  sanitizeGlass, sanitizeShotCam, sanitizeFx, sanitizeLightCans, sanitizeElementLocks, sanitizeDiffusionCamera,
  sanitizeTshirtPrint,
} from './elements/scene-recipe';
import {
  randomizeMotionOnly, randomizeElementColorsOnly, randomizeLookColors, randomizeLighting,
  randomizeCamera, computeLockSkipReport,
} from './elements/scope-randomize';
import {
  ELEMENT_PRESETS_KEY, createElementPreset, isValidElementPreset, sanitizeElementPresetRecipe,
  LOOK_PRESETS_KEY, createLookPreset, isValidLookPreset, sanitizeLookPresetRecipe,
  RENDER_PRESETS_KEY, createRenderPreset, isValidRenderPreset, sanitizeRenderPresetRecipe,
  importPresetJSON, parsePresetListJSON,
} from './elements/preset-kinds';
import {
  MASTER_SAVES_KEY, createMasterSave, isValidMasterSave, addMasterSave, deleteMasterSave,
} from './elements/master-saves';
import { CURATED_GENERATORS, generateCuratedSet, resolveCuratedDiffusionCamera } from './elements/curated-generators';
import {
  DIFFUSION_FOCAL_ORIGIN, DIFFUSION_FOCAL_MANUAL, DIFFUSION_FOCAL_PRIMARY_ARTWORK,
  isFocalTargetValid, resolveFocalTargetId, listDiffusionFocalTargets, cameraSpaceForwardDistance,
  computeBlurRadiusPx,
} from './diffusion-focus';
import {
  getBitrateFor, evaluateExportCapability,
  evaluateLiveExportGuard, isLiveTeardownReady, evaluateLiveTeardownDeadline, planDeviceScreenSteps, shouldResumeLiveAfterExport,
  chooseCaptureFps, DEFAULT_CAPTURE_FPS, HIGH_CAPTURE_FPS, startExportCapture, startMediaRecorderWithFallback,
  canSustainExportCapture, describeUnsustainableCapture, isScreenMaterialStranded,
  evaluateLiveRecordEligibility, evaluateDisplaySurface, computeDisplayCaptureRect,
  shouldRetryDisplayCaptureWithoutPreferCurrentTab, describeDisplayCaptureError,
  evaluateScreenShareEligibility, buildScreenShareRequest, buildBasicScreenShareRequest,
  shouldRetryScreenShareWithBasicOptions, describeScreenShareError,
  describeSharedSurfaceForScreen, computeScreenCoverFit,
} from './elements/video-export';
import StudioElementsCard from './components/StudioElementsCard';
import StudioElementInspector from './components/StudioElementInspector';
import DeviceScreenControl from './components/DeviceScreenControl';
import { computeBackgroundCover, computeContainLayout } from './bg-cover';
import { CAMERA_TEMPLATES, buildCameraTemplateTimeline } from './camera-templates';
import SceneTemplatesCard from './components/SceneTemplatesCard';
import MasterSavesCard from './components/MasterSavesCard';
import CloudTemplateSection from './components/CloudTemplateSection';
import StudioHeroTextCard from './components/StudioHeroTextCard';
import StudioTimelineStrip from './components/StudioTimelineStrip';
import {
  MAX_TEXT_LAYERS, sanitizeTextLayer, sanitizeTextLayers, createTextLayer, fontById, googleFontCssUrl,
  resolveFrameRect, buildTextCanvasSpec, layoutTextPlane, layoutTextPlaneWorld, TEXT_WORLD_STAGE, TEXT_CANVAS_SCALE, computeTextAnimState,
  TEXT_ANIM_TRACKING_MAX_MUL, HERO_LAYOUT_PRESETS,
} from './text-layers';
import {
  MAX_TIMELINE_KEYFRAMES, DEFAULT_TIMELINE, sanitizeTimeline, timelineDuration, resolveTrackState,
  blendRecipes, blendOrbitPose, buildTimelineSubmission, stripDeviceScreenSource,
} from './timeline';

// ── Config ───────────────────────────────────────────────────────────────────
// v9 — user-approved opening material (white metallic-matte, full clearcoat);
// the bump discards older saves so the approved defaults actually land.
const SETTINGS_KEY = 'holocloth-studio-defaults-v9';
// Artwork library — built-in looks shipped with the tool + user uploads saved
// per-browser (localStorage data URLs; no account needed on the public page).
const BUILTIN_ARTWORKS = [
  { id: 'brock',        label: 'Brock Electronics',  url: '/img/holocloth-artwork-flyer-2.jpg' },
  { id: 'viva-program', label: 'Viva Program Flyer', url: '/img/holocloth-default-artwork.jpg' },
];
const DEFAULT_ARTWORK_ID = 'brock';
const ARTWORK_LIB_KEY = 'holocloth-artwork-library-v1';
const loadArtworkLib = () => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(ARTWORK_LIB_KEY) || '[]') || []; } catch { return []; }
};

// hanging-tshirt front-logo library (docs/plans/STUDIO-HANGING-TSHIRT-
// SONNET-HANDOFF.md) — deliberately SEPARATE from ARTWORK_LIB_KEY above: that
// library re-encodes uploads as JPEG (canvas.toDataURL), which silently
// discards alpha transparency the handoff requires a logo to preserve. This
// one stores the original uploaded file bytes as-is (whatever the browser's
// FileReader.readAsDataURL produces for the source PNG/JPEG/WebP — see
// LogoArtworkControl.jsx), never re-encoded. Browser-local only, same
// "degrades honestly on another device" story as every other browser-local
// asset library in this file.
const TSHIRT_LOGO_LIB_KEY = 'holocloth-tshirt-logo-library-v1';
const loadLogoLib = () => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(TSHIRT_LOGO_LIB_KEY) || '[]') || []; } catch { return []; }
};
// Device Mockup uploaded-screen images (Phase 3) — same browser-local,
// original-bytes library pattern as the T-shirt logos above; entries are
// { assetId, name, dataUrl, sizeBytes } referenced by the instance's
// appearance.uploadAssetId.
const DEVICE_SCREEN_LIB_KEY = 'holocloth-device-screen-library-v1';
const loadDeviceScreenLib = () => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(DEVICE_SCREEN_LIB_KEY) || '[]') || []; } catch { return []; }
};
const loadSavedDefaults = () => {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; }
};
// Scene Templates — local-only persistence, elements/templates.js owns the
// pure schema/validation; this is just the impure read/write pair at the
// call boundary (that module's own header states it never touches
// localStorage itself).
const loadSavedTemplates = () => {
  if (typeof window === 'undefined') return [];
  try { return parseTemplateListJSON(window.localStorage.getItem(SCENE_TEMPLATES_KEY)); } catch { return []; }
};

// Element/Look/Render preset kinds (Slice 2) — elements/preset-kinds.js owns
// the pure schema/validation (mirrors templates.js's own scope: it never
// touches localStorage itself); this is the same impure read boundary as
// loadSavedTemplates above, one per kind. Uses parsePresetListJSON (NOT
// templates.js's own parseTemplateListJSON, which hardcodes kind==='scene'
// and would silently empty any of these three lists).
const loadSavedElementPresets = () => {
  if (typeof window === 'undefined') return [];
  try { return parsePresetListJSON(window.localStorage.getItem(ELEMENT_PRESETS_KEY), { isValidFn: isValidElementPreset }); } catch { return []; }
};
const loadSavedLookPresets = () => {
  if (typeof window === 'undefined') return [];
  try { return parsePresetListJSON(window.localStorage.getItem(LOOK_PRESETS_KEY), { isValidFn: isValidLookPreset }); } catch { return []; }
};
const loadSavedRenderPresets = () => {
  if (typeof window === 'undefined') return [];
  try { return parsePresetListJSON(window.localStorage.getItem(RENDER_PRESETS_KEY), { isValidFn: isValidRenderPreset }); } catch { return []; }
};
// Master Saves — one-click full-state versions (elements/master-saves.js
// owns the pure schema); same impure read boundary as the loaders above.
const loadSavedMasterSaves = () => {
  if (typeof window === 'undefined') return [];
  try { return parsePresetListJSON(window.localStorage.getItem(MASTER_SAVES_KEY), { isValidFn: isValidMasterSave }); } catch { return []; }
};

// Final Render active-job reference (P1-C, Production lifecycle hardening
// round) — the job id lived ONLY in React state before this, so a refresh
// or navigation away mid-render silently stranded it even though the UI's
// own copy told users "come back later." This persists just the job id
// (never a cached status — the server's own current status is always
// re-fetched on rehydrate, the same discipline every other localStorage
// read in this file already follows: local storage is a REFERENCE, never a
// trusted source of truth). Deliberately its own key, distinct from every
// other _KEY above, so it can never collide with an unrelated Studio tool's
// own persisted state.
const FINAL_RENDER_JOB_KEY = 'holocloth-final-render-job-v1';
const loadPersistedFinalRenderJob = () => {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FINAL_RENDER_JOB_KEY) || 'null');
    return parsed && typeof parsed.jobId === 'string' && parsed.jobId ? parsed : null;
  } catch { return null; }
};
const savePersistedFinalRenderJob = (jobId) => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(FINAL_RENDER_JOB_KEY, JSON.stringify({ jobId, savedAt: Date.now() })); } catch { /* non-critical */ }
};
const clearPersistedFinalRenderJob = () => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(FINAL_RENDER_JOB_KEY); } catch { /* non-critical */ }
};

// Cloth sheet aspect presets — world units (camera sits ~2.6 away).
const CLOTH_ASPECTS = {
  portrait:  { w: 1.20, h: 1.60, label: 'Portrait' },
  square:    { w: 1.42, h: 1.42, label: 'Square' },
  landscape: { w: 1.72, h: 1.08, label: 'Landscape' },
};
// Perf → cloth grid density (longest edge segments) + renderer pixel-ratio cap.
// High is dense enough that tight metallic speculars stop revealing the grid
// facets ("visible squares") at closeup; drop to Medium/Low on weaker GPUs.
const PERF_LEVELS = {
  high:   { segs: 88, pr: 2,   label: 'High' },
  medium: { segs: 60, pr: 1.5, label: 'Medium' },
  low:    { segs: 36, pr: 1,   label: 'Low' },
};
const PIN_MODES = [
  { id: 'free-float',   label: 'Floating' },
  { id: 'top-edge',     label: 'Top edge' },
  { id: 'top-corners',  label: 'Top corners' },
  { id: 'four-corners', label: '4 corners' },
];
const FINISHES = ['glossy', 'satin', 'matte'];

// Default material state (mirrors a neutral "black cloth" starting point).
const DEFAULT_MAT = {
  preset: 'black-cloth', finish: 'glossy', baseColor: '#101114',
  holoIntensity: 0.55, holoScale: 8, bandFreq: 0.35,
  saturation: 0.6, hueShift: 0, sparkle: 0.25, specTint: 1,
  iridescence: 0.35, roughness: 0.12, metalness: 0.35,
  clearcoat: 0.5, coatRoughness: 0.08, sheen: 0.08,
  bump: 0.79, bumpTiling: 3,
};
// Material presets — whole-material looks; picking one overwrites the sliders.
// Optional non-mat keys per preset: `env` (light intensity) and `bg` (backdrop
// color, switches Background to Color mode) so a preset carries its full
// texture + lighting combination. `group` buckets the dropdown's optgroups.
const MATERIAL_PRESETS = {
  'black-cloth': { label: 'Black Cloth', group: 'CORE', ...DEFAULT_MAT, preset: 'black-cloth', holoIntensity: 0, sparkle: 0, iridescence: 0, clearcoat: 0, roughness: 0 },
  'holo-foil':   { label: 'Holo Foil',   group: 'CORE', ...DEFAULT_MAT, preset: 'holo-foil', baseColor: '#15151d', holoIntensity: 1, holoScale: 8, bandFreq: 0.42, saturation: 0.85, sparkle: 0.5, iridescence: 1, metalness: 0.9, roughness: 0.14, clearcoat: 0.65 },
  'oil-slick':   { label: 'Oil Slick',   group: 'CORE', ...DEFAULT_MAT, preset: 'oil-slick', baseColor: '#05060a', holoIntensity: 0.45, bandFreq: 0.18, saturation: 0.7, sparkle: 0, iridescence: 1, metalness: 0.55, roughness: 0.08, clearcoat: 1, coatRoughness: 0.05 },
  chrome:        { label: 'Chrome',      group: 'CORE', ...DEFAULT_MAT, preset: 'chrome', baseColor: '#cfd2d8', holoIntensity: 0.1, sparkle: 0, iridescence: 0.15, metalness: 1, roughness: 0.06, clearcoat: 0.3, bump: 0.25 },
  silk:          { label: 'Silk',        group: 'CORE', ...DEFAULT_MAT, preset: 'silk', baseColor: '#2a1038', finish: 'satin', holoIntensity: 0.12, sparkle: 0, iridescence: 0.2, metalness: 0.1, roughness: 0.45, clearcoat: 0.1, sheen: 0.9, bump: 0.4 },
  paper:         { label: 'Paper White', group: 'CORE', ...DEFAULT_MAT, preset: 'paper', baseColor: '#f4f1ea', finish: 'matte', holoIntensity: 0, sparkle: 0, iridescence: 0, metalness: 0, roughness: 0.85, clearcoat: 0, sheen: 0.15, bump: 0.55, bumpTiling: 4 },

  // ── Expressive looks — production-graded material + lighting combos,
  //    ordered dramatic → bright. Each stays inside the existing dials. ──
  'velvet-night': { label: 'Velvet Night', group: 'DRAMATIC', ...DEFAULT_MAT, preset: 'velvet-night', baseColor: '#1c0b2e', finish: 'matte', holoIntensity: 0.08, holoScale: 4, bandFreq: 0.1, saturation: 0.4, hueShift: 0.78, sparkle: 0.12, specTint: 0.6, iridescence: 0, metalness: 0, roughness: 0.9, clearcoat: 0, sheen: 1, bump: 0.5, bumpTiling: 5, env: 0.5, bg: '#07030d' },
  'midnight-drama': { label: 'Midnight Drama', group: 'DRAMATIC', ...DEFAULT_MAT, preset: 'midnight-drama', baseColor: '#05070c', holoIntensity: 0.7, holoScale: 5, bandFreq: 0.12, saturation: 0.35, hueShift: 0.6, sparkle: 0.08, specTint: 1, iridescence: 0.6, metalness: 0.7, roughness: 0.05, clearcoat: 1, coatRoughness: 0.03, sheen: 0, bump: 0.2, env: 0.4, bg: '#020204' },
  'neon-noir': { label: 'Neon Noir', group: 'DRAMATIC', ...DEFAULT_MAT, preset: 'neon-noir', baseColor: '#0d0416', holoIntensity: 1, holoScale: 12, bandFreq: 0.55, saturation: 1, hueShift: 0.83, sparkle: 0.35, specTint: 1, iridescence: 0.8, metalness: 0.85, roughness: 0.1, clearcoat: 0.7, coatRoughness: 0.05, bump: 0.3, env: 0.65, bg: '#0a0018' },
  'gothic-pearl': { label: 'Gothic Pearl', group: 'DRAMATIC', ...DEFAULT_MAT, preset: 'gothic-pearl', baseColor: '#26262c', holoIntensity: 0.35, holoScale: 3, bandFreq: 0.08, saturation: 0.25, sparkle: 0, specTint: 0.8, iridescence: 1, metalness: 0.25, roughness: 0.3, clearcoat: 0.5, coatRoughness: 0.15, sheen: 0.6, bump: 0.45, env: 0.7, bg: '#101014' },
  'acid-rave': { label: 'Acid Rave', group: 'EXPRESSIVE', ...DEFAULT_MAT, preset: 'acid-rave', baseColor: '#101408', holoIntensity: 1, holoScale: 18, bandFreq: 0.9, saturation: 1, hueShift: 0.28, sparkle: 0.8, specTint: 1, iridescence: 0.9, metalness: 0.8, roughness: 0.12, clearcoat: 0.8, coatRoughness: 0.04, bump: 0.35, bumpTiling: 6, env: 1.15, bg: '#0c1402' },
  'solar-flare': { label: 'Solar Flare', group: 'EXPRESSIVE', ...DEFAULT_MAT, preset: 'solar-flare', baseColor: '#3a1204', holoIntensity: 0.9, holoScale: 7, bandFreq: 0.3, saturation: 0.95, hueShift: 0.06, sparkle: 0.45, specTint: 1, iridescence: 0.5, metalness: 0.9, roughness: 0.18, clearcoat: 0.5, bump: 0.4, env: 1.5, bg: '#180a02' },
  'liquid-gold': { label: 'Liquid Gold', group: 'EXPRESSIVE', ...DEFAULT_MAT, preset: 'liquid-gold', baseColor: '#8a6118', holoIntensity: 0.25, holoScale: 4, bandFreq: 0.15, saturation: 0.6, hueShift: 0.11, sparkle: 0.25, specTint: 1, iridescence: 0.2, metalness: 1, roughness: 0.14, clearcoat: 0.6, coatRoughness: 0.08, bump: 0.5, bumpTiling: 5, env: 1.6, bg: '#131008' },
  'chrome-storm': { label: 'Chrome Storm', group: 'EXPRESSIVE', ...DEFAULT_MAT, preset: 'chrome-storm', baseColor: '#b9bec9', holoIntensity: 0.3, holoScale: 6, bandFreq: 0.2, saturation: 0.5, sparkle: 0.15, specTint: 1, iridescence: 0.4, metalness: 1, roughness: 0.03, clearcoat: 1, coatRoughness: 0.02, bump: 0.15, env: 2, bg: '#15181f' },
  'candy-gloss': { label: 'Candy Gloss', group: 'BRIGHT', ...DEFAULT_MAT, preset: 'candy-gloss', baseColor: '#f2a9c4', holoIntensity: 0.35, holoScale: 9, bandFreq: 0.3, saturation: 0.8, hueShift: 0.9, sparkle: 0.4, specTint: 0.9, iridescence: 0.55, metalness: 0.15, roughness: 0.1, clearcoat: 1, coatRoughness: 0.02, sheen: 0.2, bump: 0.2, env: 1.5, bg: '#fdeef4' },
  glacier: { label: 'Glacier', group: 'BRIGHT', ...DEFAULT_MAT, preset: 'glacier', baseColor: '#dfeef5', holoIntensity: 0.4, holoScale: 6, bandFreq: 0.18, saturation: 0.45, hueShift: 0.55, sparkle: 0.5, specTint: 0.7, iridescence: 0.9, metalness: 0.35, roughness: 0.08, clearcoat: 0.9, coatRoughness: 0.04, sheen: 0.3, bump: 0.3, env: 1.9, bg: '#eef4f8' },
  'pearl-daylight': { label: 'Pearl Daylight', group: 'BRIGHT', ...DEFAULT_MAT, preset: 'pearl-daylight', baseColor: '#f6f3ee', holoIntensity: 0.5, holoScale: 5, bandFreq: 0.14, saturation: 0.55, sparkle: 0.2, specTint: 0.6, iridescence: 1, metalness: 0.1, roughness: 0.22, clearcoat: 0.6, coatRoughness: 0.1, sheen: 0.5, bump: 0.35, env: 1.8, bg: '#f4f1ea' },
  'studio-white': { label: 'Studio White', group: 'BRIGHT', ...DEFAULT_MAT, preset: 'studio-white', baseColor: '#ffffff', holoIntensity: 0.15, holoScale: 8, bandFreq: 0.2, saturation: 0.3, sparkle: 0.1, specTint: 0.5, iridescence: 0.25, metalness: 0.05, roughness: 0.4, clearcoat: 0.3, coatRoughness: 0.12, sheen: 0.25, bump: 0.3, env: 2.1, bg: '#fbfaf7' },
};
// Dropdown optgroup order.
const PRESET_GROUPS = ['CORE', 'DRAMATIC', 'EXPRESSIVE', 'BRIGHT'];
// Opening material state — the user-approved default look, read verbatim from
// the approved session: bright metallic-matte sheet with heavy clearcoat.
const INITIAL_MAT = {
  preset: '', finish: 'matte', baseColor: '#ffffff',
  holoIntensity: 0, holoScale: 11, bandFreq: 0.48,
  saturation: 1, hueShift: 0, sparkle: 0, specTint: 1,
  iridescence: 0, roughness: 0.85, metalness: 1,
  clearcoat: 1, coatRoughness: 0.3, sheen: 0,
  bump: 0.26, bumpTiling: 2.5,
};
// Extreme-cloth defaults: FLOATING mode is weightless (gravity applies to
// pinned modes only), constraints run loose so throws crumple and fold, and
// REBOUND dials how fast (if at all) the sheet retracts to its rest pose —
// at 0 it stays wherever you drag it.
const DEFAULT_PHYS = {
  gravity: 2.7, damping: 0.9, stiffness: 0.85, rebound: 0, rumple: 0.79, pinMode: 'free-float',
};
// Ambient animation — the blowing-in-the-wind idle (default ON, cranked for
// dramatic motion). Turbulence scales the whole chaotic field.
const DEFAULT_ANIM = { on: true, turbulence: 0.6, speed: 1 };

// The material sliders, in the order the reference panel lists them.
const MATERIAL_SLIDERS = [
  ['holoIntensity', 'HOLO INTENSITY', 0, 1, 0.01],
  ['holoScale',     'HOLO SCALE',     1, 30, 1],
  ['bandFreq',      'BAND FREQ',      0, 2, 0.01],
  ['saturation',    'SATURATION',     0, 1, 0.01],
  ['hueShift',      'HUE SHIFT',      0, 1, 0.01],
  ['sparkle',       'SPARKLE',        0, 1, 0.01],
  ['specTint',      'SPEC TINT',      0, 1, 0.01],
  ['iridescence',   'IRIDESCENCE',    0, 1, 0.01],
  ['roughness',     'ROUGHNESS',      0, 1, 0.01],
  ['metalness',     'METALNESS',      0, 1, 0.01],
  ['clearcoat',     'CLEARCOAT',      0, 1, 0.01],
  ['coatRoughness', 'COAT ROUGHNESS', 0, 1, 0.01],
  ['sheen',         'SHEEN',          0, 1, 0.01],
  ['bump',          'BUMP',           0, 2, 0.01],
  ['bumpTiling',    'BUMP TILING',    1, 12, 0.5],
];

// ── Environment light — image-based lighting source. 'room' = the built-in
// procedural studio; the rest are shipped CC0 HDRIs (Poly Haven) that give
// reflections real-world richness instead of flat white boxes. ──
const ENV_PRESETS = {
  room:     { label: 'Studio (built-in)' },
  sunset:   { label: 'Venice Sunset',  url: '/hdr/venice_sunset_1k.hdr' },
  dusk:     { label: 'Desert Dusk',    url: '/hdr/qwantani_dusk_2_1k.hdr' },
  hall:     { label: 'Dancing Hall',   url: '/hdr/dancing_hall_1k.hdr' },
  night:    { label: 'Moonless Night', url: '/hdr/moonless_golf_1k.hdr' },
};

// ── Post FX — bloom glow + film grain + vignette, rendered through an
// EffectComposer so recordings and PNGs carry the look. ──
const DEFAULT_FX = {
  bloom: false, bloomStrength: 0.55, bloomThreshold: 0.8, grain: 0, vignette: 0,
  // Graphic treatment — one display-space look at a time. t1/t2/t3 are the
  // generic param slots; what each means is declared per treatment in
  // TREATMENTS below. colA/colB are the ink/paper (or shadow/highlight) pair.
  treatment: 'none', t1: 8, t2: 45, t3: 1, colA: '#101014', colB: '#f4f1ea',
};
// Two-pass finishing chain, in the approved scene → diffusion → treatment
// order: DIFFUSION_SHADER (Pass 1) samples the raw scene once, applies
// vignette + Diffusion Camera depth-of-field blur, and OWNS the tone-map +
// sRGB encode (three-stdlib 2.36.1 ships no OutputPass, and the composer's
// linear render target gets neither ACES nor sRGB encode for free — both are
// gated on rendering straight to the screen). TREATMENT_SHADER (Pass 2) then
// reads Pass 1's already-diffused, already-encoded output, applies the
// graphic treatment (#define-selected, compiled in only when a look is
// chosen) and film grain, and is the chain's actual OUTPUT pass. Splitting
// this into two real EffectComposer passes (rather than one shader that
// tries to do both) means a treatment always sees a diffused image — never
// the pre-blur source — AND each pass only samples what it needs once:
// diffusion's fixed 8 taps, then treatment's own (up to 9) taps, added
// rather than multiplied together.
//
// The depth buffer is the background mask: three never tone maps the backdrop
// (the clear colour is written straight through, and background textures set
// toneMapped=false), so tone mapping every pixel here would turn a pure-white
// backdrop into ~226 grey the moment any effect switched on. Untouched pixels
// keep depth 1.0, so they skip the tone map and get only the sRGB encode —
// which reproduces the direct-render path exactly. Only Pass 1 needs the
// depth texture; Pass 2 never touches raw scene data.
const DIFFUSION_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uRes: { value: null },
    uVignette: { value: 0 },
    // Active capture frame in UV space — the vignette is shaped to the frame
    // being exported, not to the canvas, so the crop carries a true falloff.
    // Full canvas (frame off) = centre 0.5, half 0.5, which reproduces the
    // plain radial vignette exactly.
    uFrameCenter: { value: null },
    uFrameHalf: { value: null },
    // Diffusion Camera — a plain runtime toggle (uDiffusionEnabled), not a
    // #define, so flipping it on/off never requires a shader recompile.
    // uFocusDistance is now a genuinely LIVE camera-space forward distance
    // to whatever `diffusionCamera.focalTarget` currently resolves to
    // (diffusion-focus.js `cameraSpaceForwardDistance`/`resolveFocalTargetId`
    // — recomputed every frame in the render loop below), except in
    // 'manual' target mode, where it IS the literal Focus Distance dial
    // value (a real focus ring) — see the Focal Target UI panel for the
    // full semantics.
    uDiffusionEnabled: { value: 0 },
    // Whether the untouched backdrop (rawDepth==1 — scene.background /
    // solid color / uploaded bg image) participates in the diffusion blur.
    // 1 = current behavior (backdrop blurs like far geometry, the Codex
    // background-policy fix); 0 = the Background card's "DIFFUSION ON
    // BACKGROUND: Off" — backdrop stays perfectly crisp while real scene
    // objects still blur. Vignette/grain/treatment are unaffected either
    // way, and the bg is never lit by scene lights to begin with.
    uBgDiffusion: { value: 1 },
    uFocusDistance: { value: 2.2 },
    uAperture: { value: 0.4 },
    uFalloff: { value: 0.5 },
    uDiffusionRadius: { value: 0.3 },
    uHighlightBloom: { value: 0.2 },
    uForegroundBias: { value: 0 },
    uBackgroundBias: { value: 0 },
    // Synced every frame from the ACTIVE camera (orbit or shot cam — see
    // activeCamera()) — replaces two hardcoded constants (0.05/60.0) that
    // happened to match both cameras' construction values today but had no
    // enforced relationship to them; a future camera with different
    // near/far would have silently mis-linearized depth.
    uNear: { value: 0.05 },
    uFar: { value: 60.0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uVignette;
uniform vec2 uFrameCenter;
uniform vec2 uFrameHalf;
uniform vec2 uRes;
uniform float uDiffusionEnabled;
uniform float uBgDiffusion;
uniform float uFocusDistance;
uniform float uAperture;
uniform float uFalloff;
uniform float uDiffusionRadius;
uniform float uHighlightBloom;
uniform float uForegroundBias;
uniform float uBackgroundBias;
uniform float uNear;
uniform float uFar;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// One source sample, vignetted (linear light, shaped to the capture frame)
// but deliberately left LINEAR/un-encoded — this pass is a MIDDLE pass in
// the composer chain (Pass 2, TREATMENT_SHADER, renders to screen), and
// three's toneMapping()/linearToOutputTexel() chunks no-op unless the pass
// writing them is the one actually rendering to screen. Tone map + sRGB
// encode happen exactly once, downstream in Pass 2's own tap() — doing it
// here would silently no-op (this exact trap, on this exact codebase) and
// leave the diffused image un-encoded. The diffusion blur below resamples
// through this so its taps stay consistent with the sharp pixel.
vec4 tap(vec2 uv){
  vec4 s = texture2D(tDiffuse, uv);
  if (uVignette > 0.001) {
    // Frame space: ±1 at the frame edges, so d matches the old full-canvas
    // numbers (0.5 edge-centre, 0.707 corner) whatever the crop's aspect is.
    vec2 q = (uv - uFrameCenter) / max(uFrameHalf, vec2(0.0001));
    s.rgb *= 1.0 - smoothstep(0.35, 0.72, length(q) * 0.5) * uVignette;
  }
  return s;
}

void main(){
  vec4 base = tap(vUv);
  vec3 col = base.rgb;

  // Diffusion Camera — a bounded, fixed-8-tap preview approximation of a
  // real bokeh/depth-of-field lens: a focal plane at uFocusDistance
  // (linearized from tDepth using the ACTIVE camera's own uNear/uFar —
  // diffusion-focus.js's linearizeDepth is the exact JS-side mirror of
  // this formula) stays sharp; everything outside a uFalloff-wide band
  // around it blurs, radius scaled by uDiffusionRadius/uAperture, brighter
  // pixels weighted up by uHighlightBloom (mimics real bokeh highlight
  // bleed). This is Pass 1's OWN output — Pass 2 (TREATMENT_SHADER) reads
  // it as its input, so a graphic treatment always composes with whatever
  // this blur produced, in the approved scene → diffusion → treatment order.
  //
  // Background policy: the original gate here (rawDepth < 0.999999) skipped
  // the untouched clear/backdrop entirely — it could never blur no
  // matter the focus distance, so the backdrop stayed perfectly flat and
  // sharp behind even a maximally-blurred subject, undermining any
  // focused-subject-vs-blurred-surroundings read. Removed: a rawDepth of
  // 1.0 now linearizes to exactly uFar (the standard formula's own
  // behavior at zN=1), which the CoC math below treats as "very far from
  // the focal plane" through the SAME falloff/bias math real geometry
  // uses — no special case. A flat backdrop colour is visually unaffected
  // by blurring (averaging identical samples reproduces the same colour),
  // so this only becomes visible once the backdrop actually has detail (a
  // gradient, bgTexture image, or a scene's own background grid) — exactly
  // where a real lens would show it. tDepth itself is never written here,
  // so Pass 2's own depth==1.0 tone-mapping skip is unaffected.
  // uBgDiffusion gate: with DIFFUSION ON BACKGROUND off, the untouched
  // clear/backdrop (rawDepth==1, where no geometry drew) is excluded from
  // the blur — a deliberate, user-controlled re-instatement of the old
  // rawDepth < 0.999999 gate, per-pixel, while real geometry keeps its
  // full depth-of-field behavior.
  if (uDiffusionEnabled > 0.5) {
    float rawDepth = texture2D(tDepth, vUv).x;
    if (uBgDiffusion > 0.5 || rawDepth < 0.999999) {
    float zN = rawDepth * 2.0 - 1.0;
    float dist = (2.0 * uNear * uFar) / (uFar + uNear - zN * (uFar - uNear));
    float diff = dist - uFocusDistance;
    float falloffDist = mix(0.15, 3.0, clamp(uFalloff, 0.0, 1.0));
    float coc = clamp(abs(diff) / max(falloffDist, 0.0001), 0.0, 1.0);
    float biasAmt = diff < 0.0 ? (1.0 + clamp(uForegroundBias, -1.0, 1.0)) : (1.0 + clamp(uBackgroundBias, -1.0, 1.0));
    coc = clamp(coc * max(biasAmt, 0.0), 0.0, 1.0);
    // Response curve reworked (Codex visual-correction round) — was
    // mix(1,18,radius)*mix(0.3,1,aperture) (~3.5px max at the shipped
    // defaults, ~18px even at both sliders maxed: imperceptible on a real
    // render target). Now mix(1,40,radius)*mix(0.4,1,aperture): minimum
    // stays subtle (~0.4px), the shipped defaults already reach ~8px, the
    // curve's own midpoint reaches ~14px, and maximum reaches 40px — same
    // fixed 8-tap cost either way (this changes tap SPACING, not tap
    // COUNT), see the round's docs for the measured frame-time comparison.
    float maxRadiusPx = mix(1.0, 40.0, clamp(uDiffusionRadius, 0.0, 1.0)) * mix(0.4, 1.0, clamp(uAperture, 0.0, 1.0));
    float radius = coc * maxRadiusPx;
    if (radius > 0.4) {
      vec2 texel = 1.0 / max(uRes, vec2(1.0));
      vec3 blurSum = vec3(0.0);
      float wSum = 0.0;
      const int DIFFUSION_TAPS = 8;
      for (int i = 0; i < DIFFUSION_TAPS; i++) {
        float ang = (6.28318 / float(DIFFUSION_TAPS)) * float(i);
        vec2 offs = vec2(cos(ang), sin(ang)) * radius * texel;
        vec3 s = tap(vUv + offs).rgb;
        float wgt = 1.0 + luma(s) * clamp(uHighlightBloom, 0.0, 1.0) * 2.0;
        blurSum += s * wgt;
        wSum += wgt;
      }
      vec3 blurred = blurSum / max(wSum, 0.0001);
      col = mix(col, blurred, coc);
    }
    } // uBgDiffusion backdrop gate
  }

  gl_FragColor = vec4(col, base.a);
}`,
};

// Pass 2 — the chain's actual OUTPUT pass (always renders to screen): tone
// map + sRGB encode Pass 1's linear, vignetted, diffusion-blurred output,
// THEN graphic treatment, THEN film grain. tDiffuse here is Pass 1's linear
// output, not yet display-encoded — see DIFFUSION_SHADER's tap() comment for
// why that encode step has to happen here, in whichever pass is actually
// last. With no treatment #define compiled in, this reduces to "encode +
// grain", so untreated output is byte-identical to before this split.
const TREATMENT_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uRes: { value: null },
    uT1: { value: 0 },
    uT2: { value: 0 },
    uT3: { value: 0 },
    uColA: { value: null },
    uColB: { value: null },
    uGrain: { value: 0 },
    uCleanAlphaHole: { value: 0 },
    uTime: { value: 0 },
    uFrameCenter: { value: null },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uGrain;
uniform float uCleanAlphaHole;
uniform float uTime;
uniform vec2 uFrameCenter;
uniform vec2 uRes;
uniform float uT1;
uniform float uT2;
uniform float uT3;
uniform vec3 uColA;
uniform vec3 uColB;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)) + uTime) * 43758.5453); }
float hashS(vec2 p){ return fract(sin(dot(p, vec2(269.5,183.3))) * 43758.5453); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// 4x4 ordered dither, built from the 2x2 Bayer matrix by the usual recursion
// (GLSL ES 1.0 can't index an array with a computed index).
float bayer2(vec2 c){ return c.y < 0.5 ? (c.x < 0.5 ? 0.0 : 2.0) : (c.x < 0.5 ? 3.0 : 1.0); }
float bayer4(vec2 p){
  vec2 q = floor(mod(p, 4.0));
  return (4.0 * bayer2(floor(q * 0.5)) + bayer2(mod(q, 2.0)) + 0.5) / 16.0;
}

// Pass 1's linear pixel, tone mapped + sRGB encoded — except on the bare
// backdrop, which three never tone maps (same depth==1.0 mask the original
// single-pass shader used). Every treatment resamples through this so
// multi-tap looks stay consistent with the untouched pixel.
vec4 tap(vec2 uv){
  vec4 s = texture2D(tDiffuse, uv);
  vec3 c = s.rgb;
  #if defined( TONE_MAPPING )
    if (texture2D(tDepth, uv).x < 0.999999) c = toneMapping(c);
  #endif
  return vec4(linearToOutputTexel(vec4(c, 1.0)).rgb, s.a);
}

void main(){
  vec4 base = tap(vUv);
  vec3 col = base.rgb;

  #ifdef FX_HALFTONE
    float ang = radians(uT2);
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    mat2 rotI = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
    vec2 cell = (rot * (vUv * uRes)) / max(uT1, 1.0);
    vec3 src = tap((rotI * ((floor(cell) + 0.5) * max(uT1, 1.0))) / uRes).rgb;
    float radius = sqrt(clamp(1.0 - luma(src), 0.0, 1.0)) * 0.72;
    float d = length(fract(cell) - 0.5);
    col = mix(src, mix(uColB, uColA, smoothstep(radius + 0.04, radius - 0.04, d)), uT3);
  #endif

  #ifdef FX_PIXEL
    float bs = max(uT1, 1.0);
    vec3 src = tap((floor(vUv * uRes / bs) + 0.5) * bs / uRes).rgb;
    float levels = max(2.0, uT2);
    col = floor(src * levels + 0.5) / levels;
  #endif

  #ifdef FX_POSTER
    float levels = max(2.0, uT1);
    float dth = (bayer4(vUv * uRes) - 0.5) * uT2 / levels;
    col = floor((base.rgb + dth) * levels + 0.5) / levels;
  #endif

  #ifdef FX_THRESHOLD
    float th = uT1 + (bayer4(vUv * uRes) - 0.5) * uT2;
    col = mix(uColA, uColB, step(th, luma(base.rgb)));
  #endif

  #ifdef FX_DUOTONE
    float l = pow(clamp(luma(base.rgb), 0.0, 1.0), max(uT2, 0.05));
    col = mix(base.rgb, mix(uColA, uColB, smoothstep(0.0, 1.0, l)), uT1);
  #endif

  #ifdef FX_CHROMA
    vec2 dir = vUv - uFrameCenter;
    float amt = (uT1 / max(uRes.x, 1.0)) * (1.0 + pow(length(dir) * 2.0, max(uT2, 0.1)) * 6.0);
    col.r = tap(vUv + dir * amt).r;
    col.b = tap(vUv - dir * amt).b;
  #endif

  #ifdef FX_SCANLINE
    float lines = max(uT1, 1.0);
    float s = sin((vUv.y + uTime * 0.02 * uT3) * lines * 6.28318);
    col = base.rgb * (1.0 - uT2 * 0.55 * (0.5 + 0.5 * s));
    float m = mod(vUv.x * uRes.x, 3.0);
    vec3 mask = vec3(m < 1.0 ? 1.18 : 0.88, (m >= 1.0 && m < 2.0) ? 1.18 : 0.88, m >= 2.0 ? 1.18 : 0.88);
    col *= mix(vec3(1.0), mask, uT2);
  #endif

  #ifdef FX_RISO
    float o = uT1 / max(uRes.x, 1.0);
    float i1 = 1.0 - luma(tap(vUv + vec2(o, o * 0.6)).rgb);
    float i2 = 1.0 - luma(tap(vUv - vec2(o * 0.8, o * 0.4)).rgb);
    col = vec3(0.96, 0.94, 0.88);
    col = mix(col, uColA, clamp(i1 * 0.95, 0.0, 1.0));
    col = mix(col, uColB, clamp(i2 * 0.6, 0.0, 1.0));
    col *= 1.0 - uT2 * 0.3 * hashS(floor(vUv * uRes / 2.0));
  #endif

  #ifdef FX_EDGES
    vec2 t = 1.0 / uRes;
    float l00 = luma(tap(vUv + vec2(-t.x, -t.y)).rgb);
    float l10 = luma(tap(vUv + vec2(0.0, -t.y)).rgb);
    float l20 = luma(tap(vUv + vec2(t.x, -t.y)).rgb);
    float l01 = luma(tap(vUv + vec2(-t.x, 0.0)).rgb);
    float l21 = luma(tap(vUv + vec2(t.x, 0.0)).rgb);
    float l02 = luma(tap(vUv + vec2(-t.x, t.y)).rgb);
    float l12 = luma(tap(vUv + vec2(0.0, t.y)).rgb);
    float l22 = luma(tap(vUv + vec2(t.x, t.y)).rgb);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float e = clamp(length(vec2(gx, gy)) * uT1 * 4.0, 0.0, 1.0);
    col = mix(mix(uColB, base.rgb, uT2), uColA, e);
  #endif

  #ifdef FX_SOLARIZE
    col = mix(base.rgb, abs(base.rgb - uT1) / max(1.0 - uT1, 0.01), uT2);
  #endif

  #ifdef FX_CROSSPROC
    vec3 c2 = clamp((base.rgb - 0.5) * (1.0 + uT2) + 0.5, 0.0, 1.0);
    vec3 tint = mix(uColA, uColB, luma(c2));
    col = mix(c2, clamp(c2 * tint * 1.7, 0.0, 1.0), uT1);
  #endif

  #ifdef FX_MIRROR
    float aspect = uRes.x / max(uRes.y, 1.0);
    vec2 p = (vUv - uFrameCenter) * vec2(aspect, 1.0);
    float span = 6.28318 / max(2.0, floor(uT1));
    float a = abs(mod(atan(p.y, p.x) + span * 0.5, span) - span * 0.5) + uT2;
    vec2 q = vec2(cos(a), sin(a)) * length(p) / vec2(aspect, 1.0);
    col = tap(clamp(q + uFrameCenter, vec2(0.001), vec2(0.999))).rgb;
  #endif

  // Grain last — a display-space film artefact; in linear light it would
  // vanish from the highlights.
  if (uGrain > 0.001) col += (hash(vUv * 1024.0) - 0.5) * uGrain * 0.25;
  // Live-screen hole hygiene (uCleanAlphaHole, set only while a live device
  // iframe sits behind the canvas): the canvas composites PREMULTIPLIED, so
  // any rgb > 0 written where alpha == 0 (grain noise, bloom bleed, kaleido
  // resampling) ADDS a ghost wash over the iframe instead of leaving the
  // hole clean. Zero the rgb wherever nothing opaque was drawn — the hole
  // (and any transparent-bg region) becomes truly clear glass.
  if (uCleanAlphaHole > 0.5) col *= smoothstep(0.0, 0.02, base.a);
  gl_FragColor = vec4(col, base.a);
}`,
};

// ── Glass form — abstract smooth refractive shell wrapped around the sheet
// (transmission material genuinely refracts the flyer seen through it). ──
// position: world-unit XYZ offset; rotationOffset: degrees, matches this
// file's existing shotCam.az/el convention (converted to radians only where
// applied to three.js — see the element position/rotation effect below).
// `clarity` (UI-labeled FROST) maps to roughness — sharper/frostier
// reflections and refraction, never transparency by itself (a
// MeshPhysicalMaterial's transmission and roughness are independent
// physical properties). `transmission` (UI-labeled TRANSPARENCY) is the
// real optical transparency control, mapped directly to
// MeshPhysicalMaterial.transmission — default 1 is the value the material
// was ALREADY hardcoded to at creation before this field existed, so an
// old saved scene/localStorage blob with no `transmission` key inherits
// this default via the `{...DEFAULT_GLASS, ...saved.glass}` spread below
// and looks exactly as transparent as it always did — genuinely
// backward-compatible, not a behavior change for existing scenes. Material
// `opacity` is deliberately never touched anywhere in this file — per
// Three.js's own MeshPhysicalMaterial contract, opacity should stay 1
// while transmission is non-zero; mixing alpha into a transmissive
// material double-fades it and reads as an even more washed-out result
// than the reported defect, not a fix for it.
const DEFAULT_GLASS = { on: false, scale: 1, rotate: true, rotSpeed: 0.4, tint: '#ffffff', clarity: 0.06, transmission: 1, position: [0, 0, 0], rotationOffset: [0, 0, 0] };
// The one glass-petal-sphere instance that actually drives world.glassMesh —
// see the "Element system" state block in ClothStudio() for why every other
// instance (duplicates) is data-only.
const PRIMARY_ELEMENT_ID = 'glass-petal-sphere-1';

// ── Shot camera — a second, positionable camera; USE SHOT CAM renders through
// it while the orbit view waits underneath. ──
const DEFAULT_SHOTCAM = { use: false, az: 24, el: 12, dist: 3.2, fov: 40 };

// ── Device primary shape (third Sheet Shape option) — the hero device
// mockup's own controls. Sway defaults OFF: the Mockup Video reference
// frames a steady device and moves the CAMERA, not the hardware. Scale
// 1.45 ≈ a 1.3 wu-wide desktop at the default 3.2 orbit distance — the
// same visual weight the flyer sheet carries. ──
// ── Background presentation (Phase 6) — fit/shift/diffusion-opt-out for the
// backdrop. `fit` applies to the uploaded background image only; `diffusion`
// gates the DIFFUSION_SHADER's backdrop blur in every bg mode. ──
const DEFAULT_BG_FX = { fit: 'cover', shiftY: 0, diffusion: true };

const DEFAULT_DEVICE_PRIMARY = {
  viewport: 'desktop', captureUrl: '', uploadAssetId: '',
  // Capture provenance (Recovery round 2, Defect 1 — "Quick Export exports
  // a STALE capture"): WHICH site/viewport captureUrl is actually an image
  // OF. Written at every site that sets captureUrl (DeviceScreenControl's
  // Capture button + its recent-captures "Use", and ClothStudio's own
  // auto-capture inside runExportWithLiveGuard/pinDeviceScreenIfNeeded);
  // cleared whenever captureUrl is cleared (placeholder/upload selection).
  // The live-export guard and the pin planner (elements/video-export.js)
  // only trust a capture as "of the current live site" when BOTH match the
  // current liveUrl/viewport exactly — absent provenance (a capture saved
  // before this round existed) never matches, so it is never trusted blind.
  captureSourceUrl: '', captureViewport: '',
  // Shell model PER viewport family (each device remembers its own —
  // switching Desktop→Phone→back keeps your monitor pick) + finish:
  // 'realistic' (physical metal + glass) or 'clay' (one matte recolorable
  // material, BODY TONE = clay color, claySoftness = roughness dial).
  models: { desktop: 'studio', mobile: 'flagship', tablet: 'pro' },
  finish: 'realistic', claySoftness: 0.85, clayColor: '#e8734a', shellTexture: 'smooth',
  color: '#d6d8da', accent: '#c47c56',
  // AUTO SCROLL off by default (Phase 5, owner direction): the page holds
  // scrollPosition (0=top..1=bottom), which is timeline-keyframeable
  // ('devicePrimary.scrollPosition' in TIMELINE_LERP_WHITELIST) — page
  // movement lines up with the timeline instead of animating on its own.
  scroll: false, scrollSpeed: 0.4, scrollPosition: 0,
  sway: false, swaySpeed: 0.5, scale: 1.45,
  // Vertical placement: seatOnFloor rests the device's lowest point (stand
  // foot / slab edge, per viewport — deviceBottomLocalY) ON a scene set's
  // floor plane, tracking viewport/scale/floor-height changes; posY is a
  // manual offset on top (also the whole story when no floor is visible),
  // timeline-keyframeable ('devicePrimary.posY' in TIMELINE_LERP_WHITELIST).
  seatOnFloor: true, posY: 0,
  // LIVE screen (Phase 7): a real interactive iframe behind a punched-
  // through screen. Preview-only — never in PNG/MP4 exports, and sites
  // sending X-Frame-Options/CSP frame-ancestors will refuse to load.
  live: false, liveUrl: '',
};

// ── Diffusion Camera — docs/plans/STUDIO-ROADMAP-NEXT-PHASE-SONNET-HANDOFF.md
// Slice 1. A camera/look/post-processing feature (a focal point stays sharp,
// everything outside it softens), not an element mesh — same top-level-
// recipe-key treatment as DEFAULT_SHOTCAM above, not nested under any
// element instance. `locked` is this feature's OWN standalone lock (it has
// no element instance to hang the existing `random.groups` mechanism off
// of). Preview-approximate only this slice — see the composer wiring below
// for the actual shader pass; nothing here claims Proof/4K support. ──
const DEFAULT_DIFFUSION_CAMERA = {
  enabled: false, locked: false, focalTarget: 'origin',
  focusDistance: 2.2, aperture: 0.4, falloff: 0.5, diffusionRadius: 0.3, highlightBloom: 0.2,
  foregroundBias: 0, backgroundBias: 0,
};

// The unified randomization scope control's 9 options (Slice 1) — module-
// scope, static data, same hoisting convention as every other config
// constant in this file (FX_PRESETS, LIGHT_TEMPLATES, etc.).
const RANDOMIZE_SCOPES = [
  { id: 'entire-set', label: 'Entire set' },
  { id: 'unlocked-only', label: 'Unlocked values only' },
  { id: 'selected-element', label: 'Selected element' },
  { id: 'elements-only', label: 'Elements only' },
  { id: 'look-only', label: 'Look only' },
  { id: 'lighting-only', label: 'Lighting only' },
  { id: 'camera-only', label: 'Camera only' },
  { id: 'motion-only', label: 'Motion only' },
  { id: 'colors-only', label: 'Colors only' },
];

// ── Social capture frames — labeled platform crops drawn on the HUD; video +
// PNG exports record the crop at native platform resolution. ──
const FRAME_PRESETS = {
  off:       { label: 'Off — full canvas' },
  square:    { w: 1080, h: 1080, slug: 'square',    label: '1:1 SQUARE · IG / FB POST' },
  portrait:  { w: 1080, h: 1350, slug: 'portrait',  label: '4:5 PORTRAIT · IG FEED' },
  vertical:  { w: 1080, h: 1920, slug: 'vertical',  label: '9:16 VERTICAL · REELS / STORIES / TIKTOK / SHORTS' },
  landscape: { w: 1920, h: 1080, slug: 'landscape', label: '16:9 LANDSCAPE · YOUTUBE / X' },
};
// Largest centered rect of the given aspect that fits the canvas (CSS px).
const computeFrameRect = (cw, ch, aspect) => {
  let w = cw * 0.92;
  let h = w / aspect;
  if (h > ch * 0.92) { h = ch * 0.92; w = h * aspect; }
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
};
// Carousel order — the HUD lays these out in a row and slides the active one
// to canvas center; the left/right canvas tabs step through it.
const FRAME_IDS = Object.keys(FRAME_PRESETS);
// Footprint of a frame on the canvas; 'off' occupies the whole safe area.
const frameFootprint = (id, cw, ch) => {
  const f = FRAME_PRESETS[id];
  if (!f || !f.w) return { w: cw * 0.92, h: ch * 0.92 };
  const r = computeFrameRect(cw, ch, f.w / f.h);
  return { w: r.w, h: r.h };
};
const FRAME_GAP = 26; // px between neighbouring frames in the filmstrip

// ── Hero Text Phase 3 — in/out animation render-loop application ──────────
// docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md Phase 3.

// Draws one Hero Text layer's canvas — shared by the mesh-lifecycle effect's
// INITIAL build (identity animState, i.e. Phase 1's exact static draw) and
// by applyTextAnimFrame's per-frame REDRAW during an active in/out window
// (tracking/blur/wipe channels only). `spec` is a buildTextCanvasSpec()
// result; its `lines[].x/y` positions are reused UNCHANGED across every
// redraw — canvas.textAlign repositions the actual glyphs relative to that
// x at draw time, so neither a change in letter-spacing nor a clip rect
// needs the layout re-solved. That's what makes "letterSpacing/filter/
// clip-rect only" cheap enough to run inside a rAF loop instead of a full
// buildTextCanvasSpec()+wrap re-run.
// Manual rounded-rect path (arcTo-based) rather than ctx.roundRect — avoids
// depending on that method's more recent browser support (Safari <16) for a
// small, purely cosmetic backdrop shape. Used only by drawTextLayerCanvas's
// backdrop pass below.
const drawRoundedRectPath = (ctx, x, y, w, h, r) => {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
};

const drawTextLayerCanvas = (ctx, canvas, spec, layer, font, animState = {}) => {
  const trackingMul = Number.isFinite(animState.trackingMul) ? animState.trackingMul : 1;
  const blurPx = Number.isFinite(animState.blurPx) ? animState.blurPx : 0;
  const clipT = Number.isFinite(animState.clipT) ? animState.clipT : 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Backdrop bar/pill (Phase 2) — drawn FIRST, straight from
  // buildTextCanvasSpec's own pre-scaled backdropRects (already in this
  // canvas's exact pixel space, zero extra scale math here), so the text
  // draw below always layers on top of it. Deliberately NOT gated by the
  // wipe clip (clipT) below — the panel is a static design element, not the
  // animated content the in/out anim channels drive.
  if (Array.isArray(spec.backdropRects) && spec.backdropRects.length) {
    ctx.save();
    ctx.fillStyle = layer.backdropColor;
    ctx.globalAlpha = layer.backdropOpacity;
    spec.backdropRects.forEach((rect) => {
      drawRoundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.radius);
      ctx.fill();
    });
    ctx.restore();
  }
  ctx.save();
  if (clipT < 0.999) {
    // Wipe reveal direction honors the layer's own text alignment: 'left'
    // reveals left->right (the reading direction for left-aligned text),
    // 'right' reveals right->left (mirrors 'left' for right-aligned text),
    // 'center' reveals from the middle outward in both directions at once.
    const w = canvas.width;
    const clipW = w * Math.max(0, clipT);
    let clipX = 0;
    if (layer.align === 'right') clipX = w - clipW;
    else if (layer.align === 'center') clipX = (w - clipW) / 2;
    ctx.beginPath();
    ctx.rect(clipX, 0, clipW, canvas.height);
    ctx.clip();
  }
  ctx.font = `${layer.weight} ${spec.fontPx}px "${font.family}", ${font.fallback}`;
  // spec.fontPx is already TEXT_CANVAS_SCALE'd (buildTextCanvasSpec's own
  // header) — the SAME scaled-px convention buildTextCanvasSpec's own
  // `letterSpacingPx = tracking * fontPx` formula uses, just re-derived
  // here per-frame with the animated multiplier instead of the fixed 1x
  // buildTextCanvasSpec bakes into the initial spec.
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${layer.tracking * trackingMul * spec.fontPx}px`;
  // blurPx is "design px" (frame-native, resolution-agnostic — see
  // computeTextAnimState's own header) — scaled up by TEXT_CANVAS_SCALE
  // here, same as every other draw-time scale-up in this canvas.
  if ('filter' in ctx) ctx.filter = blurPx > 0.05 ? `blur(${blurPx * TEXT_CANVAS_SCALE}px)` : 'none';
  ctx.fillStyle = layer.color;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';
  spec.lines.forEach((line) => ctx.fillText(line.text, line.x, line.y));
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.restore();
};

// Called once per render-loop frame (both the fx and non-fx paths share
// this ONE call, made BEFORE either branch renders — see the loop() call
// site) with the SAME THREE.Clock#elapsedTime `t` the rest of the loop
// already reads, so preview/export timestamps and computeTextAnimState's
// tNow are always the same clock. world.textAnimClock is
// {mode:'idle'|'preview'|'export', tStart, tEnd} — see ClothStudio's
// Preview-button/exportVideo wiring for who sets it; 'idle' is the Phase-1
// fallback (every layer renders at its authored, non-animated identity
// state, matching pre-Phase-3 behavior exactly).
//
// Two cost tiers (Handoff Risk: "2x video export + per-frame text redraw
// cost"):
//   - CHEAP (every active frame, every built layer): opacityMul ->
//     material.opacity, offsetYPct -> mesh.position.y (added on top of the
//     entry's own baseCenterY/frameRectH, which the mesh-lifecycle effect's
//     relayoutTextMeshes keeps current across a resize). offsetYPct is
//     %-of-frame-height, POSITIVE = shifted DOWN on screen; the overlay
//     scene is +y-UP (layoutTextPlane's own convention), so it is
//     SUBTRACTED here, not added.
//   - REDRAW (throttled to every OTHER call, and only for a layer whose
//     OWN anim actually uses a texture-affecting channel): trackingMul/
//     blurPx/clipT require re-drawing the layer's canvas via its own
//     `redraw()` closure (built by the mesh-lifecycle effect, which owns
//     the canvas/ctx/font it closes over) — letter-spacing/canvas-filter-
//     blur/clip-rect are draw-time-only concerns, unlike opacity/position
//     which are plain mesh/material properties. A layer whose anim never
//     uses tracking/blur/wipe (the common case: fade/rise/sink/none) never
//     redraws at all — "outside anim windows, zero redraws."
function applyTextAnimFrame(world, tNow) {
  if (!world?.textMeshes?.size) return;
  const clock = world.textAnimClock;
  const active = Boolean(clock) && clock.mode !== 'idle';
  if (!active) {
    // One-time reset back to a clean, un-blurred/un-clipped/full-tracking
    // canvas the instant a preview/export ends — the LAST redraw during an
    // active window can leave the canvas mid-blur/mid-clip; idle frames
    // must show the exact same static texture Phase 1 always did. This is
    // the one-shot exception that makes "outside anim windows, zero
    // redraws" hold going forward, not a per-frame redraw.
    if (world._textAnimWasActive) {
      world._textAnimWasActive = false;
      world.textMeshes.forEach((entry) => {
        if (entry.usesRedrawChannel) entry.redraw({ trackingMul: 1, blurPx: 0, clipT: 1 });
        entry.material.opacity = Number.isFinite(entry.baseOpacity) ? entry.baseOpacity : entry.layer.opacity;
        entry.mesh.position.y = entry.baseCenterY;
      });
    }
    return;
  }
  world._textAnimWasActive = true;
  world._textAnimRedrawToggle = !world._textAnimRedrawToggle;
  const allowRedrawThisFrame = world._textAnimRedrawToggle;

  world.textMeshes.forEach((entry) => {
    const { layer } = entry;
    const state = computeTextAnimState({ anim: layer.anim, tNow, tStart: clock.tStart, tEnd: clock.tEnd });
    // Timeline v2 — reads the CURRENT blended base (entry.baseOpacity/
    // baseCenterY), not the stale built layer.opacity/original center,
    // whenever world.applyTimelineTextOverride (module scope above, called
    // from applyTimelineContinuousOverride) already refreshed it THIS frame
    // — see the render loop's own call-order comment for why the timeline
    // override runs before this function. Falls back to the built layer's
    // own opacity when no timeline override has ever touched this entry
    // (baseOpacity seeded at build time in the mesh-lifecycle effect below),
    // identical to Phase 1/3's original behavior outside timeline playback.
    const baseOpacity = Number.isFinite(entry.baseOpacity) ? entry.baseOpacity : layer.opacity;
    entry.material.opacity = baseOpacity * state.opacityMul;
    entry.mesh.position.y = entry.baseCenterY - (state.offsetYPct / 100) * entry.frameRectH;
    if (entry.usesRedrawChannel && allowRedrawThisFrame) {
      entry.redraw({ trackingMul: state.trackingMul, blurPx: state.blurPx, clipT: state.clipT });
    }
  });
}

// ── Timeline v2 — keyframe playback render-loop application ───────────────
// docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md Phase 4 (original
// plan); rewired onto timeline.js's v2 track model (see that file's own
// header for the full keyframe/track contract this section drives).
//
// applyMatToWorld — the cloth material dials' effect body (mat state +
// envIntensity -> clothMat/clothBackMat props + holo uniforms), extracted to
// module scope so BOTH the React-state-driven effect (unchanged cadence,
// only on a real dial change) AND this file's timeline override (every
// frame during an active transition, with a blended mat/envIntensity) share
// ONE implementation instead of two copies that could drift.
function applyMatToWorld(world, mat, envIntensity) {
  if (!world?.clothMat || !mat) return;
  const { THREE, holoUniforms: u } = world;
  let rough = mat.roughness, cc = mat.clearcoat;
  if (mat.finish === 'matte') { rough = Math.max(rough, 0.7); cc *= 0.15; }
  else if (mat.finish === 'satin') { rough = Math.min(1, rough + 0.28); cc *= 0.5; }
  const hueCol = new THREE.Color().setHSL(mat.hueShift % 1, 0.85, 0.62);
  [world.clothMat, world.clothBackMat].filter(Boolean).forEach((m) => {
    const mirrored = m.side === THREE.BackSide;
    m.color.set(mat.baseColor);
    m.roughness = rough;
    m.metalness = mat.metalness;
    m.clearcoat = cc;
    m.clearcoatRoughness = mat.coatRoughness;
    m.sheen = mat.sheen;
    m.iridescence = mat.iridescence;
    m.bumpScale = mat.bump * 0.014;
    if (m.bumpMap) m.bumpMap.repeat.set(mirrored ? -mat.bumpTiling : mat.bumpTiling, mat.bumpTiling);
    m.specularColor.set(0xffffff).lerp(hueCol, mat.specTint * Math.min(1, mat.holoIntensity * 1.5));
    m.specularIntensity = 0.4 + 0.6 * mat.specTint;
    if (Number.isFinite(envIntensity)) m.envMapIntensity = envIntensity;
  });
  u.uHoloIntensity.value = mat.holoIntensity;
  u.uHoloScale.value = mat.holoScale;
  u.uBandFreq.value = mat.bandFreq;
  u.uSatBoost.value = mat.saturation;
  u.uHueShift.value = mat.hueShift;
  u.uSparkle.value = mat.sparkle;
}

// Snapshots the orbit (non-shot) camera's world-space pose for a new/
// re-captured keyframe — `{px,py,pz,tx,ty,tz}` matching timeline.js's own
// orbitPose schema and the Mockup Video studio's (page.jsx) identical
// convention. `null` when the world/camera/controls aren't ready yet.
function captureOrbitPose(world) {
  if (!world?.camera || !world?.controls) return null;
  const p = world.camera.position, t = world.controls.target;
  return { px: p.x, py: p.y, pz: p.z, tx: t.x, ty: t.y, tz: t.z };
}

// Applies a `blendRecipes(...)` result's WHITELISTED continuous leaves
// straight onto the live three.js objects, every frame a transition/scrub is
// active — necessary because most of these fields (shotCam, glass's scale/
// clarity/transmission/position/rotationOffset, mat, envIntensity, lightCans
// intensity/az/el, bgColor, textLayers transforms) are normally only applied
// by a REACT-STATE-driven useEffect (keyed on their own state, not on every
// rAF frame) — so a continuous interpolation needs its OWN per-frame
// imperative write instead of calling setState every frame (explicitly
// ruled out by the original handoff plan as too expensive). fx/
// diffusionCamera/glass.rotate are the ONE exception — those are already
// read fresh every frame off liveRef.current inside loop() itself (see the
// fxActive() branch and the glass auto-rotate line), so THEIR override is
// applied by swapping in `world.timelineOverride?.X ?? liveRef.current.X`
// at those existing read sites instead of here.
//
// glass.rotate KNOWN INTERACTION: the auto-rotate block (loop(), above this
// function's own call site) increments glassMesh.rotation.x/z every frame
// BEFORE this function runs; when `override.glass.rotationOffset` is
// present this function then SETS rotation.x/z absolutely, discarding that
// increment for the frame. Net effect: the glass's idle auto-spin holds at
// the blended base (rather than continuing to accumulate) for the duration
// of an active transition/scrub that carries a glass override, resuming
// normal accumulation once playback stops — the timeline fully owns the
// glass transform while it's driving one, same precedent shotCam's own
// override already sets for OrbitControls.
function applyTimelineContinuousOverride(world, override) {
  if (!override) return;
  const DEG = Math.PI / 180;
  if (override.shotCam && world.shotCamera) {
    const sc = override.shotCam;
    const az = sc.az * DEG, el = sc.el * DEG, R = sc.dist;
    world.shotCamera.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
    world.shotCamera.lookAt(0, 0, 0);
    world.shotCamera.fov = sc.fov;
    world.shotCamera.updateProjectionMatrix();
  }
  if (override.glass && world.glassMesh && world.glassMat) {
    world.glassMesh.scale.setScalar(override.glass.scale || 1);
    world.glassMat.roughness = override.glass.clarity;
    world.glassMat.transmission = override.glass.transmission ?? 1;
    const pos = Array.isArray(override.glass.position) ? override.glass.position : [0, 0, 0];
    world.glassMesh.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    const rot = Array.isArray(override.glass.rotationOffset) ? override.glass.rotationOffset : [0, 0, 0];
    world.glassMesh.rotation.set((rot[0] || 0) * DEG, (rot[1] || 0) * DEG, (rot[2] || 0) * DEG);
  }
  if (override.mat && world.clothMat) {
    applyMatToWorld(world, override.mat, override.envIntensity);
  }
  if (Array.isArray(override.lightCans) && world.cans) {
    const R = 2.8;
    override.lightCans.forEach((c, i) => {
      const can = world.cans[i];
      if (!can) return;
      if (Number.isFinite(c?.intensity)) can.intensity = c.intensity * 14;
      const az = (Number.isFinite(c?.az) ? c.az : 0) * DEG;
      const el = (Number.isFinite(c?.el) ? c.el : 0) * DEG;
      can.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
    });
  }
  if (typeof override.bgColor === 'string' && world.scene?.background?.isColor) {
    world.scene.background.set(override.bgColor);
  }
  // TEXT — position/opacity/rotation/scale only (texture-affecting fields —
  // text/font/tracking/leading/maxWidthPct/color/backdrop* — stay discrete,
  // landed once at the segment's own cut via the mesh-lifecycle effect's
  // normal React-state-driven rebuild; see world.applyTimelineTextOverride's
  // own header, assigned by that effect, for the full contract).
  if (Array.isArray(override.textLayers)) {
    world.applyTimelineTextOverride?.(override.textLayers);
  }
  // ELEMENT INSTANCES (image layers + extra elements) — the timeline owns
  // each live root's authored transform while driving one, exactly the
  // glass/shotCam precedent above: blendElementTransforms (timeline.js)
  // tweens position/rotation/scale between keyframes and this writes them
  // straight onto the live objects each frame. Only the ROOT transform is
  // touched — factory animate() motion (drift/spin) rides on the separate
  // motion child group, so the two never fight. When playback ends on a
  // keyframe, that keyframe's discrete cut has already set React state to
  // the same values, so the handoff back is seamless.
  if (Array.isArray(override.extraInstances) && world.elementLiveObjects) {
    const D = Math.PI / 180;
    override.extraInstances.forEach((inst) => {
      const entry = world.elementLiveObjects.get(inst?.id);
      const tr = inst?.transform;
      if (!entry || !tr) return;
      const [px = 0, py = 0, pz = 0] = Array.isArray(tr.position) ? tr.position : [];
      const [rx = 0, ry = 0, rz = 0] = Array.isArray(tr.rotation) ? tr.rotation : [];
      const [sx = 1, sy = 1, sz = 1] = Array.isArray(tr.scale) ? tr.scale : [];
      entry.object.position.set(px, py, pz);
      entry.object.rotation.set(rx * D, ry * D, rz * D);
      entry.object.scale.set(sx, sy, sz);
    });
  }
}

// Cheap, order-stable identity for "which text is on screen" — used to
// decide whether a segment boundary should retrigger the shared
// world.textAnimClock (see stepTimelinePlayback below). Deliberately NOT
// exported/shared with text-layers.js — this is a wiring-only concern, not
// part of that module's pure contract.
const timelineTextLayersKey = (recipe) => (
  Array.isArray(recipe?.textLayers) ? recipe.textLayers.map((l) => `${l?.id}:${l?.text}`).join('|') : ''
);

// Advances timeline v2 playback/scrub by one render-loop frame.
// `world.timelineClock` is `{ mode: 'idle'|'playing'|'looping', startedAt,
// startU, timeline, lastU, lastFromIndex, lastTextLayersKey, exporting }` —
// a plain mutable blob living on `world` itself, NOT React state (advancing
// it every frame must never go through setState; a 10Hz poll — see
// ClothStudio's own effect — mirrors `lastU`/`mode` back into React for the
// playhead ball + transport buttons). `applyRecipeFn` is ClothStudio's
// current-render applySceneRecipe (passed in fresh each call via a ref the
// caller reads — see the render loop's own call site comment for why a
// stale closure would be wrong here). `liveTimeline` is the CURRENT React
// `timeline` state (read via liveRef, always fresh) — used only in
// 'idle'/scrub mode, where there is no frozen Play/Export snapshot to
// evaluate against; 'playing'/'looping' mode always evaluates its OWN
// `clock.timeline` snapshot instead (frozen at Play/Loop/Export time; the
// UI locks all editing while a transport mode is active, so this can never
// diverge mid-playback).
//
// Runs EVERY frame regardless of mode:
//   - 'playing'/'looping': derives `u` from elapsed wall-clock time against
//     `timelineDuration(clock.timeline)`, wrapping into [0,1) when looping;
//     forces `controls.enabled = false` every frame (self-healing against
//     any React effect — e.g. the shotCam dial's own effect — that might
//     otherwise re-enable it off a discrete cut's own state change).
//   - 'idle': only does anything when `world.scrubRequest` (set by
//     ClothStudio's scrubTimelineTo, one value per call) is non-null —
//     consumes it once, `u = scrubRequest`, then clears it. No request ->
//     early return, and the scene correctly STAYS at whatever was last
//     applied (own contract: "after scrubbing ends the scene stays at the
//     scrubbed state").
//
// Two responsibilities once `u` is resolved:
//   1. Detect a keyframe-PAIR boundary (`fromIndex` changed since the last
//      frame this ran) and, exactly once at that instant, push the DISCRETE
//      half of the new pair into React state via
//      applyRecipeFn(blendRecipes(from, to, 0)) — blend=0 already carries
//      every discrete field (text, artwork, scene, ...) at the TARGET
//      keyframe's value while every whitelisted continuous field stays at
//      the FROM keyframe's value (blendRecipes' own "cut at transition
//      start" contract), so there is no camera/look jump the instant this
//      fires — the per-frame continuous override below animates those
//      continuous fields from there. This also fires while scrubbing
//      (crossing a keyframe pair boundary), not just during playback.
//   2. Every frame, recompute blendRecipes at the CURRENT eased blend and
//      store it on world.timelineOverride — read every frame by
//      applyTimelineContinuousOverride and by the loop's own fx/
//      diffusionCamera/glass.rotate read sites — plus the orbit-camera pose
//      (blendOrbitPose), applied directly when the landed keyframe pair
//      isn't using the cinematic shot camera (`shotCam.use` false).
//
// Text retrigger: every keyframe-pair boundary compares the incoming pair's
// textLayers against what was last playing (lastTextLayersKey) — different
// content restarts world.textAnimClock (tStart = now, so the in-anim
// plays), same content just EXTENDS the clock's tEnd to this pair's own end
// (so an unchanged headline doesn't prematurely fade out at a cut it isn't
// actually leaving, but still fades out before whichever LATER cut finally
// does change it). `span` (real seconds until this pair's own target
// keyframe) is `(toKf.t - fromKf.t) * totalSeconds` for a real pair, or
// "whatever's left of the whole timeline" for a hold-equivalent boundary
// (fromIndex===toIndex — the before-first/after-last clamp regions, see
// resolveTrackState's own header) where there is no next keyframe to
// measure a real segment against. The very first call after a fresh
// Play/Loop/Export always counts as "different" (lastFromIndex/
// lastTextLayersKey are seeded `null`), so the opening shot's own headline
// fades in at the start of playback, same as it fades in on every later cut.
function stepTimelinePlayback(world, tNow, applyRecipeFn, liveTimeline) {
  const clock = world.timelineClock;
  if (!clock || typeof applyRecipeFn !== 'function') return;
  const active = clock.mode === 'playing' || clock.mode === 'looping';
  if (active && world.controls) world.controls.enabled = false;
  // Export-restore Phase 5 — DURING AN EXPORT, no keyframe may change the
  // device's screen SOURCE. Every keyframe recipe carries the whole
  // devicePrimary object (captureSceneRecipe), including `live`/`liveUrl`,
  // and applySceneRecipe merges it straight back — so each keyframe-pair
  // boundary below used to re-enable Go Live and rebuild the CSS3D iframe
  // MID-RECORDING, re-punching the alpha hole the export guard had just
  // torn down. A device that fills the frame then recorded as blank, every
  // time, no matter what the guard did. This is the SAME rule the cloud
  // submission has always enforced (timeline.js buildTimelineSubmission →
  // stripDeviceScreenSource: "a keyframe can never carry different screen
  // content mid-video; the BASE scene's own pinned screen is authoritative
  // for the whole render"), now enforced on the local export path too.
  // Preview playback is untouched — only `clock.exporting` scenes strip.
  const applyRecipe = clock.exporting
    ? (recipe) => applyRecipeFn(stripDeviceScreenSource(recipe))
    : applyRecipeFn;

  let tl;
  let u;
  if (active) {
    tl = clock.timeline;
    const total = timelineDuration(tl);
    const elapsed = tNow - clock.startedAt;
    let raw = clock.startU + (total > 0 ? elapsed / total : 1);
    raw = clock.mode === 'looping' ? (total > 0 ? (((raw % 1) + 1) % 1) : 0) : Math.min(1, raw);
    u = raw;
  } else {
    if (world.scrubRequest == null) return;
    tl = liveTimeline;
    u = world.scrubRequest;
    world.scrubRequest = null;
  }
  clock.lastU = u;

  const kfs = Array.isArray(tl?.keyframes) ? tl.keyframes : [];
  const state = resolveTrackState(tl, u);
  const { fromIndex, toIndex, blend, done } = state;
  const fromKf = kfs[fromIndex];
  const toKf = kfs[toIndex];

  if (fromIndex !== clock.lastFromIndex) {
    clock.lastFromIndex = fromIndex;
    if (fromKf && toKf) {
      applyRecipe(blendRecipes(fromKf.recipe, toKf.recipe, 0));
      const layersKey = timelineTextLayersKey(toKf.recipe);
      const textChanged = layersKey !== clock.lastTextLayersKey;
      clock.lastTextLayersKey = layersKey;
      const total = timelineDuration(tl);
      const span = fromIndex !== toIndex
        ? Math.max(0, (toKf.t - fromKf.t) * total)
        : Math.max(0, (1 - fromKf.t) * total);
      if (span > 0) {
        const mode = clock.exporting ? 'export' : 'preview';
        if (textChanged || !world.textAnimClock || world.textAnimClock.mode === 'idle') {
          world.textAnimClock = { mode, tStart: tNow, tEnd: tNow + span };
        } else {
          // Same headline riding into the next shot — only push tEnd
          // forward (defers the OUT phase, computeTextAnimState's own
          // contract); tStart stays put so an already-finished IN phase
          // never replays.
          world.textAnimClock = { ...world.textAnimClock, mode, tEnd: tNow + span };
        }
      }
    }
  }

  world.timelineOverride = (fromKf && toKf) ? blendRecipes(fromKf.recipe, toKf.recipe, blend) : null;

  // Orbit camera — only while the landed pair's own discrete shotCam.use is
  // false (the cinematic shot camera owns the view instead when true —
  // already cut at the pair's own start, so reading it off the
  // just-computed override is equivalent to toKf.recipe's own value for
  // this whole pair).
  if (world.timelineOverride && !world.timelineOverride.shotCam?.use && world.camera && world.controls) {
    const pose = blendOrbitPose(fromKf?.orbitPose, toKf?.orbitPose, blend);
    if (pose) {
      world.camera.position.set(pose.px, pose.py, pose.pz);
      world.controls.target.set(pose.tx, pose.ty, pose.tz);
    }
  }

  if (clock.mode === 'playing' && done) {
    // `toKf` is already the last-BY-t keyframe whenever `done` is true (see
    // resolveTrackState's own contract) — robust even if `tl.keyframes`
    // isn't in t-sorted array order (retimeKeyframe deliberately leaves it
    // unsorted mid-drag; see that handler's own comment).
    if (toKf) applyRecipe(toKf.recipe);
    world.timelineOverride = null;
    if (world.controls) world.controls.enabled = !(toKf?.recipe?.shotCam?.use);
    world.timelineClock = { mode: 'idle', startedAt: 0, startU: 0, lastU: 1, lastFromIndex: null, lastTextLayersKey: null };
  }
}

// ── Lighting cans — four positionable stage lights around the sheet. Each can
// aims at center from (angle around stage, height angle) at a fixed throw; the
// slider intensity maps to physical spotlight candela below. Templates are
// whole-rig looks; scene sets apply a matching template (still tweakable). ──
const CAN_LABELS = ['CAN 1 · KEY', 'CAN 2 · FILL', 'CAN 3 · RIM', 'CAN 4 · BACK'];
const LIGHT_TEMPLATES = {
  studio: { label: 'Studio Classic', cans: [
    { on: true,  color: '#ffffff', intensity: 1.6, az: 35,   el: 40 },
    { on: true,  color: '#88ffee', intensity: 0.6, az: -140, el: 15 },
    { on: false, color: '#ffffff', intensity: 1,   az: -35,  el: 20 },
    { on: false, color: '#ffffff', intensity: 1,   az: 180,  el: 60 },
  ] },
  'single-spot': { label: 'Single Spot', cans: [
    { on: true,  color: '#cdd8ff', intensity: 2.4, az: 8,    el: 62 },
    { on: false, color: '#ff2030', intensity: 1.2, az: -120, el: 10 },
    { on: false, color: '#ffffff', intensity: 1,   az: 120,  el: 20 },
    { on: false, color: '#ffffff', intensity: 1,   az: 180,  el: 55 },
  ] },
  'neon-cross': { label: 'Neon Cross', cans: [
    { on: true,  color: '#ff00c8', intensity: 1.8, az: -70,  el: 12 },
    { on: true,  color: '#00e5ff', intensity: 1.8, az: 70,   el: 12 },
    { on: true,  color: '#ffffff', intensity: 0.7, az: 180,  el: 45 },
    { on: false, color: '#ffe600', intensity: 1,   az: 0,    el: -35 },
  ] },
  'fire-ice': { label: 'Fire & Ice', cans: [
    { on: true,  color: '#ff9d3c', intensity: 2,   az: -60,  el: 22 },
    { on: true,  color: '#7fc4ff', intensity: 1.6, az: 65,   el: 28 },
    { on: true,  color: '#ffffff', intensity: 0.5, az: 180,  el: 60 },
    { on: false, color: '#ffffff', intensity: 1,   az: 0,    el: -30 },
  ] },
  'top-wash': { label: 'Top Wash', cans: [
    { on: true,  color: '#f2f6ff', intensity: 2.2, az: 0,    el: 78 },
    { on: true,  color: '#4060ff', intensity: 0.6, az: -150, el: 8 },
    { on: false, color: '#ffffff', intensity: 1,   az: 150,  el: 8 },
    { on: false, color: '#ffffff', intensity: 1,   az: 0,    el: -40 },
  ] },
  'club-floor': { label: 'Club Floor', cans: [
    { on: true,  color: '#ff00c8', intensity: 1.8, az: -40,  el: -45 },
    { on: true,  color: '#00e5ff', intensity: 1.8, az: 40,   el: -45 },
    { on: true,  color: '#ffffff', intensity: 0.5, az: 180,  el: 65 },
    { on: false, color: '#ffe600', intensity: 1,   az: 0,    el: 0 },
  ] },
};
const cloneCans = (tplId) => (LIGHT_TEMPLATES[tplId] || LIGHT_TEMPLATES.studio).cans.map((c) => ({ ...c }));

// ── Scene sets — full environments with depth: a graded + grained backdrop
// texture, exponential fog, a themed light rig (key/rim recolor + optional
// spotlight), and a shadow-catching ground so the sheet reads as standing on a
// set rather than floating on a flat color. All procedural — no asset loads. ──
// PBR floor surfaces for scene sets (Polyhaven CC0, 2k diffuse + roughness,
// public/tex/) — a flat-color floor never reads as a desk; real grain +
// roughness variation under the device's shadow does. `repeat` tiles the
// 30×30 stage plane; presets pick via `groundTex`, optionally tinting with
// `groundTint` (multiplies the map; default white = the photo's own color).
const GROUND_TEXTURES = {
  wood: { label: 'Oak Table', map: '/tex/wood_table_diff_2k.jpg', rough: '/tex/wood_table_rough_2k.jpg', repeat: 7 },
  'dark-wood': { label: 'Dark Wood', map: '/tex/dark_wood_diff_2k.jpg', rough: '/tex/dark_wood_rough_2k.jpg', repeat: 7 },
  concrete: { label: 'Concrete', map: '/tex/concrete_diff_2k.jpg', rough: '/tex/concrete_rough_2k.jpg', repeat: 6 },
  marble: { label: 'Marble', map: '/tex/marble_01_diff_2k.jpg', rough: '/tex/marble_01_rough_2k.jpg', repeat: 5 },
  metal: { label: 'Metal Plate', map: '/tex/metal_plate_diff_2k.jpg', rough: '/tex/metal_plate_rough_2k.jpg', repeat: 8 },
  asphalt: { label: 'Asphalt', map: '/tex/asphalt_02_diff_2k.jpg', rough: '/tex/asphalt_02_rough_2k.jpg', repeat: 8 },
  granite: { label: 'Granite Tile', map: '/tex/granite_tile_diff_2k.jpg', rough: '/tex/granite_tile_rough_2k.jpg', repeat: 6 },
};

// Every panorama plate the Scene Lab can swap in (built-in sets reference
// these same files). '' in the Lab's select = no plate (procedural backdrop).
const PANO_PLATES = [
  { id: '/env/desk.webp', label: 'Hotel Room' },
  { id: '/env/loft.webp', label: 'Loft' },
  { id: '/env/airport-terminal.webp', label: 'Terminal' },
  { id: '/hdr/venice_sunset_2k.hdr', label: 'Venice Sunset' },
  { id: '/hdr/qwantani_dusk_2_2k.hdr', label: 'Desert Dusk' },
  { id: '/hdr/dancing_hall_2k.hdr', label: 'Ballroom' },
  { id: '/hdr/moonless_golf_2k.hdr', label: 'Moonless Night' },
  { id: '/hdr/potsdamer_platz_2k.hdr', label: 'City Night · Platz' },
  { id: '/hdr/shanghai_bund_2k.hdr', label: 'City Night · Bund' },
  { id: '/hdr/neon_photostudio_2k.hdr', label: 'Neon Studio' },
  { id: '/hdr/studio_small_03_2k.hdr', label: 'Photo Studio' },
  { id: '/hdr/artist_workshop_2k.hdr', label: 'Workshop' },
  { id: '/hdr/royal_esplanade_2k.hdr', label: 'Esplanade' },
  { id: '/hdr/metro_noord_2k.hdr', label: 'Metro Hall' },
  { id: '/hdr/courtyard_night_2k.hdr', label: 'Courtyard Night' },
  { id: '/hdr/autumn_field_puresky_2k.hdr', label: 'Open Sky' },
];

// Scene Lab overlay — a sparse tweak object composed over the active set's
// definition. Flat keys mirror preset fields; '' on pano/groundTex means
// "explicitly none"; fog is driven by fogOn/fogColor/fogDensity so a set
// with no fog can gain one and vice versa. Pure, so the bg effect and the
// Lab UI read the exact same effective scene.
function composeSceneDef(base, tweaks) {
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

// User-saved scene looks (Scene Lab "Save") — browser-local, same
// degrades-honestly story as every other local library in this file.
const USER_SCENES_KEY = 'holocloth-user-scenes-v1';
const loadUserScenes = () => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(USER_SCENES_KEY) || '[]') || []; } catch { return []; }
};

const SCENE_PRESETS = {
  thriller: {
    label: 'Thriller Set',
    lights: 'single-spot',
    backdrop: { type: 'radial', top: '#020204', bottom: '#0b0d12', glow: 'rgba(140,20,28,0.55)', glowAt: [0.5, 0.68], beam: 'rgba(190,205,255,0.16)', vignette: 0.85 },
    fog: { color: '#05060a', density: 0.16 },
    key: { color: '#cdd8ff', intensity: 2.2, pos: [1.2, 3, 2] },
    rim: { color: '#ff2030', intensity: 1.7 },
    spot: { color: '#b8c6ff', intensity: 30 },
    ground: '#0a0a0c',
    env: 0.35,
  },
  'smoke-stage': {
    label: 'Smoke Stage',
    lights: 'top-wash',
    backdrop: { type: 'radial', top: '#050507', bottom: '#0e0e12', glow: 'rgba(230,235,255,0.22)', glowAt: [0.5, 0.1], beam: 'rgba(255,255,255,0.2)', vignette: 0.8 },
    fog: { color: '#0b0b10', density: 0.2 },
    key: { color: '#ffffff', intensity: 2.6, pos: [0.4, 3.2, 1.6] },
    rim: { color: '#4060ff', intensity: 1.1 },
    spot: { color: '#ffffff', intensity: 45 },
    ground: '#0c0c10',
    env: 0.4,
  },
  'neon-alley': {
    label: 'Neon Alley',
    lights: 'neon-cross',
    backdrop: { type: 'bars', top: '#05001a', bottom: '#12002e', bars: ['rgba(255,0,200,0.5)', 'rgba(0,229,255,0.45)', 'rgba(255,230,0,0.3)'], vignette: 0.7 },
    fog: { color: '#0a0022', density: 0.12 },
    key: { color: '#e0e5ff', intensity: 1.7, pos: [1.6, 2.2, 2.2] },
    rim: { color: '#ff00c8', intensity: 2.2 },
    spot: { color: '#00e5ff', intensity: 22 },
    ground: '#08001c',
    env: 0.55,
  },
  'deep-sea': {
    label: 'Deep Sea',
    lights: 'top-wash',
    backdrop: { type: 'radial', top: '#000508', bottom: '#012029', glow: 'rgba(30,180,190,0.3)', glowAt: [0.5, 0.2], vignette: 0.75 },
    fog: { color: '#02222b', density: 0.18 },
    key: { color: '#9ff5e0', intensity: 1.9, pos: [0.8, 3, 1.4] },
    rim: { color: '#0aa9c2', intensity: 1.4 },
    spot: { color: '#bffbef', intensity: 18 },
    ground: '#02161c',
    env: 0.5,
  },
  'retro-sunset': {
    label: 'Retro Sunset',
    lights: 'fire-ice',
    backdrop: { type: 'sunset', top: '#2a0a4a', mid: '#8a1a6a', bottom: '#ff6a00', sun: 'rgba(255,214,140,0.9)', sunAt: [0.5, 0.62], vignette: 0.5 },
    fog: { color: '#30104a', density: 0.06 },
    key: { color: '#ffd9a0', intensity: 1.9, pos: [1.4, 1.8, 2.4] },
    rim: { color: '#ff3d9a', intensity: 1.6 },
    ground: '#1a0630',
    env: 1.1,
  },
  'golden-hour': {
    label: 'Golden Hour',
    lights: 'studio',
    backdrop: { type: 'radial', top: '#ffdba8', bottom: '#c96a2a', glow: 'rgba(255,246,214,0.85)', glowAt: [0.42, 0.34], vignette: 0.35 },
    fog: { color: '#e8b57d', density: 0.05 },
    key: { color: '#fff1d4', intensity: 2.3, pos: [1.8, 1.6, 2.2] },
    rim: { color: '#ff9d5c', intensity: 1 },
    ground: '#b07840',
    env: 1.6,
  },
  // ── Panorama sets (owner ask, 2026-08-01: "ultra realistic, ~20 versions
  // to play with"). Each wraps a real 360° plate (the Mockup Video
  // pipeline's webp panoramas + the shipped HDRIs) as a TRUE equirect sky —
  // the room surrounds the scene, pans with the orbit, and lights the
  // hardware via matched IBL. Shared fields: `pano` (plate), `panoBlur`
  // (0 = sharp room, higher = shallow-DOF product look), `panoRotY`
  // (different wall of the same room), `groundY: -0.68` = desk/tabletop
  // height (device stand foot), otherwise deep stage floor. The procedural
  // `backdrop` gradient paints instantly while the plate loads. ──
  'desk-studio': { label: 'Hotel Desk', lights: 'studio', pano: '/env/desk.webp', panoBlur: 0.25,
    backdrop: { type: 'radial', top: '#e9e1d3', bottom: '#8a7460', glow: 'rgba(255,244,220,0.55)', glowAt: [0.42, 0.32], vignette: 0.4 },
    ground: '#6e5137', groundY: -0.68, groundTex: 'wood', env: 1.2 },
  'suite-soft': { label: 'Suite · Soft', lights: 'studio', pano: '/env/desk.webp', panoBlur: 0.32, panoRotY: 140,
    backdrop: { type: 'radial', top: '#e9e1d3', bottom: '#8a7460', glow: 'rgba(255,244,220,0.55)', glowAt: [0.42, 0.32], vignette: 0.4 },
    ground: '#7a6248', groundY: -0.68, groundTex: 'wood', env: 1.1 },
  'suite-stage': { label: 'Suite · Stage', lights: 'studio', pano: '/env/desk.webp', panoBlur: 0.28, panoRotY: 60,
    backdrop: { type: 'radial', top: '#e9e1d3', bottom: '#8a7460', glow: 'rgba(255,244,220,0.55)', glowAt: [0.42, 0.32], vignette: 0.4 },
    ground: '#5c4a38', groundTex: 'concrete', env: 1.15 },
  'loft-morning': { label: 'Loft Morning', lights: 'studio', pano: '/env/loft.webp', panoBlur: 0.25,
    backdrop: { type: 'radial', top: '#e8e6e0', bottom: '#96897a', glow: 'rgba(255,250,235,0.5)', glowAt: [0.45, 0.3], vignette: 0.35 },
    ground: '#8a7c6a', groundY: -0.68, groundTex: 'wood', env: 1.25 },
  'loft-dream': { label: 'Loft · Dream', lights: 'studio', pano: '/env/loft.webp', panoBlur: 0.45, panoRotY: -70,
    backdrop: { type: 'radial', top: '#e8e6e0', bottom: '#96897a', glow: 'rgba(255,250,235,0.5)', glowAt: [0.45, 0.3], vignette: 0.35 },
    ground: '#9a8c78', groundY: -0.68, groundTex: 'wood', env: 1.15 },
  'loft-stage': { label: 'Loft · Stage', lights: 'studio', pano: '/env/loft.webp', panoBlur: 0.3, panoRotY: 180,
    backdrop: { type: 'radial', top: '#e8e6e0', bottom: '#96897a', glow: 'rgba(255,250,235,0.5)', glowAt: [0.45, 0.3], vignette: 0.35 },
    ground: '#6e6355', groundTex: 'concrete', env: 1.2 },
  'terminal-glass': { label: 'Terminal Glass', lights: 'studio', pano: '/env/airport-terminal.webp', panoBlur: 0.25,
    backdrop: { type: 'radial', top: '#e5e9ee', bottom: '#8b95a2', glow: 'rgba(240,248,255,0.5)', glowAt: [0.5, 0.28], vignette: 0.35 },
    ground: '#9aa2ac', groundY: -0.68, groundTex: 'concrete', env: 1.3 },
  'terminal-rush': { label: 'Terminal · Rush', lights: 'studio', pano: '/env/airport-terminal.webp', panoBlur: 0.5, panoRotY: 90,
    backdrop: { type: 'radial', top: '#e5e9ee', bottom: '#8b95a2', glow: 'rgba(240,248,255,0.5)', glowAt: [0.5, 0.28], vignette: 0.35 },
    fog: { color: '#c8d0da', density: 0.03 }, ground: '#a8b0ba', groundY: -0.68, groundTex: 'concrete', env: 1.2 },
  'terminal-stage': { label: 'Terminal · Stage', lights: 'studio', pano: '/env/airport-terminal.webp', panoBlur: 0.3, panoRotY: -120,
    backdrop: { type: 'radial', top: '#e5e9ee', bottom: '#8b95a2', glow: 'rgba(240,248,255,0.5)', glowAt: [0.5, 0.28], vignette: 0.35 },
    ground: '#7e8894', groundTex: 'concrete', env: 1.25 },
  'venice-table': { label: 'Venice Golden', lights: 'studio', pano: '/hdr/venice_sunset_2k.hdr', panoBlur: 0.1,
    backdrop: { type: 'radial', top: '#ffd9a0', bottom: '#a06035', glow: 'rgba(255,235,200,0.7)', glowAt: [0.45, 0.35], vignette: 0.35 },
    ground: '#8a5f3c', groundY: -0.68, groundTex: 'wood', env: 1.5 },
  'venice-dream': { label: 'Venice · Dream', lights: 'studio', pano: '/hdr/venice_sunset_2k.hdr', panoBlur: 0.42, panoRotY: 100,
    backdrop: { type: 'radial', top: '#ffd9a0', bottom: '#a06035', glow: 'rgba(255,235,200,0.7)', glowAt: [0.45, 0.35], vignette: 0.35 },
    ground: '#9a6f48', groundY: -0.68, groundTex: 'wood', env: 1.35 },
  'venice-stage': { label: 'Venice · Stage', lights: 'studio', pano: '/hdr/venice_sunset_2k.hdr', panoBlur: 0.02, panoRotY: -140,
    backdrop: { type: 'radial', top: '#ffd9a0', bottom: '#a06035', glow: 'rgba(255,235,200,0.7)', glowAt: [0.45, 0.35], vignette: 0.35 },
    ground: '#70482c', groundTex: 'wood', env: 1.5 },
  'dusk-table': { label: 'Desert Dusk Desk', lights: 'studio', pano: '/hdr/qwantani_dusk_2_2k.hdr', panoBlur: 0.1,
    backdrop: { type: 'radial', top: '#d9c2e8', bottom: '#5a4a72', glow: 'rgba(250,220,255,0.5)', glowAt: [0.5, 0.3], vignette: 0.4 },
    ground: '#6a5a80', groundY: -0.68, groundTex: 'wood', env: 1.35 },
  'dusk-mirage': { label: 'Dusk · Mirage', lights: 'studio', pano: '/hdr/qwantani_dusk_2_2k.hdr', panoBlur: 0.55, panoRotY: 75,
    backdrop: { type: 'radial', top: '#d9c2e8', bottom: '#5a4a72', glow: 'rgba(250,220,255,0.5)', glowAt: [0.5, 0.3], vignette: 0.4 },
    fog: { color: '#b8a2cc', density: 0.04 }, ground: '#7a6a90', groundY: -0.68, groundTex: 'wood', env: 1.25 },
  'dusk-stage': { label: 'Dusk · Stage', lights: 'studio', pano: '/hdr/qwantani_dusk_2_2k.hdr', panoBlur: 0, panoRotY: -60,
    backdrop: { type: 'radial', top: '#d9c2e8', bottom: '#5a4a72', glow: 'rgba(250,220,255,0.5)', glowAt: [0.5, 0.3], vignette: 0.4 },
    ground: '#4a3c60', groundTex: 'concrete', env: 1.4 },
  'ballroom': { label: 'Ballroom', lights: 'studio', pano: '/hdr/dancing_hall_2k.hdr', panoBlur: 0.06,
    backdrop: { type: 'radial', top: '#e8ddd0', bottom: '#7a6a58', glow: 'rgba(255,240,215,0.55)', glowAt: [0.5, 0.3], vignette: 0.4 },
    ground: '#8a7860', groundY: -0.68, groundTex: 'wood', env: 1.4 },
  'ballroom-dream': { label: 'Ballroom · Dream', lights: 'studio', pano: '/hdr/dancing_hall_2k.hdr', panoBlur: 0.4, panoRotY: 120,
    backdrop: { type: 'radial', top: '#e8ddd0', bottom: '#7a6a58', glow: 'rgba(255,240,215,0.55)', glowAt: [0.5, 0.3], vignette: 0.4 },
    ground: '#9a8870', groundY: -0.68, groundTex: 'wood', env: 1.3 },
  'midnight-table': { label: 'Midnight Desk', lights: 'single-spot', pano: '/hdr/moonless_golf_2k.hdr', panoBlur: 0.15,
    backdrop: { type: 'radial', top: '#0a0c12', bottom: '#03040a', glow: 'rgba(90,110,160,0.3)', glowAt: [0.5, 0.3], vignette: 0.7 },
    ground: '#14161c', groundY: -0.68, groundTex: 'wood', groundTint: '#4a4038', env: 0.9 },
  'midnight-stage': { label: 'Midnight · Stage', lights: 'single-spot', pano: '/hdr/moonless_golf_2k.hdr', panoBlur: 0.35, panoRotY: 90,
    backdrop: { type: 'radial', top: '#0a0c12', bottom: '#03040a', glow: 'rgba(90,110,160,0.3)', glowAt: [0.5, 0.3], vignette: 0.7 },
    ground: '#0e1016', groundTex: 'concrete', groundTint: '#34343c', env: 0.85 },
  // Product cycs — no pano: seamless studio sweeps at tabletop height.
  'white-cyc': { label: 'White Cyc', lights: 'studio',
    backdrop: { type: 'radial', top: '#ffffff', bottom: '#e8e6e2', glow: 'rgba(255,255,255,0.9)', glowAt: [0.5, 0.35], vignette: 0.12 },
    ground: '#f2f0ec', groundY: -0.68, env: 1.7 },
  'ink-cyc': { label: 'Ink Cyc', lights: 'single-spot',
    backdrop: { type: 'radial', top: '#101014', bottom: '#050507', glow: 'rgba(160,170,200,0.2)', glowAt: [0.5, 0.32], vignette: 0.75 },
    ground: '#0c0c10', groundY: -0.68, env: 0.9 },

  // ── Batch 2 (owner ask: "30 more cinematic + 20 atmosphere/abstract").
  // CYBER — night cities + neon studio, metal/asphalt floors, cool fog. ──
  'cyber-platz': { label: 'Cyber · Platz', lights: 'neon-cross', pano: '/hdr/potsdamer_platz_2k.hdr', panoBlur: 0.08,
    backdrop: { type: 'radial', top: '#0a1020', bottom: '#020408', glow: 'rgba(80,140,255,0.35)', glowAt: [0.5, 0.3], vignette: 0.6 },
    ground: '#1a2028', groundY: -0.68, groundTex: 'metal', groundTint: '#8a95a5', env: 1.1 },
  'cyber-platz-rain': { label: 'Cyber · Rain', lights: 'neon-cross', pano: '/hdr/potsdamer_platz_2k.hdr', panoBlur: 0.42, panoRotY: 120,
    backdrop: { type: 'radial', top: '#0a1020', bottom: '#020408', glow: 'rgba(80,140,255,0.35)', glowAt: [0.5, 0.3], vignette: 0.6 },
    fog: { color: '#22304a', density: 0.05 }, ground: '#141a22', groundY: -0.68, groundTex: 'asphalt', groundTint: '#5a6a80', env: 1.0 },
  'cyber-bund': { label: 'Cyber · Bund', lights: 'neon-cross', pano: '/hdr/shanghai_bund_2k.hdr', panoBlur: 0.1,
    backdrop: { type: 'radial', top: '#101426', bottom: '#04060c', glow: 'rgba(255,120,180,0.3)', glowAt: [0.5, 0.32], vignette: 0.55 },
    fog: { color: '#1a2236', density: 0.03 }, ground: '#181c26', groundTex: 'asphalt', groundTint: '#6a7286', env: 1.15 },
  'cyber-bund-close': { label: 'Cyber · Skyline Desk', lights: 'neon-cross', pano: '/hdr/shanghai_bund_2k.hdr', panoBlur: 0.2, panoRotY: -60,
    backdrop: { type: 'radial', top: '#101426', bottom: '#04060c', glow: 'rgba(255,120,180,0.3)', glowAt: [0.5, 0.32], vignette: 0.55 },
    ground: '#1c2029', groundY: -0.68, groundTex: 'metal', groundTint: '#95a0b5', env: 1.2 },
  'cyber-neon-lab': { label: 'Neon Lab', lights: 'neon-cross', pano: '/hdr/neon_photostudio_2k.hdr', panoBlur: 0.05,
    backdrop: { type: 'bars', top: '#12001f', bottom: '#03000a', bars: ['rgba(255,0,200,0.4)', 'rgba(0,229,255,0.35)'], vignette: 0.5 },
    ground: '#181420', groundY: -0.68, groundTex: 'metal', groundTint: '#b09ac0', env: 1.35 },
  'cyber-neon-haze': { label: 'Neon Haze', lights: 'neon-cross', pano: '/hdr/neon_photostudio_2k.hdr', panoBlur: 0.5, panoRotY: 90,
    backdrop: { type: 'bars', top: '#12001f', bottom: '#03000a', bars: ['rgba(255,0,200,0.4)', 'rgba(0,229,255,0.35)'], vignette: 0.5 },
    fog: { color: '#3a1a4a', density: 0.05 }, ground: '#1a1424', groundY: -0.68, groundTex: 'asphalt', groundTint: '#7a5a90', env: 1.2 },
  'cyber-grid': { label: 'Cyber Grid', lights: 'neon-cross',
    backdrop: { type: 'bars', top: '#020617', bottom: '#0a0030', bars: ['rgba(0,229,255,0.5)', 'rgba(140,0,255,0.45)', 'rgba(255,0,180,0.35)'], vignette: 0.6 },
    fog: { color: '#101438', density: 0.06 }, ground: '#0c1024', groundY: -0.68, groundTex: 'metal', groundTint: '#4a5a8a', env: 1.0 },
  'cyber-noir': { label: 'Cyber Noir', lights: 'single-spot', pano: '/hdr/courtyard_night_2k.hdr', panoBlur: 0.12,
    backdrop: { type: 'radial', top: '#0a0c12', bottom: '#020304', glow: 'rgba(120,140,200,0.25)', glowAt: [0.5, 0.3], vignette: 0.7 },
    ground: '#10141a', groundY: -0.68, groundTex: 'asphalt', groundTint: '#4a5260', env: 0.95 },
  'cyber-alley': { label: 'Night Alley', lights: 'single-spot', pano: '/hdr/courtyard_night_2k.hdr', panoBlur: 0.32, panoRotY: 150,
    backdrop: { type: 'radial', top: '#0a0c12', bottom: '#020304', glow: 'rgba(120,140,200,0.25)', glowAt: [0.5, 0.3], vignette: 0.7 },
    fog: { color: '#141a26', density: 0.05 }, ground: '#12161e', groundTex: 'asphalt', groundTint: '#565e6e', env: 0.9 },
  'cyber-metro': { label: 'Metro Chrome', lights: 'neon-cross', pano: '/hdr/metro_noord_2k.hdr', panoBlur: 0.18,
    backdrop: { type: 'radial', top: '#dfe4ea', bottom: '#7a8494', glow: 'rgba(220,235,255,0.5)', glowAt: [0.5, 0.3], vignette: 0.4 },
    ground: '#7e8894', groundY: -0.68, groundTex: 'metal', groundTint: '#aab4c4', env: 1.3 },

  // ── OFFICE — workshops, studios, lobbies; wood/granite/marble floors. ──
  'office-workshop': { label: 'Workshop Desk', lights: 'studio', pano: '/hdr/artist_workshop_2k.hdr', panoBlur: 0.08,
    backdrop: { type: 'radial', top: '#e8dfd0', bottom: '#8a7a64', glow: 'rgba(255,240,210,0.55)', glowAt: [0.45, 0.32], vignette: 0.4 },
    ground: '#7a6448', groundY: -0.68, groundTex: 'wood', env: 1.3 },
  'office-workshop-soft': { label: 'Workshop · Soft', lights: 'studio', pano: '/hdr/artist_workshop_2k.hdr', panoBlur: 0.38, panoRotY: 90,
    backdrop: { type: 'radial', top: '#e8dfd0', bottom: '#8a7a64', glow: 'rgba(255,240,210,0.55)', glowAt: [0.45, 0.32], vignette: 0.4 },
    ground: '#8a7458', groundY: -0.68, groundTex: 'wood', env: 1.2 },
  'office-metro-hall': { label: 'Metro Hall', lights: 'studio', pano: '/hdr/metro_noord_2k.hdr', panoBlur: 0.08, panoRotY: -90,
    backdrop: { type: 'radial', top: '#dfe4ea', bottom: '#7a8494', glow: 'rgba(220,235,255,0.5)', glowAt: [0.5, 0.3], vignette: 0.4 },
    ground: '#848c98', groundTex: 'granite', env: 1.3 },
  'office-metro-desk': { label: 'Metro Desk', lights: 'studio', pano: '/hdr/metro_noord_2k.hdr', panoBlur: 0.15, panoRotY: 45,
    backdrop: { type: 'radial', top: '#dfe4ea', bottom: '#7a8494', glow: 'rgba(220,235,255,0.5)', glowAt: [0.5, 0.3], vignette: 0.4 },
    ground: '#8a929e', groundY: -0.68, groundTex: 'granite', env: 1.3 },
  'office-studio': { label: 'Studio Desk', lights: 'studio', pano: '/hdr/studio_small_03_2k.hdr', panoBlur: 0.06,
    backdrop: { type: 'radial', top: '#f0eee8', bottom: '#a8a098', glow: 'rgba(255,255,245,0.6)', glowAt: [0.5, 0.3], vignette: 0.3 },
    ground: '#9a8c78', groundY: -0.68, groundTex: 'wood', env: 1.5 },
  'office-studio-soft': { label: 'Studio · Soft', lights: 'studio', pano: '/hdr/studio_small_03_2k.hdr', panoBlur: 0.4, panoRotY: 120,
    backdrop: { type: 'radial', top: '#f0eee8', bottom: '#a8a098', glow: 'rgba(255,255,245,0.6)', glowAt: [0.5, 0.3], vignette: 0.3 },
    ground: '#a89a86', groundY: -0.68, groundTex: 'wood', env: 1.4 },
  'office-royal': { label: 'Esplanade Desk', lights: 'studio', pano: '/hdr/royal_esplanade_2k.hdr', panoBlur: 0.1,
    backdrop: { type: 'radial', top: '#efe8dc', bottom: '#9a8c7a', glow: 'rgba(255,248,230,0.6)', glowAt: [0.45, 0.3], vignette: 0.35 },
    ground: '#b0a695', groundY: -0.68, groundTex: 'marble', env: 1.45 },
  'office-royal-grand': { label: 'Esplanade Grand', lights: 'studio', pano: '/hdr/royal_esplanade_2k.hdr', panoBlur: 0.04, panoRotY: 60,
    backdrop: { type: 'radial', top: '#efe8dc', bottom: '#9a8c7a', glow: 'rgba(255,248,230,0.6)', glowAt: [0.45, 0.3], vignette: 0.35 },
    ground: '#a89e8e', groundTex: 'marble', env: 1.5 },

  // ── DARK — moody single-source looks, dark woods + stone. ──
  'dark-void': { label: 'Dark Void', lights: 'single-spot',
    backdrop: { type: 'radial', top: '#0b0b0e', bottom: '#020203', glow: 'rgba(150,160,190,0.18)', glowAt: [0.5, 0.3], vignette: 0.85 },
    ground: '#141210', groundY: -0.68, groundTex: 'dark-wood', groundTint: '#5a4c40', env: 0.8 },
  'dark-ember': { label: 'Ember', lights: 'single-spot',
    backdrop: { type: 'radial', top: '#160604', bottom: '#040100', glow: 'rgba(255,80,30,0.4)', glowAt: [0.5, 0.62], vignette: 0.75 },
    fog: { color: '#2a0c06', density: 0.05 }, ground: '#1c0e08', groundY: -0.68, groundTex: 'dark-wood', groundTint: '#6e4030', env: 0.85 },
  'dark-courtyard': { label: 'Courtyard Night', lights: 'single-spot', pano: '/hdr/courtyard_night_2k.hdr', panoBlur: 0.06,
    backdrop: { type: 'radial', top: '#0a0c12', bottom: '#020304', glow: 'rgba(120,140,200,0.25)', glowAt: [0.5, 0.3], vignette: 0.7 },
    ground: '#181410', groundY: -0.68, groundTex: 'dark-wood', groundTint: '#4e4238', env: 0.95 },
  'dark-courtyard-dream': { label: 'Courtyard · Dream', lights: 'single-spot', pano: '/hdr/courtyard_night_2k.hdr', panoBlur: 0.5, panoRotY: -100,
    backdrop: { type: 'radial', top: '#0a0c12', bottom: '#020304', glow: 'rgba(120,140,200,0.25)', glowAt: [0.5, 0.3], vignette: 0.7 },
    ground: '#16120e', groundY: -0.68, groundTex: 'dark-wood', groundTint: '#443a32', env: 0.9 },
  'dark-graphite': { label: 'Graphite', lights: 'single-spot',
    backdrop: { type: 'radial', top: '#16181c', bottom: '#050607', glow: 'rgba(200,210,230,0.15)', glowAt: [0.5, 0.28], vignette: 0.8 },
    fog: { color: '#101216', density: 0.04 }, ground: '#181a1e', groundY: -0.68, groundTex: 'metal', groundTint: '#3e444e', env: 0.85 },
  'dark-onyx': { label: 'Onyx Table', lights: 'single-spot',
    backdrop: { type: 'radial', top: '#0c0c10', bottom: '#030304', glow: 'rgba(180,190,220,0.2)', glowAt: [0.5, 0.3], vignette: 0.8 },
    ground: '#101014', groundY: -0.68, groundTex: 'marble', groundTint: '#3a3a44', env: 0.9 },
  'dark-shanghai': { label: 'Midnight Bund', lights: 'single-spot', pano: '/hdr/shanghai_bund_2k.hdr', panoBlur: 0.28, panoRotY: 180,
    backdrop: { type: 'radial', top: '#101426', bottom: '#04060c', glow: 'rgba(255,120,180,0.3)', glowAt: [0.5, 0.32], vignette: 0.55 },
    ground: '#141018', groundY: -0.68, groundTex: 'dark-wood', groundTint: '#4a3c36', env: 1.0 },
  'dark-neon-after': { label: 'Afterhours', lights: 'single-spot', pano: '/hdr/neon_photostudio_2k.hdr', panoBlur: 0.3, panoRotY: -90,
    backdrop: { type: 'bars', top: '#12001f', bottom: '#03000a', bars: ['rgba(255,0,200,0.3)', 'rgba(0,229,255,0.25)'], vignette: 0.6 },
    ground: '#141018', groundY: -0.68, groundTex: 'asphalt', groundTint: '#5a4a66', env: 0.95 },

  // ── LIGHT — bright skies + white rooms, marble/light wood. ──
  'light-sky': { label: 'Open Sky', lights: 'studio', pano: '/hdr/autumn_field_puresky_2k.hdr', panoBlur: 0.05,
    backdrop: { type: 'radial', top: '#eaf2fa', bottom: '#9db4c8', glow: 'rgba(255,255,255,0.7)', glowAt: [0.5, 0.25], vignette: 0.2 },
    ground: '#c4cdd4', groundY: -0.68, groundTex: 'marble', env: 1.6 },
  'light-sky-dream': { label: 'Sky · Dream', lights: 'studio', pano: '/hdr/autumn_field_puresky_2k.hdr', panoBlur: 0.35, panoRotY: 70,
    backdrop: { type: 'radial', top: '#eaf2fa', bottom: '#9db4c8', glow: 'rgba(255,255,255,0.7)', glowAt: [0.5, 0.25], vignette: 0.2 },
    ground: '#ccd4da', groundY: -0.68, groundTex: 'marble', env: 1.5 },
  'light-royal-air': { label: 'Esplanade Air', lights: 'studio', pano: '/hdr/royal_esplanade_2k.hdr', panoBlur: 0.22, panoRotY: -120,
    backdrop: { type: 'radial', top: '#efe8dc', bottom: '#9a8c7a', glow: 'rgba(255,248,230,0.6)', glowAt: [0.45, 0.3], vignette: 0.3 },
    ground: '#c0b8aa', groundTex: 'marble', env: 1.6 },
  'light-white-studio': { label: 'White Studio', lights: 'studio', pano: '/hdr/studio_small_03_2k.hdr', panoBlur: 0.15, panoRotY: -60,
    backdrop: { type: 'radial', top: '#f6f5f2', bottom: '#c8c4bc', glow: 'rgba(255,255,255,0.8)', glowAt: [0.5, 0.3], vignette: 0.15 },
    ground: '#d8d4cc', groundY: -0.68, groundTex: 'marble', env: 1.8 },
  'light-linen': { label: 'Linen', lights: 'studio',
    backdrop: { type: 'radial', top: '#f8f4ec', bottom: '#d8cfc0', glow: 'rgba(255,250,240,0.85)', glowAt: [0.48, 0.32], vignette: 0.15 },
    ground: '#cabfa8', groundY: -0.68, groundTex: 'wood', groundTint: '#e8dcc8', env: 1.6 },
  'light-porcelain': { label: 'Porcelain', lights: 'studio',
    backdrop: { type: 'radial', top: '#f4f7fa', bottom: '#ccd6de', glow: 'rgba(255,255,255,0.9)', glowAt: [0.5, 0.3], vignette: 0.12 },
    ground: '#dee4e8', groundY: -0.68, groundTex: 'marble', env: 1.75 },
  'light-morning-shop': { label: 'Morning Shop', lights: 'studio', pano: '/hdr/artist_workshop_2k.hdr', panoBlur: 0.25, panoRotY: -45,
    backdrop: { type: 'radial', top: '#e8dfd0', bottom: '#8a7a64', glow: 'rgba(255,240,210,0.55)', glowAt: [0.45, 0.32], vignette: 0.35 },
    ground: '#b8a488', groundY: -0.68, groundTex: 'wood', groundTint: '#e0cdb0', env: 1.55 },
  'light-gallery-hall': { label: 'Gallery Hall', lights: 'studio', pano: '/hdr/metro_noord_2k.hdr', panoBlur: 0.1, panoRotY: 135,
    backdrop: { type: 'radial', top: '#e8ecf0', bottom: '#a2acb8', glow: 'rgba(240,248,255,0.6)', glowAt: [0.5, 0.28], vignette: 0.25 },
    ground: '#b8c0ca', groundTex: 'marble', env: 1.5 },

  // ── ABSTRACT / ATMOSPHERE — procedural color fields with textured
  //    floors and fog; no pano, all palette. ──
  'abs-magma': { label: 'Magma', lights: 'single-spot',
    backdrop: { type: 'sunset', top: '#1a0400', mid: '#7a1400', bottom: '#ff5a00', sun: 'rgba(255,200,120,0.9)', sunAt: [0.5, 0.66], vignette: 0.55 },
    fog: { color: '#3a0e02', density: 0.06 }, ground: '#200a04', groundY: -0.68, groundTex: 'asphalt', groundTint: '#7a3018', env: 1.0 },
  'abs-ultraviolet': { label: 'Ultraviolet', lights: 'neon-cross',
    backdrop: { type: 'radial', top: '#1c0036', bottom: '#05000e', glow: 'rgba(170,60,255,0.55)', glowAt: [0.5, 0.35], vignette: 0.55 },
    fog: { color: '#22004a', density: 0.05 }, ground: '#160026', groundY: -0.68, groundTex: 'granite', groundTint: '#6a3aa0', env: 1.05 },
  'abs-tealfog': { label: 'Teal Fog', lights: 'studio',
    backdrop: { type: 'radial', top: '#02272b', bottom: '#000d10', glow: 'rgba(40,220,210,0.4)', glowAt: [0.5, 0.3], vignette: 0.5 },
    fog: { color: '#083236', density: 0.09 }, ground: '#06282c', groundY: -0.68, groundTex: 'concrete', groundTint: '#2e7a7a', env: 1.1 },
  'abs-acid': { label: 'Acid Bars', lights: 'neon-cross',
    backdrop: { type: 'bars', top: '#0a1a00', bottom: '#001005', bars: ['rgba(170,255,0,0.5)', 'rgba(0,255,140,0.4)', 'rgba(255,240,0,0.3)'], vignette: 0.45 },
    ground: '#0c1c06', groundY: -0.68, groundTex: 'metal', groundTint: '#5a8a30', env: 1.15 },
  'abs-rose': { label: 'Rose Quartz', lights: 'studio',
    backdrop: { type: 'radial', top: '#ffe9f2', bottom: '#e8a8c4', glow: 'rgba(255,255,255,0.8)', glowAt: [0.5, 0.3], vignette: 0.18 },
    ground: '#e8c4d4', groundY: -0.68, groundTex: 'marble', groundTint: '#f4d4e0', env: 1.5 },
  'abs-cobalt': { label: 'Cobalt', lights: 'neon-cross',
    backdrop: { type: 'radial', top: '#001240', bottom: '#000414', glow: 'rgba(60,130,255,0.5)', glowAt: [0.5, 0.34], vignette: 0.5 },
    fog: { color: '#001a4a', density: 0.05 }, ground: '#02102e', groundY: -0.68, groundTex: 'metal', groundTint: '#3a5a9a', env: 1.1 },
  'abs-sandstorm': { label: 'Sandstorm', lights: 'studio',
    backdrop: { type: 'sunset', top: '#5a4020', mid: '#a87838', bottom: '#e8b878', sun: 'rgba(255,240,200,0.7)', sunAt: [0.5, 0.55], vignette: 0.4 },
    fog: { color: '#b08a58', density: 0.1 }, ground: '#9a7848', groundY: -0.68, groundTex: 'asphalt', groundTint: '#c8a068', env: 1.25 },
  'abs-mint': { label: 'Mint', lights: 'studio',
    backdrop: { type: 'radial', top: '#eafff5', bottom: '#a8e8cc', glow: 'rgba(255,255,255,0.85)', glowAt: [0.5, 0.3], vignette: 0.15 },
    ground: '#c8e8d8', groundY: -0.68, groundTex: 'marble', groundTint: '#e0f4e8', env: 1.55 },
  'abs-bloodbars': { label: 'Blood Bars', lights: 'single-spot',
    backdrop: { type: 'bars', top: '#1a0004', bottom: '#050001', bars: ['rgba(255,20,40,0.5)', 'rgba(120,0,10,0.45)'], vignette: 0.65 },
    ground: '#180608', groundY: -0.68, groundTex: 'dark-wood', groundTint: '#5a2028', env: 0.9 },
  'abs-arctic': { label: 'Arctic', lights: 'studio',
    backdrop: { type: 'radial', top: '#f0f8ff', bottom: '#b8d4e8', glow: 'rgba(255,255,255,0.95)', glowAt: [0.5, 0.28], vignette: 0.15 },
    fog: { color: '#d8ecf8', density: 0.04 }, ground: '#d4e4ee', groundY: -0.68, groundTex: 'marble', env: 1.7 },
  'abs-goldleaf': { label: 'Gold Leaf', lights: 'studio',
    backdrop: { type: 'radial', top: '#3a2a08', bottom: '#100a02', glow: 'rgba(255,200,80,0.6)', glowAt: [0.5, 0.34], vignette: 0.5 },
    ground: '#2e2408', groundY: -0.68, groundTex: 'granite', groundTint: '#b08a3a', env: 1.2 },
  'abs-noirfog': { label: 'Noir Fog', lights: 'single-spot',
    backdrop: { type: 'radial', top: '#181a1e', bottom: '#040506', glow: 'rgba(220,225,235,0.2)', glowAt: [0.5, 0.3], vignette: 0.8 },
    fog: { color: '#14161a', density: 0.12 }, ground: '#16181c', groundY: -0.68, groundTex: 'asphalt', groundTint: '#3a4048', env: 0.85 },
  'abs-cotton': { label: 'Cotton Sky', lights: 'studio',
    backdrop: { type: 'sunset', top: '#a8c8e8', mid: '#e8c8d8', bottom: '#f8e8d8', sun: 'rgba(255,255,255,0.8)', sunAt: [0.5, 0.5], vignette: 0.2 },
    ground: '#e0d4d8', groundY: -0.68, groundTex: 'marble', env: 1.5 },
  'abs-jade': { label: 'Jade', lights: 'studio',
    backdrop: { type: 'radial', top: '#04301e', bottom: '#010e08', glow: 'rgba(60,220,150,0.4)', glowAt: [0.5, 0.32], vignette: 0.5 },
    ground: '#06281a', groundY: -0.68, groundTex: 'granite', groundTint: '#2a7a54', env: 1.05 },
  'abs-royal': { label: 'Royal Purple', lights: 'single-spot',
    backdrop: { type: 'sunset', top: '#20003a', mid: '#5a0a6a', bottom: '#a8207a', sun: 'rgba(255,160,220,0.6)', sunAt: [0.5, 0.6], vignette: 0.5 },
    ground: '#1c0630', groundY: -0.68, groundTex: 'marble', groundTint: '#5a3a7a', env: 1.0 },
  'abs-solar': { label: 'Solar', lights: 'studio',
    backdrop: { type: 'radial', top: '#fff8e0', bottom: '#e87a10', glow: 'rgba(255,255,240,0.95)', glowAt: [0.5, 0.4], vignette: 0.3 },
    fog: { color: '#f0a040', density: 0.03 }, ground: '#d88a30', groundY: -0.68, groundTex: 'metal', groundTint: '#f0b060', env: 1.5 },
  'candy-pop': {
    label: 'Candy Pop',
    lights: 'neon-cross',
    backdrop: { type: 'radial', top: '#fff3fa', bottom: '#ffd1ec', glow: 'rgba(255,255,255,0.9)', glowAt: [0.5, 0.3], vignette: 0.15 },
    key: { color: '#ffffff', intensity: 2.4, pos: [1.2, 2.4, 2.4] },
    rim: { color: '#7dd8ff', intensity: 1.3 },
    ground: '#ffe3f2',
    env: 1.8,
  },
  'gallery-white': {
    label: 'Gallery White',
    lights: 'studio',
    backdrop: { type: 'radial', top: '#ffffff', bottom: '#e6e6ea', glow: 'rgba(255,255,255,1)', glowAt: [0.5, 0.25], vignette: 0.18 },
    fog: { color: '#f0f0f2', density: 0.04 },
    key: { color: '#ffffff', intensity: 2.2, pos: [1, 3, 2] },
    rim: { color: '#dfe6ff', intensity: 0.8 },
    ground: '#f2f2f4',
    env: 2,
  },
};

// ── Graphic treatments — one display-space look at a time, compiled into the
// finish pass by #define (switching is user-rare, frames are hot). `params`
// declares what the generic t1/t2/t3 slots mean for each look; `colors` names
// the ink/paper pair when the look uses one. ──
const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${Math.round(v)}px`;
const deg = (v) => `${Math.round(v)}°`;
const num = (v) => String(Math.round(v));
const x2 = (v) => v.toFixed(2);
const TREATMENTS = {
  none:      { label: 'None', define: null, params: [] },
  halftone:  { label: 'Halftone', define: 'FX_HALFTONE', colors: ['Ink', 'Paper'], params: [
    ['t1', 'DOT SIZE', 3, 30, 0.5, px], ['t2', 'SCREEN ANGLE', 0, 90, 1, deg], ['t3', 'BLEND', 0, 1, 0.01, pct]] },
  pixel:     { label: 'Pixel Blocks', define: 'FX_PIXEL', params: [
    ['t1', 'BLOCK SIZE', 2, 40, 1, px], ['t2', 'COLOR STEPS', 2, 16, 1, num]] },
  poster:    { label: 'Posterize', define: 'FX_POSTER', params: [
    ['t1', 'LEVELS', 2, 12, 1, num], ['t2', 'DITHER', 0, 1, 0.01, pct]] },
  threshold: { label: '1-Bit Threshold', define: 'FX_THRESHOLD', colors: ['Dark', 'Light'], params: [
    ['t1', 'THRESHOLD', 0, 1, 0.01, pct], ['t2', 'DITHER', 0, 1, 0.01, pct]] },
  duotone:   { label: 'Duotone', define: 'FX_DUOTONE', colors: ['Shadow', 'Highlight'], params: [
    ['t1', 'BLEND', 0, 1, 0.01, pct], ['t2', 'TONE CURVE', 0.2, 3, 0.05, x2]] },
  chroma:    { label: 'Chromatic Split', define: 'FX_CHROMA', params: [
    ['t1', 'SPLIT', 0, 40, 0.5, px], ['t2', 'FALLOFF', 0.2, 4, 0.1, x2]] },
  scanline:  { label: 'CRT Scanlines', define: 'FX_SCANLINE', params: [
    ['t1', 'LINE COUNT', 60, 1200, 10, num], ['t2', 'STRENGTH', 0, 1, 0.01, pct], ['t3', 'ROLL', 0, 3, 0.05, x2]] },
  riso:      { label: 'Riso Misregister', define: 'FX_RISO', colors: ['Ink 1', 'Ink 2'], params: [
    ['t1', 'MISREGISTER', 0, 30, 0.5, px], ['t2', 'PAPER GRAIN', 0, 1, 0.01, pct]] },
  edges:     { label: 'Edge Lines', define: 'FX_EDGES', colors: ['Line', 'Paper'], params: [
    ['t1', 'LINE STRENGTH', 0, 2, 0.02, x2], ['t2', 'KEEP IMAGE', 0, 1, 0.01, pct]] },
  solarize:  { label: 'Solarize', define: 'FX_SOLARIZE', params: [
    ['t1', 'PIVOT', 0, 1, 0.01, pct], ['t2', 'AMOUNT', 0, 1, 0.01, pct]] },
  crossproc: { label: 'Cross Process', define: 'FX_CROSSPROC', colors: ['Shadow tint', 'Highlight tint'], params: [
    ['t1', 'AMOUNT', 0, 1, 0.01, pct], ['t2', 'CONTRAST', 0, 1.5, 0.02, x2]] },
  mirror:    { label: 'Kaleidoscope', define: 'FX_MIRROR', params: [
    ['t1', 'SEGMENTS', 2, 12, 1, num], ['t2', 'SPIN', 0, 6.28, 0.05, x2]] },
};

// Material fields only — MATERIAL_PRESETS entries also carry label/group/env/bg
// that the material state has no business holding.
const matFrom = (id, over = {}) => {
  const src = MATERIAL_PRESETS[id] || DEFAULT_MAT;
  const out = { ...DEFAULT_MAT };
  Object.keys(DEFAULT_MAT).forEach((k) => { if (src[k] !== undefined) out[k] = src[k]; });
  return { ...out, ...over, preset: '' };
};

// ── FX presets — complete looks. Each one drives the whole stage: treatment +
// bloom/grain/vignette, the material dials, environment light, backdrop and
// light rig. Picking one overwrites the Material / Background / Lighting cards
// (that is the point); nudging any dial afterwards drops back to Custom. ──
const FX_PRESETS = {
  // ── PRINT ──
  'halftone-press': { label: 'Halftone Press', group: 'PRINT',
    fx: { treatment: 'halftone', t1: 9, t2: 22, t3: 1, colA: '#111114', colB: '#f2efe6', bloom: false, bloomStrength: 0.4, bloomThreshold: 0.85, grain: 0.14, vignette: 0.28 },
    mat: matFrom('paper'), envId: 'room', bg: { mode: 'color', color: '#f2efe6' }, envIntensity: 1.7, lights: 'studio' },
  'newsprint-1bit': { label: 'Newsprint 1-Bit', group: 'PRINT',
    fx: { treatment: 'threshold', t1: 0.46, t2: 0.34, t3: 1, colA: '#141414', colB: '#efece2', bloom: false, bloomStrength: 0.4, bloomThreshold: 0.8, grain: 0.2, vignette: 0.2 },
    mat: matFrom('paper', { roughness: 0.95, bump: 0.7 }), envId: 'room', bg: { mode: 'color', color: '#efece2' }, envIntensity: 1.9, lights: 'top-wash' },
  'riso-duotone': { label: 'Riso Duotone', group: 'PRINT',
    fx: { treatment: 'riso', t1: 11, t2: 0.55, t3: 1, colA: '#ff4d8d', colB: '#2f5cff', bloom: false, bloomStrength: 0.4, bloomThreshold: 0.8, grain: 0.12, vignette: 0.18 },
    mat: matFrom('paper', { baseColor: '#f7f4ec' }), envId: 'room', bg: { mode: 'color', color: '#f6f2e8' }, envIntensity: 1.8, lights: 'studio' },
  'screenprint-lines': { label: 'Screenprint Lines', group: 'PRINT',
    fx: { treatment: 'edges', t1: 1.1, t2: 0.12, t3: 1, colA: '#0f0f14', colB: '#f5f2ea', bloom: false, bloomStrength: 0.4, bloomThreshold: 0.8, grain: 0.1, vignette: 0.15 },
    mat: matFrom('chrome'), envId: 'hall', bg: { mode: 'color', color: '#f5f2ea' }, envIntensity: 1.4, lights: 'studio' },
  'xerox-blowout': { label: 'Xerox Blowout', group: 'PRINT',
    fx: { treatment: 'threshold', t1: 0.62, t2: 0.75, t3: 1, colA: '#000000', colB: '#ffffff', bloom: true, bloomStrength: 0.7, bloomThreshold: 0.7, grain: 0.35, vignette: 0.4 },
    mat: matFrom('chrome-storm'), envId: 'night', bg: { mode: 'color', color: '#0a0a0c' }, envIntensity: 1.2, lights: 'single-spot' },

  // ── PHOTO ──
  'cinema-bloom': { label: 'Cinema Bloom', group: 'PHOTO',
    fx: { treatment: 'none', t1: 8, t2: 45, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 0.95, bloomThreshold: 0.62, grain: 0.16, vignette: 0.5 },
    mat: matFrom('midnight-drama'), envId: 'sunset', bg: { scene: 'thriller' }, envIntensity: 0.9, lights: 'single-spot' },
  'cross-process': { label: 'Cross Process', group: 'PHOTO',
    fx: { treatment: 'crossproc', t1: 0.75, t2: 0.6, t3: 1, colA: '#12324a', colB: '#ffd9a0', bloom: true, bloomStrength: 0.45, bloomThreshold: 0.75, grain: 0.2, vignette: 0.35 },
    mat: matFrom('liquid-gold'), envId: 'dusk', bg: { scene: 'golden-hour' }, envIntensity: 1.5, lights: 'studio' },
  'faded-archive': { label: 'Faded Archive', group: 'PHOTO',
    fx: { treatment: 'duotone', t1: 0.8, t2: 0.85, t3: 1, colA: '#3a2b1e', colB: '#efe2c6', bloom: false, bloomStrength: 0.4, bloomThreshold: 0.8, grain: 0.3, vignette: 0.45 },
    mat: matFrom('silk', { baseColor: '#6b5b46' }), envId: 'sunset', bg: { scene: 'retro-sunset' }, envIntensity: 1.3, lights: 'top-wash' },
  'night-neon': { label: 'Night Neon', group: 'PHOTO',
    fx: { treatment: 'chroma', t1: 14, t2: 1.8, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 1.1, bloomThreshold: 0.55, grain: 0.22, vignette: 0.5 },
    mat: matFrom('neon-noir'), envId: 'night', bg: { scene: 'neon-alley' }, envIntensity: 0.8, lights: 'neon-cross' },
  'studio-clean': { label: 'Studio Clean', group: 'PHOTO',
    fx: { treatment: 'none', t1: 8, t2: 45, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 0.3, bloomThreshold: 0.9, grain: 0.04, vignette: 0.12 },
    mat: matFrom('studio-white'), envId: 'hall', bg: { mode: 'color', color: '#fbfaf7' }, envIntensity: 2.1, lights: 'studio' },

  // ── DIGITAL ──
  'crt-broadcast': { label: 'CRT Broadcast', group: 'DIGITAL',
    fx: { treatment: 'scanline', t1: 420, t2: 0.6, t3: 1.2, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 0.8, bloomThreshold: 0.6, grain: 0.25, vignette: 0.55 },
    mat: matFrom('chrome-storm'), envId: 'night', bg: { scene: 'deep-sea' }, envIntensity: 1.4, lights: 'neon-cross' },
  'pixel-console': { label: 'Pixel Console', group: 'DIGITAL',
    fx: { treatment: 'pixel', t1: 10, t2: 6, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: false, bloomStrength: 0.4, bloomThreshold: 0.8, grain: 0, vignette: 0.2 },
    mat: matFrom('candy-gloss'), envId: 'room', bg: { scene: 'candy-pop' }, envIntensity: 1.5, lights: 'studio' },
  'chromatic-glitch': { label: 'Chromatic Glitch', group: 'DIGITAL',
    fx: { treatment: 'chroma', t1: 30, t2: 3.2, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 0.9, bloomThreshold: 0.5, grain: 0.4, vignette: 0.45 },
    mat: matFrom('oil-slick'), envId: 'night', bg: { mode: 'color', color: '#05060a' }, envIntensity: 1.1, lights: 'fire-ice' },
  'vapor-grid': { label: 'Vapor Grid', group: 'DIGITAL',
    fx: { treatment: 'duotone', t1: 0.9, t2: 0.7, t3: 1, colA: '#2a0a4a', colB: '#00e5ff', bloom: true, bloomStrength: 0.85, bloomThreshold: 0.6, grain: 0.15, vignette: 0.4 },
    mat: matFrom('holo-foil'), envId: 'dusk', bg: { scene: 'neon-alley' }, envIntensity: 1.2, lights: 'neon-cross' },
  'data-mosh': { label: 'Data Mosh', group: 'DIGITAL',
    fx: { treatment: 'pixel', t1: 26, t2: 3, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 1.2, bloomThreshold: 0.45, grain: 0.3, vignette: 0.3 },
    mat: matFrom('acid-rave'), envId: 'night', bg: { mode: 'color', color: '#0c1402' }, envIntensity: 1.3, lights: 'neon-cross' },

  // ── EXPERIMENTAL ──
  'solar-burn': { label: 'Solar Flare Burn', group: 'EXPERIMENTAL',
    fx: { treatment: 'solarize', t1: 0.42, t2: 0.8, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 1.0, bloomThreshold: 0.5, grain: 0.2, vignette: 0.35 },
    mat: matFrom('solar-flare'), envId: 'sunset', bg: { scene: 'golden-hour' }, envIntensity: 1.7, lights: 'fire-ice' },
  'kaleido-cathedral': { label: 'Kaleido Cathedral', group: 'EXPERIMENTAL',
    fx: { treatment: 'mirror', t1: 6, t2: 0.4, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 0.7, bloomThreshold: 0.65, grain: 0.1, vignette: 0.5 },
    mat: matFrom('gothic-pearl'), envId: 'hall', bg: { scene: 'smoke-stage' }, envIntensity: 1.6, lights: 'top-wash' },
  'acid-posterize': { label: 'Acid Posterize', group: 'EXPERIMENTAL',
    fx: { treatment: 'poster', t1: 4, t2: 0.7, t3: 1, colA: '#101014', colB: '#f4f1ea', bloom: true, bloomStrength: 0.6, bloomThreshold: 0.6, grain: 0.12, vignette: 0.3 },
    mat: matFrom('acid-rave'), envId: 'dusk', bg: { mode: 'color', color: '#0c1402' }, envIntensity: 1.5, lights: 'neon-cross' },
  'blueprint-cyanotype': { label: 'Blueprint Cyanotype', group: 'EXPERIMENTAL',
    fx: { treatment: 'duotone', t1: 1, t2: 1.6, t3: 1, colA: '#08284f', colB: '#dbe9f7', bloom: false, bloomStrength: 0.4, bloomThreshold: 0.8, grain: 0.26, vignette: 0.35 },
    mat: matFrom('paper', { baseColor: '#cfd8e6' }), envId: 'night', bg: { mode: 'color', color: '#0a2246' }, envIntensity: 1.6, lights: 'top-wash' },
  'chrome-emboss': { label: 'Chrome Emboss', group: 'EXPERIMENTAL',
    fx: { treatment: 'edges', t1: 0.7, t2: 0.85, t3: 1, colA: '#ffffff', colB: '#0b0b10', bloom: true, bloomStrength: 0.5, bloomThreshold: 0.7, grain: 0.08, vignette: 0.4 },
    mat: matFrom('chrome-storm'), envId: 'hall', bg: { mode: 'color', color: '#15181f' }, envIntensity: 2, lights: 'fire-ice' },
};
const FX_PRESET_GROUPS = ['PRINT', 'PHOTO', 'DIGITAL', 'EXPERIMENTAL'];

// Paint a scene's backdrop: base grade + glow/sun/bars + optional light beam +
// film grain + vignette. Grain and vignette give the "texture + depth" read.
const paintSceneBackdrop = (cfg) => {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, 1024);
  if (cfg.type === 'sunset') {
    grad.addColorStop(0, cfg.top); grad.addColorStop(0.55, cfg.mid); grad.addColorStop(1, cfg.bottom);
  } else {
    grad.addColorStop(0, cfg.top); grad.addColorStop(1, cfg.bottom);
  }
  x.fillStyle = grad; x.fillRect(0, 0, 1024, 1024);
  if (cfg.type === 'sunset' && cfg.sun) {
    const [sx, sy] = cfg.sunAt || [0.5, 0.6];
    const sun = x.createRadialGradient(sx * 1024, sy * 1024, 20, sx * 1024, sy * 1024, 340);
    sun.addColorStop(0, cfg.sun); sun.addColorStop(1, 'rgba(255,180,80,0)');
    x.fillStyle = sun; x.fillRect(0, 0, 1024, 1024);
  }
  if (cfg.glow) {
    const [gx, gy] = cfg.glowAt || [0.5, 0.4];
    const g = x.createRadialGradient(gx * 1024, gy * 1024, 30, gx * 1024, gy * 1024, 700);
    g.addColorStop(0, cfg.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  }
  if (cfg.bars) {
    cfg.bars.forEach((color, i) => {
      const bx = 1024 * (0.18 + i * 0.3);
      const bar = x.createLinearGradient(bx - 60, 0, bx + 60, 0);
      bar.addColorStop(0, 'rgba(0,0,0,0)'); bar.addColorStop(0.5, color); bar.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = bar; x.fillRect(bx - 60, 0, 120, 1024);
    });
  }
  if (cfg.beam) {
    // Fake volumetric cone from the top — sells the spotlight.
    const beam = x.createLinearGradient(0, 0, 0, 1024);
    beam.addColorStop(0, cfg.beam); beam.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = beam;
    x.beginPath();
    x.moveTo(460, 0); x.lineTo(564, 0); x.lineTo(900, 1024); x.lineTo(124, 1024);
    x.closePath(); x.fill();
  }
  // Film grain
  x.globalAlpha = 0.05;
  for (let i = 0; i < 4200; i += 1) {
    x.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
    x.fillRect(Math.random() * 1024, Math.random() * 1024, 1.4, 1.4);
  }
  x.globalAlpha = 1;
  // Vignette
  if (cfg.vignette) {
    const v = x.createRadialGradient(512, 480, 300, 512, 512, 780);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${cfg.vignette})`);
    x.fillStyle = v; x.fillRect(0, 0, 1024, 1024);
  }
  return c;
};

// Video export containers — MP4 records natively in modern Chrome + Safari;
// WebM covers everything else. Export falls back automatically if the chosen
// container isn't supported by this browser's MediaRecorder.
const VIDEO_FORMATS = {
  mp4:  { label: 'MP4',  ext: 'mp4',  mimes: ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4'] },
  webm: { label: 'WebM', ext: 'webm', mimes: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] },
};
// Timeline (Phase 4) EXPORT TIMELINE ceiling — well above the manual VIDEO
// LENGTH dropdown's 15s max (a full promo sequence legitimately runs
// longer) but still a sane bound on a single browser MediaRecorder capture;
// a longer timeline is capped with a status note rather than attempting a
// multi-minute capture (see exportTimeline's own comment).
const TIMELINE_EXPORT_MAX_SECONDS = 60;
// Worst-case wall clock for the Go-Live screen capture that precedes an
// export, mirroring app/api/public/studio-device-capture/route.js's own
// ladder (2 full-page attempts + one viewport fallback, bounded under its
// maxDuration). Shown as a CEILING alongside the elapsed counter: an
// open-ended "38s" that keeps climbing reads as a hung render, which is
// exactly how this was first reported.
const LIVE_CAPTURE_MAX_SECONDS = 110;
// Proof Render (Slice 4e) — fixed small/cheap render params. A Proof is a
// fast sanity check that a recipe renders correctly on the real production
// pipeline (services/studio-render/art-render.mjs), never a full-quality
// export (that's a later phase). Comfortably inside every
// services/studio-render/art-render-validation.mjs LIMITS bound.
const PROOF_RENDER_PARAMS = { width: 640, height: 360, fps: 24, durationSeconds: 3, warmupFrames: 3 };
// Final Render presets (Phase 4, STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
// HANDOFF.md) — mirrors services/studio-render/art-render-validation.mjs's
// own FINAL_RENDER_PRESETS verbatim (same duplication discipline as
// PROOF_RENDER_PARAMS above and art-recipe.mjs's own enum-list header
// comment: this file can't import a Node-only service module into the
// client bundle, so the small allowlist is mirrored, not shared). The
// SERVER is what actually enforces this list (route.js's 'create-final'
// action resolves an id server-side, never trusts a client-sent width/
// height/fps) — this client-side copy only drives the picker UI and what
// id gets sent; sending an unknown id is simply rejected with a 400, never
// silently coerced.
const FINAL_RENDER_LABELS = { '30': '30fps', '60': '60fps' };
// Truthful unsupported-feature copy (capability-copy correction round): the
// message is driven by the server's OWN unsupported list — never a second
// hardcoded "what the renderer supports" summary (the old copy claimed the
// original Phase 0 subset long after scenes/IBL/Glass/T-shirt/Device/pinned
// screens all shipped). Targeted guidance only for features with a real
// user action; everything else shows its precise capability name.
const CAPABILITY_GUIDANCE = {
  // Updated ("Live URL wired to Final Render" wiring round) — device-screen-
  // live is no longer a blanket "Go Live can't render" rejection: Final
  // Render now genuinely captures and renders the real live site
  // server-side (Proof still pins a captured screen instead — a live
  // capture doesn't fit its small/fast deterministic-check profile). This
  // guidance only ever appears when the live URL itself is missing/
  // malformed (art-render-validation.mjs's own isValidHttpUrl gate) — a
  // genuinely usable URL renders, it never needs this message.
  'device-screen-live': 'The Live Screen URL isn’t usable for rendering — enter a full address starting with http:// or https:// and click Go Live, or switch to Capture/Upload for a pinned screen instead.',
  'device-screen-capture': 'The captured screen pins automatically when you generate — if this appears, the pin step failed; retry the render.',
  'device-screen-upload': 'The uploaded screen pins automatically when you generate — if this appears, the pin step failed; retry the render.',
  'device-screen-still-invalid': 'The pinned screen reference is damaged — re-Capture (or re-select the upload) and generate again.',
  'frame-unknown': 'The selected capture frame isn’t one of the known frames — pick one from the frame carousel (or set it to Off).',
  // Recovery round 2 (Fix 4) — a camera-move keyframe (position/target)
  // isn't one this render pass can animate yet; see the timeline-field
  // prefix below for every OTHER keyframed field.
  'timeline-orbit-pose': 'A keyframe moves the camera (drag-orbit position/target), which isn’t animated by this render yet — use Export Timeline (Quick Export) below to render camera moves today, or keep the camera in the same position across every keyframe.',
};
// Recovery round 2 (Fix 4) — `timeline-field:<dot.path>` names are DYNAMIC
// (one per keyframed field the deep-diff caught — art-timeline.mjs's
// checkArtTimelineCapabilities), so a fixed CAPABILITY_GUIDANCE lookup can
// never cover them by exact string. The generic "Disable them or choose a
// supported alternative" line is actively wrong for these — there is
// nothing to disable, the field is only a problem BECAUSE it's keyframed.
// This names the exact field and points at the one path that already
// renders it today (Export Timeline's own browser MediaRecorder capture,
// which plays the live timeline exactly as authored).
const TIMELINE_FIELD_PREFIX = 'timeline-field:';
function describeTimelineFieldGuidance(fieldPath, renderName) {
  return `A keyframe animates "${fieldPath}", which ${renderName} can’t animate yet (today it only animates the device screen’s scroll position and page height) — use Export Timeline (Quick Export) below to render this animation now, or keep "${fieldPath}" the same across every keyframe.`;
}
function describeUnsupportedFeatures(features, renderName) {
  const list = (features || []).filter(Boolean);
  const tips = list.map((f) => (
    f.startsWith(TIMELINE_FIELD_PREFIX)
      ? describeTimelineFieldGuidance(f.slice(TIMELINE_FIELD_PREFIX.length), renderName)
      : CAPABILITY_GUIDANCE[f]
  )).filter(Boolean);
  return `${renderName} doesn’t support the listed feature(s) yet: ${list.join(', ')}. Disable them or choose a supported alternative.${tips.length ? ` ${tips.join(' ')}` : ''}`;
}
// Capture Frame parity round: an ACTIVE capture frame owns the Final Render
// output aspect — the export IS the frame's crop at its native platform
// size (FRAME_PRESETS ids double as the server preset family names). With
// no frame, the sheet aspect decides exactly as before. The SERVER enforces
// this same derivation (finalRenderFamilyForRecipe in
// art-render-validation.mjs) — this mirror only drives the picker/caption.
function finalRenderFamilyFor(clothAspectValue, frameIdValue) {
  if (frameIdValue && frameIdValue !== 'off' && FRAME_PRESETS[frameIdValue]?.w) return frameIdValue;
  return clothAspectValue === 'square' ? 'square' : clothAspectValue === 'portrait' ? 'portrait' : 'landscape';
}
function finalRenderPresetIdFor(clothAspectValue, frameIdValue, quality) {
  return `${finalRenderFamilyFor(clothAspectValue, frameIdValue)}-1080p-${quality}`;
}
function finalRenderDimensionsFor(clothAspectValue, frameIdValue) {
  const family = finalRenderFamilyFor(clothAspectValue, frameIdValue);
  const frame = FRAME_PRESETS[family];
  if (frame?.w) return { width: frame.w, height: frame.h };
  if (family === 'square') return { width: 1080, height: 1080 };
  if (family === 'portrait') return { width: 1080, height: 1350 };
  return { width: 1920, height: 1080 }; // 'landscape' and 'auto' both resolve to 16:9 1080p
}
// An abortable sleep — lets an in-flight poll wait be cancelled immediately
// (real AbortController cancellation, not just a soft "ignore the result
// when it eventually resolves" flag) instead of always waiting out the full
// interval before the loop notices it's been superseded or unmounted.
const abortableDelay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
  const onAbort = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); };
  // `{ once: true }` only removes onAbort when the abort EVENT actually
  // fires. The normal-resolve path (the timer just elapsing, the common
  // case on every poll attempt that isn't cancelled) never fires that
  // event, so without this explicit removeEventListener the listener stayed
  // attached to the SAME long-lived signal for the rest of the poll loop —
  // up to 120 accumulated, never-removed listeners on one AbortController.
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});
const supportedMimeFor = (fmt) => {
  if (typeof MediaRecorder === 'undefined') return '';
  return (VIDEO_FORMATS[fmt]?.mimes || []).find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

// High-res video export safeguards (Phase 2) — real WebGL limits read from
// the live renderer's own context, fed into elements/video-export.js's pure
// evaluateExportCapability rather than guessed. Never throws: an
// unreadable/unavailable limit is reported as undefined (evaluateExportCapability
// already treats an undefined signal as "unknown," never "unsafe").
const readGlLimits = (renderer) => {
  try {
    const gl = renderer.getContext();
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    return {
      maxTextureSize: renderer.capabilities?.maxTextureSize,
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewportDims: maxViewportDims ? Array.from(maxViewportDims) : undefined,
    };
  } catch {
    return {};
  }
};

// Live sustained-throughput measurement — "use 30fps unless live measurement
// PROVES 60fps is sustainable." Counts real requestAnimationFrame callbacks
// over a short window at whatever resolution the renderer is CURRENTLY set
// to (the export never resizes it, so this is always the real recording
// resolution, not a guess). The main render loop keeps running throughout
// this window (it's an independent, always-on rAF loop) — a heavy
// composer.render() genuinely throttles the browser's overall rAF cadence
// when the GPU can't keep up, so this reflects real achievable throughput,
// not just display refresh rate.
// hardCeilingMs is a real-time (setTimeout, NOT rAF-driven) backstop —
// discovered via live testing: a backgrounded/unfocused tab throttles
// requestAnimationFrame severely (sometimes to a small handful of ticks per
// second, occasionally near-zero), which without this ceiling could leave
// the rAF-driven sampling loop below waiting far longer than durationMs to
// accumulate enough ticks. That would leave the "Preparing export…" phase
// hung for an unbounded time — and since cancellation is only checked AFTER
// this promise resolves, an unbounded measurement effectively made Cancel
// unresponsive during preparation. The ceiling guarantees this always
// settles in bounded real time regardless of tab visibility; an unreached
// sample count on ceiling resolves NaN, and chooseCaptureFps treats NaN as
// "unknown" (defaults to 30fps), the same safe fallback as any other
// invalid measurement.
const measureSustainableFps = (durationMs = 300, hardCeilingMs = 1500) => new Promise((resolve) => {
  let settled = false;
  const settle = (value) => { if (settled) return; settled = true; resolve(value); };
  const ceiling = setTimeout(() => settle(NaN), hardCeilingMs);
  let count = 0;
  const start = performance.now();
  const tick = () => {
    count += 1;
    const elapsed = performance.now() - start;
    if (elapsed >= durationMs) { clearTimeout(ceiling); settle((count / elapsed) * 1000); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// ── Live-screen teardown, imperative (export-restore Phase 5) ─────────────
// Removes the CSS3D live iframe and puts the factory's own textured screen
// material back on the screen mesh. This is the exact body the live-screen
// effect's own `restore()` runs — extracted to module scope so the EXPORT
// path can perform the teardown SYNCHRONOUSLY at the moment it decides to
// export, instead of setting `live:false` and hoping React commits the
// effect before the recorder starts. While `world.deviceLive` is non-null
// the render loop sets `treatmentPass.uniforms.uCleanAlphaHole = 1`, which
// punches the screen region transparent — a device that fills the frame
// then records as a blank video, which is exactly the reported symptom.
// Idempotent: safe to call when nothing is live, and safe to call again
// from the effect's own cleanup immediately afterwards.
// ── Tab-capture release (Phase 8) ────────────────────────────────────────
// Stops every track of a getDisplayMedia stream and detaches the offscreen
// <video> that was decoding it. Called on EVERY exit path of a "Record live
// screen" export (success, cancel, any failure, and the early returns that
// happen before the recorder lifecycle's own cleanup() exists) — a leaked
// tab-capture track leaves Chrome's "sharing this tab" indicator up, which
// is both alarming and genuinely still capturing. Idempotent: MediaStream
// tracks may be stopped repeatedly, and every step is its own try/catch so
// one failing can never skip the others.
function stopDisplayCapture(displayCapture) {
  if (!displayCapture) return;
  try {
    displayCapture.stream?.getTracks?.().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
  } catch (err) {
    console.warn('[holocloth] stopping display-capture tracks failed', err);
  }
  const v = displayCapture.video;
  if (v) {
    try { v.pause?.(); } catch { /* not playing */ }
    try { v.srcObject = null; } catch { /* already detached */ }
  }
}

// ── SHARE TAB teardown (Phase 9) ─────────────────────────────────────────
// The ONE teardown for the shared-tab screen source, mirroring
// stopDisplayCapture/teardownLiveScreenNow: it is called from the STOP
// SHARING button, from every path that hands the screen to another source
// (Go Live, Capture, Upload), from `track.onended` (Chrome's own "Stop
// sharing" bar), and from world cleanup on unmount. A leaked capture track
// leaves Chrome's sharing indicator up and is still genuinely capturing —
// which is both alarming and true — so every step is its own try/catch and
// the whole function is idempotent.
//
// Disposes the VideoTexture HERE and nowhere else: elements/factories.js
// treats it as externally owned (userData.screenExternalTexture) and never
// disposes it, precisely so this is the only owner.
function stopDeviceScreenShare(world) {
  const share = world?.deviceShare;
  if (!share) return;
  world.deviceShare = null;
  try {
    share.stream?.getTracks?.().forEach((t) => {
      try { t.onended = null; } catch { /* read-only in some engines */ }
      try { t.stop(); } catch { /* already stopped */ }
    });
  } catch (err) {
    console.warn('[holocloth] stopping shared-tab tracks failed', err);
  }
  const v = share.video;
  if (v) {
    try { v.onresize = null; } catch { /* nothing attached */ }
    try { v.pause?.(); } catch { /* not playing */ }
    try { v.srcObject = null; } catch { /* already detached */ }
  }
  // Put the factory's own textured screen back BEFORE disposing, so a frame
  // can never render a disposed texture.
  const ud = world?.devicePrimaryEntry?.object?.userData;
  if (ud && ud.screenExternalTexture === share.texture) {
    if (ud.screenMaterial && ud.screenMaterial.map === share.texture) {
      ud.screenMaterial.map = ud.screenTexture || null;
      ud.screenMaterial.needsUpdate = true;
    }
    ud.screenExternalTexture = null;
    // Force the next applyInstance to re-resolve the screen source from the
    // instance (capture/upload/placeholder) instead of deduping on the now-
    // dead share key.
    ud.appliedScreenKey = null;
  }
  try { share.texture?.dispose(); } catch { /* already disposed */ }
}

function teardownLiveScreenNow(world) {
  if (!world) return;
  if (world.deviceLive) {
    world.cssScene?.remove(world.deviceLive.object);
    world.deviceLive.holeMat?.dispose();
    world.deviceLive = null;
  }
  // The factory's own material is ALWAYS the correct non-live screen — even
  // right after a rebuild replaced it. It lives on the ROOT's userData
  // (deviceRebuild), not the mesh's — reading it off the mesh here left the
  // invisible hole material on after Stop (screen went permanently black;
  // caught live). Shares its decision (isScreenMaterialStranded,
  // elements/video-export.js — pure/unit-tested) with the render loop's own
  // per-frame backstop (see the LIVE device screen block in the render
  // loop): this IS the fix for every path that calls it; that backstop is
  // the safety net for whatever leaves the mesh wrong WITHOUT this function
  // ever running again to catch it.
  const mesh = world.devicePrimaryEntry?.object?.userData?.screenMesh;
  const factoryMat = world.devicePrimaryEntry?.object?.userData?.screenMaterial;
  if (isScreenMaterialStranded({ deviceLiveActive: false, meshMaterial: mesh?.material, factoryMaterial: factoryMat })) {
    mesh.material = factoryMat;
  }
}

// Procedural paper-grain bump texture — default until the user uploads one.
const makeGrainCanvas = () => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.floor(Math.random() * 60) + Math.floor(Math.random() * 60);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

const downloadBlob = (blob, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};

// ── Holo shader injection — additive view-angle rainbow bands + glints on top
// of MeshPhysicalMaterial, via onBeforeCompile (uniform objects live on the
// world so slider changes update in place, no recompile). ──
const HOLO_FRAG_PARS = `
uniform float uHoloIntensity;
uniform float uHoloScale;
uniform float uBandFreq;
uniform float uSatBoost;
uniform float uHueShift;
uniform float uSparkle;
uniform float uTime;
vec3 hcHue2Rgb(float h) {
  float r = abs(h * 6.0 - 3.0) - 1.0;
  float g = 2.0 - abs(h * 6.0 - 2.0);
  float b = 2.0 - abs(h * 6.0 - 4.0);
  return clamp(vec3(r, g, b), 0.0, 1.0);
}
float hcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;
const HOLO_FRAG_BODY = `
#ifdef USE_UV
if (uHoloIntensity > 0.001 || uSparkle > 0.001) {
  vec3 hcN = normalize(normal);
  vec3 hcV = normalize(vViewPosition);
  float facing = clamp(dot(hcN, hcV), 0.0, 1.0);
  float fres = pow(1.0 - facing, 1.4);
  vec2 huv = vUv * uHoloScale;
  float band  = sin((huv.x + huv.y) * 6.2831 * uBandFreq + facing * 14.0 + uTime * 0.4);
  float band2 = sin(length(vUv - 0.5) * uHoloScale * uBandFreq * 6.2831 - facing * 9.0);
  float hue = fract(uHueShift + facing * 1.15 + 0.22 * band + 0.13 * band2);
  vec3 holoCol = mix(vec3(0.85), hcHue2Rgb(hue), clamp(0.35 + 0.65 * uSatBoost, 0.0, 1.0));
  float holoAmt = uHoloIntensity * (0.22 + 0.78 * fres) * (0.55 + 0.45 * band);
  float glint = 0.0;
  if (uSparkle > 0.001) {
    vec2 cell = floor(huv * 46.0);
    float h = hcHash(cell);
    float tw = pow(0.5 + 0.5 * sin(uTime * (1.5 + h * 4.0) + h * 40.0), 6.0);
    glint = step(1.0 - uSparkle * 0.10, h) * tw * 5.0;
  }
  totalEmissiveRadiance += holoCol * max(holoAmt, 0.0) + holoCol * glint * max(uHoloIntensity, uSparkle * 0.4);
}
#endif
`;

const PIN_MODE_IDS = PIN_MODES.map((m) => m.id);
const MATERIAL_PRESET_IDS = Object.keys(MATERIAL_PRESETS);
// Look randomize's own per-tier jitter-scale multiplier (see randomizeFx's
// doc comment) — 'remix' at scale 1 reproduces this function's pre-intensity
// jitter formulas exactly.
const LOOK_JITTER_SCALE = { refine: 0.35, remix: 1, transform: 1.8, wild: 2.6 };

export default function ClothStudio({ isNarrow = false, railW = 336, isAdmin = false, authedFetch = null }) {
  const stageRef = useRef(null);
  const worldRef = useRef(null);
  const hudCanvasRef = useRef(null);
  const [saved] = useState(loadSavedDefaults);
  const [worldReady, setWorldReady] = useState(false);
  // One-time (per mount) extraction of a legacy `hanging-tshirt` extra
  // element from RAW saved.extraInstances, BEFORE restoreExtraInstances
  // strips/normalizes it — see elements/primary-cloth.js
  // extractLegacyTshirtMigration's own header for exactly what's carried
  // over and why. extraInstances below is seeded from
  // `.remainingExtraInstances` (never the raw saved array) so a legacy shirt
  // can never survive as a second, decorative extraInstances entry.
  const [legacyTshirtMigration] = useState(() => extractLegacyTshirtMigration(saved.extraInstances));

  // ── Control state ──
  const [perf, setPerf] = useState(PERF_LEVELS[saved.perf] ? saved.perf : 'high');
  const [mat, setMat] = useState(() => ({ ...INITIAL_MAT, ...(saved.mat || {}) }));
  const [phys, setPhys] = useState(() => ({ ...DEFAULT_PHYS, ...(saved.phys || {}) }));
  const [anim, setAnim] = useState(() => ({ ...DEFAULT_ANIM, ...(saved.anim || {}) }));
  // Camera freedom — which axes the orbit may rotate on, and whether pan
  // (push-around) is allowed. Off locks that axis at its current angle.
  const [cam, setCam] = useState(() => ({ rotX: true, rotY: true, pan: true, ...(saved.cam || {}) }));
  // Lighting cans — [{on,color,intensity,az,el}×4]; template select tracks the
  // last applied rig ('' once hand-tweaked).
  const [lightCans, setLightCans] = useState(() => (Array.isArray(saved.lightCans) && saved.lightCans.length === 4 ? saved.lightCans : cloneCans('studio')));
  const [lightTemplate, setLightTemplate] = useState(saved.lightTemplate ?? 'studio');
  const setCanKey = useCallback((i, key, val) => {
    setLightCans((prev) => prev.map((c, ix) => (ix === i ? { ...c, [key]: val } : c)));
    setLightTemplate('');
  }, []);
  // Glass form, shot camera, HUD overlay, capture frame.
  const [glass, setGlass] = useState(() => ({
    ...DEFAULT_GLASS,
    position: [...DEFAULT_GLASS.position],
    rotationOffset: [...DEFAULT_GLASS.rotationOffset],
    ...(saved.glass || {}),
  }));
  const setGlassKey = useCallback((key, val) => setGlass((g) => ({ ...g, [key]: val })), []);

  // ── Element system — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md.
  // Phase 1 registered the existing glass shell (`glass-petal-sphere`,
  // `singleInstanceRenderer: true` — driven entirely by the pre-existing
  // `glass` state + its dedicated effects below, untouched). Phase 2 adds
  // five real, multi-instance-capable types (elements/catalog.js +
  // elements/factories.js) that live in `extraInstances` alongside any
  // glass duplicates and ARE genuinely rendered — see the live-object sync
  // effect further down, which builds/updates/disposes a three.js object per
  // enabled real instance via its factory. `isRenderableInstance` (elements/
  // scene-elements.js) is the one predicate that tells the two kinds of
  // extraInstances entry apart everywhere (budget, active count, sync
  // effect, UI) — nothing hardcodes a type list.
  //
  // Feature-gated: off by default for every visitor, so baseline Holo Paper
  // behavior is unchanged unless explicitly enabled. Gate = env flag
  // (production rollout) OR (admin AND the explicit query gate). `?elements=1`
  // alone does nothing for a public visitor — a non-admin can never self-
  // enable unfinished functionality by guessing a query param; only an admin
  // session that ALSO opts in via the query gets the dev/preview surface.
  // isAdmin alone (no query param) stays off too, so an admin's default view
  // is identical to a public visitor's.
  const [elementsQueryFlag] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('elements') === '1'; } catch { return false; }
  });
  const elementsV1Enabled = process.env.NEXT_PUBLIC_STUDIO_ELEMENTS_V1 === '1' || (Boolean(isAdmin) && elementsQueryFlag);

  // Proof Render (Slice 4e) rollout gate — SAME pattern as elementsV1Enabled
  // above: off by default for every visitor (no worker is deployed yet —
  // Slice 4f — so a real user's "Generate Proof" click would queue a job
  // nothing ever claims). Env flag = production rollout; (admin AND the
  // explicit `?proofRender=1` query) = dev/preview surface only. Codex
  // review (Slice 4e correction): this flag did not exist before.
  const [proofRenderQueryFlag] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('proofRender') === '1'; } catch { return false; }
  });
  const proofRenderV1Enabled = process.env.NEXT_PUBLIC_STUDIO_PROOF_RENDER_V1 === '1' || (Boolean(isAdmin) && proofRenderQueryFlag);

  // Final Render (Phase 4, STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
  // HANDOFF.md) — same off-by-default-until-canary-approved discipline as
  // Proof render's own flag above, but INDEPENDENT: Proof can ship/rollout
  // on its own schedule without also exposing Final Render, and vice versa.
  // Env flag = production rollout (stays unset until the Phase 7 canary
  // passes); (admin AND the explicit `?finalRender=1` query) = dev/preview
  // surface only.
  const [finalRenderQueryFlag] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('finalRender') === '1'; } catch { return false; }
  });
  const finalRenderV1Enabled = process.env.NEXT_PUBLIC_STUDIO_FINAL_RENDER_V1 === '1' || (Boolean(isAdmin) && finalRenderQueryFlag);

  // sceneSeed = the Elements scope's own seed (randomizeSelectedElement),
  // round-tripped by elementHistoryRef/snapshotElementState below. lookSeed
  // is the Look scope's independent seed (randomizeFx) — a Codex review
  // (2026-07-23T18:24:04Z) found that BOTH scopes sharing one counter let an
  // undo in one scope roll the shared counter backward past a point the
  // OTHER scope's still-live state had already advanced beyond (Look ->
  // Element -> Undo Look wrongly rewound the counter under the element's
  // seed-3 result, and the next roll would reuse the look's own already-
  // consumed seed 2). Per-scope-independent seeds are what the review itself
  // named as the fix — each scope's history now only ever reads/writes its
  // own counter, so an undo in one scope can never affect the other's.
  const [sceneSeed, setSceneSeed] = useState(() => (Number.isFinite(saved.sceneSeed) ? saved.sceneSeed : 1));
  const [lookSeed, setLookSeed] = useState(() => (Number.isFinite(saved.lookSeed) ? saved.lookSeed : 1));
  // camSeed — the Camera scope's own independent seed (randomizeCamera via
  // the new unified scope control below), same "never share a counter across
  // scopes" precedent sceneSeed/lookSeed already established (see lookSeed's
  // own comment above for the Codex-blocked cross-scope rollback bug this
  // avoids).
  const [camSeed, setCamSeed] = useState(() => (Number.isFinite(saved.camSeed) ? saved.camSeed : 1));
  const [elementLocks, setElementLocks] = useState(() => (saved.elementLocks && typeof saved.elementLocks === 'object' ? saved.elementLocks : {}));
  // Randomization intensity (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md
  // "Seeded randomization system" § Intensity) — one shared creative-range
  // preference for every randomize action (Look, Selected element, All
  // elements), a persisted UI setting like elementFormatId/elementQualityTier
  // rather than undoable state. 'remix' (the default) is BYTE-IDENTICAL to
  // this codebase's pre-intensity randomize behavior on every call site —
  // see elements/intensity.js's header.
  const [randomizeIntensity, setRandomizeIntensity] = useState(() => (isValidIntensity(saved.randomizeIntensity) ? saved.randomizeIntensity : DEFAULT_INTENSITY));
  // Exact-changed-groups reports (plan guardrail: "Show the exact seed and a
  // concise list of changed groups") — transient UI feedback for the LAST
  // randomize action, not part of any undo/redo snapshot or persisted recipe
  // (matches templateStatus's own plain-useState, non-undoable precedent).
  const [lookRandomizeReport, setLookRandomizeReport] = useState([]);
  const [elementRandomizeReport, setElementRandomizeReport] = useState({});
  // New unified scope control's own transient reports (Slice 1) — same
  // non-undoable, non-persisted precedent as the two reports above.
  // camRandomizeReport: which of shotCam/diffusionCamera changed on the last
  // Camera-only (or composed) randomize. lockSkipReport: "Unlocked values
  // only"'s lock-transparency list (elements/scope-randomize.js
  // computeLockSkipReport) — null except right after that one scope runs.
  const [camRandomizeReport, setCamRandomizeReport] = useState([]);
  const [lockSkipReport, setLockSkipReport] = useState(null);
  // Which scope the unified "Randomize" control last actually ran — lets its
  // one Undo/Redo pair route to whichever underlying stack (Elements/Look/
  // Camera/cross-scope) that scope used, without a 4th visible button set.
  const [lastScopeDomains, setLastScopeDomains] = useState(null);
  const [randomizeScope, setRandomizeScope] = useState('entire-set');
  // Which of the three named output formats (elements/placement.js) new
  // elements default-place for, and what the safe-zone/frame warnings check
  // against. Does NOT change the live canvas's actual camera/aspect — see
  // placement.js's header comment for the exact scope of "format" here.
  const [elementFormatId, setElementFormatId] = useState(() => (PLACEMENT_FORMATS[saved.elementFormatId] ? saved.elementFormatId : 'landscape'));
  // The element system's own live-preview quality tier — independent of the
  // cloth's own `perf` (high/medium/low mesh-density) selector above, which
  // this deliberately does not touch or reinterpret. 'ultra' is excluded
  // from the live selector (LIVE_PREVIEW_TIERS) — see quality.js.
  const [elementQualityTier, setElementQualityTier] = useState(() => (LIVE_PREVIEW_TIERS.includes(saved.elementQualityTier) ? saved.elementQualityTier : 'draft'));
  // Every non-primary instance — glass duplicates (data-only) AND real
  // elements (added or duplicated), persisted with the rest of Studio
  // settings (see the debounced save effect below).
  //
  // Restoration is validated (elements/scene-elements.js restoreExtraInstances):
  // malformed entries, unsupported types, an entry claiming the primary's id,
  // and repeat ids are all rejected; the batch is truncated to
  // MAX_EXTRA_INSTANCES. IDs are collision-safe after reload by construction
  // — nextDuplicateId/nextElementId always derive the next id from the
  // currently-live id list, so there's no counter to reseed.
  const [extraInstances, setExtraInstances] = useState(
    () => restoreExtraInstances(legacyTshirtMigration.remainingExtraInstances, { primaryId: PRIMARY_ELEMENT_ID, maxCount: MAX_EXTRA_INSTANCES })
  );
  const [selectedElementId, setSelectedElementId] = useState(PRIMARY_ELEMENT_ID);
  const [elementsOpen, setElementsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [randomizeScopeOpen, setRandomizeScopeOpen] = useState(false);
  // Scene Templates — LOCAL-only (localStorage) persistence of a full scene
  // recipe (the exact same field set as the settings-save effect further
  // down). captureSceneRecipe/applySceneRecipe live near applyFxPreset,
  // below all the fields they read/write; this is just the list + its rail
  // panel's open/closed state, declared alongside the other element-system
  // UI state above for the same reason.
  const [sceneTemplates, setSceneTemplates] = useState(loadSavedTemplates);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [templateStatus, setTemplateStatus] = useState('');

  // Master Saves — one-click versions of the COMPLETE state (Scene Template's
  // recipe PLUS timeline; see captureMasterRecipe near captureSceneRecipe
  // below). Same LOCAL-only persistence precedent.
  const [masterSaves, setMasterSaves] = useState(loadSavedMasterSaves);
  const [masterSavesOpen, setMasterSavesOpen] = useState(false);
  const [masterSaveNameDraft, setMasterSaveNameDraft] = useState('');
  const [masterSaveStatus, setMasterSaveStatus] = useState('');

  // ── Hero Text — docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md
  // Phase 1. Always available (no admin/feature flag, unlike elementsV1Enabled
  // above) — the pure schema/sanitizer/layout module is
  // app/dashboard/studio/text-layers.js; this state + the effects further
  // down build/update/dispose one overlay THREE.Scene plane per layer and
  // composite it into the render loop. Text is deliberately excluded from
  // the element system's undo stacks and seeded randomization (Locked
  // Design Decision #8) — every handler below calls setTextLayers directly,
  // never pushHistory/randomize*.
  const [textLayers, setTextLayers] = useState(() => sanitizeTextLayers(saved.textLayers, []));
  const [selectedTextLayerId, setSelectedTextLayerId] = useState(null);
  const [heroTextOpen, setHeroTextOpen] = useState(false);
  // fontId -> 'loading' | 'ready' | 'error' — read by StudioHeroTextCard as
  // a per-layer load badge and by the mesh-lifecycle effect below to know
  // when to redraw a layer's canvas with the REAL glyphs (Locked Design
  // Decision #5: the fallback font draws immediately either way, so this
  // never blocks the render loop).
  const [fontStatus, setFontStatus] = useState({});

  // ── Timeline (v2 track model — timeline.js) ───────────────────────────────
  // `timeline.keyframes[].recipe` is a full captureSceneRecipe() snapshot
  // each — deliberately NOT itself a field ON captureSceneRecipe (a timeline
  // nesting recipes that could each nest ANOTHER timeline has no sane
  // termination; Scene Templates/cloud recipes never carry a timeline).
  // `sanitizeTimeline` auto-migrates a v1 (hold/transition) localStorage
  // blob into v2's normalized-`t` shape on load — see timeline.js's own
  // migrateV1Timeline for the exact conversion. `timeline` itself
  // IS persisted (SETTINGS_KEY effect below). `scrubU` is the playhead's
  // normalized track position (0..1) — the SOLE source of truth for where
  // the track/playhead visually sit; `timelineMode` mirrors
  // world.timelineClock.mode ('idle'|'playing'|'looping') for the UI only —
  // the authoritative moment-to-moment playback state (current keyframe
  // pair, the live world.timelineOverride) lives entirely on the world
  // object itself, written by stepTimelinePlayback (module scope, above)
  // from inside the render loop; see the poll effect further down for how
  // scrubU/timelineMode stay in sync with a playback session that ends on
  // its own (Play, non-loop) WITHOUT a per-frame setState (10Hz poll).
  const [timeline, setTimeline] = useState(() => sanitizeTimeline(saved.timeline, DEFAULT_TIMELINE));
  const [selectedKeyframeId, setSelectedKeyframeId] = useState(null);
  const [scrubU, setScrubU] = useState(0);
  const [timelineMode, setTimelineMode] = useState('idle');

  // Element/Look/Render preset kinds (Slice 2) — same LOCAL-only persistence
  // precedent as Scene Templates above, elements/preset-kinds.js owns the
  // pure schema/validation. Presets LOAD as a direct, explicit, non-undoable
  // action (matching Scene Template's own loadTemplateById/applySceneRecipe
  // precedent — "loading a template is its own explicit action, not a
  // slider tweak"), never mutating a historical render snapshot (nothing
  // here ever rewrites an ALREADY-saved preset's own recipe except an
  // explicit re-save).
  const [elementPresets, setElementPresets] = useState(loadSavedElementPresets);
  const [elementPresetNameDraft, setElementPresetNameDraft] = useState('');
  const [elementPresetStatus, setElementPresetStatus] = useState('');
  const [lookPresets, setLookPresets] = useState(loadSavedLookPresets);
  const [lookPresetNameDraft, setLookPresetNameDraft] = useState('');
  const [lookPresetStatus, setLookPresetStatus] = useState('');
  const [renderPresets, setRenderPresets] = useState(loadSavedRenderPresets);
  const [renderPresetNameDraft, setRenderPresetNameDraft] = useState('');
  const [renderPresetStatus, setRenderPresetStatus] = useState('');

  // Proof Render (Slice 4e) — a small, deterministic headless render (the
  // real production pipeline: services/studio-render/art-render.mjs, run via
  // the job queue in api/_lib/proof-render-jobs.cjs) that proves this exact
  // recipe renders correctly server-side. Separate from "Export video" above,
  // which just records the live in-browser canvas.
  const [proofStatus, setProofStatus] = useState('idle'); // idle | creating | unsupported | queued | rendering | done | failed
  const [proofError, setProofError] = useState('');
  // 'transient' (network/create-call exception — retrying is safe and may
  // resolve to a job that actually did get created) vs 'terminal' (the JOB
  // ITSELF reported status:'failed' — MAX_ATTEMPTS exhausted server-side;
  // resubmitting the SAME idempotency key only ever re-fetches that SAME
  // permanently-failed job, so offering "Retry" there is misleading). Codex
  // review (Slice 4e correction): this distinction did not exist before —
  // every failure showed the same "Retry same request" button.
  const [proofFailureKind, setProofFailureKind] = useState('');
  const [proofNote, setProofNote] = useState('');
  const [proofUnsupported, setProofUnsupported] = useState([]);
  const [proofOutput, setProofOutput] = useState(null);
  const [proofJobId, setProofJobId] = useState('');
  // Retry-safe idempotency: a fresh "Generate Proof" click always mints a
  // new key; "Retry same request" (shown only for a 'transient' failure)
  // resends THIS ref's current value so a network hiccup can never
  // double-create a job.
  const proofIdempotencyKeyRef = useRef('');
  // Immutable request snapshot — captured ONCE when "Generate Proof" is
  // clicked, never recomputed. Codex review (Slice 4e correction): the
  // retry path previously called captureSceneRecipe() again, so if the user
  // tweaked the scene between a failed attempt and clicking Retry, the
  // resubmitted payload no longer hashed the same as what the idempotency
  // key was created with — the server would reject it with a 409
  // "different request payload" conflict instead of cleanly resolving to
  // the original job. Retry must resend the EXACT bytes of the original
  // request, so it's captured once and reused verbatim.
  const proofRequestSnapshotRef = useRef(null);
  // The UNPINNED raw request for the current Generate click (Codex F2b P1
  // retry correction): set BEFORE the async pin runs, so a pin-phase
  // failure leaves Retry something real to re-run. Snapshot ref above stays
  // null until pinning succeeds — Retry branches on which ref exists:
  // snapshot present → resubmit the pinned immutable snapshot; only the
  // raw request present → re-run the pin. Every Generate click overwrites
  // BOTH, so a retry can never resubmit an older click's request.
  const proofRawRequestRef = useRef(null);
  // Bumped on every fresh submit so a stale in-flight poll loop from an
  // earlier click can detect it's been superseded and stop touching state.
  const proofPollTokenRef = useRef(0);
  // Real cancellation — aborts the in-flight fetch/poll wait itself (not
  // just a soft "ignore the result" flag like proofPollTokenRef above).
  // Codex review (Slice 4e correction): no AbortController existed before,
  // so navigating away from Studio mid-poll left the fetch loop running
  // for up to 6 more minutes with nothing to show the result to.
  const proofAbortControllerRef = useRef(null);

  // Final Render (Phase 4) — the durable, downloadable, deterministic
  // server render. Reuses the EXACT SAME job queue/route/worker as Proof
  // above (renderKind:'final' on the job, an allowlisted preset instead of
  // Proof's fixed small profile) — this is genuinely the same pipeline at
  // full quality, not a parallel system. State/refs mirror Proof's own
  // shape 1:1 on purpose (same retry-safety/cancellation contract).
  const [finalRenderStatus, setFinalRenderStatus] = useState('idle'); // idle | creating | unsupported | queued | rendering | done | failed
  const [finalRenderError, setFinalRenderError] = useState('');
  const [finalRenderFailureKind, setFinalRenderFailureKind] = useState(''); // 'transient' | 'terminal' — see proofFailureKind's own comment for the distinction
  const [finalRenderNote, setFinalRenderNote] = useState('');
  const [finalRenderUnsupported, setFinalRenderUnsupported] = useState([]);
  const [finalRenderOutput, setFinalRenderOutput] = useState(null); // sanitized ffprobe metadata
  const [finalRenderArtifact, setFinalRenderArtifact] = useState(null); // {hasArtifact,expiresAt,expired,mp4Url?,posterUrl?,urlsAvailable?} — api/_lib/proof-render-view.cjs's projection
  const [finalRenderJobId, setFinalRenderJobId] = useState('');
  // '30' | '60' — the only caller-facing choice; width/height always follow
  // the Studio's OWN current clothAspect ("reuse the Studio's selected
  // duration/aspect where supported" — see finalRenderPresetId below), never
  // a second independent aspect picker duplicating clothAspect's own UI.
  const [finalRenderQuality, setFinalRenderQuality] = useState('30');
  const finalRenderIdempotencyKeyRef = useRef('');
  const finalRenderRequestSnapshotRef = useRef(null);
  const finalRenderRawRequestRef = useRef(null); // see proofRawRequestRef — same retry contract

  const finalRenderPollTokenRef = useRef(0);
  const finalRenderAbortControllerRef = useRef(null);
  // P1-C (Production lifecycle hardening round) — guards the localStorage
  // rehydration effect below so it only ever runs its one check, the first
  // time authedFetch becomes available (that prop can re-render with a new
  // function identity once auth resolves; this ref stops a second run).
  const finalRenderRehydratedRef = useRef(false);

  // Curated Set Generators (Slice 2) — which of the 12 named generators is
  // currently selected in the picker, and the last run's status line.
  const [curatedGeneratorId, setCuratedGeneratorId] = useState(CURATED_GENERATORS[0]?.id || '');
  const [curatedSetStatus, setCuratedSetStatus] = useState('');
  const [curatedSetsOpen, setCuratedSetsOpen] = useState(false);

  // Undo/redo lives in a ref (not state) so pushes never themselves trigger a
  // render; historyTick is the render trigger for canUndo/canRedo display.
  // The push/undo/redo mechanics themselves are the pure, unit-tested
  // functions in elements/history.js — this ref just holds the {undo,redo}
  // shape they operate on.
  const elementHistoryRef = useRef(createHistory());
  const [, setHistoryTick] = useState(0);

  // Studio's GLB asset library (Phase 3 — docs/plans/ORIGINAL-STUDIO-
  // CINEMATIC-SETS-4K-PLAN.md "GLB import and asset safety"). This is the
  // ONE shared source of truth: StudioElementInspector's GlbAssetControl
  // reads it for the picker UI, and the live-object-sync effect below
  // builds `ctx.glbAssetsById` from it for factories.js's glb-import
  // factory to resolve an assetId -> readUrl — never two independent
  // copies. Never persisted to localStorage (unlike every other piece of
  // Studio state above) — it's a live mirror of the server-side admin-only
  // library, always re-fetched, never assumed still valid from a prior
  // session.
  const [glbAssets, setGlbAssets] = useState([]);
  const refreshGlbAssets = useCallback(async () => {
    if (!authedFetch) return { assets: [] };
    const res = await authedFetch('/api/dashboard/studio-assets?action=list');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    setGlbAssets(Array.isArray(data.assets) ? data.assets : []);
    return data;
  }, [authedFetch]);

  // Proactive fetch — GlbAssetControl (StudioElementInspector) ALSO
  // refreshes this on its own mount, but that only happens once the user
  // actually opens a glb-import instance's Inspector panel. A saved scene
  // reloads with `extraInstances` (and any glb-import assetId selection)
  // already restored from localStorage BEFORE the user has clicked
  // anything — without this, `glbAssets` stays empty through the live-
  // object-sync effect's first run, that element's initial load attempt
  // finds no URL to resolve and gives up (by design — see glbLoadAsset),
  // and nothing else was ever going to prompt a retry. This closes that
  // gap independently of whether the Inspector is ever opened.
  //
  // Gated on elementsV1Enabled for the SAME reason the live-object-sync
  // effect is (below): the flag has to gate the WHOLE element system, not
  // just rendering — a persisted glb-import instance sitting inert in
  // `extraInstances` with the flag off must never trigger a live network
  // call to the admin-only studio-assets endpoint, regardless of whether
  // anything from it would ever actually render.
  useEffect(() => {
    if (!authedFetch || !elementsV1Enabled) return;
    const hasGlbImportWithAsset = extraInstances.some((i) => i.type === 'glb-import' && i.appearance?.assetId);
    if (hasGlbImportWithAsset && glbAssets.length === 0) {
      refreshGlbAssets().catch(() => {}); // best-effort — an admin-only 401/403 here just means the element stays empty, same honest fallback as everywhere else
    }
    // Deliberately keyed on extraInstances/authedFetch/elementsV1Enabled
    // only, not glbAssets itself — this only ever needs to FIRE the fetch
    // once per "went from nothing selected to something selected" (or
    // "flag just turned on"); refreshGlbAssets' own setGlbAssets call is
    // what actually updates state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraInstances, authedFetch, elementsV1Enabled]);

  // hanging-tshirt's front-logo library — same "one shared source of truth"
  // shape as glbAssets above (LogoArtworkControl reads it for the picker UI,
  // the live-object-sync effect builds ctx.logoAssetsById from it), but
  // browser-local/synchronous (localStorage, loaded once at mount — see
  // loadLogoLib/TSHIRT_LOGO_LIB_KEY) rather than an admin-only server fetch,
  // so there's no separate refresh/proactive-fetch effect to mirror.
  const [logoLibrary, setLogoLibrary] = useState(loadLogoLib);
  // Kept in sync with `logoLibrary` by every writer below, purely so
  // add/deleteLogo can read the CURRENT array synchronously. CORRECTION
  // (Codex review): addLogo previously read/wrote `prev` only inside
  // `setLogoLibrary`'s own functional-updater callback and returned
  // `persisted` right after the (non-awaited) `setLogoLibrary(...)` call —
  // relying on that updater having already run by the time `addLogo`
  // returns is an unstated React implementation detail (an "eager state"
  // optimization), not a guaranteed part of the public setState contract,
  // so `persisted` could report `true` even when the write underneath it
  // hadn't actually happened yet (or would happen differently) by the time
  // the caller read it. Reading/writing this ref instead makes the
  // localStorage attempt — and therefore `persisted` — fully synchronous.
  const logoLibraryRef = useRef(logoLibrary);
  // CORRECTION (Codex review, P2): the localStorage write failure was
  // previously swallowed with no signal to the caller — a quota-exceeded
  // logo stayed usable for the rest of THIS session, LogoArtworkControl
  // told the user it was "added" (implying permanently), and it silently
  // vanished on the next reload with no warning either time. `persisted`
  // now reports the real outcome so the caller can say so honestly.
  const addLogo = useCallback((entry) => {
    const assetId = `logo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const full = { assetId, ...entry };
    const next = [...logoLibraryRef.current, full];
    let persisted = true;
    try { window.localStorage.setItem(TSHIRT_LOGO_LIB_KEY, JSON.stringify(next)); }
    catch { persisted = false; }
    logoLibraryRef.current = next;
    setLogoLibrary(next);
    return { ...full, persisted };
  }, []);
  const deleteLogo = useCallback((assetId) => {
    const next = logoLibraryRef.current.filter((a) => a.assetId !== assetId);
    try { window.localStorage.setItem(TSHIRT_LOGO_LIB_KEY, JSON.stringify(next)); } catch { /* non-critical */ }
    logoLibraryRef.current = next;
    setLogoLibrary(next);
  }, []);

  // Device Mockup uploaded screens (Phase 3) — same ref-synced add/delete
  // shape as the logo library above (see addLogo's own comment for why the
  // ref + synchronous `persisted` outcome, not a functional-updater read).
  const [deviceScreenLibrary, setDeviceScreenLibrary] = useState(loadDeviceScreenLib);
  const deviceScreenLibraryRef = useRef(deviceScreenLibrary);
  const addDeviceScreenImage = useCallback((entry) => {
    const assetId = `devscr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const full = { assetId, ...entry };
    const next = [...deviceScreenLibraryRef.current, full];
    let persisted = true;
    try { window.localStorage.setItem(DEVICE_SCREEN_LIB_KEY, JSON.stringify(next)); }
    catch { persisted = false; }
    deviceScreenLibraryRef.current = next;
    setDeviceScreenLibrary(next);
    return { ...full, persisted };
  }, []);
  const deleteDeviceScreenImage = useCallback((assetId) => {
    const next = deviceScreenLibraryRef.current.filter((a) => a.assetId !== assetId);
    try { window.localStorage.setItem(DEVICE_SCREEN_LIB_KEY, JSON.stringify(next)); } catch { /* non-critical */ }
    deviceScreenLibraryRef.current = next;
    setDeviceScreenLibrary(next);
  }, []);

  const primaryInstance = useMemo(() => normalizeElementInstance({
    id: PRIMARY_ELEMENT_ID,
    enabled: glass.on,
    depth: 'hero',
    transform: { position: glass.position, rotation: glass.rotationOffset, scale: [glass.scale, glass.scale, glass.scale] },
    material: { tint: glass.tint, clarity: glass.clarity, transmission: glass.transmission },
    motion: { rotate: glass.rotate, rotSpeed: glass.rotSpeed },
    random: { locked: Boolean(elementLocks[PRIMARY_ELEMENT_ID]?.locked), groups: { transform: false, material: false, motion: false, appearance: false } },
  }, 'glass-petal-sphere'), [glass, elementLocks]);

  // Extras carry their own normalized snapshot from creation/duplicate-time;
  // only their lock status stays live-bound to the shared `elementLocks` map
  // (so the per-row lock icon behaves identically to the primary's).
  const elementInstances = useMemo(() => [
    primaryInstance,
    ...extraInstances.map((inst) => ({ ...inst, random: { ...inst.random, locked: Boolean(elementLocks[inst.id]?.locked) } })),
  ], [primaryInstance, extraInstances, elementLocks]);

  const selectedInstance = useMemo(
    () => elementInstances.find((i) => i.id === selectedElementId) || null,
    [elementInstances, selectedElementId]
  );

  // Diffusion Camera's Focal Target dropdown — the single source of truth
  // for which targets are CURRENTLY valid (Codex visual-correction round:
  // "Do not show disabled, data-only, removed, or non-rendered instances
  // as valid targets"), shared with the render loop's own fallback
  // (diffusion-focus.js resolveFocalTargetId uses the exact same
  // isFocalTargetValid rule). primaryArtworkAvailable is unconditionally
  // true — Studio always has SOME primary cloth shape (sheet or T-shirt)
  // active; there is no user-facing way to have neither.
  const diffusionFocalTargets = useMemo(() => listDiffusionFocalTargets({
    glassOn: glass.on,
    primaryArtworkAvailable: true,
    elementInstances,
    primaryElementId: PRIMARY_ELEMENT_ID,
  }), [glass.on, elementInstances]);

  // Rendered = the primary, plus any extraInstances entry whose type isn't
  // singleInstanceRenderer (real elements — see the live-object sync effect).
  // A glass duplicate never counts toward either the active/rendered count
  // or the performance budget, regardless of its own `enabled` flag, because
  // it can't render at all.
  const renderedElementInstances = useMemo(
    () => elementInstances.filter((i) => isRenderableInstance(i, PRIMARY_ELEMENT_ID)),
    [elementInstances]
  );
  // Follows the LIVE preview quality tier, not a hardcoded 'draft' — a
  // higher tier has a higher max (quality.js QUALITY_TIERS), so the same
  // scene can read "over budget" at Draft and comfortably under at Social.
  const elementBudget = useMemo(() => budgetStatus(renderedElementInstances, elementQualityTier), [renderedElementInstances, elementQualityTier]);

  // Transmission/shadow surcharge detail (Slice 1 guardrail) — additive-only
  // on top of elementBudget above (see elements/quality.js's own header: this
  // never changes budgetStatus's cost/overBudget numbers). Wired into the
  // Elements card's PERFORMANCE BUDGET row as a "+N transmission" note so the
  // guardrail is a real, visible surface rather than an unconsumed function.
  const elementCostDetail = useMemo(() => {
    const definitions = {};
    renderedElementInstances.forEach((i) => { if (!definitions[i.type]) definitions[i.type] = getElementDefinition(i.type); });
    return estimateSceneCostDetailed(renderedElementInstances, definitions);
  }, [renderedElementInstances]);

  // Per-instance placement check (elements/placement.js placementWarningForInstance)
  // for the CURRENTLY selected format — 'outside-frame', 'overlaps-artwork',
  // 'intentional-overlap' (kinetic-rings/glass — by design, not a mistake),
  // or null. Keyed by id so the Elements card can badge every row and the
  // Inspector can banner the selected one, from one computation. Every
  // instance is checked (including the primary — its position/scale are
  // user-editable too), using its EFFECTIVE (format-override-resolved)
  // transform and its type's declared bounding-sphere radius — not just its
  // center point (see placement.js's bounds-model comment).
  const elementPlacementWarnings = useMemo(() => {
    const map = {};
    elementInstances.forEach((inst) => {
      map[inst.id] = placementWarningForInstance(inst, elementFormatId, getElementDefinition(inst.type));
    });
    return map;
  }, [elementInstances, elementFormatId]);

  // No-duplicate-hero guardrail (Slice 1) — flags every enabled hero-depth
  // extraInstances entry once there are 2+ enabled hero occupants, folding
  // in the primary glass sphere's own hero-depth status via `glass.on`
  // (elements/catalog.js glass-petal-sphere: defaultDepth 'hero'; the
  // primary doesn't live in extraInstances, so heroDuplicateWarnings can't
  // see it by scanning that array alone — see its own doc comment).
  // Advisory only, same non-blocking precedent as elementPlacementWarnings
  // above — surfaced as a badge, never blocks Add/Duplicate/Show.
  const heroWarnings = useMemo(
    () => heroDuplicateWarnings(extraInstances, { primaryIsHero: glass.on }),
    [extraInstances, glass.on]
  );

  const snapshotElementState = useCallback(
    () => ({ glass, elementLocks, sceneSeed, extraInstances }),
    [glass, elementLocks, sceneSeed, extraInstances]
  );

  const pushElementHistory = useCallback(() => {
    elementHistoryRef.current = pushHistory(elementHistoryRef.current, snapshotElementState());
    setHistoryTick((t) => t + 1);
  }, [snapshotElementState]);

  // Mutations that go through applyElementMutation (and are therefore
  // undoable): visibility toggle, lock toggle, randomize, reset, apply
  // preset, add, duplicate, remove. Live slider/color drags in the Inspector
  // go straight to state — matching the existing Glass card's un-undoable
  // slider behavior — so dragging doesn't spam the history stack with one
  // entry per pointermove.
  const applyElementMutation = useCallback((mutate) => {
    pushElementHistory();
    mutate();
  }, [pushElementHistory]);

  // Selection is NOT part of the snapshot — it's normalized after every
  // restore instead (normalizeSelection, elements/scene-elements.js): if the
  // instance that was selected before an undo/redo no longer exists in the
  // restored extraInstances (e.g. undoing past the moment it was created),
  // selection falls back to the primary rather than pointing at nothing.
  const restoreElementSnapshot = useCallback((snap) => {
    setGlass(snap.glass);
    setElementLocks(snap.elementLocks);
    setSceneSeed(snap.sceneSeed);
    const nextExtras = Array.isArray(snap.extraInstances) ? snap.extraInstances : [];
    setExtraInstances(nextExtras);
    setSelectedElementId((cur) => normalizeSelection(cur, nextExtras, PRIMARY_ELEMENT_ID));
  }, []);

  const undoElements = useCallback(() => {
    const { history, snapshot } = undoHistory(elementHistoryRef.current, snapshotElementState());
    if (!snapshot) return;
    elementHistoryRef.current = history;
    restoreElementSnapshot(snapshot);
    setHistoryTick((t) => t + 1);
  }, [snapshotElementState, restoreElementSnapshot]);

  const redoElements = useCallback(() => {
    const { history, snapshot } = redoHistory(elementHistoryRef.current, snapshotElementState());
    if (!snapshot) return;
    elementHistoryRef.current = history;
    restoreElementSnapshot(snapshot);
    setHistoryTick((t) => t + 1);
  }, [snapshotElementState, restoreElementSnapshot]);

  // Primary -> the real glass.on toggle. A real extraInstances element -> its
  // own `enabled` flag (genuinely shows/hides its live three.js object via
  // the sync effect). A glass duplicate -> no-op; the Elements card disables
  // that row's control entirely (nothing to show/hide), so this is defense
  // in depth, not the primary guard.
  const toggleElementVisible = useCallback((id) => {
    if (id === PRIMARY_ELEMENT_ID) {
      applyElementMutation(() => setGlassKey('on', !glass.on));
      return;
    }
    applyElementMutation(() => setExtraInstances((prev) => prev.map((i) => {
      if (i.id !== id || !isRenderableInstance(i, PRIMARY_ELEMENT_ID)) return i;
      return { ...i, enabled: !i.enabled };
    })));
  }, [applyElementMutation, glass.on, setGlassKey]);

  const toggleElementLock = useCallback((id) => {
    applyElementMutation(() => setElementLocks((prev) => ({ ...prev, [id]: { locked: !prev[id]?.locked } })));
  }, [applyElementMutation]);

  // Per-parameter-group lock (plan guardrail: "allow the user to lock any
  // element or parameter group") — the finer-grained sibling of
  // toggleElementLock above. Lives on the instance itself (`random.groups`,
  // already normalized by elements/schema.js and already READ by both
  // randomizeSelectedElement and randomizeAllElements via `inst.random?.groups`
  // — this is the first thing that WRITES it). Only extraInstances carry
  // bucketed material/motion/appearance state; the primary glass element's
  // randomize path (above) rolls scale/rotSpeed/clarity/tint as flat fields,
  // not through a bucket, so a group lock has nothing to gate for it — no-op
  // guarded here rather than left for the Inspector to remember not to call.
  const toggleElementLockGroup = useCallback((id, group) => {
    if (id === PRIMARY_ELEMENT_ID) return;
    applyElementMutation(() => setExtraInstances((prev) => prev.map((i) => (
      i.id === id
        ? { ...i, random: { ...i.random, groups: { ...i.random.groups, [group]: !i.random.groups[group] } } }
        : i
    ))));
  }, [applyElementMutation]);

  // Primary -> the existing glass-specific randomize (material/motion/scale;
  // position/rotation untouched, same as before). A real extraInstances
  // element -> the generic randomizeInstanceFields off its own catalog
  // randomRanges. A glass duplicate is inert data with nothing on screen to
  // vary, so this no-ops for it — `canRandomizeSelected` below keeps the UI
  // control disabled for that case too. Intensity-aware via
  // elements/intensity.js (Refine/Remix/Transform/Wild); 'remix' (the
  // default, unless the user has touched the Intensity picker) is BYTE-
  // IDENTICAL to this function's pre-intensity behavior.
  const randomizeSelectedElement = useCallback(() => {
    const inst = selectedInstance;
    if (!inst || inst.random.locked) return;
    const def = getElementDefinition(inst.type);
    if (!def) return;
    const nextSeed = sceneSeed + 1;
    const intensity = randomizeIntensity;
    if (inst.id === PRIMARY_ELEMENT_ID) {
      const rand = mulberry32(deriveSeed(nextSeed, inst.id, 'randomize'));
      const ranges = def.randomRanges;
      const nextScale = snapToStep(rollNumeric(rand, glass.scale, ranges.scale, intensity), 0.02);
      const nextRotSpeed = snapToStep(rollNumeric(rand, glass.rotSpeed, ranges.rotSpeed, intensity), 0.05);
      const nextClarity = snapToStep(rollNumeric(rand, glass.clarity, ranges.clarity, intensity), 0.01);
      const nextTint = rollCategorical(rand, glass.tint, ranges.tintPalette, intensity);
      // Rolled LAST (after the four pre-existing fields above) so this
      // addition doesn't shift the PRNG stream any earlier roll consumes —
      // scale/rotSpeed/clarity/tint reproduce byte-identical results for
      // the same seed as before this field existed.
      const nextTransmission = snapToStep(rollNumeric(rand, glass.transmission ?? 1, ranges.transmission, intensity), 0.02);
      const changed = [];
      if (nextScale !== glass.scale) changed.push('scale');
      if (nextRotSpeed !== glass.rotSpeed) changed.push('rotate speed');
      if (nextClarity !== glass.clarity) changed.push('clarity');
      if (nextTint !== glass.tint) changed.push('tint');
      if (nextTransmission !== glass.transmission) changed.push('transparency');
      applyElementMutation(() => {
        setSceneSeed(nextSeed);
        setGlass((g) => ({ ...g, scale: nextScale, rotSpeed: nextRotSpeed, clarity: nextClarity, tint: nextTint, transmission: nextTransmission }));
      });
      setElementRandomizeReport({ [inst.id]: changed });
      return;
    }
    if (!isRenderableInstance(inst, PRIMARY_ELEMENT_ID)) return; // glass duplicate — nothing to vary
    const rand = mulberry32(deriveSeed(nextSeed, inst.id, 'randomize'));
    const { instance: randomized, changedGroups } = randomizeInstanceFields(inst, def, rand, {
      intensity, lockedGroups: inst.random?.groups || {},
    });
    applyElementMutation(() => {
      setSceneSeed(nextSeed);
      setExtraInstances((prev) => prev.map((i) => (i.id === inst.id ? randomized : i)));
    });
    setElementRandomizeReport({ [inst.id]: changedGroups });
  }, [selectedInstance, sceneSeed, randomizeIntensity, glass, applyElementMutation]);

  // Whole-element lock lives in the SEPARATE `elementLocks` state, not on the
  // instance itself — `elementInstances` (the display-list memo above)
  // merges it into `random.locked` for the UI/selection path only. Every
  // batch/scope-restricted randomize function below reads `inst.random.locked`
  // straight off whatever array it's given, so each needs that same merge on
  // its INPUT or a whole-element-locked non-primary instance is (incorrectly)
  // randomized anyway — this was a real bug in the original "All" button
  // (found during Slice 1 live verification, fixed here for both it and every
  // new scope). The merge is stripped back out of the RESULT before it's
  // stored via setExtraInstances, so elementLocks stays the one source of
  // truth — never baked into persisted instance data, which would go stale
  // the next time the user locks/unlocks via the Elements card button.
  const lockAwareExtraInstances = useCallback(
    () => mergeElementLocks(extraInstances, elementLocks),
    [extraInstances, elementLocks]
  );
  const stripLockOverride = useCallback(
    (processed) => restoreElementLocks(processed, extraInstances),
    [extraInstances]
  );

  // "Elements only" randomization scope (plan § Randomization scopes) — every
  // renderable, unlocked (whole-element AND per-group) instance in one
  // atomic batch/undo step. The primary glass element is excluded (its
  // randomRanges are flat, not bucketed — see randomizeAllElements's own doc
  // comment in elements/scene-elements.js); "Randomize all" only ever
  // touches real extraInstances entries.
  const canRandomizeAllElements = lockAwareExtraInstances().some(
    (i) => isRenderableInstance(i, PRIMARY_ELEMENT_ID) && !i.random?.locked
  );
  const randomizeAllElementsHandler = useCallback(() => {
    const nextSeed = sceneSeed + 1;
    const { instances: nextExtras, changedById } = randomizeAllElements(lockAwareExtraInstances(), {
      primaryId: PRIMARY_ELEMENT_ID,
      intensity: randomizeIntensity,
      deriveRand: (id) => mulberry32(deriveSeed(nextSeed, id, 'randomize')),
    });
    applyElementMutation(() => {
      setSceneSeed(nextSeed);
      setExtraInstances(stripLockOverride(nextExtras));
    });
    setElementRandomizeReport(changedById);
  }, [sceneSeed, randomizeIntensity, applyElementMutation, lockAwareExtraInstances, stripLockOverride]);

  const resetSelectedElement = useCallback(() => {
    if (selectedElementId === PRIMARY_ELEMENT_ID) {
      applyElementMutation(() => setGlass({
        ...DEFAULT_GLASS,
        position: [...DEFAULT_GLASS.position],
        rotationOffset: [...DEFAULT_GLASS.rotationOffset],
      }));
      return;
    }
    // Data-only/real extraInstances reset alike — back to catalog defaults,
    // keeping only id/name/enabled (a real element resetting shouldn't
    // vanish from the scene if it was visible).
    applyElementMutation(() => setExtraInstances((prev) => prev.map((i) => {
      if (i.id !== selectedElementId) return i;
      return normalizeElementInstance({ id: i.id, name: i.name, enabled: i.enabled }, i.type);
    })));
  }, [selectedElementId, applyElementMutation]);

  // Primary -> the existing flat glass-preset merge (unchanged). A real
  // extraInstances element -> applyPresetToInstance's nested transform/
  // material/motion/appearance merge.
  const applyElementPreset = useCallback((presetId) => {
    const inst = selectedInstance;
    if (!inst) return;
    const def = getElementDefinition(inst.type);
    const preset = def?.presets?.find((p) => p.id === presetId);
    if (!preset) return;
    if (inst.id === PRIMARY_ELEMENT_ID) {
      applyElementMutation(() => setGlass((g) => ({ ...g, ...preset.values })));
      return;
    }
    if (!isRenderableInstance(inst, PRIMARY_ELEMENT_ID)) return;
    const applied = applyPresetToInstance(inst, preset);
    applyElementMutation(() => setExtraInstances((prev) => prev.map((i) => (i.id === inst.id ? applied : i))));
  }, [selectedInstance, applyElementMutation]);

  // Live drag — not pushed to undo history (matches the existing Glass
  // card's un-undoable slider behavior). Only for the primary/bound
  // instance; the glass Inspector branch is the only caller.
  const changeSelectedElementField = useCallback((field, value) => {
    if (selectedElementId !== PRIMARY_ELEMENT_ID) return;
    setGlassKey(field, value);
  }, [selectedElementId, setGlassKey]);

  // Live drag for a REAL extraInstances element's generic (bucket/key)
  // controls — same un-undoable-drag convention as changeSelectedElementField.
  const changeSceneElementField = useCallback((id, bucket, key, value) => {
    setExtraInstances((prev) => prev.map((i) => {
      if (i.id !== id || !isRenderableInstance(i, PRIMARY_ELEMENT_ID)) return i;
      return { ...i, [bucket]: { ...i[bucket], [key]: value } };
    }));
  }, []);

  const canDuplicateSelected = Boolean(selectedInstance) && extraInstances.length < MAX_EXTRA_INSTANCES;
  const canRemoveSelected = selectedElementId !== PRIMARY_ELEMENT_ID;
  const canRandomizeSelected = Boolean(selectedInstance) && !selectedInstance.random.locked
    && isRenderableInstance(selectedInstance, PRIMARY_ELEMENT_ID);

  const duplicateSelectedElement = useCallback(() => {
    if (!canDuplicateSelected || !selectedInstance) return;
    const next = duplicateInstance(
      { extraInstances, selectedElementId },
      { source: selectedInstance, primaryId: PRIMARY_ELEMENT_ID, maxCount: MAX_EXTRA_INSTANCES }
    );
    if (next.extraInstances === extraInstances) return; // pure no-op guard (at cap) — shouldn't hit given canDuplicateSelected above
    applyElementMutation(() => {
      setExtraInstances(next.extraInstances);
      setSelectedElementId(next.selectedElementId);
    });
  }, [canDuplicateSelected, selectedInstance, extraInstances, selectedElementId, applyElementMutation]);

  const removeSelectedElement = useCallback(() => {
    if (!canRemoveSelected) return;
    const next = removeInstance(
      { extraInstances, elementLocks, selectedElementId },
      selectedElementId,
      { primaryId: PRIMARY_ELEMENT_ID }
    );
    applyElementMutation(() => {
      setExtraInstances(next.extraInstances);
      setElementLocks(next.elementLocks);
      setSelectedElementId(next.selectedElementId);
    });
  }, [canRemoveSelected, extraInstances, elementLocks, selectedElementId, applyElementMutation]);

  // "Add Element" — the Phase 2 affordance for a fresh instance of any real
  // (non-singleton) catalog type. Never offered for glass-petal-sphere itself
  // (the primary already exists; adding "another" of a singleInstanceRenderer
  // type could only ever be the same data-only duplicate Duplicate already
  // produces from the primary).
  const addableElementTypes = useMemo(
    () => listElementDefinitions().filter((d) => !d.singleInstanceRenderer),
    []
  );
  const canAddElement = extraInstances.length < MAX_EXTRA_INSTANCES;
  const addSceneElement = useCallback((type) => {
    if (!canAddElement) return;
    const next = createSceneElement({ extraInstances, selectedElementId }, type, { maxCount: MAX_EXTRA_INSTANCES, formatId: elementFormatId });
    if (next.extraInstances === extraInstances) return;
    applyElementMutation(() => {
      setExtraInstances(next.extraInstances);
      setSelectedElementId(next.selectedElementId);
    });
  }, [canAddElement, extraInstances, selectedElementId, elementFormatId, applyElementMutation]);

  // One-shot "upload a PNG → it's a placeable layer at scene center,
  // selected in the Inspector" — the discoverable front door for the
  // image-layer element (the ADD ELEMENT dropdown + Inspector upload path
  // still exists; this just collapses upload+add+assign+select into the
  // single gesture the owner actually reaches for when building a scene).
  const addImageLayerFromFile = useCallback((file) => {
    if (!file || !canAddElement) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setStatus('Image layers take PNG, JPEG, or WebP.'); return; }
    if (file.size > 3 * 1024 * 1024) { setStatus('That image is over the 3MB layer limit.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const added = addDeviceScreenImage({ name: file.name, dataUrl: String(reader.result || ''), sizeBytes: file.size });
      const next = createSceneElement({ extraInstances, selectedElementId }, 'image-layer', { maxCount: MAX_EXTRA_INSTANCES, formatId: elementFormatId });
      if (next.extraInstances === extraInstances) return;
      const newId = next.selectedElementId;
      applyElementMutation(() => {
        setExtraInstances(next.extraInstances.map((i) => (i.id === newId ? { ...i, appearance: { ...i.appearance, uploadAssetId: added.assetId } } : i)));
        setSelectedElementId(newId);
      });
      setStatus(added.persisted
        ? `Image layer added: ${file.name} — placed at center, move it with the Inspector's position sliders.`
        : `Image layer added: ${file.name} — but browser storage is full, so it won't survive a reload.`);
    };
    reader.onerror = () => setStatus('Could not read that file.');
    reader.readAsDataURL(file);
  }, [canAddElement, extraInstances, selectedElementId, elementFormatId, applyElementMutation, addDeviceScreenImage]);

  const [shotCam, setShotCam] = useState(() => ({ ...DEFAULT_SHOTCAM, ...(saved.shotCam || {}) }));
  const setShotKey = useCallback((key, val) => setShotCam((s) => ({ ...s, [key]: val })), []);
  // Diffusion Camera — Slice 1. Lives alongside shotCam (same top-level
  // recipe key treatment, see DEFAULT_DIFFUSION_CAMERA's own comment).
  const [diffusionCamera, setDiffusionCamera] = useState(() => ({ ...DEFAULT_DIFFUSION_CAMERA, ...(saved.diffusionCamera || {}) }));
  const setDiffusionCameraKey = useCallback((key, val) => setDiffusionCamera((d) => ({ ...d, [key]: val })), []);
  // Whether the STORED focalTarget still names a currently-valid target —
  // read directly by the Inspector to show an honest "falling back to
  // Center of scene" note rather than silently pretending the dropdown's
  // shown selection is still doing anything (Codex visual-correction
  // round: "never silently retain a stale distance"). The render loop
  // computes this exact same fallback independently, every frame, via
  // resolveFocalTargetId — this is purely the UI's own read of it.
  const diffusionFocalTargetResolved = useMemo(
    () => isFocalTargetValid(diffusionCamera.focalTarget, {
      glassOn: glass.on, primaryArtworkAvailable: true, elementInstances, primaryElementId: PRIMARY_ELEMENT_ID,
    }),
    [diffusionCamera.focalTarget, glass.on, elementInstances]
  );

  // Camera history — a THIRD independent undo/redo stack (Slice 1), same
  // generic elements/history.js primitive as the Elements/Look stacks above/
  // below. Covers shotCam + diffusionCamera + camSeed — kept fully separate
  // from sceneSeed/lookSeed for the same reason those two are separate from
  // each other (see lookSeed's declaration comment).
  const camHistoryRef = useRef(createHistory());
  const [, setCamHistoryTick] = useState(0);

  const snapshotCameraState = useCallback(
    () => ({ shotCam, diffusionCamera, camSeed }),
    [shotCam, diffusionCamera, camSeed]
  );

  const pushCamHistory = useCallback(() => {
    camHistoryRef.current = pushHistory(camHistoryRef.current, snapshotCameraState());
    setCamHistoryTick((t) => t + 1);
  }, [snapshotCameraState]);

  const applyCamMutation = useCallback((mutate) => {
    pushCamHistory();
    mutate();
  }, [pushCamHistory]);

  const restoreCameraSnapshot = useCallback((snap) => {
    setShotCam(snap.shotCam);
    setDiffusionCamera(snap.diffusionCamera);
    setCamSeed(snap.camSeed);
  }, []);

  const undoCam = useCallback(() => {
    const { history, snapshot } = undoHistory(camHistoryRef.current, snapshotCameraState());
    if (!snapshot) return;
    camHistoryRef.current = history;
    restoreCameraSnapshot(snapshot);
    setCamHistoryTick((t) => t + 1);
  }, [snapshotCameraState, restoreCameraSnapshot]);

  const redoCam = useCallback(() => {
    const { history, snapshot } = redoHistory(camHistoryRef.current, snapshotCameraState());
    if (!snapshot) return;
    camHistoryRef.current = history;
    restoreCameraSnapshot(snapshot);
    setCamHistoryTick((t) => t + 1);
  }, [snapshotCameraState, restoreCameraSnapshot]);

  const [hudOn, setHudOn] = useState(saved.hudOn ?? true);
  const [frameId, setFrameId] = useState(FRAME_PRESETS[saved.frameId] ? saved.frameId : 'off');
  // Environment light (IBL) + post FX.
  const [envId, setEnvId] = useState(ENV_PRESETS[saved.envId] ? saved.envId : 'room');
  const [fx, setFx] = useState(() => ({ ...DEFAULT_FX, ...(saved.fx || {}) }));
  // Which full look is loaded; any hand-tweak drops it back to Custom.
  const [fxPresetId, setFxPresetId] = useState(FX_PRESETS[saved.fxPresetId] ? saved.fxPresetId : '');
  const setFxKey = useCallback((key, val) => {
    setFx((f) => ({ ...f, [key]: val }));
    setFxPresetId('');
  }, []);
  // Which HDRI is mid-fetch, so its button can say so (files are ~1.5MB).
  const [envLoadingId, setEnvLoadingId] = useState(null);
  const applyLightTemplate = useCallback((tplId) => {
    if (!LIGHT_TEMPLATES[tplId]) return;
    setLightCans(cloneCans(tplId));
    setLightTemplate(tplId);
  }, []);
  // PRIMARY CLOTH SHAPE — 'sheet' (the rectangular flyer) or 'tshirt' (the
  // hanging-garment primary — elements/primary-cloth.js). Exactly one is
  // ever built/visible; see the dedicated tshirt lifecycle effect + the
  // shape-gated "Cloth shape / perf rebuild" effect below.
  //
  // A saved.clothShape from a PRIOR (already-migrated or natively-tshirt)
  // session wins outright; otherwise this mount's one-time legacy migration
  // (see legacyTshirtMigration above) decides.
  const [clothShape, setClothShape] = useState(() => (
    (saved.clothShape === 'tshirt' || saved.clothShape === 'sheet' || saved.clothShape === 'device')
      ? saved.clothShape
      : (legacyTshirtMigration.migrated ? 'tshirt' : 'sheet')
  ));
  // Device-primary-only controls (third primary shape, docs/plans/STUDIO-
  // DEVICE-MOCKUP-ELEMENT-PLAN.md Phase 4): the SAME device-mockup factory
  // an extras instance uses, but as the scene's hero — centered at origin,
  // hero-scaled, the Mockup Video framing brought into HOLO PAPER. Screen
  // sources (captureUrl/uploadAssetId) reuse the exact Phase 2/3 machinery.
  const [devicePrimary, setDevicePrimary] = useState(() => ({
    ...DEFAULT_DEVICE_PRIMARY,
    ...(saved.devicePrimary && typeof saved.devicePrimary === 'object' ? saved.devicePrimary : {}),
  }));
  const setDevicePrimaryKey = useCallback((key, val) => setDevicePrimary((d) => ({ ...d, [key]: val })), []);
  // INTERACT mode for the live device screen — ephemeral (never persisted):
  // while on, pointer events go to the live iframe instead of the orbit.
  const [deviceInteract, setDeviceInteract] = useState(false);
  // LIVE SCREEN url draft — typing never touches devicePrimary.liveUrl
  // (which would rebuild/reload the live iframe per keystroke); Go Live /
  // Load commits the draft in one write.
  const [liveUrlDraft, setLiveUrlDraft] = useState(() => (
    (saved.devicePrimary && typeof saved.devicePrimary.liveUrl === 'string') ? saved.devicePrimary.liveUrl : ''
  ));
  // Honest embed-block notice — Go Live fires a free header preflight
  // (checkEmbed) and reports an X-Frame-Options/CSP refusal here, because
  // the browser itself only shows a silent sad-page for blocked frames.
  const [liveEmbedNote, setLiveEmbedNote] = useState('');
  // ── SHARE TAB (Phase 9) — the live site as a REAL texture ──────────────
  // Session-scoped and deliberately NOT persisted: a MediaStream does not
  // survive a reload, so there is nothing honest to save. React state holds
  // only the describable facts (`{ sourceWidth, sourceHeight, surface }`);
  // the stream/<video>/VideoTexture live on `world.deviceShare`, owned by
  // stopDeviceScreenShare (module scope above).
  const [screenShare, setScreenShare] = useState(null);
  const [screenShareStatus, setScreenShareStatus] = useState('');
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  // Stop from any UI/React path. `note` is what the panel should say
  // afterwards — '' when the caller is about to say something better itself.
  const stopScreenShare = useCallback((note) => {
    stopDeviceScreenShare(worldRef.current);
    setScreenShare(null);
    setScreenShareBusy(false);
    if (note !== undefined) setScreenShareStatus(note);
  }, []);

  const commitLiveUrl = useCallback((rawUrl) => {
    const url = String(rawUrl || '').trim();
    if (!url) return;
    // Go Live and SHARE TAB are mutually exclusive — Go Live needs the screen
    // mesh punched transparent for its iframe, which would hide the shared
    // texture underneath it and leave a capture track running invisibly.
    stopScreenShare('Tab sharing stopped — Go Live took over the screen.');
    setDevicePrimary((d) => ({ ...d, live: true, liveUrl: url }));
    setLiveEmbedNote('');
    fetch('/api/public/studio-device-capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, checkEmbed: true }),
    }).then((r) => r.json()).then((d) => {
      if (d?.embeddable === false) {
        setLiveEmbedNote(`This site refuses to be embedded (${d.blockedBy}) — the screen will stay blank. Use Capture for it, or serve the site without that header.`);
      }
    }).catch(() => { /* preflight is advisory only */ });
  }, [stopScreenShare]);

  // SHARE TAB — start. MUST be reached synchronously from the click handler:
  // getDisplayMedia consumes the transient user activation, so a single
  // `await` before it (or a setState-then-effect indirection) makes Chrome
  // refuse the prompt outright. Everything before the call is therefore
  // synchronous, and everything after is promise chaining.
  const startScreenShare = useCallback(() => {
    const world = worldRef.current;
    const md = (typeof navigator !== 'undefined' && navigator.mediaDevices) ? navigator.mediaDevices : null;
    const eligibility = evaluateScreenShareEligibility({
      clothShape, hasDisplayMedia: typeof md?.getDisplayMedia === 'function',
    });
    if (!eligibility.eligible) { setScreenShareStatus(eligibility.reason); return; }
    if (!world?.devicePrimaryEntry?.object) {
      setScreenShareStatus('The device isn’t on stage yet — wait a moment and try again.');
      return;
    }
    // Replace whatever owns the screen right now. Go Live must go first (its
    // iframe would sit on top of the shared texture through the alpha hole),
    // and any earlier share is torn down before a second one starts —
    // through stopScreenShare, so the React readout can't survive the stream
    // it describes if this attempt is then cancelled at the picker.
    stopScreenShare(undefined);
    if (devicePrimary.live) {
      setDevicePrimary((d) => ({ ...d, live: false }));
      setDeviceInteract(false);
      setLiveEmbedNote('');
      teardownLiveScreenNow(world);
    }
    setScreenShareBusy(true);
    setScreenShareStatus('Pick the tab your site is open in — this Studio tab is deliberately not offered.');

    const attach = (stream) => {
      const track = stream.getVideoTracks?.()[0] || null;
      if (!track) {
        stream.getTracks?.().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
        setScreenShareBusy(false);
        setScreenShareStatus('The shared tab produced no video track — the screen is unchanged.');
        return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = stream;
      const ready = new Promise((resolve, reject) => {
        const done = () => (video.videoWidth > 0 && video.videoHeight > 0
          ? resolve()
          : reject(new Error('the shared tab reported no video size')));
        if (video.readyState >= 1) { done(); return; }
        video.onloadedmetadata = done;
        video.onerror = () => reject(new Error('the shared tab could not be decoded'));
      });
      ready
        .then(() => video.play().catch(() => { /* muted autoplay of a MediaStream is allowed; a rejection here is not fatal */ }))
        .then(() => {
          const w2 = worldRef.current;
          if (!w2?.THREE || !w2?.devicePrimaryEntry?.object) throw new Error('the studio scene went away');
          const texture = new w2.THREE.VideoTexture(video);
          texture.colorSpace = w2.THREE.SRGBColorSpace;
          texture.generateMipmaps = false;
          texture.minFilter = w2.THREE.LinearFilter;
          texture.magFilter = w2.THREE.LinearFilter;
          texture.wrapS = w2.THREE.ClampToEdgeWrapping;
          texture.wrapT = w2.THREE.ClampToEdgeWrapping;
          w2.deviceShare = { stream, video, texture };
          // Chrome's own "Stop sharing" bar ends the track without telling
          // React anything — this is the only signal for it.
          track.onended = () => {
            stopScreenShare('Tab sharing ended (you pressed Stop sharing) — the screen went back to whatever it was showing before.');
          };
          // surfaceSwitching:'include' lets the user swap tabs mid-share, and
          // the new tab can be a different size — re-fit rather than keep
          // cropping to the old dimensions.
          video.onresize = () => {
            if (worldRef.current?.deviceShare?.video !== video) return;
            if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) return;
            setScreenShare((s) => (s ? { ...s, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight } : s));
          };
          const surface = describeSharedSurfaceForScreen(track.getSettings?.() || {});
          setScreenShare({
            sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, surface: surface.surface,
          });
          setScreenShareBusy(false);
          setScreenShareStatus(surface.warning
            || `Sharing live at ${video.videoWidth}×${video.videoHeight} — the site is now a texture in the 3D scene, so diffusion, bloom and treatment apply to it.`);
        })
        .catch((err) => {
          try { video.srcObject = null; } catch { /* already detached */ }
          stream.getTracks?.().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
          setScreenShareBusy(false);
          setScreenShareStatus(`Tab sharing failed (${String(err?.message || err)}) — the screen is unchanged.`);
        });
    };

    const fail = (err) => {
      const described = describeScreenShareError(err);
      setScreenShareBusy(false);
      setScreenShareStatus(described.message);
      if (!described.aborted) console.warn('[holocloth] share tab failed', err);
    };

    // The one legal retry: a browser that REJECTS the advanced option
    // dictionary (rather than ignoring the members it doesn't know) gets a
    // plain request — still inside the activation window, because no prompt
    // was ever shown. A user cancel is never retried.
    // try/catch as well as .catch(): a browser that rejects an unknown
    // dictionary member SYNCHRONOUSLY (rather than returning a rejected
    // promise) would otherwise throw straight out of the click handler and
    // leave the panel stuck on "Pick the tab…" with no explanation.
    const request = (options) => {
      try { return md.getDisplayMedia(options); } catch (err) { return Promise.reject(err); }
    };
    request(buildScreenShareRequest())
      .then(attach)
      .catch((err) => {
        if (!shouldRetryScreenShareWithBasicOptions(err)) { fail(err); return; }
        request(buildBasicScreenShareRequest()).then(attach).catch(fail);
      });
  }, [clothShape, devicePrimary.live, stopScreenShare]);

  // Garment-specific-only primary controls (hanger visibility + front-print
  // placement/scale). Everything else the T-shirt renders with (material/
  // physics/animation/artwork) comes from the SAME mat/phys/anim/artwork
  // state the sheet uses — see elements/primary-cloth.js
  // buildPrimaryTshirtInstanceRaw, which maps it onto the SAME
  // getFactory('hanging-tshirt') contract a real extraInstances entry uses.
  const [tshirtPrint, setTshirtPrint] = useState(() => ({
    ...DEFAULT_TSHIRT_PRINT,
    ...(saved.tshirtPrint && typeof saved.tshirtPrint === 'object' ? saved.tshirtPrint : {}),
    ...(legacyTshirtMigration.migrated ? legacyTshirtMigration.tshirtPrint : {}),
  }));
  // 'auto' = sheet matches the loaded artwork's ratio (falls back to portrait
  // until an image provides one); the named presets force a shape.
  const [clothAspect, setClothAspect] = useState((CLOTH_ASPECTS[saved.clothAspect] || saved.clothAspect === 'auto') ? saved.clothAspect : 'auto');
  const [artworkRatio, setArtworkRatio] = useState(saved.artworkRatio || null);
  // Artwork library — which entry is on the sheet + the saved-upload list.
  const [artworkId, setArtworkId] = useState(saved.artworkId || DEFAULT_ARTWORK_ID);
  const [artworkLib, setArtworkLib] = useState(loadArtworkLib);
  // The raw URL/data-URL currently backing the sheet's texture — captured
  // purely so the T-shirt primary mode can feed the SAME image into its
  // front-print shader (one source of truth for primary artwork, task
  // requirement #4). Not persisted — re-derived on every load exactly like
  // the texture itself is (see the opening-artwork loader below).
  const [artworkUrl, setArtworkUrl] = useState(null);
  const [bgMode, setBgMode] = useState(['scene', 'color', 'image', 'transparent'].includes(saved.bgMode) ? saved.bgMode : 'color');
  const [bgColor, setBgColor] = useState(saved.bgColor || '#000000');
  const [sceneId, setSceneId] = useState((SCENE_PRESETS[saved.sceneId] || String(saved.sceneId || '').startsWith('user-')) ? saved.sceneId : 'thriller');
  const [bgImageEl, setBgImageEl] = useState(null);
  // Background presentation controls (Phase 6): fit (cover/contain/stretch),
  // vertical shift within the fit's slack, and whether the backdrop
  // participates in the Diffusion Camera blur at all (`diffusion: false` =
  // crisp background while scene objects still blur — the bg is never lit
  // by scene lights, so diffusion is the one look-effect to opt out of;
  // vignette/grain/treatment still apply as part of the print look).
  const [bgFx, setBgFx] = useState(() => ({ ...DEFAULT_BG_FX, ...(saved.bgFx && typeof saved.bgFx === 'object' ? saved.bgFx : {}) }));
  const setBgFxKey = useCallback((key, val) => setBgFx((b) => ({ ...b, [key]: val })), []);
  // Scene Lab (owner ask, 2026-08-01): per-scene tweak overlay + saved looks.
  // sceneTweaks composes over the ACTIVE set via composeSceneDef; picking a
  // different set clears it. userScenes are full preset-shaped definitions
  // saved from the Lab, selectable from the grid like built-ins.
  const [sceneTweaks, setSceneTweaks] = useState(() => (saved.sceneTweaks && typeof saved.sceneTweaks === 'object' ? saved.sceneTweaks : {}));
  const setSceneTweak = useCallback((key, val) => setSceneTweaks((t) => ({ ...t, [key]: val })), []);
  const [userScenes, setUserScenes] = useState(loadUserScenes);
  const getSceneDef = useCallback(
    (id) => SCENE_PRESETS[id] || userScenes.find((u) => u.id === id)?.def || null,
    [userScenes]
  );
  const effectiveScene = useMemo(
    () => composeSceneDef(getSceneDef(sceneId) || SCENE_PRESETS.thriller, sceneTweaks),
    [sceneId, sceneTweaks, getSceneDef]
  );
  const [userSceneNameDraft, setUserSceneNameDraft] = useState('');
  const saveUserScene = useCallback(() => {
    const name = userSceneNameDraft.trim();
    if (!name) return;
    const def = { ...effectiveScene, label: name };
    const entry = { id: `user-${Date.now().toString(36)}`, name, def };
    setUserScenes((prev) => {
      const next = [...prev, entry];
      try { window.localStorage.setItem(USER_SCENES_KEY, JSON.stringify(next)); } catch { /* non-critical */ }
      return next;
    });
    setSceneId(entry.id);
    setSceneTweaks({});
    setUserSceneNameDraft('');
    setStatus(`Scene look saved: ${name}`);
  }, [userSceneNameDraft, effectiveScene]);
  const deleteUserScene = useCallback((id) => {
    setUserScenes((prev) => {
      const next = prev.filter((u) => u.id !== id);
      try { window.localStorage.setItem(USER_SCENES_KEY, JSON.stringify(next)); } catch { /* non-critical */ }
      return next;
    });
    setSceneId((cur) => (cur === id ? 'thriller' : cur));
  }, []);
  const [envIntensity, setEnvIntensity] = useState(saved.envIntensity ?? 0.65);
  const [videoSeconds, setVideoSeconds] = useState(saved.videoSeconds || 5);
  const [videoFormat, setVideoFormat] = useState(VIDEO_FORMATS[saved.videoFormat] ? saved.videoFormat : 'mp4');
  // Export-restore round — "Skip live-screen prep": when on, Export PNG/
  // Export video/Export Timeline call their export functions directly,
  // bypassing runExportWithLiveGuard entirely (no capture fetch, no
  // teardown-readiness wait). Default off — the guard's own capture/teardown
  // handling is still the better default when it works; this is the escape
  // hatch for whenever it doesn't. See runExportWithLiveGuard's own header.
  const [skipLivePrep, setSkipLivePrep] = useState(Boolean(saved.skipLivePrep));
  // Phase 8 — "Record live screen": records the COMPOSITED TAB
  // (getDisplayMedia) instead of the WebGL canvas, which is the only way the
  // live CSS3D website iframe can appear in an exported video at all
  // (canvas.captureStream() cannot see it — see elements/video-export.js's
  // own Phase 8 header). Off by default and persisted beside skipLivePrep;
  // only OFFERED for a device subject with Go Live actually running, and only
  // USED when evaluateLiveRecordEligibility agrees, so nothing about the
  // normal export path changes for anyone who leaves it alone.
  const [recordLiveScreen, setRecordLiveScreen] = useState(Boolean(saved.recordLiveScreen));
  const [recording, setRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(null); // { elapsed, total } while recording, else null
  const [status, setStatus] = useState('');
  // Export-time website capture, in progress (Phase 7). Non-null for exactly
  // as long as runExportWithLiveGuard's capture-then-await fetch is in
  // flight: { url, startedAt }. It exists because that fetch can legitimately
  // run for 8-110 seconds while the guard set ONE status string and every
  // export button stayed live — from the user's side, indistinguishable from
  // "I clicked Export Video and nothing happened". Drives a ticking status
  // line and a disabled/working state on every export control below.
  const [liveCapturePrep, setLiveCapturePrep] = useState(null);
  const [liveCaptureElapsed, setLiveCaptureElapsed] = useState(0);
  const liveCaptureBusy = Boolean(liveCapturePrep);
  // Phase 8 — may "Record live screen" be OFFERED, and (separately) is the
  // toggle's ON state actually usable right now? Both answers come from the
  // one pure decision (elements/video-export.js) so the UI copy and the
  // export path can never disagree about why it is unavailable.
  const liveRecordEligibility = useMemo(() => evaluateLiveRecordEligibility({
    clothShape, live: devicePrimary.live, liveUrl: devicePrimary.liveUrl,
    hasDisplayMedia: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function',
  }), [clothShape, devicePrimary.live, devicePrimary.liveUrl]);
  const liveRecordActive = recordLiveScreen && liveRecordEligibility.eligible;
  const [artworkName, setArtworkName] = useState('');
  const [bumpName, setBumpName] = useState('');

  // Phase 7 — the capture wait, made visible. One interval while a capture is
  // in flight (cleared the moment it settles, and on unmount), and one status
  // line that re-renders from it, so the wait always reads as work in
  // progress rather than a frozen screen. Deliberately a real elapsed count
  // and not a fake progress bar: the route's own duration is unknowable from
  // here (a cached/viewport capture lands in ~8s, a cold full-page ladder can
  // run to ~110s), and inventing a percentage would be lying about it.
  useEffect(() => {
    if (!liveCapturePrep) { setLiveCaptureElapsed(0); return undefined; }
    setLiveCaptureElapsed(0);
    const id = window.setInterval(() => {
      setLiveCaptureElapsed(Math.max(0, Math.round((performance.now() - liveCapturePrep.startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [liveCapturePrep]);
  useEffect(() => {
    if (!liveCapturePrep) return;
    const patience = liveCaptureElapsed >= 25
      ? ' Slow sites take longer — the export starts by itself the moment the capture lands.'
      : '';
    setStatus(`Capturing ${liveCapturePrep.url} for the device screen… ${liveCaptureElapsed}s of up to ${LIVE_CAPTURE_MAX_SECONDS}s.${patience}`);
  }, [liveCapturePrep, liveCaptureElapsed]);

  // Panel disclosure — Material opens by default (it's the tool's heart).
  const [materialOpen, setMaterialOpen] = useState(true);
  const [animOpen, setAnimOpen] = useState(false);
  const [physicsOpen, setPhysicsOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false); // retired "Images" flag — now drives the Subject card (STUDIO-RAIL-IA-REORG-PLAN.md)
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [glassOpen, setGlassOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);
  // New cards split out of Images/Camera — STUDIO-RAIL-IA-REORG-PLAN.md Phase 2.
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [imageLayersOpen, setImageLayersOpen] = useState(false);
  const [diffusionCameraOpen, setDiffusionCameraOpen] = useState(false);

  const setMatKey = useCallback((key, val) => setMat((m) => ({ ...m, [key]: val, preset: '' })), []);
  const setPhysKey = useCallback((key, val) => setPhys((p) => ({ ...p, [key]: val })), []);

  // Persist current dials as next visit's defaults.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, diffusionCamera, camSeed, hudOn, frameId, envId, fx, fxPresetId, clothShape, tshirtPrint, devicePrimary, clothAspect, artworkRatio, artworkId, bgMode, bgColor, bgFx, sceneId, sceneTweaks, envIntensity, videoSeconds, videoFormat, skipLivePrep, recordLiveScreen, sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity, textLayers, timeline }));
      } catch { /* non-critical */ }
    }, 250);
    return () => clearTimeout(id);
  }, [perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, diffusionCamera, camSeed, hudOn, frameId, envId, fx, fxPresetId, clothShape, tshirtPrint, devicePrimary, clothAspect, artworkRatio, artworkId, bgMode, bgColor, bgFx, sceneId, sceneTweaks, envIntensity, videoSeconds, videoFormat, skipLivePrep, recordLiveScreen, sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity, textLayers, timeline]);

  // Persist Scene Templates — infrequent (button-driven, not slider-drag), so
  // no debounce needed (contrast the settings effect above).
  useEffect(() => {
    try { window.localStorage.setItem(SCENE_TEMPLATES_KEY, serializeTemplateList(sceneTemplates)); } catch { /* non-critical */ }
  }, [sceneTemplates]);

  // Persist Element/Look/Render presets — same infrequent, button-driven
  // precedent as Scene Templates above. serializeTemplateList (templates.js)
  // is kind-agnostic (plain JSON.stringify of the list), reused as-is.
  useEffect(() => {
    try { window.localStorage.setItem(ELEMENT_PRESETS_KEY, serializeTemplateList(elementPresets)); } catch { /* non-critical */ }
  }, [elementPresets]);
  useEffect(() => {
    try { window.localStorage.setItem(LOOK_PRESETS_KEY, serializeTemplateList(lookPresets)); } catch { /* non-critical */ }
  }, [lookPresets]);
  useEffect(() => {
    try { window.localStorage.setItem(RENDER_PRESETS_KEY, serializeTemplateList(renderPresets)); } catch { /* non-critical */ }
  }, [renderPresets]);
  useEffect(() => {
    try { window.localStorage.setItem(MASTER_SAVES_KEY, serializeTemplateList(masterSaves)); } catch { /* non-critical */ }
  }, [masterSaves]);

  // Latest control state, readable from the render loop without re-init.
  const liveRef = useRef({});
  liveRef.current = {
    phys, anim, glass, shotCam, diffusionCamera, hudOn, frameId, lightCans, fx, bgFx, elementInstances, clothShape,
    // Hero Text — textLayers gates the render loop's overlay compositing
    // (both fx and non-fx paths, see runFxFinishChain/the loop below);
    // selectedTextLayerId/heroTextOpen drive the HUD anchor affordance only.
    textLayers, selectedTextLayerId, heroTextOpen,
    // Timeline v2 — stepTimelinePlayback (module scope above) reads this
    // LIVE copy only in 'idle'/scrub mode (no frozen Play/Loop/Export
    // snapshot to evaluate against then); always fresh, same reasoning as
    // every other liveRef field.
    timeline,
  };

  // Timeline (Phase 4) — applySceneRecipe is a useCallback that changes
  // identity whenever any scene-state field it closes over changes (very
  // often), so the render loop (built ONCE at mount, see the world-init
  // effect's own `[]` deps) cannot reference it directly without capturing a
  // permanently-stale mount-time version. This ref is reassigned every
  // render (same discipline as liveRef.current above) so
  // stepTimelinePlayback — called from inside loop() — always invokes the
  // CURRENT applySceneRecipe via applySceneRecipeRef.current(...). Declared
  // here (not next to applySceneRecipe's own definition further down) so it
  // exists before the world-init effect's closure is created.
  const applySceneRecipeRef = useRef(null);

  // ── World init — one scene per mount; controls mutate it in place. ──
  useEffect(() => {
    if (!stageRef.current) return undefined;
    let disposed = false;
    let raf = 0;
    const stage = stageRef.current;

    (async () => {
      const THREE = await import('three');
      // RoundedBoxGeometry: Phase 2's Translucent Monoliths factory only —
      // additive to this destructure, nothing existing changed.
      // GLTFLoader/DRACOLoader/KTX2Loader/MeshoptDecoder: Phase 3 GLB import
      // (elements/glb-loader.js) — same additive pattern.
      const {
        OrbitControls, RoomEnvironment, RGBELoader, mergeVertices,
        EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, RoundedBoxGeometry, CSS3DRenderer, CSS3DObject,
        GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder,
      } = await import('three-stdlib');
      const stdlib = { RoundedBoxGeometry, GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder };
      if (disposed) return;

      const w = stage.clientWidth || 800;
      const h = stage.clientHeight || 600;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 60);
      camera.position.set(0, 0, 2.6);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF_LEVELS[perf].pr));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      // GLB loader bundle — Phase 3 GLB import. DRACOLoader/KTX2Loader spin
      // up Web Workers, so this is built ONCE per world session (not per
      // element, not per load — see glb-loader.js's own comment) and
      // disposed in world.cleanup below.
      const glbLoader = createGLTFLoaderBundle({ THREE, stdlib, renderer });
      // Shadows on from the start — scene sets drop the sheet's shadow on a
      // ground plane; enabling later would force material recompiles.
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setSize(w, h, false);
      // Live device screen (Phase 7) — a CSS3D layer BEHIND the WebGL canvas.
      // The real, interactive website lives in an <iframe> here, positioned
      // in 3D by CSS3DRenderer with the SAME camera; the WebGL screen mesh
      // punches an alpha-0 hole through the canvas (renderer is alpha:true)
      // so the iframe shows through, correctly hidden wherever 3D content
      // draws over it. This is the standard three.js css3d "screen" trick —
      // the browser cannot rasterize live (cross-origin) DOM into a GL
      // texture, so a synced DOM layer is the ONLY honest way to get a live
      // site on the device. pointer-events stay off until INTERACT mode.
      const cssRenderer = new CSS3DRenderer();
      cssRenderer.setSize(w, h);
      Object.assign(cssRenderer.domElement.style, { position: 'absolute', inset: '0', borderRadius: '16px', overflow: 'hidden', pointerEvents: 'none' });
      stage.appendChild(cssRenderer.domElement);
      const cssScene = new THREE.Scene();
      Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', borderRadius: '16px', touchAction: 'none', display: 'block' });
      stage.appendChild(renderer.domElement);

      // IBL — built-in RoomEnvironment by default; the Background card's
      // ENVIRONMENT select swaps in shipped HDRIs (see world.setEnvironment).
      const pmrem = new THREE.PMREMGenerator(renderer);
      const roomEnvTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = roomEnvTex;
      const hdriCache = {};
      const rgbeLoader = new RGBELoader();
      // onDone fires once the environment is actually live (immediately for the
      // built-in room and cached HDRIs, after the ~1.5MB fetch otherwise, and
      // on failure too) so the rail can show an honest pending state.
      const setEnvironment = (id, onDone) => {
        world.lastEnvId = id; // pano scene sets override IBL; leaving one restores this
        const done = () => { if (typeof onDone === 'function') onDone(); };
        const preset = ENV_PRESETS[id];
        if (!preset || !preset.url) { scene.environment = roomEnvTex; done(); return; }
        if (hdriCache[id]) { scene.environment = hdriCache[id]; done(); return; }
        rgbeLoader.load(
          preset.url,
          (hdr) => {
            if (disposed) { hdr.dispose(); return; }
            const envTex = pmrem.fromEquirectangular(hdr).texture;
            hdr.dispose();
            hdriCache[id] = envTex;
            scene.environment = envTex;
            done();
          },
          undefined,
          (err) => {
            console.warn('[holocloth] HDRI load failed', preset.url, err);
            if (disposed) return;
            scene.environment = roomEnvTex;
            done();
          }
        );
      };

      // Lighting cans — four positionable spotlights aimed at the sheet. The
      // Lighting card drives color/intensity/angle/height; can 1 casts the
      // sheet's shadow onto scene-set floors.
      const cans = Array.from({ length: 4 }, (_, i) => {
        const can = new THREE.SpotLight(0xffffff, 0);
        can.visible = false;
        can.angle = 0.7;
        can.penumbra = 0.7;
        can.decay = 1.1;
        if (i === 0) {
          can.castShadow = true;
          can.shadow.mapSize.set(1024, 1024);
          can.shadow.bias = -0.0005;
          can.shadow.normalBias = 0.02;
        }
        scene.add(can);
        can.target.position.set(0, 0, 0);
        scene.add(can.target);
        return can;
      });
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.15;
      ground.receiveShadow = true;
      ground.visible = false;
      scene.add(ground);

      // Glass form — a sphere of overlapping tapered glass crescents ("orange
      // peel" blades): each petal is a partial torus arc whose cross-section
      // stretches across the sphere surface and tapers to sharp tips, giving
      // the sculptural wrapped-shell look; transmission refracts the flyer.
      const makePetalGeo = (R, tube, arc) => {
        let g = new THREE.TorusGeometry(R, tube, 26, 90, arc);
        const gp = g.attributes.position;
        for (let i = 0; i < gp.count; i += 1) {
          const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
          let theta = Math.atan2(y, x);
          if (theta < 0) theta += Math.PI * 2;
          const tt = Math.min(Math.max(theta / arc, 0), 1);
          const taper = Math.pow(Math.sin(tt * Math.PI), 0.65); // sharp tips
          const cx = R * Math.cos(theta), cy = R * Math.sin(theta);
          const ox = (x - cx) * 0.5 * taper;
          const oy = (y - cy) * 0.5 * taper;
          const oz = z * 2.3 * taper; // wide across the sphere → blade shell
          gp.setXYZ(i, cx + ox, cy + oy, oz);
        }
        // Weld the tube's duplicated UV-seam vertices (and the collapsed tips)
        // BEFORE normals — split verts get split normals and read as a hard
        // seam line down the blade otherwise.
        //
        // mergeVertices hashes EVERY attribute, so the seam ring (same position,
        // u=0 vs u=1) never matches and nothing welds. Drop uv + the stale
        // normals first so the merge is position-only. Safe: glassMat is a
        // transmission material with no maps at all, so nothing reads these UVs
        // — do not "restore" them.
        g.deleteAttribute('uv');
        g.deleteAttribute('normal');
        g = mergeVertices(g, 1e-4);
        g.computeVertexNormals();
        return g;
      };
      // FrontSide, not DoubleSide (Codex visual-correction round). Each
      // petal is an OPEN partial-torus arc (arc < 2π — see PETALS below),
      // not a closed shell, so DoubleSide was drawing every petal's INNER
      // surface too — for a transmissive material, that means a camera ray
      // reaching the sphere's interior crossed TWO extra Fresnel/roughness
      // interfaces (the far petal's back face, then again on the way back
      // out) it didn't need to, on top of whichever near-side petals it
      // already crossed. Five overlapping petals, each contributing this
      // doubled surface count, compounds into exactly the "reads as opaque
      // frosted mass" complaint — every one of those extra interfaces adds
      // its own reflectance/roughness-blur, even though three.js's own
      // transmission implementation doesn't physically compose them in
      // depth order. Switched to FrontSide and checked live from several
      // orbit angles (front, side, partial-back, auto-rotating) — no
      // visible holes or missing coverage; the five overlapping petals'
      // OUTER surfaces alone already cover the shell continuously, and the
      // artwork behind it reads noticeably cleaner (less specular-noise
      // layering) with no lost coverage, so this was kept rather than
      // reverted. See TRANSPARENCY (glass.transmission) for the actual
      // opacity fix — this is a secondary, purely additive quality
      // improvement on top of it, not a substitute for it.
      const glassMat = new THREE.MeshPhysicalMaterial({
        transmission: 1, thickness: 0.7, ior: 1.5,
        roughness: 0.03, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.04,
        attenuationColor: new THREE.Color(0xffffff), attenuationDistance: 1.8,
        side: THREE.FrontSide,
      });
      const PETALS = [
        { R: 1.02, tube: 0.20, arc: 4.3, rot: [0, 0, 0] },
        { R: 1.06, tube: 0.18, arc: 3.7, rot: [1.15, 0.42, 0.55] },
        { R: 0.99, tube: 0.21, arc: 4.5, rot: [2.2, 1.3, 0.95] },
        { R: 1.08, tube: 0.17, arc: 3.4, rot: [0.6, 2.35, 1.8] },
        { R: 1.03, tube: 0.19, arc: 4.0, rot: [1.75, 0.9, 2.6] },
      ];
      const petalGeos = [];
      const glassMesh = new THREE.Group(); // effects treat it as one object
      PETALS.forEach(({ R, tube, arc, rot }) => {
        const geo = makePetalGeo(R, tube, arc);
        petalGeos.push(geo);
        const m = new THREE.Mesh(geo, glassMat);
        m.rotation.set(rot[0], rot[1], rot[2]);
        glassMesh.add(m);
      });
      glassMesh.visible = false;
      scene.add(glassMesh);

      // Phase 2 scene elements — one live three.js object per enabled REAL
      // (non-singleInstanceRenderer) extraInstances entry, built/updated/
      // disposed by its catalog factory (elements/factories.js). A single
      // group + id-keyed Map, synced from React by a dedicated effect below
      // (`syncElementObjects`) — additive alongside the glass mesh above,
      // which this never touches.
      const elementsGroup = new THREE.Group();
      scene.add(elementsGroup);
      const elementLiveObjects = new Map(); // id -> { type, object, factory }

      // Shot camera — positionable second camera; USE SHOT CAM renders it.
      const shotCamera = new THREE.PerspectiveCamera(40, w / h, 0.05, 60);
      shotCamera.position.set(0, 0, 3.2);
      const activeCamera = () => (liveRef.current.shotCam?.use ? shotCamera : camera);

      // Post FX chain — bloom + grain/vignette; used only when any FX is on so
      // the clean path stays cheap. Recordings capture whatever path renders.
      // The chain is built at mount even when FX are off (construction is
      // cheap; the render targets are the cost) so toggling an effect never
      // stalls a frame. Its buffer is HALF-FLOAT on purpose: EffectComposer's
      // stock target is 8-bit, and 8-bit *linear* light bands badly in the
      // shadows and clips every highlight before ACES ever sees it.
      const fxPixelRatio = renderer.getPixelRatio();
      const fxTarget = new THREE.WebGLRenderTarget(w * fxPixelRatio, h * fxPixelRatio, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      });
      // One depth texture shared by both composer buffers — the finish pass
      // reads it to leave the backdrop out of the tone map, and sharing means
      // it holds the scene depth whichever buffer the chain rendered into.
      // three resizes it with the target, so the resize/perf/export paths that
      // call composer.setSize() need no extra bookkeeping.
      const fxDepth = new THREE.DepthTexture(w * fxPixelRatio, h * fxPixelRatio);
      fxTarget.depthTexture = fxDepth;
      const composer = new EffectComposer(renderer, fxTarget);
      composer.renderTarget2.depthTexture?.dispose();
      composer.renderTarget2.depthTexture = fxDepth;
      composer.setPixelRatio(fxPixelRatio);
      composer.setSize(w, h);
      // composer.passes stops at bloomPass now (see diffusionPass/treatmentPass
      // below) — without this, EffectComposer would treat bloomPass as the
      // chain's last pass and route it straight to the screen.
      composer.renderToScreen = false;
      const renderPass = new RenderPass(scene, camera);
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.8);
      // Bloom composites its glow ADDITIVELY onto the read buffer — and
      // additive blending adds ALPHA too, which re-filled the live-screen
      // punch-through hole (alpha 0 → ~0.8, a dark veil over the iframe;
      // measured live). Custom blending keeps the identical additive rgb
      // while leaving destination alpha untouched. Visually a no-op for
      // every opaque pixel (alpha already 1); load-bearing only where the
      // hole (or a transparent background) needs alpha preserved.
      bloomPass.materialCopy.blending = THREE.CustomBlending;
      bloomPass.materialCopy.blendEquation = THREE.AddEquation;
      bloomPass.materialCopy.blendSrc = THREE.OneFactor;
      bloomPass.materialCopy.blendDst = THREE.OneFactor;
      bloomPass.materialCopy.blendSrcAlpha = THREE.ZeroFactor;
      bloomPass.materialCopy.blendDstAlpha = THREE.OneFactor;
      // Two-pass finish, in order: diffusionPass (vignette + Diffusion Camera,
      // stays LINEAR) then treatmentPass (tonemap/encode + graphic treatment
      // + grain — the pass that actually renders to screen, so it's the one
      // that owns the tonemap/encode step; see the shader definitions above
      // for why that step can't live in diffusionPass).
      //
      // Both passes are driven MANUALLY (runFxFinishChain below), outside
      // EffectComposer's own pass array, into a dedicated diffuseTarget — NOT
      // one of composer's own ping-pong buffers. Reason: composer.renderTarget1
      // and renderTarget2 both share fxDepth as their OWN depth attachment (the
      // trick above, so depth survives whichever buffer a frame lands in) —
      // diffusionPass READS fxDepth for its Diffusion Camera CoC calc, so
      // writing its output into either ping-pong buffer would make fxDepth
      // simultaneously the draw target's depth attachment AND an input
      // sampler: a real WebGL rendering-feedback-loop (confirmed live —
      // diffusionPass drew GL_INVALID_OPERATION on every frame once it became
      // a middle pass; the draw silently no-ops per spec, leaving the canvas
      // cleared/black). A plain, depth-attachment-free target sidesteps this
      // entirely: diffusionPass reads fxDepth while writing color into a
      // texture fxDepth is never attached to.
      const diffuseTarget = new THREE.WebGLRenderTarget(w * fxPixelRatio, h * fxPixelRatio, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
      });
      const diffusionPass = new ShaderPass(DIFFUSION_SHADER);
      diffusionPass.renderToScreen = false;
      diffusionPass.uniforms.tDepth.value = fxDepth;
      diffusionPass.uniforms.uFrameCenter.value = new THREE.Vector2(0.5, 0.5);
      diffusionPass.uniforms.uFrameHalf.value = new THREE.Vector2(0.5, 0.5);
      diffusionPass.uniforms.uRes.value = new THREE.Vector2(w, h);
      const treatmentPass = new ShaderPass(TREATMENT_SHADER);
      treatmentPass.renderToScreen = true;
      treatmentPass.uniforms.tDepth.value = fxDepth;
      treatmentPass.uniforms.uFrameCenter.value = new THREE.Vector2(0.5, 0.5);
      treatmentPass.uniforms.uRes.value = new THREE.Vector2(w, h);
      treatmentPass.uniforms.uColA.value = new THREE.Color(DEFAULT_FX.colA);
      treatmentPass.uniforms.uColB.value = new THREE.Color(DEFAULT_FX.colB);

      // Hero Text overlay (docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-
      // HANDOFF.md, Locked Design Decisions #1/#2/#4) — a SEPARATE
      // THREE.Scene/camera, never mixed into the main `scene`, so text is
      // never DoF-blurred by the Diffusion Camera and never receives scene
      // lighting. textOverlayCam is a real PerspectiveCamera (not
      // orthographic) so per-layer X/Y rotation produces genuine
      // perspective (#4) — setOverlayCamSize positions it so 1 world unit
      // == 1 CSS px at z=0, matching text-layers.js's layoutTextPlane
      // contract (see that module's own header for the two coordinate
      // systems this bridges). Called once here at mount size and again
      // wherever the main cameras' aspect is resynced to the live stage
      // (applyLiveSize below) — never during export, since exportPng/
      // exportVideo boost only the renderer's pixel ratio/backing
      // resolution, not the CSS stage size this camera is sized in.
      const textOverlayScene = new THREE.Scene();
      const textOverlayCam = new THREE.PerspectiveCamera(40, w / h, 1, 5000);
      const setOverlayCamSize = (ow, oh) => {
        if (!ow || !oh) return;
        textOverlayCam.aspect = ow / oh;
        textOverlayCam.position.z = (oh / 2) / Math.tan(THREE.MathUtils.degToRad(20));
        textOverlayCam.updateProjectionMatrix();
      };
      setOverlayCamSize(w, h);

      // Runs composer (renderPass + bloomPass, into composer.readBuffer) then
      // the diffusion → treatment finish, reading/writing diffuseTarget —
      // call this everywhere the old single `composer.render()` used to be
      // the whole chain (the live loop, exportPng's boosted still).
      const runFxFinishChain = () => {
        composer.render();
        diffusionPass.render(renderer, diffuseTarget, composer.readBuffer);
        // Hero Text overlay, composited AFTER diffusion, BEFORE treatment
        // (Locked Design Decision #2): text is never DoF-blurred (authored
        // graphic, not scene geometry) and its colors stay as-authored
        // going into the treatment pass, which then runs over scene+text
        // together — the "graphic treatment applies to the text too"
        // requirement. diffusionPass.render() above already left the
        // renderer targeting diffuseTarget (three-stdlib's ShaderPass sets
        // that internally whenever renderToScreen is false) — set it
        // explicitly anyway rather than relying on that as an implementation
        // detail. autoClear is forced off so this draws ON TOP of the
        // diffusion output without wiping it; diffuseTarget has no depth
        // attachment (depthBuffer:false, see its construction above) and
        // every text material below disables depthTest/depthWrite, so draw
        // order across layers is simply the textMeshes Map's insertion
        // order — there is nothing for a depth clear to do here.
        if (liveRef.current.textLayers?.some((l) => l.on)) {
          renderer.setRenderTarget(diffuseTarget);
          const prevAutoClear = renderer.autoClear;
          renderer.autoClear = false;
          renderer.render(textOverlayScene, textOverlayCam);
          renderer.autoClear = prevAutoClear;
        }
        treatmentPass.render(renderer, null, diffuseTarget);
      };
      // Shape the vignette to whatever crop is active. Called from the loop at
      // canvas size and from exportPng at export size — same aspect, so the
      // still and the live view agree. Both passes need the frame center
      // (diffusionPass for the vignette falloff, treatmentPass for chroma/
      // mirror's center-relative math); only diffusionPass needs the half-
      // extent (vignette shaping only).
      const syncFrameUniforms = (widthPx, heightPx) => {
        const fr = FRAME_PRESETS[liveRef.current.frameId];
        if (!fr || !fr.w || !widthPx || !heightPx) {
          diffusionPass.uniforms.uFrameCenter.value.set(0.5, 0.5);
          diffusionPass.uniforms.uFrameHalf.value.set(0.5, 0.5);
          treatmentPass.uniforms.uFrameCenter.value.set(0.5, 0.5);
          return;
        }
        const r = computeFrameRect(widthPx, heightPx, fr.w / fr.h);
        const cx = (r.x + r.w / 2) / widthPx;
        const cy = 1 - (r.y + r.h / 2) / heightPx;
        diffusionPass.uniforms.uFrameCenter.value.set(cx, cy);
        diffusionPass.uniforms.uFrameHalf.value.set((r.w / 2) / widthPx, (r.h / 2) / heightPx);
        treatmentPass.uniforms.uFrameCenter.value.set(cx, cy);
      };
      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      // Timeline (Phase 4) override first, same `??` pattern as every other
      // per-frame read of world.timelineOverride (the loop's own shotCam/fx/
      // diffusionCamera reads just below) — `world` is a forward reference
      // to the const declared later in this same closure (safe: fxActive's
      // BODY only ever runs from loop()/world.fxActive?.(), both well after
      // `world` is assigned). Without this, a transition whose ONLY live
      // change is fx ramping from 0 (source keyframe has every fx field off)
      // never activated the composer path — this function used to read only
      // the plain React-state fx/diffusionCamera, which stayed at the
      // FROM-keyframe's off values for the transition's entire duration.
      const fxActive = () => {
        const f = world.timelineOverride?.fx ?? liveRef.current.fx;
        const dc = world.timelineOverride?.diffusionCamera ?? liveRef.current.diffusionCamera;
        return Boolean(f && (f.bloom || f.grain > 0.001 || f.vignette > 0.001 || (f.treatment && f.treatment !== 'none'))) || Boolean(dc?.enabled);
      };

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.6;
      controls.maxDistance = 8;
      controls.target.set(0, 0, 0);

      // Holo uniforms — shared object; slider effects mutate .value in place.
      const holoUniforms = {
        uHoloIntensity: { value: 0 }, uHoloScale: { value: 8 }, uBandFreq: { value: 0.35 },
        uSatBoost: { value: 0.6 }, uHueShift: { value: 0 }, uSparkle: { value: 0 },
        uTime: { value: 0 },
      };

      const bumpTex = new THREE.CanvasTexture(makeGrainCanvas());
      bumpTex.wrapS = THREE.RepeatWrapping; bumpTex.wrapT = THREE.RepeatWrapping;

      // Front/back material pair: the back face carries a horizontally
      // MIRRORED copy of every map so artwork reads correctly from behind
      // (a plain DoubleSide material shows backwards text on the back).
      const backBumpTex = bumpTex.clone();
      backBumpTex.needsUpdate = true;
      const mkClothMaterial = (side, bump) => {
        const m = new THREE.MeshPhysicalMaterial({
          color: 0x101114, side,
          roughness: 0.12, metalness: 0.35,
          clearcoat: 0.5, clearcoatRoughness: 0.08,
          sheen: 0.08, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff),
          iridescence: 0.35, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 480],
          bumpMap: bump, bumpScale: 0.01,
        });
        m.defines = { ...(m.defines || {}), USE_UV: '' };
        m.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, holoUniforms);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + HOLO_FRAG_PARS)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + HOLO_FRAG_BODY);
        };
        return m;
      };
      const clothMat = mkClothMaterial(THREE.FrontSide, bumpTex);
      const clothBackMat = mkClothMaterial(THREE.BackSide, backBumpTex);
      // Mirror any texture horizontally for the back face.
      const mirrorTex = (tex) => {
        const t = tex.clone();
        t.wrapS = THREE.RepeatWrapping;
        t.repeat.x = -1;
        t.needsUpdate = true;
        return t;
      };

      const world = {
        THREE, stdlib, scene, camera, renderer, controls, pmrem, rgbeLoader, clothMat, clothBackMat, mirrorTex, holoUniforms, bumpTex,
        cans, ground, glassMesh, glassMat, shotCamera, activeCamera,
        elementsGroup, elementLiveObjects, glbLoader,
        composer, renderPass, bloomPass, diffusionPass, treatmentPass, diffuseTarget, runFxFinishChain, fxActive, setEnvironment, syncFrameUniforms,
        cssRenderer, cssScene, CSS3DObject, deviceLive: null,
        // SHARE TAB (Phase 9) — { stream, video, texture } while the user is
        // sharing a tab onto the device screen, else null. Owned by
        // stopDeviceScreenShare (module scope); never persisted.
        deviceShare: null,
        // Hero Text overlay — textMeshes is id -> {mesh,geometry,material,
        // texture,spec,layer,canvas,ctx,font,baseCenterY,frameRectH,
        // usesRedrawChannel,redraw}, reconciled by the mesh-lifecycle
        // effect below; relayoutTextMeshes is assigned by that same effect
        // and called from applyLiveSize on resize (repositions without
        // redrawing any canvas texture).
        textOverlayScene, textOverlayCam, setOverlayCamSize, textMeshes: new Map(), relayoutTextMeshes: null,
        // Hero Text Phase 3 (in/out animation) — see applyTextAnimFrame's
        // own header above for the full contract. 'idle' == Phase 1's
        // always-static behavior; the Preview button and exportVideo's
        // startRecording are the only two writers of 'preview'/'export'.
        // textPreviewTimeout is the Preview button's own "return to idle"
        // handle (cleared/reassigned by that callback, and cleared here on
        // unmount below).
        textAnimClock: { mode: 'idle', tStart: 0, tEnd: null },
        textPreviewTimeout: null,
        _textAnimWasActive: false,
        _textAnimRedrawToggle: false,
        // Timeline v2 — { mode: 'idle'|'playing'|'looping', startedAt,
        // startU, timeline (Play/Loop/Export's own frozen snapshot; unused
        // in 'idle'), lastU (mirrored to React scrubU by a 10Hz poll —
        // see ClothStudio's own effect), lastFromIndex/lastTextLayersKey
        // (discrete-cut + text-retrigger bookkeeping — see
        // stepTimelinePlayback, module scope above). `scrubRequest` is a
        // one-shot normalized-u value the next render-loop frame consumes
        // and clears — written by scrubTimelineTo, read only while
        // mode==='idle'.
        timelineClock: { mode: 'idle', startedAt: 0, startU: 0, lastU: 0, lastFromIndex: null, lastTextLayersKey: null },
        scrubRequest: null,
        // Capture-frame carousel: the HUD lays the frames out in a row and
        // eases `from` → `to` so switching crops slides instead of snapping.
        frameSlide: { from: FRAME_IDS.indexOf(liveRef.current.frameId || 'off'), to: FRAME_IDS.indexOf(liveRef.current.frameId || 'off'), t: 1 },
        cloth: null, envIntensity: 1, bgTexture: null,
        pointer: { active: false, x: 0, y: 0 },
        raycaster: new THREE.Raycaster(),
        clock: new THREE.Clock(),
        recorder: null,
        // exportCancelRequested/exportStopTimeout let a separate Cancel
        // action reach into an in-progress recording that exportVideo's own
        // closure otherwise owns exclusively.
        exportCancelRequested: false,
        exportStopTimeout: null,
      };
      worldRef.current = world;
      // Dev-only escape hatch for live debugging (never in production builds).
      if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') window.__clothWorld = world;

      // Diffusion Camera focal-target world-position resolver (Codex
      // visual-correction round) — the imperative half of diffusion-
      // focus.js's pure resolution logic; this needs the live scene graph
      // (glassMesh, the primary cloth/T-shirt, elementLiveObjects), which
      // the pure module deliberately has no access to. One scratch Vector3
      // reused every frame to avoid per-frame GC churn. `targetId` is
      // assumed ALREADY validated (resolveFocalTargetId) — this only
      // resolves a position for a target already known to be real; it
      // still defensively returns null (never throws) if the expected live
      // object happens to be momentarily absent (e.g. mid cloth-shape
      // switch), letting the render loop fall back to world origin.
      const focusScratchVec = new THREE.Vector3();
      // Live-screen CSS3D sync scratch (loop, Phase 7) — decompose targets.
      const liveScreenPos = new THREE.Vector3();
      const liveScreenQuat = new THREE.Quaternion();
      const liveScreenScl = new THREE.Vector3();
      world.resolveDiffusionFocusWorldPosition = (targetId) => {
        if (targetId === DIFFUSION_FOCAL_ORIGIN) return focusScratchVec.set(0, 0, 0);
        if (targetId === DIFFUSION_FOCAL_PRIMARY_ARTWORK) {
          const obj = world.tshirtPrimaryEntry?.object || world.devicePrimaryEntry?.object || world.cloth?.mesh;
          if (!obj) return null;
          return obj.getWorldPosition(focusScratchVec);
        }
        if (targetId === PRIMARY_ELEMENT_ID) {
          if (!world.glassMesh?.visible) return null;
          return world.glassMesh.getWorldPosition(focusScratchVec);
        }
        const entry = world.elementLiveObjects.get(targetId);
        if (!entry) return null;
        return entry.object.getWorldPosition(focusScratchVec);
      };

      // Sheet-only disposal — extracted so the primary-shape switch can free
      // the sheet WITHOUT immediately rebuilding it (the tshirt shape has no
      // use for a PlaneGeometry). buildCloth below calls this too, so a
      // rebuild-in-place (aspect/perf/artwork-ratio change while shape stays
      // 'sheet') is unaffected — it disposes, then immediately reassigns
      // world.cloth a few lines down, same as before this split.
      world.disposeSheet = () => {
        if (world.cloth) {
          scene.remove(world.cloth.mesh);
          scene.remove(world.cloth.meshBack);
          world.cloth.geometry.dispose();
          world.cloth = null;
        }
      };

      // ── Cloth build/rebuild — verlet particle grid on a PlaneGeometry whose
      // position attribute IS the sim's current-position buffer. ──
      world.buildCloth = (aspectId, perfId, ratio = null) => {
        // 'auto': match the artwork's w/h at roughly constant sheet area, so
        // any upload keeps its true proportions without dwarfing the frame.
        let cw; let ch;
        if (aspectId === 'auto' && ratio) {
          const r = Math.min(2.6, Math.max(0.38, ratio));
          ch = Math.sqrt(1.92 / r);
          cw = ch * r;
        } else {
          ({ w: cw, h: ch } = CLOTH_ASPECTS[aspectId] || CLOTH_ASPECTS.portrait);
        }
        const base = PERF_LEVELS[perfId]?.segs || 56;
        const longest = Math.max(cw, ch);
        const segX = Math.max(12, Math.round(base * cw / longest));
        const segY = Math.max(12, Math.round(base * ch / longest));

        world.disposeSheet();

        const geometry = new THREE.PlaneGeometry(cw, ch, segX, segY);
        const pos = geometry.attributes.position;
        const count = pos.count;
        const prev = new Float32Array(count * 3);
        const orig = new Float32Array(count * 3);
        prev.set(pos.array); orig.set(pos.array);

        const cols = segX + 1, rows = segY + 1;
        const idx = (x, y) => y * cols + x;
        const restX = cw / segX, restY = ch / segY;
        const restD = Math.hypot(restX, restY);
        const constraints = [];
        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < cols; x += 1) {
            if (x < cols - 1) constraints.push([idx(x, y), idx(x + 1, y), restX]);          // structural →
            if (y < rows - 1) constraints.push([idx(x, y), idx(x, y + 1), restY]);          // structural ↓
            if (x < cols - 1 && y < rows - 1) {
              constraints.push([idx(x, y), idx(x + 1, y + 1), restD]);                      // shear ↘
              constraints.push([idx(x + 1, y), idx(x, y + 1), restD]);                      // shear ↙
            }
            if (x < cols - 2) constraints.push([idx(x, y), idx(x + 2, y), restX * 2]);      // bend →
            if (y < rows - 2) constraints.push([idx(x, y), idx(x, y + 2), restY * 2]);      // bend ↓
          }
        }

        const mesh = new THREE.Mesh(geometry, clothMat);
        mesh.castShadow = true; // scene sets catch this on the ground plane
        scene.add(mesh);
        // Back face — same sim geometry, mirrored-map material, so artwork
        // reads correctly from behind.
        const meshBack = new THREE.Mesh(geometry, clothBackMat);
        scene.add(meshBack);
        world.cloth = { geometry, mesh, meshBack, prev, orig, constraints, cols, rows, count, cw, ch };
        world.applyPins(liveRef.current.phys.pinMode);
        world.applyRumple(liveRef.current.phys.rumple ?? 0.5);
      };

      // Pin set — indices held to their original grid position each solve pass.
      // PlaneGeometry rows run top (y=0) → bottom, so row 0 is the top edge.
      world.applyPins = (pinMode) => {
        const c = world.cloth; if (!c) return;
        const pins = new Set();
        const top = (x) => x;                                  // row 0
        const bottom = (x) => (c.rows - 1) * c.cols + x;       // last row
        if (pinMode === 'free-float') { /* no pins — the anchor spring holds it */ }
        else if (pinMode === 'top-edge') { for (let x = 0; x < c.cols; x += 1) pins.add(top(x)); }
        else if (pinMode === 'top-corners') { pins.add(top(0)); pins.add(top(c.cols - 1)); }
        else { pins.add(top(0)); pins.add(top(c.cols - 1)); pins.add(bottom(0)); pins.add(bottom(c.cols - 1)); }
        c.pins = pins;
      };

      // Opening crumple — a fixed multi-octave fold field over the rest pose,
      // scaled by the RUMPLE slider. Deterministic (same folds every time) and
      // seeded with zero velocity, so the sheet OPENS looking handled; the sim
      // then settles the folds organically.
      world.applyRumple = (amount) => {
        const c = world.cloth; if (!c) return;
        const arr = c.geometry.attributes.position.array;
        const a = (amount ?? 0) * 0.22;
        for (let i = 0; i < c.count; i += 1) {
          const i3 = i * 3;
          if (c.pins?.has(i)) {
            arr[i3] = c.orig[i3]; arr[i3 + 1] = c.orig[i3 + 1]; arr[i3 + 2] = c.orig[i3 + 2];
          } else {
            const ox = c.orig[i3], oy = c.orig[i3 + 1];
            arr[i3] = ox + a * 0.35 * Math.sin(oy * 4.1 + 2.2);
            arr[i3 + 1] = oy + a * 0.3 * Math.cos(ox * 3.7 + 1.1);
            arr[i3 + 2] = c.orig[i3 + 2] + a * (
              0.55 * Math.sin(ox * 3.1 + 1.7) * Math.cos(oy * 2.3 + 0.6)
              + 0.3 * Math.sin(ox * 6.7 + 4.2) * Math.cos(oy * 5.1 + 2.8)
              + 0.2 * Math.sin(ox * 11.3 + 0.9) * Math.cos(oy * 9.7 + 5.5)
            );
          }
          c.prev[i3] = arr[i3]; c.prev[i3 + 1] = arr[i3 + 1]; c.prev[i3 + 2] = arr[i3 + 2];
        }
        c.geometry.attributes.position.needsUpdate = true;
        c.geometry.computeVertexNormals();
      };

      world.resetCloth = () => {
        // Shape-aware — when the T-shirt is the active primary, this resets
        // ITS sim (elements/tshirt-mesh.js resetSim) back to rest pose
        // instead of silently touching the disposed/hidden sheet.
        if (liveRef.current.clothShape === 'tshirt') {
          // Resets the garment's own sim state (elements/tshirt-mesh.js
          // resetSim) back to rest pose without rebuilding the Studio world.
          const sim = world.tshirtPrimaryEntry?.object?.userData?.sim;
          if (sim) resetSim(sim);
          return;
        }
        const c = world.cloth; if (!c) return;
        c.geometry.attributes.position.array.set(c.orig);
        c.prev.set(c.orig);
        c.geometry.attributes.position.needsUpdate = true;
        // Reset lands on the default "handled" look, not a sterile flat sheet.
        world.applyRumple(liveRef.current.phys.rumple ?? 0.5);
      };

      // Poke — radial velocity impulse pushed away from the camera, centered on
      // a random point of the sheet (verlet: velocity = pos - prev, so we move prev).
      world.poke = (cx = null, cy = null, strength = 0.045) => {
        const c = world.cloth; if (!c) return;
        const arr = c.geometry.attributes.position.array;
        const px = cx ?? (Math.random() - 0.5) * c.cw * 0.7;
        const py = cy ?? (Math.random() - 0.5) * c.ch * 0.7;
        const r = Math.max(c.cw, c.ch) * 0.22;
        for (let i = 0; i < c.count; i += 1) {
          const dx = arr[i * 3] - px, dy = arr[i * 3 + 1] - py;
          const d = Math.hypot(dx, dy);
          if (d < r && !c.pins?.has(i)) {
            const f = (1 - d / r) * strength;
            c.prev[i * 3 + 2] += f; // pos - prev grows negative-z → sheet billows away
          }
        }
      };

      world.buildCloth(clothAspect, perf, artworkRatio);
      setEnvironment(envId); // saved HDRI selection loads on open

      // Opening artwork — resolve the saved selection against the built-ins,
      // then the saved-upload library, then the shipped default. 404s/missing
      // entries stay silent; any pick or upload replaces it.
      {
        const savedId = saved.artworkId || DEFAULT_ARTWORK_ID;
        const builtin = BUILTIN_ARTWORKS.find((a) => a.id === savedId);
        const stored = !builtin ? loadArtworkLib().find((a) => a.id === savedId) : null;
        const fallback = BUILTIN_ARTWORKS[0];
        const src = builtin?.url || stored?.dataUrl || fallback.url;
        const label = builtin?.label || stored?.label || fallback.label;
        const img = new Image();
        img.onload = () => {
          if (disposed || clothMat.map) return; // user beat us to an upload
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          tex.needsUpdate = true;
          clothMat.map = tex;
          clothMat.needsUpdate = true;
          clothBackMat.map = mirrorTex(tex); // back face mirrored so it reads right
          clothBackMat.needsUpdate = true;
          setArtworkName(label);
          setArtworkRatio(img.width / img.height); // auto-shape picks this up
          setArtworkUrl(img.src); // one source of truth for the T-shirt's front print — see elements/primary-cloth.js
        };
        img.src = src;
      }

      // ── Grab interaction — pointerdown ON the sheet grabs a fabric patch and
      // pins it to the pointer ray while dragging; verlet infers velocity from
      // the drag, so a fast release FLINGS the cloth. Pointerdown on empty
      // space falls through to OrbitControls as usual. ──
      const ndc = new THREE.Vector2();
      const grab = { active: false, idx: null, w: null, off: null, dist: 0, target: new THREE.Vector3() };
      world.grab = grab;
      // Primary T-shirt (procedural 2.5D cloth, "pivot" round) grab — same
      // shape/contract as the sheet's own `grab` above, consumed by
      // tshirt-mesh.js's stepSim/advanceSim `grab` param (see its own header
      // comment). Unlike the earlier real-GLB round, this indexes DENSE
      // mesh vertices directly (the garment's own front/back panels share
      // ONE position buffer with its `sim`, exactly like the sheet's own
      // `c.mesh`/`c.meshBack`), so the tweezer-pinch selection below mirrors
      // the sheet's own almost verbatim. Lives in root-LOCAL space (the same
      // space `sim.position` already uses) via `root.worldToLocal` — a
      // no-op today since the primary instance's transform is always
      // identity, but correct regardless.
      const tshirtGrab = { active: false, idx: null, w: null, off: null, dist: 0, target: new THREE.Vector3() };
      world.tshirtGrab = tshirtGrab;
      const localHit = new THREE.Vector3();
      const setRayFromEvent = (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        world.raycaster.setFromCamera(ndc, activeCamera()); // grabbing works in shot-cam view too
      };
      const onPointerDown = (e) => {
        const c = world.cloth;
        if (c) {
          setRayFromEvent(e);
          // Both faces are grabbable — FrontSide/BackSide materials cull raycast
          // hits per side, so test the pair.
          const hit = world.raycaster.intersectObjects([c.mesh, c.meshBack], false)[0];
          if (!hit) return; // empty space → orbit
          const arr = c.geometry.attributes.position.array;
          // Tweezer pinch — tiny contact area; the rest of the sheet trails
          // through the constraints instead of moving as a rigid patch.
          const r = Math.max(c.cw, c.ch) * 0.055;
          const idx = []; const w = []; const off = [];
          let nearest = -1; let nearestD = Infinity;
          for (let i = 0; i < c.count; i += 1) {
            if (c.pins?.has(i)) continue;
            const dx = arr[i * 3] - hit.point.x;
            const dy = arr[i * 3 + 1] - hit.point.y;
            const dz = arr[i * 3 + 2] - hit.point.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < nearestD) { nearestD = d; nearest = i; }
            if (d < r) {
              const t = 1 - d / r;
              idx.push(i); w.push(t * t * 0.95);
              off.push(dx, dy, dz); // keep the pinch's shape while held
            }
          }
          // Coarse grids can miss the tiny radius between vertices — always
          // pinch at least the nearest particle.
          if (!idx.length && nearest >= 0) {
            idx.push(nearest); w.push(0.95);
            off.push(arr[nearest * 3] - hit.point.x, arr[nearest * 3 + 1] - hit.point.y, arr[nearest * 3 + 2] - hit.point.z);
          }
          if (!idx.length) return;
          grab.active = true; grab.idx = idx; grab.w = w; grab.off = off;
          grab.dist = hit.distance;
          grab.target.copy(hit.point);
          controls.enabled = false;
          try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
          return;
        }
        const entry = world.tshirtPrimaryEntry;
        const sim = entry?.object?.userData?.sim;
        if (!entry || !sim) return;
        const meshes = entry.object.userData.motion.children.filter((c2) => c2.isMesh);
        setRayFromEvent(e);
        const hit = world.raycaster.intersectObjects(meshes, false)[0];
        if (!hit) return; // empty space → orbit
        entry.object.worldToLocal(localHit.copy(hit.point));
        const pos = sim.position;
        // Same tweezer-pinch radius formula as the sheet's own grab — a
        // fraction of the garment's own world dimensions, not a hardcoded
        // guess (see elements/factories.js TSHIRT_WORLD_WIDTH/HEIGHT).
        const radius = Math.max(TSHIRT_WORLD_WIDTH, TSHIRT_WORLD_HEIGHT) * 0.055;
        const idx = []; const w = []; const off = [];
        let nearest = -1; let nearestD = Infinity;
        for (let i = 0; i < sim.vertexCount; i += 1) {
          if (sim.pinIndices.has(i)) continue;
          const dx = pos[i * 3] - localHit.x;
          const dy = pos[i * 3 + 1] - localHit.y;
          const dz = pos[i * 3 + 2] - localHit.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < nearestD) { nearestD = d; nearest = i; }
          if (d < radius) {
            const t = 1 - d / radius;
            idx.push(i); w.push(t * t * 0.95);
            off.push(dx, dy, dz);
          }
        }
        // Coarse grids can miss the tiny radius between vertices — always
        // pinch at least the nearest particle.
        if (!idx.length && nearest >= 0) {
          idx.push(nearest); w.push(0.95);
          off.push(pos[nearest * 3] - localHit.x, pos[nearest * 3 + 1] - localHit.y, pos[nearest * 3 + 2] - localHit.z);
        }
        if (!idx.length) return;
        tshirtGrab.active = true; tshirtGrab.idx = idx; tshirtGrab.w = w; tshirtGrab.off = off;
        tshirtGrab.dist = hit.distance;
        tshirtGrab.target.copy(localHit);
        controls.enabled = false;
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
      };
      const onPointerMove = (e) => {
        if (grab.active) {
          setRayFromEvent(e);
          const ray = world.raycaster.ray;
          // Drag on the sphere of the original hit distance — pointer maps 1:1.
          grab.target.copy(ray.origin).addScaledVector(ray.direction, grab.dist);
          return;
        }
        if (tshirtGrab.active) {
          const entry = world.tshirtPrimaryEntry;
          if (!entry) { tshirtGrab.active = false; controls.enabled = true; return; }
          setRayFromEvent(e);
          const ray = world.raycaster.ray;
          localHit.copy(ray.origin).addScaledVector(ray.direction, tshirtGrab.dist);
          entry.object.worldToLocal(localHit);
          tshirtGrab.target.copy(localHit);
        }
      };
      const onPointerUp = (e) => {
        if (grab.active) {
          grab.active = false;
          controls.enabled = true;
          try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
        }
        if (tshirtGrab.active) {
          tshirtGrab.active = false;
          controls.enabled = true;
          try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
        }
      };
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);

      // ── Sim + render loop — fixed-step verlet, then constraint relaxation. ──
      const DT = 1 / 60;
      let accum = 0;
      const step = (t) => {
        const c = world.cloth; if (!c) return;
        const p = liveRef.current.phys;
        // Timeline v2 override first, same `??` pattern as every other
        // per-frame read of world.timelineOverride — anim.turbulence/speed
        // are whitelisted continuous fields (anim.on stays discrete, see
        // timeline.js's own TIMELINE_LERP_WHITELIST header), so a blended
        // value wins over the plain React-state value during an active
        // transition/scrub.
        const a = world.timelineOverride?.anim ?? liveRef.current.anim;
        const arr = c.geometry.attributes.position.array;
        const prev = c.prev;
        const damp = p.damping;
        // Floating mode is weightless — the crumpled sheet hangs in space like
        // the reference; gravity only pulls when the sheet is pinned.
        const g = p.pinMode === 'free-float' ? 0 : -p.gravity * 0.28;
        // Ambient animation — multi-octave turbulence field, scaled by the
        // TURBULENCE slider; OFF zeroes the wind entirely.
        const amp = a.on ? a.turbulence * 2.4 : 0;
        const ws = a.speed || 1;
        const gust = 0.5 + 0.5 * Math.sin(t * ws * 1.25);
        const dt2 = DT * DT;

        for (let i = 0; i < c.count; i += 1) {
          if (c.pins?.has(i)) continue;
          const ix = i * 3;
          const x = arr[ix], y = arr[ix + 1], z = arr[ix + 2];
          // two spatial octaves toward +z, lateral swirl on x, gentle lift on y
          const wz = amp * (0.45 + 0.55 * gust) * (
            0.7 * Math.sin(x * 2.3 + t * ws * 1.7) * Math.cos(y * 1.9 + t * ws * 1.3)
            + 0.35 * Math.sin(x * 5.1 - t * ws * 2.3) * Math.cos(y * 4.3 + t * ws * 1.9)
          );
          const wx = amp * 0.3 * Math.sin(t * ws * 0.8 + y * 2.6) * Math.cos(x * 1.7 + t * ws * 0.6);
          const wy = amp * 0.18 * Math.sin(t * ws * 0.7 + x * 2.1);
          const vx = (x - prev[ix]) * damp;
          const vy = (y - prev[ix + 1]) * damp;
          const vz = (z - prev[ix + 2]) * damp;
          prev[ix] = x; prev[ix + 1] = y; prev[ix + 2] = z;
          arr[ix] = x + vx + wx * dt2;
          arr[ix + 1] = y + vy + (g + wy) * dt2;
          arr[ix + 2] = z + vz + wz * dt2;
        }

        const stiff = 0.5 * p.stiffness;
        const iters = 5;
        for (let it = 0; it < iters; it += 1) {
          for (let ci = 0; ci < c.constraints.length; ci += 1) {
            const [a, b, rest] = c.constraints[ci];
            const ax = a * 3, bx = b * 3;
            const dx = arr[bx] - arr[ax], dy = arr[bx + 1] - arr[ax + 1], dz = arr[bx + 2] - arr[ax + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
            const diff = ((dist - rest) / dist) * stiff;
            const ox = dx * diff, oy = dy * diff, oz = dz * diff;
            arr[ax] += ox; arr[ax + 1] += oy; arr[ax + 2] += oz;
            arr[bx] -= ox; arr[bx + 1] -= oy; arr[bx + 2] -= oz;
          }
          // Re-assert pins each pass so the solve can't drag them.
          if (c.pins) for (const pi of c.pins) {
            const ix = pi * 3;
            arr[ix] = c.orig[ix]; arr[ix + 1] = c.orig[ix + 1]; arr[ix + 2] = c.orig[ix + 2];
            prev[ix] = c.orig[ix]; prev[ix + 1] = c.orig[ix + 1]; prev[ix + 2] = c.orig[ix + 2];
          }
        }

        // Grabbed patch chases the pointer target — positions move while prev
        // lags, so verlet reads the drag as velocity: hold = pinned, fast
        // release = fling. Applied after constraints so the hold stays firm.
        const gb = world.grab;
        if (gb?.active && gb.idx) {
          for (let k = 0; k < gb.idx.length; k += 1) {
            const ix = gb.idx[k] * 3;
            const wgt = gb.w[k];
            arr[ix] += (gb.target.x + gb.off[k * 3] - arr[ix]) * wgt;
            arr[ix + 1] += (gb.target.y + gb.off[k * 3 + 1] - arr[ix + 1]) * wgt;
            arr[ix + 2] += (gb.target.z + gb.off[k * 3 + 2] - arr[ix + 2]) * wgt;
          }
        }

        // Floating mode — REBOUND scales the spring toward the rest pose.
        // 0 = no retraction: the sheet stays wherever it was dragged, holding
        // its crumple; higher values pull it home faster.
        if (p.pinMode === 'free-float') {
          const k = (p.rebound ?? 0.18) * 0.02;
          if (k > 0) {
            for (let i = 0; i < c.count; i += 1) {
              const ix3 = i * 3;
              arr[ix3] += (c.orig[ix3] - arr[ix3]) * k;
              arr[ix3 + 1] += (c.orig[ix3 + 1] - arr[ix3 + 1]) * k;
              arr[ix3 + 2] += (c.orig[ix3 + 2] - arr[ix3 + 2]) * k;
            }
          }
        }

        c.geometry.attributes.position.needsUpdate = true;
        c.geometry.computeVertexNormals();
        // Raycast grabbing checks the bounding sphere first — keep it in sync
        // with the deforming sheet or hits start missing once it billows.
        c.geometry.computeBoundingSphere();
      };

      // ── HUD — 2D overlay canvas: light-can + shot-cam markers as lines/dots,
      // plus the social capture frame with its platform label. ──
      const projV = new THREE.Vector3();
      const drawHud = (activeCam) => {
        const hc = hudCanvasRef.current;
        if (!hc) return;
        const cw = hc.clientWidth, chh = hc.clientHeight;
        if (!cw || !chh) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (hc.width !== Math.round(cw * dpr) || hc.height !== Math.round(chh * dpr)) {
          hc.width = Math.round(cw * dpr); hc.height = Math.round(chh * dpr);
        }
        const g2 = hc.getContext('2d');
        g2.setTransform(dpr, 0, 0, dpr, 0, 0);
        g2.clearRect(0, 0, cw, chh);
        const live = liveRef.current;
        const proj = (v3) => {
          projV.copy(v3).project(activeCam);
          return { x: (projV.x * 0.5 + 0.5) * cw, y: (-projV.y * 0.5 + 0.5) * chh, front: projV.z < 1 };
        };
        if (live.hudOn) {
          const cx = proj(new THREE.Vector3(0, 0, 0));
          g2.font = '700 9px "Space Mono", monospace';
          // Light cans — colored dot + line to stage center.
          world.cans.forEach((can, i) => {
            if (!can.visible) return;
            const p = proj(can.position);
            if (!p.front) return;
            g2.strokeStyle = '#' + can.color.getHexString();
            g2.globalAlpha = 0.55;
            g2.setLineDash([4, 4]);
            g2.beginPath(); g2.moveTo(p.x, p.y); g2.lineTo(cx.x, cx.y); g2.stroke();
            g2.setLineDash([]);
            g2.globalAlpha = 1;
            g2.fillStyle = '#' + can.color.getHexString();
            g2.beginPath(); g2.arc(p.x, p.y, 7, 0, Math.PI * 2); g2.fill();
            g2.fillStyle = '#000';
            g2.fillText(String(i + 1), p.x - 2.5, p.y + 3);
          });
          // Shot camera — wedge marker (hidden while looking through it).
          if (!live.shotCam?.use) {
            const p = proj(shotCamera.position);
            if (p.front) {
              g2.strokeStyle = '#ffffff';
              g2.globalAlpha = 0.5;
              g2.setLineDash([2, 5]);
              g2.beginPath(); g2.moveTo(p.x, p.y); g2.lineTo(cx.x, cx.y); g2.stroke();
              g2.setLineDash([]);
              g2.globalAlpha = 1;
              g2.fillStyle = '#ffffff';
              g2.beginPath();
              g2.moveTo(p.x, p.y - 7); g2.lineTo(p.x + 9, p.y); g2.lineTo(p.x, p.y + 7); g2.closePath(); g2.fill();
              g2.fillText('CAM', p.x + 12, p.y + 3);
            }
          } else {
            g2.fillStyle = 'rgba(236,72,153,0.9)';
            g2.font = '700 10px "Space Mono", monospace';
            g2.fillText('SHOT CAM LIVE', 12, 20);
          }
        }
        // Capture frames — a filmstrip: every crop laid out in a row, the
        // active one centred (dim outside it), its neighbours ghosted either
        // side. Switching crops eases the whole strip across.
        const slide = world.frameSlide;
        const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, slide.t)), 3); // easeOutCubic
        const idxF = slide.from + (slide.to - slide.from) * eased;
        const sizes = FRAME_IDS.map((id) => frameFootprint(id, cw, chh));
        // Row layout, then translate so the fractional active index sits centre.
        const centers = [];
        let cursor = 0;
        FRAME_IDS.forEach((id, i) => {
          cursor += (i === 0 ? sizes[i].w / 2 : sizes[i - 1].w / 2 + FRAME_GAP + sizes[i].w / 2);
          centers[i] = cursor;
        });
        const lo = Math.floor(idxF), hi = Math.min(FRAME_IDS.length - 1, lo + 1);
        const focusCenter = centers[lo] + (centers[hi] - centers[lo]) * (idxF - lo);
        const shift = cw / 2 - focusCenter;
        const activeIdx = slide.to;
        const activeRect = {
          x: centers[activeIdx] + shift - sizes[activeIdx].w / 2,
          y: (chh - sizes[activeIdx].h) / 2,
          w: sizes[activeIdx].w, h: sizes[activeIdx].h,
        };
        // Dim everything outside the active crop (skipped while frame is off).
        if (FRAME_PRESETS[live.frameId]?.w) {
          const r = activeRect;
          g2.fillStyle = 'rgba(0,0,0,0.45)';
          g2.fillRect(0, 0, cw, r.y);
          g2.fillRect(0, r.y + r.h, cw, chh - r.y - r.h);
          g2.fillRect(0, r.y, r.x, r.h);
          g2.fillRect(r.x + r.w, r.y, cw - r.x - r.w, r.h);
        }
        g2.font = '700 9px "Space Mono", monospace';
        FRAME_IDS.forEach((id, i) => {
          const isActive = i === activeIdx;
          const size = sizes[i];
          const x = centers[i] + shift - size.w / 2;
          const y = (chh - size.h) / 2;
          if (x > cw || x + size.w < 0) return; // off-canvas
          g2.globalAlpha = isActive ? 1 : 0.42;
          g2.strokeStyle = 'rgba(255,255,255,0.9)';
          g2.lineWidth = isActive ? 1.5 : 1;
          g2.setLineDash(isActive ? [] : [5, 5]);
          g2.strokeRect(x, y, size.w, size.h);
          g2.setLineDash([]);
          g2.globalAlpha = 1;
        });
        // Hero Text affordances — HUD-only (this canvas is never part of any
        // export, see the "HUD overlay" comment at its own header), shown
        // only while the HERO TEXT card is open so they never clutter the
        // HUD during ordinary camera/light work. Uses the SAME
        // resolveFrameRect text-layers.js's layoutTextPlane placed the real
        // plane with, so the anchor box tracks the actual mesh, not an
        // approximation.
        if (live.heroTextOpen) {
          const fr2 = resolveFrameRect({ canvasW: cw, canvasH: chh, frameW: FRAME_PRESETS[live.frameId]?.w, frameH: FRAME_PRESETS[live.frameId]?.h });
          // Safe-area guides (Phase 2) — title-safe 90% rect + rule-of-
          // thirds, composition aids only, very low alpha so they read as
          // guides, not scene content (matches the rest of this HUD's dim/
          // ghost styling above). Drawn regardless of whether a layer is
          // selected — unlike the anchor box below, these aren't tied to
          // one layer's own fields.
          g2.save();
          g2.strokeStyle = 'rgba(255,255,255,0.18)';
          g2.lineWidth = 1;
          g2.setLineDash([4, 4]);
          const safeW = fr2.w * 0.9, safeH = fr2.h * 0.9;
          g2.strokeRect(fr2.x + (fr2.w - safeW) / 2, fr2.y + (fr2.h - safeH) / 2, safeW, safeH);
          g2.setLineDash([]);
          g2.strokeStyle = 'rgba(255,255,255,0.1)';
          g2.beginPath();
          [1 / 3, 2 / 3].forEach((f) => {
            const x = fr2.x + fr2.w * f;
            g2.moveTo(x, fr2.y); g2.lineTo(x, fr2.y + fr2.h);
          });
          [1 / 3, 2 / 3].forEach((f) => {
            const y = fr2.y + fr2.h * f;
            g2.moveTo(fr2.x, y); g2.lineTo(fr2.x + fr2.w, y);
          });
          g2.stroke();
          g2.restore();

          if (live.selectedTextLayerId) {
            const layer = (live.textLayers || []).find((l) => l.id === live.selectedTextLayerId);
            if (layer) {
              const ax = fr2.x + layer.anchorX * fr2.w;
              const ay = fr2.y + layer.anchorY * fr2.h;
              const bw = (layer.maxWidthPct / 100) * fr2.w;
              const bh = (layer.sizePct / 100) * fr2.h * layer.leading * 1.4; // rough single-line estimate — HUD affordance, not a real measure
              g2.strokeStyle = '#22d3ee';
              g2.globalAlpha = 0.85;
              g2.setLineDash([5, 4]);
              g2.strokeRect(ax - bw / 2, ay - bh / 2, bw, bh);
              g2.setLineDash([]);
              g2.beginPath();
              g2.moveTo(ax - 8, ay); g2.lineTo(ax + 8, ay);
              g2.moveTo(ax, ay - 8); g2.lineTo(ax, ay + 8);
              g2.stroke();
              g2.globalAlpha = 1;
            }
          }
        }
      };

      const loop = () => {
        if (disposed) return;
        raf = requestAnimationFrame(loop);
        const dt = Math.min(world.clock.getDelta(), 0.1);
        accum += dt;
        const t = world.clock.elapsedTime;
        let steps = 0;
        while (accum >= DT && steps < 3) { step(t); accum -= DT; steps += 1; }
        if (steps === 3) accum = 0; // shed backlog after stalls instead of spiraling
        holoUniforms.uTime.value = t;
        // Glass auto-rotate — slow ring spin + gentle tumble. Timeline
        // (Phase 4) override first — rotSpeed is a whitelisted continuous
        // field, so a transition's own blended value wins over the plain
        // React-state value whenever world.timelineOverride is set (null
        // outside/between transitions, so this is a no-op then).
        const gl = world.timelineOverride?.glass ?? liveRef.current.glass;
        if (glassMesh.visible && gl?.rotate) {
          glassMesh.rotation.z += gl.rotSpeed * 0.5 * dt;
          glassMesh.rotation.x += gl.rotSpeed * 0.17 * dt;
        }
        // Phase 2 scene elements — per-frame motion for every live object,
        // driven by its factory's own animate() and the CURRENT instance
        // data (read fresh each frame via liveRef, not captured at create
        // time, so a mid-drag motion-speed change takes effect immediately).
        elementLiveObjects.forEach(({ object, factory }, id) => {
          const inst = (liveRef.current.elementInstances || []).find((i) => i.id === id);
          if (inst) factory.animate(object, inst, t, dt);
        });
        // Primary T-shirt (procedural 2.5D cloth, "pivot" round) — driven
        // through the SAME factory.animate() contract elementLiveObjects
        // uses above, reading the CURRENT normalized instance (rebuilt by
        // the dedicated lifecycle effect whenever mat/phys/anim/tshirtPrint
        // change, so a mid-drag turbulence/weight change takes effect
        // immediately, same as the sheet's own step()). The pointer grab (if
        // any) is synced onto the object's own userData right before
        // animate() reads it internally (elements/factories.js tshirtAnimate).
        if (world.tshirtPrimaryEntry) {
          const { object, factory, instance } = world.tshirtPrimaryEntry;
          object.userData.grab = world.tshirtGrab;
          if (instance) factory.animate(object, instance, t, dt);
        }
        controls.update();
        if (world.frameSlide.t < 1) world.frameSlide.t = Math.min(1, world.frameSlide.t + dt / 0.35);
        // Timeline v2 — advances playback/scrub (may push a one-time
        // discrete applySceneRecipe on a keyframe-pair change, and/or
        // retrigger world.textAnimClock for a changed headline) and
        // refreshes world.timelineOverride + the orbit camera for this
        // frame BEFORE anything below reads shotCam/glass/mat/envIntensity/
        // lightCans/bgColor/textLayers — see stepTimelinePlayback/
        // applyTimelineContinuousOverride (module scope, above) for the
        // full contract. Both are cheap no-ops whenever
        // world.timelineClock is idle AND no scrub is pending, i.e. always,
        // outside an active Play/Loop/Export/scrub.
        stepTimelinePlayback(world, t, applySceneRecipeRef.current, liveRef.current.timeline);
        // Primary Device Mockup (third primary shape) — same per-frame
        // factory.animate() contract as the T-shirt entry above, but
        // deliberately AFTER stepTimelinePlayback so this frame's freshly
        // blended scroll position is what the screen shows (no one-frame
        // lag). The override rides in via userData each frame — undefined
        // whenever no playback/scrub is active, so it clears itself the
        // moment the timeline lets go and deviceAnimate falls back to the
        // SCROLL POSITION dial.
        if (world.devicePrimaryEntry) {
          const { object, factory, instance } = world.devicePrimaryEntry;
          object.userData.scrollPositionOverride = world.timelineOverride?.devicePrimary?.scrollPosition;
          // HEIGHT OFFSET (posY) — reasserted every frame on the SAME seat
          // base the lifecycle effect computed, so a keyframed posY blends
          // during playback and falls back to the dial the moment the
          // timeline lets go (same self-clearing contract as the scroll
          // override above).
          const ovPosY = world.timelineOverride?.devicePrimary?.posY;
          object.position.y = (world.deviceSeatY || 0) + (Number.isFinite(ovPosY) ? ovPosY : (world.devicePosY || 0));
          if (instance) factory.animate(object, instance, t, dt);
        }
        // LIVE device screen — pin the CSS3D iframe to the screen mesh's
        // exact world transform (0.001 = the DEVICE_VIEWPORTS px→wu ratio:
        // the iframe is laid out at the real viewport's pixel size, so the
        // site renders at its true breakpoint) and render the CSS layer
        // with the SAME active camera. Runs after the timeline step so a
        // keyframed camera move carries the live screen with it.
        if (world.deviceLive && world.devicePrimaryEntry) {
          const mesh = world.devicePrimaryEntry.object.userData.screenMesh;
          if (mesh) {
            mesh.updateWorldMatrix(true, false);
            mesh.matrixWorld.decompose(liveScreenPos, liveScreenQuat, liveScreenScl);
            const o = world.deviceLive.object;
            o.position.copy(liveScreenPos);
            o.quaternion.copy(liveScreenQuat);
            o.scale.set(liveScreenScl.x * 0.001, liveScreenScl.y * 0.001, liveScreenScl.z * 0.001);
          }
        } else if (world.devicePrimaryEntry) {
          // Stranded hole-material invariant (backstop, NOT the fix — see
          // teardownLiveScreenNow's own header for the actual root cause this
          // guards against). Runs every committed frame, independent of
          // React's own effect timing, so it self-heals within one frame of
          // ANY path that leaves the screen mesh showing the alpha-punch
          // cut-out material while no live iframe is actually up
          // (isScreenMaterialStranded, elements/video-export.js — pure and
          // unit-tested; world.deviceLive is the ONE authoritative "is Live
          // actually up" signal here, never devicePrimary.live, which can be
          // true in React state for a frame or two before the effect that
          // owns the iframe has caught up). A genuinely-working call site
          // should never trip this — it means some OTHER path left the mesh
          // wrong, so it warns loudly rather than silently papering over it.
          const ud = world.devicePrimaryEntry.object.userData;
          if (isScreenMaterialStranded({ deviceLiveActive: false, meshMaterial: ud.screenMesh?.material, factoryMaterial: ud.screenMaterial })) {
            console.warn('[holocloth] stranded live-screen hole material caught by the per-frame invariant — restoring the textured screen');
            ud.screenMesh.material = ud.screenMaterial;
          }
        }
        // Background-image cover fit — CSS background-size:cover semantics
        // for scene.background (which otherwise stretches the texture to
        // the canvas, skewing any ratio mismatch). Per-frame on purpose
        // (six float ops): window resizes, panel toggles, and export-
        // resolution swaps all stay correct with zero extra plumbing.
        if (world.bgCoverInfo && world.bgTexture) {
          const canvasAspect = renderer.domElement.width / Math.max(1, renderer.domElement.height);
          const cover = computeBackgroundCover(world.bgCoverInfo.aspect, canvasAspect, world.bgCoverInfo.shiftY || 0);
          world.bgTexture.repeat.set(cover.repeatX, cover.repeatY);
          world.bgTexture.offset.set(cover.offsetX, cover.offsetY);
        }
        applyTimelineContinuousOverride(world, world.timelineOverride);
        // Hero Text Phase 3 — updates textMeshes' material.opacity/
        // mesh.position.y (+ occasionally redraws a layer's canvas) BEFORE
        // either render branch below draws world.textOverlayScene, so both
        // the fx path (runFxFinishChain) and the non-fx path pick up the
        // current frame's animation state for free — one call site, not two.
        // Runs AFTER the timeline override above (not before, as Phase 3
        // originally had it) so a timeline-blended text base (position/
        // opacity, set by world.applyTimelineTextOverride) is what THIS
        // frame's in/out anim delta layers on top of, not last frame's
        // stale base — see applyTextAnimFrame's own baseOpacity/
        // baseCenterY comment for the full contract.
        applyTextAnimFrame(world, t);
        const cam = activeCamera();
        if (fxActive()) {
          // Timeline override wins for fx's own whitelisted leaves
          // (bloomStrength/bloomThreshold/vignette/grain/t1/t2/t3) during an
          // active transition — every other fx field (bloom on/off,
          // treatment, colA/colB) is discrete and already landed in React
          // state at the transition's start, so it's identical whichever
          // side of this `??` supplies it.
          const f = world.timelineOverride?.fx ?? liveRef.current.fx;
          syncFrameUniforms(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
          renderPass.camera = cam;
          bloomPass.enabled = Boolean(f.bloom);
          bloomPass.strength = f.bloomStrength;
          bloomPass.threshold = f.bloomThreshold;
          const resW = renderer.domElement.width;
          const resH = renderer.domElement.height;
          diffusionPass.uniforms.uRes.value.set(resW, resH);
          diffusionPass.uniforms.uVignette.value = f.vignette;
          const dc = world.timelineOverride?.diffusionCamera ?? liveRef.current.diffusionCamera;
          diffusionPass.uniforms.uDiffusionEnabled.value = dc?.enabled ? 1 : 0;
          diffusionPass.uniforms.uBgDiffusion.value = liveRef.current.bgFx?.diffusion === false ? 0 : 1;
          if (dc?.enabled) {
            // Real near/far uniforms (Codex visual-correction round) —
            // replaces two shader constants that happened to match both
            // cameras' construction values but had no enforced
            // relationship to them.
            diffusionPass.uniforms.uNear.value = cam.near;
            diffusionPass.uniforms.uFar.value = cam.far;
            // Focal Target resolution — every frame (cheap: a handful of
            // getWorldPosition calls + one matrix transform, not a render),
            // so an orbiting camera, a dragged T-shirt, or a moved extra
            // element all update the focus plane immediately, with no
            // separate change-detection/caching to keep in sync. 'manual'
            // is the one mode where Focus Distance IS the literal dial
            // value; every other target resolves to a REAL camera-space
            // forward distance (diffusion-focus.js cameraSpaceForwardDistance
            // — the same coordinate convention DIFFUSION_SHADER's own depth
            // linearization uses), with a deterministic fallback to
            // DIFFUSION_FOCAL_ORIGIN (world origin) whenever the stored
            // target no longer names a live, enabled object.
            if (dc.focalTarget === DIFFUSION_FOCAL_MANUAL) {
              diffusionPass.uniforms.uFocusDistance.value = dc.focusDistance;
            } else {
              const resolvedTargetId = resolveFocalTargetId(dc.focalTarget, {
                glassOn: Boolean(liveRef.current.glass?.on),
                primaryArtworkAvailable: Boolean(world.tshirtPrimaryEntry || world.devicePrimaryEntry || world.cloth),
                elementInstances: liveRef.current.elementInstances,
                primaryElementId: PRIMARY_ELEMENT_ID,
              });
              const worldPos = world.resolveDiffusionFocusWorldPosition(resolvedTargetId) || focusScratchVec.set(0, 0, 0);
              cam.updateMatrixWorld();
              diffusionPass.uniforms.uFocusDistance.value = cameraSpaceForwardDistance(cam, worldPos);
            }
            diffusionPass.uniforms.uAperture.value = dc.aperture;
            diffusionPass.uniforms.uFalloff.value = dc.falloff;
            diffusionPass.uniforms.uDiffusionRadius.value = dc.diffusionRadius;
            diffusionPass.uniforms.uHighlightBloom.value = dc.highlightBloom;
            diffusionPass.uniforms.uForegroundBias.value = dc.foregroundBias;
            diffusionPass.uniforms.uBackgroundBias.value = dc.backgroundBias;
          }
          treatmentPass.uniforms.uRes.value.set(resW, resH);
          treatmentPass.uniforms.uGrain.value = f.grain;
          treatmentPass.uniforms.uCleanAlphaHole.value = world.deviceLive ? 1 : 0;
          treatmentPass.uniforms.uTime.value = t % 100;
          treatmentPass.uniforms.uT1.value = f.t1;
          treatmentPass.uniforms.uT2.value = f.t2;
          treatmentPass.uniforms.uT3.value = f.t3;
          // Treatments run in display space, so the ink/paper colours must stay
          // as authored — setStyle with the working space skips the usual
          // sRGB→linear conversion that would wash them out.
          treatmentPass.uniforms.uColA.value.setStyle(f.colA, THREE.LinearSRGBColorSpace);
          treatmentPass.uniforms.uColB.value.setStyle(f.colB, THREE.LinearSRGBColorSpace);
          runFxFinishChain();
        } else {
          renderer.render(scene, cam);
          // Hero Text overlay, non-fx path — the same "render on top,
          // autoClear off" compositing runFxFinishChain does between
          // diffusion/treatment above, just with no treatment pass to run
          // afterward. The screen framebuffer (unlike diffuseTarget) DOES
          // carry a depth attachment, so clearDepth here actually matters —
          // without it, the overlay plane's own depthTest:false material
          // still draws fine, but skipping the clear is free and avoids any
          // dependency on leftover depth state from the main render.
          if (liveRef.current.textLayers?.some((l) => l.on)) {
            renderer.autoClear = false;
            renderer.clearDepth();
            renderer.render(textOverlayScene, textOverlayCam);
            renderer.autoClear = true;
          }
        }
        // CSS layer renders with the same camera whenever a live screen
        // exists — cheap (one DOM transform update) and skipped otherwise.
        if (world.deviceLive) cssRenderer.render(cssScene, cam);
        drawHud(cam);
        // Committed-frame counter (Go Live export-safety round) — the live
        // export guard's readiness signal counts REAL rendered frames after
        // the live teardown/material restore, never wall-clock time.
        world.renderTick = (world.renderTick || 0) + 1;
      };
      loop();

      // Keep canvas sized to the stage. Extracted to a named function (not
      // just the observer callback) so a high-res video export can re-apply
      // the CURRENT live stage size on its own way out — restoring by
      // re-reading the live DOM instead of trusting a snapshot taken before
      // recording started, which would be stale if the window was resized
      // mid-export.
      const applyLiveSize = () => {
        const nw = stage.clientWidth, nh = stage.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        shotCamera.aspect = nw / nh;
        shotCamera.updateProjectionMatrix();
        renderer.setSize(nw, nh, false);
        composer.setSize(nw, nh);
        cssRenderer.setSize(nw, nh);
        const pr = renderer.getPixelRatio();
        diffuseTarget.setSize(nw * pr, nh * pr);
        // Hero Text overlay tracks the SAME CSS stage size as the main
        // cameras (1 world unit == 1 CSS px at z=0 — see setOverlayCamSize's
        // own header above) — resynced here, and relayoutTextMeshes
        // repositions any already-built planes to match, WITHOUT redrawing
        // their canvas textures (that only happens in the React mesh-
        // lifecycle effect, keyed on textLayers/frameId/fontStatus, not on
        // window resize).
        setOverlayCamSize(nw, nh);
        world.relayoutTextMeshes?.();
      };
      world.applyLiveSize = applyLiveSize;
      const ro = new ResizeObserver(() => {
        applyLiveSize();
      });
      ro.observe(stage);

      world.cleanup = () => {
        ro.disconnect();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        // Hero Text Phase 3 — the Preview button's own "return to idle"
        // timeout outlives the button click; never let it fire against a
        // disposed world after unmount.
        if (world.textPreviewTimeout) { clearTimeout(world.textPreviewTimeout); world.textPreviewTimeout = null; }
        try { world.recorder?.stop(); } catch { /* already stopped */ }
        controls.dispose();
        world.cloth?.geometry?.dispose();
        if (world.tshirtPrimaryEntry) {
          world.tshirtPrimaryEntry.factory.dispose(world.tshirtPrimaryEntry.object);
          world.tshirtPrimaryEntry = null;
        }
        clothMat.map?.dispose(); bumpTex.dispose();
        clothBackMat.map?.dispose(); clothBackMat.bumpMap?.dispose();
        ground.geometry.dispose(); ground.material.dispose();
        petalGeos.forEach((g) => g.dispose()); glassMat.dispose();
        elementLiveObjects.forEach(({ object, factory }) => factory.dispose(object));
        elementLiveObjects.clear();
        disposeGLTFLoaderBundle(glbLoader);
        world.bgTexture?.dispose();
        // Hero Text overlay meshes — one CanvasTexture + PlaneGeometry +
        // MeshBasicMaterial per layer (built by the mesh-lifecycle effect
        // below); textOverlayScene itself needs no dispose call (a
        // THREE.Scene holds no GPU resource of its own), just its
        // children's.
        world.textMeshes?.forEach(({ mesh, geometry, material, texture }) => {
          textOverlayScene.remove(mesh);
          geometry.dispose();
          material.dispose();
          texture.dispose();
        });
        world.textMeshes?.clear();
        // FX chain — composer.dispose() only drops its two full-res buffers, so
        // the passes go too; PMREM output textures are ours to free as well.
        bloomPass.dispose(); diffusionPass.dispose(); treatmentPass.dispose(); composer.dispose(); fxDepth.dispose(); diffuseTarget.dispose();
        Object.values(hdriCache).forEach((t) => t.dispose());
        roomEnvTex.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };

      setWorldReady(true);
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      setWorldReady(false);
      // SHARE TAB (Phase 9) BEFORE cleanup(): the shared VideoTexture is
      // ClothStudio's, not the factory's, and cleanup()'s element disposal
      // would dispose it out from under a still-running MediaStream. Stopping
      // first releases the track (Chrome's sharing indicator goes away on
      // unmount) and hands the screen back to the factory's own texture.
      stopDeviceScreenShare(worldRef.current);
      worldRef.current?.cleanup?.();
      worldRef.current = null;
    };
    // Built once per mount — every control below mutates the world in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hero Text: Google Font loading (Locked Design Decision #5) — one
  // <link rel=stylesheet> per {fontId, weight} pair a currently-ON layer
  // actually uses, deduped by DOM id AND by loadedFontWeightsRef so
  // multiple layers sharing a font (or a weight slider passing back over an
  // already-loaded value) never re-inject/re-request the same file.
  // fontStatus itself is keyed by fontId ONLY (matching StudioHeroTextCard's
  // `fontStatus?.[layer.fontId]` read) — a simple per-font load badge, not
  // per-weight; the ref below is the finer-grained (fontId+weight) dedup
  // that state doesn't need to expose. The fallback system font already
  // draws on the very first frame (mesh-lifecycle effect below), so nothing
  // here ever blocks the render loop — this only flips a status flag and
  // bumps fontRedrawTick once the REAL glyphs are available, so the mesh
  // effect redraws that layer's canvas with them.
  const loadedFontWeightsRef = useRef(new Set());
  const [fontRedrawTick, setFontRedrawTick] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.fonts === 'undefined') return;
    textLayers.forEach((layer) => {
      if (!layer.on) return;
      const font = fontById(layer.fontId);
      const key = `${layer.fontId}:${layer.weight}`;
      if (loadedFontWeightsRef.current.has(key)) return;
      loadedFontWeightsRef.current.add(key);
      setFontStatus((prev) => (prev[layer.fontId] === 'ready' ? prev : { ...prev, [layer.fontId]: 'loading' }));
      const linkId = `hero-text-font-link-${key.replace(/[^a-z0-9:-]/gi, '-')}`;
      if (!document.getElementById(linkId)) {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = googleFontCssUrl(font, layer.weight);
        document.head.appendChild(link);
      }
      document.fonts.load(`${layer.weight} 16px "${font.family}"`)
        .then(() => {
          setFontStatus((prev) => ({ ...prev, [layer.fontId]: 'ready' }));
          setFontRedrawTick((t) => t + 1);
        })
        .catch(() => {
          setFontStatus((prev) => ({ ...prev, [layer.fontId]: 'error' }));
        });
    });
  }, [textLayers]);

  // ── Hero Text: mesh lifecycle — one PlaneGeometry + CanvasTexture +
  // MeshBasicMaterial per enabled layer, built into world.textOverlayScene
  // (the world-init effect above). Phase 1 does a full dispose+rebuild of
  // every enabled layer's texture+mesh whenever this effect re-runs —
  // text-layers.js's own header explicitly allows this ("a full rebuild on
  // any change is ACCEPTABLE for Phase 1 — ≤3 layers — prefer simple +
  // correct"), so there is no separate per-field texture-vs-transform diff
  // here. Window RESIZE is handled separately (world.relayoutTextMeshes,
  // called from applyLiveSize above) so dragging the window never redraws a
  // text canvas — only this effect's own deps (a real layer edit, a frame
  // switch, or a font finishing its load) do.
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.textOverlayScene) return;
    const { THREE, textOverlayScene, textMeshes } = world;

    const disposeEntry = (entry) => {
      // parent-agnostic: overlay meshes live in textOverlayScene, in-scene
      // meshes (placement:'scene') in the main world scene.
      entry.mesh.parent?.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      entry.texture.dispose();
    };

    // Offscreen 2D context reused as the `measure` function
    // buildTextCanvasSpec is dependency-injected with (text-layers.js is
    // DOM-free/pure, per its own header) — tracking is deliberately NOT
    // applied here, matching that module's wrapParagraph contract: wrap
    // points must never depend on letter-spacing.
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    const measure = (text, fontString) => {
      measureCtx.font = fontString;
      return measureCtx.measureText(text).width;
    };

    const fr = FRAME_PRESETS[frameId];
    // 'off' has no fixed aspect (see FRAME_PRESETS above) — fall back to a
    // plain 1920×1080 native size so sizePct/maxWidthPct still resolve to a
    // stable, sensible pixel size instead of depending on the live stage's
    // arbitrary CSS dimensions (which would make a layer's font size drift
    // with the browser window).
    const frameNativeW = fr?.w || 1920;
    const frameNativeH = fr?.h || 1080;
    const stageW = stageRef.current?.clientWidth || frameNativeW;
    const stageH = stageRef.current?.clientHeight || frameNativeH;
    const frameRect = resolveFrameRect({ canvasW: stageW, canvasH: stageH, frameW: fr?.w, frameH: fr?.h });

    const wantedIds = new Set();
    textLayers.forEach((layer) => {
      if (!layer.on || !String(layer.text || '').trim()) return;
      wantedIds.add(layer.id);

      // Hero Text Phase 3 — a layer whose IN anim is 'tracking' animates
      // its letter-spacing up to TEXT_ANIM_TRACKING_MAX_MUL (1.35x) DURING
      // the in-window; buildTextCanvasSpec's own canvasW already accounts
      // for tracking's effect on line width (see its own header), so
      // sizing the canvas from an inflated-tracking CLONE of the layer
      // (sizing/wrap only — the layer object stored on the entry below,
      // and every other draw, stays the REAL layer) is what keeps the
      // animated (wider) letter-spacing from ever clipping against the
      // canvas edge. Word-wrap itself is unaffected either way (tracking
      // is deliberately excluded from the wrap-fit decision — see
      // buildTextCanvasSpec's own wrapParagraph comment).
      const usesTrackingAnim = layer.anim?.in === 'tracking';
      const specLayer = usesTrackingAnim ? { ...layer, tracking: layer.tracking * TEXT_ANIM_TRACKING_MAX_MUL } : layer;
      const spec = buildTextCanvasSpec({ layer: specLayer, frameNativeW, frameNativeH, measure });
      const font = fontById(layer.fontId);

      const canvas = document.createElement('canvas');
      canvas.width = spec.canvasW;
      canvas.height = spec.canvasH;
      const ctx = canvas.getContext('2d');
      // Identity animState — the exact Phase 1 static draw (see
      // drawTextLayerCanvas's own header above, module scope).
      drawTextLayerCanvas(ctx, canvas, spec, layer, font);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = world.renderer.capabilities.getMaxAnisotropy();
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.needsUpdate = true;

      // PLACEMENT — 'scene' mounts this SAME canvas-textured plane inside
      // the main 3D world (world units around the origin, depth-tested so
      // the device/elements occlude it and the camera orbits past it);
      // 'overlay' keeps the original screen-space frame-pinned layer.
      const inScene = layer.placement === 'scene';
      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity: layer.opacity,
        depthTest: inScene, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      let baseCenterY;
      let animRangeH; // what applyTextAnimFrame's offsetYPct is a % OF
      if (inScene) {
        const placed = layoutTextPlaneWorld({ spec, layer, frameNativeH });
        mesh.scale.set(placed.planeW, placed.planeH, 1);
        mesh.position.set(placed.centerX, placed.centerY, placed.centerZ);
        baseCenterY = placed.centerY;
        animRangeH = TEXT_WORLD_STAGE.h;
      } else {
        const placed = layoutTextPlane({ spec, layer, frameRect, frameNativeH, stageW, stageH });
        mesh.scale.set(placed.planeW, placed.planeH, 1);
        mesh.position.set(placed.centerX, placed.centerY, 0);
        baseCenterY = placed.centerY;
        animRangeH = frameRect.h;
      }
      mesh.rotation.set(
        THREE.MathUtils.degToRad(layer.rotX), THREE.MathUtils.degToRad(layer.rotY), THREE.MathUtils.degToRad(layer.rotZ)
      );

      const existing = textMeshes.get(layer.id);
      if (existing) disposeEntry(existing);
      (inScene ? world.scene : textOverlayScene).add(mesh);
      // usesRedrawChannel/redraw — Phase 3 per-frame animation application
      // (applyTextAnimFrame, module scope above) reads these: a layer whose
      // anim never touches tracking/blur/wipe never redraws its canvas at
      // all (only the cheap opacity/position path runs for it every
      // frame). baseCenterY/frameRectH are the CURRENT (build-time) values
      // applyTextAnimFrame's offsetYPct math adds on top of — kept fresh
      // across a resize by relayoutTextMeshes below, which is the ONLY
      // other writer of these two fields.
      const usesRedrawChannel = ['tracking', 'blur', 'wipe'].includes(layer.anim?.in) || layer.anim?.out === 'blur';
      const redraw = (animState) => { drawTextLayerCanvas(ctx, canvas, spec, layer, font, animState); texture.needsUpdate = true; };
      textMeshes.set(layer.id, {
        mesh, geometry, material, texture, spec, layer, inScene,
        canvas, ctx, font, baseCenterY, frameRectH: animRangeH, usesRedrawChannel, redraw,
        // Timeline v2 — the CURRENT blended opacity base applyTextAnimFrame's
        // own opacityMul multiplies against (see that function's own
        // comment); seeded to this build's own layer.opacity, kept fresh by
        // world.applyTimelineTextOverride below whenever a timeline
        // override touches this layer's id.
        baseOpacity: layer.opacity,
      });
    });

    // Disabled/removed/emptied since the last run — dispose and drop.
    Array.from(textMeshes.keys()).forEach((id) => {
      if (wantedIds.has(id)) return;
      disposeEntry(textMeshes.get(id));
      textMeshes.delete(id);
    });

    // Resize-only relayout (called from applyLiveSize, world-init effect
    // above) — repositions/rescales already-built meshes against the
    // CURRENT stage size without touching their textures, so a window
    // resize/panel toggle never redraws a text canvas mid-drag.
    world.relayoutTextMeshes = () => {
      const rw = stageRef.current?.clientWidth;
      const rh = stageRef.current?.clientHeight;
      if (!rw || !rh) return;
      const liveFrameRect = resolveFrameRect({ canvasW: rw, canvasH: rh, frameW: fr?.w, frameH: fr?.h });
      textMeshes.forEach((entry) => {
        const { mesh, spec, layer } = entry;
        if (entry.inScene) return; // world-unit placement — window size is irrelevant
        const placed = layoutTextPlane({ spec, layer, frameRect: liveFrameRect, frameNativeH, stageW: rw, stageH: rh });
        mesh.scale.set(placed.planeW, placed.planeH, 1);
        mesh.position.set(placed.centerX, placed.centerY, 0);
        // Hero Text Phase 3 — keep the anim-offset base current across a
        // resize (applyTextAnimFrame adds its offsetYPct delta on top of
        // these, every frame; see that function's own header).
        entry.baseCenterY = placed.centerY;
        entry.frameRectH = liveFrameRect.h;
      });
    };

    // Timeline v2 — continuous per-frame text-TRANSFORM override, called
    // from applyTimelineContinuousOverride (module scope above) via
    // world.applyTimelineTextOverride?.(override.textLayers) whenever a
    // playing/scrubbing timeline's blended recipe carries textLayers.
    // Reuses layoutTextPlane's own anchor math (same as relayoutTextMeshes
    // above) rather than a separate ad hoc position formula — scaling
    // `spec`'s own pixel measurements by the live sizePct ratio keeps
    // align-aware (left/right) anchor offsetting correct at the blended
    // size WITHOUT re-rastering the canvas (no per-frame text redraw cost).
    // Position/opacity/rotation/scale are genuinely continuous; every
    // texture-affecting field (text, font, tracking, leading, maxWidthPct,
    // color, backdrop*) stays at whatever the last DISCRETE cut (a React
    // `textLayers` state change -> this effect's own rebuild, above) set —
    // matched by id; a to-only layer whose mesh hasn't been (re)built yet
    // this render cycle is simply skipped for one frame (self-corrects the
    // next time this effect's own React-state-driven rebuild commits).
    world.applyTimelineTextOverride = (blendedLayers) => {
      if (!Array.isArray(blendedLayers)) return;
      const rw = stageRef.current?.clientWidth;
      const rh = stageRef.current?.clientHeight;
      if (!rw || !rh) return;
      const liveFrameRect = resolveFrameRect({ canvasW: rw, canvasH: rh, frameW: fr?.w, frameH: fr?.h });
      blendedLayers.forEach((bl) => {
        if (!bl || typeof bl !== 'object') return;
        const entry = textMeshes.get(bl.id);
        if (!entry) return;
        const { mesh, material, spec, layer: builtLayer } = entry;
        const builtSizePct = builtLayer.sizePct;
        const ratio = (Number.isFinite(bl.sizePct) && Number.isFinite(builtSizePct) && builtSizePct > 0)
          ? bl.sizePct / builtSizePct : 1;
        const scaledSpec = { ...spec, canvasW: spec.canvasW * ratio, canvasH: spec.canvasH * ratio };
        const liveLayer = {
          ...builtLayer,
          anchorX: Number.isFinite(bl.anchorX) ? bl.anchorX : builtLayer.anchorX,
          anchorY: Number.isFinite(bl.anchorY) ? bl.anchorY : builtLayer.anchorY,
          posZ: Number.isFinite(bl.posZ) ? bl.posZ : builtLayer.posZ,
        };
        if (entry.inScene) {
          // World-space continuous path — same math as the build branch,
          // with the blended anchors/posZ/size (posZ is in
          // TEXT_LAYER_LERP_FIELDS so depth tweens too).
          const placed = layoutTextPlaneWorld({ spec: scaledSpec, layer: liveLayer, frameNativeH });
          mesh.position.set(placed.centerX, placed.centerY, placed.centerZ);
          mesh.scale.set(placed.planeW, placed.planeH, 1);
          mesh.rotation.set(
            THREE.MathUtils.degToRad(Number.isFinite(bl.rotX) ? bl.rotX : builtLayer.rotX),
            THREE.MathUtils.degToRad(Number.isFinite(bl.rotY) ? bl.rotY : builtLayer.rotY),
            THREE.MathUtils.degToRad(Number.isFinite(bl.rotZ) ? bl.rotZ : builtLayer.rotZ),
          );
          material.opacity = Number.isFinite(bl.opacity) ? bl.opacity : builtLayer.opacity;
          entry.baseCenterY = placed.centerY;
          entry.frameRectH = TEXT_WORLD_STAGE.h;
          entry.baseOpacity = material.opacity;
          return;
        }
        const placed = layoutTextPlane({ spec: scaledSpec, layer: liveLayer, frameRect: liveFrameRect, frameNativeH, stageW: rw, stageH: rh });
        mesh.position.set(placed.centerX, placed.centerY, 0);
        mesh.scale.set(placed.planeW, placed.planeH, 1);
        mesh.rotation.set(
          THREE.MathUtils.degToRad(Number.isFinite(bl.rotX) ? bl.rotX : builtLayer.rotX),
          THREE.MathUtils.degToRad(Number.isFinite(bl.rotY) ? bl.rotY : builtLayer.rotY),
          THREE.MathUtils.degToRad(Number.isFinite(bl.rotZ) ? bl.rotZ : builtLayer.rotZ),
        );
        material.opacity = Number.isFinite(bl.opacity) ? bl.opacity : builtLayer.opacity;
        // Keep the Phase-3 anim-offset/opacity bases in sync with the
        // blended transform so applyTextAnimFrame's own offsetYPct/
        // opacityMul delta (in/out anim) lands on the CURRENT blended
        // base, not a stale pre-transition one — see that function's own
        // comment for the full contract.
        entry.baseCenterY = placed.centerY;
        entry.frameRectH = liveFrameRect.h;
        entry.baseOpacity = material.opacity;
      });
    };
    // fontStatus itself is deliberately NOT a dep — flipping to 'loading'/
    // 'error' doesn't change what's drawn (the browser already silently
    // substitutes the CSS fallback family until the real one is available,
    // so ctx.font above draws correctly either way); only a 'ready'
    // transition actually needs a redraw to pick up the real glyphs, and
    // fontRedrawTick (bumped by the font-loading effect above, only on
    // success) is the narrower, correct trigger for exactly that.
  }, [textLayers, frameId, fontRedrawTick, worldReady]);

  // ── Material dials → material props + holo uniforms (no recompiles).
  // Applied to BOTH faces; the back face's maps tile mirrored (-x repeat).
  // Body extracted to module-scope applyMatToWorld (above) — the timeline
  // v2 continuous override calls the SAME function every frame during an
  // active transition/scrub, with a blended mat/envIntensity, so this
  // effect and that per-frame path can never drift into two copies of the
  // same material math. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.clothMat) return;
    applyMatToWorld(world, mat, envIntensity);
  }, [mat, envIntensity, worldReady]);

  // ── Physics dials → pins (the loop reads the rest live via liveRef). ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.cloth) return;
    world.applyPins(phys.pinMode);
  }, [phys.pinMode, worldReady]);

  // ── Rumple slider → re-seed the opening crumple at the new amount. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.cloth) return;
    world.applyRumple(phys.rumple ?? 0.5);
  }, [phys.rumple, worldReady]);

  // ── Treatment → recompile the treatment pass with that look's #define. Rare
  // (user-driven) so a recompile beats branching every pixel every frame. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.treatmentPass) return;
    const def = TREATMENTS[fx.treatment]?.define;
    const m = world.treatmentPass.material;
    m.defines = def ? { [def]: '' } : {};
    m.needsUpdate = true;
  }, [fx.treatment, worldReady]);

  // Look history — a second, independent undo/redo stack for the "global
  // look" fields (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md,
  // Phase 5). Reuses the SAME generic elements/history.js primitive as the
  // element system above (its own header states it's snapshot-shape-
  // agnostic) rather than building a second mechanism. Field list mirrors
  // exactly what applyFxPreset touches below — a full look, not just fx.
  const lookHistoryRef = useRef(createHistory());
  const [, setLookHistoryTick] = useState(0);

  // lookSeed (NOT sceneSeed — see its declaration comment above) is part of
  // this snapshot for the same reason sceneSeed is part of
  // snapshotElementState: randomizeFx mutates it (so the seed keeps
  // advancing on every roll), and an undoable action must round-trip every
  // piece of state it mutates, not just the visible result — otherwise undo
  // restores the look but leaves the seed counter stranded, and a future
  // "same seed reproduces the same result" check (redo, or a Look preset
  // built later) would draw from the wrong point in the seed sequence. Using
  // a seed independent from the Elements scope's sceneSeed means an undo
  // here can never roll back a seed the Element scope has already advanced
  // past (the Codex-blocked cross-scope interference, 2026-07-23T18:24:04Z).
  // clothShape/tshirtPrint ride along here too (not a 5th history stack) —
  // switching primary shape is a discrete named action like a preset select,
  // not a slider drag, same undoable-vs-live-drag line the rest of this
  // scope already draws (see applyLookMutation's own comment below).
  const snapshotLookState = useCallback(
    () => ({ fx, fxPresetId, mat, clothShape, tshirtPrint, devicePrimary, envId, envIntensity, bgMode, bgColor, bgFx, sceneId, sceneTweaks, lightCans, lightTemplate, lookSeed }),
    [fx, fxPresetId, mat, clothShape, tshirtPrint, devicePrimary, envId, envIntensity, bgMode, bgColor, bgFx, sceneId, sceneTweaks, lightCans, lightTemplate, lookSeed]
  );

  const pushLookHistory = useCallback(() => {
    lookHistoryRef.current = pushHistory(lookHistoryRef.current, snapshotLookState());
    setLookHistoryTick((t) => t + 1);
  }, [snapshotLookState]);

  // Same undoable-vs-live-drag split as applyElementMutation: preset select
  // and randomize go through here; individual slider drags in the Material/
  // Background/Lighting cards stay un-undoable (matches those cards' existing
  // behavior — this doesn't turn every card into a Look-history participant).
  const applyLookMutation = useCallback((mutate) => {
    pushLookHistory();
    mutate();
  }, [pushLookHistory]);

  const restoreLookSnapshot = useCallback((snap) => {
    setFx(snap.fx);
    setFxPresetId(snap.fxPresetId);
    setMat(snap.mat);
    if (snap.clothShape === 'sheet' || snap.clothShape === 'tshirt' || snap.clothShape === 'device') setClothShape(snap.clothShape);
    if (snap.tshirtPrint) setTshirtPrint(snap.tshirtPrint);
    if (snap.devicePrimary) setDevicePrimary(snap.devicePrimary);
    setEnvId(snap.envId);
    setEnvIntensity(snap.envIntensity);
    setBgMode(snap.bgMode);
    setBgColor(snap.bgColor);
    if (snap.bgFx) setBgFx(snap.bgFx);
    if (snap.sceneTweaks) setSceneTweaks(snap.sceneTweaks);
    setSceneId(snap.sceneId);
    setLightCans(snap.lightCans);
    setLightTemplate(snap.lightTemplate);
    setLookSeed(snap.lookSeed);
  }, []);

  const undoLook = useCallback(() => {
    const { history, snapshot } = undoHistory(lookHistoryRef.current, snapshotLookState());
    if (!snapshot) return;
    lookHistoryRef.current = history;
    restoreLookSnapshot(snapshot);
    setLookHistoryTick((t) => t + 1);
  }, [snapshotLookState, restoreLookSnapshot]);

  const redoLook = useCallback(() => {
    const { history, snapshot } = redoHistory(lookHistoryRef.current, snapshotLookState());
    if (!snapshot) return;
    lookHistoryRef.current = history;
    restoreLookSnapshot(snapshot);
    setLookHistoryTick((t) => t + 1);
  }, [snapshotLookState, restoreLookSnapshot]);

  // Cross-scope transaction history (Slice 1) — a BOUNDED fourth stack,
  // reusing the same generic elements/history.js primitive, for randomize
  // actions that touch more than one domain in a single click (Colors only:
  // elements+look; Entire set/Unlocked values only: elements+look+camera).
  // Coexists with, does not replace, the three per-domain stacks above/below
  // — a single-domain scope (Selected element, Elements only, Look only,
  // Lighting only, Camera only, Motion only) still pushes to its own domain's
  // stack exactly as before. Each entry only snapshots the domains its own
  // action actually touched ("bounded"), so undo/redo stay meaningful even
  // though different entries can cover different domain sets.
  const crossScopeHistoryRef = useRef(createHistory());
  const [, setCrossScopeHistoryTick] = useState(0);

  const snapshotDomains = useCallback((domains) => {
    const snap = {};
    if (domains.includes('elements')) snap.elements = snapshotElementState();
    if (domains.includes('look')) snap.look = snapshotLookState();
    if (domains.includes('camera')) snap.camera = snapshotCameraState();
    return snap;
  }, [snapshotElementState, snapshotLookState, snapshotCameraState]);

  const restoreDomainsSnapshot = useCallback((snap) => {
    if (snap.elements) restoreElementSnapshot(snap.elements);
    if (snap.look) restoreLookSnapshot(snap.look);
    if (snap.camera) restoreCameraSnapshot(snap.camera);
  }, [restoreElementSnapshot, restoreLookSnapshot, restoreCameraSnapshot]);

  const applyCrossScopeMutation = useCallback((domains, mutate) => {
    crossScopeHistoryRef.current = pushHistory(crossScopeHistoryRef.current, { domains, ...snapshotDomains(domains) });
    setCrossScopeHistoryTick((t) => t + 1);
    mutate();
  }, [snapshotDomains]);

  // Undo/redo peek the TOP entry's own `domains` before snapshotting
  // "current" state — each entry knows exactly which domains it covers, so
  // this works correctly regardless of what single-domain actions happened
  // in between (a known, documented limitation: if e.g. a Look-only
  // randomize happens AFTER a Colors-only cross-scope action, undoing the
  // Colors-only entry still restores Look to ITS pre-Colors-only state,
  // which also reverts that later Look-only change — the same accepted
  // trade-off the pre-existing independent Elements/Look stacks already
  // carry, just now visible across three stacks instead of two. Redo still
  // round-trips exactly: it restores precisely what undo just captured as
  // "current", so undo-then-redo is always a no-op).
  const undoCrossScope = useCallback(() => {
    const stack = crossScopeHistoryRef.current;
    if (!stack.undo.length) return;
    const top = stack.undo[stack.undo.length - 1];
    const current = { domains: top.domains, ...snapshotDomains(top.domains) };
    const { history, snapshot } = undoHistory(stack, current);
    crossScopeHistoryRef.current = history;
    if (snapshot) restoreDomainsSnapshot(snapshot);
    setCrossScopeHistoryTick((t) => t + 1);
  }, [snapshotDomains, restoreDomainsSnapshot]);

  const redoCrossScope = useCallback(() => {
    const stack = crossScopeHistoryRef.current;
    if (!stack.redo.length) return;
    const top = stack.redo[stack.redo.length - 1];
    const current = { domains: top.domains, ...snapshotDomains(top.domains) };
    const { history, snapshot } = redoHistory(stack, current);
    crossScopeHistoryRef.current = history;
    if (snapshot) restoreDomainsSnapshot(snapshot);
    setCrossScopeHistoryTick((t) => t + 1);
  }, [snapshotDomains, restoreDomainsSnapshot]);

  // Switching treatment reuses the generic t1/t2/t3 slots, so clamp them into
  // the new look's ranges — otherwise a 420-line scanline count arrives as a
  // 420px halftone dot and the screen goes blank.
  const setTreatment = useCallback((id) => {
    setFx((f) => {
      const next = { ...f, treatment: id };
      (TREATMENTS[id]?.params || []).forEach(([key, , min, max]) => {
        next[key] = Math.min(max, Math.max(min, f[key]));
      });
      return next;
    });
    setFxPresetId('');
  }, []);

  // Apply a full look — treatment + film + material + environment + backdrop +
  // light rig. Everything routes through the normal setters, so the Material /
  // Background / Lighting cards stay the owners of their own state.
  const applyFxPreset = useCallback((id) => {
    const p = FX_PRESETS[id];
    if (!p) return;
    setFx({ ...DEFAULT_FX, ...p.fx });
    setFxPresetId(id);
    if (p.mat) setMat({ ...p.mat });
    if (p.envId) setEnvId(p.envId);
    if (typeof p.envIntensity === 'number') setEnvIntensity(p.envIntensity);
    if (p.bg?.scene) { setSceneId(p.bg.scene); setBgMode('scene'); }
    else if (p.bg?.mode === 'color') { setBgColor(p.bg.color); setBgMode('color'); }
    if (p.lights) applyLightTemplate(p.lights);
  }, [applyLightTemplate]);

  // Randomize — a preset, then jitter its numbers so no two rolls match.
  // Seeded (mulberry32/deriveSeed off lookSeed — this scope's OWN seed,
  // independent of the element system's sceneSeed, see lookSeed's
  // declaration comment above) so a given seed reproduces the exact same
  // look, matching this codebase's "reproducible, not scattered
  // Math.random()" rule. Pushed through the Look history as ONE undoable
  // step (preset + jitter together), same one-push-per-user-action shape as
  // applyElementMutation.
  //
  // Intensity-aware (elements/intensity.js): 'refine' "preserves composition"
  // by NEVER swapping the current preset/treatment — it only nudges the
  // existing fx numbers with a small jitter scale. Every other tier picks a
  // look ('remix' may coincidentally repeat the current one — a real roll,
  // exactly as before intensity tiers existed; 'transform'/'wild' always
  // force a different one). LOOK_JITTER_SCALE multiplies this function's own
  // pre-existing jitter formulas (0.28 spread / 0.2 grain / 0.25 vignette /
  // 0.5 bloom) rather than reusing intensity.js's generic rollNumeric, since
  // those formulas already predate the intensity system and 'remix' (scale
  // 1) must reproduce them BYTE-IDENTICALLY for every already-approved call
  // site that doesn't touch the new Intensity picker.
  const randomizeFx = useCallback(() => {
    const ids = Object.keys(FX_PRESETS);
    const nextSeed = lookSeed + 1;
    const rand = mulberry32(deriveSeed(nextSeed, 'look', 'randomize'));
    const intensity = randomizeIntensity;
    const scale = LOOK_JITTER_SCALE[intensity] ?? LOOK_JITTER_SCALE[DEFAULT_INTENSITY];
    const swapsLook = intensity !== 'refine';
    const id = swapsLook ? rollCategorical(rand, fxPresetId, ids, intensity) : fxPresetId;
    const baseFx = swapsLook && FX_PRESETS[id] ? { ...DEFAULT_FX, ...FX_PRESETS[id].fx } : fx;
    const spec = TREATMENTS[baseFx.treatment];
    const nextFx = { ...baseFx };
    let filmChanged = false;
    (spec?.params || []).forEach(([key, , min, max, step]) => {
      const spread = (max - min) * 0.28 * scale;
      const raw = Math.min(max, Math.max(min, baseFx[key] + (rand() * 2 - 1) * spread));
      const rounded = Math.round(raw / step) * step;
      if (rounded !== baseFx[key]) filmChanged = true;
      nextFx[key] = rounded;
    });
    const nextGrain = Math.min(1, Math.max(0, baseFx.grain + (rand() - 0.5) * 0.2 * scale));
    if (nextGrain !== baseFx.grain) filmChanged = true;
    nextFx.grain = nextGrain;
    const nextVignette = Math.min(1, Math.max(0, baseFx.vignette + (rand() - 0.5) * 0.25 * scale));
    if (nextVignette !== baseFx.vignette) filmChanged = true;
    nextFx.vignette = nextVignette;
    if (baseFx.bloom) {
      const nextBloom = Math.min(2, Math.max(0.1, baseFx.bloomStrength + (rand() - 0.5) * 0.5 * scale));
      if (nextBloom !== baseFx.bloomStrength) filmChanged = true;
      nextFx.bloomStrength = nextBloom;
    }
    const changed = [];
    if (swapsLook) changed.push('look');
    if (filmChanged) changed.push('film');
    applyLookMutation(() => {
      setLookSeed(nextSeed);
      if (swapsLook) applyFxPreset(id); // sets fx/mat/envId/envIntensity/bg/lights from the preset
      setFx(nextFx); // supersedes applyFxPreset's own setFx with the jittered values
      setFxPresetId(id);
    });
    setLookRandomizeReport(changed);
  }, [lookSeed, randomizeIntensity, fx, fxPresetId, applyFxPreset, applyLookMutation]);

  // ── Unified randomization scope control (Slice 1) — docs/plans/STUDIO-
  // ROADMAP-NEXT-PHASE-SONNET-HANDOFF.md. "Selected element"/"Elements
  // only"/"Look only" dispatch to the PRE-EXISTING, unchanged functions above
  // (randomizeSelectedElement/randomizeAllElementsHandler/randomizeFx) — this
  // control is an ADDITIONAL way to reach them, not a replacement; their own
  // dedicated buttons in the Elements/Effects cards keep working exactly as
  // before. The other 6 scopes are new this slice.
  //
  // Deliberate scope boundary: "Entire set"/"Unlocked values only" compose
  // Elements (randomizeAllElements) + Look colors (randomizeLookColors) +
  // Lighting (randomizeLighting) + Camera (randomizeCamera) — they do NOT
  // additionally run randomizeFx's own FX-treatment/preset-swap jitter. That
  // jitter depends on FX_PRESETS/LOOK_JITTER_SCALE and stays exclusively a
  // "Look only" action this slice, so as not to touch that already-approved,
  // tested code path's behavior as a side effect of a different scope.
  // lockAwareExtraInstances/stripLockOverride are defined earlier (alongside
  // canRandomizeAllElements/randomizeAllElementsHandler) — both that
  // pre-existing "All" button and every new scope below share the same fix.
  const runScopedRandomize = useCallback(() => {
    const intensity = randomizeIntensity;
    const nextElemSeed = sceneSeed + 1;
    const nextLookSeed = lookSeed + 1;
    const nextCamSeed = camSeed + 1;
    const deriveElemRand = (id) => mulberry32(deriveSeed(nextElemSeed, id, 'randomize'));
    const lookRand = mulberry32(deriveSeed(nextLookSeed, 'look', 'randomize'));
    const camRand = mulberry32(deriveSeed(nextCamSeed, 'camera', 'randomize'));

    if (randomizeScope === 'selected-element') {
      randomizeSelectedElement();
      setLastScopeDomains(['elements']);
      return;
    }
    if (randomizeScope === 'elements-only') {
      randomizeAllElementsHandler();
      setLastScopeDomains(['elements']);
      return;
    }
    if (randomizeScope === 'look-only') {
      randomizeFx();
      setLastScopeDomains(['look']);
      return;
    }
    if (randomizeScope === 'motion-only') {
      const { instances, changedById } = randomizeMotionOnly(lockAwareExtraInstances(), { primaryId: PRIMARY_ELEMENT_ID, intensity, deriveRand: deriveElemRand });
      applyElementMutation(() => { setSceneSeed(nextElemSeed); setExtraInstances(stripLockOverride(instances)); });
      setElementRandomizeReport(changedById);
      setLastScopeDomains(['elements']);
      return;
    }
    if (randomizeScope === 'colors-only') {
      const { instances, changedById } = randomizeElementColorsOnly(lockAwareExtraInstances(), { primaryId: PRIMARY_ELEMENT_ID, intensity, deriveRand: deriveElemRand });
      const lookColors = randomizeLookColors({ lightCans, bgColor, fx, mat }, { rand: lookRand, intensity });
      applyCrossScopeMutation(['elements', 'look'], () => {
        setSceneSeed(nextElemSeed);
        setExtraInstances(stripLockOverride(instances));
        setLookSeed(nextLookSeed);
        setLightCans(lookColors.lightCans);
        setBgColor(lookColors.bgColor);
        setFx(lookColors.fx);
        setMat(lookColors.mat);
        setFxPresetId(''); // hand-tweak invalidates the named preset — same convention as setFxKey/setMatKey
      });
      setElementRandomizeReport(changedById);
      setLookRandomizeReport(lookColors.changed);
      setLastScopeDomains(['elements', 'look']);
      return;
    }
    if (randomizeScope === 'lighting-only') {
      const result = randomizeLighting({ lightCans, envIntensity }, { rand: lookRand, intensity });
      applyLookMutation(() => {
        setLookSeed(nextLookSeed);
        setLightCans(result.lightCans);
        setEnvIntensity(result.envIntensity);
        setLightTemplate('');
      });
      setLookRandomizeReport(['lighting']);
      setLastScopeDomains(['look']);
      return;
    }
    if (randomizeScope === 'camera-only') {
      const result = randomizeCamera({ shotCam, diffusionCamera }, { rand: camRand, intensity });
      applyCamMutation(() => {
        setCamSeed(nextCamSeed);
        setShotCam(result.shotCam);
        setDiffusionCamera(result.diffusionCamera);
      });
      setCamRandomizeReport(result.changed);
      setLastScopeDomains(['camera']);
      return;
    }
    if (randomizeScope === 'entire-set' || randomizeScope === 'unlocked-only') {
      const { instances, changedById } = randomizeAllElements(lockAwareExtraInstances(), { primaryId: PRIMARY_ELEMENT_ID, intensity, deriveRand: deriveElemRand });
      const lightingResult = randomizeLighting({ lightCans, envIntensity }, { rand: lookRand, intensity });
      // Chained on purpose: a second, independent color re-roll on top of
      // lighting's own can-color roll — both functions legitimately touch
      // can color under their own declared contract; letting Colors run
      // second (deterministically, off the same seeded stream) is not a
      // double-roll bug, just this composed scope's own extra pass.
      const colorsResult = randomizeLookColors({ lightCans: lightingResult.lightCans, bgColor, fx, mat }, { rand: lookRand, intensity });
      const camResult = randomizeCamera({ shotCam, diffusionCamera }, { rand: camRand, intensity });
      applyCrossScopeMutation(['elements', 'look', 'camera'], () => {
        setSceneSeed(nextElemSeed);
        setExtraInstances(stripLockOverride(instances));
        setLookSeed(nextLookSeed);
        setLightCans(colorsResult.lightCans);
        setEnvIntensity(lightingResult.envIntensity);
        setBgColor(colorsResult.bgColor);
        setFx(colorsResult.fx);
        setMat(colorsResult.mat);
        setFxPresetId('');
        setLightTemplate('');
        setCamSeed(nextCamSeed);
        setShotCam(camResult.shotCam);
        setDiffusionCamera(camResult.diffusionCamera);
      });
      setElementRandomizeReport(changedById);
      setLookRandomizeReport([...new Set([...(colorsResult.changed || []), 'lighting'])]);
      setCamRandomizeReport(camResult.changed);
      setLockSkipReport(randomizeScope === 'unlocked-only'
        ? computeLockSkipReport(lockAwareExtraInstances(), { primaryId: PRIMARY_ELEMENT_ID, diffusionCameraLocked: Boolean(diffusionCamera.locked) })
        : null);
      setLastScopeDomains(['elements', 'look', 'camera']);
    }
  }, [
    randomizeScope, randomizeIntensity, sceneSeed, lookSeed, camSeed, extraInstances, lightCans, bgColor, fx, mat,
    envIntensity, shotCam, diffusionCamera, randomizeSelectedElement, randomizeAllElementsHandler, randomizeFx,
    applyElementMutation, applyLookMutation, applyCamMutation, applyCrossScopeMutation,
    lockAwareExtraInstances, stripLockOverride,
  ]);

  // The unified control's own Undo/Redo — routes to whichever underlying
  // stack `lastScopeDomains` says the last scoped-randomize actually used.
  // Each target undo/redo already no-ops safely on an empty stack, so this
  // stays correct even if called repeatedly past the available history.
  const undoLastScope = useCallback(() => {
    if (!lastScopeDomains) return;
    if (lastScopeDomains.length > 1) { undoCrossScope(); return; }
    if (lastScopeDomains[0] === 'elements') { undoElements(); return; }
    if (lastScopeDomains[0] === 'look') { undoLook(); return; }
    if (lastScopeDomains[0] === 'camera') { undoCam(); return; }
  }, [lastScopeDomains, undoCrossScope, undoElements, undoLook, undoCam]);

  const redoLastScope = useCallback(() => {
    if (!lastScopeDomains) return;
    if (lastScopeDomains.length > 1) { redoCrossScope(); return; }
    if (lastScopeDomains[0] === 'elements') { redoElements(); return; }
    if (lastScopeDomains[0] === 'look') { redoLook(); return; }
    if (lastScopeDomains[0] === 'camera') { redoCam(); return; }
  }, [lastScopeDomains, redoCrossScope, redoElements, redoLook, redoCam]);

  // ── Scene Templates ── (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md
  // "Template system" § Scene Template, Phase 5). LOCAL-only persistence —
  // see elements/templates.js's header for the exact deferred scope (no
  // Element/Look/Render preset kinds, no cloud/admin promotion yet).
  // captureSceneRecipe mirrors the settings-save effect's field list exactly
  // (same 29 keys, including both independent seeds) so "the same template +
  // seed recreates the same preview"
  // holds — a template is genuinely the same recipe the app itself persists
  // as your next-visit defaults, just named and saved on demand.
  const captureSceneRecipe = useCallback(() => ({
    perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, diffusionCamera, camSeed, hudOn, frameId, envId, fx, fxPresetId,
    clothShape, tshirtPrint, devicePrimary, clothAspect, artworkRatio, artworkId, bgMode, bgColor, bgFx, sceneId, sceneTweaks, envIntensity, videoSeconds, videoFormat,
    sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity,
    // Hero Text (Phase 1) — added additively; an OLD recipe/template simply
    // lacks this key, and applySceneRecipe below only applies it when
    // present (Array.isArray guard), so old recipes load unchanged.
    textLayers,
    // Capture Frame parity round: the live stage's aspect at capture time —
    // an active frame's crop COMPOSITION depends on the stage it is cut
    // from (computeFrameRect insets the crop into the live canvas), so a
    // deterministic server render must pin the aspect the user actually
    // composed against. Read fresh from the renderer at CALL time (worldRef
    // is a ref — deliberately not a dependency).
    stageAspect: (() => {
      const el = worldRef.current?.renderer?.domElement;
      return el && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 16 / 9;
    })(),
  }), [perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, diffusionCamera, camSeed, hudOn, frameId, envId, fx, fxPresetId, clothShape, tshirtPrint, devicePrimary, clothAspect, artworkRatio, artworkId, bgMode, bgColor, bgFx, sceneId, sceneTweaks, envIntensity, videoSeconds, videoFormat, sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity, textLayers]);

  // Applies a loaded recipe field-by-field, through the SAME validity guard
  // each field's own initial-load useState already uses (loadSavedDefaults
  // above) — a template is exactly as untrusted as a hand-edited localStorage
  // blob (it can be exported/imported as raw JSON), so every field falls
  // back to its CURRENT value rather than being applied blind. Not pushed
  // through either undo stack — loading a template is its own explicit,
  // named action, not a slider tweak; see this round's as-built notes for
  // why that's a deliberate scope line, not an oversight.
  const applySceneRecipe = useCallback((r) => {
    if (!r || typeof r !== 'object') return;
    if (PERF_LEVELS[r.perf]) setPerf(r.perf);
    if (r.mat && typeof r.mat === 'object') setMat(sanitizeMat(r.mat, mat, { finishes: FINISHES, presetIds: MATERIAL_PRESET_IDS }));
    if (r.phys && typeof r.phys === 'object') setPhys(sanitizePhys(r.phys, phys, { pinModeIds: PIN_MODE_IDS }));
    if (r.anim && typeof r.anim === 'object') setAnim(sanitizeAnim(r.anim, anim));
    if (r.cam && typeof r.cam === 'object') setCam(sanitizeCam(r.cam, cam));
    if (Array.isArray(r.lightCans) && r.lightCans.length === 4) setLightCans(sanitizeLightCans(r.lightCans, lightCans));
    if (LIGHT_TEMPLATES[r.lightTemplate] || r.lightTemplate === '') setLightTemplate(r.lightTemplate);
    if (r.glass && typeof r.glass === 'object') setGlass(sanitizeGlass(r.glass, glass));
    if (r.shotCam && typeof r.shotCam === 'object') setShotCam(sanitizeShotCam(r.shotCam, shotCam));
    if (r.diffusionCamera && typeof r.diffusionCamera === 'object') setDiffusionCamera(sanitizeDiffusionCamera(r.diffusionCamera, diffusionCamera));
    if (Number.isFinite(r.camSeed)) setCamSeed(r.camSeed);
    if (typeof r.hudOn === 'boolean') setHudOn(r.hudOn);
    if (FRAME_PRESETS[r.frameId]) setFrameId(r.frameId);
    if (ENV_PRESETS[r.envId]) setEnvId(r.envId);
    if (r.fx && typeof r.fx === 'object') setFx(sanitizeFx(r.fx, fx, { treatmentIds: Object.keys(TREATMENTS) }));
    if (FX_PRESETS[r.fxPresetId] || r.fxPresetId === '') setFxPresetId(r.fxPresetId);
    // CORRECTION (Codex review): a Scene Template saved BEFORE this round
    // (no r.clothShape field) can still carry a legacy `hanging-tshirt`
    // extraInstances entry — this recipe was previously handed straight to
    // restoreExtraInstances below, which left that entry as an inert
    // singleton (excluded from rendering by singleInstanceRenderer, but
    // never converted to the primary shape either). Same migration the
    // initial-mount path already runs, applied here too. An explicit
    // r.clothShape (a recipe saved BY this round or later) always wins
    // outright over a legacy-migration guess.
    const templateTshirtMigration = extractLegacyTshirtMigration(r.extraInstances);
    if (r.clothShape === 'sheet' || r.clothShape === 'tshirt' || r.clothShape === 'device') setClothShape(r.clothShape);
    else if (templateTshirtMigration.migrated) setClothShape('tshirt');
    if (r.devicePrimary && typeof r.devicePrimary === 'object') setDevicePrimary((prev) => ({ ...DEFAULT_DEVICE_PRIMARY, ...prev, ...r.devicePrimary }));
    if (r.tshirtPrint && typeof r.tshirtPrint === 'object') setTshirtPrint(sanitizeTshirtPrint(r.tshirtPrint, tshirtPrint));
    else if (templateTshirtMigration.migrated) setTshirtPrint((prev) => ({ ...prev, ...templateTshirtMigration.tshirtPrint }));
    if (CLOTH_ASPECTS[r.clothAspect] || r.clothAspect === 'auto') setClothAspect(r.clothAspect);
    if (r.artworkRatio == null || typeof r.artworkRatio === 'number') setArtworkRatio(r.artworkRatio ?? null);
    if (typeof r.artworkId === 'string' && r.artworkId) setArtworkId(r.artworkId);
    if (['scene', 'color', 'image', 'transparent'].includes(r.bgMode)) setBgMode(r.bgMode);
    if (r.bgFx && typeof r.bgFx === 'object') setBgFx((prev) => ({ ...DEFAULT_BG_FX, ...prev, ...r.bgFx }));
    if (r.sceneTweaks && typeof r.sceneTweaks === 'object') setSceneTweaks(r.sceneTweaks);
    if (isHexColor(r.bgColor)) setBgColor(r.bgColor);
    if (SCENE_PRESETS[r.sceneId]) setSceneId(r.sceneId);
    if (isFiniteNum(r.envIntensity)) setEnvIntensity(r.envIntensity);
    if (isFiniteNum(r.videoSeconds) && r.videoSeconds > 0) setVideoSeconds(r.videoSeconds);
    if (VIDEO_FORMATS[r.videoFormat]) setVideoFormat(r.videoFormat);
    if (Number.isFinite(r.sceneSeed)) setSceneSeed(r.sceneSeed);
    if (Number.isFinite(r.lookSeed)) setLookSeed(r.lookSeed);
    // extraInstances restored FIRST so elementLocks can be validated against
    // the ids this recipe actually restores — not whatever happens to be
    // live in the browser before loading (those are about to be replaced).
    // Uses templateTshirtMigration's already-stripped list (see above) —
    // NEVER r.extraInstances directly — so a legacy hanging-tshirt entry can
    // never survive a Scene Template load as a decorative singleton.
    const nextExtras = restoreExtraInstances(templateTshirtMigration.remainingExtraInstances, { primaryId: PRIMARY_ELEMENT_ID, maxCount: MAX_EXTRA_INSTANCES });
    setElementLocks(sanitizeElementLocks(r.elementLocks, [PRIMARY_ELEMENT_ID, ...nextExtras.map((i) => i.id)]));
    setExtraInstances(nextExtras);
    setSelectedElementId((cur) => normalizeSelection(cur, nextExtras, PRIMARY_ELEMENT_ID));
    if (PLACEMENT_FORMATS[r.elementFormatId]) setElementFormatId(r.elementFormatId);
    if (LIVE_PREVIEW_TIERS.includes(r.elementQualityTier)) setElementQualityTier(r.elementQualityTier);
    if (isValidIntensity(r.randomizeIntensity)) setRandomizeIntensity(r.randomizeIntensity);
    // Hero Text (Phase 1) — additive key, no else branch: an old recipe
    // saved before this key existed simply has no r.textLayers, so this
    // no-ops and the current textLayers stay exactly as they were (matches
    // every other "old recipe loads unchanged" field above).
    if (Array.isArray(r.textLayers)) setTextLayers(sanitizeTextLayers(r.textLayers, textLayers));
  }, [mat, phys, anim, cam, lightCans, glass, shotCam, diffusionCamera, fx, tshirtPrint, textLayers]);
  // Timeline (Phase 4) — keep the render-loop-readable ref current every
  // render (see its own declaration, near liveRef, for why this indirection
  // is necessary). Placed immediately after applySceneRecipe's definition,
  // not before — the assignment target must exist by the time this line
  // runs, but the REF ITSELF was already declared earlier in render order.
  applySceneRecipeRef.current = applySceneRecipe;

  // ── Hero Text — rail handlers (StudioHeroTextCard's exact prop contract).
  // Every mutation routes through sanitizeTextLayers so ids stay positionally
  // reassigned (txt-1..txt-N — see that function's own header for why this
  // is the single rule that handles add/remove/duplicate id bookkeeping) and
  // every field stays clamped, same "never let the UI construct an
  // out-of-bounds layer" discipline createTextLayer already documents.
  const canAddTextLayer = textLayers.length < MAX_TEXT_LAYERS;
  const addTextLayer = useCallback(() => {
    if (textLayers.length >= MAX_TEXT_LAYERS) return;
    const next = sanitizeTextLayers([...textLayers, createTextLayer(`txt-${textLayers.length + 1}`)], textLayers);
    setTextLayers(next);
    setSelectedTextLayerId(next[next.length - 1]?.id ?? null);
  }, [textLayers]);
  const removeTextLayer = useCallback((id) => {
    const next = sanitizeTextLayers(textLayers.filter((l) => l.id !== id), textLayers);
    setTextLayers(next);
    setSelectedTextLayerId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
  }, [textLayers]);
  const duplicateTextLayer = useCallback((id) => {
    if (textLayers.length >= MAX_TEXT_LAYERS) return;
    const source = textLayers.find((l) => l.id === id);
    if (!source) return;
    const { id: _sourceId, ...rest } = source;
    const next = sanitizeTextLayers(
      [...textLayers, createTextLayer(`txt-${textLayers.length + 1}`, { ...rest, text: `${rest.text} copy`.slice(0, 400) })],
      textLayers
    );
    setTextLayers(next);
    setSelectedTextLayerId(next[next.length - 1]?.id ?? null);
  }, [textLayers]);
  const selectTextLayer = useCallback((id) => setSelectedTextLayerId(id), []);
  // sanitizeTextLayer does NOT attach `id` (that's sanitizeTextLayers'/
  // createTextLayer's job, per its own header) — re-attached explicitly
  // here so a field edit can never drop the layer's own id.
  const changeTextLayer = useCallback((id, partial) => {
    setTextLayers((prev) => prev.map((l) => (l.id === id ? { id: l.id, ...sanitizeTextLayer({ ...l, ...partial }, l) } : l)));
  }, []);
  // Hero Text Phase 2 — layout presets (StudioHeroTextCard's LAYOUTS row,
  // onApplyLayoutPreset prop). Applying one REPLACES every current layer
  // with that preset's authored set (see HERO_LAYOUT_PRESETS' own header in
  // text-layers.js for why this is a full replace, not a per-field merge
  // onto the existing layers) — routed through the SAME sanitizeTextLayers
  // gate every other mutation above uses, so ids are reassigned positionally
  // and every field stays clamped exactly as if hand-authored. `fallback:
  // []` (not `textLayers`) is deliberate: an invalid preset field must fall
  // back to DEFAULT_TEXT_LAYER, never leak a value from the layers being
  // replaced. Selects the first new layer, same "just-created content
  // becomes the selection" precedent addTextLayer/duplicateTextLayer above
  // already follow.
  const applyHeroLayoutPreset = useCallback((presetId) => {
    const preset = HERO_LAYOUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const next = sanitizeTextLayers(preset.layers, []);
    setTextLayers(next);
    setSelectedTextLayerId(next[0]?.id ?? null);
  }, []);

  // Hero Text Phase 3 — "Preview in/out" (StudioHeroTextCard's
  // onPreviewAnim prop). Previews EVERY enabled (`.on`) layer's in/out
  // together, matching how exportVideo brackets every layer under one
  // shared clock (there is no per-layer clock — see world.textAnimClock's
  // own header). Duration = the handoff's literal formula: the SLOWEST
  // enabled layer's own (delay+inDur), plus a 1.2s hold so a fast layer's
  // "in" is actually visible before anything starts easing out, plus that
  // SAME slowest layer's outDur — every layer's out-window then lands in
  // the final outDur seconds of that shared span (computeTextAnimState's
  // "out window anchored to tEnd" contract), so layers with different
  // outDur values still all finish exactly at tEnd.
  const previewTextAnim = useCallback(() => {
    const world = worldRef.current;
    // Never previewed while an export recording owns the SAME shared
    // clock — see exportVideo's own "bracket the whole capture" comment;
    // stomping it here would corrupt the capture's in/out timing. Timeline
    // playback/scrub owns the SAME clock too (per-boundary retriggering,
    // stepTimelinePlayback module scope above) — never stomped by a manual
    // Preview click either, same reasoning.
    if (!world || recording || (world.timelineClock && world.timelineClock.mode !== 'idle')) return;
    const enabled = textLayers.filter((l) => l.on);
    if (!enabled.length) return;
    const duration = enabled.reduce((max, l) => Math.max(max, l.anim.delay + l.anim.inDur + 1.2 + l.anim.outDur), 0);
    if (!(duration > 0)) return;
    const now = world.clock.elapsedTime;
    if (world.textPreviewTimeout) { clearTimeout(world.textPreviewTimeout); world.textPreviewTimeout = null; }
    world.textAnimClock = { mode: 'preview', tStart: now, tEnd: now + duration };
    world.textPreviewTimeout = setTimeout(() => {
      world.textAnimClock = { mode: 'idle', tStart: 0, tEnd: null };
      world.textPreviewTimeout = null;
    }, duration * 1000);
  }, [textLayers, recording]);

  // ── Timeline v2 — handlers (StudioTimelineStrip's prop contract).
  // Every mutation except retimeKeyframe routes through sanitizeTimeline,
  // same "never let the UI construct an out-of-bounds keyframe" discipline
  // the Hero Text handlers above use via sanitizeTextLayers — retimeKeyframe
  // deliberately bypasses it (see that handler's own comment for why).

  // Adds a keyframe at track position `atU` (StudioTimelineCard's track:
  // double-click/tap empty space) or, with no argument, at the CURRENT
  // playhead (a plain "Add Keyframe" button) — same dual-signature contract
  // page.jsx's own addKeyAt/UI split covers with two call sites into one
  // function. Nudges off an existing keyframe at (nearly) the same spot so
  // both stay independently grabbable (page.jsx's own addKeyAt rule).
  const addKeyframe = useCallback((atU) => {
    const world = worldRef.current;
    if (timeline.keyframes.length >= MAX_TIMELINE_KEYFRAMES) return;
    let kt = Number.isFinite(atU) ? Math.min(1, Math.max(0, atU)) : scrubU;
    while (timeline.keyframes.some((k) => Math.abs(k.t - kt) < 0.01)) kt = Math.min(1, kt + 0.03);
    const raw = { name: `Shot ${timeline.keyframes.length + 1}`, t: kt, recipe: captureSceneRecipe(), orbitPose: captureOrbitPose(world) };
    const next = sanitizeTimeline({ keyframes: [...timeline.keyframes, raw], totalSeconds: timeline.totalSeconds, loop: timeline.loop }, timeline);
    setTimeline(next);
    // sanitizeTimeline sorts by `t` and reassigns ids positionally — find
    // the just-added keyframe by whichever landed closest to `kt` (its own
    // t, nudged-and-all) rather than assuming it's still last in the array.
    const added = next.keyframes.reduce((best, k) => (
      !best || Math.abs(k.t - kt) < Math.abs(best.t - kt) ? k : best
    ), null);
    setSelectedKeyframeId(added?.id ?? null);
  }, [timeline, captureSceneRecipe, scrubU]);

  const deleteKeyframe = useCallback((id) => {
    const next = sanitizeTimeline({ keyframes: timeline.keyframes.filter((k) => k.id !== id), totalSeconds: timeline.totalSeconds, loop: timeline.loop }, timeline);
    setTimeline(next);
    setSelectedKeyframeId((cur) => (cur === id ? (next.keyframes[0]?.id ?? null) : cur));
  }, [timeline]);

  // Drags a keyframe marker to a new track position. Deliberately bypasses
  // sanitizeTimeline (a plain clamped in-place `t` update instead) —
  // sanitizeTimeline re-sorts by `t` AND reassigns EVERY id positionally
  // ('kf-1'..'kf-N'), which would change the DRAGGED keyframe's own id
  // mid-gesture the instant it crosses a neighbor, breaking the track's
  // id-based drag tracking (StudioTimelineCard's dragRef.current.keyId,
  // captured once at pointerdown — the same id-stable-through-a-drag model
  // page.jsx's own onTrackPointerMove relies on). The array can end up out
  // of t-sorted order after a cross-over drag; every OTHER read of
  // `timeline.keyframes` in this file is already robust to that
  // (resolveTrackState sorts internally; Reset/Export explicitly re-sort
  // before picking "the first keyframe" — see their own comments) — the
  // next non-drag mutation (add/delete/rename/re-capture) runs the full
  // sanitizer as normal and settles the array back into canonical
  // sorted/renumbered form.
  const retimeKeyframe = useCallback((id, t) => {
    const clamped = Math.min(1, Math.max(0, Number(t)));
    if (!Number.isFinite(clamped)) return;
    setTimeline((prev) => ({ ...prev, keyframes: prev.keyframes.map((k) => (k.id === id ? { ...k, t: clamped } : k)) }));
  }, []);

  // renameKeyframe / recaptureKeyframe removed with the strip's selected-
  // keyframe editor row (owner direction, 2026-08-01 — "just add and remove
  // frames"): shots keep their auto "Shot N" names, and updating a shot is
  // delete + re-add. Restore from git history if a shot editor returns.

  const setTimelineLoop = useCallback((loop) => {
    setTimeline((prev) => ({ ...prev, loop: Boolean(loop) }));
  }, []);

  // Clear — wipes every keyframe (strip's Clear transport button). Duration/
  // loop settings survive; only the shots go. Selection cleared with them.
  const clearTimelineKeyframes = useCallback(() => {
    setTimeline((prev) => ({ ...prev, keyframes: [] }));
    setSelectedKeyframeId(null);
    setStatus('Timeline cleared — all keyframes removed.');
  }, []);

  // Camera templates (Mockup Video's 13 authored moves, ported — see
  // camera-templates.js). Applying one REPLACES the timeline's keyframes
  // with the template's orbit ride over a single snapshot of the CURRENT
  // scene (so only the camera animates), adopts the template's own
  // duration, and forces the orbit camera (shot cam off in the snapshot —
  // orbit is what the keyframed poses drive).
  const applyCameraTemplate = useCallback((templateId) => {
    const snapshot = captureSceneRecipe();
    const recipe = { ...snapshot, shotCam: { ...snapshot.shotCam, use: false } };
    const built = buildCameraTemplateTimeline(templateId, recipe);
    if (!built) return;
    setTimeline((prev) => sanitizeTimeline({ keyframes: built.keyframes, totalSeconds: built.totalSeconds, loop: prev.loop }, prev));
    setSelectedKeyframeId(null);
    if (shotCam.use) setShotKey('use', false);
    setStatus(`Camera move applied: ${built.label} (${built.totalSeconds}s) — press Play.`);
  }, [captureSceneRecipe, shotCam.use, setShotKey]);

  // ── Shared device-screen capture fetch (Interrupted export recovery,
  // Phase A) ───────────────────────────────────────────────────────────────
  // The ONE asynchronous preparation step used by BOTH the Quick Export
  // guard below (case D of runExportWithLiveGuard) AND the cloud pin path
  // (pinDeviceScreenIfNeeded's own case D) whenever a device screen is
  // live/liveUrl with no capture yet. Plain fetch — deliberately NOT
  // authedFetch — the capture route is public (same as DeviceScreenControl's
  // own Capture button; HOLO PAPER is a public tool, owner decision
  // 2026-07-31); its own quota/SSRF guardrails are the protection. Reuses
  // the route's normal 24h cache (never `refresh: true`) so an automatic
  // export-time capture never pays for a fresh capture the Capture button
  // would have served free. Resolves the same-origin `imageUrl` string on
  // success; throws an actionable Error on any failure (network, quota,
  // SSRF-rejected URL) — the caller decides how to surface it, but nothing
  // renderer/stream/recorder/pin-side may start before this resolves.
  const captureDeviceScreenForExport = useCallback(async ({ url, viewport }) => {
    if (!url) throw new Error('No live website URL is set — enter one under Go Live, then try again.');
    let res;
    try {
      res = await fetch('/api/public/studio-device-capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, viewport: viewport || 'desktop' }),
      });
    } catch (err) {
      throw new Error(`Could not reach the capture service: ${String(err?.message || err)}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || `Website capture failed (${res.status}).`);
    return data.imageUrl;
  }, []);

  // ── Live-resume glue (Recovery round 2, Defect 1's secondary
  // contributor) ─────────────────────────────────────────────────────────
  // runExportWithLiveGuard below stashes `world.pendingLiveResume` (a plain
  // mutable flag, same pattern as world.exportCancelRequested) whenever it
  // pauses Live for an export attempt — {liveUrl,
  // captureUrlAtPause, uploadAssetIdAtPause}, the exact snapshot needed to
  // both resume to the right URL and detect "did the user change the
  // screen source mid-export" (source-change detection is a state
  // COMPARISON, not a value the pure decision needs re-derived). This is
  // consumed exactly once per attempt by resumeLiveAfterExport, called from
  // every place an export attempt actually settles: exportPng's readback
  // (both the framed and plain toBlob callbacks) and exportVideo's
  // cleanup() (which the export lifecycle itself documents as running on
  // EVERY exit path — success, cancel, and every failure) plus the two
  // narrow exit points before cleanup() would ever run (no supported mime;
  // the outer unexpected-failure backstop). Calling it when nothing is
  // pending is a safe no-op (world.pendingLiveResume is null), so it is
  // cheap to call defensively at every settle point rather than track
  // "did this specific attempt actually pause Live" at each call site.
  // The DECISION itself (shouldResumeLiveAfterExport, elements/
  // video-export.js) is pure/unit-tested; this function is the untestable
  // glue around it — reading worldRef.current and calling setDevicePrimary
  // with the freshest state via the updater form, so it never closes over
  // a stale devicePrimary even though this callback has an empty dep array.
  const resumeLiveAfterExport = useCallback(() => {
    const world = worldRef.current;
    const pending = world?.pendingLiveResume ?? null;
    if (world) world.pendingLiveResume = null; // consume exactly once, resumed or not
    if (!pending) return;
    setDevicePrimary((d) => (
      shouldResumeLiveAfterExport({
        mounted: Boolean(worldRef.current), pending,
        currentCaptureUrl: d.captureUrl, currentUploadAssetId: d.uploadAssetId, currentLive: d.live,
      })
        ? { ...d, live: true, liveUrl: pending.liveUrl }
        : d
    ));
  }, []);

  // ── Export guard for the LIVE device screen ────────────────────────────
  // The live screen is real DOM composited BEHIND the canvas through an
  // alpha-0 hole — no browser API can rasterize it into the WebGL frame, so
  // every export (PNG and both video paths) records a transparent hole
  // where the site is. Owner hit this live ("the live site isn't exporting
  // to the downloaded file"), so exports now degrade honestly: pause Live,
  // let the textured screen (the captured site if one exists, else the
  // placeholder) swap back in, THEN start the export.
  //
  // Recovery round 2 (Defect 1's secondary contributor): Live used to be
  // deliberately left paused forever ("press Go Live to resume" — the
  // stale claim this comment used to make), which independently reads as
  // "the live URL fell off" even when the capture itself was correct. Live
  // now resumes automatically once the export attempt actually SETTLES —
  // see resumeLiveAfterExport above, called from exportPng's readback and
  // exportVideo's cleanup() (which runs on every exit path: success,
  // cancel, and every failure) — unless the user changed the screen source
  // themselves mid-export, or the component unmounted.
  // Go Live export-safety round (replaces the fixed-1400ms-timer guard —
  // a timing guess, not a readiness contract; the observed failure seam):
  // decision logic + readiness predicate live in elements/video-export.js
  // (evaluateLiveExportGuard / isLiveTeardownReady, pure + unit-tested).
  //   - No captured screen → auto-obtain one through the SAME same-origin
  //     capture route the Capture button uses (captureDeviceScreenForExport
  //     above), with visible progress on the status line — before anything
  //     renderer/stream/recorder-side is touched. Only on success does the
  //     export fall into the await-readiness path below; on failure it stops
  //     cleanly with an actionable message and Live is left exactly as it
  //     was. Never a silent placeholder export when the user meant a
  //     website, and never a hard block now that the capture is obtainable
  //     automatically.
  //   - Capture exists (already, or just obtained) → pause Live, then start
  //     ONLY on the explicit readiness signal: iframe removed
  //     (world.deviceLive === null), alpha-punch material restored to the
  //     factory's textured material, captured texture applied as the live
  //     screen map, and ≥1 frame COMMITTED with that state (world.renderTick
  //     — real render frames, never wall time). A bounded deadline exists
  //     only as a FAILURE exit (clean, actionable message, nothing started)
  //     — correctness never depends on elapsed time.
  const awaitLiveScreenTeardownThenRun = useCallback((fn) => {
    const deadline = performance.now() + 8000; // failure exit only — never a start trigger
    let restoredAtTick = null;
    const poll = () => {
      const w = worldRef.current;
      if (!w) return; // unmounted — nothing to clean up; nothing was started
      const ud = w.devicePrimaryEntry?.object?.userData;
      const deviceLiveGone = !w.deviceLive;
      const screenMaterialRestored = Boolean(ud?.screenMesh && ud?.screenMaterial && ud.screenMesh.material === ud.screenMaterial);
      const capturedTextureApplied = Boolean(ud?.screenCaptureTexture && ud?.screenMaterial && ud.screenMaterial.map === ud.screenCaptureTexture);
      if (deviceLiveGone && screenMaterialRestored && capturedTextureApplied) {
        if (restoredAtTick === null) restoredAtTick = w.renderTick || 0;
        if (isLiveTeardownReady({
          deviceLiveGone, screenMaterialRestored, capturedTextureApplied,
          framesSinceRestored: (w.renderTick || 0) - restoredAtTick,
        })) { fn(); return; }
      } else {
        restoredAtTick = null; // a signal regressed (e.g. capture re-load) — wait for ALL of them again
      }
      if (performance.now() > deadline) {
        // Export-restore Phase 1 made this proceed UNCONDITIONALLY ("recording
        // something beats recording nothing"). Phase 5 makes it a decision
        // (evaluateLiveTeardownDeadline, elements/video-export.js — pure and
        // unit-tested): proceeding is right for a scene with nothing wrong on
        // screen, and wrong for the two states this actually lands in — a
        // still-live iframe (records a transparent hole; a device that fills
        // the frame becomes a blank file) or an unloadable/unapplied screen
        // capture (records the procedural placeholder site, the reported
        // "it records an example domain"). See that function's own header for
        // why it stops rather than spending another unrefunded browserless
        // capture.
        const appearance = w.devicePrimaryEntry?.instance?.appearance;
        const verdict = evaluateLiveTeardownDeadline({
          deviceLiveGone, screenMaterialRestored, capturedTextureApplied,
          wantsCapturedScreen: Boolean(appearance?.captureUrl || appearance?.uploadAssetId),
          screenCaptureError: ud?.screenCaptureError || null,
        });
        console.warn('[holocloth] live-teardown deadline reached', {
          action: verdict.action, deviceLiveGone, screenMaterialRestored, capturedTextureApplied,
          screenCaptureError: ud?.screenCaptureError || null,
        });
        setStatus(verdict.message);
        if (verdict.action === 'stop') {
          // Nothing downstream will run, so this is the only place left that
          // can hand Live back — fn() (exportVideo's cleanup()/exportPng's
          // readback) is what normally consumes world.pendingLiveResume.
          resumeLiveAfterExport();
          return;
        }
        // 'proceed' — Live is deliberately NOT resumed here: fn() already
        // calls resumeLiveAfterExport once IT settles, and resuming now would
        // flip Live back on while fn() is still recording.
        fn();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }, [resumeLiveAfterExport]);

  const runExportWithLiveGuard = useCallback((fn) => {
    const verdict = evaluateLiveExportGuard({
      clothShape, live: devicePrimary.live, liveUrl: devicePrimary.liveUrl, captureUrl: devicePrimary.captureUrl,
      captureSourceUrl: devicePrimary.captureSourceUrl, captureViewport: devicePrimary.captureViewport,
      viewport: devicePrimary.viewport,
    });
    if (verdict.action === 'proceed') { fn(); return; }
    setStatus(verdict.message);

    // Pauses Live for THIS attempt: records the resume snapshot, flips the
    // React flag, and tears the CSS3D iframe down SYNCHRONOUSLY. The
    // imperative teardown is the point (export-restore Phase 5) — setting
    // `live:false` only schedules a React commit, and until that commit runs
    // world.deviceLive is still non-null, which makes the render loop punch
    // the alpha hole into every frame the recorder samples. Never rely on
    // the effect (or a timer) to have got there first.
    const pauseLiveForExport = (captureUrlAtPause, extraDeviceFields) => {
      const world = worldRef.current;
      if (world) {
        world.pendingLiveResume = {
          liveUrl: devicePrimary.liveUrl, captureUrlAtPause, uploadAssetIdAtPause: devicePrimary.uploadAssetId,
        };
      }
      setDevicePrimary((d) => ({ ...d, ...extraDeviceFields, live: false }));
      setDeviceInteract(false);
      teardownLiveScreenNow(world);
    };

    if (verdict.action === 'capture-then-await') {
      // Case D (the gap) — obtain a capture BEFORE anything export-side is
      // touched. Only on success does Live actually stop and the
      // teardown-wait begin; a failure here leaves Live running exactly as
      // it was, same as the old hard block's "nothing was touched" contract.
      // Phase 7: the ONLY long wait in this whole path, and until now a
      // completely silent one. Held for exactly the fetch's lifetime — every
      // settle path below clears it — so the status line ticks and every
      // export control reads as busy instead of ignored.
      setLiveCapturePrep({ url: devicePrimary.liveUrl, startedAt: performance.now() });
      captureDeviceScreenForExport({ url: devicePrimary.liveUrl, viewport: devicePrimary.viewport })
        .then((captureUrl) => {
          setLiveCapturePrep(null);
          setStatus('Website captured — switching the device screen over and starting the export…');
          // One write — carries the fresh capture's own provenance (Defect
          // 1's fix) alongside pausing Live.
          pauseLiveForExport(captureUrl, {
            captureUrl, captureSourceUrl: devicePrimary.liveUrl, captureViewport: devicePrimary.viewport,
          });
          awaitLiveScreenTeardownThenRun(fn);
        })
        .catch((err) => {
          setLiveCapturePrep(null);
          // Export-restore Phase 1 made this proceed unconditionally. That was
          // the worst possible response for THIS branch specifically: it is
          // the one path that never paused Live, so `fn()` ran with the CSS3D
          // iframe still up and recorded a transparent alpha hole — a blank
          // file whenever the device fills the frame.
          //
          // Phase 5 stops instead. Reaching this branch at all means the
          // guard found no capture it could trust of the CURRENT live URL —
          // either none at all, one of a DIFFERENT site, or (Phase 6) one
          // that cannot prove what site it is of. Every remaining thing on
          // screen is knowingly wrong: the unrecordable live iframe, a
          // capture of a different site, or the procedural placeholder.
          // Recording any of them is the "it lost my live URL" report, not a
          // fix for it. Live was never paused here, so there is nothing to
          // resume — the old hard block's "nothing was touched" contract,
          // restored.
          const reason = err?.message || 'Could not capture the website for export';
          // Phase 6: name the mismatch in BOTH shapes it comes in — a capture
          // that records a different source URL, and one carrying no
          // provenance at all (the real saved-scene shape that exported
          // example.com while Go Live pointed at the user's own site).
          const stale = !devicePrimary.captureUrl
            ? ''
            : devicePrimary.captureSourceUrl
              ? ` The capture already on the device is of ${devicePrimary.captureSourceUrl}, not ${devicePrimary.liveUrl} — turn Go Live off if you meant to export that one.`
              : ` The capture already on the device doesn't record which site it is of, so it can't be trusted to be ${devicePrimary.liveUrl} — re-run CAPTURE to replace it.`;
          console.warn('[holocloth] export aborted', {
            reason: 'device-screen-capture-failed', error: reason,
            hasStaleCapture: Boolean(devicePrimary.captureUrl),
          });
          setStatus(`${reason} — nothing was exported. A live website can't be recorded directly, and there is no trustworthy capture of it to record instead.${stale} Run CAPTURE under Go Live, or turn on "Skip live-screen prep" to record the screen exactly as it is.`);
        });
      return;
    }

    // 'await-readiness' — a capture already exists (and, per the guard's
    // provenance check above, is genuinely OF this live URL/viewport);
    // pause Live and watch the REAL teardown signals.
    pauseLiveForExport(devicePrimary.captureUrl);
    awaitLiveScreenTeardownThenRun(fn);
  }, [clothShape, devicePrimary.live, devicePrimary.liveUrl, devicePrimary.captureUrl, devicePrimary.captureSourceUrl, devicePrimary.captureViewport, devicePrimary.viewport, devicePrimary.uploadAssetId, captureDeviceScreenForExport, awaitLiveScreenTeardownThenRun]);

  const setTimelineTotalSeconds = useCallback((s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return;
    setTimeline((prev) => sanitizeTimeline({ ...prev, totalSeconds: n }, prev));
  }, []);

  // Moves the playhead to `u` (0..1) — the ONLY thing a scrub does is set
  // world.scrubRequest for the next render-loop frame to consume (see
  // stepTimelinePlayback's own header); no per-frame setState. Ignored
  // while a transport mode is active (track editing/scrubbing is locked
  // while playing, matching page.jsx's own scrubTo).
  const scrubTimelineTo = useCallback((u) => {
    if (timelineMode !== 'idle') return;
    const world = worldRef.current;
    if (!world) return;
    const clamped = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0));
    setScrubU(clamped);
    world.scrubRequest = clamped;
  }, [timelineMode]);

  // STOP — freezes the CURRENT interpolated look (world.timelineOverride
  // already holds it) rather than snapping back to either endpoint
  // keyframe, so nothing visually jumps the instant Stop is pressed; the
  // playhead stays wherever playback had reached. Restores
  // controls.enabled from the LANDED pair's own shotCam.use (not
  // unconditionally true) so a stop mid-shot-cam-shot doesn't spuriously
  // re-enable orbit dragging of the (unrendered) orbit camera.
  const stopTimeline = useCallback(() => {
    const world = worldRef.current;
    if (world) {
      const clock = world.timelineClock;
      const u = Number.isFinite(clock?.lastU) ? clock.lastU : scrubU;
      world.timelineClock = {
        mode: 'idle', startedAt: 0, startU: 0, lastU: u,
        lastFromIndex: clock?.lastFromIndex ?? null, lastTextLayersKey: clock?.lastTextLayersKey ?? null,
      };
      if (world.controls) world.controls.enabled = !(world.timelineOverride?.shotCam?.use);
      setScrubU(u);
    }
    setTimelineMode('idle');
  }, [scrubU]);

  // PLAY — from the current playhead (wraps to 0 once fully played through),
  // once through the track. Honors the persisted `timeline.loop` preference
  // (loops if set) — the ONLY way to loop from the strip now; the strip's
  // own transport is Play/Stop/Reset (page.jsx-parity button set), with no
  // separate "loop right now" shortcut. (A previous round ported page.jsx's
  // extra explicit-loop button as `loopTimeline`; it was removed once the
  // transport was corrected to page.jsx's actual Play/Stop/Reset set — the
  // persisted loop preference toggle, now IN the strip next to the duration
  // field via `onLoopToggle`/`setTimelineLoop`, is the only loop control.) No
  // pre-application of any keyframe's recipe is needed — the render loop's
  // own first-frame discrete-cut (lastFromIndex seeded null) self-corrects
  // the scene to the landed pair within one frame regardless of what was on
  // screen when Play was pressed.
  const playTimeline = useCallback(() => {
    const world = worldRef.current;
    if (!world || recording || timelineMode !== 'idle' || !timeline.keyframes.length) return;
    const startU = scrubU >= 0.999 ? 0 : scrubU;
    const mode = timeline.loop ? 'looping' : 'playing';
    world.timelineClock = { mode, startedAt: world.clock.elapsedTime, startU, timeline, lastU: startU, lastFromIndex: null, lastTextLayersKey: null };
    world.timelineOverride = null;
    if (world.controls) world.controls.enabled = false;
    setTimelineMode(mode);
  }, [recording, timelineMode, timeline, scrubU]);

  // RESET — stop (if playing) + playhead to 0 + deterministically land the
  // FIRST keyframe BY TRACK POSITION (not array position — see
  // retimeKeyframe's own comment for why the array can be out of t-sorted
  // order) and its orbit pose (when the shot isn't using the cinematic shot
  // camera).
  const resetTimeline = useCallback(() => {
    const world = worldRef.current;
    if (world) {
      world.timelineClock = { mode: 'idle', startedAt: 0, startU: 0, lastU: 0, lastFromIndex: null, lastTextLayersKey: null };
      world.scrubRequest = null;
      world.timelineOverride = null;
      const kf0 = timeline.keyframes.length ? timeline.keyframes.slice().sort((a, b) => a.t - b.t)[0] : null;
      if (kf0) {
        applySceneRecipe(kf0.recipe);
        if (kf0.orbitPose && !kf0.recipe?.shotCam?.use && world.camera && world.controls) {
          world.camera.position.set(kf0.orbitPose.px, kf0.orbitPose.py, kf0.orbitPose.pz);
          world.controls.target.set(kf0.orbitPose.tx, kf0.orbitPose.ty, kf0.orbitPose.tz);
        }
      }
      if (world.controls) world.controls.enabled = kf0 ? !(kf0.recipe?.shotCam?.use) : true;
    }
    setScrubU(0);
    setTimelineMode('idle');
  }, [timeline, applySceneRecipe]);

  // Mirrors world.timelineClock's mode/lastU back into React at ~10Hz
  // (setInterval, not a per-frame setState — a playing/looping/scrubbing
  // timeline advances every rAF frame purely inside the render loop; this
  // poll is only for the playhead ball's visual position + the transport
  // buttons' enabled state) while any transport mode is active. Natural
  // completion (Play, non-loop) flips world.timelineClock.mode back to
  // 'idle' from INSIDE the render loop (stepTimelinePlayback, module scope
  // above) — that write can't call React's setTimelineMode directly (loop()
  // is a mount-once closure; see applySceneRecipeRef's own comment for why
  // threading a fresh setState call in there is the wrong shape for this).
  // This poll is how that eventually reaches the UI, the same "cheap
  // setInterval, only while relevant" precedent exportVideo's own
  // recordingProgress timer already uses.
  useEffect(() => {
    if (timelineMode === 'idle') return undefined;
    const id = setInterval(() => {
      const world = worldRef.current;
      const clock = world?.timelineClock;
      if (!clock) return;
      if (Number.isFinite(clock.lastU)) setScrubU(clock.lastU);
      if (clock.mode === 'idle') setTimelineMode('idle');
    }, 100);
    return () => clearInterval(id);
  }, [timelineMode]);

  const saveCurrentAsTemplate = useCallback(() => {
    const now = Date.now();
    const t = createSceneTemplate(sceneTemplates, { name: templateNameDraft, recipe: captureSceneRecipe(), now });
    setSceneTemplates((prev) => addTemplate(prev, t));
    setTemplateNameDraft('');
    setTemplateStatus(`Saved "${t.name}".`);
  }, [sceneTemplates, templateNameDraft, captureSceneRecipe]);

  const loadTemplateById = useCallback((id) => {
    const t = findTemplate(sceneTemplates, id);
    if (!t) return;
    applySceneRecipe(t.recipe);
    setTemplateStatus(`Loaded "${t.name}".`);
  }, [sceneTemplates, applySceneRecipe]);

  const renameTemplateById = useCallback((id, name) => {
    setSceneTemplates((prev) => renameTemplate(prev, id, name, Date.now()));
  }, []);

  const resaveTemplateById = useCallback((id) => {
    const t = findTemplate(sceneTemplates, id);
    if (!t) return;
    setSceneTemplates((prev) => updateTemplateRecipe(prev, id, captureSceneRecipe(), Date.now()));
    setTemplateStatus(`Updated "${t.name}" with the current scene.`);
  }, [sceneTemplates, captureSceneRecipe]);

  const duplicateTemplateById = useCallback((id) => {
    setSceneTemplates((prev) => duplicateTemplate(prev, id, Date.now()));
  }, []);

  const archiveTemplateById = useCallback((id) => {
    setSceneTemplates((prev) => archiveTemplate(prev, id, Date.now()));
  }, []);

  const unarchiveTemplateById = useCallback((id) => {
    setSceneTemplates((prev) => unarchiveTemplate(prev, id, Date.now()));
  }, []);

  const exportTemplateById = useCallback((id) => {
    const t = findTemplate(sceneTemplates, id);
    if (!t || typeof window === 'undefined') return;
    const blob = new Blob([exportTemplateJSON(t)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.name.replace(/[^a-z0-9-_]+/gi, '-') || 'scene-template'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sceneTemplates]);

  const importTemplateFromJSON = useCallback((json) => {
    const { list, error } = importTemplateJSON(sceneTemplates, json, Date.now());
    if (error) { setTemplateStatus(error); return; }
    setSceneTemplates(list);
    setTemplateStatus('Imported.');
  }, [sceneTemplates]);

  // ── Master Save — one-click versions of the COMPLETE state. The recipe is
  // captureSceneRecipe() PLUS the one field it deliberately omits: timeline
  // (a keyframe's recipe IS a scene recipe — nesting timeline into
  // captureSceneRecipe would recurse; a master recipe is never itself stored
  // inside a keyframe, so composing at THIS level terminates). Apply
  // re-validates everything: applySceneRecipe field-by-field, timeline
  // through sanitizeTimeline. A recipe saved before the export-resolution
  // tier was removed may still carry `exportResolutionTier` — accepted and
  // silently ignored (never read below), so an existing save still applies
  // cleanly. ──
  const captureMasterRecipe = useCallback(() => ({
    ...captureSceneRecipe(), timeline,
  }), [captureSceneRecipe, timeline]);

  const applyMasterRecipe = useCallback((r) => {
    if (!r || typeof r !== 'object') return;
    stopTimeline(); // never swap the keyframe track under a live playback clock
    applySceneRecipe(r);
    if (r.timeline && typeof r.timeline === 'object') setTimeline(sanitizeTimeline(r.timeline, timeline));
  }, [applySceneRecipe, stopTimeline, timeline]);

  const saveMasterVersion = useCallback(() => {
    const s = createMasterSave(masterSaves, { name: masterSaveNameDraft, recipe: captureMasterRecipe(), now: Date.now() });
    setMasterSaves((prev) => addMasterSave(prev, s));
    setMasterSaveNameDraft('');
    setMasterSaveStatus(`Saved "${s.name}".`);
  }, [masterSaves, masterSaveNameDraft, captureMasterRecipe]);

  const loadMasterVersionById = useCallback((id) => {
    const s = findTemplate(masterSaves, id);
    if (!s) return;
    applyMasterRecipe(s.recipe);
    setMasterSaveStatus(`Loaded "${s.name}".`);
  }, [masterSaves, applyMasterRecipe]);

  const overwriteMasterVersionById = useCallback((id) => {
    const s = findTemplate(masterSaves, id);
    if (!s) return;
    setMasterSaves((prev) => updateTemplateRecipe(prev, id, captureMasterRecipe(), Date.now()));
    setMasterSaveStatus(`Updated "${s.name}" with the current settings.`);
  }, [masterSaves, captureMasterRecipe]);

  const renameMasterVersionById = useCallback((id, name) => {
    setMasterSaves((prev) => renameTemplate(prev, id, name, Date.now()));
  }, []);

  const deleteMasterVersionById = useCallback((id) => {
    setMasterSaves((prev) => deleteMasterSave(prev, id));
  }, []);

  // ── Element Preset (Slice 2) — captures the SELECTED non-primary
  // instance's material/motion/appearance only (never transform, never the
  // primary glass — its randomRanges/fields are flat, not this shape).
  // Load applies via the existing applyPresetToInstance (same function every
  // built-in catalog preset already uses), as a direct, explicit,
  // non-undoable action — same precedent as loadTemplateById/
  // applySceneRecipe below never pushing either undo stack. ──
  const canSaveElementPreset = selectedElementId !== PRIMARY_ELEMENT_ID && Boolean(selectedInstance) && !selectedInstance?.unsupported;

  const saveCurrentAsElementPreset = useCallback(() => {
    if (!canSaveElementPreset) return;
    const now = Date.now();
    const recipe = {
      type: selectedInstance.type,
      values: { material: selectedInstance.material, motion: selectedInstance.motion, appearance: selectedInstance.appearance },
    };
    const p = createElementPreset(elementPresets, { name: elementPresetNameDraft, recipe, now });
    setElementPresets((prev) => addTemplate(prev, p));
    setElementPresetNameDraft('');
    setElementPresetStatus(`Saved "${p.name}".`);
  }, [canSaveElementPreset, selectedInstance, elementPresets, elementPresetNameDraft]);

  // Shared apply logic for BOTH the local-list "Load" button and the Slice 3
  // cloud "Load" button (CloudTemplateSection's onLoadRecipe) — a cloud
  // Element Preset recipe is validated server-side (api/_lib/studio-
  // templates.cjs, reusing this same elements/preset-kinds.js shape) and is
  // then exactly as untrusted client-side as any local preset, so it goes
  // through the identical type-gated applyPresetToInstance path.
  const applyElementPresetRecipe = useCallback((recipe, label) => {
    if (!selectedInstance || selectedInstance.type !== recipe?.type) return;
    const applied = applyPresetToInstance(selectedInstance, recipe);
    setExtraInstances((prev) => prev.map((i) => (i.id === selectedInstance.id ? applied : i)));
    setElementPresetStatus(label ? `Loaded "${label}".` : 'Loaded.');
  }, [selectedInstance]);

  const loadElementPresetById = useCallback((id) => {
    const p = findTemplate(elementPresets, id);
    if (!p) return;
    applyElementPresetRecipe(p.recipe, p.name);
  }, [elementPresets, applyElementPresetRecipe]);

  const archiveElementPresetById = useCallback((id) => {
    setElementPresets((prev) => archiveTemplate(prev, id, Date.now()));
  }, []);

  const importElementPresetFromJSON = useCallback((json) => {
    const { list, error } = importPresetJSON(elementPresets, json, Date.now(), { kind: 'element', createFn: createElementPreset });
    if (error) { setElementPresetStatus(error); return; }
    setElementPresets(list);
    setElementPresetStatus('Imported.');
  }, [elementPresets]);

  // ── Look Preset (Slice 2) — captures the Look scope's full state PLUS
  // Camera (shotCam/diffusionCamera/camSeed), per the plan's own "camera
  // lens" + this round's "Diffusion Camera fields when relevant" note.
  // Load is a direct, explicit, non-undoable action (same precedent as
  // Element Preset/Scene Template load above). ──
  const captureLookPresetRecipe = useCallback(() => ({
    fx, fxPresetId, mat, envId, envIntensity, bgMode, bgColor, sceneId, lightCans, lightTemplate, lookSeed,
    shotCam, diffusionCamera, camSeed,
  }), [fx, fxPresetId, mat, envId, envIntensity, bgMode, bgColor, sceneId, lightCans, lightTemplate, lookSeed, shotCam, diffusionCamera, camSeed]);

  const saveCurrentAsLookPreset = useCallback(() => {
    const now = Date.now();
    const p = createLookPreset(lookPresets, { name: lookPresetNameDraft, recipe: captureLookPresetRecipe(), now });
    setLookPresets((prev) => addTemplate(prev, p));
    setLookPresetNameDraft('');
    setLookPresetStatus(`Saved "${p.name}".`);
  }, [lookPresets, lookPresetNameDraft, captureLookPresetRecipe]);

  const applyLookPresetRecipe = useCallback((recipe, label) => {
    const r = sanitizeLookPresetRecipe(recipe, captureLookPresetRecipe());
    setFx(r.fx); setFxPresetId(r.fxPresetId); setMat(r.mat); setEnvId(r.envId); setEnvIntensity(r.envIntensity);
    setBgMode(r.bgMode); setBgColor(r.bgColor); setSceneId(r.sceneId); setLightCans(r.lightCans); setLightTemplate(r.lightTemplate);
    setLookSeed(r.lookSeed); setShotCam(r.shotCam); setDiffusionCamera(r.diffusionCamera); setCamSeed(r.camSeed);
    setLookPresetStatus(label ? `Loaded "${label}".` : 'Loaded.');
  }, [captureLookPresetRecipe]);

  const loadLookPresetById = useCallback((id) => {
    const p = findTemplate(lookPresets, id);
    if (!p) return;
    applyLookPresetRecipe(p.recipe, p.name);
  }, [lookPresets, applyLookPresetRecipe]);

  const archiveLookPresetById = useCallback((id) => {
    setLookPresets((prev) => archiveTemplate(prev, id, Date.now()));
  }, []);

  const importLookPresetFromJSON = useCallback((json) => {
    const { list, error } = importPresetJSON(lookPresets, json, Date.now(), { kind: 'look', createFn: createLookPreset });
    if (error) { setLookPresetStatus(error); return; }
    setLookPresets(list);
    setLookPresetStatus('Imported.');
  }, [lookPresets]);

  // ── Render Preset (Slice 2) — export/render settings only, never
  // materials/lighting/camera (that's Look Preset's job). Load is a direct,
  // explicit, non-undoable action, same precedent as the other two kinds. ──
  const captureRenderPresetRecipe = useCallback(() => ({
    videoSeconds, videoFormat, frameId, clothAspect, artworkRatio, elementQualityTier,
  }), [videoSeconds, videoFormat, frameId, clothAspect, artworkRatio, elementQualityTier]);

  const saveCurrentAsRenderPreset = useCallback(() => {
    const now = Date.now();
    const p = createRenderPreset(renderPresets, { name: renderPresetNameDraft, recipe: captureRenderPresetRecipe(), now });
    setRenderPresets((prev) => addTemplate(prev, p));
    setRenderPresetNameDraft('');
    setRenderPresetStatus(`Saved "${p.name}".`);
  }, [renderPresets, renderPresetNameDraft, captureRenderPresetRecipe]);

  const applyRenderPresetRecipe = useCallback((recipe, label) => {
    const r = sanitizeRenderPresetRecipe(recipe, captureRenderPresetRecipe());
    setVideoSeconds(r.videoSeconds); setVideoFormat(r.videoFormat); setFrameId(r.frameId);
    setClothAspect(r.clothAspect); setArtworkRatio(r.artworkRatio); setElementQualityTier(r.elementQualityTier);
    setRenderPresetStatus(label ? `Loaded "${label}".` : 'Loaded.');
  }, [captureRenderPresetRecipe]);

  const loadRenderPresetById = useCallback((id) => {
    const p = findTemplate(renderPresets, id);
    if (!p) return;
    applyRenderPresetRecipe(p.recipe, p.name);
  }, [renderPresets, applyRenderPresetRecipe]);

  const archiveRenderPresetById = useCallback((id) => {
    setRenderPresets((prev) => archiveTemplate(prev, id, Date.now()));
  }, []);

  const importRenderPresetFromJSON = useCallback((json) => {
    const { list, error } = importPresetJSON(renderPresets, json, Date.now(), { kind: 'render', createFn: createRenderPreset });
    if (error) { setRenderPresetStatus(error); return; }
    setRenderPresets(list);
    setRenderPresetStatus('Imported.');
  }, [renderPresets]);

  // ── Proof Render (Slice 4e) ──────────────────────────────────────────────
  const submitProofRender = useCallback(async (idempotencyKey, requestSnapshot) => {
    if (!authedFetch || !idempotencyKey || !requestSnapshot) return;

    // Real cancellation of any previous in-flight create/poll before
    // starting a new one — not just the soft pollToken check below, which
    // only ever ignored a stale RESULT, never stopped the actual fetch.
    proofAbortControllerRef.current?.abort();
    const controller = new AbortController();
    proofAbortControllerRef.current = controller;
    const pollToken = ++proofPollTokenRef.current;

    setProofStatus('creating');
    setProofError('');
    setProofFailureKind('');
    setProofNote('');
    setProofUnsupported([]);
    setProofOutput(null);
    setProofJobId('');

    try {
      const res = await authedFetch('/api/dashboard/proof-render', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          action: 'create',
          scene: requestSnapshot.scene,
          // Timeline (Phase C) — explicit top-level field, mirroring Master
          // Saves' own transport shape; sent only when the timeline carries
          // at least one keyframe (buildTimelineSubmission's own "absent
          // when empty" contract) — zero behavior change for a non-timeline
          // scene's request body.
          ...(requestSnapshot.timeline ? { timeline: requestSnapshot.timeline } : {}),
          ...requestSnapshot.renderParams,
          idempotencyKey,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 422) {
        setProofStatus('unsupported');
        setProofUnsupported(data?.capabilities?.unsupportedFeatures || []);
        return;
      }
      if (!res.ok) throw new Error(data?.error || `Proof render request failed (${res.status}).`);

      const job = data.job;
      setProofJobId(job.jobId);
      setProofStatus(job.status);
      if (job.status === 'done') { setProofOutput(job.output); return; }
      if (job.status === 'failed') {
        // The JOB itself reported terminal failure (MAX_ATTEMPTS exhausted
        // server-side) — resubmitting this SAME idempotency key would only
        // ever re-fetch this SAME failed job, so no "Retry" is offered.
        setProofFailureKind('terminal');
        setProofError(job.error || 'Proof render failed.');
        return;
      }
      // Dispatch failure is OBSERVABLE (Codex Phase 7 review, P1): the job
      // exists and is safely queued, but no worker wake-up was delivered —
      // don't sit in a 6-minute poll that can only time out. Surface a
      // transient failure; Retry resends the SAME idempotent request, which
      // resolves to this SAME job and re-attempts dispatch. (mode 'none' =
      // manual-drain dev setups — polling is correct there.)
      if (data.dispatch && data.dispatch.mode !== 'none' && !data.dispatch.dispatched) {
        setProofFailureKind('transient');
        setProofStatus('failed');
        setProofError('The render job was created, but the worker wake-up could not be delivered. Retry resends the same request safely.');
        return;
      }

      // Bounded poll loop (3s × 120 = 6min) — same convention as page.jsx's
      // generateCloudVideo: stop on a terminal status, never poll forever.
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (proofPollTokenRef.current !== pollToken) return; // superseded by a newer click
        await abortableDelay(3000, controller.signal);
        const pollRes = await authedFetch(`/api/dashboard/proof-render?id=${encodeURIComponent(job.jobId)}`, { signal: controller.signal });
        const pollData = await pollRes.json().catch(() => ({}));
        if (!pollRes.ok) throw new Error(pollData?.error || `Proof render status check failed (${pollRes.status}).`);
        const polled = pollData.job;
        if (!polled) throw new Error('Proof render job disappeared.');
        if (proofPollTokenRef.current !== pollToken) return;
        setProofStatus(polled.status);
        if (polled.status === 'done') { setProofOutput(polled.output); return; }
        if (polled.status === 'failed') {
          setProofFailureKind('terminal');
          setProofError(polled.error || 'Proof render failed.');
          return;
        }
      }
      // Loop exhausted without a terminal status — the job is still genuinely
      // queued/rendering on the worker, not failed. Say so honestly instead
      // of reporting an error for something that may still succeed.
      setProofNote('Still rendering after 6 minutes — longer than expected, but not failed. Use "Check status now" below to keep checking.');
    } catch (err) {
      // Aborted by a newer click or an unmount — a deliberate cancellation,
      // never a real failure, so there's nothing to show for it.
      if (err?.name === 'AbortError') return;
      // A client-side/network exception (never reached the job's own
      // status) — retrying the exact same request is safe here, since it
      // may resolve to a job that actually did get created server-side.
      setProofStatus('failed');
      setProofFailureKind('transient');
      setProofError(err.message || 'Proof render failed.');
    }
  }, [authedFetch]);

  // ── Pin-before-submit (Slice F2 UI hookup; Phase A extends it to
  // auto-capture) — when the device primary has a live capture/upload
  // screen SOURCE, the server pipeline only accepts an immutable pinned
  // still. This converts the source ONCE, right before the snapshot
  // freezes: resolve the image bytes the browser already holds (library
  // dataUrl, or the capture image it's displaying), stage them via the
  // signed-URL direct upload (start → PUT → finalize — bytes never ride a
  // JSON body; Vercel caps request bodies at 4.5MB), and return a scene
  // whose devicePrimary carries screenStill with every raw source field
  // cleared. Pin failures throw — the caller surfaces them on the existing
  // transient-failure/retry UI, and a retry re-runs the whole pin (each
  // Generate click captures a fresh snapshot anyway). No-op for every
  // non-device scene, sheet/tshirt renders are untouched.
  //
  // Case D (the gap, closed here): live/liveUrl with NO capture/upload/still
  // used to fall straight through (`return scene`), so a Go-Live-only scene
  // reached the server raw and 422'd on `device-screen-live`. The SAME pure
  // planDeviceScreenSteps classifier the Quick Export guard's tests exercise
  // decides this — when it says 'obtain-capture', a same-origin capture is
  // obtained via captureDeviceScreenForExport (shared with the guard) BEFORE
  // anything else here runs, then falls straight into the existing
  // capture-pin path below with the obtained URL. This never mutates the
  // live devicePrimary React state — like the existing capture/upload
  // cases, it only ever returns a new, local, immutable snapshot.
  // `setNote` (proofNote/finalRenderNote) shows "Capturing website for
  // export…" for this one extra step, then reverts to the caller's normal
  // "Pinning device screen…" note.
  // `opts.preferLiveForFinalRender` (STUDIO-DETERMINISTIC-FINAL-RENDER-
  // SONNET-HANDOFF.md, "Live URL wired to Final Render" wiring round) —
  // Final Render's own pinAndSubmitFinalRender passes `true`; Proof's
  // pinAndSubmitProof does not pass it at all (defaults false, unchanged
  // legacy behavior: Proof still pins live/liveUrl through the
  // Browserless-backed capture-then-pin path — a multi-second-plus live
  // capture doesn't belong in a small/fast deterministic sanity check).
  // See planDeviceScreenSteps' own header for the full precedence rule this
  // flag drives.
  const pinDeviceScreenIfNeeded = useCallback(async (scene, setNote, opts = {}) => {
    const dp = scene?.devicePrimary;
    if (scene?.clothShape !== 'device' || !dp) return scene;

    const plan = planDeviceScreenSteps({ clothShape: scene.clothShape, devicePrimary: dp, preferLiveForFinalRender: Boolean(opts.preferLiveForFinalRender) });

    // 'use-live' (Final Render only) — an explicitly active Live URL wins
    // outright: pass devicePrimary.live/liveUrl through UNCHANGED so the
    // server's own capture pre-pass (art-render.mjs → live-site-capture.mjs)
    // performs the real frame-sequence capture, instead of pinning a still.
    // Every OTHER raw source field is still cleared — a coexisting stale
    // captureUrl/uploadAssetId/screenStill must never also trip the
    // 'device-screen-capture'/'device-screen-upload' capability rejections
    // alongside a perfectly valid live request (same discipline the
    // screenStill short-circuit below already follows for its own case).
    if (plan.steps[0] === 'use-live') {
      return {
        ...scene,
        devicePrimary: {
          ...dp, captureUrl: '', uploadAssetId: '', captureSourceUrl: '', captureViewport: '', screenStill: undefined, live: true, liveUrl: dp.liveUrl,
        },
      };
    }

    if (dp.screenStill) {
      // Already pinned — still clear any stale raw source fields (including
      // their capture provenance) so the submitted recipe can never trip a
      // raw-source capability rejection alongside its valid pin (Codex F2b
      // hardening).
      return { ...scene, devicePrimary: { ...dp, captureUrl: '', uploadAssetId: '', captureSourceUrl: '', captureViewport: '', live: false, liveUrl: '' } };
    }

    if (plan.steps[0] === 'use-none') return scene; // no source at all — honest placeholder, unchanged

    let sourceDp = dp;
    if (plan.steps[0] === 'obtain-capture') {
      setNote?.('Capturing website for export…');
      const capturedUrl = await captureDeviceScreenForExport({ url: dp.liveUrl, viewport: dp.viewport });
      sourceDp = { ...dp, captureUrl: capturedUrl, captureSourceUrl: dp.liveUrl, captureViewport: dp.viewport };
      setNote?.('Pinning device screen…');
    }

    let blob;
    if (sourceDp.uploadAssetId) {
      const asset = deviceScreenLibraryRef.current.find((a) => a.assetId === sourceDp.uploadAssetId);
      if (!asset?.dataUrl) throw new Error('The selected screen image is no longer in this browser\'s library — re-upload it, then try again.');
      blob = await (await fetch(asset.dataUrl)).blob();
    } else {
      // Only the same-origin capture route is ever fetched (Codex F2b
      // hardening) — captureUrl is set exclusively from that route's own
      // imageUrl (or, for case D, the SAME route's own response above), so
      // anything else is stale/foreign state, not a source.
      if (!sourceDp.captureUrl.startsWith('/api/public/studio-device-capture')) {
        throw new Error('The screen capture reference is not recognized — re-run CAPTURE, then try again.');
      }
      const res = await fetch(sourceDp.captureUrl);
      if (!res.ok) throw new Error('Could not read the captured screen image for pinning — re-run CAPTURE, then try again.');
      blob = await res.blob();
    }
    const contentType = ['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ? blob.type : 'image/png';

    const startRes = await authedFetch('/api/dashboard/proof-render', {
      method: 'POST',
      body: JSON.stringify({ action: 'pin-device-screen-start', contentType, bytes: blob.size }),
    });
    const startData = await startRes.json().catch(() => ({}));
    if (!startRes.ok) throw new Error(startData?.error || `Screen pin could not start (${startRes.status}).`);

    const put = await fetch(startData.uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: blob });
    if (!put.ok) throw new Error(`Screen upload failed (${put.status}) — check your connection and try again.`);

    const finRes = await authedFetch('/api/dashboard/proof-render', {
      method: 'POST',
      body: JSON.stringify({ action: 'pin-device-screen-finalize', tempId: startData.tempId }),
    });
    const finData = await finRes.json().catch(() => ({}));
    if (!finRes.ok) throw new Error(finData?.error || `Screen pin failed (${finRes.status}).`);

    return {
      ...scene,
      devicePrimary: {
        ...sourceDp, screenStill: finData.screenStill, captureUrl: '', uploadAssetId: '', captureSourceUrl: '', captureViewport: '', live: false, liveUrl: '',
      },
    };
  }, [authedFetch, captureDeviceScreenForExport]);

  // Pin-then-submit for one Proof request (Codex F2b P1 retry correction):
  // `key` must already be published to proofIdempotencyKeyRef by the caller
  // BEFORE this runs, so (a) a pin-phase failure leaves Retry a real request
  // to re-run, and (b) a stale pin resolving after a NEWER Generate click
  // publishes nothing (the key guard below). `rawRequest` is `{scene,
  // timeline}` (Phase C) — the SAME shape pinAndSubmitFinalRender's own
  // rawRequest already used; timeline rides through untouched (it carries
  // no device screen-source fields to pin — buildTimelineSubmission strips
  // those at capture time, before this is ever called).
  const pinAndSubmitProof = useCallback(async (key, rawRequest) => {
    let scene;
    try {
      setProofStatus('creating');
      setProofError('');
      setProofFailureKind('');
      setProofNote('Pinning device screen…');
      scene = await pinDeviceScreenIfNeeded(rawRequest.scene, setProofNote);
      setProofNote('');
    } catch (err) {
      if (proofIdempotencyKeyRef.current !== key) return; // superseded by a newer click — say nothing
      setProofStatus('failed');
      setProofFailureKind('transient');
      setProofNote('');
      setProofError(err.message || 'Screen pin failed.');
      return;
    }
    if (proofIdempotencyKeyRef.current !== key) return; // superseded mid-pin
    const snapshot = { scene, timeline: rawRequest.timeline, renderParams: PROOF_RENDER_PARAMS };
    proofRequestSnapshotRef.current = snapshot;
    submitProofRender(key, snapshot);
  }, [submitProofRender, pinDeviceScreenIfNeeded]);

  const handleGenerateProof = useCallback(() => {
    const key = crypto.randomUUID();
    // Captured ONCE here, never recomputed — see proofRequestSnapshotRef's
    // own comment for why a retry must never re-call captureSceneRecipe().
    // ALL request refs are (re)published synchronously at click time: the
    // pinned snapshot is cleared until pinning succeeds, so a retry can
    // never resubmit an OLDER click's snapshot. `timeline` (Phase C) —
    // buildTimelineSubmission returns undefined for an empty timeline, so a
    // non-timeline scene's rawRequest is shape-identical to before this
    // phase shipped.
    const rawRequest = { scene: captureSceneRecipe(), timeline: buildTimelineSubmission(timeline) };
    proofIdempotencyKeyRef.current = key;
    proofRequestSnapshotRef.current = null;
    proofRawRequestRef.current = rawRequest;
    pinAndSubmitProof(key, rawRequest);
  }, [pinAndSubmitProof, captureSceneRecipe, timeline]);

  // Reuses the SAME idempotency key AND the SAME immutable request snapshot
  // as the request being retried — if that request actually reached the
  // server before the client saw a failure, this resolves to the SAME job
  // (never a duplicate); resending the identical payload also means it can
  // never hit a stale-payload 409 conflict from scene edits made after the
  // failure. Only ever surfaced for a 'transient' failure (see the JSX
  // below) — a 'terminal' one has no retry affordance at all.
  const handleRetryProof = useCallback(() => {
    const key = proofIdempotencyKeyRef.current;
    if (!key) return;
    // Pinned snapshot exists → the failure was during SUBMISSION: resubmit
    // the exact immutable snapshot (same key — a request that actually
    // reached the server resolves to the same job, never a duplicate).
    // Only the raw request exists → the failure was during PINNING: re-run
    // the whole pin for the SAME click's raw scene (same key).
    if (proofRequestSnapshotRef.current) {
      submitProofRender(key, proofRequestSnapshotRef.current);
    } else if (proofRawRequestRef.current) {
      pinAndSubmitProof(key, proofRawRequestRef.current);
    }
  }, [submitProofRender, pinAndSubmitProof]);

  const handleCheckProofStatus = useCallback(async () => {
    if (!authedFetch || !proofJobId) return;
    try {
      const res = await authedFetch(`/api/dashboard/proof-render?id=${encodeURIComponent(proofJobId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Status check failed (${res.status}).`);
      const job = data.job;
      if (!job) throw new Error('Proof render job not found.');
      setProofNote('');
      setProofStatus(job.status);
      if (job.status === 'done') setProofOutput(job.output);
      if (job.status === 'failed') { setProofFailureKind('terminal'); setProofError(job.error || 'Proof render failed.'); }
    } catch (err) {
      setProofError(err.message || 'Status check failed.');
    }
  }, [authedFetch, proofJobId]);

  // ── Final Render (Phase 4) — same shape as submitProofRender/
  // handleGenerateProof/handleRetryProof/handleCheckProofStatus above, see
  // each of those for the full retry-safety/cancellation reasoning (not
  // re-explained per line here). The one real behavioral difference: on a
  // 'done' status this ALSO reads `job.artifact` (mp4Url/posterUrl/expired —
  // minted by the SAME GET route Proof's own poll loop already calls,
  // app/api/dashboard/proof-render/route.js's withSignedUrls, Phase 2) since
  // Final Render's whole point is a downloadable file, unlike Proof's
  // metadata-only confirmation.
  //
  // Extracted from submitFinalRender below (P1-C, Production lifecycle
  // hardening round) so the SAME bounded poll loop can also be resumed from
  // the rehydration effect further down, after a refresh/navigation finds a
  // persisted job reference still queued/rendering — not just from a fresh
  // "Generate Final Render" click. Every terminal outcome here also clears
  // the persisted reference; a job that's already done/failed has nothing
  // left to resume on a later mount.
  const pollFinalRenderJob = useCallback(async (jobId, controller, pollToken) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (finalRenderPollTokenRef.current !== pollToken) return;
      await abortableDelay(3000, controller.signal);
      const pollRes = await authedFetch(`/api/dashboard/proof-render?id=${encodeURIComponent(jobId)}`, { signal: controller.signal });
      const pollData = await pollRes.json().catch(() => ({}));
      if (!pollRes.ok) throw new Error(pollData?.error || `Final Render status check failed (${pollRes.status}).`);
      const polled = pollData.job;
      if (!polled) throw new Error('Final Render job disappeared.');
      if (finalRenderPollTokenRef.current !== pollToken) return;
      setFinalRenderStatus(polled.status);
      if (polled.status === 'done') {
        setFinalRenderOutput(polled.output); setFinalRenderArtifact(polled.artifact);
        clearPersistedFinalRenderJob();
        return;
      }
      if (polled.status === 'failed') {
        setFinalRenderFailureKind('terminal');
        setFinalRenderError(polled.error || 'Final Render failed.');
        clearPersistedFinalRenderJob();
        return;
      }
    }
    setFinalRenderNote('Still rendering after 6 minutes of checking — Final Render can genuinely take a few minutes. It is not stuck; use "Check status now" below, or come back later — your recipe snapshot is safely queued either way.');
  }, [authedFetch]);

  const submitFinalRender = useCallback(async (idempotencyKey, requestSnapshot) => {
    if (!authedFetch || !idempotencyKey || !requestSnapshot) return;

    finalRenderAbortControllerRef.current?.abort();
    const controller = new AbortController();
    finalRenderAbortControllerRef.current = controller;
    const pollToken = ++finalRenderPollTokenRef.current;

    setFinalRenderStatus('creating');
    setFinalRenderError('');
    setFinalRenderFailureKind('');
    setFinalRenderNote('');
    setFinalRenderUnsupported([]);
    setFinalRenderOutput(null);
    setFinalRenderArtifact(null);
    setFinalRenderJobId('');

    try {
      const res = await authedFetch('/api/dashboard/proof-render', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          action: 'create-final',
          scene: requestSnapshot.scene,
          // Timeline (Phase C) — see submitProofRender's own comment; same
          // "absent when empty" transport contract.
          ...(requestSnapshot.timeline ? { timeline: requestSnapshot.timeline } : {}),
          presetId: requestSnapshot.presetId,
          durationSeconds: requestSnapshot.durationSeconds,
          idempotencyKey,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 422) {
        setFinalRenderStatus('unsupported');
        setFinalRenderUnsupported(data?.capabilities?.unsupportedFeatures || []);
        return;
      }
      if (!res.ok) throw new Error(data?.error || `Final Render request failed (${res.status}).`);

      const job = data.job;
      setFinalRenderJobId(job.jobId);
      setFinalRenderStatus(job.status);
      // Persisted as soon as a real job exists — a refresh/navigation from
      // here on can rehydrate it (P1-C). Terminal branches below clear it
      // again immediately; nothing to resume once the job is already done.
      savePersistedFinalRenderJob(job.jobId);
      if (job.status === 'done') {
        setFinalRenderOutput(job.output); setFinalRenderArtifact(job.artifact);
        clearPersistedFinalRenderJob();
        return;
      }
      if (job.status === 'failed') {
        setFinalRenderFailureKind('terminal');
        setFinalRenderError(job.error || 'Final Render failed.');
        clearPersistedFinalRenderJob();
        return;
      }
      // Observable dispatch failure — same contract as submitProofRender's
      // own check (Codex Phase 7 review, P1): queued job + no wake-up
      // delivered = transient failure with a safe idempotent Retry, never a
      // doomed 6-minute poll. The persisted job id stays saved — Check
      // Status still works while the user decides.
      if (data.dispatch && data.dispatch.mode !== 'none' && !data.dispatch.dispatched) {
        setFinalRenderFailureKind('transient');
        setFinalRenderStatus('failed');
        setFinalRenderError('The render job was created, but the worker wake-up could not be delivered. Retry resends the same request safely.');
        return;
      }

      // Honest live-capture progress note ("Live URL wired to Final Render"
      // wiring round, requirement 4) — a live-URL device screen's render
      // includes a REAL, multi-second-to-multi-minute server-side capture
      // step (services/studio-render/live-site-capture.mjs scrolling the
      // actual site) before the deterministic frame render even starts, on
      // top of this job's normal render time. Said plainly here rather than
      // leaving "Queued…"/"Rendering…" to imply this is exactly as fast as
      // every other Final Render.
      const dp = requestSnapshot.scene?.devicePrimary;
      if (requestSnapshot.scene?.clothShape === 'device' && dp?.live && dp?.liveUrl) {
        setFinalRenderNote('Capturing the live website server-side (scrolling the real page) before rendering — this step alone can take anywhere from several seconds to a couple of minutes depending on how heavy the site is.');
      }

      // Same bounded poll loop as Proof (3s × 120 = 6min) — a real Final
      // Render can legitimately take up to TOTAL_RENDER_DEADLINE_MS (10min
      // server-side); exhausting this client-side poll window is reported
      // as "still working," never as a failure — see pollFinalRenderJob's
      // own finalRenderNote above.
      await pollFinalRenderJob(job.jobId, controller, pollToken);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setFinalRenderStatus('failed');
      setFinalRenderFailureKind('transient');
      setFinalRenderError(err.message || 'Final Render failed.');
    }
  }, [authedFetch, pollFinalRenderJob]);

  // Snapshot captured ONCE — the immutable recipe this render will produce,
  // regardless of further edits made while it's queued/rendering (same
  // "keep editing while cloud rendering proceeds" contract the handoff
  // requires, and the exact reason a retry below must never recompute it).
  // Same pin-then-submit / retry-branching contract as pinAndSubmitProof —
  // see proofRawRequestRef's own comment (Codex F2b P1 retry correction).
  const pinAndSubmitFinalRender = useCallback(async (key, rawRequest) => {
    let scene;
    try {
      setFinalRenderStatus('creating');
      setFinalRenderError('');
      setFinalRenderFailureKind('');
      setFinalRenderNote('Pinning device screen…');
      scene = await pinDeviceScreenIfNeeded(rawRequest.scene, setFinalRenderNote, { preferLiveForFinalRender: true });
      setFinalRenderNote('');
    } catch (err) {
      if (finalRenderIdempotencyKeyRef.current !== key) return;
      setFinalRenderStatus('failed');
      setFinalRenderFailureKind('transient');
      setFinalRenderNote('');
      setFinalRenderError(err.message || 'Screen pin failed.');
      return;
    }
    if (finalRenderIdempotencyKeyRef.current !== key) return;
    // Timeline (Phase C) rides through untouched — it carries no device
    // screen-source fields to pin (buildTimelineSubmission already stripped
    // those at capture time, before this ever ran).
    const snapshot = { scene, timeline: rawRequest.timeline, presetId: rawRequest.presetId, durationSeconds: rawRequest.durationSeconds };
    finalRenderRequestSnapshotRef.current = snapshot;
    submitFinalRender(key, snapshot);
  }, [submitFinalRender, pinDeviceScreenIfNeeded]);

  const handleGenerateFinalRender = useCallback(() => {
    const key = crypto.randomUUID();
    // Timeline duration contract (Phase C) — mirrors exportTimeline's own
    // (Quick Export's timeline-driven capture runs for
    // timelineDuration(timeline), never the videoSeconds dial): a
    // timeline-driven Final Render sends durationSeconds = the timeline's
    // own totalSeconds, which the server validates against and rejects a
    // mismatch on loudly. A non-timeline scene (rawTimeline undefined)
    // keeps the existing videoSeconds-driven duration untouched.
    const rawTimeline = buildTimelineSubmission(timeline);
    const rawRequest = {
      scene: captureSceneRecipe(),
      timeline: rawTimeline,
      presetId: finalRenderPresetIdFor(clothAspect, frameId, finalRenderQuality),
      durationSeconds: rawTimeline ? rawTimeline.totalSeconds : videoSeconds,
    };
    finalRenderIdempotencyKeyRef.current = key;
    finalRenderRequestSnapshotRef.current = null;
    finalRenderRawRequestRef.current = rawRequest;
    pinAndSubmitFinalRender(key, rawRequest);
  }, [pinAndSubmitFinalRender, captureSceneRecipe, clothAspect, finalRenderQuality, videoSeconds, timeline]);

  const handleRetryFinalRender = useCallback(() => {
    const key = finalRenderIdempotencyKeyRef.current;
    if (!key) return;
    // Snapshot present → submission-phase failure → resubmit the pinned
    // immutable snapshot. Raw request only → pin-phase failure → re-pin the
    // SAME click's request. See handleRetryProof for the full contract.
    if (finalRenderRequestSnapshotRef.current) {
      submitFinalRender(key, finalRenderRequestSnapshotRef.current);
    } else if (finalRenderRawRequestRef.current) {
      pinAndSubmitFinalRender(key, finalRenderRawRequestRef.current);
    }
  }, [submitFinalRender, pinAndSubmitFinalRender]);

  const handleCheckFinalRenderStatus = useCallback(async () => {
    if (!authedFetch || !finalRenderJobId) return;
    try {
      const res = await authedFetch(`/api/dashboard/proof-render?id=${encodeURIComponent(finalRenderJobId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Status check failed (${res.status}).`);
      const job = data.job;
      if (!job) throw new Error('Final Render job not found.');
      setFinalRenderNote('');
      setFinalRenderStatus(job.status);
      if (job.status === 'done') { setFinalRenderOutput(job.output); setFinalRenderArtifact(job.artifact); clearPersistedFinalRenderJob(); }
      if (job.status === 'failed') { setFinalRenderFailureKind('terminal'); setFinalRenderError(job.error || 'Final Render failed.'); clearPersistedFinalRenderJob(); }
    } catch (err) {
      setFinalRenderError(err.message || 'Status check failed.');
    }
  }, [authedFetch, finalRenderJobId]);

  // Explicit dismissal (P1-C) — clears the persisted job reference AND
  // resets to 'idle', for the done/failed notices below. Also invalidates
  // any in-flight poll (bumping the token, aborting the controller) so a
  // still-rendering job the user dismissed can't turn around and overwrite
  // the now-idle UI a few seconds later.
  const handleDismissFinalRender = useCallback(() => {
    clearPersistedFinalRenderJob();
    finalRenderPollTokenRef.current += 1;
    finalRenderAbortControllerRef.current?.abort();
    setFinalRenderStatus('idle');
    setFinalRenderError('');
    setFinalRenderFailureKind('');
    setFinalRenderNote('');
    setFinalRenderUnsupported([]);
    setFinalRenderOutput(null);
    setFinalRenderArtifact(null);
    setFinalRenderJobId('');
  }, []);

  // Rehydration (P1-C, Production lifecycle hardening round) — the gap this
  // closes: the job id lived ONLY in React state, so a refresh or
  // navigation away mid-render silently stranded it even though the UI's
  // own copy already told users "come back later." Runs once, the first
  // time authedFetch is available. The persisted jobId is only ever a
  // REFERENCE — current status always comes from a fresh GET here, never a
  // locally cached value. Shares submitFinalRender's own abort/pollToken
  // contract (bump the token, own the controller) so a later fresh
  // "Generate Final Render" click correctly supersedes a resumed poll, and
  // the existing unmount-cleanup effect below aborts it for free.
  useEffect(() => {
    if (!authedFetch || finalRenderRehydratedRef.current) return;
    finalRenderRehydratedRef.current = true;
    const persisted = loadPersistedFinalRenderJob();
    if (!persisted?.jobId) return;

    finalRenderAbortControllerRef.current?.abort();
    const controller = new AbortController();
    finalRenderAbortControllerRef.current = controller;
    const pollToken = ++finalRenderPollTokenRef.current;

    (async () => {
      try {
        const res = await authedFetch(`/api/dashboard/proof-render?id=${encodeURIComponent(persisted.jobId)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (finalRenderPollTokenRef.current !== pollToken) return; // superseded by a fresh click while this GET was in flight
        if (!res.ok || !data.job) { clearPersistedFinalRenderJob(); return; }
        const job = data.job;
        setFinalRenderJobId(job.jobId);
        setFinalRenderStatus(job.status);
        if (job.status === 'done') {
          setFinalRenderOutput(job.output); setFinalRenderArtifact(job.artifact);
          clearPersistedFinalRenderJob();
          return;
        }
        if (job.status === 'failed') {
          setFinalRenderFailureKind('terminal');
          setFinalRenderError(job.error || 'Final Render failed.');
          clearPersistedFinalRenderJob();
          return;
        }
        // queued/rendering — resume polling exactly where a fresh submit would.
        await pollFinalRenderJob(job.jobId, controller, pollToken);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // A transient failure resuming an existing reference — leave it in
        // localStorage so a later mount/refresh can retry; this was a
        // failed STATUS CHECK, not a failed job.
      }
    })();
  }, [authedFetch, pollFinalRenderJob]);

  // Unmount cleanup — aborts any in-flight Proof/Final Render create/poll so
  // navigating away from Studio doesn't leave a fetch loop running for up
  // to 6 more minutes with no component left to show the result to.
  useEffect(() => () => {
    proofAbortControllerRef.current?.abort();
    finalRenderAbortControllerRef.current?.abort();
  }, []);

  // ── Curated Set Generators (Slice 2) — unlike preset load above, this is
  // a GENERATIVE action (like Randomize), so it's undoable: composes
  // Elements (the generated extraInstances REPLACE the current set — a
  // curated set is a fresh themed starting point, not a merge) + Look
  // (fxPresetId/envId/sceneId) + Camera (diffusionCamera) in one atomic
  // cross-scope transaction, same mechanism Entire Set/Colors Only use.
  const generateAndApplyCuratedSet = useCallback(() => {
    const nextElemSeed = sceneSeed + 1;
    const result = generateCuratedSet(curatedGeneratorId, { seed: nextElemSeed, formatId: elementFormatId });
    if (result.error) { setCuratedSetStatus(result.error); return; }
    applyCrossScopeMutation(['elements', 'look', 'camera'], () => {
      setSceneSeed(nextElemSeed);
      setExtraInstances(result.extraInstances);
      setSelectedElementId(PRIMARY_ELEMENT_ID);
      if (result.fxPresetId) applyFxPreset(result.fxPresetId);
      if (result.envId) setEnvId(result.envId);
      if (result.sceneId) { setSceneId(result.sceneId); setBgMode('scene'); }
      setDiffusionCamera((current) => resolveCuratedDiffusionCamera(current, result.diffusionCamera));
    });
    setLastScopeDomains(['elements', 'look', 'camera']);
    const generator = CURATED_GENERATORS.find((g) => g.id === curatedGeneratorId);
    setCuratedSetStatus(
      result.warnings.length
        ? `Generated "${generator?.label}" — ${result.warnings.length} element(s) couldn't be perfectly placed.`
        : `Generated "${generator?.label}".`
    );
  }, [sceneSeed, curatedGeneratorId, elementFormatId, applyCrossScopeMutation, applyFxPreset]);

  // ── Capture frame → start the HUD filmstrip slide from wherever it was. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.frameSlide) return;
    const to = FRAME_IDS.indexOf(frameId);
    const s = world.frameSlide;
    const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, s.t)), 3);
    world.frameSlide = { from: s.from + (s.to - s.from) * eased, to, t: 0 };
  }, [frameId, worldReady]);

  // Step the carousel one crop left/right (no wrap — the ends are the ends).
  const stepFrame = useCallback((dir) => {
    setFrameId((cur) => {
      const i = FRAME_IDS.indexOf(cur);
      return FRAME_IDS[Math.min(FRAME_IDS.length - 1, Math.max(0, i + dir))] || cur;
    });
  }, []);

  // ── Environment light select → IBL swap (HDRIs cached after first load). ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.setEnvironment) return;
    if (ENV_PRESETS[envId]?.url) setEnvLoadingId(envId);
    world.setEnvironment(envId, () => setEnvLoadingId((cur) => (cur === envId ? null : cur)));
  }, [envId, worldReady]);

  // ── Glass form dials → mesh + material (built once at init). ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.glassMesh) return;
    world.glassMesh.visible = glass.on;
    world.glassMesh.scale.setScalar(glass.scale || 1);
    world.glassMat.roughness = glass.clarity;
    // TRANSPARENCY — real optical transparency (Codex visual-correction
    // round), independent of `clarity`/FROST above (which only ever
    // touched roughness — sharper/frostier reflection and refraction, not
    // see-through-ness; a MeshPhysicalMaterial's transmission and
    // roughness are orthogonal physical properties, so Clarity alone could
    // never have fixed the reported "reads as opaque" defect). `?? 1`
    // covers a value restored from BEFORE this field existed (see
    // DEFAULT_GLASS's own comment on the same default). `opacity` is
    // deliberately never set here — stays at the material's own default of
    // 1, per Three.js's MeshPhysicalMaterial contract for transmissive
    // materials (https://threejs.org/docs/pages/MeshPhysicalMaterial.html).
    world.glassMat.transmission = glass.transmission ?? 1;
    world.glassMat.attenuationColor.set(glass.tint);
    world.glassMat.color.set('#ffffff');
  }, [glass, worldReady]);

  // ── Element position/rotation offset (Phase 1 correction) → glass group.
  // Deliberately a SEPARATE effect from the one above rather than folded into
  // it: the auto-rotate loop continuously mutates
  // world.glassMesh.rotation.x/z every frame (see the `raf` loop's
  // `gl.rotate` block), so re-running `.rotation.set(...)` on every glass
  // state change (e.g. dragging Clarity) would snap that continuous spin back
  // to the base offset on every unrelated slider drag. Scoping the dependency
  // array to exactly `glass.position`/`glass.rotationOffset` means this only
  // fires when the user actually moves one of those two controls — object
  // identity is preserved by setGlass's spread whenever an unrelated key
  // changes, so React's dependency check correctly skips it otherwise.
  // Position/rotation are always-safe Object3D properties (no geometry/
  // material touched), default to [0,0,0] (identical to today's behavior),
  // and this is pure ADDITION — the existing scale/tint/clarity effect and
  // the animate loop's spin increment are both untouched.
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.glassMesh) return;
    const [px, py, pz] = glass.position || [0, 0, 0];
    world.glassMesh.position.set(px, py, pz);
    const DEG = Math.PI / 180;
    const [rx, ry, rz] = glass.rotationOffset || [0, 0, 0];
    world.glassMesh.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  }, [glass.position, glass.rotationOffset, worldReady]);

  // ── Scene-element sync — extraInstances (real, non-singleton types only)
  // → live three.js objects in world.elementsGroup. ──
  // One id-keyed entry per enabled real instance. create() runs once (first
  // time an id appears); applyInstance() runs again ONLY when
  // shouldReapplyInstance says the instance reference or the quality tier
  // actually changed since the entry's last apply (elements/scene-elements.js)
  // — editing one element does NOT re-touch every sibling's entry, and each
  // factory further splits that call into a cheap transform/material update
  // vs. a full geometry rebuild gated on its own topology signature (see
  // factories.js). `resolveEffectiveInstance` (elements/placement.js) is
  // applied right before the factory call, so a per-format transform
  // override (none authored yet in this phase, but the mechanism is real)
  // would take effect here. Disabling, removing, or a factory-less catalog
  // type all fall through to the same disposal path below, so there is
  // exactly one way an object leaves the scene, disposed exactly once. The
  // glass mesh/material and its own dedicated effects are untouched — this
  // only ever touches world.elementsGroup.
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.elementsGroup) return;
    const { elementsGroup, elementLiveObjects } = world;
    // The feature flag gates the WHOLE element system, not just the rail
    // UI — a saved scene can carry `extraInstances` from an earlier
    // session where the flag (or admin access) was on; visiting again
    // with it off must reproduce ORIGINAL Studio behavior exactly (the
    // Phase 0 exit gate), not silently keep rendering whatever was left
    // over. Dispose anything already live and stop — never even look at
    // extraInstances while the flag is off.
    if (!elementsV1Enabled) {
      Array.from(elementLiveObjects.keys()).forEach((id) => {
        const entry = elementLiveObjects.get(id);
        entry.factory.dispose(entry.object);
        elementsGroup.remove(entry.object);
        elementLiveObjects.delete(id);
        if (entry.type === 'tshirt-model') clearTshirtModelStatus(id);
      });
      return;
    }
    const { THREE, stdlib, glbLoader } = world;
    // sceneSeed intentionally NOT in this effect's deps below — it's read
    // fresh (current value, never stale) whenever this effect runs for any
    // OTHER reason, but a sceneSeed change alone must not force every live
    // element to reconcile; only homepage-particle-hero's spawn seeding
    // (factories.js heroRebuild) reads it, and only at actual (re)creation.
    // glbAssets IS in this effect's deps (below) — unlike sceneSeed, an
    // asset-list change can matter to an ALREADY-existing entry: a
    // glb-import instance whose FIRST load attempt found glbAssetsById
    // still empty (e.g. right after a page reload, before the proactive
    // fetch above resolves) gives up silently by design and has no other
    // event to prompt a retry — see the `glbNeedsRetry` check below, which
    // is what actually re-invokes applyInstance for that case (merely
    // re-running this effect doesn't, since shouldReapplyInstance gates on
    // instance-reference equality, which a library refresh alone can't
    // change).
    const glbAssetsById = {};
    glbAssets.forEach((a) => { glbAssetsById[a.assetId] = a; });
    // logoAssetsById mirrors glbAssetsById's shape/precedent for
    // factories.js's hanging-tshirt factory — see logoLibrary's own comment
    // above for why this one is browser-local (no async fetch/race to
    // guard against; localStorage is read synchronously at mount).
    const logoAssetsById = {};
    logoLibrary.forEach((a) => { logoAssetsById[a.assetId] = a; });
    // deviceScreenAssetsById mirrors logoAssetsById for device-mockup's
    // uploaded screens (factories.js deviceWantedScreenSource).
    const deviceScreenAssetsById = {};
    deviceScreenLibrary.forEach((a) => { deviceScreenAssetsById[a.assetId] = a; });
    const ctx = {
      THREE, stdlib, tier: elementQualityTier, sceneSeed, glbLoader, glbAssetsById, logoAssetsById, deviceScreenAssetsById,
      // tshirt-model's React/three.js status bridge (Codex P1 review round
      // 2) — reportTshirtModelStatus has a stable identity (useCallback,
      // empty deps), so threading it through a freshly-built ctx object
      // every effect run never itself causes extra churn.
      onTshirtModelStatus: reportTshirtModelStatus,
    };

    const wantedIds = new Set();
    extraInstances.forEach((inst) => {
      if (!isRenderableInstance(inst, PRIMARY_ELEMENT_ID)) return; // glass duplicate — data-only, never gets a live object
      const factory = getFactory(inst.type);
      if (!factory) return; // catalog entry with no factory yet — selectable but honestly not-yet-renderable
      if (!inst.enabled) return;
      wantedIds.add(inst.id);
      let entry = elementLiveObjects.get(inst.id);
      if (!entry) {
        const object = factory.create(ctx);
        elementsGroup.add(object);
        entry = { type: inst.type, object, factory, lastInstance: null, lastTier: null, lastFormatId: null };
        elementLiveObjects.set(inst.id, entry);
      }
      // shouldReapplyInstance covers instance-reference + tier; format is
      // checked alongside it (not folded into that helper, which is tested
      // as a 2-input contract) because a format switch only matters at all
      // once an instance actually carries a per-format override — today
      // every instance's formatOverrides are empty, so resolveEffectiveInstance
      // is a no-op regardless of format, but this keeps the reconciliation
      // correct once authoring per-format overrides ships.
      //
      // glb-import needs one more trigger neither of those covers: an
      // instance whose OWN reference hasn't changed but whose asset never
      // actually loaded (glbAssetsById didn't have it yet on the attempt
      // that ran) stays stuck empty forever otherwise — nothing about the
      // instance itself changing again to naturally re-trigger a retry.
      const glbNeedsRetry = inst.type === 'glb-import' && Boolean(inst.appearance?.assetId)
        && (entry.object.userData.motion?.children.length || 0) === 0;
      // CORRECTION (Codex review, P1): deleting a logo from the browser-
      // local library only cleared the ONE instance whose Inspector
      // triggered the delete — a duplicated shirt referencing the same
      // (now-gone) logoAssetId kept showing the deleted texture forever,
      // because its OWN instance reference never changed, so
      // shouldReapplyInstance never let applyInstance run again for it.
      // Unlike glbNeedsRetry (narrowly "nothing loaded yet"), this is
      // deliberately broad — ANY hanging-tshirt with a logo selected
      // re-checks on every logoLibrary change, since a library edit can
      // invalidate an ALREADY-loaded selection (deletion), not just an
      // unresolved one. tshirtApplyInstance itself is cheap when nothing
      // actually changed (see its own logoUrlLoaded comparison).
      const tshirtLogoNeedsRecheck = inst.type === 'hanging-tshirt' && Boolean(inst.appearance?.logoAssetId);
      // Same broad recheck for device-mockup's uploaded screen: a
      // deviceScreenLibrary edit can invalidate an already-loaded upload
      // (deletion), and deviceSyncScreenTexture is cheap when nothing
      // changed (appliedScreenKey comparison).
      const deviceScreenNeedsRecheck = inst.type === 'device-mockup' && Boolean(inst.appearance?.uploadAssetId);
      // tshirt-model deliberately has NO automatic retry trigger here (Codex
      // P2 review, Part B round 3) — an earlier version of this effect
      // treated `root.userData.loadState === 'error'` as its own retry
      // signal, routed through tshirtModelRetry. That meant ANY Studio
      // dependency change this effect reruns for (moving the failed model
      // itself, editing an unrelated element, changing format, a glb/logo
      // library refresh) would silently re-fire the 10MB fetch, with no
      // user action at all — exactly the "retry without pressing Retry"
      // failure mode the whole state-machine fix exists to prevent, just
      // reached through the reconciliation loop instead of a bare
      // applyInstance call. shouldSyncElementEntry (elements/scene-
      // elements.js — extracted so this exact gating decision is pure and
      // unit-tested, not just hand-rolled inline) has no tshirt-model
      // exception at all; the only remaining exceptions are glbNeedsRetry
      // and tshirtLogoNeedsRecheck above. When it DOES decide to sync
      // (e.g. this instance's own transform changed), the plain
      // `factory.applyInstance` call below is always safe regardless of
      // load state: for tshirt-model specifically, it updates root's
      // transform while leaving 'error' — and loadError — untouched; the
      // Inspector's Retry button (retryTshirtModelLoad -> tshirtModelRetry)
      // is the ONLY sanctioned way to leave 'error'.
      if (!shouldSyncElementEntry(entry, inst, elementQualityTier, elementFormatId, { glbNeedsRetry, tshirtLogoNeedsRecheck, deviceScreenNeedsRecheck })) return;
      const effective = resolveEffectiveInstance(inst, elementFormatId);
      factory.applyInstance(ctx, entry.object, effective);
      entry.lastInstance = inst;
      entry.lastTier = elementQualityTier;
      entry.lastFormatId = elementFormatId;
    });

    // Disabled/removed since the last run — dispose and drop.
    Array.from(elementLiveObjects.keys()).forEach((id) => {
      if (wantedIds.has(id)) return;
      const entry = elementLiveObjects.get(id);
      entry.factory.dispose(entry.object);
      elementsGroup.remove(entry.object);
      elementLiveObjects.delete(id);
      // A tshirt-model mid-load when removed: dispose() above already
      // bumped its loadToken/set 'disposed', so the in-flight fetch's late
      // resolution can never touch this root or call back into React (see
      // tshirtModelReportStatus's own token guard) — this just drops
      // whatever status React was already showing for it.
      if (entry.type === 'tshirt-model') clearTshirtModelStatus(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraInstances, worldReady, elementQualityTier, elementFormatId, glbAssets, logoLibrary, deviceScreenLibrary, elementsV1Enabled]);

  // ── tshirt-model async load status → Inspector (Codex P1 review round
  // 2). The factory's own idle/loading/loaded/error/disposed state lives
  // on the live three.js object's userData (imperative, outside React) —
  // mutating it does NOT trigger a re-render by itself, so this is the
  // one explicit, intentional bridge that crosses into React state. React
  // never polls or reads root.userData directly; it only ever reacts to
  // reportTshirtModelStatus, which elements/factories.js calls at each
  // real state transition (via ctx.onTshirtModelStatus, threaded through
  // below) — token-gated on the three.js side so a late callback from a
  // superseded or disposed load can never fire (same guard that already
  // protects the geometry attachment itself).
  //
  // Both callbacks are given a stable identity (empty dep array — they
  // only close over the React state setter, which React itself guarantees
  // is stable) so passing them into `ctx` every reconciliation-effect run
  // below never causes that effect — or retryTshirtModelLoad's own
  // useCallback — to churn or re-run anything unnecessarily.
  const [tshirtModelStatus, setTshirtModelStatus] = useState({});
  const reportTshirtModelStatus = useCallback((id, status) => {
    setTshirtModelStatus((prev) => {
      const existing = prev[id];
      if (existing && existing.state === status.state && existing.error === status.error) return prev; // no-op — avoid an unnecessary re-render
      return { ...prev, [id]: status };
    });
  }, []);
  // Called directly wherever a tshirt-model entry is disposed/removed
  // (both cleanup loops in the reconciliation effect above) — an id is
  // never reused across elements, but a stale entry lingering in React
  // state after its element is gone is still incorrect leftover data, and
  // this is the one place both loops already have the id in scope.
  const clearTshirtModelStatus = useCallback((id) => {
    setTshirtModelStatus((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Inspector's Retry action for a tshirt-model in its 'error' state — the
  // SOLE trigger for tshirtModelRetry (Codex P2 review, Part B round 3:
  // the reconciliation effect above deliberately has no automatic retry of
  // its own anymore — see its comment). tshirtModelRetry itself still
  // no-ops if a retry is already in flight, so rapid repeated clicks here
  // can never stack concurrent fetches.
  const retryTshirtModelLoad = useCallback((id) => {
    const world = worldRef.current;
    const entry = world?.elementLiveObjects?.get(id);
    if (!entry || entry.type !== 'tshirt-model') return;
    const inst = extraInstances.find((i) => i.id === id);
    if (!inst) return;
    const glbAssetsById = {};
    glbAssets.forEach((a) => { glbAssetsById[a.assetId] = a; });
    const logoAssetsById = {};
    logoLibrary.forEach((a) => { logoAssetsById[a.assetId] = a; });
    const ctx = {
      THREE: world.THREE, stdlib: world.stdlib, tier: elementQualityTier, sceneSeed,
      glbLoader: world.glbLoader, glbAssetsById, logoAssetsById,
      onTshirtModelStatus: reportTshirtModelStatus,
    };
    const effective = resolveEffectiveInstance(inst, elementFormatId);
    tshirtModelRetry(ctx, entry.object, effective);
    entry.lastInstance = inst;
    entry.lastTier = elementQualityTier;
    entry.lastFormatId = elementFormatId;
  }, [extraInstances, glbAssets, logoLibrary, elementQualityTier, sceneSeed, elementFormatId, reportTshirtModelStatus]);

  // ── Shot camera dials → position/fov; using it pauses orbit control. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.shotCamera) return;
    const DEG = Math.PI / 180;
    const az = shotCam.az * DEG, el = shotCam.el * DEG, R = shotCam.dist;
    world.shotCamera.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
    world.shotCamera.lookAt(0, 0, 0);
    world.shotCamera.fov = shotCam.fov;
    world.shotCamera.updateProjectionMatrix();
    world.controls.enabled = !shotCam.use;
  }, [shotCam, worldReady]);

  // ── Lighting cans → spotlights. Position from stage angle (az, 0 = front)
  // + height angle at a fixed throw; slider intensity maps to candela. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.cans) return;
    const R = 2.8;
    const DEG = Math.PI / 180;
    lightCans.forEach((c, i) => {
      const can = world.cans[i];
      if (!can) return;
      can.visible = Boolean(c.on) && c.intensity > 0;
      can.color.set(c.color);
      can.intensity = c.intensity * 14;
      const az = (c.az || 0) * DEG;
      const el = (c.el || 0) * DEG;
      can.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
    });
  }, [lightCans, worldReady]);

  // ── Camera freedom → OrbitControls. Disabling an axis clamps it at its
  // current angle so the view doesn't jump; pan maps to enablePan. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.controls) return;
    const ctl = world.controls;
    if (cam.rotY) { ctl.minAzimuthAngle = -Infinity; ctl.maxAzimuthAngle = Infinity; }
    else { const a = ctl.getAzimuthalAngle(); ctl.minAzimuthAngle = a; ctl.maxAzimuthAngle = a; }
    if (cam.rotX) { ctl.minPolarAngle = 0; ctl.maxPolarAngle = Math.PI; }
    else { const p = ctl.getPolarAngle(); ctl.minPolarAngle = p; ctl.maxPolarAngle = p; }
    ctl.enablePan = cam.pan;
    ctl.enableRotate = cam.rotX || cam.rotY;
  }, [cam, worldReady]);

  // ── Sheet shape / perf rebuild — 'sheet' only; when the T-shirt is the
  // active primary shape this disposes the sheet instead (the tshirt
  // lifecycle effect right below owns building/updating it). Renderer/
  // composer/diffuseTarget pixel-ratio sizing stays unconditional — both
  // primary shapes render through the same renderer. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world) return;
    if (clothShape === 'sheet') {
      world.buildCloth(clothAspect, perf, artworkRatio);
    } else {
      world.disposeSheet();
    }
    const pr = Math.min(window.devicePixelRatio, PERF_LEVELS[perf].pr);
    world.renderer.setPixelRatio(pr);
    world.composer?.setPixelRatio(pr); // FX buffers follow the perf level too
    const { clientWidth, clientHeight } = world.renderer.domElement;
    world.diffuseTarget?.setSize(clientWidth * pr, clientHeight * pr);
  }, [clothShape, clothAspect, perf, artworkRatio, worldReady]);

  // ── Primary T-shirt lifecycle ("pivot" round — Part A) ───────────────────
  // A procedural 2.5D T-shirt-shaped cloth (elements/tshirt-mesh.js) that
  // REPLACES the flyer, not the real GLB — see
  // docs/plans/STUDIO-REAL-TSHIRT-GLB-INTEGRATION-HANDOFF.md for the product
  // correction. The real GLB (public/models/merch/tshirt.glb) is preserved
  // separately as an optional "3D T-Shirt" catalog element (Part B) — it
  // never appears here.
  // Driven through the EXACT SAME getFactory('hanging-tshirt')
  // create/applyInstance/animate/dispose contract a real extraInstances
  // entry uses (see elements/primary-cloth.js's own header comment) — just
  // outside the generic extraInstances/elementLiveObjects array, since the
  // catalog marks hanging-tshirt `singleInstanceRenderer: true` (so it never
  // shows up in the normal "Add Element" picker or gets independently
  // duplicated — it only ever exists as this ONE dedicated primary-shape
  // object, created/updated/disposed here and animated every frame from
  // loop() via `world.tshirtPrimaryEntry`).
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.elementsGroup) return;
    if (clothShape !== 'tshirt') {
      if (world.tshirtPrimaryEntry) {
        world.tshirtPrimaryEntry.factory.dispose(world.tshirtPrimaryEntry.object);
        world.elementsGroup.remove(world.tshirtPrimaryEntry.object);
        world.tshirtPrimaryEntry = null;
      }
      // Shape switched away mid-drag — a stale grab reference into a
      // now-disposed sim, or a stuck-disabled orbit control, must not
      // survive the switch (see the pointer handlers below).
      if (world.tshirtGrab?.active) {
        world.tshirtGrab.active = false;
        world.controls.enabled = true;
      }
      return;
    }
    const { THREE, stdlib, glbLoader } = world;
    const ctx = {
      THREE, stdlib, tier: elementQualityTier, glbLoader,
      logoAssetsById: artworkUrl ? { [PRIMARY_ARTWORK_LOGO_ID]: { dataUrl: artworkUrl } } : {},
    };
    const factory = getFactory('hanging-tshirt');
    if (!world.tshirtPrimaryEntry) {
      const object = factory.create(ctx);
      world.elementsGroup.add(object);
      world.tshirtPrimaryEntry = { object, factory };
    }
    const raw = buildPrimaryTshirtInstanceRaw({ mat, phys, anim, tshirtPrint, hasArtwork: Boolean(artworkUrl) });
    const instance = normalizeElementInstance(raw, 'hanging-tshirt');
    factory.applyInstance(ctx, world.tshirtPrimaryEntry.object, instance);
    world.tshirtPrimaryEntry.instance = instance;
  }, [clothShape, worldReady, mat, phys, anim, tshirtPrint, artworkUrl, elementQualityTier]);

  // ── Primary Device Mockup lifecycle (Phase 4 — third primary shape) ─────
  // The SAME getFactory('device-mockup') contract an extras instance uses
  // (mirroring the tshirt primary entry above exactly), just centered at
  // the origin at hero scale — the Mockup Video framing: a steady device
  // as the scene's focal subject, website playing on its screen. The
  // sheet-rebuild effect above already disposes the flyer for ANY
  // non-'sheet' shape, so exactly one primary object exists either way.
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.elementsGroup) return;
    if (clothShape !== 'device') {
      // No device on stage ⇒ no screen for a shared tab to land on. Release
      // the capture track rather than leave Chrome's sharing indicator up for
      // a surface nothing is displaying.
      if (world.deviceShare) stopScreenShare('Tab sharing stopped — there is no device screen in this subject.');
      if (world.devicePrimaryEntry) {
        world.devicePrimaryEntry.factory.dispose(world.devicePrimaryEntry.object);
        world.elementsGroup.remove(world.devicePrimaryEntry.object);
        world.devicePrimaryEntry = null;
      }
      return;
    }
    const { THREE, stdlib } = world;
    const deviceScreenAssetsById = {};
    deviceScreenLibrary.forEach((a) => { deviceScreenAssetsById[a.assetId] = a; });
    // SHARE TAB (Phase 9) — the externally-owned VideoTexture enters the
    // factory through the SAME ctx the upload library uses, so it resolves
    // through deviceWantedScreenSource/deviceSyncScreenTexture like every
    // other screen source (and is therefore re-applied automatically after a
    // topology rebuild). The cover-fit is computed HERE, from this viewport's
    // screen aspect, so the factory stays pure number-consuming code.
    const shareTexture = (screenShare && world.deviceShare?.texture) || null;
    const deviceShare = shareTexture ? {
      texture: shareTexture,
      sourceWidth: screenShare.sourceWidth,
      sourceHeight: screenShare.sourceHeight,
      fit: computeScreenCoverFit({
        screenAspect: deviceScreenAspect(devicePrimary.viewport),
        sourceWidth: screenShare.sourceWidth,
        sourceHeight: screenShare.sourceHeight,
      }),
    } : null;
    const ctx = { THREE, stdlib, tier: elementQualityTier, deviceScreenAssetsById, deviceShare };
    const factory = getFactory('device-mockup');
    if (!world.devicePrimaryEntry) {
      const object = factory.create(ctx);
      world.elementsGroup.add(object);
      world.devicePrimaryEntry = { object, factory };
    }
    // Vertical placement — seat the device's lowest point on the active
    // scene set's floor plane (the same sc.groundY the bg effect positions
    // world.ground at), so desktop/mobile/tablet each land at THEIR own
    // contact height instead of sharing one floating origin. posY rides on
    // top as the manual/keyframeable offset; with no visible floor (color/
    // image/transparent modes, or a floorless set) seatY is 0 and posY is
    // the whole story. Stashed on world for the render loop's per-frame
    // timeline override (mirrors scrollPositionOverride).
    const deviceModelId = devicePrimary.models?.[devicePrimary.viewport] || '';
    const seatY = (devicePrimary.seatOnFloor && bgMode === 'scene' && effectiveScene.ground)
      ? (effectiveScene.groundY ?? -1.15) - deviceBottomLocalY(devicePrimary.viewport, deviceModelId) * devicePrimary.scale
      : 0;
    world.deviceSeatY = seatY;
    world.devicePosY = devicePrimary.posY || 0;
    const instance = normalizeElementInstance({
      id: 'device-primary', type: 'device-mockup', enabled: true, depth: 'hero',
      transform: { position: [0, seatY + (devicePrimary.posY || 0), 0], rotation: [0, 0, 0], scale: [devicePrimary.scale, devicePrimary.scale, devicePrimary.scale] },
      material: { color: devicePrimary.color, accent: devicePrimary.accent, claySoftness: devicePrimary.claySoftness, clayColor: devicePrimary.clayColor },
      motion: { rotate: devicePrimary.sway, speed: devicePrimary.swaySpeed },
      appearance: {
        viewport: devicePrimary.viewport, model: deviceModelId, finish: devicePrimary.finish,
        shellTexture: devicePrimary.shellTexture,
        scroll: devicePrimary.scroll, scrollSpeed: devicePrimary.scrollSpeed,
        scrollPosition: devicePrimary.scrollPosition,
        captureUrl: devicePrimary.captureUrl, uploadAssetId: devicePrimary.uploadAssetId,
      },
    }, 'device-mockup');
    factory.applyInstance(ctx, world.devicePrimaryEntry.object, instance);
    world.devicePrimaryEntry.instance = instance;
    // Live-screen hole survives rebuilds: a topology change (viewport/
    // accent) just rebuilt the screen mesh with the factory's textured
    // material — if a live iframe is up, re-punch the hole on the FRESH
    // mesh (the live effect itself only re-runs on live/liveUrl/viewport
    // changes, deliberately, so an accent tweak won't reload the site).
    // Builds a FRESH hole material rather than reusing world.deviceLive's
    // existing one: deviceRebuild's own clearGroup() (elements/factories.js)
    // just disposed the OLD mesh's material a few lines up in
    // applyInstance() above — and if Live was genuinely up at that moment,
    // that WAS this exact holeMat object (mesh.material === it). Reassigning
    // an already-disposed material to a new mesh is not something to rely
    // on — a renderer that already released a disposed material's GPU
    // program/uniforms has no obligation to reproduce it identically on
    // reuse. Disposing the stale reference and minting a fresh one keeps
    // this path correct for every rebuild the live-screen effect itself
    // doesn't also re-run for (accent/model/finish/shellTexture — viewport
    // DOES also retrigger that effect, which replaces this one again).
    const liveMesh = world.devicePrimaryEntry.object.userData.screenMesh;
    if (world.deviceLive && liveMesh && liveMesh.material !== world.deviceLive.holeMat) {
      world.deviceLive.holeMat?.dispose();
      const freshHoleMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending });
      world.deviceLive.holeMat = freshHoleMat;
      liveMesh.material = freshHoleMat;
    }
    // `screenShare` is in the deps because starting/stopping a share (and a
    // mid-share surface switch, which changes sourceWidth/Height) must re-run
    // applyInstance — that is the one path that installs/removes the shared
    // texture on the screen mesh.
  }, [clothShape, worldReady, devicePrimary, deviceScreenLibrary, elementQualityTier, bgMode, effectiveScene, screenShare, stopScreenShare]);

  // ── LIVE device screen (Phase 7) — a real interactive <iframe> in the
  // CSS3D layer behind the canvas, with the WebGL screen mesh swapped to an
  // alpha-0 punch-through material so the iframe shows through the hole
  // (correctly occluded by anything 3D drawn over it; both finish passes
  // write base.a, so the hole survives the whole fx chain). Preview-only:
  // exports capture the WebGL canvas, where the screen is a transparent
  // hole — the UI says so. Runs AFTER the primary lifecycle effect above
  // (React effect order), so a rebuild's fresh screen mesh/material is
  // what gets the hole. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.cssScene) return undefined;
    const { THREE } = world;
    const screenMesh = world.devicePrimaryEntry?.object?.userData?.screenMesh;
    // The ONE teardown implementation, shared with the export guard (which
    // must tear the iframe down synchronously rather than wait on a React
    // commit) — see teardownLiveScreenNow at module scope.
    const restore = () => teardownLiveScreenNow(world);
    const wantLive = clothShape === 'device' && devicePrimary.live && Boolean(devicePrimary.liveUrl) && screenMesh;
    if (!wantLive) { restore(); return undefined; }

    // Guarded: a failure here must degrade to "no live screen" (restore ran,
    // the textured screen still shows) — never crash the effect, which
    // would unmount/remount the whole studio and reload stale settings.
    try {
      const vp = { desktop: { w: 1440, h: 900, r: 14 }, mobile: { w: 390, h: 844, r: 48 }, tablet: { w: 768, h: 1024, r: 32 } }[devicePrimary.viewport]
        || { w: 1440, h: 900, r: 14 };
      let src = devicePrimary.liveUrl.trim();
      if (!/^https?:\/\//i.test(src)) src = `https://${src}`;

      restore(); // drop any previous iframe/hole before rebuilding both
      const wrapper = document.createElement('div');
      Object.assign(wrapper.style, {
        width: `${vp.w}px`, height: `${vp.h}px`, overflow: 'hidden',
        borderRadius: `${vp.r}px`, background: '#ffffff', pointerEvents: 'auto',
      });
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, { width: '100%', height: '100%', border: '0', display: 'block' });
      iframe.src = src;
      wrapper.appendChild(iframe);
      const cssObject = new world.CSS3DObject(wrapper);
      world.cssScene.add(cssObject);
      world.deviceLive = { object: cssObject, wrapper, iframe };

      const mesh = world.devicePrimaryEntry.object.userData.screenMesh;
      // NoBlending + opacity 0 + black: writes rgba(0,0,0,0) straight into the
      // canvas — a true transparent hole under premultiplied compositing (rgb
      // must be 0 or it would ADD over the iframe). Stored on deviceLive so
      // the primary lifecycle effect can RE-apply it after a topology
      // rebuild (viewport/accent change) replaces the screen mesh/material.
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending });
      world.deviceLive.holeMat = holeMat;
      mesh.material = holeMat;
      // Deliberate one-line diagnostic (not a leftover debug log): "the live
      // URL doesn't load at the Tablet viewport" was reported without a
      // reproduction, and every layer this effect owns is viewport-symmetric
      // in code. This records what was actually built — which viewport, the
      // iframe's layout size, and whether the hole landed on the CURRENT
      // screen mesh — so the next report carries evidence instead of
      // inference. Fires once per live-screen (re)build, never per frame.
      console.warn('[device live screen] built', {
        viewport: devicePrimary.viewport, src, iframePx: `${vp.w}×${vp.h}`,
        holePunched: mesh.material === holeMat,
      });
    } catch (err) {
      console.warn('[device live screen] failed to build live frame:', err);
      restore();
    }
    return restore;
    // Deps are the SPECIFIC live inputs — never the whole devicePrimary
    // object. The first cut used devicePrimary itself, which tore down and
    // reloaded the live site on EVERY primary-device tweak (every URL
    // keystroke, every scroll/scale slider move) — the reported "it keeps
    // loading the old site" bug: mid-typing rebuilds + a remount racing a
    // second open studio tab's settings writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clothShape, worldReady, devicePrimary.live, devicePrimary.liveUrl, devicePrimary.viewport]);

  // INTERACT mode — routes pointer events to the live iframe (canvas stops
  // eating them; orbit pauses because the canvas gets none). Ephemeral by
  // design: never persisted, drops out automatically when live mode ends.
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.cssRenderer) return;
    const on = deviceInteract && clothShape === 'device' && devicePrimary.live && Boolean(devicePrimary.liveUrl);
    world.renderer.domElement.style.pointerEvents = on ? 'none' : 'auto';
    world.cssRenderer.domElement.style.pointerEvents = on ? 'auto' : 'none';
  }, [deviceInteract, clothShape, devicePrimary.live, devicePrimary.liveUrl, worldReady]);

  // ── Background — flat modes reset the rig; Scene mode dresses the set:
  // backdrop texture, fog, themed key/rim, spotlight, shadow ground. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world) return;
    const { THREE, scene } = world;
    // Cached panorama textures are shared across scene switches — only
    // dispose backgrounds this effect itself created (procedural canvases,
    // uploaded images).
    if (world.bgTextureOwned !== false) world.bgTexture?.dispose();
    world.bgTexture = null;
    world.bgTextureOwned = true;
    world.bgCoverInfo = null;
    // Staleness token for async backdrop loads (panorama sets): a texture
    // that finishes loading AFTER this effect re-ran for a different mode/
    // scene must never clobber the newer background.
    const runToken = (world.bgRunToken = (world.bgRunToken || 0) + 1);
    // Non-pano backgrounds reset the pano-only scene knobs and give the
    // IBL back to the Environment card's own selection.
    const resetPano = () => {
      scene.backgroundBlurriness = 0;
      scene.backgroundIntensity = 1;
      if (scene.backgroundRotation) scene.backgroundRotation.set(0, 0, 0);
      if (world.envOverriddenByPano) {
        world.envOverriddenByPano = false;
        world.setEnvironment?.(world.lastEnvId || 'room');
      }
    };
    // Lights are owned by the Lighting card (cans) — the scene only dresses
    // backdrop, fog, and floor; scene CLICK handlers apply the matching can
    // template so it stays user-tweakable afterwards.
    const resetRig = () => {
      scene.fog = null;
      world.ground.visible = false;
      world.ground.position.y = -1.15;
      resetPano();
    };
    if (bgMode === 'scene') {
      const sc = composeSceneDef(getSceneDef(sceneId) || SCENE_PRESETS.thriller, sceneTweaks);
      const tex = new THREE.CanvasTexture(paintSceneBackdrop(sc.backdrop));
      tex.colorSpace = THREE.SRGBColorSpace;
      world.bgTexture = tex;
      scene.background = tex;
      // Panorama sets: the procedural gradient above paints instantly; the
      // 360° plate (HDR or webp) swaps in when loaded as a TRUE equirect
      // sky — camera-correct, pans as you orbit, with matched IBL so the
      // hardware reflects the same room it stands in. This replaced the
      // first flat-photo attempt, which pasted a warped panorama as a
      // static backdrop ("the bg image is weird" — owner, correctly).
      if (sc.pano) {
        const applyPano = (raw) => {
          if (world.bgRunToken !== runToken) return; // background changed while loading
          raw.mapping = THREE.EquirectangularReflectionMapping;
          if (world.bgTextureOwned !== false) world.bgTexture?.dispose();
          world.bgTexture = raw;
          world.bgTextureOwned = false; // cached — never disposed by mode switches
          world.bgCoverInfo = null;
          scene.background = raw;
          scene.backgroundBlurriness = sc.panoBlur || 0;
          scene.backgroundIntensity = sc.panoIntensity ?? 1;
          if (scene.backgroundRotation) scene.backgroundRotation.set(0, ((sc.panoRotY || 0) * Math.PI) / 180, 0);
          // Matched image-based lighting from the same plate (cached too).
          world.panoIblCache = world.panoIblCache || {};
          if (!world.panoIblCache[sc.pano]) world.panoIblCache[sc.pano] = world.pmrem.fromEquirectangular(raw).texture;
          scene.environment = world.panoIblCache[sc.pano];
          world.envOverriddenByPano = true;
        };
        world.panoCache = world.panoCache || {};
        if (world.panoCache[sc.pano]) {
          applyPano(world.panoCache[sc.pano]);
        } else if (/\.hdr$/i.test(sc.pano)) {
          world.rgbeLoader.load(sc.pano, (hdr) => { world.panoCache[sc.pano] = hdr; applyPano(hdr); }, undefined,
            () => console.warn('[holocloth] pano HDR load failed', sc.pano));
        } else {
          new THREE.TextureLoader().load(sc.pano, (t) => { t.colorSpace = THREE.SRGBColorSpace; world.panoCache[sc.pano] = t; applyPano(t); }, undefined,
            () => console.warn('[holocloth] pano load failed', sc.pano));
        }
      } else {
        resetPano();
      }
      scene.fog = sc.fog ? new THREE.FogExp2(new THREE.Color(sc.fog.color).getHex(), sc.fog.density) : null;
      if (sc.ground) {
        world.ground.visible = true;
        // Desk-style sets raise the floor to meet the device's stand foot
        // so the monitor SITS on the surface; stage sets keep the deep floor.
        world.ground.position.y = sc.groundY ?? -1.15;
        const groundMat = world.ground.material;
        const surf = GROUND_TEXTURES[sc.groundTex];
        if (surf) {
          // Textured floor: the map carries the color, so tint defaults to
          // white; the flat preset `ground` color remains the pre-load look.
          groundMat.color.set(sc.groundTint || '#ffffff');
          world.groundTexCache = world.groundTexCache || {};
          const applySurf = (entry) => {
            if (world.bgRunToken !== runToken) return;
            groundMat.map = entry.map;
            groundMat.roughnessMap = entry.rough;
            groundMat.needsUpdate = true;
          };
          if (world.groundTexCache[sc.groundTex]) {
            applySurf(world.groundTexCache[sc.groundTex]);
          } else {
            groundMat.color.set(sc.ground); // flat tone until the surface lands
            const loader = new THREE.TextureLoader();
            Promise.all([
              new Promise((res, rej) => loader.load(surf.map, res, undefined, rej)),
              new Promise((res, rej) => loader.load(surf.rough, res, undefined, rej)),
            ]).then(([map, rough]) => {
              map.colorSpace = THREE.SRGBColorSpace;
              [map, rough].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(surf.repeat, surf.repeat); t.anisotropy = 8; });
              world.groundTexCache[sc.groundTex] = { map, rough };
              if (world.bgRunToken === runToken) { groundMat.color.set(sc.groundTint || '#ffffff'); applySurf(world.groundTexCache[sc.groundTex]); }
            }).catch(() => console.warn('[holocloth] ground texture load failed', sc.groundTex));
          }
        } else {
          groundMat.color.set(sc.ground);
          if (groundMat.map || groundMat.roughnessMap) {
            groundMat.map = null;
            groundMat.roughnessMap = null;
            groundMat.needsUpdate = true;
          }
        }
      } else {
        world.ground.visible = false;
        world.ground.position.y = -1.15;
      }
    } else if (bgMode === 'color') {
      resetRig();
      scene.background = new THREE.Color(bgColor);
    } else if (bgMode === 'image' && bgImageEl) {
      resetRig();
      const imgAspect = (bgImageEl.naturalWidth || bgImageEl.width || 1) / (bgImageEl.naturalHeight || bgImageEl.height || 1);
      if (bgFx.fit === 'contain') {
        // Contain is BAKED: the whole image letterboxed into a canvas at the
        // stage's current aspect, bars filled with the background color
        // (texture repeat tricks can't paint bars — edge-clamp would streak).
        // The bake's own aspect feeds the per-frame cover math below, so a
        // later window resize degrades to a mild centered crop of the bake
        // rather than a skew; changing fit/shift/color/image re-bakes.
        const stageAspect = (world.renderer?.domElement?.clientWidth || 16) / Math.max(1, world.renderer?.domElement?.clientHeight || 9);
        const c = document.createElement('canvas');
        c.width = 2048; c.height = Math.max(2, Math.round(2048 / stageAspect));
        const x = c.getContext('2d');
        x.fillStyle = bgColor; x.fillRect(0, 0, c.width, c.height);
        const l = computeContainLayout(imgAspect, stageAspect, bgFx.shiftY);
        x.drawImage(bgImageEl, l.x * c.width, l.y * c.height, l.w * c.width, l.h * c.height);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        world.bgTexture = tex;
        world.bgCoverInfo = { aspect: stageAspect, shiftY: 0 };
        scene.background = tex;
      } else {
        const tex = new THREE.Texture(bgImageEl);
        tex.colorSpace = THREE.SRGBColorSpace;
        // Cover-fit (or raw stretch): scene.background samples the texture
        // across the whole canvas, so a ratio mismatch would skew the image.
        // bgCoverInfo arms the render loop's per-frame cover math (repeat/
        // offset crop the SHORTER-fitting axis, CSS background-size:cover
        // semantics, SHIFT sliding the window through the vertical slack) —
        // recomputed every frame so window resizes and export-resolution
        // changes stay correct with no extra hooks. 'stretch' opts out.
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        world.bgTexture = tex;
        world.bgCoverInfo = bgFx.fit === 'stretch' ? null : { aspect: imgAspect, shiftY: bgFx.shiftY };
        scene.background = tex;
      }
    } else if (bgMode === 'image') {
      // Image mode with NO image loaded (uploads are session-only — a
      // reload drops them): fall back to the SOLID background color, never
      // to transparent. The accidental-transparent state read as "nothing
      // displays": the whole canvas went see-through to the stage (and, in
      // live-screen mode, to the giant CSS3D iframe behind it).
      resetRig();
      scene.background = new THREE.Color(bgColor);
    } else {
      resetRig();
      scene.background = null; // transparent — checkerboard shows through the canvas
    }
  }, [bgMode, bgColor, bgImageEl, bgFx, sceneId, sceneTweaks, getSceneDef, worldReady]);

  // ── Artwork library. ──
  // Put a loaded image onto both faces (front normal, back mirrored).
  const applyArtworkImage = useCallback((img, label) => {
    const world = worldRef.current;
    if (!world) return;
    const { THREE, clothMat, clothBackMat, mirrorTex } = world;
    clothMat.map?.dispose();
    clothBackMat.map?.dispose();
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = world.renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    clothMat.map = tex;
    clothMat.needsUpdate = true; // program gains USE_MAP; onBeforeCompile re-runs with the same uniform objects
    clothBackMat.map = mirrorTex(tex); // back face mirrored so it reads right
    clothBackMat.needsUpdate = true;
    setArtworkName(label);
    setArtworkRatio(img.width / img.height);
    setClothAspect('auto');
    setArtworkUrl(img.src); // one source of truth for the T-shirt's front print — see elements/primary-cloth.js
  }, []);

  // Pick from the dropdown — built-ins by URL, saved uploads by data URL.
  const selectArtwork = useCallback((id) => {
    const builtin = BUILTIN_ARTWORKS.find((a) => a.id === id);
    const stored = !builtin ? artworkLib.find((a) => a.id === id) : null;
    const src = builtin?.url || stored?.dataUrl;
    if (!src) return;
    const img = new Image();
    img.onload = () => applyArtworkImage(img, builtin?.label || stored?.label || 'Artwork');
    img.src = src;
    setArtworkId(id);
  }, [artworkLib, applyArtworkImage]);

  // Upload — applied to the sheet AND saved to this browser's library
  // (resized data URL in localStorage; survives reloads, no account needed).
  const onArtworkUpload = useCallback((file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      applyArtworkImage(img, file.name);
      // The map is MULTIPLIED by base color, and metal + zero-rough surfaces
      // kill diffuse — snap to an image-friendly base so the upload reads.
      setMat((m) => ({
        ...m,
        preset: '',
        baseColor: '#ffffff',
        metalness: Math.min(m.metalness, 0.12),
        roughness: Math.max(m.roughness, 0.35),
        bump: Math.min(m.bump, 0.35),
      }));
      // Save a resized copy into the library.
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const entry = { id: `saved-${img.width}x${img.height}-${file.size}-${file.name}`, label: file.name, dataUrl: c.toDataURL('image/jpeg', 0.82) };
      setArtworkId(entry.id);
      setArtworkLib((prev) => {
        const next = [...prev.filter((a) => a.id !== entry.id), entry];
        try { window.localStorage.setItem(ARTWORK_LIB_KEY, JSON.stringify(next)); }
        catch { setStatus('Image applied, but too large to save in this browser’s library.'); return prev; }
        return next;
      });
    };
    img.src = URL.createObjectURL(file);
  }, [applyArtworkImage]);

  // Remove a saved upload from the library; falls back to the default look.
  const deleteSavedArtwork = useCallback((id) => {
    setArtworkLib((prev) => {
      const next = prev.filter((a) => a.id !== id);
      try { window.localStorage.setItem(ARTWORK_LIB_KEY, JSON.stringify(next)); } catch { /* non-critical */ }
      return next;
    });
    selectArtwork(DEFAULT_ARTWORK_ID);
  }, [selectArtwork]);
  const clearArtwork = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.clothMat.map?.dispose();
    world.clothMat.map = null;
    world.clothMat.needsUpdate = true;
    world.clothBackMat.map?.dispose();
    world.clothBackMat.map = null;
    world.clothBackMat.needsUpdate = true;
    setArtworkName('');
    setArtworkId('');
    setArtworkRatio(null); // 'auto' falls back to portrait
    setArtworkUrl(null); // T-shirt front print falls back to "no print" too
  }, []);
  const onBumpUpload = useCallback((file) => {
    const world = worldRef.current;
    if (!world || !file) return;
    const img = new Image();
    img.onload = () => {
      const { THREE, clothMat, clothBackMat, mirrorTex } = world;
      clothMat.bumpMap?.dispose();
      clothBackMat.bumpMap?.dispose();
      const tex = new THREE.Texture(img);
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      clothMat.bumpMap = tex;
      clothMat.needsUpdate = true;
      clothBackMat.bumpMap = mirrorTex(tex);
      clothBackMat.needsUpdate = true;
      setBumpName(file.name);
      setMat((m) => ({ ...m })); // re-apply tiling to the new maps
    };
    img.src = URL.createObjectURL(file);
  }, []);
  const onBgImageUpload = useCallback((file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => { setBgImageEl(img); setBgMode('image'); };
    img.src = URL.createObjectURL(file);
  }, []);

  // ── Exports. ──
  const exportPng = useCallback((transparent = false) => {
    const world = worldRef.current;
    if (!world) return;
    const { renderer, scene } = world;
    const cam = world.activeCamera();
    const prevBg = scene.background;
    const prevPr = renderer.getPixelRatio();
    const nw = stageRef.current?.clientWidth || renderer.domElement.clientWidth;
    const nh = stageRef.current?.clientHeight || renderer.domElement.clientHeight;
    const fr = FRAME_PRESETS[frameId];
    const useFx = !transparent && world.fxActive?.();
    try {
      if (transparent) scene.background = null;
      // Hi-res one-shot — bump the ratio, reallocate the buffer, render, snapshot.
      const boost = Math.min((window.devicePixelRatio || 1) * 2, 4);
      renderer.setPixelRatio(boost);
      renderer.setSize(nw, nh, false);
      if (useFx) {
        // Bloom/grain/vignette belong in the still too (transparent skips FX —
        // bloom composites against black and would kill the alpha).
        world.composer.setPixelRatio(boost);
        world.composer.setSize(nw, nh);
        // diffuseTarget is a plain WebGLRenderTarget, not composer-managed —
        // size it to match composer's own boosted buffers explicitly.
        world.diffuseTarget?.setSize(nw * boost, nh * boost);
        world.syncFrameUniforms?.(nw, nh); // vignette shaped to the crop being written
        // uRes deliberately keeps the live-canvas value here: treatment pitch
        // (dots, blocks, scanlines) is defined in preview pixels, so the boosted
        // export renders the same pattern at higher fidelity instead of
        // shrinking it to half size.
        world.renderPass.camera = cam;
        world.runFxFinishChain(); // already carries the Hero Text overlay (see its own header above)
      } else {
        renderer.render(scene, cam);
        // Hero Text overlay — the fx branch above gets this for free via
        // runFxFinishChain; the plain branch (transparent PNG, where bloom
        // would kill the alpha, AND the FX-off still) needs the same
        // "render on top, autoClear off" compositing added explicitly so
        // text appears in EVERY PNG variant, not just the FX-on one.
        if (world.textOverlayScene && textLayers.some((l) => l.on)) {
          renderer.autoClear = false;
          renderer.clearDepth();
          renderer.render(world.textOverlayScene, world.textOverlayCam);
          renderer.autoClear = true;
        }
      }
      // world.textOverlayCam is sized in CSS px (setOverlayCamSize) and this
      // export renders at the SAME nw/nh CSS stage size, just with a boosted
      // pixelRatio (see renderer.setPixelRatio(boost) above) — nothing about
      // the overlay camera needs to change for this boosted still.
      const suffix = `${fr?.slug ? `-${fr.slug}` : ''}${transparent ? '-transparent' : ''}`;
      if (fr && fr.w) {
        // Crop the capture frame at 2× platform-native resolution.
        const src = renderer.domElement;
        const r = computeFrameRect(nw, nh, fr.w / fr.h);
        const sx = src.width / nw, sy = src.height / nh;
        const off = document.createElement('canvas');
        off.width = fr.w * 2; off.height = fr.h * 2;
        off.getContext('2d').drawImage(src, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, off.width, off.height);
        off.toBlob((blob) => {
          if (blob) downloadBlob(blob, `holocloth-${Date.now()}${suffix}.png`);
          setStatus(`Exported ${fr.label} PNG.`);
          // Recovery round 2, Defect 2's fix — the export attempt has now
          // actually completed (readback done); resume Live if it was
          // paused for this attempt and nothing changed the screen source
          // meanwhile. See resumeLiveAfterExport's own header comment.
          resumeLiveAfterExport();
        }, 'image/png');
      } else {
        // toBlob captures the bitmap at call time, so restoring below is safe.
        renderer.domElement.toBlob((blob) => {
          if (blob) downloadBlob(blob, `holocloth-${Date.now()}${suffix}.png`);
          setStatus(transparent ? 'Exported transparent PNG.' : 'Exported PNG.');
          resumeLiveAfterExport();
        }, 'image/png');
      }
    } finally {
      scene.background = prevBg;
      renderer.setPixelRatio(prevPr);
      renderer.setSize(nw, nh, false);
      if (useFx) {
        world.composer.setPixelRatio(prevPr);
        world.composer.setSize(nw, nh);
        world.diffuseTarget?.setSize(nw * prevPr, nh * prevPr);
      }
      renderer.render(scene, cam);
    }
  }, [frameId, textLayers, resumeLiveAfterExport]);

  // `overrideSeconds` (Phase 4) — exportTimeline (below) needs the recording
  // to bracket exactly `ceil(timelineDuration(timeline))` seconds, computed
  // synchronously in the SAME tick it calls this. Passing it as an argument
  // avoids the classic "setVideoSeconds then immediately read videoSeconds"
  // stale-closure bug (this callback's own `videoSeconds` reference is
  // whatever was current when THIS memoized instance was created, not
  // whatever setVideoSeconds was just called with a moment ago). Every
  // existing call site keeps calling exportVideo() with no argument and
  // behaves exactly as before — effSeconds falls back to `videoSeconds`.
  // `displayCapture` (Phase 8) — `{ stream, video, track }` from
  // getDisplayMedia, acquired IN the click's user-gesture chain by
  // runWithLiveScreenCapture below. When present the recording samples the
  // COMPOSITED TAB (so the live CSS3D website iframe is genuinely in the
  // video) instead of the WebGL canvas; everything downstream — the crop
  // into an offscreen canvas at the frame's native size, startExportCapture,
  // the MediaRecorder lifecycle, cleanup() — is the SAME code, unforked.
  const exportVideo = useCallback((overrideSeconds, displayCapture) => {
    const world = worldRef.current;
    if (!world || recording) { stopDisplayCapture(displayCapture); return; }
    const effSeconds = Number.isFinite(overrideSeconds) && overrideSeconds > 0 ? overrideSeconds : videoSeconds;
    const { renderer } = world;
    const fr = FRAME_PRESETS[frameId];

    // Tab-capture crop, resolved BEFORE anything is allocated: the stage
    // canvas's on-screen rect mapped into the stream's own pixel space (by
    // the MEASURED stream/viewport ratio, never devicePixelRatio), then
    // inset to the active capture frame's aspect. A crop that can't be
    // satisfied (stage partly off-screen, stream not sized yet) stops here
    // with the reason — never a silently wrong recording.
    let displayRect = null;
    if (displayCapture) {
      displayRect = computeDisplayCaptureRect({
        streamWidth: displayCapture.video?.videoWidth,
        streamHeight: displayCapture.video?.videoHeight,
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
        canvasRect: renderer.domElement.getBoundingClientRect(),
        frame: (fr && fr.w) ? fr : null,
      });
      if (!displayRect.ok) {
        console.warn('[holocloth] export aborted', { reason: 'display-capture-crop-invalid', detail: displayRect.reason });
        stopDisplayCapture(displayCapture);
        setStatus(displayRect.reason);
        return;
      }
    }

    // Capability/memory/pixel-budget check against whatever is actually
    // being captured: the frame's own native size when a capture frame is
    // active (the crop is copied at exactly FRAME_PRESETS[frameId].w × .h,
    // never boosted), or the live renderer's own current size for 'off'.
    // fps is the worst case (HIGH_CAPTURE_FPS) chooseCaptureFps may still
    // select below, so the pixel-frame warning is never under-counted.
    const glLimits = readGlLimits(renderer);
    // Tab capture records whatever the crop resolves to (the frame's native
    // size with a frame active, the stage region's own stream-pixel size
    // without one) — check THAT, not the renderer's backing store, which
    // this mode never samples.
    const checkWidth = displayRect ? displayRect.outWidth : ((fr && fr.w) ? fr.w : (renderer.domElement.width || 1));
    const checkHeight = displayRect ? displayRect.outHeight : ((fr && fr.w) ? fr.h : (renderer.domElement.height || 1));
    const capability = evaluateExportCapability({
      width: checkWidth, height: checkHeight, fps: HIGH_CAPTURE_FPS, seconds: effSeconds,
      maxTextureSize: glLimits.maxTextureSize,
      maxRenderbufferSize: glLimits.maxRenderbufferSize,
      maxViewportDims: glLimits.maxViewportDims,
      deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
      hasMediaRecorder: typeof MediaRecorder !== 'undefined',
      hasCaptureStream: typeof HTMLCanvasElement !== 'undefined' && Boolean(HTMLCanvasElement.prototype?.captureStream),
    });
    if (!capability.allowed) {
      console.warn('[holocloth] export aborted', { reason: 'capability-not-allowed', capabilityReason: capability.reason, width: checkWidth, height: checkHeight });
      setStatus(capability.reason);
      // Phase 8: this exit predates cleanup(), so the tab-capture stream it
      // was handed has to be released right here or Chrome keeps showing
      // (and running) the "sharing this tab" capture forever.
      stopDisplayCapture(displayCapture);
      // This fails before world.exportCancelRequested/cleanup() below even
      // exist, but the guard already paused Live for this attempt (mesh
      // restored, iframe torn down) — resume it here so a capability
      // rejection doesn't strand Live paused forever, the same reasoning
      // the no-supported-mime and unexpected-failure exits below already
      // apply. Safe no-op when nothing was paused for this attempt.
      resumeLiveAfterExport();
      return;
    }

    world.exportCancelRequested = false;
    let stream = null;
    let copying = false;
    let copyRaf = null;
    let captureFps = 30;
    // Export-restore round (Phase 2) — set when canSustainExportCapture
    // reads a low/unmeasurable throughput; carried into the "Recording…"
    // status below (rather than shown only in the instant it's detected,
    // which the very next status write would immediately overwrite) so the
    // warning stays visible for the length of the recording, not a flash.
    let unsustainableCaptureWarning = '';
    let cleanedUp = false;
    // Lifecycle-scoped (not local to the block that creates it — Codex
    // re-review, P2) so cleanup() can always reach and clear it, regardless
    // of whether the recorder ever actually started.
    let progressTimer = null;
    // Codex re-review (P1, round 3): the document.hidden check below only
    // covers the START of export — a tab backgrounded mid-recording hits
    // the SAME rAF throttling (the crop-copy loop and the renderer's own
    // render loop both stall) but nothing was watching for it once
    // recording was already under way. Registered once recording actually
    // starts (below), always removed by cleanup() on every exit path.
    let visibilityHandler = null;
    // Phase 8 — "Stop sharing" (the browser's own tab-capture bar) ends the
    // display track mid-recording. That is the user saying stop, so it is
    // treated exactly like the Cancel button rather than left to record
    // frozen frames until the duration timer expires. Registered once a
    // recorder exists, always removed by cleanup().
    let displayTrackEndedHandler = null;

    // Stops the crop-copy rAF loop (only relevant when a capture frame is
    // active — the 'off' path never starts one). Shared by cleanup() and by
    // startExportCapture's own failure paths (via buildCaptureSource's
    // returned `stopCropCopy`), so there is exactly one place that resets
    // `copying`/`copyRaf`, called from wherever the loop needs stopping.
    const stopCropCopyLoop = () => {
      copying = false;
      if (copyRaf) { cancelAnimationFrame(copyRaf); copyRaf = null; }
    };

    // Runs on EVERY exit path — natural completion, cancellation, or ANY
    // failure anywhere in the lifecycle (Codex re-review, P1 — see the
    // outer try/catch in startRecording below). Restoring here, on every
    // path, is what "restore in finally after success, cancellation, or
    // error" means for a MediaRecorder flow, where there is no single
    // literal try/finally block spanning the whole async/event-driven
    // recording lifecycle. Every individual restoration step below is its
    // OWN try/catch — best-effort PER OPERATION, so one failing can never
    // prevent the others from running.
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      stopCropCopyLoop();
      if (world.exportStopTimeout) { clearTimeout(world.exportStopTimeout); world.exportStopTimeout = null; }
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
      if (displayTrackEndedHandler) {
        try { displayCapture?.track?.removeEventListener('ended', displayTrackEndedHandler); } catch { /* track already gone */ }
        displayTrackEndedHandler = null;
      }
      try {
        stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
      } catch (err) {
        console.warn('[holocloth] stopping MediaStreamTracks during cleanup failed', err);
      }
      // Phase 8 — the tab-capture stream is a SECOND stream (the one above is
      // the offscreen canvas's own captureStream); both must be released on
      // every exit path, and this is the one function that runs on all of them.
      stopDisplayCapture(displayCapture);
      world.recorder = null;
      // Timeline v2 — a timeline-driven export (exportTimeline) owns
      // playback for exactly its recording's duration; once the recording
      // lifecycle ends (success, cancel, or any failure — every path routes
      // through this one cleanup()) that playback must end too, or the live
      // canvas would keep interpolating/looping past the clip that was
      // actually captured. The React-facing timelineMode state syncs back
      // to 'idle' via the lightweight poll effect (see playTimeline's own
      // comments) — no setState call belongs in here.
      if (world.timelineClock && world.timelineClock.mode !== 'idle') {
        world.timelineClock = { mode: 'idle', startedAt: 0, startU: 0, lastU: world.timelineClock.lastU ?? 0, lastFromIndex: null, lastTextLayersKey: null };
        world.timelineOverride = null;
        if (world.controls) world.controls.enabled = true;
      }
      // Fix (Hero Text Builder Phase 2 pass) — exportTimeline overrides the
      // VIDEO LENGTH select's React state to the timeline's own (usually
      // non-preset) duration before calling exportVideo (see exportTimeline's
      // own comment); that select only offers a fixed option list
      // ([3,5,8,10,15]s), so leaving that override in place made it render
      // blank once recording started AND stay blank forever after, since
      // nothing ever put it back. Restored here — the ONE function that
      // already runs on every exit path (success/cancel/error, see this
      // function's own header) — rather than at each of exportTimeline's
      // own call sites. A no-op for every ordinary (non-timeline) export:
      // the flag is only ever set by exportTimeline.
      if (Number.isFinite(world.videoSecondsBeforeTimelineExport)) {
        setVideoSeconds(world.videoSecondsBeforeTimelineExport);
        world.videoSecondsBeforeTimelineExport = null;
      }
      // Hero Text Phase 3 — every exit path (natural completion,
      // cancellation, or any failure — cleanup() is the one function that
      // runs on all of them, see this function's own header) returns the
      // shared clock to 'idle'. Safe even when recording never actually
      // reached the 'export' assignment above (early-return failure paths
      // above never touched textAnimClock, so this is a no-op then).
      world.textAnimClock = { mode: 'idle', tStart: 0, tEnd: null };
      setRecordingProgress(null);
      // Recovery round 2, Defect 2's fix — cleanup() runs on EVERY exit
      // path (success, cancel, and every failure, per this function's own
      // header comment above), so this is the one place that reliably
      // covers "the export attempt has settled" for both exportVideo and
      // exportTimeline (which owns playback through this same recording).
      // A safe no-op when nothing was paused for this attempt.
      resumeLiveAfterExport();
    };

    // Crop-copy source (only when a capture frame is active) — copies the
    // crop into an offscreen canvas at the frame's own native size
    // (FRAME_PRESETS[frameId].w × .h), matching the prod export exactly:
    // never a boosted/upscaled resolution. Passed into startExportCapture
    // (elements/video-export.js) as `buildCaptureSource` — that function
    // calls this, then calls `.captureStream()` on whatever it returns,
    // inside its own guarded sequence.
    const buildCaptureSource = () => {
      // Phase 8 — tab capture: same offscreen canvas, same rAF crop-copy,
      // same `{ source, stopCropCopy }` contract; only the SOURCE image
      // changes (the composited tab's <video> instead of the WebGL canvas),
      // which is what puts the live website in the file. The crop rect is
      // recomputed per frame so a rail panel opening / window resize keeps
      // the framing correct mid-recording, while the OUTPUT size stays
      // frozen at what the capability check above already approved (a
      // canvas resized mid-recording restarts the encoder's stream).
      if (displayCapture) {
        const off = document.createElement('canvas');
        off.width = displayRect.outWidth; off.height = displayRect.outHeight;
        const octx = off.getContext('2d');
        if (!octx) throw new Error('2D context unavailable for the tab-capture crop canvas.');
        const video = displayCapture.video;
        let lastRect = displayRect;
        copying = true;
        const copy = () => {
          if (!copying) return;
          const next = computeDisplayCaptureRect({
            streamWidth: video.videoWidth, streamHeight: video.videoHeight,
            viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
            canvasRect: renderer.domElement.getBoundingClientRect(),
            frame: (fr && fr.w) ? fr : null,
          });
          // A momentarily-invalid rect (mid-resize) reuses the last good one
          // rather than dropping the frame — the recording never gains a hole.
          if (next.ok) lastRect = next;
          if (video.readyState >= 2) {
            octx.drawImage(video, lastRect.sx, lastRect.sy, lastRect.sw, lastRect.sh, 0, 0, off.width, off.height);
          }
          copyRaf = requestAnimationFrame(copy);
        };
        copy();
        return { source: off, stopCropCopy: stopCropCopyLoop };
      }
      if (!fr || !fr.w) return { source: renderer.domElement, stopCropCopy: null };
      const off = document.createElement('canvas');
      off.width = fr.w; off.height = fr.h;
      const octx = off.getContext('2d');
      if (!octx) throw new Error('2D context unavailable for the crop-copy canvas.');
      const src = renderer.domElement;
      copying = true;
      const copy = () => {
        if (!copying) return;
        const cw = src.clientWidth, chh = src.clientHeight;
        if (cw && chh) {
          const r = computeFrameRect(cw, chh, fr.w / fr.h);
          const sx = src.width / cw, sy = src.height / chh;
          octx.drawImage(src, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, fr.w, fr.h);
        }
        copyRaf = requestAnimationFrame(copy);
      };
      copy();
      return { source: off, stopCropCopy: stopCropCopyLoop };
    };

    const startRecording = async (fmt, mime, isRetry = false) => {
      // Codex re-review (P1): the ENTIRE lifecycle below — captureStream(),
      // MediaRecorder construction, and both start() attempts — previously
      // had failure seams (captureStream() throwing, the FALLBACK
      // rec.start() also throwing) that sat OUTSIDE the one try/catch that
      // only ever guarded the MediaRecorder constructor. Since
      // startRecording() is invoked without being awaited or .catch()-ed,
      // any of those escaped as an unhandled rejection — cleanup() never
      // ran, leaving recording state stuck. This one try/catch now spans
      // the whole body, so ANY failure anywhere in it runs the SAME guarded
      // cleanup/restore path exactly once.
      try {
        if (!isRetry) {
          // Live re-verification of the P1 fix below (real ffprobe'd
          // exports, both before and after) kept producing a near-empty
          // capture regardless — traced to `document.hidden` being true for
          // the tab at export time. A hidden/backgrounded tab gets
          // requestAnimationFrame throttled so heavily (independent of
          // `document.hasFocus()`, which can still read true) that BOTH the
          // crop-copy loop (buildCaptureSource) and measureSustainableFps
          // itself barely run — the measurement below can hit its own
          // hard-timeout ceiling (resolving NaN, "unknown") rather than
          // reading a genuinely low number, so it doesn't reliably trigger
          // the fps-based block that follows. Checking visibility directly,
          // before spending any time on a doomed measurement, catches the
          // actual failure mode with a message that tells the user exactly
          // what to do about it (a low-fps device has no such fix).
          if (typeof document !== 'undefined' && document.hidden) {
            console.warn('[holocloth] export aborted', { reason: 'tab-hidden-before-measure' });
            cleanup();
            setRecording(false);
            setStatus('This tab is in the background — bring it to the foreground before exporting. A hidden tab throttles rendering too heavily to capture a real video.');
            return;
          }
          const warningSuffix = capability.warnings.length ? ` ${capability.warnings.join(' ')}` : '';
          setStatus(`Preparing ${(fr && fr.w) ? `${fr.w}×${fr.h}` : 'native'} export…${displayCapture ? ' Recording this tab, so the live website is in the video — keep the studio window on top and don’t switch tabs.' : ''}${warningSuffix}`);
          const measured = await measureSustainableFps();
          // Codex re-review (P1, round 5): the document.hidden check above
          // ran BEFORE this await — measureSustainableFps can take up to
          // its own 1500ms hard ceiling, a real wall-clock gap during which
          // the tab can go hidden with nothing watching (the mid-recording
          // visibilitychange listener isn't registered until much later,
          // once startExportCapture has actually built a recorder). Re-
          // checking here, immediately after the measurement resolves and
          // before any capture setup, closes that window with the exact
          // same guarded exit every other check in this block already uses.
          if (typeof document !== 'undefined' && document.hidden) {
            console.warn('[holocloth] export aborted', { reason: 'tab-hidden-after-measure' });
            cleanup();
            setRecording(false);
            setStatus('This tab went to the background while preparing the export — bring it to the foreground and try again.');
            return;
          }
          if (world.exportCancelRequested) { cleanup(); setRecording(false); setStatus('Export cancelled.'); return; }
          // Export-restore round (Phase 2): a low/unmeasurable reading no
          // longer aborts the export — the prod version this Studio build
          // regressed from measured nothing and always attempted the
          // recording. canSustainExportCapture (elements/video-export.js)
          // stays exported/tested unchanged; only this caller's response to
          // a `false` result changed, from a hard block to a warning that
          // is carried into the "Recording…" status below (a flash-then-
          // overwritten setStatus here would never be seen). chooseCaptureFps
          // still runs unconditionally right after and still lands on the
          // conservative 30fps for this exact case, same as before.
          if (!canSustainExportCapture(measured)) {
            console.warn('[holocloth] export proceeding despite low measured throughput', { reason: 'unsustainable-fps-advisory', measured, frameId });
            // Codex re-review (P1, round 5): previously interpolated
            // Math.round(measured) directly, rendering the literal "~NaNfps"
            // when measured was non-finite — describeUnsustainableCapture
            // (elements/video-export.js) formats this honestly either way.
            unsustainableCaptureWarning = ` This device measured under a smooth ${(fr && fr.w) ? `${fr.w}×${fr.h}` : 'native'} capture rate${describeUnsustainableCapture(measured)} — exporting anyway at a conservative frame rate; the result may stutter on this device.`;
          }
          // Phase 8 — tab capture is pinned to the rate the display track
          // was REQUESTED at (DEFAULT_CAPTURE_FPS): that request has to be
          // made in the click's gesture chain, long before this measurement
          // exists, and the display track — not the renderer — is what
          // actually limits this path. Asking the offscreen canvas for 60fps
          // against a 30fps source would only duplicate frames.
          captureFps = displayCapture ? DEFAULT_CAPTURE_FPS : chooseCaptureFps(measured);
        }

        const fmtLabel = VIDEO_FORMATS[fmt].label;

        let captured;
        try {
          captured = startExportCapture({
            buildCaptureSource, captureFps,
            MediaRecorderCtor: MediaRecorder, mime,
            videoBitsPerSecond: getBitrateFor(fmt),
          });
        } catch (err) {
          console.warn('[holocloth] export capture setup failed', mime, err);
          if (fmt === 'mp4' && !isRetry) {
            const wm = supportedMimeFor('webm');
            if (wm) { startRecording('webm', wm, true); return; }
          }
          throw err; // no retry available — let the outer catch below clean up
        }
        stream = captured.stream;
        const rec = captured.rec;

        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onerror = (e) => console.warn('[holocloth] recorder error', mime, e.error || e);
        rec.onstop = () => {
          stopCropCopyLoop();
          const total = chunks.reduce((s, b) => s + b.size, 0);
          console.warn('[holocloth] recording stopped', { mime, chunks: chunks.length, total });
          // Some Chrome builds report MP4 as supported but encode nothing —
          // detect the empty result and re-record as WebM instead of saving 0B.
          // Stays at the SAME resolution/captureFps already established above.
          if (!total && fmt === 'mp4' && !isRetry && !world.exportCancelRequested) {
            // Clear THIS attempt's progress timer before the retry reassigns
            // it below — otherwise attempt 1's interval handle is overwritten
            // by attempt 2's and never cleared, ticking setRecordingProgress
            // forever (it never fires 'stop' again, so cleanup() never runs
            // for it either).
            if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
            stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
            const wm = supportedMimeFor('webm');
            if (wm) { setStatus('MP4 encoder produced no data here — re-recording as WebM…'); startRecording('webm', wm, true); return; }
          }
          if (world.exportCancelRequested) { cleanup(); setRecording(false); setStatus('Export cancelled.'); return; }
          cleanup();
          setRecording(false);
          if (!total) { setStatus('Recording produced no data in this browser.'); return; }
          const blob = new Blob(chunks, { type: mime });
          const dims = fr?.w ? ` · ${fr.w}×${fr.h}` : (displayRect ? ` · ${displayRect.outWidth}×${displayRect.outHeight}` : '');
          const suffix = fr?.slug ? `-${fr.slug}` : '';
          downloadBlob(blob, `holocloth-${displayCapture ? 'live-' : ''}${Date.now()}${suffix}.${VIDEO_FORMATS[fmt].ext}`);
          // Honest about what this file actually is: a recording of the tab
          // surface, upscaled to the frame size from however many real
          // pixels the stage occupied on screen — never the same thing as
          // the canvas export's native-resolution frames.
          setStatus(`Exported ${effSeconds}s ${fmtLabel}${dims}${displayCapture ? ' — recorded from this tab (live website included; screen-resolution source, upscaled to the frame size)' : ''}.`);
        };
        world.recorder = rec;
        // Hero Text Phase 3 — bracket the WHOLE capture with the shared
        // textAnimClock, anchored to the SAME instant MediaRecorder
        // actually starts (not the earlier moment exportVideo() was first
        // called — measureSustainableFps + encoder setup above can take
        // real wall-clock time, and starting the clock any earlier would
        // let a fast in-animation finish before the first captured frame
        // even lands). effSeconds is the recording's own fixed duration,
        // so tEnd is always finite here — every layer's out-window is
        // anchored to the real end of the clip (computeTextAnimState's own
        // "out window anchored to tEnd" contract).
        //
        // Timeline v2 — SKIPPED when a timeline export owns this clock
        // instead (world.timelineClock.mode !== 'idle', set by
        // exportTimeline before calling exportVideo): stepTimelinePlayback
        // (module scope, above) retriggers world.textAnimClock per-shot at
        // every keyframe-pair boundary, and this "bracket the whole clip as
        // one giant in/out" assignment would otherwise stomp that the
        // moment recording actually starts. Every non-timeline export keeps
        // the exact Phase 3 behavior below, unchanged.
        if (!(world.timelineClock && world.timelineClock.mode !== 'idle')) {
          world.textAnimClock = { mode: 'export', tStart: world.clock.elapsedTime, tEnd: world.clock.elapsedTime + effSeconds };
        } else if (world.timelineClock.exporting) {
          // Export-restore Phase 5 — RE-ANCHOR the timeline to the instant
          // MediaRecorder actually starts. exportTimeline sets `startedAt`
          // and then calls exportVideo, which awaits measureSustainableFps
          // (up to its own 1500ms ceiling) plus encoder setup before any
          // frame is sampled — so playback was already ~1.5-2s in by the
          // time recording began, and reached `done` the same margin before
          // the recorder stopped. The clip lost its opening and ended on a
          // frozen final frame; on a short timeline that is most of the
          // video. Same reasoning as the textAnimClock anchoring above.
          // lastFromIndex/lastTextLayersKey reset so the opening pair's
          // discrete cut (and its headline) fires fresh on the next frame.
          world.timelineClock = {
            ...world.timelineClock,
            startedAt: world.clock.elapsedTime, startU: 0, lastU: 0, lastFromIndex: null, lastTextLayersKey: null,
          };
        }
        setRecording(true);
        setStatus(`Recording ${effSeconds}s ${fmtLabel}${(fr && fr.w) ? ` · ${fr.w}×${fr.h}` : ''}${displayCapture ? ' from this tab (live screen included)' : ''}…${unsustainableCaptureWarning}`);
        console.warn('[holocloth] recording started', { mime, isRetry, captureFps, frameId });
        const recordStartedAt = Date.now();
        // Reassigns the lifecycle-scoped `progressTimer` (declared above,
        // outside startRecording) rather than shadowing it locally — Codex
        // re-review, P2: if startMediaRecorderWithFallback() below throws
        // (both start attempts fail), the recorder never fires 'stop', so
        // nothing would ever clear a locally-scoped timer. cleanup() now
        // clears it directly, so this works on every exit path regardless
        // of whether the recorder ever actually started. Cleared first (not
        // just reassigned) in case a retry reaches here with attempt 1's
        // timer still ticking.
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        progressTimer = setInterval(() => {
          setRecordingProgress({ elapsed: Math.min(effSeconds, (Date.now() - recordStartedAt) / 1000), total: effSeconds });
        }, 200);

        // Throws if BOTH the timeslice start() and its no-args fallback
        // fail — previously that second throw had nowhere to go; now it's
        // caught by this same try, below.
        startMediaRecorderWithFallback(rec, 500);

        world.exportStopTimeout = setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, effSeconds * 1000);

        // Codex re-review (P1, round 3): cancel the SAME way the user's own
        // Cancel button does (cancelExportVideo) if the tab is backgrounded
        // while recording is already in flight — a hidden tab throttles
        // rAF badly enough mid-recording to produce the same broken/near-
        // empty output the start-of-export check above exists to prevent.
        // This whole section (including this registration) re-runs on a
        // retry (MP4->WebM fallback, or "MP4 produced no data") for its own
        // NEW `rec` — removing any previous handler first (rather than just
        // overwriting the `visibilityHandler` reference) keeps at most ONE
        // listener attached at a time instead of leaking one per retry.
        if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
        const onVisibilityChange = () => {
          if (!document.hidden) return;
          world.exportCancelRequested = true;
          if (world.exportStopTimeout) { clearTimeout(world.exportStopTimeout); world.exportStopTimeout = null; }
          try { rec.stop(); } catch { /* already stopped */ }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        visibilityHandler = onVisibilityChange;

        // Phase 8 — the browser's own "Stop sharing" button ends the display
        // track. Same response as the Cancel button (and as the hidden-tab
        // handler above), for the same reason: everything after this point
        // would be frozen/blank frames.
        if (displayCapture?.track) {
          if (displayTrackEndedHandler) {
            try { displayCapture.track.removeEventListener('ended', displayTrackEndedHandler); } catch { /* already gone */ }
          }
          const onDisplayTrackEnded = () => {
            console.warn('[holocloth] tab sharing stopped by the user mid-recording — cancelling the export');
            world.exportCancelRequested = true;
            if (world.exportStopTimeout) { clearTimeout(world.exportStopTimeout); world.exportStopTimeout = null; }
            try { rec.stop(); } catch { /* already stopped */ }
          };
          displayCapture.track.addEventListener('ended', onDisplayTrackEnded);
          displayTrackEndedHandler = onDisplayTrackEnded;
        }
      } catch (err) {
        console.warn('[holocloth] video export failed unexpectedly', err);
        stopCropCopyLoop();
        stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
        cleanup();
        setRecording(false);
        setStatus('Video export failed unexpectedly in this browser.');
      }
    };

    // Set immediately (not deferred to startRecording, which yields at its
    // own await) so the Export/Cancel buttons swap state right on click.
    setRecording(true);
    // Chosen container first; fall back to the other if unsupported here.
    let fmt = videoFormat;
    let mime = supportedMimeFor(fmt);
    if (!mime) { fmt = fmt === 'mp4' ? 'webm' : 'mp4'; mime = supportedMimeFor(fmt); }
    if (!mime) {
      console.warn('[holocloth] export aborted', { reason: 'no-supported-mime', videoFormat });
      setRecording(false);
      setStatus('Video capture unsupported in this browser.');
      // Phase 8 — another pre-cleanup() exit: release the tab-capture stream
      // here or the browser keeps sharing this tab with nothing recording it.
      stopDisplayCapture(displayCapture);
      // This fails before startRecording (and therefore cleanup()) ever
      // runs, but the guard already paused Live for this attempt — resume
      // it here so a browser lacking video support doesn't strand the
      // screen paused.
      resumeLiveAfterExport();
      return;
    }
    // Belt-and-suspenders backstop (Codex re-review, P1): startRecording's
    // own try/catch above should handle every real failure already and
    // never let its promise reject — this only fires if something
    // genuinely unexpected escaped even that (e.g. cleanup() itself
    // throwing), so the button/status never stay stuck regardless.
    startRecording(fmt, mime).catch((err) => {
      console.warn('[holocloth] unexpected export failure escaped the guarded lifecycle', err);
      setRecording(false);
      setStatus('Video export failed unexpectedly in this browser.');
      // Same reasoning — cleanup() SHOULD have already run and resumed
      // Live by this point; calling it again here is a safe no-op unless
      // cleanup() itself was what threw, in which case this is the only
      // remaining chance to resume.
      resumeLiveAfterExport();
    });
  }, [recording, videoSeconds, videoFormat, frameId, resumeLiveAfterExport]);

  // EXPORT TIMELINE — starts timeline playback (from u=0, 'playing' mode,
  // regardless of the loop preference — export always captures a single,
  // deterministic pass through the whole sequence; see timelineDuration's
  // own header) AND the existing exportVideo() capture together so the
  // recording brackets exactly one pass. A timeline far longer than
  // TIMELINE_EXPORT_MAX_SECONDS is capped, with a status note, rather than
  // attempting a multi-minute browser MediaRecorder capture no device here
  // can reliably sustain.
  const exportTimeline = useCallback((displayCapture) => {
    const world = worldRef.current;
    // exportTimeline is itself `fn` for runExportWithLiveGuard (the Export
    // Timeline button calls runExportWithLiveGuard(exportTimeline)) — by the
    // time awaitLiveScreenTeardownThenRun invokes this, the guard has
    // ALREADY paused Live for this attempt (mesh restored, iframe torn
    // down, world.pendingLiveResume stashed). Every early return below must
    // resume it, same as exportVideo's own no-supported-mime/capability
    // exits — otherwise a stale timelineMode/keyframe-count check strands
    // Live paused with nothing left to ever resume it.
    // Phase 8 — these two early returns predate exportVideo's cleanup(), so
    // a tab-capture stream acquired for THIS attempt has to be released here
    // as well; otherwise the browser keeps sharing the tab after an export
    // that never started.
    if (!world || recording || timelineMode !== 'idle') { stopDisplayCapture(displayCapture); resumeLiveAfterExport(); return; }
    if (timeline.keyframes.length < 2) {
      setStatus('Add at least 2 keyframes to export a timeline.');
      stopDisplayCapture(displayCapture);
      resumeLiveAfterExport();
      return;
    }
    const rawDuration = timelineDuration(timeline);
    const dur = Math.max(1, Math.ceil(Math.min(rawDuration, TIMELINE_EXPORT_MAX_SECONDS)));
    if (rawDuration > TIMELINE_EXPORT_MAX_SECONDS) {
      setStatus(`Timeline is ${rawDuration.toFixed(1)}s — capping the export to ${TIMELINE_EXPORT_MAX_SECONDS}s.`);
    }
    // First keyframe BY TRACK POSITION, not array position — see
    // retimeKeyframe's own comment for why the array can be out of
    // t-sorted order.
    const kf0 = timeline.keyframes.slice().sort((a, b) => a.t - b.t)[0];
    // stripDeviceScreenSource (export-restore Phase 5) — the opening
    // keyframe must not re-enable Go Live and rebuild the live iframe that
    // the export guard just tore down; see stepTimelinePlayback's own
    // comment on `applyRecipe` for the full rule.
    applySceneRecipe(stripDeviceScreenSource(kf0.recipe));
    if (kf0.orbitPose && !kf0.recipe?.shotCam?.use && world.camera && world.controls) {
      world.camera.position.set(kf0.orbitPose.px, kf0.orbitPose.py, kf0.orbitPose.pz);
      world.controls.target.set(kf0.orbitPose.tx, kf0.orbitPose.ty, kf0.orbitPose.tz);
    }
    world.timelineClock = { mode: 'playing', startedAt: world.clock.elapsedTime, startU: 0, timeline, lastU: 0, lastFromIndex: null, lastTextLayersKey: null, exporting: true };
    world.timelineOverride = null;
    if (world.controls) world.controls.enabled = false;
    setTimelineMode('playing');
    setScrubU(0);
    // Stashed on `world` (survives across the async export lifecycle, same
    // mutable-flag pattern world.timelineClock already uses) so
    // exportVideo's own cleanup() can restore the VIDEO LENGTH select's
    // pre-export value once recording ends — see that restore's own comment
    // for why overriding it here otherwise leaves the select blank.
    world.videoSecondsBeforeTimelineExport = videoSeconds;
    setVideoSeconds(dur);
    exportVideo(dur, displayCapture);
  }, [recording, timelineMode, timeline, applySceneRecipe, exportVideo, videoSeconds, resumeLiveAfterExport]);

  // ── "Record live screen" acquisition (Phase 8) ──────────────────────────
  // MUST be reached synchronously from the click handler: getDisplayMedia
  // requires transient user activation, and the permission prompt is the
  // user picking which surface to share. Resolves `{ stream, video, track }`
  // with the offscreen <video> already carrying real dimensions, so
  // exportVideo can resolve its crop rect immediately; rejects (having
  // released anything it allocated) on cancel, a wrong surface, or a stream
  // that never produces metadata.
  const acquireLiveScreenCapture = useCallback(() => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md?.getDisplayMedia) {
      return Promise.reject(Object.assign(new Error('getDisplayMedia is unavailable'), { name: 'NotSupportedError' }));
    }
    // frameRate is requested here, before any throughput measurement can
    // run — see exportVideo's own captureFps note for why this path is
    // pinned to DEFAULT_CAPTURE_FPS rather than chooseCaptureFps.
    const videoConstraints = { displaySurface: 'browser', frameRate: DEFAULT_CAPTURE_FPS };
    // `preferCurrentTab` is Chrome-only (it pre-selects THIS tab, which is
    // the whole point) and Chrome rejects some option combinations that
    // include it outright. A constraint-class rejection earns exactly one
    // retry without it — still inside the click's activation window,
    // because no prompt was ever shown. A cancellation is never retried.
    const request = md.getDisplayMedia({ video: videoConstraints, audio: false, preferCurrentTab: true })
      .catch((err) => {
        if (!shouldRetryDisplayCaptureWithoutPreferCurrentTab(err)) throw err;
        console.warn('[holocloth] tab capture refused the preferCurrentTab option — retrying without it', err?.name || err);
        return md.getDisplayMedia({ video: videoConstraints, audio: false });
      });

    return request.then((stream) => {
      const track = stream.getVideoTracks()[0] || null;
      const surface = evaluateDisplaySurface({ displaySurface: track?.getSettings?.().displaySurface });
      if (!surface.ok) {
        stopDisplayCapture({ stream });
        throw Object.assign(new Error(surface.reason), { name: 'WrongDisplaySurfaceError', userMessage: surface.reason });
      }
      // Deliberately NOT attached to the DOM: an on-page <video> of this
      // tab would be inside the very surface being captured (a visible
      // feedback loop), and a detached element decoding a live MediaStream
      // is exactly what drawImage needs.
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (err) => {
          if (settled) return; settled = true;
          stopDisplayCapture({ stream, video });
          reject(err);
        };
        const deadline = setTimeout(() => fail(Object.assign(
          new Error('the shared tab never reported video dimensions'), { name: 'NotReadableError' },
        )), 5000);
        video.onloadedmetadata = () => {
          if (settled) return; settled = true;
          clearTimeout(deadline);
          // play() can legitimately reject (autoplay policy edge cases);
          // the metadata is what the crop math needs, and a MediaStream
          // <video> keeps delivering frames regardless.
          Promise.resolve(video.play?.()).catch(() => { /* frames still flow from the live stream */ });
          resolve({ stream, video, track });
        };
        video.onerror = () => fail(Object.assign(new Error('the shared tab could not be decoded'), { name: 'NotReadableError' }));
      });
    });
  }, []);

  // Acquires the tab surface, then hands it to `run`. Every failure path
  // reports precisely what happened (cancel vs wrong surface vs unsupported)
  // and leaves the scene exactly as it was — Live is never paused, nothing
  // is captured server-side, no state is touched.
  const runWithLiveScreenCapture = useCallback((run) => {
    setStatus('Choose THIS TAB in the sharing prompt — “Record live screen” records the tab itself, which is how the live website gets into the video.');
    acquireLiveScreenCapture()
      .then((capture) => { run(capture); })
      .catch((err) => {
        const described = err?.userMessage
          ? { aborted: false, message: err.userMessage }
          : describeDisplayCaptureError(err);
        console.warn('[holocloth] export aborted', { reason: 'display-capture-unavailable', name: err?.name, aborted: described.aborted });
        setStatus(described.message);
      });
  }, [acquireLiveScreenCapture]);

  // The Export video / Export Timeline click routing, in one place. Order
  // matters: "Record live screen" is an explicit user choice to record the
  // TAB, so it bypasses runExportWithLiveGuard entirely — no capture fetch,
  // no Live pause, no teardown wait, no alpha hole. The live iframe must
  // stay up for the whole recording; that is the mode.
  // Asking for the live screen and silently getting the browserless capture
  // path instead is the one outcome this mode must never produce: that path
  // can run its full ~110s ladder and end with no file, which is
  // indistinguishable from the mode simply not working. When the toggle is
  // ON but the scene can't satisfy it, refuse and name the reason.
  const refuseIneligibleLiveRecord = useCallback(() => {
    console.warn('[holocloth] export aborted', { reason: 'live-record-ineligible', detail: liveRecordEligibility.reason });
    setStatus(`Record live screen is on, but ${liveRecordEligibility.reason.charAt(0).toLowerCase()}${liveRecordEligibility.reason.slice(1)}`);
  }, [liveRecordEligibility]);

  const startVideoExport = useCallback(() => {
    if (liveRecordActive) { runWithLiveScreenCapture((capture) => exportVideo(undefined, capture)); return; }
    if (recordLiveScreen) { refuseIneligibleLiveRecord(); return; }
    if (skipLivePrep) { exportVideo(); return; }
    runExportWithLiveGuard(exportVideo);
  }, [liveRecordActive, recordLiveScreen, refuseIneligibleLiveRecord, runWithLiveScreenCapture, exportVideo, skipLivePrep, runExportWithLiveGuard]);

  const startTimelineExport = useCallback(() => {
    if (liveRecordActive) { runWithLiveScreenCapture((capture) => exportTimeline(capture)); return; }
    if (recordLiveScreen) { refuseIneligibleLiveRecord(); return; }
    if (skipLivePrep) { exportTimeline(); return; }
    runExportWithLiveGuard(exportTimeline);
  }, [liveRecordActive, recordLiveScreen, refuseIneligibleLiveRecord, runWithLiveScreenCapture, exportTimeline, skipLivePrep, runExportWithLiveGuard]);

  const cancelExportVideo = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.exportCancelRequested = true;
    if (world.exportStopTimeout) { clearTimeout(world.exportStopTimeout); world.exportStopTimeout = null; }
    if (world.recorder) { try { world.recorder.stop(); } catch { /* already stopped */ } }
  }, []);

  const applyPreset = useCallback((presetId) => {
    const p = MATERIAL_PRESETS[presetId];
    if (!p) return;
    // env/bg ride along as the preset's lighting combo; they're not mat keys.
    const { label, group, env, bg, ...rest } = p;
    setMat({ ...rest, preset: presetId });
    if (typeof env === 'number') setEnvIntensity(env);
    if (bg) { setBgColor(bg); setBgMode('color'); }
  }, []);

  const uploadBtnStyle = { ...ui.btn(), width: '100%', cursor: 'pointer' };

  return (
    <>
      {/* ── Board — the cloth canvas fills the area left of the rail. ── */}
      <div
        id="cloth-studio-board"
        style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(isNarrow
            ? { position: 'relative', width: '100%', height: '64vh', flex: 'none' }
            : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW }),
        }}
      >
        <div id="cloth-studio-stage-area" style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isNarrow ? '68px 12px 12px' : '74px 24px 24px' }}>
          <div
            id="cloth-studio-stage-shell"
            ref={stageRef}
            style={{
              position: 'relative', width: '100%', height: '100%',
              borderRadius: 16, overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.6)',
              boxShadow: '0 18px 60px rgba(20,20,30,0.22), 0 2px 10px rgba(0,0,0,0.10)',
              // Checkerboard reads as "transparent" whenever the scene has no background.
              background: bgMode === 'transparent'
                ? 'repeating-conic-gradient(#d8d8de 0% 25%, #f2f2f5 0% 50%) 0 0 / 24px 24px'
                : '#0b0b0f',
            }}
          >
            {/* HUD overlay — light/cam markers + capture frame; pointer-through. */}
            <canvas
              id="cloth-studio-hud"
              ref={hudCanvasRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}
            />
            {/* Capture-frame carousel — steps the HUD filmstrip; the Render
                card's CAPTURE FRAME select drives the same state. */}
            {[['prev', -1, <ChevronLeft key="l" size={16} strokeWidth={2.5} />], ['next', 1, <ChevronRight key="r" size={16} strokeWidth={2.5} />]].map(([slug, dir, icon]) => {
              const i = FRAME_IDS.indexOf(frameId);
              const atEnd = dir < 0 ? i <= 0 : i >= FRAME_IDS.length - 1;
              return (
                <button
                  key={slug}
                  id={`cloth-frame-carousel-${slug}-btn`}
                  onClick={() => stepFrame(dir)}
                  disabled={atEnd}
                  title={dir < 0 ? 'Previous capture frame' : 'Next capture frame'}
                  style={{
                    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                    ...(dir < 0 ? { left: 10 } : { right: 10 }),
                    zIndex: 6, width: 34, height: 34, borderRadius: '50%',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', cursor: atEnd ? 'default' : 'pointer', color: '#fff',
                    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                    opacity: atEnd ? 0.25 : 1, transition: 'opacity 0.2s ease',
                  }}
                >
                  {icon}
                </button>
              );
            })}
            {/* Grab is automatic on the Flyer sheet — drag it directly; empty
                space orbits. The T-shirt doesn't support drag-to-grab yet
                (its own hanger-pinned sim owns its motion), so this is
                honest per-shape copy rather than a control that would
                silently do nothing. */}
            {/* Reset cloth — back to the rumpled rest pose, next to Poke. */}
            <button
              id="cloth-studio-reset-btn"
              onClick={() => worldRef.current?.resetCloth()}
              title="Reset cloth"
              style={{
                position: 'absolute', top: 10, right: 48, zIndex: 6,
                width: 30, height: 30, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer', color: '#fff',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
              }}
            >
              <RotateCcw size={15} strokeWidth={2.5} />
            </button>
            {/* Live-screen controls — only while the device's LIVE site is
                showing: Orbit ⇄ Interact toggle + Refresh, the same two
                on-canvas circles the Mockup Video studio pins by its
                artboard (#studio-export-orbit / #studio-export-refresh).
                Same deviceInteract state the rail toggle drives — these are
                just the on-canvas surface for it. */}
            {clothShape === 'device' && devicePrimary.live && devicePrimary.liveUrl ? (
              <>
                <button
                  id="cloth-studio-live-interact-btn"
                  onClick={() => setDeviceInteract((v) => !v)}
                  title={deviceInteract ? 'Interact with the live site' : 'Orbit the camera'}
                  style={{
                    position: 'absolute', top: 10, right: 124, zIndex: 6,
                    width: 30, height: 30, borderRadius: '50%',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', cursor: 'pointer', color: '#fff',
                    background: deviceInteract ? 'rgba(99,102,241,0.85)' : 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                  }}
                >
                  {deviceInteract ? <MousePointer2 size={15} strokeWidth={2.5} /> : <Orbit size={16} strokeWidth={2.5} />}
                </button>
                <button
                  id="cloth-studio-live-refresh-btn"
                  onClick={() => {
                    const dl = worldRef.current?.deviceLive;
                    // Re-setting src is the reload — same move page.jsx's
                    // #studio-export-refresh makes on its own live iframe.
                    if (dl?.iframe) dl.iframe.src = dl.iframe.src;
                  }}
                  title="Refresh site"
                  style={{
                    position: 'absolute', top: 10, right: 86, zIndex: 6,
                    width: 30, height: 30, borderRadius: '50%',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', cursor: 'pointer', color: '#fff',
                    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                  }}
                >
                  <RefreshCw size={15} strokeWidth={2.5} />
                </button>
              </>
            ) : null}
            {/* Poke — quick impulse without opening the Physics card. Flyer-
                sheet-only (see the Physics card's own PINS/Poke note). */}
            <button
              id="cloth-studio-poke-btn"
              onClick={() => worldRef.current?.poke()}
              disabled={clothShape !== 'sheet'}
              title={clothShape !== 'sheet' ? 'Poke — Flyer sheet only' : 'Poke the cloth'}
              style={{
                position: 'absolute', top: 10, right: 10, zIndex: 6,
                width: 30, height: 30, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: clothShape === 'sheet' ? 'pointer' : 'default',
                color: '#fff', opacity: clothShape === 'sheet' ? 1 : 0.4,
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
              }}
            >
              <Zap size={15} strokeWidth={2.5} />
            </button>
            {recording ? (
              <div style={{
                position: 'absolute', top: 10, left: 10, zIndex: 6, pointerEvents: 'none',
                ...ui.label, color: '#fff', background: 'rgba(220,38,38,0.85)',
                padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
              }}>● REC</div>
            ) : null}
          </div>
        </div>
        {/* Timeline transport strip — lives directly below the stage box,
            OUTSIDE stageRef (cloth-studio-stage-shell above) so its own
            height doesn't feed back into the canvas-size ResizeObserver.
            Moved here from the right rail — the strip is the timeline's
            ONLY surface now (the former rail Timeline card was removed at
            the user's request; loop pref lives next to the duration). */}
        <div style={{ padding: isNarrow ? '0 12px 14px' : '0 24px 14px', flexShrink: 0 }}>
          <StudioTimelineStrip
            timeline={timeline}
            scrubU={scrubU}
            playing={timelineMode !== 'idle'}
            selectedKeyframeId={selectedKeyframeId} onSelectKeyframe={setSelectedKeyframeId}
            onAddKeyframeAt={addKeyframe}
            onAddKeyframe={addKeyframe}
            onDeleteKeyframe={deleteKeyframe}
            onRetimeKeyframe={retimeKeyframe}
            onScrubTo={scrubTimelineTo}
            onPlay={playTimeline} onReset={resetTimeline} onStop={stopTimeline}
            onExport={startTimelineExport}
            onTotalSecondsChange={setTimelineTotalSeconds}
            onLoopToggle={setTimelineLoop}
            onClearKeyframes={clearTimelineKeyframes}
            cameraTemplates={CAMERA_TEMPLATES}
            onApplyCameraTemplate={applyCameraTemplate}
            // Phase 7: the strip's `recording` prop is its "an export is
            // under way — don't let me start another one or move the
            // playhead" gate (it drives canExport + the transport's disabled
            // states). The export-time website capture IS that state: the
            // export is committed and running, it just hasn't reached the
            // recorder yet, so Export Timeline must not stay clickable
            // through it.
            recording={recording || liveCaptureBusy}
            deviceViewport={devicePrimary.viewport}
            deviceActive={clothShape === 'device'}
            onSelectDevice={(vp) => applyLookMutation(() => { setClothShape('device'); setDevicePrimaryKey('viewport', vp); })}
          />
        </div>
        {status ? (
          <div id="cloth-studio-status-row" style={{ padding: '0 24px 12px', fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute, flexShrink: 0 }}>{status}</div>
        ) : null}
      </div>

      {/* ── Right rail — HoloCloth control cards. ── */}
      <div
        id="cloth-studio-rail"
        data-tooltip-disabled="true"
        style={{
          boxSizing: 'border-box', maxWidth: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'visible', background: 'transparent',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 1, minHeight: 0, padding: 12, overflowY: 'auto' }
            : { position: 'absolute', top: 0, right: 0, bottom: 0, width: railW, padding: 14, zIndex: 10, overflowY: 'auto' }),
        }}
      >
        {/* Rail-card states — same rules as the mockup rail (page.jsx renders its
            copy only in mockup mode, so cloth mode carries its own). */}
        <style id="cloth-rail-card-styles">{`
          #cloth-studio-rail, #cloth-studio-rail * { box-sizing: border-box; }
          /* Hover motion REMOVED by owner direction (2026-08-01): the old
             :hover scale/lift/slide made cards move and visually collide
             with their neighbors while browsing the rail. Cards are now
             static; only the OPEN (--active) state changes appearance. */
          .studio-rail-card {
            position: relative; border-radius: 1rem; overflow: hidden;
            background: rgba(255, 255, 255, 0.35);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
            transition: background 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.32s cubic-bezier(0.16,1,0.3,1);
          }
          @media (prefers-reduced-motion: reduce) { .studio-rail-card { transition: none; } }
          .studio-rail-card::before {
            content: ''; position: absolute; inset: 0; border-radius: 1rem; padding: 1px;
            background: rgba(176,176,182,0.6);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
            pointer-events: none; opacity: 0.85; transition: opacity 0.45s ease; z-index: 0;
          }
          /* Active/expanded treatment REMOVED (owner direction, 2026-08-01):
             no gradient border ring, no solid-white fill — an open card
             keeps the exact same translucent blurred glass and plain
             hairline as a closed one; the rotated chevron is the open
             indicator. (.studio-rail-card--active is still applied by
             RailCard for anyone who wants to re-style it later.) */
          .studio-rail-card-content { position: relative; z-index: 1; }
          .studio-rail-card-btn { position: relative; z-index: 1; }
        `}</style>

        {/* Top-aligned (was `margin: 'auto 0'` = vertically centered, which
            made every card expansion shift the whole stack both up AND down
            into neighboring cards). Anchored to the top, an opening card
            only pushes content below it downward — nothing above moves. */}
        <div id="cloth-studio-rail-inner" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>

          <div id="cloth-rail-bucket-stage" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 0' }}>
            <span style={{ ...ui.label, whiteSpace: 'nowrap' }}>STAGE</span>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: GLASS.hair }}></span>
          </div>

          {/* SUBJECT — the primary shape (Flyer/T-Shirt/Device) and each
              shape's own controls; split from the former Images card
              (docs/plans/STUDIO-RAIL-IA-REORG-PLAN.md). */}
          <RailCard
            id="cloth-subject-panel" icon={<Orbit size={18} strokeWidth={2} />} title="Subject"
            subtitle={clothShape === 'tshirt' ? 'T-Shirt' : clothShape === 'device' ? 'Device' : `Flyer · ${clothAspect === 'auto' ? 'Auto' : (CLOTH_ASPECTS[clothAspect]?.label || 'Auto')}`}
            color="#f59e0b" open={imagesOpen} onToggle={() => setImagesOpen((v) => !v)}
          >
            {/* SHEET SHAPE — the one primary-shape selector (master prompt,
                round 5): Flyer aspect ratios and T-Shirt live side by side
                here instead of a separate "PRIMARY SHAPE" control in the
                Material panel. Picking an aspect ratio also switches the
                primary shape back to 'sheet' if the T-shirt was active;
                exactly one primary cloth is ever built either way — see the
                dedicated tshirt lifecycle effect. Undoable (Look scope),
                same as a Material preset select. */}
            <span style={{ ...ui.label, marginTop: 4 }}>SHEET SHAPE</span>
            <div id="cloth-sheet-shape-row" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button
                title="Match the artwork's proportions"
                style={{ ...ui.btn(clothShape === 'sheet' && clothAspect === 'auto'), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                onClick={() => applyLookMutation(() => { setClothShape('sheet'); setClothAspect('auto'); })}
              >
                Auto
              </button>
              {Object.entries(CLOTH_ASPECTS).map(([id, a]) => (
                <button
                  key={id}
                  style={{ ...ui.btn(clothShape === 'sheet' && clothAspect === id), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                  onClick={() => applyLookMutation(() => { setClothShape('sheet'); setClothAspect(id); })}
                >
                  {a.label}
                </button>
              ))}
              <button
                id="cloth-sheet-shape-tshirt-btn"
                style={{ ...ui.btn(clothShape === 'tshirt'), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                onClick={() => applyLookMutation(() => setClothShape('tshirt'))}
              >
                T-Shirt
              </button>
              <button
                id="cloth-sheet-shape-device-btn"
                style={{ ...ui.btn(clothShape === 'device'), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                onClick={() => applyLookMutation(() => setClothShape('device'))}
              >
                Device
              </button>
            </div>
            {clothShape === 'tshirt' ? (
              <>
                <span style={{ ...ui.label, marginTop: 4 }}>T-SHIRT PRINT</span>
                <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  HANGER
                  <button
                    id="cloth-tshirt-hanger-toggle-btn"
                    style={{ ...ui.btn(tshirtPrint.hangerVisible), height: 28, padding: '0 12px', fontSize: 10 }}
                    onClick={() => setTshirtPrint((t) => ({ ...t, hangerVisible: !t.hangerVisible }))}
                  >
                    {tshirtPrint.hangerVisible ? 'On' : 'Off'}
                  </button>
                </span>
                <Slider label="PRINT SCALE" min={0.4} max={1.8} step={0.02} value={tshirtPrint.scale} onChange={(v) => setTshirtPrint((t) => ({ ...t, scale: v }))} fmt={(v) => `${v.toFixed(2)}x`} />
                <Slider label="PRINT X" min={-0.3} max={0.3} step={0.01} value={tshirtPrint.x} onChange={(v) => setTshirtPrint((t) => ({ ...t, x: v }))} fmt={(v) => v.toFixed(2)} />
                <Slider label="PRINT Y" min={-0.3} max={0.3} step={0.01} value={tshirtPrint.y} onChange={(v) => setTshirtPrint((t) => ({ ...t, y: v }))} fmt={(v) => v.toFixed(2)} />
                <Slider label="PRINT ROTATION" min={-180} max={180} step={5} value={tshirtPrint.rotation} onChange={(v) => setTshirtPrint((t) => ({ ...t, rotation: v }))} fmt={(v) => `${v}°`} />
                <Slider label="PRINT OPACITY" min={0} max={1} step={0.02} value={tshirtPrint.opacity} onChange={(v) => setTshirtPrint((t) => ({ ...t, opacity: v }))} fmt={(v) => `${Math.round(v * 100)}%`} />
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                  {artworkName ? 'The current artwork prints on the T-shirt’s front only — bounded to a chest-height region, never stretched across sleeves, back or seams.' : 'Pick or upload artwork above to give the T-shirt a front print.'}
                </span>
              </>
            ) : null}
            {/* DEVICE PRIMARY — the third primary shape's own controls
                (Phase 4): the hero device mockup at scene center, website
                screen via the same capture/upload machinery the extras
                Inspector uses (DeviceScreenControl writes into the
                devicePrimary state through the onChange shim below). */}
            {clothShape === 'device' ? (
              <div id="cloth-device-primary-section" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...ui.label, marginTop: 4 }}>DEVICE</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[['desktop', 'Desktop'], ['mobile', 'Phone'], ['tablet', 'Tablet']].map(([id, label]) => (
                    <button
                      key={id}
                      style={{ ...ui.btn(devicePrimary.viewport === id), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                      onClick={() => setDevicePrimaryKey('viewport', id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* MODEL — shell design within the current device family
                    (same screen, different industrial design); each family
                    remembers its own pick across viewport switches. */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>MODEL</span>
                  <select
                    id="cloth-device-model-select"
                    value={devicePrimary.models?.[devicePrimary.viewport] || Object.keys(DEVICE_MODELS[devicePrimary.viewport] || DEVICE_MODELS.desktop)[0]}
                    onChange={(e) => setDevicePrimary((d) => ({ ...d, models: { ...d.models, [d.viewport]: e.target.value } }))}
                    style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                  >
                    {Object.entries(DEVICE_MODELS[devicePrimary.viewport] || DEVICE_MODELS.desktop).map(([id, m]) => (
                      <option key={id} value={id}>{m.label}</option>
                    ))}
                  </select>
                </label>
                {/* FINISH — ultra-modern realistic (metal + glass) vs clay
                    (one matte recolorable material: BODY TONE = clay color,
                    CLAY SOFTNESS = matte..soft-sheen roughness). */}
                <div id="cloth-device-finish-row" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>FINISH</span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[['realistic', 'Realistic'], ['clay', 'Clay']].map(([id, label]) => (
                      <button
                        key={id}
                        style={{ ...ui.btn(devicePrimary.finish === id), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                        onClick={() => setDevicePrimaryKey('finish', id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* SHELL TEXTURE — procedural tileable bump on the shell in
                    BOTH finishes (brushed reads metal, speckle/fabric clay). */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>SHELL TEXTURE</span>
                  <select
                    id="cloth-device-texture-select"
                    value={devicePrimary.shellTexture}
                    onChange={(e) => setDevicePrimaryKey('shellTexture', e.target.value)}
                    style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                  >
                    {[['smooth', 'Smooth'], ['speckle', 'Speckled Clay'], ['brushed', 'Brushed'], ['fabric', 'Fabric Weave'], ['grip', 'Grip Dots']].map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </label>
                {devicePrimary.finish === 'clay' ? (
                  <div id="cloth-device-clay-color-row" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={ui.label}>CLAY COLOR</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {['#e8734a', '#d9b28c', '#9caf88', '#7fa8c9', '#c96b8a', '#8a7ad1', '#efe6d8', '#5b5e66'].map((hex) => (
                        <button
                          key={hex}
                          title={hex}
                          onClick={() => setDevicePrimaryKey('clayColor', hex)}
                          style={{
                            width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', padding: 0,
                            background: hex,
                            border: devicePrimary.clayColor === hex ? '2px solid ' + GLASS.ink : '1px solid ' + GLASS.hair,
                          }}
                        />
                      ))}
                      <input type="color" value={devicePrimary.clayColor} onChange={(e) => setDevicePrimaryKey('clayColor', e.target.value)} style={{ width: 34, height: 24, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
                    </div>
                  </div>
                ) : null}
                <Slider label="CLAY SOFTNESS" min={0.4} max={1} step={0.01} value={devicePrimary.claySoftness} onChange={(v) => setDevicePrimaryKey('claySoftness', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={devicePrimary.finish !== 'clay'} />
                <DeviceScreenControl
                  idPrefix="cloth-device-primary-screen"
                  instance={{ appearance: { viewport: devicePrimary.viewport, captureUrl: devicePrimary.captureUrl, uploadAssetId: devicePrimary.uploadAssetId, captureSourceUrl: devicePrimary.captureSourceUrl, captureViewport: devicePrimary.captureViewport } }}
                  disabled={false}
                  onChange={(bucket, key, value) => {
                    // Picking a textured screen source takes over from Live
                    // mode — the live iframe's punch-through otherwise sits on
                    // top and the new capture/upload "doesn't update the
                    // screen" (it updates the material hidden underneath).
                    const takesOver = (key === 'captureUrl' || key === 'uploadAssetId') && value;
                    if (takesOver) {
                      setDeviceInteract(false);
                      setLiveEmbedNote('');
                      // SHARE TAB outranks capture/upload inside the factory,
                      // so it has to be stopped here or the new selection would
                      // look like it did nothing.
                      if (worldRef.current?.deviceShare) stopScreenShare('Tab sharing stopped — a captured/uploaded image took over the screen.');
                    }
                    setDevicePrimary((d) => (takesOver ? { ...d, [key]: value, live: false } : { ...d, [key]: value }));
                  }}
                  deviceScreenLibrary={deviceScreenLibrary}
                  onAddDeviceScreenImage={addDeviceScreenImage}
                  onDeleteDeviceScreenImage={deleteDeviceScreenImage}
                  screenShare={screenShare}
                  screenShareStatus={screenShareStatus}
                  screenShareBusy={screenShareBusy}
                  onStartScreenShare={startScreenShare}
                  onStopScreenShare={() => stopScreenShare('Tab sharing stopped — the screen went back to whatever it was showing before.')}
                />
                {/* LIVE SCREEN — real interactive iframe behind a punched-
                    through screen (see the Phase 7 effect). Preview-only. */}
                <span style={{ ...ui.label, marginTop: 4, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>LIVE SCREEN</span>
                <div id="cloth-device-live-row" style={{ display: 'flex', gap: 6 }}>
                  <input
                    id="cloth-device-live-url-input"
                    type="text"
                    placeholder="yoursite.com (live)"
                    value={liveUrlDraft}
                    onChange={(e) => setLiveUrlDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitLiveUrl(liveUrlDraft); }}
                    style={{ ...ui.btn(), flex: 1, textAlign: 'left', paddingLeft: 10 }}
                  />
                  <button
                    id="cloth-device-live-toggle-btn"
                    style={{ ...ui.btn(devicePrimary.live), padding: '0 12px' }}
                    disabled={!liveUrlDraft.trim()}
                    onClick={() => commitLiveUrl(liveUrlDraft)}
                  >
                    {devicePrimary.live
                      ? (liveUrlDraft.trim() !== devicePrimary.liveUrl ? 'Load URL' : 'Live: On')
                      : 'Go Live'}
                  </button>
                  {devicePrimary.live ? (
                    <button
                      id="cloth-device-live-stop-btn"
                      style={{ ...ui.btn(), padding: '0 12px' }}
                      onClick={() => { setDevicePrimaryKey('live', false); setDeviceInteract(false); setLiveEmbedNote(''); }}
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
                {liveEmbedNote ? (
                  <span id="cloth-device-live-embed-note" style={{ ...ui.label, color: '#b45309', textTransform: 'none', fontSize: 11, lineHeight: 1.5 }}>
                    {liveEmbedNote}
                  </span>
                ) : null}
                {devicePrimary.live ? (
                  <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    INTERACT WITH SITE
                    <button
                      id="cloth-device-interact-toggle-btn"
                      style={{ ...ui.btn(deviceInteract), height: 28, padding: '0 12px', fontSize: 10 }}
                      onClick={() => setDeviceInteract((v) => !v)}
                    >
                      {deviceInteract ? 'On — orbit paused' : 'Off'}
                    </button>
                  </span>
                ) : null}
                {devicePrimary.live ? (
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                    The live screen is the REAL site in a 3D-pinned frame — scroll and click it with Interact on. Honest limits: post effects (diffusion blur, bloom, treatments) can’t touch the live screen itself (everything around it keeps them); Quick Export (this browser's own recording) can't capture the live iframe directly and switches to a captured screen automatically instead; and some sites refuse to load in an embedded frame (blank screen = use Capture instead). Final Render is different — it renders the real site server-side as an actual scrolling video (slower: a real, multi-second-or-more capture step), not a placeholder.
                  </span>
                ) : null}
                <Slider label="DEVICE SCALE" min={0.8} max={2.2} step={0.02} value={devicePrimary.scale} onChange={(v) => setDevicePrimaryKey('scale', v)} fmt={(v) => `${v.toFixed(2)}x`} />
                {/* Vertical placement — SEAT ON FLOOR auto-rests the device's
                    lowest point (stand foot / slab edge, per viewport) on the
                    active scene set's floor; HEIGHT OFFSET is the manual,
                    keyframeable nudge on top ('devicePrimary.posY'). */}
                <span id="cloth-device-seat-floor-row" style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  SEAT ON FLOOR
                  <button style={{ ...ui.btn(devicePrimary.seatOnFloor), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setDevicePrimaryKey('seatOnFloor', !devicePrimary.seatOnFloor)}>
                    {devicePrimary.seatOnFloor ? 'On' : 'Off'}
                  </button>
                </span>
                <Slider label="HEIGHT OFFSET" min={-0.8} max={0.8} step={0.01} value={devicePrimary.posY} onChange={(v) => setDevicePrimaryKey('posY', v)} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`} />
                {/* SCROLL POSITION — the "%" scrub: set a spot on the page,
                    Add Keyframe on the timeline, and playback pans the site
                    between keyframes (devicePrimary.scrollPosition is in
                    TIMELINE_LERP_WHITELIST). Disabled while AUTO SCROLL
                    ping-pongs on its own clock. */}
                <Slider
                  label={devicePrimary.scroll ? 'SCROLL POSITION (AUTO SCROLL IS ON)' : 'SCROLL POSITION'}
                  min={0} max={1} step={0.01} value={devicePrimary.scrollPosition}
                  onChange={(v) => setDevicePrimaryKey('scrollPosition', v)} fmt={(v) => `${Math.round(v * 100)}%`}
                  disabled={devicePrimary.scroll}
                />
                <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  AUTO SCROLL
                  <button style={{ ...ui.btn(devicePrimary.scroll), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setDevicePrimaryKey('scroll', !devicePrimary.scroll)}>
                    {devicePrimary.scroll ? 'On' : 'Off'}
                  </button>
                </span>
                <Slider label="AUTO SCROLL SPEED" min={0.05} max={2} step={0.05} value={devicePrimary.scrollSpeed} onChange={(v) => setDevicePrimaryKey('scrollSpeed', v)} fmt={(v) => `${v.toFixed(2)}x`} disabled={!devicePrimary.scroll} />
                <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  SWAY
                  <button style={{ ...ui.btn(devicePrimary.sway), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setDevicePrimaryKey('sway', !devicePrimary.sway)}>
                    {devicePrimary.sway ? 'On' : 'Off'}
                  </button>
                </span>
                <Slider label="SWAY SPEED" min={0.05} max={2} step={0.05} value={devicePrimary.swaySpeed} onChange={(v) => setDevicePrimaryKey('swaySpeed', v)} fmt={(v) => `${v.toFixed(2)}x`} disabled={!devicePrimary.sway} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={devicePrimary.color} onChange={(e) => setDevicePrimaryKey('color', e.target.value)} style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
                  <span style={ui.label}>BODY TONE</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={devicePrimary.accent} onChange={(e) => setDevicePrimaryKey('accent', e.target.value)} style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
                  <span style={ui.label}>SITE ACCENT (PLACEHOLDER)</span>
                </label>
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                  The device replaces the flyer as the scene’s focal subject — orbit around it, aim the Diffusion Camera at “Primary artwork / cloth,” and capture any website onto its screen.
                </span>
              </div>
            ) : null}
          </RailCard>

          {/* ARTWORK — upload/library; prints onto the current Subject.
              Split from the former Images card
              (docs/plans/STUDIO-RAIL-IA-REORG-PLAN.md). */}
          <RailCard
            id="cloth-artwork-panel" icon={<ImageIcon size={18} strokeWidth={2} />} title="Artwork"
            subtitle={artworkName || 'None selected'}
            color="#f59e0b" open={artworkOpen} onToggle={() => setArtworkOpen((v) => !v)}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>ARTWORK</span>
              <select
                value={artworkId || ''}
                onChange={(e) => selectArtwork(e.target.value)}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                {!artworkId ? <option value="">None…</option> : null}
                {BUILTIN_ARTWORKS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                {artworkLib.length ? (
                  <optgroup label="SAVED">
                    {artworkLib.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <label style={uploadBtnStyle}>
              <Download size={14} strokeWidth={2.5} style={{ marginRight: 6, transform: 'rotate(180deg)' }} />
              Upload &amp; save artwork
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onArtworkUpload(e.target.files?.[0])} />
            </label>
            {artworkLib.some((a) => a.id === artworkId) ? (
              <button style={{ ...ui.btn(), width: '100%' }} onClick={() => deleteSavedArtwork(artworkId)}>Delete saved image</button>
            ) : null}
            {artworkName ? (
              <button style={{ ...ui.btn(), width: '100%' }} onClick={clearArtwork}>Remove artwork</button>
            ) : (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Uploads go onto the fabric and into this browser's saved list.</span>
            )}
          </RailCard>

          {/* IMAGE LAYERS — promoted to its own card; split from the
              former Images card (docs/plans/STUDIO-RAIL-IA-REORG-PLAN.md). */}
          <RailCard
            id="cloth-image-layers-panel" icon={<Layers size={18} strokeWidth={2} />} title="Image Layers"
            subtitle={`${elementInstances.filter((i) => i.type === 'image-layer').length} layer${elementInstances.filter((i) => i.type === 'image-layer').length === 1 ? '' : 's'}`}
            color="#f59e0b" open={imageLayersOpen} onToggle={() => setImageLayersOpen((v) => !v)}
          >
            {/* IMAGE LAYERS — the discoverable front door for image-layer
                elements: one click = upload + add at scene center + select
                in the Inspector (addImageLayerFromFile). */}
            <span style={{ ...ui.label, marginTop: 4 }}>IMAGE LAYERS</span>
            <label id="cloth-image-layer-add-btn" style={{ ...uploadBtnStyle, opacity: canAddElement ? 1 : 0.4 }}>
              <Download size={14} strokeWidth={2.5} style={{ marginRight: 6, transform: 'rotate(180deg)' }} />
              Add image layer (PNG/JPG)
              <input
                type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} disabled={!canAddElement}
                onChange={(e) => { addImageLayerFromFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </label>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
              {canAddElement
                ? 'Drops a flat layer at the center of the stage — a cloud, a graphic, a texture. PNG transparency stays soft; the layer keeps the image’s own proportions. Place it with the sliders below (each layer gets its own set) — keyframeable: set a pose, Add Keyframe, and playback tweens it.'
                : `Element limit reached (${MAX_EXTRA_INSTANCES}) — remove an element before adding another layer.`}
            </span>
            {/* Per-layer placement — the transform controls surfaced HERE
                (they also exist in the Elements→Inspector flow, but that
                was the only path and nobody found it). Writes through the
                same changeSceneElementField the Inspector uses, so the two
                surfaces stay in lockstep and timeline keyframes carry the
                values (blendElementTransforms). */}
            {elementInstances.filter((i) => i.type === 'image-layer' && isRenderableInstance(i, PRIMARY_ELEMENT_ID)).map((layer) => {
              const pos = layer.transform.position;
              const rot = layer.transform.rotation;
              const axis = (vec, ax, v) => { const n = [...(vec || [0, 0, 0])]; n[ax] = v; return n; };
              const setT = (key, value) => changeSceneElementField(layer.id, 'transform', key, value);
              return (
                <div
                  key={layer.id}
                  id={`cloth-image-layer-controls-${layer.id}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 10, background: 'rgba(0,0,0,0.03)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, color: GLASS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.name}</span>
                    <button
                      title="Open in Inspector"
                      style={{ ...ui.btn(selectedElementId === layer.id), height: 24, padding: '0 10px', fontSize: 9 }}
                      onClick={() => { setSelectedElementId(layer.id); setInspectorOpen(true); }}
                    >
                      Inspect
                    </button>
                  </div>
                  <Slider label="POSITION X" min={-1.5} max={1.5} step={0.02} value={pos[0]} onChange={(v) => setT('position', axis(pos, 0, v))} fmt={(v) => v.toFixed(2)} />
                  <Slider label="POSITION Y" min={-1.5} max={1.5} step={0.02} value={pos[1]} onChange={(v) => setT('position', axis(pos, 1, v))} fmt={(v) => v.toFixed(2)} />
                  <Slider label="DEPTH (Z)" min={-1.5} max={1.5} step={0.02} value={pos[2]} onChange={(v) => setT('position', axis(pos, 2, v))} fmt={(v) => v.toFixed(2)} />
                  <Slider label="SPIN" min={-180} max={180} step={2} value={rot[2]} onChange={(v) => setT('rotation', axis(rot, 2, v))} fmt={(v) => `${Math.round(v)}°`} />
                  <Slider label="TILT X" min={-180} max={180} step={2} value={rot[0]} onChange={(v) => setT('rotation', axis(rot, 0, v))} fmt={(v) => `${Math.round(v)}°`} />
                  <Slider label="TILT Y" min={-180} max={180} step={2} value={rot[1]} onChange={(v) => setT('rotation', axis(rot, 1, v))} fmt={(v) => `${Math.round(v)}°`} />
                  <Slider label="SCALE" min={0.4} max={2.2} step={0.02} value={layer.transform.scale[0]} onChange={(v) => setT('scale', [v, v, v])} fmt={(v) => `${v.toFixed(2)}x`} />
                  <Slider label="OPACITY" min={0.05} max={1} step={0.01} value={layer.material.opacity} onChange={(v) => changeSceneElementField(layer.id, 'material', 'opacity', v)} fmt={(v) => `${Math.round(v * 100)}%`} />
                  {/* SOLID IMAGE — hardens partial-alpha interior detail
                      (pattern tufts, halftones) so a bright background can't
                      ghost through; true cutout edges stay soft. */}
                  <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    SOLID IMAGE
                    <button style={{ ...ui.btn(Boolean(layer.appearance.solid)), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => changeSceneElementField(layer.id, 'appearance', 'solid', !layer.appearance.solid)}>
                      {layer.appearance.solid ? 'On' : 'Off'}
                    </button>
                  </span>
                </div>
              );
            })}
          </RailCard>

          {/* ELEMENTS + INSPECTOR — cinematic-set architecture, flag-gated.
              Mirrors the existing Glass card below rather than replacing it (see
              docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md). */}
          {elementsV1Enabled ? (
            <>
              <StudioElementsCard
                open={elementsOpen} onToggle={() => setElementsOpen((v) => !v)}
                instances={elementInstances} selectedId={selectedElementId} onSelect={setSelectedElementId}
                primaryElementId={PRIMARY_ELEMENT_ID}
                onToggleVisible={toggleElementVisible} onToggleLock={toggleElementLock}
                seed={sceneSeed} budget={elementBudget} costDetail={elementCostDetail}
                onRandomizeSelected={randomizeSelectedElement} onResetSelected={resetSelectedElement}
                canRandomizeSelected={canRandomizeSelected}
                onRandomizeAll={randomizeAllElementsHandler} canRandomizeAll={canRandomizeAllElements}
                intensityTiers={INTENSITY_TIERS} intensityMeta={INTENSITY_META}
                intensity={randomizeIntensity} onIntensityChange={setRandomizeIntensity}
                randomizeReport={elementRandomizeReport}
                onDuplicateSelected={duplicateSelectedElement} onRemoveSelected={removeSelectedElement}
                canDuplicateSelected={canDuplicateSelected} canRemoveSelected={canRemoveSelected}
                addableElementTypes={addableElementTypes} onAddElement={addSceneElement} canAddElement={canAddElement}
                canUndo={elementHistoryRef.current.undo.length > 0} canRedo={elementHistoryRef.current.redo.length > 0}
                onUndo={undoElements} onRedo={redoElements}
                formats={PLACEMENT_FORMATS} formatId={elementFormatId} onFormatChange={setElementFormatId}
                previewTiers={LIVE_PREVIEW_TIERS} qualityTier={elementQualityTier} onQualityTierChange={setElementQualityTier}
                placementWarnings={elementPlacementWarnings}
                heroWarnings={heroWarnings}
              />
              <StudioElementInspector
                open={inspectorOpen} onToggle={() => setInspectorOpen((v) => !v)}
                instance={selectedInstance}
                definition={getElementDefinition(selectedInstance?.type)}
                isBound={selectedElementId === PRIMARY_ELEMENT_ID}
                onFieldChange={changeSelectedElementField}
                onGenericFieldChange={(bucket, key, value) => changeSceneElementField(selectedElementId, bucket, key, value)}
                onApplyPreset={applyElementPreset}
                onToggleLockGroup={toggleElementLockGroup}
                placementWarning={selectedInstance ? elementPlacementWarnings[selectedInstance.id] : null}
                loadStatus={selectedInstance ? tshirtModelStatus[selectedInstance.id] : null}
                onRetryLoad={retryTshirtModelLoad}
                authedFetch={authedFetch} glbAssets={glbAssets} onRefreshGlbAssets={refreshGlbAssets}
                logoLibrary={logoLibrary} onAddLogo={addLogo} onDeleteLogo={deleteLogo}
                deviceScreenLibrary={deviceScreenLibrary} onAddDeviceScreenImage={addDeviceScreenImage} onDeleteDeviceScreenImage={deleteDeviceScreenImage}
                elementPresets={listActiveTemplates(elementPresets)}
                canSaveElementPreset={canSaveElementPreset}
                elementPresetNameDraft={elementPresetNameDraft} onElementPresetNameDraftChange={setElementPresetNameDraft}
                onSaveElementPreset={saveCurrentAsElementPreset} onLoadElementPreset={loadElementPresetById}
                onArchiveElementPreset={archiveElementPresetById} elementPresetStatus={elementPresetStatus}
                isAdmin={isAdmin}
                onCaptureElementPresetRecipe={() => (canSaveElementPreset ? {
                  type: selectedInstance.type,
                  values: { material: selectedInstance.material, motion: selectedInstance.motion, appearance: selectedInstance.appearance },
                } : null)}
                onLoadElementPresetRecipe={applyElementPresetRecipe}
              />
            </>
          ) : null}

          {/* GLASS — refractive shell wrapped around the sheet. */}
          <RailCard
            id="cloth-glass-panel" icon={<Disc size={18} strokeWidth={2} />} title="Glass"
            subtitle={glass.on ? `On · ${glass.scale.toFixed(2)}x${glass.rotate ? ' · rotating' : ''}` : 'Off'}
            color="#38bdf8" open={glassOpen} onToggle={() => setGlassOpen((v) => !v)}
          >
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              GLASS FORM
              <button style={{ ...ui.btn(glass.on), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setGlassKey('on', !glass.on)}>
                {glass.on ? 'On' : 'Off'}
              </button>
            </span>
            <Slider label="SCALE" min={0.4} max={2.2} step={0.02} value={glass.scale} onChange={(v) => setGlassKey('scale', v)} fmt={(v) => `${v.toFixed(2)}x`} disabled={!glass.on} />
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: glass.on ? 1 : 0.4 }}>
              AUTO ROTATE
              <button style={{ ...ui.btn(glass.rotate), height: 28, padding: '0 12px', fontSize: 10 }} disabled={!glass.on} onClick={() => setGlassKey('rotate', !glass.rotate)}>
                {glass.rotate ? 'On' : 'Off'}
              </button>
            </span>
            <Slider label="ROTATE SPEED" min={0.05} max={2} step={0.05} value={glass.rotSpeed} onChange={(v) => setGlassKey('rotSpeed', v)} fmt={(v) => `${v.toFixed(2)}x`} disabled={!glass.on || !glass.rotate} />
            {/* TRANSPARENCY — real optical transparency (maps directly to
                MeshPhysicalMaterial.transmission). FROST (field name
                `clarity`, unchanged for backward compatibility) only ever
                controlled reflection/refraction sharpness — the two are
                independent physical properties, so this is a NEW control,
                not a relabel of an existing one. */}
            <Slider label="TRANSPARENCY" min={0} max={1} step={0.02} value={glass.transmission} onChange={(v) => setGlassKey('transmission', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!glass.on} />
            <Slider label="FROST" min={0} max={0.4} step={0.01} value={glass.clarity} onChange={(v) => setGlassKey('clarity', v)} fmt={(v) => v.toFixed(2)} disabled={!glass.on} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: glass.on ? 1 : 0.4 }}>
              <input type="color" value={glass.tint} disabled={!glass.on} onChange={(e) => setGlassKey('tint', e.target.value)} style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
              <span style={ui.label}>Tint</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{glass.tint}</span>
            </label>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>A smooth abstract shell around the flyer — the parts seen through it refract like real glass. Transparency controls how much passes through; Frost controls how sharp that view is.</span>
          </RailCard>

          {/* HERO TEXT — docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md
              Phase 1. Always rendered (no elementsV1Enabled/isAdmin gate,
              unlike the Elements bucket above) — layered headline text over
              the live scene, composed per capture frame. */}
          <StudioHeroTextCard
            open={heroTextOpen} onToggle={() => setHeroTextOpen((v) => !v)}
            layers={textLayers}
            selectedLayerId={selectedTextLayerId} onSelectLayer={selectTextLayer}
            onAddLayer={addTextLayer} canAddLayer={canAddTextLayer}
            onRemoveLayer={removeTextLayer} onDuplicateLayer={duplicateTextLayer}
            onLayerChange={changeTextLayer}
            onApplyLayoutPreset={applyHeroLayoutPreset}
            fontStatus={fontStatus}
            onPreviewAnim={previewTextAnim}
          />

          {/* TIMELINE — docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md
              Phase 4. The timeline lives ENTIRELY in StudioTimelineStrip
              under the canvas (track/gestures/transport/duration/loop) —
              the former rail card was removed at the user's request; the
              persisted loop preference toggle moved into the strip next to
              the duration field. */}

          <div id="cloth-rail-bucket-look" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 0' }}>
            <span style={{ ...ui.label, whiteSpace: 'nowrap' }}>LOOK</span>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: GLASS.hair }}></span>
          </div>

          {/* MATERIAL */}
          <RailCard
            id="cloth-material-panel" icon={<Layers size={18} strokeWidth={2} />} title="Material"
            subtitle={MATERIAL_PRESETS[mat.preset]?.label || 'Custom'}
            color="#8b5cf6" open={materialOpen} onToggle={() => setMaterialOpen((v) => !v)}
          >
            {/* CORRECTION (master prompt, round 5): the PRIMARY SHAPE
                selector that used to live here moved into the Images panel's
                SHEET SHAPE row (alongside Auto/Portrait/Square/Landscape) —
                one shape-selection surface instead of two. This honest
                material-inheritance note stays here since it's genuinely
                about the Material panel's own sliders. */}
            {clothShape === 'tshirt' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                Base color, finish, roughness, metalness, clearcoat, iridescence, sheen and environment intensity all apply to the T-shirt too. Only the bespoke holo-foil shader (Holo Intensity/Scale/Band Freq/Saturation/Hue Shift/Sparkle/Spec Tint) renders on the Flyer sheet only.
              </span>
            ) : null}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>PRESET</span>
              <select
                value={mat.preset || ''}
                onChange={(e) => applyPreset(e.target.value)}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                {!mat.preset ? <option value="">Custom…</option> : null}
                {PRESET_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {Object.entries(MATERIAL_PRESETS).filter(([, p]) => p.group === g).map(([id, p]) => (
                      <option key={id} value={id}>{p.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>FINISH</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {FINISHES.map((f) => (
                  <button key={f} style={{ ...ui.btn(mat.finish === f), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }} onClick={() => setMatKey('finish', f)}>
                    {f[0].toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              <input type="color" value={mat.baseColor} onChange={(e) => setMatKey('baseColor', e.target.value)} style={{ width: 44, height: 32, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
              <span style={ui.label}>Base color</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{mat.baseColor}</span>
            </label>
            {MATERIAL_SLIDERS.map(([key, label, min, max, step]) => (
              <Slider
                key={key} label={label} min={min} max={max} step={step} value={mat[key]}
                onChange={(v) => setMatKey(key, v)}
                fmt={(v) => (step >= 1 ? String(v) : v.toFixed(2))}
              />
            ))}
            <label style={uploadBtnStyle}>
              <Download size={14} strokeWidth={2.5} style={{ marginRight: 6, transform: 'rotate(180deg)' }} />
              {bumpName ? 'Replace bump map' : 'Upload bump map'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onBumpUpload(e.target.files?.[0])} />
            </label>
            {bumpName ? <span style={{ ...ui.label, color: GLASS.inkSoft }}>{bumpName}</span> : null}
            {clothShape === 'tshirt' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                Bump Tiling above also applies to the T-shirt's own fabric grain. An uploaded bump map image renders on the Flyer sheet only — the T-shirt keeps its own procedural grain.
              </span>
            ) : null}
          </RailCard>

          {/* BACKGROUND */}
          <RailCard
            id="cloth-background-panel" icon={<Palette size={18} strokeWidth={2} />} title="Background"
            subtitle={bgMode === 'scene'
              ? (getSceneDef(sceneId)?.label || 'Scene set')
              : { color: 'Solid color', image: 'Custom image', transparent: 'Transparent' }[bgMode]}
            color="#ec4899" open={backgroundOpen} onToggle={() => setBackgroundOpen((v) => !v)}
          >
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {[['scene', 'Scene'], ['color', 'Color'], ['image', 'Image'], ['transparent', 'None']].map(([m, label]) => (
                <button
                  key={m}
                  style={{ ...ui.btn(bgMode === m), height: 30, padding: '0 12px', fontSize: 10 }}
                  onClick={() => {
                    setBgMode(m);
                    // Entering Scene mode adopts the active set's light level +
                    // can rig so the set reads correctly without a second click.
                    if (m === 'scene') {
                      const sc = SCENE_PRESETS[sceneId];
                      if (typeof sc?.env === 'number') setEnvIntensity(sc.env);
                      if (sc?.lights) applyLightTemplate(sc.lights);
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {bgMode === 'scene' ? (
              <>
                <span style={{ ...ui.label, marginTop: 4 }}>SET</span>
                <div id="cloth-scene-set-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  {Object.entries(SCENE_PRESETS).map(([id, sc]) => (
                    <button
                      key={id}
                      style={{ ...ui.btn(sceneId === id), height: 30, padding: '0 8px', fontSize: 10 }}
                      onClick={() => { setSceneId(id); setSceneTweaks({}); if (typeof sc.env === 'number') setEnvIntensity(sc.env); if (sc.lights) applyLightTemplate(sc.lights); }}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Full set dressing — graded backdrop, fog depth, themed lights, and a floor that catches the sheet's shadow.</span>

                {/* MY SCENES — looks saved from the Scene Lab below. */}
                {userScenes.length ? (
                  <>
                    <span style={{ ...ui.label, marginTop: 4 }}>MY SCENES</span>
                    <div id="cloth-user-scene-grid" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {userScenes.map((u) => (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            style={{ ...ui.btn(sceneId === u.id), height: 30, padding: '0 10px', fontSize: 10, flex: 1, textAlign: 'left' }}
                            onClick={() => { setSceneId(u.id); setSceneTweaks({}); if (typeof u.def?.env === 'number') setEnvIntensity(u.def.env); if (u.def?.lights) applyLightTemplate(u.def.lights); }}
                          >
                            {u.name}
                          </button>
                          <button title="Delete this saved scene" style={{ ...ui.btn(), height: 26, padding: '0 8px', fontSize: 10 }} onClick={() => deleteUserScene(u.id)}>×</button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                {/* SCENE LAB — every dial of the ACTIVE set, tweakable live;
                    Save captures the composed look as a MY SCENES entry.
                    Tweaks overlay the set (composeSceneDef) and clear when a
                    different set is picked. */}
                <span style={{ ...ui.label, marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>SCENE LAB — TWEAK THIS SET</span>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>BACKDROP PLATE</span>
                  <select
                    id="cloth-scene-lab-plate-select"
                    value={effectiveScene.pano || ''}
                    onChange={(e) => setSceneTweak('pano', e.target.value)}
                    style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                  >
                    <option value="">None — color backdrop</option>
                    {PANO_PLATES.map((pl) => <option key={pl.id} value={pl.id}>{pl.label}</option>)}
                  </select>
                </label>
                <Slider label="PLATE BLUR" min={0} max={1} step={0.02} value={effectiveScene.panoBlur || 0} onChange={(v) => setSceneTweak('panoBlur', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!effectiveScene.pano} />
                <Slider label="PLATE ROTATION" min={-180} max={180} step={5} value={effectiveScene.panoRotY || 0} onChange={(v) => setSceneTweak('panoRotY', v)} fmt={(v) => `${v}°`} disabled={!effectiveScene.pano} />
                <Slider label="PLATE BRIGHTNESS" min={0.2} max={2} step={0.05} value={effectiveScene.panoIntensity ?? 1} onChange={(v) => setSceneTweak('panoIntensity', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!effectiveScene.pano} />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>FLOOR SURFACE</span>
                  <select
                    id="cloth-scene-lab-floor-select"
                    value={effectiveScene.groundTex || ''}
                    onChange={(e) => setSceneTweak('groundTex', e.target.value)}
                    style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                  >
                    <option value="">Flat color</option>
                    {Object.entries(GROUND_TEXTURES).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="color"
                    value={effectiveScene.groundTex ? (effectiveScene.groundTint || '#ffffff') : (effectiveScene.ground || '#808080')}
                    onChange={(e) => { setSceneTweak('groundTint', e.target.value); setSceneTweak('ground', e.target.value); }}
                    style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }}
                  />
                  <span style={ui.label}>FLOOR COLOR / TINT</span>
                </label>
                <Slider label="FLOOR HEIGHT" min={-1.15} max={-0.55} step={0.01} value={effectiveScene.groundY ?? -1.15} onChange={(v) => setSceneTweak('groundY', v)} fmt={(v) => v.toFixed(2)} />
                <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  FOG
                  <button style={{ ...ui.btn(Boolean(effectiveScene.fog)), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setSceneTweak('fogOn', !effectiveScene.fog)}>
                    {effectiveScene.fog ? 'On' : 'Off'}
                  </button>
                </span>
                {effectiveScene.fog ? (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="color" value={effectiveScene.fog.color}
                        onChange={(e) => setSceneTweak('fogColor', e.target.value)}
                        style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }}
                      />
                      <span style={ui.label}>FOG COLOR</span>
                    </label>
                    <Slider label="FOG DENSITY" min={0.01} max={0.2} step={0.005} value={effectiveScene.fog.density} onChange={(v) => setSceneTweak('fogDensity', v)} fmt={(v) => v.toFixed(3)} />
                  </>
                ) : null}
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    id="cloth-scene-lab-name-input" type="text" placeholder="Name this look…"
                    value={userSceneNameDraft} onChange={(e) => setUserSceneNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveUserScene(); }}
                    style={{ ...ui.btn(), flex: 1, textAlign: 'left', paddingLeft: 10 }}
                  />
                  <button id="cloth-scene-lab-save-btn" style={{ ...ui.btn(), padding: '0 12px' }} disabled={!userSceneNameDraft.trim()} onClick={saveUserScene}>Save</button>
                  <button title="Discard tweaks — back to the set as authored" style={{ ...ui.btn(), padding: '0 10px' }} disabled={!Object.keys(sceneTweaks).length} onClick={() => setSceneTweaks({})}>Reset</button>
                </div>
              </>
            ) : null}
            {bgMode === 'color' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} style={{ width: 44, height: 32, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
                <span style={ui.label}>Background color</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{bgColor}</span>
              </label>
            ) : null}
            {bgMode === 'image' ? (
              <div id="cloth-bg-image-controls" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={uploadBtnStyle}>
                  <Download size={14} strokeWidth={2.5} style={{ marginRight: 6, transform: 'rotate(180deg)' }} />
                  {bgImageEl ? 'Replace image' : 'Upload image'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onBgImageUpload(e.target.files?.[0])} />
                </label>
                <span style={ui.label}>FIT</span>
                <div id="cloth-bg-fit-row" style={{ display: 'flex', gap: 5 }}>
                  {[['cover', 'Cover'], ['contain', 'Contain'], ['stretch', 'Stretch']].map(([id, label]) => (
                    <button
                      key={id}
                      style={{ ...ui.btn(bgFx.fit === id), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                      onClick={() => setBgFxKey('fit', id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* SHIFT slides the image along its vertical slack: Cover
                    moves the visible crop window; Contain moves the image
                    within the letterbox; Stretch has no slack (fills). It
                    honestly does nothing when the slack falls on the
                    horizontal axis for the current image/stage ratio. */}
                <Slider
                  label={bgFx.fit === 'stretch' ? 'SHIFT (COVER/CONTAIN ONLY)' : 'SHIFT'}
                  min={-1} max={1} step={0.02} value={bgFx.shiftY}
                  onChange={(v) => setBgFxKey('shiftY', v)} fmt={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`}
                  disabled={bgFx.fit === 'stretch'}
                />
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                  Cover fills the stage and crops the overflow (never skewed); Contain shows the whole image with {`“`}bars{`”`} in the background color; Stretch is the old fill-to-fit. Shift slides the image up/down within the available slack.
                </span>
              </div>
            ) : null}
            {bgMode === 'transparent' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Transparent scene — pairs with "Export PNG (no background)" for compositing.</span>
            ) : null}
            {/* Backdrop effect opt-out — all bg modes. The backdrop is never
                lit by scene lights (it's a flat plate behind everything), so
                the Diffusion Camera blur is the one look-effect it can opt
                out of; vignette/grain/treatment still apply as part of the
                print look. */}
            <span id="cloth-bg-diffusion-toggle-row" style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
              DIFFUSION ON BACKGROUND
              <button style={{ ...ui.btn(bgFx.diffusion), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setBgFxKey('diffusion', !bgFx.diffusion)}>
                {bgFx.diffusion ? 'On' : 'Off'}
              </button>
            </span>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
              Off keeps the background perfectly crisp while the Diffusion Camera still blurs off-focus scene objects. Scene lighting never affects the background either way; vignette, grain and treatments still apply.
            </span>
          </RailCard>

          {/* LIGHTING — four positionable stage cans + rig templates. */}
          <RailCard
            id="cloth-lighting-panel" icon={<Lightbulb size={18} strokeWidth={2} />} title="Lighting"
            subtitle={`${LIGHT_TEMPLATES[lightTemplate]?.label || 'Custom rig'}${envId !== 'room' ? ` · ${ENV_PRESETS[envId]?.label}` : ''}`}
            color="#eab308" open={lightingOpen} onToggle={() => setLightingOpen((v) => !v)}
            maxH={3200}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>TEMPLATE</span>
              <select
                value={lightTemplate || ''}
                onChange={(e) => applyLightTemplate(e.target.value)}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                {!lightTemplate ? <option value="">Custom…</option> : null}
                {Object.entries(LIGHT_TEMPLATES).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
              </select>
            </label>
            {lightCans.map((c, i) => (
              <div key={i} id={`cloth-light-can-${i + 1}-block`} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
                <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {CAN_LABELS[i]}
                  <button style={{ ...ui.btn(c.on), height: 26, padding: '0 12px', fontSize: 10 }} onClick={() => setCanKey(i, 'on', !c.on)}>
                    {c.on ? 'On' : 'Off'}
                  </button>
                </span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: c.on ? 1 : 0.4 }}>
                  <input type="color" value={c.color} disabled={!c.on} onChange={(e) => setCanKey(i, 'color', e.target.value)} style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
                  <span style={ui.label}>Color</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{c.color}</span>
                </label>
                <Slider label="INTENSITY" min={0} max={3} step={0.05} value={c.intensity} onChange={(v) => setCanKey(i, 'intensity', v)} disabled={!c.on} />
                <Slider label="ANGLE" min={-180} max={180} step={5} value={c.az} onChange={(v) => setCanKey(i, 'az', v)} fmt={(v) => `${v}°`} disabled={!c.on} />
                <Slider label="HEIGHT" min={-80} max={85} step={5} value={c.el} onChange={(v) => setCanKey(i, 'el', v)} fmt={(v) => `${v}°`} disabled={!c.on} />
              </div>
            ))}
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Angle walks the can around the stage (0° = front); height raises it toward overhead or drops it below the floor. Scene sets swap in a matching rig — tweak from there.</span>
            <span style={{ ...ui.label, marginTop: 4 }}>ENVIRONMENT LIGHT</span>
            <div id="cloth-env-select-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {Object.entries(ENV_PRESETS).map(([id, env]) => (
                <button
                  key={id}
                  style={{ ...ui.btn(envId === id), height: 30, padding: '0 8px', fontSize: 10 }}
                  onClick={() => setEnvId(id)}
                >
                  {envLoadingId === id ? 'Loading…' : env.label}
                </button>
              ))}
            </div>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>This is the light the artwork and the glass reflect — a real place instead of a white box. It does not change what you see behind the sheet; that is the Background above.</span>
            <Slider label="LIGHT INTENSITY" min={0} max={2.5} step={0.05} value={envIntensity} onChange={setEnvIntensity} fmt={(v) => `${Math.round(v * 100)}%`} />
          </RailCard>

          {/* FX — post-processing finish; renders through the composer. */}
          <RailCard
            id="cloth-fx-panel" icon={<Sparkles size={18} strokeWidth={2} />} title="Effects"
            subtitle={`${FX_PRESETS[fxPresetId]?.label || [
              TREATMENTS[fx.treatment]?.define ? TREATMENTS[fx.treatment].label : null,
              fx.bloom ? 'Bloom' : null,
              fx.grain > 0.001 ? `grain ${Math.round(fx.grain * 100)}%` : null,
              fx.vignette > 0.001 ? `vignette ${Math.round(fx.vignette * 100)}%` : null,
            ].filter(Boolean).join(' · ') || 'Off'} · seed ${lookSeed}`}
            color="#a855f7" open={fxOpen} onToggle={() => setFxOpen((v) => !v)}
            maxH={3200}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>LOOK</span>
              <select
                value={fxPresetId}
                onChange={(e) => applyLookMutation(() => applyFxPreset(e.target.value))}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                {!fxPresetId ? <option value="">Custom…</option> : null}
                {FX_PRESET_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {Object.entries(FX_PRESETS).filter(([, p]) => p.group === g).map(([id, p]) => (
                      <option key={id} value={id}>{p.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label id="cloth-fx-look-intensity-row" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>RANDOMIZE INTENSITY</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {INTENSITY_TIERS.map((tier) => (
                  <button
                    key={tier}
                    title={INTENSITY_META[tier]?.description}
                    style={{ ...ui.btn(randomizeIntensity === tier), height: 28, padding: '0 6px', fontSize: 10, flex: 1 }}
                    onClick={() => setRandomizeIntensity(tier)}
                  >
                    {INTENSITY_META[tier]?.label || tier}
                  </button>
                ))}
              </div>
              <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }}>
                Refine preserves the current look (nudges numbers only); Remix/Transform/Wild pick a new one, increasingly far from where you started. Shared with the Elements card's Randomize.
              </span>
            </label>
            <button id="cloth-fx-randomize-btn" style={{ ...ui.btn(), width: '100%' }} onClick={randomizeFx}>
              <Shuffle size={13} strokeWidth={2.5} style={{ marginRight: 6 }} />Randomize look
            </button>
            {lookRandomizeReport.length ? (
              <span style={{ ...ui.label, color: GLASS.inkMute }}>Changed: {lookRandomizeReport.join(', ')}</span>
            ) : null}
            <div id="cloth-fx-look-history-row" style={{ display: 'flex', gap: 8 }}>
              <button
                id="cloth-fx-look-undo-btn"
                style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: lookHistoryRef.current.undo.length > 0 ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                disabled={lookHistoryRef.current.undo.length === 0}
                onClick={undoLook}
              >
                <Undo2 size={12} strokeWidth={2.5} /> Undo look
              </button>
              <button
                id="cloth-fx-look-redo-btn"
                style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: lookHistoryRef.current.redo.length > 0 ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                disabled={lookHistoryRef.current.redo.length === 0}
                onClick={redoLook}
              >
                <Redo2 size={12} strokeWidth={2.5} /> Redo look
              </button>
            </div>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>A look sets the whole stage — treatment, film, material, environment light, backdrop and light rig. Tweak anything after and it becomes Custom.</span>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              <span style={ui.label}>TREATMENT</span>
              <select
                value={fx.treatment}
                onChange={(e) => setTreatment(e.target.value)}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                {Object.entries(TREATMENTS).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
              </select>
            </label>
            {(TREATMENTS[fx.treatment]?.params || []).map(([key, label, min, max, step, fmt]) => (
              <Slider
                key={key} label={label} min={min} max={max} step={step}
                value={fx[key]} onChange={(v) => setFxKey(key, v)} fmt={fmt}
              />
            ))}
            {TREATMENTS[fx.treatment]?.colors ? (
              <div id="cloth-fx-ink-row" style={{ display: 'flex', gap: 8 }}>
                {[['colA', TREATMENTS[fx.treatment].colors[0]], ['colB', TREATMENTS[fx.treatment].colors[1]]].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <input
                      type="color" value={fx[key]} onChange={(e) => setFxKey(key, e.target.value)}
                      style={{ width: 40, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                    />
                    <span style={{ ...ui.label, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <span style={{ ...ui.label, marginTop: 4 }}>FILM</span>
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              BLOOM
              <button style={{ ...ui.btn(fx.bloom), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setFxKey('bloom', !fx.bloom)}>
                {fx.bloom ? 'On' : 'Off'}
              </button>
            </span>
            <Slider label="BLOOM STRENGTH" min={0} max={2} step={0.05} value={fx.bloomStrength} onChange={(v) => setFxKey('bloomStrength', v)} fmt={(v) => `${v.toFixed(2)}x`} disabled={!fx.bloom} />
            <Slider label="BLOOM THRESHOLD" min={0} max={1} step={0.01} value={fx.bloomThreshold} onChange={(v) => setFxKey('bloomThreshold', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!fx.bloom} />
            <Slider label="FILM GRAIN" min={0} max={1} step={0.01} value={fx.grain} onChange={(v) => setFxKey('grain', v)} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="VIGNETTE" min={0} max={1} step={0.01} value={fx.vignette} onChange={(v) => setFxKey('vignette', v)} fmt={(v) => `${Math.round(v * 100)}%`} />
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Camera finish on the whole picture: bloom makes bright highlights glow (threshold sets how bright something must be before it does), grain adds film texture, vignette darkens the corners of the active capture frame. Everything here is captured in PNG exports and video recordings — except the transparent PNG, which skips them to keep real alpha.</span>

            {/* LOOK PRESETS — Slice 2. A user-saved kind, separate from the
                built-in named FX_PRESETS above (Custom.../Randomize look) —
                captures material/environment/background/lighting/camera-look
                (incl. Diffusion Camera) as one named, reloadable snapshot. */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
              <span style={ui.label}>LOOK PRESETS</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  id="cloth-look-preset-name-input" type="text" placeholder="Name this look…" value={lookPresetNameDraft}
                  onChange={(e) => setLookPresetNameDraft(e.target.value)}
                  style={{ ...ui.btn(), flex: 1, textAlign: 'left', paddingLeft: 10 }}
                />
                <button id="cloth-look-preset-save-btn" style={{ ...ui.btn(), padding: '0 12px' }} onClick={saveCurrentAsLookPreset}>Save</button>
              </div>
              {listActiveTemplates(lookPresets).length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {listActiveTemplates(lookPresets).map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <button style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10 }} onClick={() => loadLookPresetById(p.id)}>Load</button>
                      <button style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10 }} onClick={() => archiveLookPresetById(p.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>No saved looks yet.</span>
              )}
              {lookPresetStatus ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{lookPresetStatus}</span> : null}
            </label>

            <CloudTemplateSection
              kind="look" authedFetch={authedFetch} isAdmin={isAdmin}
              onCaptureRecipe={captureLookPresetRecipe} onLoadRecipe={applyLookPresetRecipe}
              sourceSeed={lookSeed}
              localEntries={listActiveTemplates(lookPresets).map((p) => ({ id: p.id, name: p.name, recipe: p.recipe }))}
            />
          </RailCard>

          <div id="cloth-rail-bucket-motion" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 0' }}>
            <span style={{ ...ui.label, whiteSpace: 'nowrap' }}>MOTION</span>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: GLASS.hair }}></span>
          </div>

          {/* ANIMATE — ambient wind idle; the sheet billows but never drifts. */}
          <RailCard
            id="cloth-animate-panel" icon={<Wind size={18} strokeWidth={2} />} title="Animate"
            subtitle={anim.on ? `Blowing · ${Math.round(anim.turbulence * 100)}% turbulence` : 'Off'}
            color="#0ea5e9" open={animOpen} onToggle={() => setAnimOpen((v) => !v)}
          >
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              AUTO ANIMATE
              <button style={{ ...ui.btn(anim.on), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setAnim((a) => ({ ...a, on: !a.on }))}>
                {anim.on ? 'On' : 'Off'}
              </button>
            </span>
            <Slider label="TURBULENCE" min={0} max={1} step={0.01} value={anim.turbulence} onChange={(v) => setAnim((a) => ({ ...a, turbulence: v }))} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!anim.on} />
            <Slider label="SPEED" min={0.2} max={3} step={0.05} value={anim.speed} onChange={(v) => setAnim((a) => ({ ...a, speed: v }))} fmt={(v) => `${v.toFixed(2)}x`} disabled={!anim.on} />
            <Slider
              label="REBOUND" min={0} max={1} step={0.01} value={phys.rebound ?? 0}
              onChange={(v) => setPhysKey('rebound', v)} fmt={(v) => `${Math.round(v * 100)}%`}
              disabled={phys.pinMode !== 'free-float' || clothShape !== 'sheet'}
            />
            <Slider
              label="RUMPLE" min={0} max={1} step={0.01} value={phys.rumple ?? 0.5}
              onChange={(v) => setPhysKey('rumple', v)} fmt={(v) => `${Math.round(v * 100)}%`}
              disabled={clothShape !== 'sheet'}
            />
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Turbulence dials the chaos and drives the T-shirt's wind too. Rebound and Rumple are Flyer-sheet-only: Rebound sets how fast the sheet retracts to its original shape — at 0% it stays right where you throw it; Rumple sets how "already handled" the sheet opens (and resets) looking.</span>
          </RailCard>

          {/* PHYSICS */}
          <RailCard
            id="cloth-physics-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Physics"
            subtitle={PIN_MODES.find((p) => p.id === phys.pinMode)?.label || 'Cloth sim'}
            color="#14b8a6" open={physicsOpen} onToggle={() => setPhysicsOpen((v) => !v)}
          >
            {phys.pinMode === 'free-float' && clothShape === 'sheet' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Floating mode is weightless — gravity applies when the sheet is pinned.</span>
            ) : null}
            <Slider label="GRAVITY" min={0} max={4} step={0.05} value={phys.gravity} onChange={(v) => setPhysKey('gravity', v)} disabled={phys.pinMode === 'free-float' && clothShape === 'sheet'} />
            <Slider label="DAMPING" min={0.9} max={0.998} step={0.001} value={phys.damping} onChange={(v) => setPhysKey('damping', v)} fmt={(v) => v.toFixed(3)} />
            <Slider label="STIFFNESS" min={0.3} max={1} step={0.01} value={phys.stiffness} onChange={(v) => setPhysKey('stiffness', v)} />
            {clothShape === 'tshirt' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Gravity, damping and stiffness drive the T-shirt's hanger-pinned simulation too.</span>
            ) : null}
            <span style={{ ...ui.label, marginTop: 4 }}>CAMERA AXES</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {[['rotY', 'Orbit ↔'], ['rotX', 'Orbit ↕'], ['pan', 'Pan']].map(([k, label]) => (
                <button
                  key={k}
                  title={`${label} ${cam[k] ? 'enabled' : 'locked'}`}
                  style={{ ...ui.btn(cam[k]), height: 30, padding: '0 12px', fontSize: 10 }}
                  onClick={() => setCam((c) => ({ ...c, [k]: !c[k] }))}
                >
                  {label}
                </button>
              ))}
            </div>
            <span style={{ ...ui.label, marginTop: 4, opacity: clothShape === 'sheet' ? 1 : 0.4 }}>PINS{clothShape !== 'sheet' ? ' (Flyer only — the T-shirt uses its fixed hanger pin)' : ''}</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {PIN_MODES.map((p) => (
                <button key={p.id} disabled={clothShape !== 'sheet'} style={{ ...ui.btn(phys.pinMode === p.id), height: 30, padding: '0 12px', fontSize: 10 }} onClick={() => setPhysKey('pinMode', p.id)}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button disabled={clothShape !== 'sheet'} title={clothShape !== 'sheet' ? 'Poke — Flyer sheet only' : 'Poke the cloth'} style={{ ...ui.btn(), flex: 1 }} onClick={() => worldRef.current?.poke()}><Zap size={13} strokeWidth={2.5} style={{ marginRight: 5 }} />Poke</button>
              <button style={{ ...ui.btn(), flex: 1 }} onClick={() => worldRef.current?.resetCloth()}><RotateCcw size={13} strokeWidth={2.5} style={{ marginRight: 5 }} />Reset cloth</button>
            </div>
          </RailCard>

          <div id="cloth-rail-bucket-camera" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 0' }}>
            <span style={{ ...ui.label, whiteSpace: 'nowrap' }}>CAMERA</span>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: GLASS.hair }}></span>
          </div>

          {/* CAMERA — positionable shot cam + HUD overlay. */}
          <RailCard
            id="cloth-camera-panel" icon={<Focus size={18} strokeWidth={2} />} title="Camera"
            subtitle={shotCam.use ? 'Shot cam live' : 'Orbit view'}
            color="#ec4899" open={cameraOpen} onToggle={() => setCameraOpen((v) => !v)}
          >
            {/* CAMERA MOVES — the Mockup Video studio's authored templates
                (camera-templates.js). Same picker as the timeline bar's
                "Moves" dropdown; applying replaces the timeline keyframes. */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>CAMERA MOVES</span>
              <select
                id="cloth-camera-move-select"
                value=""
                onChange={(e) => { if (e.target.value) { applyCameraTemplate(e.target.value); e.target.value = ''; } }}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                <option value="">Apply a camera move…</option>
                {CAMERA_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label} · {t.theme} · {t.seconds}s</option>
                ))}
              </select>
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                Loads an authored camera ride onto the timeline (replaces current keyframes; scene stays as-is) — then press Play or Export Timeline.
              </span>
            </label>
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              USE SHOT CAM
              <button style={{ ...ui.btn(shotCam.use), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setShotKey('use', !shotCam.use)}>
                {shotCam.use ? 'On' : 'Off'}
              </button>
            </span>
            <Slider label="ANGLE" min={-180} max={180} step={5} value={shotCam.az} onChange={(v) => setShotKey('az', v)} fmt={(v) => `${v}°`} />
            <Slider label="HEIGHT" min={-80} max={85} step={5} value={shotCam.el} onChange={(v) => setShotKey('el', v)} fmt={(v) => `${v}°`} />
            <Slider label="DISTANCE" min={1.2} max={8} step={0.1} value={shotCam.dist} onChange={(v) => setShotKey('dist', v)} fmt={(v) => v.toFixed(1)} />
            <Slider label="FOV" min={20} max={90} step={1} value={shotCam.fov} onChange={(v) => setShotKey('fov', v)} fmt={(v) => `${v}°`} />
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              HUD OVERLAY
              <button style={{ ...ui.btn(hudOn), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setHudOn((v) => !v)}>
                {hudOn ? 'On' : 'Off'}
              </button>
            </span>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>HUD draws each light can (numbered dot + line to stage) and the shot cam wedge over the canvas. Shot cam takes over rendering while On — orbit resumes when Off.</span>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                id="cloth-camera-undo-btn" style={{ ...ui.btn(), height: 28, padding: '0 10px', fontSize: 10, flex: 1, opacity: camHistoryRef.current.undo.length ? 1 : 0.4 }}
                disabled={!camHistoryRef.current.undo.length} onClick={undoCam}
              >
                <Undo2 size={12} strokeWidth={2.5} /> Undo
              </button>
              <button
                id="cloth-camera-redo-btn" style={{ ...ui.btn(), height: 28, padding: '0 10px', fontSize: 10, flex: 1, opacity: camHistoryRef.current.redo.length ? 1 : 0.4 }}
                disabled={!camHistoryRef.current.redo.length} onClick={redoCam}
              >
                <Redo2 size={12} strokeWidth={2.5} /> Redo
              </button>
            </div>
          </RailCard>

          {/* DIFFUSION CAMERA — split out of the Camera card into its
              own; Camera keeps shot cam/HUD/undo-redo
              (docs/plans/STUDIO-RAIL-IA-REORG-PLAN.md). */}
          <RailCard
            id="cloth-diffusion-camera-panel" icon={<Aperture size={18} strokeWidth={2} />} title="Diffusion Camera"
            subtitle={diffusionCamera.enabled ? (diffusionFocalTargets.find((t) => t.id === diffusionCamera.focalTarget)?.label || 'On') : 'Off'}
            color="#ec4899" open={diffusionCameraOpen} onToggle={() => setDiffusionCameraOpen((v) => !v)}
          >
            {/* DIFFUSION CAMERA — Slice 1. Camera/look/post-processing
                feature (never an element mesh): keeps a focal point sharp
                while everything outside it softens. Cloud Final Render
                parity shipped in Phase B (STUDIO-DETERMINISTIC-FINAL-
                RENDER-SONNET-HANDOFF.md) — services/studio-render/
                art-scene.mjs genuinely renders the same two-pass
                diffusion/treatment composer chain server-side. */}
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
              DIFFUSION CAMERA
              <button style={{ ...ui.btn(diffusionCamera.enabled), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setDiffusionCameraKey('enabled', !diffusionCamera.enabled)}>
                {diffusionCamera.enabled ? 'On' : 'Off'}
              </button>
            </span>
            <span id="cloth-diffusion-camera-support-badge" style={{ ...ui.label, color: '#b45309' }}>Applies to preview + PNG/MP4 export + cloud Final Render</span>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: diffusionCamera.enabled ? 1 : 0.4 }}>
              <span style={ui.label}>FOCAL TARGET</span>
              <select
                id="cloth-diffusion-camera-focal-target-select"
                value={diffusionCamera.focalTarget}
                disabled={!diffusionCamera.enabled}
                onChange={(e) => setDiffusionCameraKey('focalTarget', e.target.value)}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                {diffusionFocalTargets.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
            {diffusionCamera.enabled && !diffusionFocalTargetResolved ? (
              <span id="cloth-diffusion-camera-focal-target-fallback-note" style={{ ...ui.label, color: '#b45309', textTransform: 'none', fontSize: 11 }}>
                Selected target isn&apos;t currently live — using Center of scene instead.
              </span>
            ) : null}
            {/* Focus Distance is a real, editable focus-ring dial ONLY in
                Manual mode — every other target computes a live camera-
                space distance every frame (see the render loop), so the
                dial would just be a number nothing reads; disabling it
                honestly reflects that rather than leaving a control
                visible while ignored. */}
            <Slider
              label={diffusionCamera.focalTarget === DIFFUSION_FOCAL_MANUAL ? 'FOCUS DISTANCE' : 'FOCUS DISTANCE (MANUAL TARGET ONLY)'}
              min={0.5} max={4.5} step={0.05} value={diffusionCamera.focusDistance}
              onChange={(v) => setDiffusionCameraKey('focusDistance', v)} fmt={(v) => v.toFixed(2)}
              disabled={!diffusionCamera.enabled || diffusionCamera.focalTarget !== DIFFUSION_FOCAL_MANUAL}
            />
            <Slider label="APERTURE" min={0} max={1} step={0.02} value={diffusionCamera.aperture} onChange={(v) => setDiffusionCameraKey('aperture', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!diffusionCamera.enabled} />
            <Slider label="FALLOFF" min={0} max={1} step={0.02} value={diffusionCamera.falloff} onChange={(v) => setDiffusionCameraKey('falloff', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!diffusionCamera.enabled} />
            <Slider label="DIFFUSION RADIUS" min={0} max={1} step={0.02} value={diffusionCamera.diffusionRadius} onChange={(v) => setDiffusionCameraKey('diffusionRadius', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!diffusionCamera.enabled} />
            {/* Dead-zone warning — APERTURE 0% × DIFFUSION RADIUS 0% maps to a
                sub-pixel max blur (the shader's own radius > 0.4px gate then
                skips the blur entirely), so the feature reads as broken while
                On. computeBlurRadiusPx(1, …) is the worst-case (coc=1) radius
                the current sliders can produce — same module the shader math
                mirrors, so this note can never drift from the real response. */}
            {diffusionCamera.enabled && computeBlurRadiusPx(1, diffusionCamera) < 1 ? (
              <span id="cloth-diffusion-camera-no-blur-note" style={{ ...ui.label, color: '#b45309', textTransform: 'none', fontSize: 11 }}>
                Aperture and Diffusion Radius are near zero — no visible blur at these settings. Raise both to see the effect.
              </span>
            ) : null}
            <Slider label="HIGHLIGHT BLOOM" min={0} max={1} step={0.02} value={diffusionCamera.highlightBloom} onChange={(v) => setDiffusionCameraKey('highlightBloom', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!diffusionCamera.enabled} />
            <Slider label="FOREGROUND BIAS" min={-1} max={1} step={0.02} value={diffusionCamera.foregroundBias} onChange={(v) => setDiffusionCameraKey('foregroundBias', v)} fmt={(v) => v.toFixed(2)} disabled={!diffusionCamera.enabled} />
            <Slider label="BACKGROUND BIAS" min={-1} max={1} step={0.02} value={diffusionCamera.backgroundBias} onChange={(v) => setDiffusionCameraKey('backgroundBias', v)} fmt={(v) => v.toFixed(2)} disabled={!diffusionCamera.enabled} />
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              LOCK
              <button style={{ ...ui.btn(diffusionCamera.locked), height: 26, padding: '0 12px', fontSize: 10 }} onClick={() => setDiffusionCameraKey('locked', !diffusionCamera.locked)}>
                {diffusionCamera.locked ? 'Locked' : 'Unlocked'}
              </button>
            </span>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>A camera/look effect, not a scene element — the focal target stays sharp while everything outside it softens. Locking it is respected by both Camera-only and Look-only randomize.</span>
          </RailCard>

          <div id="cloth-rail-bucket-output" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 0' }}>
            <span style={{ ...ui.label, whiteSpace: 'nowrap' }}>GENERATE & OUTPUT</span>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: GLASS.hair }}></span>
          </div>

          {/* MASTER SAVE — deliberately OUTSIDE the elementsV1Enabled gate:
              one-click full-state versioning is core workflow for every
              user of the public tool, not an element-system feature. */}
          <MasterSavesCard
            open={masterSavesOpen} onToggle={() => setMasterSavesOpen((v) => !v)}
            saves={masterSaves} nameDraft={masterSaveNameDraft} onNameDraftChange={setMasterSaveNameDraft}
            onSaveVersion={saveMasterVersion} onLoad={loadMasterVersionById}
            onOverwrite={overwriteMasterVersionById} onRename={renameMasterVersionById}
            onDelete={deleteMasterVersionById}
            status={masterSaveStatus}
          />

          {elementsV1Enabled ? (
            <>
              {/* RANDOMIZE (unified scope control) — Slice 1. Additional
                  entry point onto the 9 randomization scopes; the dedicated
                  Randomize/All/Randomize-look buttons below/in the Effects
                  card are untouched and keep working exactly as before. */}
              <RailCard
                id="cloth-randomize-scope-panel" icon={<Shuffle size={18} strokeWidth={2} />} title="Randomize"
                subtitle={RANDOMIZE_SCOPES.find((s) => s.id === randomizeScope)?.label}
                color="#8b5cf6" open={randomizeScopeOpen} onToggle={() => setRandomizeScopeOpen((v) => !v)}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>SCOPE</span>
                  <select
                    id="cloth-randomize-scope-select"
                    value={randomizeScope}
                    onChange={(e) => setRandomizeScope(e.target.value)}
                    style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                  >
                    {RANDOMIZE_SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                <button id="cloth-randomize-scope-run-btn" style={{ ...ui.btn(), width: '100%' }} onClick={runScopedRandomize}>
                  <Shuffle size={13} strokeWidth={2.5} style={{ marginRight: 6 }} />Randomize
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    id="cloth-randomize-scope-undo-btn" style={{ ...ui.btn(), flex: 1, fontSize: 11 }}
                    onClick={undoLastScope} disabled={!lastScopeDomains}
                  >
                    <Undo2 size={12} strokeWidth={2.5} /> Undo
                  </button>
                  <button
                    id="cloth-randomize-scope-redo-btn" style={{ ...ui.btn(), flex: 1, fontSize: 11 }}
                    onClick={redoLastScope} disabled={!lastScopeDomains}
                  >
                    <Redo2 size={12} strokeWidth={2.5} /> Redo
                  </button>
                </div>
                {lockSkipReport && (lockSkipReport.elements.length || lockSkipReport.camera.length) ? (
                  <div id="cloth-randomize-scope-skip-report" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={ui.label}>SKIPPED (LOCKED)</span>
                    {lockSkipReport.elements.map((e, i) => (
                      <span key={`el-${i}`} style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>{e.name} — {e.reason}</span>
                    ))}
                    {lockSkipReport.camera.map((c, i) => (
                      <span key={`cam-${i}`} style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>Diffusion Camera — {c.reason}</span>
                    ))}
                  </div>
                ) : null}
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                  Entire set and Unlocked values only cover Elements + Colors + Lighting + Camera in one undoable step. Unlocked values only additionally lists exactly what got skipped for being locked — otherwise the two behave the same, since every scope already respects locks.
                </span>
              </RailCard>

              {/* CURATED SETS — Slice 2. 12 named, deterministic starting
                  points (elements/curated-generators.js). REPLACES the
                  current extraInstances with a fresh themed set (not a
                  merge) — a curated set is a starting point, not an
                  addition. One undoable step across Elements + Look +
                  Camera, same cross-scope transaction the Randomize card
                  above uses. */}
              <RailCard
                id="cloth-curated-sets-panel" icon={<Layers size={18} strokeWidth={2} />} title="Curated Sets"
                subtitle={CURATED_GENERATORS.find((g) => g.id === curatedGeneratorId)?.label}
                color="#0ea5e9" open={curatedSetsOpen} onToggle={() => setCuratedSetsOpen((v) => !v)}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>SET</span>
                  <select
                    id="cloth-curated-set-select"
                    value={curatedGeneratorId}
                    onChange={(e) => setCuratedGeneratorId(e.target.value)}
                    style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                  >
                    {CURATED_GENERATORS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.4, color: GLASS.inkMute }}>
                    {CURATED_GENERATORS.find((g) => g.id === curatedGeneratorId)?.description}
                  </span>
                </label>
                <button id="cloth-curated-set-generate-btn" style={{ ...ui.btn(), width: '100%' }} onClick={generateAndApplyCuratedSet}>
                  <Shuffle size={13} strokeWidth={2.5} style={{ marginRight: 6 }} />Generate
                </button>
                {curatedSetStatus ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{curatedSetStatus}</span> : null}
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                  Replaces the current elements with a fresh themed set and applies its look/environment/camera — one Undo (in the Randomize card above) reverts it. Re-running the same set gives a different pick each time.
                </span>
              </RailCard>

              <SceneTemplatesCard
                open={templatesOpen} onToggle={() => setTemplatesOpen((v) => !v)}
                templates={sceneTemplates} nameDraft={templateNameDraft} onNameDraftChange={setTemplateNameDraft}
                onSave={saveCurrentAsTemplate} onLoad={loadTemplateById} onResave={resaveTemplateById}
                onRename={renameTemplateById} onDuplicate={duplicateTemplateById}
                onArchive={archiveTemplateById} onUnarchive={unarchiveTemplateById}
                onExport={exportTemplateById} onImportJSON={importTemplateFromJSON}
                status={templateStatus}
              />
              <RailCard
                id="cloth-scene-cloud-panel" icon={<Cloud size={18} strokeWidth={2} />} title="Scene Templates — Cloud"
                subtitle="Team + Global" color="#0ea5e9" open={templatesOpen} onToggle={() => setTemplatesOpen((v) => !v)}
              >
                <CloudTemplateSection
                  kind="scene" authedFetch={authedFetch} isAdmin={isAdmin}
                  onCaptureRecipe={captureSceneRecipe} onLoadRecipe={applySceneRecipe}
                  sourceSeed={sceneSeed}
                  localEntries={listActiveTemplates(sceneTemplates).map((t) => ({ id: t.id, name: t.name, recipe: t.recipe }))}
                />
              </RailCard>
            </>
          ) : null}

          {/* RENDER / EXPORT */}
          <RailCard
            id="cloth-render-panel" icon={<Download size={18} strokeWidth={2} />} title="Render"
            subtitle={`PNG · ${videoSeconds}s ${VIDEO_FORMATS[videoFormat]?.label || 'MP4'}`}
            color="#10b981" open={renderOpen} onToggle={() => setRenderOpen((v) => !v)}
            badge={recording ? (
              <span style={{ ...ui.label, color: '#fff', background: '#dc2626', padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>REC</span>
            ) : null}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>PERFORMANCE</span>
              <select value={perf} onChange={(e) => setPerf(e.target.value)} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
                {Object.entries(PERF_LEVELS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>CAPTURE FRAME</span>
              <select value={frameId} onChange={(e) => setFrameId(e.target.value)} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
                {Object.entries(FRAME_PRESETS).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
              </select>
            </label>
            {/* Export-restore round — escape hatch: whatever else breaks in
                the device/live subsystem, this always reaches a recording.
                Bypasses runExportWithLiveGuard entirely (no capture fetch,
                no teardown-readiness wait) for every export button below. */}
            <span id="studio-export-skip-live-prep-row" style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              SKIP LIVE-SCREEN PREP
              <button
                id="studio-export-skip-live-prep-toggle"
                style={{ ...ui.btn(skipLivePrep), height: 28, padding: '0 12px', fontSize: 10 }}
                onClick={() => setSkipLivePrep((v) => !v)}
              >
                {skipLivePrep ? 'On' : 'Off'}
              </button>
            </span>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>When on, Export PNG/Export video/Export Timeline record the canvas exactly as it looks right now, skipping the Go-Live capture-and-teardown wait.</span>
            {/* Phase 8 — "Record live screen": the ONLY export source that
                can contain the live website, because it records the
                composited TAB (getDisplayMedia) rather than the WebGL
                canvas. Offered only for the Device subject; the toggle is
                disabled with the exact reason until Go Live is actually
                running (evaluateLiveRecordEligibility, elements/video-
                export.js). Deliberately explicit about the resolution
                trade-off — this is NOT equivalent to the normal export. */}
            {clothShape === 'device' ? (
              <>
                <span id="studio-export-record-live-screen-row" style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  RECORD LIVE SCREEN
                  <button
                    id="studio-export-record-live-screen-toggle"
                    style={{ ...ui.btn(liveRecordActive), height: 28, padding: '0 12px', fontSize: 10, opacity: liveRecordEligibility.eligible ? 1 : 0.6 }}
                    onClick={() => setRecordLiveScreen((v) => !v)}
                  >
                    {recordLiveScreen ? (liveRecordEligibility.eligible ? 'On' : 'On — waiting') : 'Off'}
                  </button>
                </span>
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                  {liveRecordEligibility.eligible
                    ? 'Records this browser tab instead of the WebGL canvas, so the REAL live website is in the video (no capture, no screenshot, Go Live stays up the whole time). Chrome asks which surface to share — choose this tab. Trade-off: tab capture records at your SCREEN’s resolution and is upscaled to the frame size, so it is softer than a normal export, and it runs at 30fps. Keep the studio window on top and unobstructed — anything covering the stage is in the video.'
                    : liveRecordEligibility.reason}
                </span>
              </>
            ) : null}
            {/* Phase 7 — the export-time website capture, made visible. The
                fetch behind it can legitimately run 8-110 seconds; before
                this row it ran behind a single static status string with
                every export button still looking clickable, which is what the
                user experienced as "Export Video does nothing". Real elapsed
                seconds, never a fabricated percentage — the route's duration
                is not knowable from here. */}
            {liveCaptureBusy ? (
              <div
                id="cloth-export-live-capture-row"
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '8px 10px', borderRadius: 8,
                  border: '1px solid ' + GLASS.hair, background: 'rgba(0,0,0,0.03)',
                }}
              >
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, fontWeight: 600, color: GLASS.ink }}>
                  {`Capturing ${liveCapturePrep.url}… ${liveCaptureElapsed}s of up to ${LIVE_CAPTURE_MAX_SECONDS}s`}
                </span>
                <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.5, color: GLASS.inkMute }}>
                  A live site can’t be recorded directly, so the screen is being photographed first. Nothing is recording yet — the export (and, for a timeline, the animation) starts on its own the moment the capture lands. The first capture of a site is the slow one; later exports reuse it.
                </span>
              </div>
            ) : null}
            <button style={{ ...ui.btn(), width: '100%', opacity: liveCaptureBusy ? 0.5 : 1 }} disabled={liveCaptureBusy} onClick={() => (skipLivePrep ? exportPng(false) : runExportWithLiveGuard(() => exportPng(false)))}>
              <Camera size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />Export PNG
            </button>
            <button style={{ ...ui.btn(), width: '100%', opacity: liveCaptureBusy ? 0.5 : 1 }} disabled={liveCaptureBusy} onClick={() => (skipLivePrep ? exportPng(true) : runExportWithLiveGuard(() => exportPng(true)))}>
              <Camera size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />Export PNG (no background)
            </button>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              <span style={ui.label}>VIDEO FORMAT</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {Object.entries(VIDEO_FORMATS).map(([f, cfg]) => (
                  <button key={f} style={{ ...ui.btn(videoFormat === f), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }} onClick={() => setVideoFormat(f)}>{cfg.label}</button>
                ))}
              </div>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>VIDEO LENGTH</span>
              <select value={videoSeconds} onChange={(e) => setVideoSeconds(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
                {[3, 5, 8, 10, 15].map((s) => <option key={s} value={s}>{s}S</option>)}
              </select>
            </label>
            {recording ? (
              <div id="cloth-export-recording-row" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recordingProgress ? (
                  <div id="cloth-export-progress-track" style={{ height: 4, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999, background: '#10b981',
                      width: `${Math.min(100, (recordingProgress.elapsed / Math.max(0.001, recordingProgress.total)) * 100)}%`,
                      transition: 'width 0.2s linear',
                    }} />
                  </div>
                ) : null}
                <button style={{ ...ui.btn(), width: '100%' }} onClick={cancelExportVideo}>
                  Cancel export{recordingProgress ? ` (${recordingProgress.elapsed.toFixed(1)}s / ${recordingProgress.total}s)` : '…'}
                </button>
              </div>
            ) : (
              <button
                style={{ ...ui.cta, width: '100%', opacity: liveCaptureBusy ? 0.6 : 1, cursor: liveCaptureBusy ? 'progress' : 'pointer' }}
                disabled={liveCaptureBusy}
                onClick={startVideoExport}
              >
                <Video size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />
                {liveCaptureBusy
                  ? `Capturing website… ${liveCaptureElapsed}s / ${LIVE_CAPTURE_MAX_SECONDS}s`
                  : `Export video${liveRecordActive ? ' · live screen' : ''} (${VIDEO_FORMATS[videoFormat]?.label || 'MP4'})`}
              </button>
            )}
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
              {liveRecordActive
                ? 'RECORD LIVE SCREEN is on — this records the browser tab (live website included) at screen resolution, not the canvas at native resolution. Chrome will ask which surface to share: choose this tab. MP4 records natively in Chrome and Safari; WebM covers other browsers (auto-fallback either way).'
                : 'Records the live canvas — grab or poke the cloth while it runs for extra motion. MP4 records natively in Chrome and Safari; WebM covers other browsers (auto-fallback either way).'}
            </span>

            {/* RENDER PRESETS — Slice 2. Export/render settings only — never
                materials/lighting/camera (that's Look Preset's job). */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
              <span style={ui.label}>RENDER PRESETS</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  id="cloth-render-preset-name-input" type="text" placeholder="Name this render setup…" value={renderPresetNameDraft}
                  onChange={(e) => setRenderPresetNameDraft(e.target.value)}
                  style={{ ...ui.btn(), flex: 1, textAlign: 'left', paddingLeft: 10 }}
                />
                <button id="cloth-render-preset-save-btn" style={{ ...ui.btn(), padding: '0 12px' }} onClick={saveCurrentAsRenderPreset}>Save</button>
              </div>
              {listActiveTemplates(renderPresets).length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {listActiveTemplates(renderPresets).map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <button style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10 }} onClick={() => loadRenderPresetById(p.id)}>Load</button>
                      <button style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10 }} onClick={() => archiveRenderPresetById(p.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>No saved render setups yet.</span>
              )}
              {renderPresetStatus ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{renderPresetStatus}</span> : null}
            </label>

            <CloudTemplateSection
              kind="render" authedFetch={authedFetch} isAdmin={isAdmin}
              onCaptureRecipe={captureRenderPresetRecipe} onLoadRecipe={applyRenderPresetRecipe}
              localEntries={listActiveTemplates(renderPresets).map((p) => ({ id: p.id, name: p.name, recipe: p.recipe }))}
            />

            {/* PROOF RENDER — Slice 4e. A headless server render of this exact
                recipe on the real production pipeline (not the live-canvas
                capture above) — proves the recipe renders correctly before
                it ships. Flag-gated: off by default for every visitor (no
                worker is deployed yet — Slice 4f — so a real click would
                queue a job nothing ever claims). Codex review (Slice 4e
                correction): this gate did not exist before. */}
            {proofRenderV1Enabled ? (
            <div id="cloth-proof-render-section" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
              <span style={ui.label}>PROOF RENDER (BETA)</span>
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                A small, deterministic headless render on the real production pipeline — proves this exact recipe renders correctly server-side. Fixed at {PROOF_RENDER_PARAMS.width}×{PROOF_RENDER_PARAMS.height} · {PROOF_RENDER_PARAMS.fps}fps · {PROOF_RENDER_PARAMS.durationSeconds}s, not a full-quality export.
              </span>
              <button
                id="cloth-generate-proof-btn"
                style={{ ...ui.btn(), width: '100%', opacity: (proofStatus === 'creating' || proofStatus === 'queued' || proofStatus === 'rendering') ? 0.6 : 1 }}
                disabled={proofStatus === 'creating' || proofStatus === 'queued' || proofStatus === 'rendering'}
                onClick={handleGenerateProof}
              >
                <Sparkles size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />
                {proofStatus === 'creating' ? 'Submitting…' : proofStatus === 'queued' ? 'Queued…' : proofStatus === 'rendering' ? 'Rendering…' : 'Generate Proof'}
              </button>

              {proofStatus === 'unsupported' ? (
                <div id="cloth-proof-unsupported-notice" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)' }}>
                  <span style={{ ...ui.label, color: '#f59e0b' }}>Not supported by Proof render yet</span>
                  <span id="cloth-proof-unsupported-detail" style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>
                    {describeUnsupportedFeatures(proofUnsupported, 'Proof Render')}
                  </span>
                  {/* "environment" is the single most likely hit here — the
                      normalized recipe's own DEFAULT envIntensity (0.65) is
                      already outside the supported profile (envIntensity:0
                      only — see art-render-validation.mjs's own comment), so
                      a first-time click on an untouched scene lands here.
                      Named as its own actionable step instead of leaving the
                      user to infer it from the generic feature-name list. */}
                  {proofUnsupported.includes('environment') ? (
                    <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink, fontWeight: 600 }}>
                      Set Environment Light → Light Intensity to 0%.
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* 'transient' (network/create exception — retry is safe, may
                  resolve to a job that DID get created) vs 'terminal' (the
                  job itself reported status:'failed' — retrying resubmits
                  the SAME idempotency key and only ever re-fetches this SAME
                  permanently-failed job, so no retry button is offered; the
                  real next step is a fresh "Generate Proof" click above).
                  Codex review (Slice 4e correction): both used to render
                  identically with a "Retry" button either way. */}
              {proofStatus === 'failed' && proofFailureKind === 'transient' ? (
                <div id="cloth-proof-error-notice" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)' }}>
                  <span style={{ ...ui.label, color: '#dc2626' }}>Proof render request failed</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>{proofError}</span>
                  <button style={{ ...ui.btn(), height: 28, fontSize: 11 }} onClick={handleRetryProof}>Retry same request</button>
                </div>
              ) : null}

              {proofStatus === 'failed' && proofFailureKind === 'terminal' ? (
                <div id="cloth-proof-terminal-error-notice" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)' }}>
                  <span style={{ ...ui.label, color: '#dc2626' }}>Proof render failed</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>{proofError}</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>This job failed permanently after multiple attempts — retrying it would just show this same result. Click Generate Proof above to start a fresh attempt.</span>
                </div>
              ) : null}

              {proofNote ? (
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>{proofNote}</span>
              ) : null}

              {proofJobId && (proofStatus === 'queued' || proofStatus === 'rendering') ? (
                <button style={{ ...ui.btn(), height: 28, fontSize: 11 }} onClick={handleCheckProofStatus}>Check status now</button>
              ) : null}

              {proofStatus === 'done' && proofOutput ? (
                <div id="cloth-proof-done-notice" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)' }}>
                  <span style={{ ...ui.label, color: '#10b981' }}>Render pipeline verified</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>
                    {proofOutput.width}×{proofOutput.height} · {Number(proofOutput.fps).toFixed(1)}fps · {proofOutput.codec} · {proofOutput.frameCount} frames · {Number(proofOutput.duration).toFixed(2)}s — confirmed by the server.
                  </span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                    This confirms the recipe renders correctly on the production pipeline. No video file is saved or downloadable yet — the rendered MP4 lives only briefly on the worker's temp disk and is deleted right after this check. Persisted/downloadable Proof output is a later phase.
                  </span>
                </div>
              ) : null}
            </div>
            ) : null}

            {/* FINAL RENDER — Phase 4, STUDIO-DETERMINISTIC-FINAL-RENDER-
                SONNET-HANDOFF.md. The durable, downloadable counterpart to
                Proof above: same deterministic fixed-timestep server
                pipeline, full quality (1080p, an allowlisted preset — never
                arbitrary client-controlled resource values), a real MP4/
                poster you can preview and download via a freshly signed
                URL. Separate flag from Proof — stays off until its own
                Phase 7 canary is approved. Quick Export (the "Export
                video" MediaRecorder capture elsewhere on this rail) is
                untouched and remains the fast, device-dependent draft
                path — this is never presented as a replacement for it. */}
            {finalRenderV1Enabled ? (
            <div id="cloth-final-render-section" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
              <span style={ui.label}>FINAL RENDER</span>
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                A durable, downloadable server render of this exact recipe — exact frame count, exact timing, never dropped frames even if rendering runs slower than real time. Slower and queued, unlike Quick Export above. You can keep editing while it renders; the output uses the recipe exactly as it was the moment you clicked.
              </span>

              <div id="cloth-final-render-quality-row" style={{ display: 'flex', gap: 6 }}>
                {['30', '60'].map((q) => (
                  <button
                    key={q}
                    style={{ ...ui.btn(finalRenderQuality === q), height: 28, fontSize: 11, flex: 1 }}
                    disabled={finalRenderStatus === 'creating' || finalRenderStatus === 'queued' || finalRenderStatus === 'rendering'}
                    onClick={() => setFinalRenderQuality(q)}
                  >
                    {FINAL_RENDER_LABELS[q]}
                  </button>
                ))}
              </div>
              <span style={{ fontFamily: GLASS.sans, fontSize: 10.5, lineHeight: 1.4, color: GLASS.inkMute }}>
                {(() => { const d = finalRenderDimensionsFor(clothAspect, frameId); const framed = frameId !== 'off' && FRAME_PRESETS[frameId]?.w; return `${d.width}×${d.height} · ${FINAL_RENDER_LABELS[finalRenderQuality]} · ${videoSeconds}s — ${framed ? `exports the active ${FRAME_PRESETS[frameId].label} capture-frame crop` : "matches this scene's current aspect"} and video length.`; })()}
              </span>

              <button
                id="cloth-generate-final-render-btn"
                style={{ ...ui.btn(), width: '100%', opacity: (finalRenderStatus === 'creating' || finalRenderStatus === 'queued' || finalRenderStatus === 'rendering') ? 0.6 : 1 }}
                disabled={finalRenderStatus === 'creating' || finalRenderStatus === 'queued' || finalRenderStatus === 'rendering'}
                onClick={handleGenerateFinalRender}
              >
                <Video size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />
                {finalRenderStatus === 'creating' ? 'Submitting…' : finalRenderStatus === 'queued' ? 'Queued…' : finalRenderStatus === 'rendering' ? 'Rendering…' : 'Generate Final Render'}
              </button>

              {finalRenderStatus === 'unsupported' ? (
                <div id="cloth-final-render-unsupported-notice" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)' }}>
                  <span style={{ ...ui.label, color: '#f59e0b' }}>Not supported by Final Render yet</span>
                  <span id="cloth-final-render-unsupported-detail" style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>
                    {describeUnsupportedFeatures(finalRenderUnsupported, 'Final Render')}
                  </span>
                  {finalRenderUnsupported.includes('environment') ? (
                    <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink, fontWeight: 600 }}>
                      Set Environment Light → Light Intensity to 0%.
                    </span>
                  ) : null}
                </div>
              ) : null}

              {finalRenderStatus === 'failed' && finalRenderFailureKind === 'transient' ? (
                <div id="cloth-final-render-error-notice" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)' }}>
                  <span style={{ ...ui.label, color: '#dc2626' }}>Final Render request failed</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>{finalRenderError}</span>
                  <div id="cloth-final-render-error-actions-row" style={{ display: 'flex', gap: 6 }}>
                    <button style={{ ...ui.btn(), height: 28, fontSize: 11, flex: 1 }} onClick={handleRetryFinalRender}>Retry same request</button>
                    <button id="cloth-final-render-error-dismiss-btn" style={{ ...ui.btn(), height: 28, fontSize: 11 }} onClick={handleDismissFinalRender}>Dismiss</button>
                  </div>
                </div>
              ) : null}

              {finalRenderStatus === 'failed' && finalRenderFailureKind === 'terminal' ? (
                <div id="cloth-final-render-terminal-error-notice" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.35)' }}>
                  <span style={{ ...ui.label, color: '#dc2626' }}>Final Render failed</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>{finalRenderError}</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>This job failed permanently after multiple attempts — retrying it would just show this same result. Click Generate Final Render above to start a fresh attempt.</span>
                  <button id="cloth-final-render-terminal-error-dismiss-btn" style={{ ...ui.btn(), height: 28, fontSize: 11 }} onClick={handleDismissFinalRender}>Dismiss</button>
                </div>
              ) : null}

              {finalRenderNote ? (
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>{finalRenderNote}</span>
              ) : null}

              {finalRenderJobId && (finalRenderStatus === 'queued' || finalRenderStatus === 'rendering') ? (
                <button style={{ ...ui.btn(), height: 28, fontSize: 11 }} onClick={handleCheckFinalRenderStatus}>Check status now</button>
              ) : null}

              {finalRenderStatus === 'done' && finalRenderOutput ? (
                <div id="cloth-final-render-done-notice" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 8, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)' }}>
                  <span style={{ ...ui.label, color: '#10b981' }}>Final Render complete</span>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.ink }}>
                    {finalRenderOutput.width}×{finalRenderOutput.height} · {Number(finalRenderOutput.fps).toFixed(1)}fps · {finalRenderOutput.codec} · {finalRenderOutput.frameCount} frames · {Number(finalRenderOutput.duration).toFixed(2)}s — verified by the server before completion.
                  </span>
                  {/* Honest software-rendering-fallback surfacing ("Live URL
                      wired to Final Render" wiring round, requirement 5) —
                      job.output.liveCapture.gpu is only present when this
                      render captured a live device screen; surfaced here
                      instead of silently discarding it, so a run that fell
                      back to CPU/software WebGL (no real GPU reachable —
                      always true today on the deployed Proof service, see
                      the handoff doc's own "Deployment implication" note)
                      is visible, not just slower with no explanation. */}
                  {finalRenderOutput?.liveCapture?.gpu?.software === true ? (
                    <span id="cloth-final-render-live-capture-software-notice" style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: '#b45309' }}>
                      The live website capture ran on software rendering (no GPU reachable) — it may have taken longer than usual. {finalRenderOutput.liveCapture.gpu.renderer || ''}
                    </span>
                  ) : null}
                  {finalRenderArtifact?.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived external URL; next/image's optimizer isn't applicable here.
                    <img src={finalRenderArtifact.posterUrl} alt="Final Render preview" style={{ width: '100%', borderRadius: 6, display: 'block' }} />
                  ) : null}
                  {finalRenderArtifact?.mp4Url ? (
                    <a
                      href={finalRenderArtifact.mp4Url}
                      download
                      style={{ ...ui.btn(), height: 28, fontSize: 11, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Download size={13} strokeWidth={2.5} style={{ marginRight: 6 }} />
                      Download MP4
                    </a>
                  ) : finalRenderArtifact?.expired ? (
                    <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                      This render has passed its retention window and is no longer downloadable. Click Generate Final Render above for a fresh one.
                    </span>
                  ) : finalRenderArtifact?.urlsAvailable === false ? (
                    <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                      The render completed, but a temporary issue prevented generating a download link. Try "Check status now" above to retry.
                    </span>
                  ) : null}
                  <button id="cloth-final-render-done-dismiss-btn" style={{ ...ui.btn(), height: 26, fontSize: 10.5 }} onClick={handleDismissFinalRender}>Dismiss</button>
                </div>
              ) : null}
            </div>
            ) : null}
          </RailCard>

        </div>
      </div>
    </>
  );
}
