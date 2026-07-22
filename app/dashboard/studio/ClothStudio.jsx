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
  RotateCcw, Zap, Video, Camera,
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
// v3 — defaults rebased on the user-approved look (Paper White flyer, heavy
// gravity, black backdrop, 65% light); the bump discards older saves so the
// approved defaults actually land.
const SETTINGS_KEY = 'holocloth-studio-defaults-v3';
// Default artwork shipped with the tool (public/img). 404s silently if absent;
// any user upload replaces it.
const DEFAULT_ARTWORK_URL = '/img/holocloth-default-artwork.jpg';
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
const PERF_LEVELS = {
  high:   { segs: 56, pr: 2,   label: 'High' },
  medium: { segs: 40, pr: 1.5, label: 'Medium' },
  low:    { segs: 28, pr: 1,   label: 'Low' },
};
const PIN_MODES = [
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
// Opening material state — the user-approved default look: the Paper White
// flyer preset (matches how the shipped default artwork reads best).
const INITIAL_MAT = (() => {
  const { label, group, env, bg, ...rest } = MATERIAL_PRESETS.paper;
  return rest;
})();
// Clothier defaults: light wind (the grab is the show), floatier damping,
// looser constraints so the sheet stretches and swings like fabric, and the
// user-approved heavier gravity.
const DEFAULT_PHYS = {
  windStrength: 0.5, windSpeed: 1, gravity: 2.7,
  damping: 0.99, stiffness: 0.72, pinMode: 'top-edge',
};

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

// ── Scene sets — full environments with depth: a graded + grained backdrop
// texture, exponential fog, a themed light rig (key/rim recolor + optional
// spotlight), and a shadow-catching ground so the sheet reads as standing on a
// set rather than floating on a flat color. All procedural — no asset loads. ──
const SCENE_PRESETS = {
  thriller: {
    label: 'Thriller Set',
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
    backdrop: { type: 'sunset', top: '#2a0a4a', mid: '#8a1a6a', bottom: '#ff6a00', sun: 'rgba(255,214,140,0.9)', sunAt: [0.5, 0.62], vignette: 0.5 },
    fog: { color: '#30104a', density: 0.06 },
    key: { color: '#ffd9a0', intensity: 1.9, pos: [1.4, 1.8, 2.4] },
    rim: { color: '#ff3d9a', intensity: 1.6 },
    ground: '#1a0630',
    env: 1.1,
  },
  'golden-hour': {
    label: 'Golden Hour',
    backdrop: { type: 'radial', top: '#ffdba8', bottom: '#c96a2a', glow: 'rgba(255,246,214,0.85)', glowAt: [0.42, 0.34], vignette: 0.35 },
    fog: { color: '#e8b57d', density: 0.05 },
    key: { color: '#fff1d4', intensity: 2.3, pos: [1.8, 1.6, 2.2] },
    rim: { color: '#ff9d5c', intensity: 1 },
    ground: '#b07840',
    env: 1.6,
  },
  'candy-pop': {
    label: 'Candy Pop',
    backdrop: { type: 'radial', top: '#fff3fa', bottom: '#ffd1ec', glow: 'rgba(255,255,255,0.9)', glowAt: [0.5, 0.3], vignette: 0.15 },
    key: { color: '#ffffff', intensity: 2.4, pos: [1.2, 2.4, 2.4] },
    rim: { color: '#7dd8ff', intensity: 1.3 },
    ground: '#ffe3f2',
    env: 1.8,
  },
  'gallery-white': {
    label: 'Gallery White',
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

const getSupportedVideoMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  return [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
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
  const [saved] = useState(loadSavedDefaults);
  const [worldReady, setWorldReady] = useState(false);

  // ── Control state ──
  const [perf, setPerf] = useState(PERF_LEVELS[saved.perf] ? saved.perf : 'high');
  const [mat, setMat] = useState(() => ({ ...INITIAL_MAT, ...(saved.mat || {}) }));
  const [phys, setPhys] = useState(() => ({ ...DEFAULT_PHYS, ...(saved.phys || {}) }));
  // 'auto' = sheet matches the loaded artwork's ratio (falls back to portrait
  // until an image provides one); the named presets force a shape.
  const [clothAspect, setClothAspect] = useState((CLOTH_ASPECTS[saved.clothAspect] || saved.clothAspect === 'auto') ? saved.clothAspect : 'auto');
  const [artworkRatio, setArtworkRatio] = useState(saved.artworkRatio || null);
  const [bgMode, setBgMode] = useState(['scene', 'color', 'image', 'transparent'].includes(saved.bgMode) ? saved.bgMode : 'color');
  const [bgColor, setBgColor] = useState(saved.bgColor || '#000000');
  const [sceneId, setSceneId] = useState(SCENE_PRESETS[saved.sceneId] ? saved.sceneId : 'thriller');
  const [bgImageEl, setBgImageEl] = useState(null);
  const [envIntensity, setEnvIntensity] = useState(saved.envIntensity ?? 0.65);
  const [videoSeconds, setVideoSeconds] = useState(saved.videoSeconds || 5);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('');
  const [artworkName, setArtworkName] = useState('');
  const [bumpName, setBumpName] = useState('');

  // Panel disclosure — Material opens by default (it's the tool's heart).
  const [materialOpen, setMaterialOpen] = useState(true);
  const [physicsOpen, setPhysicsOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);

  const setMatKey = useCallback((key, val) => setMat((m) => ({ ...m, [key]: val, preset: '' })), []);
  const setPhysKey = useCallback((key, val) => setPhys((p) => ({ ...p, [key]: val })), []);

  // Persist current dials as next visit's defaults.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ perf, mat, phys, clothAspect, artworkRatio, bgMode, bgColor, sceneId, envIntensity, videoSeconds }));
      } catch { /* non-critical */ }
    }, 250);
    return () => clearTimeout(id);
  }, [perf, mat, phys, clothAspect, artworkRatio, bgMode, bgColor, sceneId, envIntensity, videoSeconds]);

  // Latest control state, readable from the render loop without re-init.
  const liveRef = useRef({});
  liveRef.current = { phys };

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

      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(1.5, 2, 2.5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 0.02;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x88ffee, 0.6);
      rim.position.set(-2, 0.5, -1.5);
      scene.add(rim);
      // Scene-set rig — a themed spotlight + shadow-catching floor, hidden
      // until a Background "Scene" is active.
      const spot = new THREE.SpotLight(0xffffff, 0);
      spot.visible = false;
      spot.position.set(0, 2.4, 1.1);
      spot.angle = 0.55;
      spot.penumbra = 0.7;
      spot.decay = 1.2;
      scene.add(spot);
      spot.target.position.set(0, -0.2, 0);
      scene.add(spot.target);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.15;
      ground.receiveShadow = true;
      ground.visible = false;
      scene.add(ground);

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

      const clothMat = new THREE.MeshPhysicalMaterial({
        color: 0x101114, side: THREE.DoubleSide,
        roughness: 0.12, metalness: 0.35,
        clearcoat: 0.5, clearcoatRoughness: 0.08,
        sheen: 0.08, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff),
        iridescence: 0.35, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 480],
        bumpMap: bumpTex, bumpScale: 0.01,
      });
      clothMat.defines = { ...(clothMat.defines || {}), USE_UV: '' };
      clothMat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, holoUniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + HOLO_FRAG_PARS)
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + HOLO_FRAG_BODY);
      };

      const world = {
        THREE, scene, camera, renderer, controls, pmrem, clothMat, holoUniforms, bumpTex,
        keyLight: key, rimLight: rim, spot, ground,
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
        world.cloth = { geometry, mesh, prev, orig, constraints, cols, rows, count, cw, ch };
        world.applyPins(liveRef.current.phys.pinMode);
      };

      // Pin set — indices held to their original grid position each solve pass.
      // PlaneGeometry rows run top (y=0) → bottom, so row 0 is the top edge.
      world.applyPins = (pinMode) => {
        const c = world.cloth; if (!c) return;
        const pins = new Set();
        const top = (x) => x;                                  // row 0
        const bottom = (x) => (c.rows - 1) * c.cols + x;       // last row
        if (pinMode === 'top-edge') { for (let x = 0; x < c.cols; x += 1) pins.add(top(x)); }
        else if (pinMode === 'top-corners') { pins.add(top(0)); pins.add(top(c.cols - 1)); }
        else { pins.add(top(0)); pins.add(top(c.cols - 1)); pins.add(bottom(0)); pins.add(bottom(c.cols - 1)); }
        c.pins = pins;
      };

      world.resetCloth = () => {
        const c = world.cloth; if (!c) return;
        c.geometry.attributes.position.array.set(c.orig);
        c.prev.set(c.orig);
        c.geometry.attributes.position.needsUpdate = true;
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

      // Ship-with-the-tool default artwork — loads if the asset exists (404
      // stays silent); any user upload replaces it.
      {
        const img = new Image();
        img.onload = () => {
          if (disposed || clothMat.map) return; // user beat us to an upload
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          tex.needsUpdate = true;
          clothMat.map = tex;
          clothMat.needsUpdate = true;
          setArtworkName('Default artwork');
          setArtworkRatio(img.width / img.height); // auto-shape picks this up
        };
        img.src = DEFAULT_ARTWORK_URL;
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
        world.raycaster.setFromCamera(ndc, camera);
      };
      const onPointerDown = (e) => {
        const c = world.cloth; if (!c) return;
        setRayFromEvent(e);
        const hit = world.raycaster.intersectObject(c.mesh, false)[0];
        if (!hit) return; // empty space → orbit
        const arr = c.geometry.attributes.position.array;
        const r = Math.max(c.cw, c.ch) * 0.17;
        const idx = []; const w = []; const off = [];
        for (let i = 0; i < c.count; i += 1) {
          if (c.pins?.has(i)) continue;
          const dx = arr[i * 3] - hit.point.x;
          const dy = arr[i * 3 + 1] - hit.point.y;
          const dz = arr[i * 3 + 2] - hit.point.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < r) {
            const t = 1 - d / r;
            idx.push(i); w.push(t * t * 0.95);
            off.push(dx, dy, dz); // keep the patch's shape while held
          }
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
        const arr = c.geometry.attributes.position.array;
        const prev = c.prev;
        const damp = p.damping;
        const g = -p.gravity * 0.28;
        const ws = p.windSpeed;
        const gust = 0.5 + 0.5 * Math.sin(t * ws * 1.25);
        const dt2 = DT * DT;

        for (let i = 0; i < c.count; i += 1) {
          if (c.pins?.has(i)) continue;
          const ix = i * 3;
          const x = arr[ix], y = arr[ix + 1], z = arr[ix + 2];
          // wind — noise-ish field toward +z with lateral swirl
          const wz = p.windStrength * 0.5 * (0.55 + 0.7 * gust) * (0.7 + 0.4 * Math.sin(x * 3.1 + t * ws * 2.1) * Math.cos(y * 2.4 + t * ws * 1.6));
          const wx = p.windStrength * 0.12 * Math.sin(t * ws * 0.9 + y * 2.2);
          const vx = (x - prev[ix]) * damp;
          const vy = (y - prev[ix + 1]) * damp;
          const vz = (z - prev[ix + 2]) * damp;
          prev[ix] = x; prev[ix + 1] = y; prev[ix + 2] = z;
          arr[ix] = x + vx + wx * dt2;
          arr[ix + 1] = y + vy + g * dt2;
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

        c.geometry.attributes.position.needsUpdate = true;
        c.geometry.computeVertexNormals();
        // Raycast grabbing checks the bounding sphere first — keep it in sync
        // with the deforming sheet or hits start missing once it billows.
        c.geometry.computeBoundingSphere();
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
        controls.update();
        renderer.render(scene, camera);
      };
      loop();

      // Keep canvas sized to the stage.
      const ro = new ResizeObserver(() => {
        const nw = stage.clientWidth, nh = stage.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
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
        ground.geometry.dispose(); ground.material.dispose();
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

  // ── Material dials → material props + holo uniforms (no recompiles). ──
  useEffect(() => {
    const world = worldRef.current;
    if (!worldReady || !world?.clothMat) return;
    const { THREE, clothMat: m, holoUniforms: u } = world;
    let rough = mat.roughness, cc = mat.clearcoat;
    if (mat.finish === 'matte') { rough = Math.max(rough, 0.7); cc *= 0.15; }
    else if (mat.finish === 'satin') { rough = Math.min(1, rough + 0.28); cc *= 0.5; }
    m.color.set(mat.baseColor);
    m.roughness = rough;
    m.metalness = mat.metalness;
    m.clearcoat = cc;
    m.clearcoatRoughness = mat.coatRoughness;
    m.sheen = mat.sheen;
    m.iridescence = mat.iridescence;
    m.bumpScale = mat.bump * 0.014;
    if (m.bumpMap) m.bumpMap.repeat.set(mat.bumpTiling, mat.bumpTiling);
    const hueCol = new THREE.Color().setHSL(mat.hueShift % 1, 0.85, 0.62);
    m.specularColor.set(0xffffff).lerp(hueCol, mat.specTint * Math.min(1, mat.holoIntensity * 1.5));
    m.specularIntensity = 0.4 + 0.6 * mat.specTint;
    m.envMapIntensity = envIntensity;
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
    const resetRig = () => {
      scene.fog = null;
      world.keyLight.color.set(0xffffff); world.keyLight.intensity = 1.6; world.keyLight.position.set(1.5, 2, 2.5);
      world.rimLight.color.set(0x88ffee); world.rimLight.intensity = 0.6;
      world.spot.visible = false;
      world.ground.visible = false;
    };
    if (bgMode === 'scene') {
      const sc = SCENE_PRESETS[sceneId] || SCENE_PRESETS.thriller;
      const tex = new THREE.CanvasTexture(paintSceneBackdrop(sc.backdrop));
      tex.colorSpace = THREE.SRGBColorSpace;
      world.bgTexture = tex;
      scene.background = tex;
      scene.fog = sc.fog ? new THREE.FogExp2(new THREE.Color(sc.fog.color).getHex(), sc.fog.density) : null;
      world.keyLight.color.set(sc.key.color);
      world.keyLight.intensity = sc.key.intensity;
      if (sc.key.pos) world.keyLight.position.set(...sc.key.pos);
      world.rimLight.color.set(sc.rim.color);
      world.rimLight.intensity = sc.rim.intensity;
      if (sc.spot) {
        world.spot.visible = true;
        world.spot.color.set(sc.spot.color);
        world.spot.intensity = sc.spot.intensity;
      } else {
        world.spot.visible = false;
      }
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

  // ── Uploads. ──
  const onArtworkUpload = useCallback((file) => {
    const world = worldRef.current;
    if (!world || !file) return;
    const img = new Image();
    img.onload = () => {
      const { THREE, clothMat } = world;
      clothMat.map?.dispose();
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = world.renderer.capabilities.getMaxAnisotropy();
      tex.needsUpdate = true;
      clothMat.map = tex;
      clothMat.needsUpdate = true; // program gains USE_MAP; onBeforeCompile re-runs with the same uniform objects
      setArtworkName(file.name);
      // The map is MULTIPLIED by base color, and metal + zero-rough surfaces kill
      // diffuse — a dark foil base renders any artwork near-invisible. Snap the
      // material to an image-friendly base so the upload reads clearly; holo
      // dials stay where the user set them.
      setMat((m) => ({
        ...m,
        preset: '',
        baseColor: '#ffffff',
        metalness: Math.min(m.metalness, 0.12),
        roughness: Math.max(m.roughness, 0.35),
        bump: Math.min(m.bump, 0.35),
      }));
      // Sheet adapts to the upload's true proportions.
      setArtworkRatio(img.width / img.height);
      setClothAspect('auto');
    };
    img.src = URL.createObjectURL(file);
  }, []);
  const clearArtwork = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.clothMat.map?.dispose();
    world.clothMat.map = null;
    world.clothMat.needsUpdate = true;
    setArtworkName('');
    setArtworkRatio(null); // 'auto' falls back to portrait
  }, []);
  const onBumpUpload = useCallback((file) => {
    const world = worldRef.current;
    if (!world || !file) return;
    const img = new Image();
    img.onload = () => {
      const { THREE, clothMat } = world;
      clothMat.bumpMap?.dispose();
      const tex = new THREE.Texture(img);
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      clothMat.bumpMap = tex;
      clothMat.needsUpdate = true;
      setBumpName(file.name);
      setMat((m) => ({ ...m })); // re-apply tiling to the new map
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
    const { renderer, scene, camera } = world;
    const prevBg = scene.background;
    const prevPr = renderer.getPixelRatio();
    const nw = stageRef.current?.clientWidth || renderer.domElement.clientWidth;
    const nh = stageRef.current?.clientHeight || renderer.domElement.clientHeight;
    try {
      if (transparent) scene.background = null;
      // Hi-res one-shot — bump the ratio, reallocate the buffer, render, snapshot.
      renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 2, 4));
      renderer.setSize(nw, nh, false);
      renderer.render(scene, camera);
      // toBlob captures the bitmap at call time, so restoring below is safe.
      renderer.domElement.toBlob((blob) => {
        if (blob) downloadBlob(blob, `holocloth-${Date.now()}${transparent ? '-transparent' : ''}.png`);
        setStatus(transparent ? 'Exported transparent PNG.' : 'Exported PNG.');
      }, 'image/png');
    } finally {
      scene.background = prevBg;
      renderer.setPixelRatio(prevPr);
      renderer.setSize(nw, nh, false);
      renderer.render(scene, camera);
    }
  }, []);

  const exportVideo = useCallback(() => {
    const world = worldRef.current;
    if (!world || recording) return;
    const mime = getSupportedVideoMimeType();
    if (!mime) { setStatus('Video capture unsupported in this browser — use Chrome for WebM export.'); return; }
    const stream = world.renderer.domElement.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      world.recorder = null;
      setRecording(false);
      const blob = new Blob(chunks, { type: mime });
      downloadBlob(blob, `holocloth-${Date.now()}.webm`);
      setStatus(`Exported ${videoSeconds}s WebM motion loop.`);
    };
    world.recorder = rec;
    setRecording(true);
    setStatus(`Recording ${videoSeconds}s…`);
    rec.start();
    setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, videoSeconds * 1000);
  }, [recording, videoSeconds]);

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
        <div id="cloth-studio-stage-area" style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isNarrow ? 12 : '58px 24px 24px' }}>
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

          {/* PHYSICS */}
          <RailCard
            id="cloth-physics-panel" icon={<Wind size={18} strokeWidth={2} />} title="Physics"
            subtitle={PIN_MODES.find((p) => p.id === phys.pinMode)?.label || 'Cloth sim'}
            color="#14b8a6" open={physicsOpen} onToggle={() => setPhysicsOpen((v) => !v)}
          >
            <Slider label="WIND STRENGTH" min={0} max={3} step={0.05} value={phys.windStrength} onChange={(v) => setPhysKey('windStrength', v)} />
            <Slider label="WIND SPEED" min={0.1} max={3} step={0.05} value={phys.windSpeed} onChange={(v) => setPhysKey('windSpeed', v)} />
            <Slider label="GRAVITY" min={0} max={4} step={0.05} value={phys.gravity} onChange={(v) => setPhysKey('gravity', v)} />
            <Slider label="DAMPING" min={0.9} max={0.998} step={0.001} value={phys.damping} onChange={(v) => setPhysKey('damping', v)} fmt={(v) => v.toFixed(3)} />
            <Slider label="STIFFNESS" min={0.3} max={1} step={0.01} value={phys.stiffness} onChange={(v) => setPhysKey('stiffness', v)} />
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
            <label style={uploadBtnStyle}>
              <Download size={14} strokeWidth={2.5} style={{ marginRight: 6, transform: 'rotate(180deg)' }} />
              {artworkName ? 'Replace artwork' : 'Upload artwork'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onArtworkUpload(e.target.files?.[0])} />
            </label>
            {artworkName ? (
              <button style={{ ...ui.btn(), width: '100%' }} onClick={clearArtwork}>Remove artwork</button>
            ) : (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Drop a poster, logo, or album art onto the fabric — it drapes and catches the holo sheen.</span>
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
                    // Entering Scene mode adopts the active set's light level so
                    // the set reads correctly without a second click.
                    if (m === 'scene') {
                      const env = SCENE_PRESETS[sceneId]?.env;
                      if (typeof env === 'number') setEnvIntensity(env);
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
                      onClick={() => { setSceneId(id); if (typeof sc.env === 'number') setEnvIntensity(sc.env); }}
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

          {/* RENDER / EXPORT */}
          <RailCard
            id="cloth-render-panel" icon={<Download size={18} strokeWidth={2} />} title="Render"
            subtitle={`PNG · ${videoSeconds}s WebM`}
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
            <button style={{ ...ui.btn(), width: '100%' }} onClick={() => exportPng(false)}>
              <Camera size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />Export PNG
            </button>
            <button style={{ ...ui.btn(), width: '100%' }} onClick={() => exportPng(true)}>
              <Camera size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />Export PNG (no background)
            </button>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              <span style={ui.label}>VIDEO LENGTH</span>
              <select value={videoSeconds} onChange={(e) => setVideoSeconds(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
                {[3, 5, 8, 10, 15].map((s) => <option key={s} value={s}>{s}S</option>)}
              </select>
            </label>
            <button style={{ ...ui.cta, width: '100%', opacity: recording ? 0.5 : 1 }} disabled={recording} onClick={exportVideo}>
              <Video size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />
              {recording ? 'Recording…' : 'Export video (WebM)'}
            </button>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Records the live canvas — poke or touch the cloth while it runs for extra motion. Chrome exports WebM.</span>
          </RailCard>

        </div>
      </div>
    </>
  );
}
