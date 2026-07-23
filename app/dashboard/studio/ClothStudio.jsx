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
  Sparkles, Shuffle, Undo2, Redo2,
} from 'lucide-react';
import { GLASS, ui, RailCard, Slider } from './components/rail-ui';
import { getElementDefinition, listElementDefinitions, MAX_EXTRA_INSTANCES } from './elements/catalog';
import { normalizeElementInstance } from './elements/schema';
import { mulberry32, deriveSeed, snapToStep } from './elements/randomize';
import { budgetStatus, LIVE_PREVIEW_TIERS } from './elements/quality';
import { createHistory, pushHistory, undoHistory, redoHistory } from './elements/history';
import {
  restoreExtraInstances, createSceneElement, duplicateInstance, removeInstance,
  normalizeSelection, isRenderableInstance, applyPresetToInstance, randomizeInstanceFields,
  randomizeAllElements, shouldReapplyInstance,
} from './elements/scene-elements';
import {
  INTENSITY_TIERS, INTENSITY_META, DEFAULT_INTENSITY, isValidIntensity, rollNumeric, rollCategorical,
} from './elements/intensity';
import { OUTPUT_FORMATS as PLACEMENT_FORMATS, placementWarningForInstance, resolveEffectiveInstance } from './elements/placement';
import { getFactory } from './elements/factories';
import { createGLTFLoaderBundle, disposeGLTFLoaderBundle } from './elements/glb-loader';
import {
  SCENE_TEMPLATES_KEY, parseTemplateListJSON, serializeTemplateList, createSceneTemplate, addTemplate,
  findTemplate, renameTemplate, updateTemplateRecipe, duplicateTemplate, archiveTemplate, unarchiveTemplate,
  listActiveTemplates, listArchivedTemplates, exportTemplateJSON, importTemplateJSON,
} from './elements/templates';
import {
  isFiniteNum, isHexColor, sanitizeMat, sanitizePhys, sanitizeAnim, sanitizeCam,
  sanitizeGlass, sanitizeShotCam, sanitizeFx, sanitizeLightCans, sanitizeElementLocks,
} from './elements/scene-recipe';
import StudioElementsCard from './components/StudioElementsCard';
import StudioElementInspector from './components/StudioElementInspector';
import SceneTemplatesCard from './components/SceneTemplatesCard';

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
// Tiny finishing pass: animated grain + radial vignette — and, critically, the
// chain's OUTPUT pass. The composer renders the scene into a linear render
// target, where three applies neither ACES tone mapping nor the sRGB encode
// (both are gated on rendering straight to the screen). three-stdlib 2.36.1
// ships no OutputPass, so this pass owns that final conversion via the stock
// chunks — `#include`s are resolved for ShaderMaterial, and three's fragment
// prefix defines toneMapping()/linearToOutputTexel() from the renderer's own
// settings, so the FX path matches the direct-render path exactly. Both chunks
// no-op automatically if this pass ever renders into a buffer instead of to
// screen. Keep this pass ENABLED whenever the composer runs (see the loop).
//
// The depth buffer is the background mask: three never tone maps the backdrop
// (the clear colour is written straight through, and background textures set
// toneMapped=false), so tone mapping every pixel here would turn a pure-white
// backdrop into ~226 grey the moment any effect switched on. Untouched pixels
// keep depth 1.0, so they skip the tone map and get only the sRGB encode —
// which reproduces the direct-render path exactly.
const GRAIN_VIGNETTE_SHADER = {
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
    uVignette: { value: 0 },
    uTime: { value: 0 },
    // Active capture frame in UV space — the vignette is shaped to the frame
    // being exported, not to the canvas, so the crop carries a true falloff.
    // Full canvas (frame off) = centre 0.5, half 0.5, which reproduces the
    // plain radial vignette exactly.
    uFrameCenter: { value: null },
    uFrameHalf: { value: null },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uGrain;
uniform float uVignette;
uniform float uTime;
uniform vec2 uFrameCenter;
uniform vec2 uFrameHalf;
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

// One source sample, brought all the way to display space: vignette (linear
// light, shaped to the capture frame), then tone map + sRGB encode — except on
// the bare backdrop, which three never tone maps. Every treatment resamples
// through this so multi-tap looks stay consistent with the untouched pixel.
vec4 tap(vec2 uv){
  vec4 s = texture2D(tDiffuse, uv);
  if (uVignette > 0.001) {
    // Frame space: ±1 at the frame edges, so d matches the old full-canvas
    // numbers (0.5 edge-centre, 0.707 corner) whatever the crop's aspect is.
    vec2 q = (uv - uFrameCenter) / max(uFrameHalf, vec2(0.0001));
    s.rgb *= 1.0 - smoothstep(0.35, 0.72, length(q) * 0.5) * uVignette;
  }
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
  gl_FragColor = vec4(col, base.a);
}`,
};

// ── Glass form — abstract smooth refractive shell wrapped around the sheet
// (transmission material genuinely refracts the flyer seen through it). ──
// position: world-unit XYZ offset; rotationOffset: degrees, matches this
// file's existing shotCam.az/el convention (converted to radians only where
// applied to three.js — see the element position/rotation effect below).
const DEFAULT_GLASS = { on: false, scale: 1, rotate: true, rotSpeed: 0.4, tint: '#ffffff', clarity: 0.06, position: [0, 0, 0], rotationOffset: [0, 0, 0] };
// The one glass-petal-sphere instance that actually drives world.glassMesh —
// see the "Element system" state block in ClothStudio() for why every other
// instance (duplicates) is data-only.
const PRIMARY_ELEMENT_ID = 'glass-petal-sphere-1';

// ── Shot camera — a second, positionable camera; USE SHOT CAM renders through
// it while the orbit view waits underneath. ──
const DEFAULT_SHOTCAM = { use: false, az: 24, el: 12, dist: 3.2, fov: 40 };

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
const supportedMimeFor = (fmt) => {
  if (typeof MediaRecorder === 'undefined') return '';
  return (VIDEO_FORMATS[fmt]?.mimes || []).find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

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
    () => restoreExtraInstances(saved.extraInstances, { primaryId: PRIMARY_ELEMENT_ID, maxCount: MAX_EXTRA_INSTANCES })
  );
  const [selectedElementId, setSelectedElementId] = useState(PRIMARY_ELEMENT_ID);
  const [elementsOpen, setElementsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
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

  const primaryInstance = useMemo(() => normalizeElementInstance({
    id: PRIMARY_ELEMENT_ID,
    enabled: glass.on,
    depth: 'hero',
    transform: { position: glass.position, rotation: glass.rotationOffset, scale: [glass.scale, glass.scale, glass.scale] },
    material: { tint: glass.tint, clarity: glass.clarity },
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
      const changed = [];
      if (nextScale !== glass.scale) changed.push('scale');
      if (nextRotSpeed !== glass.rotSpeed) changed.push('rotate speed');
      if (nextClarity !== glass.clarity) changed.push('clarity');
      if (nextTint !== glass.tint) changed.push('tint');
      applyElementMutation(() => {
        setSceneSeed(nextSeed);
        setGlass((g) => ({ ...g, scale: nextScale, rotSpeed: nextRotSpeed, clarity: nextClarity, tint: nextTint }));
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

  // "Elements only" randomization scope (plan § Randomization scopes) — every
  // renderable, unlocked (whole-element AND per-group) instance in one
  // atomic batch/undo step. The primary glass element is excluded (its
  // randomRanges are flat, not bucketed — see randomizeAllElements's own doc
  // comment in elements/scene-elements.js); "Randomize all" only ever
  // touches real extraInstances entries.
  const canRandomizeAllElements = extraInstances.some(
    (i) => isRenderableInstance(i, PRIMARY_ELEMENT_ID) && !i.random?.locked
  );
  const randomizeAllElementsHandler = useCallback(() => {
    const nextSeed = sceneSeed + 1;
    const { instances: nextExtras, changedById } = randomizeAllElements(extraInstances, {
      primaryId: PRIMARY_ELEMENT_ID,
      intensity: randomizeIntensity,
      deriveRand: (id) => mulberry32(deriveSeed(nextSeed, id, 'randomize')),
    });
    applyElementMutation(() => {
      setSceneSeed(nextSeed);
      setExtraInstances(nextExtras);
    });
    setElementRandomizeReport(changedById);
  }, [sceneSeed, extraInstances, randomizeIntensity, applyElementMutation]);

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

  const [shotCam, setShotCam] = useState(() => ({ ...DEFAULT_SHOTCAM, ...(saved.shotCam || {}) }));
  const setShotKey = useCallback((key, val) => setShotCam((s) => ({ ...s, [key]: val })), []);
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
  // 'auto' = sheet matches the loaded artwork's ratio (falls back to portrait
  // until an image provides one); the named presets force a shape.
  const [clothAspect, setClothAspect] = useState((CLOTH_ASPECTS[saved.clothAspect] || saved.clothAspect === 'auto') ? saved.clothAspect : 'auto');
  const [artworkRatio, setArtworkRatio] = useState(saved.artworkRatio || null);
  // Artwork library — which entry is on the sheet + the saved-upload list.
  const [artworkId, setArtworkId] = useState(saved.artworkId || DEFAULT_ARTWORK_ID);
  const [artworkLib, setArtworkLib] = useState(loadArtworkLib);
  const [bgMode, setBgMode] = useState(['scene', 'color', 'image', 'transparent'].includes(saved.bgMode) ? saved.bgMode : 'color');
  const [bgColor, setBgColor] = useState(saved.bgColor || '#000000');
  const [sceneId, setSceneId] = useState(SCENE_PRESETS[saved.sceneId] ? saved.sceneId : 'thriller');
  const [bgImageEl, setBgImageEl] = useState(null);
  const [envIntensity, setEnvIntensity] = useState(saved.envIntensity ?? 0.65);
  const [videoSeconds, setVideoSeconds] = useState(saved.videoSeconds || 5);
  const [videoFormat, setVideoFormat] = useState(VIDEO_FORMATS[saved.videoFormat] ? saved.videoFormat : 'mp4');
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('');
  const [artworkName, setArtworkName] = useState('');
  const [bumpName, setBumpName] = useState('');

  // Panel disclosure — Material opens by default (it's the tool's heart).
  const [materialOpen, setMaterialOpen] = useState(true);
  const [animOpen, setAnimOpen] = useState(false);
  const [physicsOpen, setPhysicsOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [glassOpen, setGlassOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);

  const setMatKey = useCallback((key, val) => setMat((m) => ({ ...m, [key]: val, preset: '' })), []);
  const setPhysKey = useCallback((key, val) => setPhys((p) => ({ ...p, [key]: val })), []);

  // Persist current dials as next visit's defaults.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, hudOn, frameId, envId, fx, fxPresetId, clothAspect, artworkRatio, artworkId, bgMode, bgColor, sceneId, envIntensity, videoSeconds, videoFormat, sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity }));
      } catch { /* non-critical */ }
    }, 250);
    return () => clearTimeout(id);
  }, [perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, hudOn, frameId, envId, fx, fxPresetId, clothAspect, artworkRatio, artworkId, bgMode, bgColor, sceneId, envIntensity, videoSeconds, videoFormat, sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity]);

  // Persist Scene Templates — infrequent (button-driven, not slider-drag), so
  // no debounce needed (contrast the settings effect above).
  useEffect(() => {
    try { window.localStorage.setItem(SCENE_TEMPLATES_KEY, serializeTemplateList(sceneTemplates)); } catch { /* non-critical */ }
  }, [sceneTemplates]);

  // Latest control state, readable from the render loop without re-init.
  const liveRef = useRef({});
  liveRef.current = { phys, anim, glass, shotCam, hudOn, frameId, lightCans, fx, elementInstances };

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
        EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, RoundedBoxGeometry,
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
      const glassMat = new THREE.MeshPhysicalMaterial({
        transmission: 1, thickness: 0.7, ior: 1.5,
        roughness: 0.03, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.04,
        attenuationColor: new THREE.Color(0xffffff), attenuationDistance: 1.8,
        side: THREE.DoubleSide,
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
      const renderPass = new RenderPass(scene, camera);
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.8);
      const finishPass = new ShaderPass(GRAIN_VIGNETTE_SHADER);
      finishPass.uniforms.tDepth.value = fxDepth;
      finishPass.uniforms.uFrameCenter.value = new THREE.Vector2(0.5, 0.5);
      finishPass.uniforms.uFrameHalf.value = new THREE.Vector2(0.5, 0.5);
      finishPass.uniforms.uRes.value = new THREE.Vector2(w, h);
      finishPass.uniforms.uColA.value = new THREE.Color(DEFAULT_FX.colA);
      finishPass.uniforms.uColB.value = new THREE.Color(DEFAULT_FX.colB);
      // Shape the vignette to whatever crop is active. Called from the loop at
      // canvas size and from exportPng at export size — same aspect, so the
      // still and the live view agree.
      const syncFrameUniforms = (widthPx, heightPx) => {
        const fr = FRAME_PRESETS[liveRef.current.frameId];
        if (!fr || !fr.w || !widthPx || !heightPx) {
          finishPass.uniforms.uFrameCenter.value.set(0.5, 0.5);
          finishPass.uniforms.uFrameHalf.value.set(0.5, 0.5);
          return;
        }
        const r = computeFrameRect(widthPx, heightPx, fr.w / fr.h);
        finishPass.uniforms.uFrameCenter.value.set(
          (r.x + r.w / 2) / widthPx,
          1 - (r.y + r.h / 2) / heightPx
        );
        finishPass.uniforms.uFrameHalf.value.set((r.w / 2) / widthPx, (r.h / 2) / heightPx);
      };
      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.addPass(finishPass);
      const fxActive = () => {
        const f = liveRef.current.fx;
        return Boolean(f && (f.bloom || f.grain > 0.001 || f.vignette > 0.001 || (f.treatment && f.treatment !== 'none')));
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
        THREE, stdlib, scene, camera, renderer, controls, pmrem, clothMat, clothBackMat, mirrorTex, holoUniforms, bumpTex,
        cans, ground, glassMesh, glassMat, shotCamera, activeCamera,
        elementsGroup, elementLiveObjects, glbLoader,
        composer, renderPass, bloomPass, finishPass, fxActive, setEnvironment, syncFrameUniforms,
        // Capture-frame carousel: the HUD lays the frames out in a row and
        // eases `from` → `to` so switching crops slides instead of snapping.
        frameSlide: { from: FRAME_IDS.indexOf(liveRef.current.frameId || 'off'), to: FRAME_IDS.indexOf(liveRef.current.frameId || 'off'), t: 1 },
        cloth: null, envIntensity: 1, bgTexture: null,
        pointer: { active: false, x: 0, y: 0 },
        raycaster: new THREE.Raycaster(),
        clock: new THREE.Clock(),
        recorder: null,
      };
      worldRef.current = world;

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

        if (world.cloth) {
          scene.remove(world.cloth.mesh);
          scene.remove(world.cloth.meshBack);
          world.cloth.geometry.dispose();
        }

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
      const setRayFromEvent = (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        world.raycaster.setFromCamera(ndc, activeCamera()); // grabbing works in shot-cam view too
      };
      const onPointerDown = (e) => {
        const c = world.cloth; if (!c) return;
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
      };
      const onPointerMove = (e) => {
        if (!grab.active) return;
        setRayFromEvent(e);
        const ray = world.raycaster.ray;
        // Drag on the sphere of the original hit distance — pointer maps 1:1.
        grab.target.copy(ray.origin).addScaledVector(ray.direction, grab.dist);
      };
      const onPointerUp = (e) => {
        if (grab.active) {
          grab.active = false;
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
        const a = liveRef.current.anim;
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
          const f = FRAME_PRESETS[id];
          g2.globalAlpha = isActive ? 1 : 0.42;
          g2.strokeStyle = 'rgba(255,255,255,0.9)';
          g2.lineWidth = isActive ? 1.5 : 1;
          g2.setLineDash(isActive ? [] : [5, 5]);
          g2.strokeRect(x, y, size.w, size.h);
          g2.setLineDash([]);
          g2.fillStyle = 'rgba(255,255,255,0.9)';
          g2.fillText(f.w ? `${f.label} · ${f.w}×${f.h}` : f.label, x + 8, y + 16);
          g2.globalAlpha = 1;
        });
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
        // Glass auto-rotate — slow ring spin + gentle tumble.
        const gl = liveRef.current.glass;
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
        controls.update();
        if (world.frameSlide.t < 1) world.frameSlide.t = Math.min(1, world.frameSlide.t + dt / 0.35);
        const cam = activeCamera();
        if (fxActive()) {
          const f = liveRef.current.fx;
          syncFrameUniforms(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
          renderPass.camera = cam;
          bloomPass.enabled = Boolean(f.bloom);
          bloomPass.strength = f.bloomStrength;
          bloomPass.threshold = f.bloomThreshold;
          // finishPass stays enabled even at grain 0 / vignette 0 — it carries
          // the tone map + sRGB encode, and EffectComposer hands renderToScreen
          // to the last ENABLED pass, so disabling it would let the bloom pass
          // blit raw linear values to the canvas.
          finishPass.enabled = true;
          finishPass.uniforms.uGrain.value = f.grain;
          finishPass.uniforms.uVignette.value = f.vignette;
          finishPass.uniforms.uTime.value = t % 100;
          finishPass.uniforms.uT1.value = f.t1;
          finishPass.uniforms.uT2.value = f.t2;
          finishPass.uniforms.uT3.value = f.t3;
          // Treatments run in display space, so the ink/paper colours must stay
          // as authored — setStyle with the working space skips the usual
          // sRGB→linear conversion that would wash them out.
          finishPass.uniforms.uColA.value.setStyle(f.colA, THREE.LinearSRGBColorSpace);
          finishPass.uniforms.uColB.value.setStyle(f.colB, THREE.LinearSRGBColorSpace);
          finishPass.uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
          composer.render();
        } else {
          renderer.render(scene, cam);
        }
        drawHud(cam);
      };
      loop();

      // Keep canvas sized to the stage.
      const ro = new ResizeObserver(() => {
        const nw = stage.clientWidth, nh = stage.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        shotCamera.aspect = nw / nh;
        shotCamera.updateProjectionMatrix();
        renderer.setSize(nw, nh, false);
        composer.setSize(nw, nh);
      });
      ro.observe(stage);

      world.cleanup = () => {
        ro.disconnect();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        try { world.recorder?.stop(); } catch { /* already stopped */ }
        controls.dispose();
        world.cloth?.geometry?.dispose();
        clothMat.map?.dispose(); bumpTex.dispose();
        clothBackMat.map?.dispose(); clothBackMat.bumpMap?.dispose();
        ground.geometry.dispose(); ground.material.dispose();
        petalGeos.forEach((g) => g.dispose()); glassMat.dispose();
        elementLiveObjects.forEach(({ object, factory }) => factory.dispose(object));
        elementLiveObjects.clear();
        disposeGLTFLoaderBundle(glbLoader);
        world.bgTexture?.dispose();
        // FX chain — composer.dispose() only drops its two full-res buffers, so
        // the passes go too; PMREM output textures are ours to free as well.
        bloomPass.dispose(); finishPass.dispose(); composer.dispose(); fxDepth.dispose();
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
      worldRef.current?.cleanup?.();
      worldRef.current = null;
    };
    // Built once per mount — every control below mutates the world in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Material dials → material props + holo uniforms (no recompiles).
  // Applied to BOTH faces; the back face's maps tile mirrored (-x repeat). ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.clothMat) return;
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
      m.envMapIntensity = envIntensity;
    });
    u.uHoloIntensity.value = mat.holoIntensity;
    u.uHoloScale.value = mat.holoScale;
    u.uBandFreq.value = mat.bandFreq;
    u.uSatBoost.value = mat.saturation;
    u.uHueShift.value = mat.hueShift;
    u.uSparkle.value = mat.sparkle;
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

  // ── Treatment → recompile the finish pass with that look's #define. Rare
  // (user-driven) so a recompile beats branching every pixel every frame. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.finishPass) return;
    const def = TREATMENTS[fx.treatment]?.define;
    const m = world.finishPass.material;
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
  const snapshotLookState = useCallback(
    () => ({ fx, fxPresetId, mat, envId, envIntensity, bgMode, bgColor, sceneId, lightCans, lightTemplate, lookSeed }),
    [fx, fxPresetId, mat, envId, envIntensity, bgMode, bgColor, sceneId, lightCans, lightTemplate, lookSeed]
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
    setEnvId(snap.envId);
    setEnvIntensity(snap.envIntensity);
    setBgMode(snap.bgMode);
    setBgColor(snap.bgColor);
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
    perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, hudOn, frameId, envId, fx, fxPresetId,
    clothAspect, artworkRatio, artworkId, bgMode, bgColor, sceneId, envIntensity, videoSeconds, videoFormat,
    sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity,
  }), [perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, hudOn, frameId, envId, fx, fxPresetId, clothAspect, artworkRatio, artworkId, bgMode, bgColor, sceneId, envIntensity, videoSeconds, videoFormat, sceneSeed, lookSeed, elementLocks, extraInstances, elementFormatId, elementQualityTier, randomizeIntensity]);

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
    if (typeof r.hudOn === 'boolean') setHudOn(r.hudOn);
    if (FRAME_PRESETS[r.frameId]) setFrameId(r.frameId);
    if (ENV_PRESETS[r.envId]) setEnvId(r.envId);
    if (r.fx && typeof r.fx === 'object') setFx(sanitizeFx(r.fx, fx, { treatmentIds: Object.keys(TREATMENTS) }));
    if (FX_PRESETS[r.fxPresetId] || r.fxPresetId === '') setFxPresetId(r.fxPresetId);
    if (CLOTH_ASPECTS[r.clothAspect] || r.clothAspect === 'auto') setClothAspect(r.clothAspect);
    if (r.artworkRatio == null || typeof r.artworkRatio === 'number') setArtworkRatio(r.artworkRatio ?? null);
    if (typeof r.artworkId === 'string' && r.artworkId) setArtworkId(r.artworkId);
    if (['scene', 'color', 'image', 'transparent'].includes(r.bgMode)) setBgMode(r.bgMode);
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
    const nextExtras = restoreExtraInstances(r.extraInstances, { primaryId: PRIMARY_ELEMENT_ID, maxCount: MAX_EXTRA_INSTANCES });
    setElementLocks(sanitizeElementLocks(r.elementLocks, [PRIMARY_ELEMENT_ID, ...nextExtras.map((i) => i.id)]));
    setExtraInstances(nextExtras);
    setSelectedElementId((cur) => normalizeSelection(cur, nextExtras, PRIMARY_ELEMENT_ID));
    if (PLACEMENT_FORMATS[r.elementFormatId]) setElementFormatId(r.elementFormatId);
    if (LIVE_PREVIEW_TIERS.includes(r.elementQualityTier)) setElementQualityTier(r.elementQualityTier);
    if (isValidIntensity(r.randomizeIntensity)) setRandomizeIntensity(r.randomizeIntensity);
  }, [mat, phys, anim, cam, lightCans, glass, shotCam, fx]);

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
    const ctx = { THREE, stdlib, tier: elementQualityTier, sceneSeed, glbLoader, glbAssetsById };

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
      if (!glbNeedsRetry && !shouldReapplyInstance(entry, inst, elementQualityTier) && entry.lastFormatId === elementFormatId) return;
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraInstances, worldReady, elementQualityTier, elementFormatId, glbAssets, elementsV1Enabled]);

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

  // ── Cloth shape / perf rebuild. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world) return;
    world.buildCloth(clothAspect, perf, artworkRatio);
    const pr = Math.min(window.devicePixelRatio, PERF_LEVELS[perf].pr);
    world.renderer.setPixelRatio(pr);
    world.composer?.setPixelRatio(pr); // FX buffers follow the perf level too
  }, [clothAspect, perf, artworkRatio, worldReady]);

  // ── Background — flat modes reset the rig; Scene mode dresses the set:
  // backdrop texture, fog, themed key/rim, spotlight, shadow ground. ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world) return;
    const { THREE, scene } = world;
    world.bgTexture?.dispose(); world.bgTexture = null;
    // Lights are owned by the Lighting card (cans) — the scene only dresses
    // backdrop, fog, and floor; scene CLICK handlers apply the matching can
    // template so it stays user-tweakable afterwards.
    const resetRig = () => {
      scene.fog = null;
      world.ground.visible = false;
    };
    if (bgMode === 'scene') {
      const sc = SCENE_PRESETS[sceneId] || SCENE_PRESETS.thriller;
      const tex = new THREE.CanvasTexture(paintSceneBackdrop(sc.backdrop));
      tex.colorSpace = THREE.SRGBColorSpace;
      world.bgTexture = tex;
      scene.background = tex;
      scene.fog = sc.fog ? new THREE.FogExp2(new THREE.Color(sc.fog.color).getHex(), sc.fog.density) : null;
      if (sc.ground) {
        world.ground.visible = true;
        world.ground.material.color.set(sc.ground);
      } else {
        world.ground.visible = false;
      }
    } else if (bgMode === 'color') {
      resetRig();
      scene.background = new THREE.Color(bgColor);
    } else if (bgMode === 'image' && bgImageEl) {
      resetRig();
      const tex = new THREE.Texture(bgImageEl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      world.bgTexture = tex;
      scene.background = tex;
    } else {
      resetRig();
      scene.background = null; // transparent — checkerboard shows through the canvas
    }
  }, [bgMode, bgColor, bgImageEl, sceneId, worldReady]);

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
        world.syncFrameUniforms?.(nw, nh); // vignette shaped to the crop being written
        // uRes deliberately keeps the live-canvas value here: treatment pitch
        // (dots, blocks, scanlines) is defined in preview pixels, so the boosted
        // export renders the same pattern at higher fidelity instead of
        // shrinking it to half size.
        world.renderPass.camera = cam;
        world.composer.render();
      } else {
        renderer.render(scene, cam);
      }
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
        }, 'image/png');
      } else {
        // toBlob captures the bitmap at call time, so restoring below is safe.
        renderer.domElement.toBlob((blob) => {
          if (blob) downloadBlob(blob, `holocloth-${Date.now()}${suffix}.png`);
          setStatus(transparent ? 'Exported transparent PNG.' : 'Exported PNG.');
        }, 'image/png');
      }
    } finally {
      scene.background = prevBg;
      renderer.setPixelRatio(prevPr);
      renderer.setSize(nw, nh, false);
      if (useFx) { world.composer.setPixelRatio(prevPr); world.composer.setSize(nw, nh); }
      renderer.render(scene, cam);
    }
  }, [frameId]);

  const exportVideo = useCallback(() => {
    const world = worldRef.current;
    if (!world || recording) return;
    // Capture frame active → record from an offscreen canvas at platform-native
    // resolution, copying the crop from the live GL canvas each frame.
    const fr = FRAME_PRESETS[frameId];
    let frameCopier = null;
    const makeSource = () => {
      if (!fr || !fr.w) return world.renderer.domElement;
      const src = world.renderer.domElement;
      const off = document.createElement('canvas');
      off.width = fr.w; off.height = fr.h;
      const octx = off.getContext('2d');
      let copying = true;
      const copy = () => {
        if (!copying) return;
        const cw = src.clientWidth, chh = src.clientHeight;
        if (cw && chh) {
          const r = computeFrameRect(cw, chh, fr.w / fr.h);
          const sx = src.width / cw, sy = src.height / chh;
          octx.drawImage(src, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, fr.w, fr.h);
        }
        requestAnimationFrame(copy);
      };
      copy();
      frameCopier = () => { copying = false; };
      return off;
    };
    const startRecording = (fmt, mime, isRetry = false) => {
      const fmtLabel = VIDEO_FORMATS[fmt].label;
      const stream = makeSource().captureStream(60);
      let rec;
      try {
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
      } catch (err) {
        console.warn('[holocloth] MediaRecorder ctor failed', mime, err);
        if (fmt === 'mp4' && !isRetry) { const wm = supportedMimeFor('webm'); if (wm) { startRecording('webm', wm, true); return; } }
        setRecording(false);
        setStatus('Video capture unsupported in this browser.');
        return;
      }
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onerror = (e) => console.warn('[holocloth] recorder error', mime, e.error || e);
      rec.onstop = () => {
        world.recorder = null;
        frameCopier?.();
        const total = chunks.reduce((s, b) => s + b.size, 0);
        console.warn('[holocloth] recording stopped', { mime, chunks: chunks.length, total });
        // Some Chrome builds report MP4 as supported but encode nothing —
        // detect the empty result and re-record as WebM instead of saving 0B.
        if (!total && fmt === 'mp4' && !isRetry) {
          const wm = supportedMimeFor('webm');
          if (wm) { setStatus('MP4 encoder produced no data here — re-recording as WebM…'); startRecording('webm', wm, true); return; }
        }
        setRecording(false);
        if (!total) { setStatus('Recording produced no data in this browser.'); return; }
        const blob = new Blob(chunks, { type: mime });
        downloadBlob(blob, `holocloth-${Date.now()}${fr?.slug ? `-${fr.slug}` : ''}.${VIDEO_FORMATS[fmt].ext}`);
        setStatus(`Exported ${videoSeconds}s ${fmtLabel}${fr?.w ? ` · ${fr.w}×${fr.h}` : ''} motion loop.`);
      };
      world.recorder = rec;
      setRecording(true);
      setStatus(`Recording ${videoSeconds}s ${fmtLabel}…`);
      console.warn('[holocloth] recording started', { mime, isRetry });
      try {
        rec.start(500); // timeslice — Chrome's MP4 muxer only flushes data periodically
      } catch (err) {
        // Some builds reject timeslice for this container — record in one shot.
        console.warn('[holocloth] start(timeslice) rejected, retrying start()', err);
        rec.start();
      }
      setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, videoSeconds * 1000);
    };
    // Chosen container first; fall back to the other if unsupported here.
    let fmt = videoFormat;
    let mime = supportedMimeFor(fmt);
    if (!mime) { fmt = fmt === 'mp4' ? 'webm' : 'mp4'; mime = supportedMimeFor(fmt); }
    if (!mime) { setStatus('Video capture unsupported in this browser.'); return; }
    startRecording(fmt, mime);
  }, [recording, videoSeconds, videoFormat, frameId]);

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
            ? { position: 'relative', width: '100%', height: '46vh', flex: 'none' }
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
            {/* Grab is automatic — drag the sheet directly; empty space orbits. */}
            <div
              id="cloth-studio-drag-hint"
              style={{
                position: 'absolute', bottom: 10, left: 10, zIndex: 6, pointerEvents: 'none',
                ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.45)',
                padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
              }}
            >
              GRAB &amp; FLING THE CLOTH · EMPTY SPACE ORBITS
            </div>
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
            {/* Poke — quick impulse without opening the Physics card. */}
            <button
              id="cloth-studio-poke-btn"
              onClick={() => worldRef.current?.poke()}
              title="Poke the cloth"
              style={{
                position: 'absolute', top: 10, right: 10, zIndex: 6,
                width: 30, height: 30, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer', color: '#fff',
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
          .studio-rail-card {
            position: relative; border-radius: 1rem; overflow: hidden;
            background: rgba(255, 255, 255, 0.35);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
            transform: scale(1) translateY(0);
            transition: background 0.55s cubic-bezier(0.16,1,0.3,1), box-shadow 0.55s cubic-bezier(0.16,1,0.3,1), transform 0.22s cubic-bezier(0.16,1,0.3,1);
            will-change: transform;
          }
          @media (prefers-reduced-motion: reduce) { .studio-rail-card { transition: none; } }
          .studio-rail-card::before {
            content: ''; position: absolute; inset: 0; border-radius: 1rem; padding: 1px;
            background: rgba(176,176,182,0.6);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
            pointer-events: none; opacity: 0.85; transition: opacity 0.45s ease; z-index: 0;
          }
          .studio-rail-card:hover {
            background: rgba(255,255,255,1);
            box-shadow: 0px 6px 14px rgba(0,0,0,0.06), 0px 18px 36px rgba(0,0,0,0.06), 0px 28px 56px rgba(0,0,0,0.09), inset 0 1px 0 rgba(255,255,255,0.55);
            transform: scale(1.02) translateY(-2px);
            transition: background 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.32s cubic-bezier(0.16,1,0.3,1), transform 0.38s cubic-bezier(0.34,1.56,0.64,1);
          }
          .studio-rail-card:hover::before { background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%); opacity: 1; }
          .studio-rail-card:hover .studio-rail-card-content { transform: translateX(5px); transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }
          .studio-rail-card:hover .studio-rail-card-icon { transform: scale(1.12); transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }
          .studio-rail-card--active {
            background: rgba(255,255,255,1);
            box-shadow: 0px 6px 14px rgba(0,0,0,0.06), 0px 18px 36px rgba(0,0,0,0.06), 0px 28px 56px rgba(0,0,0,0.09), inset 0 1px 0 rgba(255,255,255,0.55);
            transition: background 0.32s cubic-bezier(0.16,1,0.3,1) 0.15s, box-shadow 0.32s cubic-bezier(0.16,1,0.3,1) 0.15s, transform 0.38s cubic-bezier(0.34,1.56,0.64,1) 0.15s;
          }
          .studio-rail-card--active::before { background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%); opacity: 1; }
          .studio-rail-card-content { position: relative; z-index: 1; transform: translateX(0); transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }
          .studio-rail-card-icon { transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }
          .studio-rail-card-btn { position: relative; z-index: 1; }
        `}</style>

        <div id="cloth-studio-rail-inner" style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>

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
                seed={sceneSeed} budget={elementBudget}
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
              />
              <StudioElementInspector
                open={inspectorOpen} onToggle={() => setInspectorOpen((v) => !v)}
                instance={selectedInstance}
                definition={getElementDefinition(selectedInstance?.type)}
                isBound={selectedElementId === PRIMARY_ELEMENT_ID}
                onFieldChange={changeSelectedElementField}
                onGenericFieldChange={(bucket, key, value) => changeSceneElementField(selectedElementId, bucket, key, value)}
                onApplyPreset={applyElementPreset}
                placementWarning={selectedInstance ? elementPlacementWarnings[selectedInstance.id] : null}
                authedFetch={authedFetch} glbAssets={glbAssets} onRefreshGlbAssets={refreshGlbAssets}
              />
              <SceneTemplatesCard
                open={templatesOpen} onToggle={() => setTemplatesOpen((v) => !v)}
                templates={sceneTemplates} nameDraft={templateNameDraft} onNameDraftChange={setTemplateNameDraft}
                onSave={saveCurrentAsTemplate} onLoad={loadTemplateById} onResave={resaveTemplateById}
                onRename={renameTemplateById} onDuplicate={duplicateTemplateById}
                onArchive={archiveTemplateById} onUnarchive={unarchiveTemplateById}
                onExport={exportTemplateById} onImportJSON={importTemplateFromJSON}
                status={templateStatus}
              />
            </>
          ) : null}

          {/* MATERIAL */}
          <RailCard
            id="cloth-material-panel" icon={<Layers size={18} strokeWidth={2} />} title="Material"
            subtitle={MATERIAL_PRESETS[mat.preset]?.label || 'Custom'}
            color="#8b5cf6" open={materialOpen} onToggle={() => setMaterialOpen((v) => !v)}
          >
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
          </RailCard>

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
            <Slider label="CLARITY" min={0} max={0.4} step={0.01} value={glass.clarity} onChange={(v) => setGlassKey('clarity', v)} fmt={(v) => v.toFixed(2)} disabled={!glass.on} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: glass.on ? 1 : 0.4 }}>
              <input type="color" value={glass.tint} disabled={!glass.on} onChange={(e) => setGlassKey('tint', e.target.value)} style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
              <span style={ui.label}>Tint</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{glass.tint}</span>
            </label>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>A smooth abstract shell around the flyer — the parts seen through it refract like real glass.</span>
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
          </RailCard>

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
              disabled={phys.pinMode !== 'free-float'}
            />
            <Slider
              label="RUMPLE" min={0} max={1} step={0.01} value={phys.rumple ?? 0.5}
              onChange={(v) => setPhysKey('rumple', v)} fmt={(v) => `${Math.round(v * 100)}%`}
            />
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Turbulence dials the chaos. Rebound sets how fast the sheet retracts to its original shape — at 0% it stays right where you throw it. Rumple sets how "already handled" the sheet opens (and resets) looking.</span>
          </RailCard>

          {/* PHYSICS */}
          <RailCard
            id="cloth-physics-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Physics"
            subtitle={PIN_MODES.find((p) => p.id === phys.pinMode)?.label || 'Cloth sim'}
            color="#14b8a6" open={physicsOpen} onToggle={() => setPhysicsOpen((v) => !v)}
          >
            {phys.pinMode === 'free-float' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Floating mode is weightless — gravity applies when the sheet is pinned.</span>
            ) : null}
            <Slider label="GRAVITY" min={0} max={4} step={0.05} value={phys.gravity} onChange={(v) => setPhysKey('gravity', v)} disabled={phys.pinMode === 'free-float'} />
            <Slider label="DAMPING" min={0.9} max={0.998} step={0.001} value={phys.damping} onChange={(v) => setPhysKey('damping', v)} fmt={(v) => v.toFixed(3)} />
            <Slider label="STIFFNESS" min={0.3} max={1} step={0.01} value={phys.stiffness} onChange={(v) => setPhysKey('stiffness', v)} />
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
            <span style={{ ...ui.label, marginTop: 4 }}>PINS</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {PIN_MODES.map((p) => (
                <button key={p.id} style={{ ...ui.btn(phys.pinMode === p.id), height: 30, padding: '0 12px', fontSize: 10 }} onClick={() => setPhysKey('pinMode', p.id)}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button style={{ ...ui.btn(), flex: 1 }} onClick={() => worldRef.current?.poke()}><Zap size={13} strokeWidth={2.5} style={{ marginRight: 5 }} />Poke</button>
              <button style={{ ...ui.btn(), flex: 1 }} onClick={() => worldRef.current?.resetCloth()}><RotateCcw size={13} strokeWidth={2.5} style={{ marginRight: 5 }} />Reset cloth</button>
            </div>
          </RailCard>

          {/* IMAGES */}
          <RailCard
            id="cloth-images-panel" icon={<ImageIcon size={18} strokeWidth={2} />} title="Images"
            subtitle={artworkName || 'Artwork on the fabric'}
            color="#f59e0b" open={imagesOpen} onToggle={() => setImagesOpen((v) => !v)}
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
            <span style={{ ...ui.label, marginTop: 4 }}>SHEET SHAPE</span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                title="Match the artwork's proportions"
                style={{ ...ui.btn(clothAspect === 'auto'), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }}
                onClick={() => setClothAspect('auto')}
              >
                Auto
              </button>
              {Object.entries(CLOTH_ASPECTS).map(([id, a]) => (
                <button key={id} style={{ ...ui.btn(clothAspect === id), height: 30, padding: '0 12px', fontSize: 10, flex: 1 }} onClick={() => setClothAspect(id)}>{a.label}</button>
              ))}
            </div>
          </RailCard>

          {/* BACKGROUND */}
          <RailCard
            id="cloth-background-panel" icon={<Palette size={18} strokeWidth={2} />} title="Background"
            subtitle={[
              bgMode === 'scene'
                ? (SCENE_PRESETS[sceneId]?.label || 'Scene set')
                : { color: 'Solid color', image: 'Custom image', transparent: 'Transparent' }[bgMode],
              envId !== 'room' ? ENV_PRESETS[envId]?.label : null,
            ].filter(Boolean).join(' · ')}
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
                      onClick={() => { setSceneId(id); if (typeof sc.env === 'number') setEnvIntensity(sc.env); if (sc.lights) applyLightTemplate(sc.lights); }}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Full set dressing — graded backdrop, fog depth, themed lights, and a floor that catches the sheet's shadow.</span>
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
              <label style={uploadBtnStyle}>
                <Download size={14} strokeWidth={2.5} style={{ marginRight: 6, transform: 'rotate(180deg)' }} />
                {bgImageEl ? 'Replace image' : 'Upload image'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onBgImageUpload(e.target.files?.[0])} />
              </label>
            ) : null}
            {bgMode === 'transparent' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Transparent scene — pairs with "Export PNG (no background)" for compositing.</span>
            ) : null}
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

          {/* LIGHTING — four positionable stage cans + rig templates. */}
          <RailCard
            id="cloth-lighting-panel" icon={<Lightbulb size={18} strokeWidth={2} />} title="Lighting"
            subtitle={LIGHT_TEMPLATES[lightTemplate]?.label || 'Custom rig'}
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
          </RailCard>

          {/* CAMERA — positionable shot cam + HUD overlay. */}
          <RailCard
            id="cloth-camera-panel" icon={<Focus size={18} strokeWidth={2} />} title="Camera"
            subtitle={shotCam.use ? 'Shot cam live' : 'Orbit view'}
            color="#ec4899" open={cameraOpen} onToggle={() => setCameraOpen((v) => !v)}
          >
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
          </RailCard>

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
            <button style={{ ...ui.btn(), width: '100%' }} onClick={() => exportPng(false)}>
              <Camera size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />Export PNG
            </button>
            <button style={{ ...ui.btn(), width: '100%' }} onClick={() => exportPng(true)}>
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
            <button style={{ ...ui.cta, width: '100%', opacity: recording ? 0.5 : 1 }} disabled={recording} onClick={exportVideo}>
              <Video size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />
              {recording ? 'Recording…' : `Export video (${VIDEO_FORMATS[videoFormat]?.label || 'MP4'})`}
            </button>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Records the live canvas — grab or poke the cloth while it runs for extra motion. MP4 records natively in Chrome and Safari; WebM covers other browsers (auto-fallback either way).</span>
          </RailCard>

        </div>
      </div>
    </>
  );
}
