'use client';

// HoloCloth Studio — the PAPER/CLOTH mode of the Mockup Studio (?tool=cloth).
// A verlet cloth simulator draped with a holographic-foil physical material:
// upload artwork onto the fabric, dial foil/iridescence/sparkle, pick a
// background, then export a still (PNG, optionally transparent) or a WebM
// motion loop — all client-side, no server render. Built from scratch on the
// repo's existing three/three-stdlib deps; shares the studio page's visual
// language (GLASS tokens + RailCard) but is fully self-contained so the
// fragile mockup-video code paths stay untouched.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight, Download, Palette, Image as ImageIcon, Wind, Layers,
  RotateCcw, Zap, Video, Camera, SlidersHorizontal, Lightbulb, Disc, Focus,
} from 'lucide-react';

// ── UI tokens — mirror app/dashboard/studio/page.jsx GLASS/ui (kept local so
// the page file needs no refactor; page files can't export shared helpers). ──
const GLASS = {
  bg: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
  accent: 'linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  ink: '#1a1a1a',
  inkSoft: '#444',
  inkMute: '#8a8a8a',
  hair: '#E4E4E4',
  sans: '"Space Grotesk", system-ui, -apple-system, sans-serif',
  mono: '"Space Mono", ui-monospace, monospace',
};
const ui = {
  btn: (active = false) => ({
    height: 40,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: active ? GLASS.ink : 'rgba(255,255,255,0.6)',
    color: active ? '#fff' : GLASS.ink,
    border: '1px solid ' + (active ? GLASS.ink : GLASS.hair),
    boxShadow: active ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
    borderRadius: 999, padding: '0 15px',
    fontSize: 12, fontFamily: GLASS.sans, fontWeight: 600, letterSpacing: '0.01em',
    cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease',
  }),
  cta: {
    height: 40,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: GLASS.accent, color: '#fff', border: 'none', borderRadius: 999,
    padding: '0 18px', fontSize: 12, fontFamily: GLASS.sans, fontWeight: 700,
    letterSpacing: '0.01em', cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(140,70,255,0.25), inset 0 1px 0 rgba(255,255,255,0.3)',
  },
  label: {
    fontSize: 9, fontFamily: GLASS.mono, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: GLASS.inkMute, fontWeight: 700,
  },
};

// Rail card — same states as the mockup rail (ported from DashboardPage
// .capability-nav-btn via page.jsx); class names match so the CSS below applies.
function RailCard({ id, icon, title, subtitle, color, open, onToggle, badge, children, maxH = 2400 }) {
  return (
    <div id={id} className={'studio-rail-card' + (open ? ' studio-rail-card--active' : '')}>
      <button
        className="studio-rail-card-btn"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span className="studio-rail-card-content" style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: GLASS.sans, fontSize: 15, fontWeight: 500, color: GLASS.ink, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{title}</span>
          {subtitle ? <span style={{ ...ui.label, fontSize: 10, letterSpacing: '0.06em', color: GLASS.inkMute }}>{subtitle}</span> : null}
        </span>
        {badge}
        <span className="studio-rail-card-icon" style={{ flexShrink: 0, color, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span aria-hidden="true" style={{
          flexShrink: 0, color: GLASS.inkMute, display: 'flex', alignItems: 'center',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease',
        }}>
          <ChevronRight size={16} strokeWidth={2.5} />
        </span>
      </button>
      <div style={{ maxHeight: open ? maxH : 0, overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ padding: '2px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Labelled range slider — the studio rail's standard control row.
function Slider({ label, min, max, step, value, onChange, fmt = (v) => v.toFixed(2), disabled = false }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>
        {label}<span style={{ color: GLASS.ink }}>{fmt(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: GLASS.ink }}
      />
    </label>
  );
}

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

// ── Glass form — abstract smooth refractive shell wrapped around the sheet
// (transmission material genuinely refracts the flyer seen through it). ──
const DEFAULT_GLASS = { on: false, scale: 1, rotate: true, rotSpeed: 0.4, tint: '#ffffff', clarity: 0.06 };

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

export default function ClothStudio({ isNarrow = false, railW = 336 }) {
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
  const [glass, setGlass] = useState(() => ({ ...DEFAULT_GLASS, ...(saved.glass || {}) }));
  const setGlassKey = useCallback((key, val) => setGlass((g) => ({ ...g, [key]: val })), []);
  const [shotCam, setShotCam] = useState(() => ({ ...DEFAULT_SHOTCAM, ...(saved.shotCam || {}) }));
  const setShotKey = useCallback((key, val) => setShotCam((s) => ({ ...s, [key]: val })), []);
  const [hudOn, setHudOn] = useState(saved.hudOn ?? true);
  const [frameId, setFrameId] = useState(FRAME_PRESETS[saved.frameId] ? saved.frameId : 'off');
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);

  const setMatKey = useCallback((key, val) => setMat((m) => ({ ...m, [key]: val, preset: '' })), []);
  const setPhysKey = useCallback((key, val) => setPhys((p) => ({ ...p, [key]: val })), []);

  // Persist current dials as next visit's defaults.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, hudOn, frameId, clothAspect, artworkRatio, artworkId, bgMode, bgColor, sceneId, envIntensity, videoSeconds, videoFormat }));
      } catch { /* non-critical */ }
    }, 250);
    return () => clearTimeout(id);
  }, [perf, mat, phys, anim, cam, lightCans, lightTemplate, glass, shotCam, hudOn, frameId, clothAspect, artworkRatio, artworkId, bgMode, bgColor, sceneId, envIntensity, videoSeconds, videoFormat]);

  // Latest control state, readable from the render loop without re-init.
  const liveRef = useRef({});
  liveRef.current = { phys, anim, glass, shotCam, hudOn, frameId, lightCans };

  // ── World init — one scene per mount; controls mutate it in place. ──
  useEffect(() => {
    if (!stageRef.current) return undefined;
    let disposed = false;
    let raf = 0;
    const stage = stageRef.current;

    (async () => {
      const THREE = await import('three');
      const { OrbitControls, RoomEnvironment } = await import('three-stdlib');
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
      // Shadows on from the start — scene sets drop the sheet's shadow on a
      // ground plane; enabling later would force material recompiles.
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setSize(w, h, false);
      Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', borderRadius: '16px', touchAction: 'none', display: 'block' });
      stage.appendChild(renderer.domElement);

      // IBL — RoomEnvironment drives the foil reflections (same as mockup mode).
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

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
        const g = new THREE.TorusGeometry(R, tube, 26, 90, arc);
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

      // Shot camera — positionable second camera; USE SHOT CAM renders it.
      const shotCamera = new THREE.PerspectiveCamera(40, w / h, 0.05, 60);
      shotCamera.position.set(0, 0, 3.2);
      const activeCamera = () => (liveRef.current.shotCam?.use ? shotCamera : camera);

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
        THREE, scene, camera, renderer, controls, pmrem, clothMat, clothBackMat, mirrorTex, holoUniforms, bumpTex,
        cans, ground, glassMesh, glassMat, shotCamera, activeCamera,
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
        // Capture frame — dim outside, stroke + label the platform crop.
        const fr = FRAME_PRESETS[live.frameId];
        if (fr && fr.w) {
          const r = computeFrameRect(cw, chh, fr.w / fr.h);
          g2.fillStyle = 'rgba(0,0,0,0.45)';
          g2.fillRect(0, 0, cw, r.y);
          g2.fillRect(0, r.y + r.h, cw, chh - r.y - r.h);
          g2.fillRect(0, r.y, r.x, r.h);
          g2.fillRect(r.x + r.w, r.y, cw - r.x - r.w, r.h);
          g2.strokeStyle = 'rgba(255,255,255,0.9)';
          g2.lineWidth = 1.5;
          g2.strokeRect(r.x, r.y, r.w, r.h);
          g2.font = '700 9px "Space Mono", monospace';
          g2.fillStyle = 'rgba(255,255,255,0.9)';
          g2.fillText(`${fr.label} · ${fr.w}×${fr.h}`, r.x + 8, r.y + 16);
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
        // Glass auto-rotate — slow ring spin + gentle tumble.
        const gl = liveRef.current.glass;
        if (glassMesh.visible && gl?.rotate) {
          glassMesh.rotation.z += gl.rotSpeed * 0.5 * dt;
          glassMesh.rotation.x += gl.rotSpeed * 0.17 * dt;
        }
        controls.update();
        const cam = activeCamera();
        renderer.render(scene, cam);
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
        world.bgTexture?.dispose();
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
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF_LEVELS[perf].pr));
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
    try {
      if (transparent) scene.background = null;
      // Hi-res one-shot — bump the ratio, reallocate the buffer, render, snapshot.
      renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 2, 4));
      renderer.setSize(nw, nh, false);
      renderer.render(scene, cam);
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
            subtitle={bgMode === 'scene'
              ? (SCENE_PRESETS[sceneId]?.label || 'Scene set')
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
