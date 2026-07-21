'use client';

// Mockup Studio — ONE 3D scene, one camera. The live site is real HTML in 3D:
// a CSS3D (matrix3d) iframe projected by the same camera as the WebGL device
// mockup, so orbiting and interacting happen in the same scene. Browser
// security forbids rasterizing live iframe HTML into canvas, so RENDER SCENE
// transparently: captures the URL hi-res server-side (browserless), textures
// the screen with it, renders the scene at export scale, then restores the
// live iframe. CAPTURE HI-RES alone just feeds flat shots to the pipeline.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { SlidersHorizontal, Clapperboard, Images, ChevronRight, Monitor, Download, RefreshCw, Play, Square, RotateCcw, Orbit, MousePointer2, Smartphone, Tablet, RectangleHorizontal, RectangleVertical, Palette, Save } from 'lucide-react';
import { useAuth } from '../../../AuthContext';
import UpRightArrow from '../../../components/UpRightArrow';
import GlassTooltipLayer from '../../../components/GlassTooltipLayer';

// HOLO PAPER mode (?tool=cloth) — the cloth/foil simulator. Client-only and
// lazy so the mockup-video path pays nothing for it.
const ClothStudio = dynamic(() => import('./ClothStudio'), { ssr: false });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900,  bezel: 30, depth: 40, corner: 26, screenCorner: 14, camZ: 2700, label: 'DESKTOP' },
  mobile:  { width: 390,  height: 844,  bezel: 18, depth: 24, corner: 64, screenCorner: 48, camZ: 1500, label: 'MOBILE' },
  tablet:  { width: 768,  height: 1024, bezel: 24, depth: 26, corner: 48, screenCorner: 32, camZ: 1900, label: 'TABLET' },
};

const BACKDROPS = {
  home:     { home: true,                      label: 'HITLOOP' }, // homepage hero gradient
  graphite: { bg: 0x101014, ground: 0x16161c, label: 'GRAPHITE' },
  studio:   { bg: 0xe8e6e0, ground: 0xd8d5cc, label: 'STUDIO' },
  midnight: { bg: 0x050510, ground: 0x0a0a18, label: 'MIDNIGHT' },
  teal:     { bg: 0x0a2a28, ground: 0x0d3330, label: 'TEAL' },
};

// Launch-safe backgrounds are the modes the Cloud Run renderer can faithfully
// reproduce. Image upload + blurred-site modes remain implemented below for
// later development, but are hidden because the render recipe cannot carry them
// through to production video output yet.
const BACKGROUND_MODES = [
  { id: 'env', label: 'Scene', launch: true },
  { id: 'color', label: 'Color', launch: true },
  { id: 'image', label: 'Image', launch: false },
  { id: 'site', label: 'Site', launch: false },
];
const LAUNCH_BACKGROUND_MODE_IDS = BACKGROUND_MODES.filter((mode) => mode.launch).map((mode) => mode.id);

// Whatever the user dials in becomes the default next visit.
const SETTINGS_KEY = 'mockup-studio-defaults-v1';
const loadSavedDefaults = () => {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; }
};

// User-saved camera animations ("Save as Template") — persisted locally and listed in
// the Template dropdown under a SAVED group. Each stores its raw keyframes + duration.
const CUSTOM_TEMPLATES_KEY = 'mockup-studio-custom-templates-v1';
const loadCustomTemplates = () => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(CUSTOM_TEMPLATES_KEY) || '[]') || []; } catch { return []; }
};
const LAST_CUSTOM_TEMPLATE_KEY = 'mockup-studio-last-custom-v1';
const loadLastCustomTemplateId = () => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(LAST_CUSTOM_TEMPLATE_KEY) || null; } catch { return null; }
};
const initialCustomTemplateId = loadLastCustomTemplateId();

// ── Camera animation templates ───────────────────────────────────────────────
// Each template is 8 authored poses:
// [radiusFactor, azimuthDeg, elevationDeg, targetXFrac?, targetYFrac?, hold?]
// Radius scales from the viewport's camZ and targets from its screen size, so
// the same move reads correctly on desktop, mobile, and tablet. Small radius
// factors (≤0.45) push past the screen edge — corner targets (±0.5..0.7) plus
// a small radius zoom INTO a corner until it fills the frame. `hold` parks
// the camera at that pose for that many travel-units before the next move
// (implemented as a duplicate keyframe further down the track).
const DEG = Math.PI / 180;
const templatePose = (vp, [rF, az, el, txF = 0, tyF = 0]) => {
  const r = vp.camZ * rF;
  return {
    px: r * Math.sin(az * DEG) * Math.cos(el * DEG),
    py: r * Math.sin(el * DEG),
    pz: r * Math.cos(az * DEG) * Math.cos(el * DEG),
    tx: txF * vp.width * 0.5,
    ty: tyF * vp.height * 0.5,
    tz: 0,
  };
};

// Canonical OPEN view — the framing the studio and every template open on: a close,
// front-left 3/4 view, slightly above, device centered and filling the frame (readable
// front face, never turned away). [radiusFactor, azimuth°, elevation°] fed through
// templatePose so it scales correctly across desktop/mobile/tablet.
const DEFAULT_VIEW = [0.72, -26, 6];

const CAMERA_TEMPLATES = [
  { id: 'home-feature', label: 'HOME PAGE FEATURE', theme: 'HERO', intensity: 'MEDIUM', seconds: 10,
    keys: [[1.85, -22, 12], [1.45, -15, 9], [1.05, -9, 6], [0.68, -4, 3], [0.48, -1, 2, 0, 0.08, 0.9], [0.52, 2, 2, 0, 0.05], [0.78, 8, 5, 0, 0, 0.5], [1.3, 14, 9]] },
  { id: 'hero-push', label: 'HERO PUSH-IN', theme: 'CINEMATIC', intensity: 'MEDIUM', seconds: 10,
    keys: [[2.2, -16, 14], [1.4, -9, 8], [0.85, -4, 4], [0.34, -1, 1, 0, 0, 0.8], [0.34, 0, 0, 0, 0.15], [0.7, 3, 3], [1.4, 9, 8, 0, 0, 0.5], [2.0, 14, 12]] },
  { id: 'orbit-reveal', label: 'ORBIT REVEAL', theme: 'SHOWCASE', intensity: 'BOLD', seconds: 10,
    keys: [[1.5, -75, 8], [1.15, -40, 10], [0.4, -12, 4, -0.55, 0.35, 0.6], [1.2, 5, 9], [0.4, 18, 4, 0.55, -0.35, 0.6], [1.2, 45, 10], [1.5, 70, 8], [1.3, 40, 8]] },
  { id: 'rise-settle', label: 'RISE & SETTLE', theme: 'CALM', intensity: 'SUBTLE', seconds: 10,
    keys: [[1.6, 0, -18], [1.45, 1, -11], [1.3, 2, -5], [1.1, 2, 0], [0.85, 1, 3, 0, 0, 0.7], [0.7, 0, 4, 0, 0.1, 0.9], [0.95, 0, 5], [1.2, 0, 6]] },
  { id: 'whip-arc', label: 'WHIP ARC', theme: 'ENERGETIC', intensity: 'BOLD', seconds: 6,
    keys: [[1.4, -65, 5], [0.35, -25, 6, -0.6, 0.4, 0.3], [1.2, 10, 10], [0.3, 35, 4, 0.6, 0.4, 0.3], [1.3, 60, 5], [0.32, 20, -4, 0.5, -0.45, 0.3], [1.1, -15, 8], [0.5, -40, 4, -0.4, -0.3]] },
  { id: 'slow-drift', label: 'SLOW DRIFT', theme: 'AMBIENT', intensity: 'SUBTLE', seconds: 15,
    keys: [[1.6, -12, 6], [1.4, -8, 7], [1.15, -4, 8], [0.9, -1, 7, 0, 0.1, 0.8], [0.75, 2, 6, 0.1, 0, 1.0], [0.9, 5, 5], [1.2, 8, 5], [1.45, 10, 5]] },
  { id: 'spiral-in', label: 'SPIRAL IN', theme: 'LAUNCH', intensity: 'BOLD', seconds: 10,
    keys: [[2.3, -130, 26], [1.8, -90, 20], [1.35, -55, 15], [0.95, -28, 10], [0.6, -10, 5], [0.32, 0, 2, 0, 0, 1.0], [0.32, 4, 1, 0.2, 0.1], [0.8, 12, 4]] },
  { id: 'top-drop', label: 'TOP DROP', theme: 'DRAMATIC', intensity: 'MEDIUM', seconds: 6,
    keys: [[1.9, 0, 60], [1.5, -2, 45], [1.0, -3, 28], [0.5, -2, 12, -0.5, 0.5, 0.5], [0.3, 0, 4, -0.6, 0.6, 0.6], [0.7, 0, 4, 0, 0.2], [1.1, 0, 6, 0, 0, 0.4], [1.25, 0, 5]] },
  { id: 'close-pan', label: 'CORNER TOUR', theme: 'DETAIL', intensity: 'BOLD', seconds: 15,
    keys: [[0.32, -4, 3, -0.7, 0.55, 0.7], [0.3, -2, 2, -0.65, 0.5], [0.3, 0, 2, 0.65, 0.5, 0.7], [0.3, 2, 0, 0.7, 0.45], [0.3, 3, -2, 0.65, -0.5, 0.7], [0.3, 2, -2, -0.6, -0.5], [0.32, 0, -1, -0.7, -0.55, 0.7], [0.9, 0, 3]] },
  { id: 'pull-reveal', label: 'PULL REVEAL', theme: 'LAUNCH', intensity: 'MEDIUM', seconds: 10,
    keys: [[0.28, 0, 1, -0.6, 0.5, 0.8], [0.4, 2, 2, -0.3, 0.3], [0.6, 5, 3], [0.9, 8, 5], [1.3, 11, 8], [1.7, 14, 10], [2.1, 16, 11, 0, 0, 0.5], [2.3, 17, 12]] },
  { id: 'low-hero', label: 'LOW HERO', theme: 'EPIC', intensity: 'BOLD', seconds: 10,
    keys: [[1.6, -55, -24], [1.3, -30, -16], [0.45, -10, -8, -0.5, -0.4, 0.5], [1.2, 0, -10], [0.45, 12, -8, 0.5, -0.4, 0.5], [1.3, 30, -16], [1.6, 55, -24, 0, 0, 0.4], [1.4, 40, -20]] },
  { id: 'breathe', label: 'BREATHE', theme: 'AMBIENT', intensity: 'SUBTLE', seconds: 15,
    keys: [[1.5, 0, 5], [0.8, 1, 5, 0, 0, 0.6], [1.4, 0, 6], [0.7, -1, 6, 0, 0.1, 0.6], [1.45, -1, 5], [0.65, 0, 5, 0, 0, 0.6], [1.4, 0, 6], [1.5, 0, 5]] },
  { id: 'showcase-loop', label: 'SHOWCASE LOOP', theme: 'AD SPOT', intensity: 'MEDIUM', seconds: 10,
    keys: [[1.5, 0, 6], [1.25, 35, 12], [0.45, 15, 6, 0.3, 0.2, 0.5], [1.3, -20, 14], [0.4, 0, 3, 0, 0, 0.7], [1.3, -45, 10], [1.25, -25, 8], [1.5, 0, 6]] },
];

// No template should sit "zoomed way out" — every animation should start (and stay)
// roughly as close as the default load, where the device fills the frame. Cap each
// template's radius track at this factor (≈ DEFAULT_VIEW's radius) by scaling the whole
// track DOWN proportionally when its widest pose exceeds the cap. Templates already this
// close (e.g. Corner Tour, Pull Reveal's tight start) are left untouched. Only radius
// (key index 0) is scaled — azimuth, elevation, targets, and holds are preserved, so each
// template keeps its push/pull/orbit character and angle, just framed tighter.
const TEMPLATE_RADIUS_CAP = 1.1;
const capTemplateKeys = (keys) => {
  const maxR = Math.max(...keys.map((k) => k[0]));
  if (maxR <= TEMPLATE_RADIUS_CAP) return keys;
  const s = TEMPLATE_RADIUS_CAP / maxR;
  return keys.map((k) => [k[0] * s, ...k.slice(1)]);
};

// Every template OPENS on the canonical close, front-facing DEFAULT_VIEW (so the first
// frame is never zoomed-out or turned backwards, regardless of the authored first pose),
// then plays through its authored move. The rest of the track is radius-capped so it
// never drifts "way out."
const openingKeys = (tpl) => {
  const keys = capTemplateKeys(tpl.keys).slice();
  keys[0] = [...DEFAULT_VIEW]; // force a centered, front 3/4 open frame; drops any first-key target/hold
  return keys;
};

const buildTemplateKeyframes = (tpl, vpId) => {
  const vp = VIEWPORTS[vpId] || VIEWPORTS.desktop;
  const keys = openingKeys(tpl);
  const totalUnits = (keys.length - 1) + keys.reduce((sum, k) => sum + (k[5] || 0), 0);
  const kf = [];
  let unit = 0;
  keys.forEach((k, i) => {
    const pose = templatePose(vp, k);
    kf.push({ id: `tpl-${tpl.id}-${i}a`, t: unit / totalUnits, ...pose });
    if (k[5]) {
      unit += k[5];
      kf.push({ id: `tpl-${tpl.id}-${i}b`, t: unit / totalUnits, ...pose });
    }
    unit += 1;
  });
  return kf;
};

const getSupportedVideoMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  return [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

// UI tokens — mirror the live dashboard/site surfaces
// (DashboardPage.jsx --surface/--border + cool near-white bg + cyan→purple→pink
// accent gradient). Cool neutral, NOT warm/tan. Space Grotesk for controls,
// Space Mono only for small uppercase eyebrow labels.
const GLASS = {
  surface: {
    background: 'rgba(255,255,255,0.72)',
    border: '1px solid #E4E4E4',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  },
  bg: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
  wash: 'radial-gradient(700px 420px at 0% 4%, rgba(255,120,90,0.14) 0%, transparent 62%), radial-gradient(620px 380px at 100% 10%, rgba(176,90,255,0.14) 0%, transparent 62%)',
  accent: 'linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  ink: '#1a1a1a',
  inkSoft: '#444',
  inkMute: '#8a8a8a',
  hair: '#E4E4E4',
  hairSoft: 'rgba(0,0,0,0.06)',
  sans: '"Space Grotesk", system-ui, -apple-system, sans-serif',
  mono: '"Space Mono", ui-monospace, monospace',
};

// Horizontal inset (px) for the timeline track's usable region. Keyframes, the
// playhead, and the fill all live inside this padded band so the first/last keys
// sit fully within the pill with breathing room from the rounded ends. Pointer
// mapping (trackUFromEvent) uses the same inset so drag stays aligned to render.
const TL_PAD = 14;
// CSS `left` for a track position t (0..1) within the padded band.
const tlLeft = (t) => `calc(${TL_PAD}px + ${t} * (100% - ${TL_PAD * 2}px))`;

const ui = {
  // Default control pill — Space Grotesk, white/neutral (matches site CTAs/chips).
  // Fixed 40px height = the homepage nav button height (consistency across pieces).
  btn: (active = false) => ({
    height: 40,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? GLASS.ink : 'rgba(255,255,255,0.6)',
    color: active ? '#fff' : GLASS.ink,
    border: '1px solid ' + (active ? GLASS.ink : GLASS.hair),
    boxShadow: active ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
    borderRadius: 999,
    padding: '0 15px',
    fontSize: 12,
    fontFamily: GLASS.sans,
    fontWeight: 600,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease',
  }),
  // Primary action — cyan→purple→pink gradient pill (site "Meet with A Human").
  cta: {
    height: 40,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: GLASS.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '0 18px',
    fontSize: 12,
    fontFamily: GLASS.sans,
    fontWeight: 700,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(140,70,255,0.25), inset 0 1px 0 rgba(255,255,255,0.3)',
  },
  input: {
    height: 40,
    background: 'rgba(255,255,255,0.85)',
    border: '1px solid ' + GLASS.hair,
    borderRadius: 999,
    color: GLASS.ink,
    fontFamily: GLASS.sans,
    fontSize: 13,
    padding: '0 16px',
  },
  // Small uppercase eyebrow — the ONLY place Space Mono is used (matches dashboard
  // tab labels / CLIENT·ACCOUNT·STATUS rows).
  label: {
    fontSize: 9,
    fontFamily: GLASS.mono,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: GLASS.inkMute,
    fontWeight: 700,
  },
  accent: GLASS.ink,
};

// Nav pill — white Title-case Space Grotesk pill matching the dashboard header
// buttons. Secondary pills add a static gradient hairline border (padding-box +
// accent border-box); the primary uses ui.navCta's gradient fill.
ui.navBtn = (active = false) => ({
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  background: active ? GLASS.ink : 'rgba(255,255,255,0.9)',
  color: active ? '#fff' : '#2a2420',
  border: 'none',
  borderRadius: 999,
  padding: '0 16px',
  fontSize: 13,
  fontFamily: GLASS.sans,
  fontWeight: 700,
  letterSpacing: '0.01em',
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  position: 'relative',
  isolation: 'isolate',
  boxShadow: '0 1px 4px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
  transition: 'background 0.28s ease, box-shadow 0.28s ease',
});
// Primary CTA — gradient comet pill (site #founders-chat-cta).
ui.navCta = {
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), ' + GLASS.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  padding: '0 18px',
  fontSize: 13,
  fontFamily: GLASS.sans,
  fontWeight: 700,
  letterSpacing: '0.01em',
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
};

// Right-rail card — mirrors the dashboard role-nav item (DashboardPage.jsx
// .capability-nav-btn): each card floats independently — translucent frosted
// white with a soft hairline and inset highlight when inactive, lifting to a
// white card with the accent-gradient hairline + soft shadow on hover. The open
// card keeps that lifted look. No enclosing box, no row dividers — cards float.
function RailCard({ id, icon, title, subtitle, color, open, onToggle, badge, children, maxH = 2400 }) {
  // States/transitions are ported verbatim from the dashboard .capability-nav-btn
  // (see <style id="studio-rail-card-styles"> below) — static, :hover, and --active
  // use the SAME bg/box-shadow/transform/timing as the dashboard nav item. No new
  // state animations are invented here.
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
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.25s ease',
        }}>
          <ChevronRight size={16} strokeWidth={2.5} />
        </span>
      </button>
      <div style={{
        maxHeight: open ? maxH : 0,
        overflow: 'hidden',
        transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{ padding: '2px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Camera presets for the cloud Director path (ids/labels mirror
// services/studio-render/recipe.mjs CAMERA_PRESETS — the service holds the
// actual keyframe tracks; the recipe just names the preset).
const DIRECTOR_PRESETS = [
  { id: 'push-rotate-flat', label: 'PUSH-IN → ROTATE → FLAT ZOOM' },
  { id: 'push-in-hold', label: 'PUSH-IN + HOLD' },
  { id: 'orbit-reveal', label: 'ORBIT REVEAL' },
];
// Viewport id → device icon for the selectable device tiles.
const DEVICE_ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

// Exportable output formats — the artboard on the canvas reshapes to the selected
// format's aspect, and both local and cloud exports render at these dimensions.
// `landscape` is the original 16:10; square + reel are the social presets.
const OUTPUT_FORMATS = [
  { id: 'landscape', label: 'LANDSCAPE', w: 1920, h: 1200, Icon: RectangleHorizontal },
  { id: 'square',    label: 'SQUARE',    w: 1080, h: 1080, Icon: Square },
  { id: 'reel',      label: 'REEL',      w: 1080, h: 1920, Icon: RectangleVertical },
];

export default function StudioPage() {
  const authState = useAuth();
  const router = useRouter();
  const [smokeMode, setSmokeMode] = useState(false);
  const isDev = process.env.NODE_ENV === 'development';

  useEffect(() => {
    if (!isDev || typeof window === 'undefined') return;
    setSmokeMode(new URLSearchParams(window.location.search).get('smoke') === '1');
  }, [isDev]);

  const smokeUser = useMemo(() => ({
    uid: 'studio-smoke-user',
    email: 'studio-smoke@local.test',
    getIdToken: async () => 'studio-smoke-token',
  }), []);
  const user = smokeMode ? smokeUser : authState.user;
  const userProfile = smokeMode
    ? { websiteUrl: 'https://hitloop.agency', dashboardTitle: 'Studio Smoke Test' }
    : authState.userProfile;
  const loading = smokeMode ? false : authState.loading;
  const isAdmin = !smokeMode && Boolean(authState.isAdmin);

  // Right-nav width — the canvas/board fills the viewport area to the LEFT of it.
  const RAIL_W = 336;

  // Studio tool — MOCKUP VIDEO (existing scene) vs HOLO PAPER (?tool=cloth,
  // the cloth/foil simulator). null until the mount effect reads the URL so
  // neither world builds prematurely and SSR/client markup stay identical.
  const [tool, setTool] = useState(null);
  const switchTool = useCallback((next) => {
    setTool(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'cloth') url.searchParams.set('tool', 'cloth');
      else url.searchParams.delete('tool');
      window.history.replaceState(null, '', url.toString());
    } catch { /* URL update is cosmetic */ }
  }, []);

  const stageRef = useRef(null);
  // Mutable three.js world — built once, mutated by handlers.
  const worldRef = useRef(null);

  // Settings persist to localStorage — the current setup is the next default.
  const [saved] = useState(loadSavedDefaults);

  const [loadedUrl, setLoadedUrl] = useState('');
  const [viewportId, setViewportId] = useState(saved.viewportId in VIEWPORTS ? saved.viewportId : 'desktop');
  const [formatId, setFormatId] = useState(OUTPUT_FORMATS.some((f) => f.id === saved.formatId) ? saved.formatId : 'landscape');
  const [customTemplates, setCustomTemplates] = useState(loadCustomTemplates);
  const [backdropId, setBackdropId] = useState(saved.backdropId in BACKDROPS ? saved.backdropId : 'home');
  // Immersive background: mode + per-mode source.
  const [bgMode, setBgMode] = useState(LAUNCH_BACKGROUND_MODE_IDS.includes(saved.bgMode) ? saved.bgMode : 'env'); // 'color' | 'image' | 'site' | 'env'
  const [bgColor, setBgColor] = useState(saved.bgColor || '#11141a');
  const [envPreset, setEnvPreset] = useState(saved.envPreset || 'studio');
  const [bgImageEl, setBgImageEl] = useState(null);
  const [interactMode, setInteractMode] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  // Gradient adjust — repaints the sky dome live for contrast control.
  const [hue, setHue] = useState(saved.hue ?? 0);
  const [sat, setSat] = useState(saved.sat ?? 1);
  const [bright, setBright] = useState(saved.bright ?? 1);
  // Homepage particle-torus "loop" element, positioned behind the device.
  const [loopCfg, setLoopCfg] = useState({ on: true, size: 1.6, x: 0, y: 0, z: -1400, opacity: 1, ...(saved.loopCfg || {}) });
  // Camera keyframe timeline. Each key: { id, t: 0..1 position on the track,
  // camera pose }. Dragging a key left/right retimes the segments around it.
  const [keyframes, setKeyframes] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [totalSeconds, setTotalSeconds] = useState(saved.totalSeconds || 6);
  const [scrubVal, setScrubVal] = useState(0);
  const [selectedKeyId, setSelectedKeyId] = useState(null);
  // Scene opens with a camera template already loaded so the timeline isn't empty
  // on start and the first frame reads as a dramatic shot, not a flat front-on view.
  // The mount effect below (and the world-init) apply this id's keyframes.
  const [templateId, setTemplateId] = useState(initialCustomTemplateId ? '' : 'home-feature');
	  const keyframesRef = useRef([]);
	  const playTweenRef = useRef(null);
	  const trackRef = useRef(null);
	  const dragRef = useRef(null); // { keyId } while dragging a marker, { scrub: true } while scrubbing
	  const autoVideoRequestedRef = useRef(false);
	  const [scale, setScale] = useState(saved.scale || 2);
	  const [captures, setCaptures] = useState([]);
	  const [busy, setBusy] = useState(false);
	  const [status, setStatus] = useState('');
	  const [worldReady, setWorldReady] = useState(false);

  // ── Render console (client-side terminal) + completion toast ──
  // Reuses the dashboard terminal's visual language (One Dark log lines, window
  // dots, status orb) but is driven by this page's client-side render status —
  // there's no backend stream to subscribe to. Closeable + non-blocking: the
  // render keeps running if the user dismisses the console; a toast reports the
  // outcome either way (mirrors the dashboard #run-error-toast pattern).
  const [renderConsoleOpen, setRenderConsoleOpen] = useState(false);
  const [renderLog, setRenderLog] = useState([]); // { prefix, text, type, cursor }
  const [renderPhase, setRenderPhase] = useState('running'); // running | done | failed
  const [renderToast, setRenderToast] = useState(null); // { type:'success'|'error', text }
  const [renderVideoUrl, setRenderVideoUrl] = useState(null); // finished WebM → footer "Open Video"
  const [renderHost, setRenderHost] = useState(''); // target hostname shown in the footer
  const renderInFlightRef = useRef(false);
  const renderLogRef = useRef(null);
  // Lets the cloud render call the client-side fallback, which is defined later
  // in the file — a ref avoids a temporal-dead-zone / dependency cycle.
  const createVideoRef = useRef(null);

  const [embedBlocked, setEmbedBlocked] = useState(false); // site forbids iframe embedding → show a captured frame instead
  // ── Director (cloud GPU recipe authoring) ──
  const [directorOpen, setDirectorOpen] = useState(false);
  const [dirPreset, setDirPreset] = useState('push-rotate-flat');
  const [dirSeconds, setDirSeconds] = useState(8);
  const [dirFps, setDirFps] = useState(30);
  const [dirSiteSpeed, setDirSiteSpeed] = useState(1);
  const [dirScrollMode, setDirScrollMode] = useState('none'); // none | selector | text | percent
  const [dirSelector, setDirSelector] = useState('');
  const [dirText, setDirText] = useState('');
  const [dirPercent, setDirPercent] = useState(55);
  const [dirSections, setDirSections] = useState([]);
  const [dirMapping, setDirMapping] = useState(false);
  const [dirRendering, setDirRendering] = useState(false);
  // Admin: "Set as new-signup default" — saves the current recipe as the template
  // every new signup's onboarding video renders from. Meta reflects what's live.
  const [savingSignupDefault, setSavingSignupDefault] = useState(false);
  const [signupDefaultMeta, setSignupDefaultMeta] = useState(null); // { source, updatedAt, updatedBy }

  // Panel disclosure state — collapsed is the default footprint.
  const [sizeOpen, setSizeOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [capturesOpen, setCapturesOpen] = useState(false);
  // Expandable Export card open state.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Responsive: collapse the rail under the stage and let the frame fill width.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 820px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Latest UI state, readable from the async three.js builder without re-running it.
  const stateRef = useRef({});
  stateRef.current = { loadedUrl, viewportId, backdropId, interactMode, hue, sat, bright, loopCfg, templateId, bgMode, bgColor, envPreset };

  useEffect(() => { keyframesRef.current = keyframes; }, [keyframes]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?redirect=/dashboard/studio');
  }, [user, loading, router]);

  // Debounced save — current settings become the defaults for the next visit.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ viewportId, formatId, backdropId, bgMode, bgColor, envPreset, hue, sat, bright, loopCfg, scale, totalSeconds }));
      } catch { /* storage full/blocked is non-critical */ }
    }, 250);
    return () => clearTimeout(id);
  }, [viewportId, formatId, backdropId, bgMode, bgColor, envPreset, hue, sat, bright, loopCfg, scale, totalSeconds]);

  // Read non-URL scene options from query params once on mount.
	  useEffect(() => {
	    const params = new URLSearchParams(window.location.search);
	    const qUrl = params.get('url');
	    // The dashboard launches the studio with ?url=<client site>; honor it so
	    // the studio opens already pointed at the client's established website.
	    // The userProfile fallback effect below covers a direct (param-less) open.
	    if (qUrl) setLoadedUrl(/^https?:\/\//i.test(qUrl) ? qUrl : `https://${qUrl}`);
	    const qViewport = params.get('viewport');
	    const qBackdrop = params.get('backdrop');
	    const qTemplate = params.get('template');
	    if (qViewport && VIEWPORTS[qViewport]) setViewportId(qViewport);
	    if (qBackdrop && BACKDROPS[qBackdrop]) setBackdropId(qBackdrop);
	    if (qTemplate && CAMERA_TEMPLATES.some((tpl) => tpl.id === qTemplate)) setTemplateId(qTemplate);
	    autoVideoRequestedRef.current = params.get('autovideo') === '1';
	    if (params.get('director') === '1') setDirectorOpen(true);
	    setTool(params.get('tool') === 'cloth' ? 'cloth' : 'mockup');
	  }, []);

  // Source the site from the account's established website (no manual input).
  // Priority: ?url param (handled on mount) → the EFFECTIVE client's website
  // from /api/dashboard/bootstrap (impersonation-aware) → userProfile.websiteUrl
  // (the signed-in operator's own site) → this app's own homepage, but ONLY for
  // the operator's own dashboard. Bootstrap must win over userProfile: userProfile
  // is the operator's profile, so an admin opening the studio for another client
  // would otherwise preview their OWN site (e.g. hitloop) instead of the client's.
  useEffect(() => {
    if (loadedUrl || !user) return undefined;
    const normalize = (s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);
    let cancelled = false;
    (async () => {
      let site = '';
      let impersonating = false;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/dashboard/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        site = (data?.client?.websiteUrl || data?.dashboardState?.websiteUrl || '').trim();
        impersonating = Boolean(data?.impersonating);
      } catch { /* bootstrap unreachable — fall back to operator profile below */ }
      if (cancelled) return;
      if (!site) site = (userProfile?.websiteUrl || '').trim();
      if (site) { setLoadedUrl(normalize(site)); return; }
      // No website on the effective client. Only fall back to this app's own
      // origin for the operator's OWN dashboard — never while viewing another
      // client, where rendering the app origin (hitloop) would be misleading.
      if (!impersonating && typeof window !== 'undefined') {
        setLoadedUrl(`${window.location.origin}/`);
      } else {
        setStatus('This client has no website set. Add one in the dashboard, or open the studio with ?url=<site>.');
      }
    })();
    return () => { cancelled = true; };
  }, [user, userProfile, loadedUrl]);

  const authedFetch = useCallback(async (path, init = {}) => {
    const token = await user.getIdToken();
    return fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  }, [user]);

  // Map the loaded site's sections so the user can pick a precise scroll target.
  const mapSections = useCallback(async () => {
    const target = (loadedUrl || '').trim();
    if (!target || dirMapping) return;
    setDirMapping(true);
    setStatus(`Mapping sections of ${target}…`);
    try {
      const res = await authedFetch('/api/dashboard/studio-section-map', { method: 'POST', body: JSON.stringify({ url: target }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setDirSections(data.sections || []);
      setStatus(`Mapped ${data.sections?.length || 0} sections — pick a scroll target.`);
    } catch (err) {
      setStatus(`Section map failed: ${err.message}`);
    } finally {
      setDirMapping(false);
    }
  }, [loadedUrl, dirMapping, authedFetch]);

  // ── Render console drivers ── (declared before generateCloudVideo, which lists
  // them as deps — keeping them above avoids a temporal-dead-zone at render.)
  // When true, the status effect mirrors each setStatus() into the console (used
  // by the client-side fallback). The cloud path drives lines explicitly via
  // advanceConsole() with the modal's staged prefixes, so it sets mirror=false.
  const consoleMirrorRef = useRef(true);
  // Settle the most-recent active (cursor) line to a resolved state, in place.
  const settleActiveLine = (lines, type = 'ok') => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].cursor) { lines[i] = { ...lines[i], cursor: false, type }; break; }
    }
    return lines;
  };
  // Open a fresh console and mark a render in-flight.
  const beginRenderConsole = useCallback(({ mirror = true } = {}) => {
    consoleMirrorRef.current = mirror;
    setRenderLog([]);
    setRenderPhase('running');
    setRenderToast(null);
    setRenderVideoUrl(null);
    setRenderConsoleOpen(true);
    renderInFlightRef.current = true;
  }, []);
  // Settle the current active line to ✓ and push the next active stage line.
  const advanceConsole = useCallback((prefix, text) => {
    setRenderLog((prev) => {
      const lines = settleActiveLine(prev.slice(), 'ok');
      lines.push({ prefix, text, type: 'active', cursor: true });
      return lines;
    });
  }, []);
  // Close out the in-flight render: settle the active line, append the final
  // row, flip the orb, toast. Sets the ref false synchronously so the trailing
  // status effect skips its mirror (no duplicate final line).
  const finishRenderConsole = useCallback((ok, message) => {
    renderInFlightRef.current = false;
    setRenderPhase(ok ? 'done' : 'failed');
    setRenderLog((prev) => {
      const lines = settleActiveLine(prev.slice(), ok ? 'ok' : 'error');
      lines.push({ prefix: ok ? 'DONE' : 'ERROR', text: message, type: ok ? 'ok' : 'error', cursor: false });
      return lines;
    });
    setRenderToast({ type: ok ? 'success' : 'error', text: message });
  }, []);

  // Primary render path for the whole studio: build a recipe and send it to the
  // cloud GPU render service (the SAME endpoint the dashboard "RUN" modal uses,
  // which returns a real WebM). Drives the render console with the modal's staged
  // terminal lines + a success/fail toast, and falls back to the in-browser
  // capture only if the cloud service looks unavailable.
  // Build the render recipe from the current studio + Director state for `url`.
  // Shared by the cloud render path and the admin "Set as new-signup default"
  // save, so both serialize the exact same shot.
  const buildCurrentRecipe = useCallback((url) => {
    const fmt = OUTPUT_FORMATS.find((f) => f.id === formatId) || OUTPUT_FORMATS[0];
    const w = fmt.w, h = fmt.h;
    const scroll = dirScrollMode === 'none' ? null
      : dirScrollMode === 'selector' ? (dirSelector ? { target: { selector: dirSelector }, startAt: 0.25, arriveAt: 0.85 } : null)
      : dirScrollMode === 'text' ? (dirText ? { target: { text: dirText }, startAt: 0.25, arriveAt: 0.85 } : null)
      : { target: { percent: dirPercent }, startAt: 0.25, arriveAt: 0.85 };

    // Render the camera animation the user built on the timeline — NOT a server
    // preset. The timeline stores world-space poses { px,py,pz, tx,ty,tz } (from
    // templatePose); the recipe wants spherical poses [radiusFactor, az°, el°,
    // targetXFrac, targetYFrac]. Invert templatePose to convert. Falls back to
    // the named preset only when the timeline has < 2 keys.
    const vp = VIEWPORTS[viewportId] || VIEWPORTS.desktop;
    const clampUnit = (n) => Math.max(-1, Math.min(1, n));
    const timelineKeys = [...keyframesRef.current].sort((a, b) => a.t - b.t);
    const cameraTrack = timelineKeys.length >= 2
      ? timelineKeys.map((k) => {
          const r = Math.hypot(k.px || 0, k.py || 0, k.pz || 0) || 1;
          return {
            t: k.t,
            pose: [
              r / vp.camZ,                              // radiusFactor
              Math.atan2(k.px || 0, k.pz || 0) / DEG,   // azimuth°
              Math.asin(clampUnit((k.py || 0) / r)) / DEG, // elevation°
              (k.tx || 0) / (vp.width * 0.5),           // targetXFrac
              (k.ty || 0) / (vp.height * 0.5),          // targetYFrac
            ],
          };
        })
      : null;
    // When rendering the timeline, honor its duration (the inline Duration field).
    const seconds = cameraTrack ? totalSeconds : dirSeconds;

    // Always read live-stage state from stateRef at build time — never stale.
    const live = stateRef.current;
    return {
      url,
      preset: dirPreset,
      ...(cameraTrack ? { cameraTrack } : {}),
      output: { seconds, fps: dirFps, width: w, height: h, siteSpeed: dirSiteSpeed },
      device: { viewport: live.viewportId, backdrop: live.backdropId, loop: live.loopCfg.on },
      capture: { warmupMs: 400 },
      environment: {
        mode: live.bgMode === 'env' ? 'preset' : (live.bgMode === 'color' ? 'color' : 'gradient'),
        preset: live.envPreset,
        color: live.bgColor,
        hue: live.hue,
        saturation: live.sat,
        brightness: live.bright,
        reflections: true,
      },
      scroll,
    };
  }, [formatId, dirScrollMode, dirSelector, dirText, dirPercent, viewportId, totalSeconds, dirSeconds, dirPreset, dirFps, dirSiteSpeed]);

  const generateCloudVideo = useCallback(async () => {
    if (dirRendering || busy) return;
    const target = (loadedUrl || '').trim();
    if (!/^https?:\/\/\S+$/i.test(target)) {
      setStatus('Load a valid http(s) URL first.');
      setRenderToast({ type: 'error', text: 'No client website loaded yet — can’t render.' });
      return;
    }
    // Guard the common "no frames captured" failure: if the studio fell back to
    // its own app origin (client website not loaded), the GPU service renders a
    // blank/login page and returns zero frames. Refuse with a clear message
    // instead of a cryptic render error.
    try {
      if (new URL(target).origin === window.location.origin) {
        setStatus('No client website loaded — render aborted.');
        setRenderToast({ type: 'error', text: 'Studio isn’t pointed at the client site (it’s on this app). Open it from the dashboard or set the client website, then render.' });
        return;
      }
    } catch { /* unparseable URL already excluded above */ }
    const recipe = buildCurrentRecipe(target);

    let host = target; try { host = new URL(target).hostname.replace(/^www\./, ''); } catch {}
    setRenderHost(host);
    setDirRendering(true);
    setStatus('Cloud GPU render queued — this can take ~30–60s…');
    beginRenderConsole({ mirror: false });
    // Intro lines + cosmetic staged lines (no SSE from the service) — mirrors the
    // dashboard RUN modal's terminal; the timer holds on the last stage until the
    // fetch resolves. The Target line surfaces exactly which site is being rendered.
    setRenderLog([
      { prefix: '$', text: `mockup video · ${host}`, type: 'dim', cursor: false },
      { prefix: '→', text: `Target: ${target}`, type: 'dim', cursor: false },
      { prefix: '→', text: `Background: ${recipe.environment.mode}${recipe.environment.preset ? ' / ' + recipe.environment.preset : ''}`, type: 'dim', cursor: false },
      { prefix: '', text: '─'.repeat(42), type: 'dim', cursor: false },
    ]);
    const stages = [
      ['QUEUE', 'Dispatching to GPU render service…'],
      ['FETCH', 'Loading live site & capturing frames…'],
      ['GPU', 'Rendering 3D device scene on GPU…'],
      ['ENCODE', 'Encoding WebM video…'],
      ['SAVE', 'Saving to your assets…'],
    ];
    advanceConsole(stages[0][0], stages[0][1]);
    let si = 0;
    const timer = setInterval(() => {
      if (si >= stages.length - 1) return;
      si += 1;
      advanceConsole(stages[si][0], stages[si][1]);
    }, 3500);

    try {
      const res = await authedFetch('/api/dashboard/studio-render', { method: 'POST', body: JSON.stringify(recipe) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      let capture = data?.capture || null;
      if (!capture && data?.jobId) {
        advanceConsole('QUEUE', `Queued as ${data.jobId}; waiting for GPU worker…`);
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const jobRes = await authedFetch(`/api/dashboard/studio-render?jobId=${encodeURIComponent(data.jobId)}`);
          const jobData = await jobRes.json().catch(() => ({}));
          if (!jobRes.ok) throw new Error(jobData?.error || `Render job poll failed (${jobRes.status})`);
          const job = jobData?.job || null;
          if (job?.status === 'done' && job.capture) {
            capture = job.capture;
            break;
          }
          if (job?.status === 'failed') {
            throw new Error(job.error || 'Studio render failed.');
          }
        }
      }
      if (!capture) {
        throw new Error('Studio render is still queued; it will appear in assets when the worker finishes.');
      }
      clearInterval(timer);
      setCaptures((prev) => [capture, ...prev]);
      setRenderVideoUrl(capture?.downloadUrl || null);
      setStatus('Cloud render saved to captures.');
      finishRenderConsole(true, 'Video ready — saved to captures.');
    } catch (err) {
      clearInterval(timer);
      // Hidden fallback: only when the cloud service itself looks down/unreachable
      // (not on validation 4xx). The client capture owns the console from here.
      const m = String(err?.message || '');
      const serviceDown = /timed out|HTTP 5\d\d|HTTP 429|failed to fetch|networkerror|load failed|unavailable|empty/i.test(m);
      if (serviceDown && createVideoRef.current) {
        setDirRendering(false);
        await createVideoRef.current();
        return;
      }
      setStatus(`Cloud render failed: ${err.message}`);
      finishRenderConsole(false, `Cloud render failed: ${err.message}`);
    } finally {
      setDirRendering(false);
    }
  }, [dirRendering, busy, loadedUrl, buildCurrentRecipe, authedFetch, beginRenderConsole, advanceConsole, finishRenderConsole]);

  // Admin: persist the current recipe as the new-signup video template. url is
  // stripped server-side (injected per signup), so we can save without a loaded
  // site. Mirrors the same recipe that Generate would render.
  const saveSignupDefault = useCallback(async () => {
    if (!isAdmin || savingSignupDefault) return;
    setSavingSignupDefault(true);
    try {
      const recipe = buildCurrentRecipe(loadedUrl || '');
      delete recipe.url;
      const res = await authedFetch('/api/dashboard/studio-default-recipe', { method: 'PUT', body: JSON.stringify({ recipe }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      setSignupDefaultMeta({ source: data.source, updatedAt: data.updatedAt, updatedBy: data.updatedBy });
      setRenderToast({ type: 'success', text: 'Saved as the new-signup video default.' });
      setStatus('New-signup video template updated.');
    } catch (err) {
      setRenderToast({ type: 'error', text: err?.message || 'Could not save the signup default.' });
    } finally {
      setSavingSignupDefault(false);
    }
  }, [isAdmin, savingSignupDefault, buildCurrentRecipe, loadedUrl, authedFetch]);

  // Load the live signup-default template when an admin opens the Director, so the
  // indicator shows whether a custom template is set and when.
  useEffect(() => {
    if (!directorOpen || !isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/dashboard/studio-default-recipe', { method: 'GET' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setSignupDefaultMeta({ source: data.source, updatedAt: data.updatedAt, updatedBy: data.updatedBy });
          if (data.recipe?.preset) setDirPreset(data.recipe.preset);
        }
      } catch { /* indicator is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [directorOpen, isAdmin, authedFetch]);

  // ── Three.js world ────────────────────────────────────────────────────────
  useEffect(() => {
    // MOCKUP mode only — HOLO PAPER (?tool=cloth) mounts its own world in
    // ClothStudio; building both would double GPU + iframe load for nothing.
    if (tool !== 'mockup' || !user || !stageRef.current) return;
    let disposed = false;
    let raf = 0;
    const stage = stageRef.current;

    (async () => {
      const THREE = await import('three');
      const { OrbitControls, CSS3DRenderer, CSS3DObject, RoomEnvironment, RoundedBoxGeometry } = await import('three-stdlib');
      if (disposed) return;

      // Rounded-rect plane with normalized UVs (ShapeGeometry UVs are raw
      // vertex coords, so they must be remapped to 0..1 for the screen map).
      const roundedRectGeometry = (W, H, r) => {
        const hw = W / 2, hh = H / 2;
        const s = new THREE.Shape();
        s.moveTo(-hw + r, -hh);
        s.lineTo(hw - r, -hh); s.quadraticCurveTo(hw, -hh, hw, -hh + r);
        s.lineTo(hw, hh - r);  s.quadraticCurveTo(hw, hh, hw - r, hh);
        s.lineTo(-hw + r, hh); s.quadraticCurveTo(-hw, hh, -hw, hh - r);
        s.lineTo(-hw, -hh + r); s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
        const g = new THREE.ShapeGeometry(s, 24);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i += 1) {
          uv.setXY(i, (uv.getX(i) + hw) / W, (uv.getY(i) + hh) / H);
        }
        return g;
      };

      const w = stage.clientWidth;
      const h = stage.clientHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, w / h, 1, 30000);
      {
        const dv = templatePose(VIEWPORTS.desktop, DEFAULT_VIEW);
        camera.position.set(dv.px, dv.py, dv.pz);
      }

      const glRenderer = new THREE.WebGLRenderer({ antialias: true });
      glRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      glRenderer.toneMappingExposure = 1.05;
      glRenderer.shadowMap.enabled = true;
      glRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      glRenderer.setSize(w, h, false);
      // Match the artboard's rounded corners — the canvas is overflow:visible's
      // child, so round the canvas itself rather than clipping the stage (which
      // would also cut the 3D orbit spill).
      Object.assign(glRenderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', borderRadius: '16px' });
      stage.appendChild(glRenderer.domElement);

      const cssRenderer = new CSS3DRenderer();
      cssRenderer.setSize(w, h);
      Object.assign(cssRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      stage.appendChild(cssRenderer.domElement);

      const ambient = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambient);
      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(600, 900, 800);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 4;
      {
        const sc = key.shadow.camera;
        sc.near = 100; sc.far = 6000;
        sc.left = -2600; sc.right = 2600; sc.top = 2600; sc.bottom = -2600;
        sc.updateProjectionMatrix();
      }
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x88ffee, 0.5);
      rim.position.set(-800, 300, -600);
      scene.add(rim);

      // Image-based lighting — makes glass + bezel reflections read as hi-end.
      const pmrem = new THREE.PMREMGenerator(glRenderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      // ── Real-world room geometry — floor (desk) + back wall, lit + shadowed so
      // the device reads as sitting in an actual space (only shown in Scene mode).
      const floorMat = new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.9, metalness: 0 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -800;
      floor.receiveShadow = true;
      floor.visible = false;
      scene.add(floor);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8d5cf, roughness: 1, metalness: 0 });
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(60000, 30000), wallMat);
      wall.position.set(0, 6000, -3200);
      wall.receiveShadow = true;
      wall.visible = false;
      scene.add(wall);

      // Gradient sky dome — no floor, no horizon line. A dome (vs flat
      // scene.background) gives parallax while orbiting, so it feels spatial.
      const skyMaterial = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        toneMapped: false,
        depthWrite: false,
      });
      const sky = new THREE.Mesh(new THREE.SphereGeometry(14000, 48, 32), skyMaterial);
      scene.add(sky);

      // Atmospheric dust — soft additive particles, very slow drift.
      const dustSprite = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const x = c.getContext('2d');
        const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const dustGeo = new THREE.BufferGeometry();
      const DUST_COUNT = 500;
      const dustPos = new Float32Array(DUST_COUNT * 3);
      for (let i = 0; i < DUST_COUNT; i += 1) {
        // deterministic pseudo-random scatter in a big shell around the device
        const a = (i * 137.508) % 360 * (Math.PI / 180);
        const rr = 1200 + ((i * 911) % 4800);
        dustPos[i * 3] = Math.cos(a) * rr;
        dustPos[i * 3 + 1] = (((i * 389) % 3600) - 1800);
        dustPos[i * 3 + 2] = Math.sin(a) * rr;
      }
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
      const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
        map: dustSprite,
        size: 26,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      scene.add(dust);

      // Homepage "loop" — the 4D-torus particle ring from ox.jsx, rebuilt as a
      // lightweight Points cloud (same stereographic projection + HSL cycle).
      const LOOP_COUNT = 9000;
      const LOOP_BASE = 2600; // world-units multiplier — ring radius ≈ 715 at size 1
      const loopGeo = new THREE.BufferGeometry();
      loopGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LOOP_COUNT * 3), 3));
      loopGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LOOP_COUNT * 3), 3));
      const loopMat = new THREE.PointsMaterial({
        size: 20,
        vertexColors: true,
        map: dustSprite,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const loopPoints = new THREE.Points(loopGeo, loopMat);
      loopPoints.frustumCulled = false;
      const loopGroup = new THREE.Group();
      loopGroup.add(loopPoints);
      scene.add(loopGroup);

      const loopColor = new THREE.Color();
      const GOLDEN = 2.39996322972865332;
      const updateLoop = (time) => {
        if (!loopGroup.visible) return;
        const pos = loopGeo.attributes.position.array;
        const col = loopGeo.attributes.color.array;
        const R = 0.5, r = 0.1;
        const r1 = R + r * 0.2 * Math.sin(time * 0.5);
        for (let i = 0; i < LOOP_COUNT; i += 1) {
          const t = i / LOOP_COUNT;
          const u = i * GOLDEN + time * 0.05;
          const phi = Math.acos(1 - 2 * t);
          const v = phi * 2 + time * 0.4;
          const x4 = r1 * Math.cos(u), y4 = r1 * Math.sin(u);
          const z4 = r * Math.cos(v),  w4 = r * Math.sin(v);
          const d = 2 - w4;
          const i3 = i * 3;
          pos[i3]     = (x4 / d) * LOOP_BASE;
          pos[i3 + 1] = (y4 / d) * LOOP_BASE;
          pos[i3 + 2] = (z4 / d) * LOOP_BASE * 0.8;
          loopColor.setHSL((0.36 + t * 0.8 + time * 0.02) % 1, 0.75, 0.42);
          col[i3] = loopColor.r; col[i3 + 1] = loopColor.g; col[i3 + 2] = loopColor.b;
        }
        loopGeo.attributes.position.needsUpdate = true;
        loopGeo.attributes.color.needsUpdate = true;
      };

      const applyLoop = (cfg = {}) => {
        loopGroup.visible = cfg.on !== false;
        loopGroup.position.set(cfg.x || 0, cfg.y || 0, cfg.z ?? -1400);
        loopGroup.scale.setScalar(cfg.size || 1);
        loopMat.opacity = cfg.opacity ?? 0.85;
      };

      const deviceGroup = new THREE.Group();
      scene.add(deviceGroup);

      // Live site iframe — lives in the CSS3D layer, swapped per viewport.
      const iframeWrap = document.createElement('div');
      iframeWrap.id = 'studio-live-iframe-wrap';
      iframeWrap.style.pointerEvents = 'none'; // ORBIT default — INTERACT toggles to auto
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, { width: '100%', height: '100%', border: '0', background: '#fff', display: 'block' });
      iframeWrap.appendChild(iframe);
      let cssObject = null;

      const controls = new OrbitControls(camera, glRenderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0, 0);
      controls.minDistance = 180; // below the tightest template zoom (0.28 × mobile camZ ≈ 420) so playback end doesn't snap the camera out
      controls.maxDistance = 8000;

      const world = {
        THREE, scene, camera, glRenderer, cssRenderer, controls,
        deviceGroup, iframe, iframeWrap, cssObject,
        screenPlane: null, screenMaterial: null, texture: null,
        sky, skyMaterial, dust,
        floor, floorMat, wall, wallMat, key, ambient, rim,
        updateLoop, applyLoop,
        stageW: w, stageH: h,
	      };
	      worldRef.current = world;
	      setWorldReady(true);

      // Build (or rebuild) the device mockup for a viewport preset.
      // Paints the sky dome. 'home' redraws the homepage hero gradient
      // (HomePage.jsx heroGradientStyle) on canvas — baked into the scene so
      // RENDER SCENE exports carry it; a DOM/CSS gradient behind the canvas
      // would not. Color backdrops get a deep-space radial vignette instead
      // of a flat fill.
      world.applyBackdrop = (id, adjust = {}) => {
        const b = BACKDROPS[id] || BACKDROPS.home;
        const c = document.createElement('canvas');
        c.width = 2048; c.height = 1024;
        const x = c.getContext('2d');
        // Live contrast control — shift/saturate/dim the whole gradient.
        x.filter = `hue-rotate(${adjust.hue || 0}deg) saturate(${adjust.sat ?? 1}) brightness(${adjust.bright ?? 1})`;
        if (b.home) {
          x.fillStyle = '#ffffff';
          x.fillRect(0, 0, 2048, 1024);
          let g = x.createRadialGradient(370, 225, 0, 370, 225, 1440);
          g.addColorStop(0, 'rgba(196,124,86,0.26)');
          g.addColorStop(0.62, 'rgba(196,124,86,0)');
          x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
          g = x.createRadialGradient(1600, 717, 0, 1600, 717, 1640);
          g.addColorStop(0, 'rgba(102,184,164,0.22)');
          g.addColorStop(0.66, 'rgba(102,184,164,0)');
          x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
          g = x.createLinearGradient(0, 0, 2048, 1024);
          g.addColorStop(0, 'rgba(214,191,123,0.16)');
          g.addColorStop(0.38, 'rgba(255,255,255,0)');
          g.addColorStop(1, 'rgba(171,148,218,0.18)');
          x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
        } else {
          const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
          const g = x.createRadialGradient(1024, 512, 0, 1024, 512, 1300);
          g.addColorStop(0, hex(b.bg));
          g.addColorStop(1, hex(b.ground));
          x.fillStyle = g;
          x.fillRect(0, 0, 2048, 1024);
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        world.skyMaterial.map?.dispose?.();
        world.skyMaterial.map = t;
        world.skyMaterial.needsUpdate = true;
        // Dust reads better tinted-on-light / additive-white-on-dark.
        world.dust.material.color.set(b.home ? 0xab94da : 0xffffff);
        world.dust.material.opacity = b.home ? 0.35 : 0.5;
        world.dust.material.blending = b.home ? THREE.NormalBlending : THREE.AdditiveBlending;
        world.dust.material.needsUpdate = true;
      };

      // ── Immersive background system ──────────────────────────────────────
      // The sky dome is the background; feeding the SAME texture through PMREM
      // makes it also light + reflect on the device glass/metal = "true 3D".
      // RoomEnvironment is kept as the reset/default env. No new libs/assets.
      world.roomEnv = scene.environment;
      const gradeFilter = (a = {}) => `hue-rotate(${a.hue || 0}deg) saturate(${a.sat ?? 1}) brightness(${a.bright ?? 1})`;
      const tuneDustFor = (light) => {
        world.dust.material.color.set(light ? 0xab94da : 0xffffff);
        world.dust.material.opacity = light ? 0.35 : 0.5;
        world.dust.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
        world.dust.material.needsUpdate = true;
      };
      const setSky = (canvas, asEnv, light) => {
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        world.skyMaterial.map?.dispose?.();
        world.skyMaterial.map = tex;
        world.skyMaterial.needsUpdate = true;
        const prev = scene.environment;
        scene.environment = asEnv ? pmrem.fromEquirectangular(tex).texture : world.roomEnv;
        if (prev && prev !== world.roomEnv) prev.dispose?.();
        tuneDustFor(light);
      };
      const drawCover = (x, img) => {
        const ar = (img.width || img.videoWidth || 1) / (img.height || img.videoHeight || 1);
        let dw = 2048, dh = 2048 / ar;
        if (dh < 1024) { dh = 1024; dw = 1024 * ar; }
        x.drawImage(img, (2048 - dw) / 2, (1024 - dh) / 2, dw, dh);
      };
      const showRoom = (on) => { world.floor.visible = on; world.wall.visible = on; };

      // Solid/derived color background (from the color picker).
      world.applyColorBackground = (hex, adjust = {}) => {
        showRoom(false); world.restoreKey?.();
        const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
        const x = c.getContext('2d');
        x.filter = gradeFilter(adjust);
        const base = new THREE.Color(hex || '#11141a');
        const top = base.clone().lerp(new THREE.Color(0xffffff), 0.18);
        const bot = base.clone().multiplyScalar(0.5);
        const g = x.createLinearGradient(0, 0, 0, 1024);
        g.addColorStop(0, `#${top.getHexString()}`);
        g.addColorStop(1, `#${bot.getHexString()}`);
        x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
        setSky(c, false, (base.r * 0.299 + base.g * 0.587 + base.b * 0.114) > 0.5);
      };

      // Real-world room sets — actual floor (desk) + back wall with PBR materials,
      // a shadow-casting key light, and a matching gradient sky behind. The same
      // sky feeds the IBL so reflections agree with the room = Blender-like depth.
      const ENV_PRESETS = {
        'airport-terminal': { floor: 0xb8bcc2, floorR: 0.55, wall: 0xd4d8dc, sky: [['#f0f2f4', 0], ['#dce0e4', 0.3], ['#c8ccd0', 0.65], ['#b8bcc2', 1]], key: 0xf0f4ff, keyI: 3.0, amb: 0.85, dust: false },
        desk:   { floor: 0x6b4a2f, floorR: 0.62, wall: 0xcab9a4, sky: [['#cdbfa8', 0], ['#b39b7c', 0.55], ['#6b4a2f', 1]], key: 0xfff1dd, keyI: 2.4, amb: 0.55, dust: true },
        studio: { floor: 0xdedcd7, floorR: 0.78, wall: 0xeceae5, sky: [['#f4f3f0', 0], ['#e2dfd9', 0.6], ['#cfccc5', 1]], key: 0xffffff, keyI: 2.6, amb: 0.7, dust: true },
        loft:   { floor: 0x53565c, floorR: 0.7,  wall: 0x71757c, sky: [['#9aa0a8', 0], ['#71757c', 0.55], ['#3c3f45', 1]], key: 0xeaf0ff, keyI: 2.2, amb: 0.5, dust: false },
        sunset: { floor: 0x3a2620, floorR: 0.5,  wall: 0x5a3a2c, sky: [['#241433', 0], ['#7a3b2e', 0.5], ['#e8a25a', 0.82], ['#f6d8a4', 1]], key: 0xffb066, keyI: 2.8, amb: 0.4, dust: false },
      };
      const PHOTO_ENV_PRESETS = ['airport-terminal', 'desk', 'loft'];
      world.applyEnvPreset = async (id, adjust = {}) => {
        const p = ENV_PRESETS[id] || ENV_PRESETS.studio;
        const isPhoto = PHOTO_ENV_PRESETS.includes(id);
        showRoom(!isPhoto);
        if (!isPhoto) {
          world.floorMat.color.set(p.floor); world.floorMat.roughness = p.floorR; world.floorMat.needsUpdate = true;
          world.wallMat.color.set(p.wall); world.wallMat.needsUpdate = true;
        }
        world.key.color.set(p.key); world.key.intensity = p.keyI;
        world.ambient.intensity = p.amb;
        const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
        const x = c.getContext('2d');
        x.filter = gradeFilter(adjust);
        if (PHOTO_ENV_PRESETS.includes(id)) {
          try {
            const img = await new Promise((res, rej) => {
              const im = new Image();
              im.onload = () => res(im);
              im.onerror = () => rej(new Error('env load failed'));
              im.src = `/environments/${id}.webp`;
            });
            x.drawImage(img, 0, 0, 2048, 1024);
          } catch {
            // fallback to gradient if image fails to load
            const g = x.createLinearGradient(0, 0, 0, 1024);
            p.sky.forEach(([col, pos]) => g.addColorStop(pos, col));
            x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
          }
        } else {
          const g = x.createLinearGradient(0, 0, 0, 1024);
          p.sky.forEach(([col, pos]) => g.addColorStop(pos, col));
          x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
        }
        setSky(c, true, p.dust);
      };

      // Reset the key light to its default when leaving room mode.
      world.restoreKey = () => { world.key.color.set(0xffffff); world.key.intensity = 1.2; world.ambient.intensity = 0.7; };

      // Uploaded image → dome + IBL reflections.
      world.applyImageBackground = (img, adjust = {}) => {
        if (!img) return false;
        showRoom(false); world.restoreKey();
        const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
        const x = c.getContext('2d');
        x.filter = gradeFilter(adjust);
        x.fillStyle = '#0c0e14'; x.fillRect(0, 0, 2048, 1024);
        drawCover(x, img);
        setSky(c, true, false);
        return true;
      };

      // Blurred frame of the loaded site (reuses the device screen texture).
      world.applySiteBackground = (adjust = {}) => {
        const img = world.texture?.image;
        if (!img) return false;
        showRoom(false); world.restoreKey();
        const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
        const x = c.getContext('2d');
        x.filter = `blur(30px) ${gradeFilter(adjust)}`;
        drawCover(x, img);
        x.filter = 'none';
        x.fillStyle = 'rgba(8,10,16,0.42)'; x.fillRect(0, 0, 2048, 1024);
        setSky(c, false, false);
        return true;
      };

      world.buildDevice = (vpId) => {
        const vp = VIEWPORTS[vpId];
        const { width: W, height: H, bezel: B, depth: D, corner, screenCorner } = vp;

        // tear down previous
        while (deviceGroup.children.length) {
          const c = deviceGroup.children.pop();
          c.traverse?.((n) => { n.geometry?.dispose(); n.material?.dispose?.(); });
          deviceGroup.remove(c);
        }
        if (world.cssObject) { scene.remove(world.cssObject); world.cssObject = null; }

        // Photoreal Apple-hardware look: brushed-aluminum body (titanium tint
        // on mobile), edge-to-edge cover glass, per-device details below.
        const alumMat = new THREE.MeshPhysicalMaterial({
          color: vpId === 'mobile' ? 0x8e8a84 : 0xd6d8da,
          metalness: 0.9,
          roughness: vpId === 'mobile' ? 0.42 : 0.34,
          envMapIntensity: 1.5,
        });
        const glassMat = new THREE.MeshPhysicalMaterial({
          color: 0x050507,
          roughness: 0.06,
          metalness: 0.1,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          envMapIntensity: 1.2,
        });
        const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x101418, roughness: 0.05, metalness: 0.4, clearcoat: 1 });

        const body = new THREE.Mesh(
          new RoundedBoxGeometry(W + B * 2, H + B * 2, D, 5, Math.min(corner, D / 2 - 1)),
          alumMat
        );
        body.position.z = -D / 2 - 1;
        deviceGroup.add(body);

        const face = new THREE.Mesh(
          roundedRectGeometry(W + B * 2 - 6, H + B * 2 - 6, Math.max(screenCorner, corner * 0.7)),
          glassMat
        );
        face.position.z = 0.4;
        deviceGroup.add(face);

        if (vpId === 'desktop') {
          // Studio-Display stand: tilted aluminum arm + flat rounded foot.
          const arm = new THREE.Mesh(new RoundedBoxGeometry(150, 320, 20, 4, 9), alumMat);
          arm.position.set(0, -(H / 2 + B + 130), -D - 24);
          arm.rotation.x = -0.12;
          deviceGroup.add(arm);
          const foot = new THREE.Mesh(new RoundedBoxGeometry(360, 14, 250, 4, 7), alumMat);
          foot.position.set(0, -(H / 2 + B + 280), -D + 60);
          deviceGroup.add(foot);
        }

        if (vpId === 'mobile') {
          // iPhone-style side buttons + rear camera plateau with three lenses.
          const sideButton = (height, y, side) => {
            const m = new THREE.Mesh(new RoundedBoxGeometry(10, height, D * 0.55, 2, 4), alumMat);
            m.position.set(side * (W / 2 + B + 3), y, -D / 2);
            deviceGroup.add(m);
          };
          sideButton(95, H * 0.16, 1);        // power
          sideButton(34, H * 0.22 + 86, -1);  // action
          sideButton(52, H * 0.22, -1);       // volume up
          sideButton(52, H * 0.22 - 70, -1);  // volume down
          const plateau = new THREE.Mesh(new RoundedBoxGeometry(170, 170, 10, 3, 26), alumMat);
          plateau.position.set(-(W / 2 + B) + 105, (H / 2 + B) - 105, -D - 4);
          deviceGroup.add(plateau);
          [[-32, 32], [-32, -32], [36, 0]].forEach(([lx, ly]) => {
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 8, 32), lensMat);
            lens.rotation.x = Math.PI / 2;
            lens.position.set(-(W / 2 + B) + 105 + lx, (H / 2 + B) - 105 + ly, -D - 10);
            deviceGroup.add(lens);
          });
        }

        if (vpId === 'tablet') {
          // iPad-style rear camera pod, single lens.
          const camPod = new THREE.Mesh(new RoundedBoxGeometry(96, 96, 8, 3, 20), alumMat);
          camPod.position.set(-(W / 2 + B) + 70, (H / 2 + B) - 70, -D - 3);
          deviceGroup.add(camPod);
          const lens = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 7, 32), lensMat);
          lens.rotation.x = Math.PI / 2;
          lens.position.set(-(W / 2 + B) + 70, (H / 2 + B) - 70, -D - 8);
          deviceGroup.add(lens);
        }

        // Textured screen — rounded corners to match the live iframe.
        // toneMapped:false keeps the screenshot's true colors under ACES.
        world.screenMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, map: world.texture || null, toneMapped: false });
        world.screenPlane = new THREE.Mesh(roundedRectGeometry(W, H, screenCorner), world.screenMaterial);
        world.screenPlane.position.z = 1;
        deviceGroup.add(world.screenPlane);

        // Live iframe layer, aligned to the screen plane.
        Object.assign(iframeWrap.style, {
          width: `${W}px`,
          height: `${H}px`,
          background: '#fff',
          borderRadius: `${screenCorner}px`,
          overflow: 'hidden',
        });
        world.cssObject = new CSS3DObject(iframeWrap);
        world.cssObject.position.set(0, 0, 2);
        scene.add(world.cssObject);

        // Device meshes cast + receive shadows so it grounds into the room.
        deviceGroup.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
        // Sit the floor at the device's base (stand foot on desktop) so it rests
        // on the desk in Scene mode rather than floating.
        world.floor.position.y = vpId === 'desktop' ? -(H / 2 + B + 287) : -(H / 2 + B + 8);

        // Float the device in space, centered on the camera target, parked at the
        // default front-left 3/4 framing.
        deviceGroup.position.y = 0;
        world.cssObject.position.y = 0;
        const dv = templatePose(vp, DEFAULT_VIEW);
        controls.target.set(dv.tx, dv.ty, dv.tz);
        camera.position.set(dv.px, dv.py, dv.pz);
        // Force OrbitControls to sync its internal spherical state to the new
        // camera position. Without this, damping causes the camera to drift back
        // to wherever it was before the viewport switch.
        const _wasDamping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = _wasDamping;
      };

      // Apply UI state that may have been set before this async build finished.
      const init = stateRef.current;
      world.buildDevice(init.viewportId || 'desktop');
      if (init.loadedUrl) iframe.src = init.loadedUrl;
      // Initial background per the chosen mode (the React effect keeps it live).
      if (init.bgMode === 'color') world.applyColorBackground(init.bgColor, init);
      else world.applyEnvPreset(init.envPreset || 'studio', init);
      world.applyLoop(init.loopCfg);
      // buildDevice parks the camera at the default 3/4 framing; if a template is
      // active, open on its first pose so the scene loads mid-shot instead.
      const initTpl = CAMERA_TEMPLATES.find((t) => t.id === init.templateId);
      if (initTpl) {
        const pose = templatePose(VIEWPORTS[init.viewportId || 'desktop'], openingKeys(initTpl)[0]);
        camera.position.set(pose.px, pose.py, pose.pz);
        controls.target.set(pose.tx, pose.ty, pose.tz);
      }
      iframeWrap.style.pointerEvents = init.interactMode ? 'auto' : 'none';
      cssRenderer.domElement.style.pointerEvents = init.interactMode ? 'auto' : 'none';

      const onResize = () => {
        const nw = stage.clientWidth, nh = stage.clientHeight;
        if (!nw || !nh) return;
        world.stageW = nw; world.stageH = nh;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        glRenderer.setSize(nw, nh, false);
        cssRenderer.setSize(nw, nh);
      };
      window.addEventListener('resize', onResize);
      // The canvas is now an export-sized artboard whose box changes with layout
      // (nav width, viewport, selected resolution), not just window size — observe
      // the stage element directly so the renderer re-fits on every box change.
      const stageRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
      stageRO?.observe(stage);

      const clock = new THREE.Clock();
      const tick = () => {
        if (disposed) return;
        const t = clock.getElapsedTime();
        dust.rotation.y = t * 0.008;
        updateLoop(t);
        controls.update();
        glRenderer.render(scene, camera);
        cssRenderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();

      world.cleanup = () => {
        window.removeEventListener('resize', onResize);
        stageRO?.disconnect();
        cancelAnimationFrame(raf);
        controls.dispose();
        glRenderer.dispose();
        glRenderer.domElement.remove();
        cssRenderer.domElement.remove();
      };
    })();

	    return () => {
	      disposed = true;
	      setWorldReady(false);
	      worldRef.current?.cleanup?.();
	      worldRef.current = null;
	    };
    // Built once per auth'd mount (and per tool switch back to mockup) —
    // viewport/backdrop/url changes mutate the world below.
  }, [user, tool]);

  // ── World mutations from UI state ────────────────────────────────────────
  useEffect(() => {
    const w = worldRef.current;
    if (w?.iframe && loadedUrl) w.iframe.src = loadedUrl;
  }, [loadedUrl, viewportId]);

  useEffect(() => {
    worldRef.current?.buildDevice?.(viewportId);
  }, [viewportId]);

  // Live background — dispatches to the active mode; color grade applies to all.
  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    const adj = { hue, sat, bright };
    if (bgMode === 'color') w.applyColorBackground?.(bgColor, adj);
    else if (bgMode === 'image') w.applyImageBackground?.(bgImageEl, adj);
    else if (bgMode === 'site') w.applySiteBackground?.(adj);
    else w.applyEnvPreset?.(envPreset, adj);
  }, [worldReady, bgMode, bgColor, envPreset, bgImageEl, hue, sat, bright]);

  useEffect(() => {
    worldRef.current?.applyLoop?.(loopCfg);
  }, [loopCfg]);

  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    w.iframeWrap.style.pointerEvents = interactMode ? 'auto' : 'none';
    w.cssRenderer.domElement.style.pointerEvents = interactMode ? 'auto' : 'none';
  }, [interactMode]);

  // ── Camera keyframe timeline ──────────────────────────────────────────────
  // Keys live at normalized track positions (t: 0..1) over a total duration.
  // The camera pose at playhead u interpolates the two keys straddling u with
  // smoothstep — so spacing between markers IS the speed between poses.
  const applyPath = useCallback((u) => {
    const w = worldRef.current;
    const kf = keyframesRef.current;
    if (!w || !kf.length) return;
    const sorted = [...kf].sort((a, b) => a.t - b.t);
    const setPose = (k) => {
      w.camera.position.set(k.px, k.py, k.pz);
      w.controls.target.set(k.tx, k.ty, k.tz);
    };
    if (u <= sorted[0].t) return setPose(sorted[0]);
    if (u >= sorted[sorted.length - 1].t) return setPose(sorted[sorted.length - 1]);
    let i = 0;
    while (i < sorted.length - 2 && sorted[i + 1].t < u) i += 1;
    const a = sorted[i], b = sorted[i + 1];
    const span = Math.max(1e-6, b.t - a.t);
    let t = (u - a.t) / span;
    t = t * t * (3 - 2 * t); // smoothstep per segment
    const L = (p, q) => p + (q - p) * t;
    w.camera.position.set(L(a.px, b.px), L(a.py, b.py), L(a.pz, b.pz));
    w.controls.target.set(L(a.tx, b.tx), L(a.ty, b.ty), L(a.tz, b.tz));
  }, []);

  // Add / remove / drag keyframes is handled by the track pointer gestures
  // (deleteKey, addKeyAt, onTrackPointerDown/Move/Up below).

  // Apply a camera template: 8 keys spread evenly across the timeline, scaled
  // to the active viewport. Re-applied automatically when the viewport
  // changes so the same move works across desktop/mobile/tablet.
  const applyTemplate = useCallback((tplId) => {
    const tpl = CAMERA_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    playTweenRef.current?.kill();
    playTweenRef.current = null;
    setPlaying(false);
    const w = worldRef.current;
    if (w) w.controls.enabled = true;
    // Timeline units: 1 per travel segment + each pose's hold.
    const kf = buildTemplateKeyframes(tpl, viewportId);
    setKeyframes(kf);
    setSelectedKeyId(null);
    setTotalSeconds(tpl.seconds);
    setScrubVal(0);
    if (w) {
      w.camera.position.set(kf[0].px, kf[0].py, kf[0].pz);
      w.controls.target.set(kf[0].tx, kf[0].ty, kf[0].tz);
    }
    const holdCount = tpl.keys.filter((k) => k[5]).length;
    setStatus(`Template "${tpl.label}" loaded — ${tpl.keys.length} poses${holdCount ? ` (${holdCount} holds)` : ''} · ${tpl.theme} · ${tpl.intensity} · ${tpl.seconds}s.`);
  }, [viewportId]);

  useEffect(() => {
    if (worldReady && templateId) applyTemplate(templateId);
  }, [worldReady, templateId, applyTemplate]);

  // Load a user-saved template — applies its exact keyframes + duration directly.
  const applyCustomTemplate = useCallback((id) => {
    const tpl = customTemplates.find((t) => t.id === id);
    if (!tpl) return;
    playTweenRef.current?.kill();
    playTweenRef.current = null;
    setPlaying(false);
    const w = worldRef.current;
    if (w) w.controls.enabled = true;
    setTemplateId('');
    setKeyframes((tpl.keyframes || []).map((k) => ({ ...k })));
    setTotalSeconds(tpl.seconds || totalSeconds);
    setSelectedKeyId(null);
    setScrubVal(0);
    const k0 = tpl.keyframes?.[0];
    if (w && k0) { w.camera.position.set(k0.px, k0.py, k0.pz); w.controls.target.set(k0.tx, k0.ty, k0.tz); }
    setStatus(`Loaded saved template "${tpl.label}".`);
    try { window.localStorage.setItem(LAST_CUSTOM_TEMPLATE_KEY, id); } catch {}
  }, [customTemplates, totalSeconds]);

  // Auto-apply the last-used custom template once after world is ready.
  const didAutoCustomRef = useRef(false);
  useEffect(() => {
    if (!worldReady || didAutoCustomRef.current || !initialCustomTemplateId) return;
    didAutoCustomRef.current = true;
    applyCustomTemplate(initialCustomTemplateId);
  }, [worldReady, applyCustomTemplate]);

  // Save the current timeline as a reusable template (persisted locally).
  const saveAsTemplate = useCallback(() => {
    if (keyframes.length < 2) { setStatus('Add at least 2 keyframes before saving a template.'); return; }
    const name = (typeof window !== 'undefined' ? window.prompt('Name this template', 'My Template') : '') || '';
    if (!name.trim()) return;
    const entry = { id: `custom-${Date.now()}`, label: name.trim(), seconds: totalSeconds, viewportId, keyframes: keyframes.map((k) => ({ ...k })) };
    setCustomTemplates((prev) => {
      const next = [...prev, entry];
      try { window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(next)); } catch { /* storage blocked is non-critical */ }
      return next;
    });
    setStatus(`Saved template "${entry.label}".`);
  }, [keyframes, totalSeconds, viewportId]);

  const scrubTo = useCallback((u) => {
    if (playing) return;
    const clamped = Math.min(1, Math.max(0, u));
    setScrubVal(clamped);
    applyPath(clamped);
  }, [playing, applyPath]);

  const stopTimeline = useCallback(() => {
    playTweenRef.current?.kill();
    playTweenRef.current = null;
    setPlaying(false);
    const w = worldRef.current;
    if (w) w.controls.enabled = true;
  }, []);

  // Play from the playhead to the end of the track.
  const playTimeline = useCallback(() => {
    const w = worldRef.current;
    if (!w || keyframesRef.current.length < 2 || playing) return;
    const startU = scrubVal >= 0.999 ? 0 : scrubVal;
    setPlaying(true);
    w.controls.enabled = false;
    const proxy = { u: startU };
    playTweenRef.current = gsap.to(proxy, {
      u: 1,
      duration: totalSeconds * (1 - startU),
      ease: 'none', // easing happens per segment inside applyPath
      onUpdate: () => { applyPath(proxy.u); setScrubVal(proxy.u); },
      onComplete: () => { setPlaying(false); w.controls.enabled = true; },
    });
  }, [playing, scrubVal, totalSeconds, applyPath]);

  // Loop the whole track continuously from the start.
  const playLoop = useCallback(() => {
    const w = worldRef.current;
    if (!w || keyframesRef.current.length < 2 || playing) return;
    setPlaying(true);
    w.controls.enabled = false;
    const proxy = { u: 0 };
    playTweenRef.current = gsap.fromTo(proxy, { u: 0 }, {
      u: 1,
      duration: totalSeconds,
      ease: 'none',
      repeat: -1,
      onUpdate: () => { applyPath(proxy.u); setScrubVal(proxy.u); },
    });
  }, [playing, totalSeconds, applyPath]);

  // Stop and return the playhead (and camera) to the start of the track.
  const resetPlayback = useCallback(() => {
    playTweenRef.current?.kill();
    playTweenRef.current = null;
    setPlaying(false);
    const w = worldRef.current;
    if (w) w.controls.enabled = true;
    setScrubVal(0);
    applyPath(0);
  }, [applyPath]);

  // Track pointer logic — drag a marker to retime it, drag empty track to scrub.
  const trackUFromEvent = useCallback((e) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const span = rect.width - TL_PAD * 2;
    return Math.min(1, Math.max(0, (e.clientX - rect.left - TL_PAD) / span));
  }, []);

  // Snap a scrub position to a nearby keyframe so the playhead lands cleanly on keys.
  const snapU = useCallback((u) => {
    let best = u, bestD = 0.022;
    for (const k of keyframesRef.current) {
      const d = Math.abs(k.t - u);
      if (d < bestD) { bestD = d; best = k.t; }
    }
    return best;
  }, []);

  // Add / remove keyframes — NEVER moves the playhead. deleteKey removes by id;
  // addKeyAt drops a key at track position u from the current camera pose.
  const deleteKey = useCallback((keyId) => {
    setKeyframes((prev) => prev.filter((k) => k.id !== keyId));
    setSelectedKeyId((cur) => (cur === keyId ? null : cur));
    setTemplateId('');
  }, []);

  const addKeyAt = useCallback((u) => {
    const w = worldRef.current;
    if (!w) return;
    const p = w.camera.position, t = w.controls.target;
    const id = `k${Date.now()}`;
    setKeyframes((prev) => {
      // Nudge off any existing key at the same spot so both stay grabbable.
      let kt = u;
      while (prev.some((k) => Math.abs(k.t - kt) < 0.01)) kt = Math.min(1, kt + 0.03);
      return [...prev, { id, t: kt, px: p.x, py: p.y, pz: p.z, tx: t.x, ty: t.y, tz: t.z }];
    });
    setSelectedKeyId(id);
    setTemplateId(''); // manual edit — stop re-syncing to the template on viewport change
    setStatus(`Keyframe added at ${(u * 100).toFixed(0)}% of the timeline.`);
  }, []);

  // Unified pointer gestures (mouse + touch) on the track. The playhead NEVER moves here —
  // scrubbing is exclusively the playhead ball. On the track:
  //   • drag a marker             → retime it (works on touch too)
  //   • double-tap / double-click → on a marker: delete; on empty track: add a key
  //   • long-press a marker       → delete (touch-friendly)
  //   • single tap a marker       → select + jump playhead to it
  const lastTapRef = useRef({ time: 0, u: 0, keyId: null });

  const onTrackPointerDown = useCallback((e) => {
    if (playing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const keyId = e.target.dataset?.keyId || null;
    const drag = { keyId, downU: trackUFromEvent(e), moved: false, longFired: false, timer: null };
    if (keyId) {
      setSelectedKeyId(keyId);
      drag.timer = setTimeout(() => {
        if (dragRef.current && !dragRef.current.moved) { dragRef.current.longFired = true; deleteKey(keyId); }
      }, 450); // long-press delete
    }
    dragRef.current = drag;
  }, [playing, trackUFromEvent, deleteKey]);

  const onTrackPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const u = trackUFromEvent(e);
    if (!drag.moved && Math.abs(u - drag.downU) > 0.01) {
      drag.moved = true;
      if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; } // a drag cancels long-press
    }
    if (drag.moved && drag.keyId && !drag.longFired) {
      setKeyframes((prev) => prev.map((k) => (k.id === drag.keyId ? { ...k, t: u } : k)));
    }
  }, [trackUFromEvent]);

  const onTrackPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.timer) clearTimeout(drag.timer);
    if (drag.longFired || drag.moved) return; // already deleted, or it was a drag-retime
    // Tap — double-tap detection (same target, short window + close position).
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = (now - last.time) < 320 && Math.abs(drag.downU - last.u) < 0.05 && last.keyId === drag.keyId;
    if (isDouble) {
      lastTapRef.current = { time: 0, u: 0, keyId: null };
      if (drag.keyId) deleteKey(drag.keyId); else addKeyAt(drag.downU);
      return;
    }
    // Single tap only records for double-tap detection + selects (selection happens on
    // pointer-down). It does NOT move the playhead — scrubbing is exclusively the ball.
    lastTapRef.current = { time: now, u: drag.downU, keyId: drag.keyId };
  }, [deleteKey, addKeyAt]);

  // Playhead ball — the only scrub handle. Drag it to move the playhead; it snaps to keys.
  const onPlayheadPointerDown = useCallback((e) => {
    if (playing) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { scrub: true };
  }, [playing]);

  const onPlayheadPointerMove = useCallback((e) => {
    if (!dragRef.current?.scrub) return;
    scrubTo(snapU(trackUFromEvent(e)));
  }, [scrubTo, snapU, trackUFromEvent]);

  const onPlayheadPointerUp = useCallback(() => { dragRef.current = null; }, []);

  // ── Captures ──────────────────────────────────────────────────────────────
  const refreshCaptures = useCallback(async () => {
    try {
      const res = await authedFetch('/api/dashboard/studio-capture');
      const data = await res.json();
      if (res.ok) setCaptures(data.captures || []);
    } catch { /* list is non-critical */ }
  }, [authedFetch]);

  useEffect(() => { if (user) refreshCaptures(); }, [user, refreshCaptures]);

  // Server-side hi-res capture of the loaded URL. Returns the capture ref.
  const requestCapture = useCallback(async ({ wantFullPage }) => {
    const target = (loadedUrl || '').trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('Enter a valid http(s) URL first.');
    const res = await authedFetch('/api/dashboard/studio-capture', {
      method: 'POST',
      body: JSON.stringify({ action: 'capture', url: target, viewportId, fullPage: wantFullPage, scale }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    setCaptures((prev) => [data.capture, ...prev]);
    return data.capture;
  }, [loadedUrl, viewportId, scale, authedFetch]);

  const captureHiRes = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus(`Capturing ${viewportId} @ ${scale}x via browserless…`);
    try {
      const capture = await requestCapture({ wantFullPage: fullPage });
      setStatus(`Captured ${capture.viewportLabel} — ${(capture.sizeBytes / 1024).toFixed(0)}KB. Saved to pipeline.`);
    } catch (err) {
      setStatus(`Capture failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, viewportId, scale, fullPage, requestCapture]);

  // Load a stored capture as the screen texture (same-origin via proxy).
  const loadScreenTexture = useCallback(async (capture) => {
    const w = worldRef.current;
    if (!w || !capture?.storagePath) throw new Error('No capture to texture from.');
    const res = await authedFetch(`/api/dashboard/studio-capture?proxy=1&path=${encodeURIComponent(capture.storagePath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob());
    const tex = new w.THREE.CanvasTexture(bitmap);
    tex.colorSpace = w.THREE.SRGBColorSpace;
    w.texture?.dispose?.();
    w.texture = tex;
    if (w.screenMaterial) {
      w.screenMaterial.map = tex;
      w.screenMaterial.color.set(0xffffff);
      w.screenMaterial.needsUpdate = true;
    }
  }, [authedFetch]);

  // Use the loaded site (blurred) as the background. Reuses the device screen
  // texture; captures once if nothing is loaded yet.
  const useSiteBackground = useCallback(async () => {
    setBgMode('site');
    const w = worldRef.current;
    if (w && !w.texture?.image) {
      try {
        setBusy(true);
        const cap = await requestCapture({ wantFullPage: false });
        await loadScreenTexture(cap);
      } catch (err) {
        setStatus(`Couldn't capture the site for the background: ${err.message}`);
      } finally {
        setBusy(false);
      }
    }
    worldRef.current?.applySiteBackground?.(stateRef.current);
  }, [requestCapture, loadScreenTexture]);

  // Paint a message directly onto the device screen mesh (shown when a site
  // can't be embedded and no captured frame is available yet).
  const showScreenPlaceholder = useCallback((text) => {
    const w = worldRef.current;
    if (!w || !w.screenMaterial) return;
    const vp = VIEWPORTS[stateRef.current.viewportId || 'desktop'] || VIEWPORTS.desktop;
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const x = c.getContext('2d');
    x.fillStyle = '#0e1116'; x.fillRect(0, 0, c.width, c.height);
    x.textAlign = 'center';
    const lines = String(text).split('\n');
    const lh = vp.height * 0.075;
    const startY = c.height / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, i) => {
      x.font = `${i === 0 ? 'bold ' : ''}${Math.round(vp.height * (i === 0 ? 0.052 : 0.038))}px sans-serif`;
      x.fillStyle = i === 0 ? '#e8e8ea' : '#aab2bd';
      x.fillText(ln, c.width / 2, startY + i * lh);
    });
    const tex = new w.THREE.CanvasTexture(c);
    tex.colorSpace = w.THREE.SRGBColorSpace;
    w.texture?.dispose?.();
    w.texture = tex;
    w.screenMaterial.map = tex;
    w.screenMaterial.color.set(0xffffff);
    w.screenMaterial.needsUpdate = true;
  }, []);

  // Sites with X-Frame-Options / restrictive CSP frame-ancestors can't load in
  // the live preview iframe (they render blank). Detect it and show a clear
  // message on the device screen telling the user to RENDER SCENE (which
  // captures the site directly and works). Same-origin always embeds → skipped.
  useEffect(() => {
    const target = (loadedUrl || '').trim();
    if (!user || !worldReady || !/^https?:\/\//i.test(target)) return undefined;
    try { if (new URL(target).origin === window.location.origin) { setEmbedBlocked(false); return undefined; } } catch { return undefined; }
    let cancelled = false;
    (async () => {
      let host = target; try { host = new URL(target).hostname; } catch {}
      try {
        const res = await authedFetch(`/api/dashboard/check-embeddable?url=${encodeURIComponent(target)}`);
        const data = await res.json();
        if (cancelled) return;
        const w = worldRef.current;
        if (data?.embeddable === false) {
          setEmbedBlocked(true);
          if (w) { w.iframeWrap.style.visibility = 'hidden'; w.iframeWrap.style.pointerEvents = 'none'; }
          showScreenPlaceholder(`${host}\nThis site blocks embedded live preview.\nClick Render to capture it — that works.`);
          setStatus(`${host} blocks live embedding. Click Render — the cloud render captures the site directly and works normally.`);
        } else {
          setEmbedBlocked(false);
          if (w) { w.iframeWrap.style.visibility = 'visible'; w.iframeWrap.style.pointerEvents = stateRef.current.interactMode ? 'auto' : 'none'; }
        }
      } catch { /* network/transient — leave the iframe path as-is */ }
    })();
    return () => { cancelled = true; };
  }, [loadedUrl, worldReady, user, authedFetch, showScreenPlaceholder]);

  // Mirror each in-flight status line into the console (client fallback only).
  useEffect(() => {
    if (!renderInFlightRef.current || !consoleMirrorRef.current || !status) return;
    const low = status.toLowerCase();
    const type = /fail|error|not supported|empty|block/.test(low) ? 'error'
      : /saved|downloaded|attached|complete/.test(low) ? 'ok'
      : 'active';
    const prefix = /fail|error|not supported|empty|block/.test(low) ? 'ERROR'
      : /captur|screen/.test(low) ? 'SCREEN'
      : /textur/.test(low) ? 'TEXTURE'
      : /record/.test(low) ? 'RECORD'
      : /upload/.test(low) ? 'UPLOAD'
      : /saved|downloaded|attached|complete/.test(low) ? 'DONE'
      : /creating|rendering|starting|queued/.test(low) ? 'RENDER'
      : 'LOG';
    setRenderLog((prev) => {
      const lines = settleActiveLine(prev.slice(), 'ok');
      lines.push({ prefix, text: status, type, cursor: type === 'active' });
      return lines;
    });
  }, [status]);

  // Keep the console scrolled to the newest line.
  useEffect(() => {
    if (renderLogRef.current) renderLogRef.current.scrollTop = renderLogRef.current.scrollHeight;
  }, [renderLog]);

  // Auto-dismiss the render toast, like the dashboard toasts.
  useEffect(() => {
    if (!renderToast) return undefined;
    const t = setTimeout(() => setRenderToast(null), renderToast.type === 'error' ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [renderToast]);

  const createVideo = useCallback(async () => {
    const w = worldRef.current;
    if (!w || busy) return;
    if (typeof MediaRecorder === 'undefined' || typeof w.glRenderer.domElement.captureStream !== 'function') {
      setStatus('Video recording is not supported in this browser.');
      setRenderToast({ type: 'error', text: 'Video recording is not supported in this browser.' });
      return;
    }

    let stream = null;
    let recorder = null;
    let tween = null;
    setBusy(true);
    beginRenderConsole();
    try {
      playTweenRef.current?.kill();
      playTweenRef.current = null;
      const activeTemplate = CAMERA_TEMPLATES.find((t) => t.id === templateId)
        || CAMERA_TEMPLATES.find((t) => t.id === 'spiral-in')
        || CAMERA_TEMPLATES[0];
      const shouldUseTemplate = Boolean(activeTemplate && (templateId || keyframesRef.current.length < 2));
      const videoKeyframes = shouldUseTemplate
        ? buildTemplateKeyframes(activeTemplate, viewportId)
        : [...keyframesRef.current].sort((a, b) => a.t - b.t);
      const videoSeconds = shouldUseTemplate ? activeTemplate.seconds : totalSeconds;
      if (videoKeyframes.length < 2) throw new Error('Add at least two camera keys or choose a template.');

      if (shouldUseTemplate) {
        keyframesRef.current = videoKeyframes;
        setKeyframes(videoKeyframes);
        setTemplateId(activeTemplate.id);
        setTotalSeconds(videoSeconds);
      }

      setStatus(`Creating video — capturing ${viewportId} screen @ ${scale}x…`);
      let capture;
      try {
        capture = await requestCapture({ wantFullPage: false });
      } catch (captureErr) {
        const viewportNeedle = String(viewportId || '').toLowerCase();
        const fallback = captures.find((item) => {
          if (!item || item.type === 'studio_video' || !item.downloadUrl) return false;
          const matchesViewport =
            item.viewportId === viewportId ||
            String(item.variant || '').toLowerCase().includes(viewportNeedle) ||
            String(item.viewportLabel || '').toLowerCase().includes(viewportNeedle);
          return matchesViewport;
        }) || captures.find((item) => item?.type !== 'studio_video' && item?.downloadUrl);
        if (!fallback) throw captureErr;
        capture = fallback;
        setStatus(`Live capture failed (${captureErr.message}). Reusing saved ${fallback.label || fallback.viewportLabel || 'Studio image'}…`);
      }
      setStatus('Texturing screen for video…');
      await loadScreenTexture(capture);

      const mimeType = getSupportedVideoMimeType();
      if (!mimeType) throw new Error('No supported WebM encoder is available in this browser.');

      const chunks = [];
      stream = w.glRenderer.domElement.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2000000 });
      const recordingDone = new Promise((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onerror = () => reject(recorder.error || new Error('Video recorder failed.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      w.iframeWrap.style.visibility = 'hidden';
      w.controls.enabled = false;
      setPlaying(true);
      setScrubVal(0);
      applyPath(0);
      w.controls.update();
      w.glRenderer.render(w.scene, w.camera);

      recorder.start(250);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      setStatus(`Recording ${videoSeconds}s ${VIEWPORTS[viewportId].label} mockup video…`);
      const proxy = { u: 0 };
      await new Promise((resolve) => {
        tween = gsap.to(proxy, {
          u: 1,
          duration: videoSeconds,
          ease: 'none',
          // No setScrubVal here: a per-frame React state write re-renders the whole
          // studio page ~60×/sec during capture, starving the main thread + compositor
          // (freezes the render-console marquee) and hurts video frame pacing. The
          // scrubber is hidden behind the render console anyway; sync it once on complete.
          onUpdate: () => {
            applyPath(proxy.u);
            w.controls.update();
            w.glRenderer.render(w.scene, w.camera);
          },
          onComplete: resolve,
        });
      });
      setScrubVal(1);

      if (recorder.state !== 'inactive') recorder.stop();
      const blob = await recordingDone;
      if (!blob.size) throw new Error('Recorder produced an empty video.');

      setStatus(`Uploading video — ${(blob.size / 1024 / 1024).toFixed(1)}MB…`);
      const label = `${VIEWPORTS[viewportId].label} video · ${activeTemplate?.label || 'CUSTOM'} · ${BACKDROPS[backdropId].label}`;
      const token = await user.getIdToken();
      const form = new FormData();
      form.append('action', 'upload-video');
      form.append('video', blob, `mockup-video-${viewportId}-${Date.now()}.webm`);
      form.append('label', label);
      form.append('viewportId', viewportId);
      form.append('backdropId', backdropId);
      form.append('templateId', activeTemplate?.id || '');
      form.append('durationSeconds', String(videoSeconds));
      form.append('sourceUrl', loadedUrl);
      const res = await fetch('/api/dashboard/studio-capture', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCaptures((prev) => [data.capture, ...prev]);
      setStatus('Video saved to pipeline and attached to Mockup Studio.');
      finishRenderConsole(true, 'Video saved to pipeline and attached to Mockup Studio.');
    } catch (err) {
      setStatus(`Video failed: ${err.message}`);
      finishRenderConsole(false, `Video failed: ${err.message}`);
    } finally {
      tween?.kill?.();
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stream?.getTracks?.().forEach((track) => track.stop());
      if (worldRef.current) {
        worldRef.current.iframeWrap.style.visibility = 'visible';
        worldRef.current.controls.enabled = true;
      }
      setPlaying(false);
      setBusy(false);
    }
  }, [busy, templateId, viewportId, totalSeconds, scale, backdropId, loadedUrl, captures, requestCapture, loadScreenTexture, applyPath, user, beginRenderConsole, finishRenderConsole]);

  // Expose the client-side capture as the cloud render's hidden fallback.
  createVideoRef.current = createVideo;

  useEffect(() => {
    if (!autoVideoRequestedRef.current || !worldReady || !loadedUrl || busy || dirRendering || !user) return undefined;
    autoVideoRequestedRef.current = false;
    const timeout = window.setTimeout(() => {
      generateCloudVideo();
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [worldReady, loadedUrl, busy, dirRendering, user, generateCloudVideo]);

  // While auth resolves, render nothing — no "Opening Studio" gate flash before
  // the Studio mounts. Only block once fully resolved AND signed out.
  if (loading) return null;
  if (!user) {
    const loginHref = '/login?redirect=/dashboard/studio';
    return (
      <main style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: GLASS.bg,
        color: GLASS.ink,
        fontFamily: GLASS.sans,
      }}>
        <section style={{
          width: 'min(100%, 420px)',
          display: 'grid',
          gap: 16,
          textAlign: 'center',
          ...GLASS.surface,
          borderRadius: 12,
          padding: 24,
        }}>
          <span style={{ ...ui.label, color: GLASS.inkMute }}>
            Mockup Studio
          </span>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0 }}>
            Sign in to open Studio
          </h1>
          <p style={{ margin: 0, color: GLASS.inkSoft, fontSize: 14, lineHeight: 1.55 }}>
            Video renders are attached to your client workspace, so Studio requires a signed-in account.
          </p>
          <a href={loginHref} style={{ ...ui.navCta, textDecoration: 'none', margin: '0 auto' }}>
            Sign in
          </a>
        </section>
      </main>
    );
  }

  // Exportable artboard — the live 3D canvas IS the exported frame (WYSIWYG), so its
  // box matches the selected output format's aspect ratio. It's sized in pure CSS
  // (container-query units below) to "contain"-fit the max area of the board, so it never
  // depends on a JS measurement that can race the first paint.
  const outFormat = OUTPUT_FORMATS.find((f) => f.id === formatId) || OUTPUT_FORMATS[0];
  const oW = outFormat.w;
  const oH = outFormat.h;
  const artPadF = isNarrow ? 88 : 86; // % of the board the artboard may fill (scaled down lightly)
  // Mobile: the artboard area is height-capped, so tall formats (reel) get
  // width-starved. Grow the area height for portrait/square so the reel/square
  // can render larger in width. Capped to leave room for the controls below.
  const mobileAreaH = oH > oW ? '64vh' : oH === oW ? '54vh' : '44vh';

  return (
    <div
      id="studio-page-shell"
      style={{
        position: 'fixed', inset: 0,
        background: GLASS.wash + ', ' + GLASS.bg,
        color: GLASS.ink, fontFamily: GLASS.sans,
        display: 'flex', flexDirection: 'column', zIndex: 50,
        overflowX: 'hidden', boxSizing: 'border-box',
      }}
    >
      {/* Shared glass tooltip — same hover UI as the dashboard. Surfaces on icon-only
          controls; auto-skips elements with visible labels and any data-tooltip-disabled subtree. */}
      <GlassTooltipLayer />

      {/* Homepage nav logo, top-left corner */}
      <a href="/" aria-label="Back to homepage" style={{ position: 'absolute', top: 18, left: 20, zIndex: 20, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/circle_logo.png" alt="Bryan Balli logo" width={663} height={552} style={{ height: 'clamp(2rem, 4vw, 2.8rem)', width: 'auto', display: 'block', mixBlendMode: 'darken' }} />
      </a>

      {/* Tool switch — MOCKUP VIDEO (device scene) ⇄ HOLO PAPER (cloth sim). */}
      {tool ? (
        <div
          id="studio-tool-toggle"
          data-tooltip-disabled="true"
          style={{
            position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
            display: 'flex', gap: 4, padding: 4, borderRadius: 999,
            ...GLASS.surface,
          }}
        >
          {[['mockup', 'MOCKUP VIDEO'], ['cloth', 'HOLO PAPER']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => switchTool(id)}
              style={{ ...ui.btn(tool === id), height: 30, padding: '0 14px', fontSize: 10 }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Body — the canvas/board (with the exportable artboard on it) + the right rail.
          Stacks vertically on narrow screens; the board sits above, the UI below. */}
      <div id="studio-main-row" style={{ flex: 1, position: 'relative', minHeight: 0, display: isNarrow ? 'flex' : 'block', flexDirection: isNarrow ? 'column' : undefined }}>
        {tool === 'cloth' ? (
          <ClothStudio isNarrow={isNarrow} railW={RAIL_W} />
        ) : tool === 'mockup' ? (
        <>
        {/* Canvas/board — the page bg shows through as the board surface. Desktop:
            fills the area LEFT of the nav. Mobile: full-width top block. */}
        <div
          id="studio-board"
          style={{
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            ...(isNarrow
              ? { position: 'relative', width: '100%', flex: 'none' }
              : { position: 'absolute', left: 0, top: 0, bottom: 0, right: RAIL_W }),
          }}
        >
          {/* Export area — always fits: scales up/down with the viewport while keeping the
              output aspect ratio. Takes the space above the transport row; containerType:size
              lets the artboard contain-fit via cqw/cqh. */}
          <div
            id="studio-artboard-area"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // Consistent ~50px top margin across breakpoints — pushes the centered
              // frame down so it never hugs the top edge.
              containerType: 'size', overflow: 'visible', paddingTop: 50, boxSizing: 'border-box',
              ...(isNarrow ? { height: mobileAreaH, flex: 'none' } : { flex: 1, minHeight: 0 }),
            }}
          >
            {/* Exportable artboard — largest box of ratio oW:oH that fits artPadF% of the
                area. The canvas IS the exported frame (WYSIWYG). */}
            <div
              id="studio-artboard"
              style={{
                width: `min(${artPadF}cqw, calc(${artPadF}cqh * ${oW} / ${oH}))`,
                aspectRatio: `${oW} / ${oH}`,
                position: 'relative',
                borderRadius: 16, overflow: 'visible', background: '#0b0b0f',
                border: '1px solid rgba(255,255,255,0.6)',
                boxShadow: '0 18px 60px rgba(20,20,30,0.22), 0 2px 10px rgba(0,0,0,0.10)',
              }}
            >
              <div id="studio-stage-shell" ref={stageRef} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} />
              {/* Export size chip — hidden on mobile (collides with the corner logo). */}
              <div style={{
                position: 'absolute', top: -40, left: 10, zIndex: 6, pointerEvents: 'none',
                ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.5)',
                padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
                display: isNarrow ? 'none' : 'block',
              }}>Output · {oW}×{oH}</div>
              {/* Camera mode toggle — Orbit ⇄ Interact; sits left of refresh */}
              <button
                id="studio-export-orbit"
                onClick={() => setInteractMode((v) => !v)}
                title={interactMode ? 'Interact with the live site' : 'Orbit the camera'}
                style={{
                  position: 'absolute', top: -40, right: 48, zIndex: 6,
                  width: 30, height: 30, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', cursor: 'pointer',
                  color: '#fff', background: interactMode ? 'rgba(99,102,241,0.85)' : 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                }}
              >
                {interactMode ? <MousePointer2 size={15} strokeWidth={2.5} /> : <Orbit size={16} strokeWidth={2.5} />}
              </button>
              {/* Refresh site — top-right, opposite the size chip */}
              <button
                id="studio-export-refresh"
                onClick={() => { const w = worldRef.current; if (w?.iframe && loadedUrl) w.iframe.src = loadedUrl; }}
                title="Refresh site"
                style={{
                  position: 'absolute', top: -40, right: 10, zIndex: 6,
                  width: 30, height: 30, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', cursor: 'pointer',
                  color: '#fff', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                }}
              >
                <RefreshCw size={15} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Under-canvas controls — transport + timeline scrubber, directly below the
              export area (moved here from the right rail). */}
          <div id="studio-under-canvas-controls" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 14px', flexShrink: 0 }}>
            {/* One row: sizes pinned left | player controls centered | orbit + CTAs pinned right.
                Equal-flex side groups keep the player controls dead-center. */}
            <div className="studio-undercanvas-row" style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 0 }}>
              {/* Device sizes — pinned left */}
              <div id="studio-device-panel" className="studio-sizes-group" data-tooltip-disabled="true" style={{ display: 'flex', gap: 12, flex: 1, justifyContent: 'flex-start' }}>
                {Object.keys(VIEWPORTS).map((id) => {
                  const active = viewportId === id;
                  const DeviceIcon = DEVICE_ICONS[id] || Monitor;
                  return (
                    <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                      <button
                        title={VIEWPORTS[id].label}
                        onClick={() => setViewportId(id)}
                        className={'studio-rail-card' + (active ? ' studio-rail-card--active' : '')}
                        style={{ width: 46, height: 46, borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}
                      >
                        <DeviceIcon size={20} strokeWidth={2} color={active ? '#6366f1' : GLASS.ink} />
                      </button>
                      <span className="studio-ctrl-label" style={{ ...ui.label, fontSize: 8, color: active ? GLASS.ink : GLASS.inkMute }}>{VIEWPORTS[id].label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Player controls — centered (loop / stop / reset) */}
              <div className="studio-playhead-group" data-tooltip-disabled="true" style={{ display: 'flex', gap: 14 }}>
                {[
                  { key: 'loop', label: 'Play', icon: <Play size={17} fill="currentColor" />, onClick: playLoop, active: playing, disabled: keyframes.length < 2 },
                  { key: 'stop', label: 'Stop', icon: <Square size={15} fill="currentColor" />, onClick: stopTimeline, active: false, disabled: !playing },
                  { key: 'reset', label: 'Reset', icon: <RotateCcw size={16} strokeWidth={2.5} />, onClick: resetPlayback, active: false, disabled: false },
                ].map((b) => (
                  <div key={b.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                    <button
                      title={b.label}
                      disabled={b.disabled}
                      onClick={b.onClick}
                      style={{
                        width: 46, height: 46, borderRadius: '50%',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        // Active → gradient hairline border; inactive → plain grey/glass.
                        border: '1px solid ' + (b.active ? 'transparent' : GLASS.hair),
                        background: b.active ? 'linear-gradient(#fff,#fff) padding-box, ' + GLASS.accent + ' border-box' : 'rgba(255,255,255,0.6)',
                        color: GLASS.ink,
                        boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                        cursor: b.disabled ? 'default' : 'pointer',
                        opacity: b.disabled ? 0.4 : 1,
                        transition: 'background 0.18s ease, color 0.18s ease',
                      }}
                    >
                      {b.icon}
                    </button>
                    <span className="studio-ctrl-label" style={{ ...ui.label, fontSize: 8 }}>{b.label}</span>
                  </div>
                ))}
              </div>

              {/* Primary actions + orbit toggle — pinned right; orbit on the far right */}
              <div className="studio-right-group" style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
                {/* Render Scene + Save as Template — top-aligned with the icon buttons
                    (shifted up by the label height the other groups carry below their icons) */}
                <div id="studio-undercanvas-actions" style={{ display: 'flex', alignSelf: 'flex-start', alignItems: 'center', gap: 8, height: 46 }}>
                  <button
                    style={{ ...ui.navBtn(), width: 'auto', opacity: keyframes.length < 2 ? 0.5 : 1 }}
                    disabled={keyframes.length < 2}
                    onClick={saveAsTemplate}
                  >
                    <span className="studio-cta-full">Save</span><span className="studio-cta-short">Save</span><Save className="studio-cta-icon" size={15} strokeWidth={2.5} />
                  </button>
                  <button className="cta-pill-btn" style={{ ...ui.navCta, width: 'auto', opacity: (busy || dirRendering) ? 0.5 : 1 }} disabled={busy || dirRendering} onClick={generateCloudVideo}>
                    <span className="studio-cta-full">Render</span><span className="studio-cta-short">Render</span><UpRightArrow size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* Timeline transport + scrubber */}
            <div id="studio-timeline-transport" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {/* Double-click empty track to add a key, double-click a key to remove it;
                  drag the playhead ball to scrub. */}
              <div id="studio-timeline-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                id="studio-timeline-track"
                ref={trackRef}
                onPointerDown={onTrackPointerDown}
                onPointerMove={onTrackPointerMove}
                onPointerUp={onTrackPointerUp}
                style={{ flex: 1, position: 'relative', height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.7)', border: '1px solid ' + GLASS.hair, cursor: playing ? 'default' : 'pointer', touchAction: 'none', userSelect: 'none', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)' }}
              >
                <div style={{ position: 'absolute', left: TL_PAD, top: 0, bottom: 0, width: `calc(${scrubVal} * (100% - ${TL_PAD * 2}px))`, background: 'rgba(236,72,153,0.14)', borderRadius: 999, pointerEvents: 'none' }} />
                {/* Playhead — bold pink line; ONLY the top ball is interactive (drag to scrub). */}
                <div style={{ position: 'absolute', left: tlLeft(scrubVal), top: -3, bottom: -3, width: 3, marginLeft: -1.5, background: '#ec4899', borderRadius: 999, boxShadow: '0 0 0 1px rgba(255,255,255,0.85)', pointerEvents: 'none', zIndex: 4 }}>
                  <div
                    onPointerDown={onPlayheadPointerDown}
                    onPointerMove={onPlayheadPointerMove}
                    onPointerUp={onPlayheadPointerUp}
                    title="Drag to scrub — snaps to keyframes"
                    style={{
                      position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                      width: 22, height: 22, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: playing ? 'none' : 'auto', touchAction: 'none', cursor: 'grab', zIndex: 5,
                    }}
                  >
                    <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#ec4899', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px #fff', pointerEvents: 'none' }} />
                  </div>
                </div>
                {keyframes.map((k) => (
                  <div
                    key={k.id}
                    data-key-id={k.id}
                    title={`${(k.t * totalSeconds).toFixed(1)}s — drag to retime, double-click to remove`}
                    style={{
                      position: 'absolute', left: tlLeft(k.t), top: '50%',
                      width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5,
                      transform: 'rotate(45deg)',
                      background: selectedKeyId === k.id ? GLASS.ink : '#fff',
                      border: '1px solid ' + (selectedKeyId === k.id ? '#fff' : GLASS.inkMute),
                      borderRadius: 2, boxShadow: '0 1px 2px rgba(0,0,0,0.15)', cursor: 'grab',
                    }}
                  />
                ))}
              </div>
              {/* Duration — inline numeric field, right of the keyframe track; mirrors the
                  Export card's DURATION select so users can read/retime without opening the rail. */}
              <div id="studio-duration-field" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <input
                  type="number" min={1} max={60} value={totalSeconds}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setTotalSeconds(v); }}
                  title="Timeline duration (seconds)"
                  style={{ width: 54, height: 32, textAlign: 'center', borderRadius: 10, border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.7)', color: GLASS.ink, fontFamily: GLASS.mono, fontSize: 13, padding: '0 4px' }}
                />
                <span style={{ ...ui.label, color: GLASS.inkMute }}>S</span>
              </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right rail — floats over the canvas; cards are their own frosted
            surfaces (no enclosing box / border). */}
        <div
          id="studio-rail"
          data-tooltip-disabled="true"
          style={{
            // border-box so width:100% (mobile) / RAIL_W (desktop) INCLUDES the padding —
            // otherwise the rail + cards overflow the viewport / the board's reserved strip.
            boxSizing: 'border-box', maxWidth: '100%',
            display: 'flex', flexDirection: 'column', overflow: 'visible',
            background: 'transparent',
            ...(isNarrow
              ? { position: 'relative', width: '100%', flex: 1, minHeight: 0, padding: 12 }
              : { position: 'absolute', top: 0, right: 0, bottom: 0, width: RAIL_W, padding: 14, zIndex: 10 }),
          }}
        >
          {/* Rail-card states ported verbatim from DashboardPage.jsx .capability-nav-btn —
              static / :hover / --active share the dashboard's exact bg, box-shadow, transform,
              gradient-hairline ::before, and cubic-bezier timing. Only addition: backdrop-blur
              on the card (the rail itself is now transparent over the 3D stage, so each card
              carries its own frosting for legibility — not a state animation). */}
          <style id="studio-rail-card-styles">{`
            /* Every rail element honors its width incl. padding/border, so nothing
               (cards, header buttons, inputs) overflows the viewport on small screens. */
            #studio-rail, #studio-rail * { box-sizing: border-box; }
            .studio-rail-card {
              position: relative;
              border-radius: 1rem;
              overflow: hidden;
              background: rgba(255, 255, 255, 0.35);
              backdrop-filter: blur(20px);
              -webkit-backdrop-filter: blur(20px);
              box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
              transform: scale(1) translateY(0);
              transition:
                background 0.55s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.55s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
              will-change: transform;
            }
            @media (prefers-reduced-motion: reduce) {
              .studio-rail-card { transition: none; }
            }
            .studio-rail-card::before {
              content: '';
              position: absolute;
              inset: 0;
              border-radius: 1rem;
              padding: 1px;
              background: rgba(176,176,182,0.6); /* even grey glass hairline (inactive); active/hover swap to the color gradient */
              -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
              -webkit-mask-composite: xor;
              mask-composite: exclude;
              pointer-events: none;
              opacity: 0.85;
              transition: opacity 0.45s ease;
              z-index: 0;
            }
            .studio-rail-card:hover {
              background: rgba(255, 255, 255, 1);
              box-shadow:
                0px 6px 14px rgba(0,0,0,0.06),
                0px 18px 36px rgba(0,0,0,0.06),
                0px 28px 56px rgba(0,0,0,0.09),
                inset 0 1px 0 rgba(255,255,255,0.55);
              transform: scale(1.02) translateY(-2px);
              transition:
                background 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .studio-rail-card:hover::before {
              background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
              opacity: 1;
            }
            .studio-rail-card:hover .studio-rail-card-content {
              transform: translateX(5px);
              transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .studio-rail-card:hover .studio-rail-card-icon {
              transform: scale(1.12);
              transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .studio-rail-card--active {
              background: rgba(255, 255, 255, 1);
              box-shadow:
                0px 6px 14px rgba(0,0,0,0.06),
                0px 18px 36px rgba(0,0,0,0.06),
                0px 28px 56px rgba(0,0,0,0.09),
                inset 0 1px 0 rgba(255,255,255,0.55);
              transition:
                background 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.15s,
                box-shadow 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.15s,
                transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s;
            }
            .studio-rail-card--active::before {
              background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
              opacity: 1;
            }
            .studio-rail-card-content {
              position: relative;
              z-index: 1;
              transform: translateX(0);
              transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .studio-rail-card-icon {
              transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .studio-rail-card-btn { position: relative; z-index: 1; }

            /* ── Under-canvas controls — responsive ──────────────────────── */
            /* Default (desktop): full CTA text, short/icon hidden. */
            .studio-cta-short, .studio-cta-icon { display: none; }
            .studio-cta-icon { align-items: center; justify-content: center; }

            /* Medium: shorten CTA text → "Render" / "Save". */
            @media (max-width: 1024px) {
              .studio-cta-full { display: none; }
              .studio-cta-short { display: inline; }
            }

            /* Small: playhead alone on the top row; sizes (left) + actions/orbit
               (right) wrap onto a single row below it. */
            @media (max-width: 820px) {
              .studio-undercanvas-row { flex-wrap: wrap; }
              .studio-playhead-group { order: -1; width: 100%; justify-content: center; }
              .studio-sizes-group { order: 0; }
              .studio-right-group { order: 1; }
            }

            /* X-small / mobile: icon-only CTAs (arrow for render, save icon for
               template), drop all control labels, let the strip scroll. */
            @media (max-width: 560px) {
              .studio-cta-full, .studio-cta-short { display: none; }
              .studio-cta-icon { display: inline-flex; }
              .studio-ctrl-label { display: none; }
              /* Render + Save → icon-only circles (1:1), matching the player
                 controls — not stretched pills. Overrides the inline width:auto
                 + navBtn/navCta padding & 999px radius. */
              #studio-undercanvas-actions > button {
                width: 46px !important; min-width: 46px !important; height: 46px !important;
                padding: 0 !important; border-radius: 50% !important; flex-shrink: 0;
              }
              #studio-under-canvas-controls { overflow-y: auto; -webkit-overflow-scrolling: touch; }
              /* Device sizes: bare icons (no card box/border/white bg, tighter) so
                 landscape/square/reel sit close together. Active = icon color only.
                 !important overrides the inline width/height/gap on these buttons. */
              #studio-device-panel { gap: 4px !important; }
              #studio-device-panel .studio-rail-card {
                width: 34px !important; height: 34px !important; border-radius: 8px !important;
                background: transparent !important; box-shadow: none !important;
                backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
              }
              #studio-device-panel .studio-rail-card::before { border-radius: 8px !important; }
            }
          `}</style>

          {/* Inner column — margin:auto vertically centers the cards in the
              viewport when short, and lets the rail scroll when they're tall. */}
          <div id="studio-rail-inner" style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>

          {/* SIZE — output format (landscape / square / reel). Reshapes the exportable
              artboard on the canvas and the rendered output. Now its own collapsible nav card;
              the 3 tiles are the card body. */}
          <RailCard
            id="studio-size-panel" icon={<RectangleHorizontal size={18} strokeWidth={2} />} title="Size"
            subtitle={OUTPUT_FORMATS.find((f) => f.id === formatId)?.label || 'Output format'}
            color="#8b5cf6" open={sizeOpen} onToggle={() => setSizeOpen((v) => !v)}
          >
            <div id="studio-format-panel" style={{ display: 'flex', gap: 8 }}>
              {OUTPUT_FORMATS.map((f) => {
                const active = formatId === f.id;
                const FormatIcon = f.Icon;
                return (
                  <button
                    key={f.id}
                    title={`${f.label} · ${f.w}×${f.h}`}
                    onClick={() => setFormatId(f.id)}
                    className={'studio-rail-card' + (active ? ' studio-rail-card--active' : '')}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                      padding: '12px 0', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <FormatIcon size={20} strokeWidth={2} color={active ? '#6366f1' : GLASS.ink} />
                    <span style={{ ...ui.label, fontSize: 8, color: active ? GLASS.ink : GLASS.inkMute }}>{f.label}</span>
                  </button>
                );
              })}
            </div>
          </RailCard>

          {/* BACKGROUND — immersive scene background (color / image / site / scene) */}
          <RailCard
            id="studio-background-panel" icon={<Palette size={18} strokeWidth={2} />} title="Background"
            subtitle={{ color: 'Solid color', image: 'Custom image', site: 'Blurred site', env: 'Real-world scene' }[bgMode] || 'Scene background'}
            color="#f59e0b" open={backgroundOpen} onToggle={() => setBackgroundOpen((v) => !v)}
          >
            {/* Mode selector */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {BACKGROUND_MODES.filter((mode) => mode.launch).map(({ id: m, label }) => (
                <button
                  key={m}
                  style={{ ...ui.btn(bgMode === m), height: 30, padding: '0 12px', fontSize: 10 }}
                  onClick={() => { if (m === 'site') { useSiteBackground(); } else { setBgMode(m); } }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Real-world scene presets */}
            {bgMode === 'env' ? (
              <>
                <span style={ui.label}>ENVIRONMENT</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[['airport-terminal', 'Airport'], ['desk', 'Desk'], ['studio', 'Studio'], ['loft', 'Loft'], ['sunset', 'Sunset']].map(([id, label]) => (
                    <button key={id} style={{ ...ui.btn(envPreset === id), height: 30, padding: '0 12px', fontSize: 10 }} onClick={() => setEnvPreset(id)}>{label}</button>
                  ))}
                </div>
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Real-world lighting — drives reflections on the device for a true-3D feel.</span>
              </>
            ) : null}

            {/* Solid color picker */}
            {bgMode === 'color' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} style={{ width: 44, height: 32, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
                <span style={{ ...ui.label }}>Background color</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{bgColor}</span>
              </label>
            ) : null}

            {/* Image upload */}
            {bgMode === 'image' ? (
              <>
                <label style={{ ...ui.btn(), width: '100%', cursor: 'pointer' }}>
                  <Download size={14} strokeWidth={2.5} style={{ marginRight: 6, transform: 'rotate(180deg)' }} />
                  {bgImageEl ? 'Replace image' : 'Upload image'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const img = new Image();
                    img.onload = () => { setBgImageEl(img); setBgMode('image'); };
                    img.src = URL.createObjectURL(f);
                  }} />
                </label>
                {!bgImageEl ? <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>Upload an image to wrap the scene + drive reflections.</span> : null}
              </>
            ) : null}

            {/* Site blurred */}
            {bgMode === 'site' ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Uses a blurred frame of the loaded site as the backdrop.</span>
            ) : null}

            {/* Color grade — applies to every mode */}
            <span style={{ ...ui.label, marginTop: 4 }}>COLOR GRADE</span>
            {[
              { key: 'hue', label: 'HUE SHIFT', min: 0, max: 360, step: 1, value: hue, set: setHue, fmt: (v) => `${v}°` },
              { key: 'sat', label: 'SATURATION', min: 0, max: 2, step: 0.05, value: sat, set: setSat, fmt: (v) => `${Math.round(v * 100)}%` },
              { key: 'bright', label: 'BRIGHTNESS', min: 0.4, max: 1.6, step: 0.05, value: bright, set: setBright, fmt: (v) => `${Math.round(v * 100)}%` },
            ].map((s) => (
              <label key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>{s.label}<span style={{ color: GLASS.ink }}>{s.fmt(s.value)}</span></span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={s.value} onChange={(e) => s.set(Number(e.target.value))} style={{ width: '100%', accentColor: GLASS.ink }} />
              </label>
            ))}
            <button style={{ ...ui.btn(), width: '100%' }} onClick={() => { setHue(0); setSat(1); setBright(1); }}>Reset grade</button>
          </RailCard>

          {/* ENVIRONMENT — animated loop element */}
          <RailCard
            id="studio-env-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Environment" subtitle="Animated loop element"
            color="#14b8a6" open={envOpen} onToggle={() => setEnvOpen((v) => !v)}
          >
            <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              LOOP ELEMENT
              <button style={{ ...ui.btn(loopCfg.on), height: 28, padding: '0 12px', fontSize: 10 }} onClick={() => setLoopCfg((c) => ({ ...c, on: !c.on }))}>
                {loopCfg.on ? 'On' : 'Off'}
              </button>
            </span>
            {[
              { key: 'size',    label: 'SIZE',     min: 0.2,   max: 4,    step: 0.05, fmt: (v) => `${v.toFixed(2)}x` },
              { key: 'x',       label: 'HORIZONTAL', min: -2500, max: 2500, step: 10, fmt: (v) => `${v}` },
              { key: 'y',       label: 'VERTICAL',   min: -1800, max: 1800, step: 10, fmt: (v) => `${v}` },
              { key: 'z',       label: 'DEPTH',      min: -6000, max: -200, step: 20, fmt: (v) => `${v}` },
              { key: 'opacity', label: 'OPACITY',    min: 0,     max: 1,    step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
            ].map((s) => (
              <label key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: loopCfg.on ? 1 : 0.4 }}>
                <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>{s.label}<span style={{ color: GLASS.ink }}>{s.fmt(loopCfg[s.key])}</span></span>
                <input
                  type="range" min={s.min} max={s.max} step={s.step} value={loopCfg[s.key]}
                  disabled={!loopCfg.on}
                  onChange={(e) => { const v = Number(e.target.value); setLoopCfg((c) => ({ ...c, [s.key]: v })); }}
                  style={{ width: '100%', accentColor: GLASS.ink }}
                />
              </label>
            ))}
          </RailCard>

          {/* DIRECTOR */}
          <RailCard
            id="studio-director-panel" icon={<Clapperboard size={18} strokeWidth={2} />} title="Director" subtitle="Cloud GPU render"
            color="#6366f1" open={directorOpen} onToggle={() => setDirectorOpen((v) => !v)}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>CAMERA MOVE</span>
              <select value={dirPreset} onChange={(e) => setDirPreset(e.target.value)} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
                {DIRECTOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>

            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={ui.label}>LENGTH</span>
                <select value={dirSeconds} onChange={(e) => setDirSeconds(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
                  {[4, 6, 8, 10, 12].map((s) => <option key={s} value={s}>{s}S</option>)}
                </select>
              </label>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={ui.label}>FPS</span>
                <select value={dirFps} onChange={(e) => setDirFps(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
                  {[24, 30].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>

            {/* Output size/format is chosen by the format selector at the top of the rail. */}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>SITE SPEED<span style={{ color: GLASS.ink }}>{dirSiteSpeed.toFixed(2)}x</span></span>
              <input type="range" min={0.25} max={4} step={0.05} value={dirSiteSpeed} onChange={(e) => setDirSiteSpeed(Number(e.target.value))} style={{ width: '100%', accentColor: GLASS.ink }} />
            </label>

            <span style={{ ...ui.label, color: GLASS.ink, marginTop: 4 }}>SCROLL TARGET</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {['none', 'selector', 'text', 'percent'].map((m) => (
                <button key={m} style={{ ...ui.btn(dirScrollMode === m), height: 30, padding: '0 12px', fontSize: 10 }} onClick={() => setDirScrollMode(m)}>
                  {m === 'none' ? 'None' : m === 'selector' ? 'Section' : m === 'text' ? 'Text' : '%'}
                </button>
              ))}
            </div>

            {dirScrollMode === 'selector' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button style={{ ...ui.btn(), width: '100%', opacity: dirMapping ? 0.5 : 1 }} disabled={dirMapping} onClick={mapSections}>
                  {dirMapping ? 'Mapping…' : 'Map sections'}
                </button>
                {dirSelector ? <span style={{ ...ui.label, color: GLASS.ink }}>→ {dirSelector}</span> : null}
                {dirSections.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto', border: '1px solid ' + GLASS.hair, borderRadius: 10, padding: 5 }}>
                    {dirSections.map((s, i) => (
                      <button
                        key={`${s.selector}-${i}`}
                        onClick={() => setDirSelector(s.selector)}
                        title={s.label || s.selector}
                        style={{ ...ui.btn(dirSelector === s.selector), height: 30, padding: '0 10px', fontSize: 10, justifyContent: 'flex-start', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.01em' }}
                      >
                        {s.pct}% {s.media ? '🎬 ' : ''}{s.selector}{s.label ? ` — ${s.label}` : ''}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {dirScrollMode === 'text' ? (
              <input value={dirText} onChange={(e) => setDirText(e.target.value)} placeholder="visible text e.g. show reel" style={{ ...ui.input, fontSize: 12 }} />
            ) : null}

            {dirScrollMode === 'percent' ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>POSITION<span style={{ color: GLASS.ink }}>{dirPercent}%</span></span>
                <input type="range" min={0} max={100} step={1} value={dirPercent} onChange={(e) => setDirPercent(Number(e.target.value))} style={{ width: '100%', accentColor: GLASS.ink }} />
              </label>
            ) : null}

            <button
              style={{ ...ui.cta, marginTop: 6, width: '100%', opacity: dirRendering ? 0.5 : 1 }}
              disabled={dirRendering}
              onClick={generateCloudVideo}
            >
              {dirRendering ? 'Rendering…' : 'Generate · Cloud GPU'}
            </button>
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Renders the live site loading + animating inside the device on a real GPU. Needs the render host configured.</span>

            {isAdmin && (
              <div id="studio-signup-default-shell" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + GLASS.hair, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={ui.label}>NEW-SIGNUP DEFAULT</span>
                <button
                  style={{ ...ui.btn(), width: '100%', opacity: savingSignupDefault ? 0.5 : 1 }}
                  disabled={savingSignupDefault}
                  onClick={saveSignupDefault}
                  title="Save the current recipe as the video template every new signup renders from"
                >
                  {savingSignupDefault ? 'Saving…' : 'Set as new-signup default'}
                </button>
                <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.4, color: GLASS.inkMute }}>
                  {signupDefaultMeta
                    ? (signupDefaultMeta.source === 'custom'
                        ? `Current: custom template${signupDefaultMeta.updatedAt ? ' · ' + new Date(signupDefaultMeta.updatedAt).toLocaleDateString() : ''}`
                        : 'Current: built-in default')
                    : 'Applies this shot to every new signup’s onboarding video.'}
                </span>
              </div>
            )}
          </RailCard>

          {/* EXPORT — capture/render controls merged with the timeline (duration + template). */}
          <RailCard
            id="studio-export-panel" icon={<Download size={18} strokeWidth={2} />} title="Export"
            subtitle={`Stills, video · ${keyframes.length} keys · ${totalSeconds}s`}
            color="#10b981" open={exportMenuOpen} onToggle={() => setExportMenuOpen((v) => !v)}
            badge={playing ? (
              <span style={{ ...ui.label, color: '#fff', background: '#ec4899', padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>▶</span>
            ) : null}
          >
            {/* Timeline — duration + camera template */}
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={ui.label}>DURATION</span>
                <select value={totalSeconds} onChange={(e) => setTotalSeconds(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none', width: '100%' }} title="Total timeline duration">
                  <option value={3}>3S</option><option value={6}>6S</option><option value={10}>10S</option><option value={15}>15S</option><option value={20}>20S</option>
                </select>
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>TEMPLATE</span>
              <select
                id="studio-camera-template-select"
                value={templateId}
                onChange={(e) => { const v = e.target.value; if (v.startsWith('custom-')) applyCustomTemplate(v); else setTemplateId(v); }}
                style={{ ...ui.btn(!!templateId), appearance: 'none', width: '100%' }}
                title="Camera animation templates — 8 keyframes, scaled to the active device"
              >
                <option value="">Template…</option>
                {CAMERA_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{`${t.label} · ${t.theme} · ${t.intensity}`}</option>
                ))}
                {customTemplates.length > 0 ? (
                  <optgroup label="SAVED">
                    {customTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </label>

            {/* Stills / video export */}
            <span style={{ ...ui.label, marginTop: 4 }}>OUTPUT</span>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={ui.label}>CAPTURE DENSITY</span>
              <select value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none', width: '100%' }} title="deviceScaleFactor">
                <option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkSoft }}>
              <input type="checkbox" checked={fullPage} onChange={(e) => setFullPage(e.target.checked)} style={{ accentColor: GLASS.ink }} /> Full page
            </label>
            <button style={{ ...ui.btn(), width: '100%', opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={captureHiRes}>Capture hi-res</button>
            <button style={{ ...ui.btn(), width: '100%', opacity: (busy || dirRendering) ? 0.5 : 1 }} disabled={busy || dirRendering} onClick={generateCloudVideo}>Create video</button>
          </RailCard>

          {/* CAPTURES */}
          <RailCard
            id="studio-captures-panel" icon={<Images size={18} strokeWidth={2} />} title="Captures" subtitle="Shots & videos"
            color="#0ea5e9" open={capturesOpen} onToggle={() => setCapturesOpen((v) => !v)}
            badge={captures.length ? (
              <span style={{ ...ui.label, color: '#fff', background: GLASS.ink, padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>{captures.length}</span>
            ) : null}
          >
            {captures.map((c, i) => {
              const isVideo = c.type === 'studio_video' || String(c.contentType || '').startsWith('video/');
              return (
                <div key={c.storagePath || i} style={{ border: '1px solid ' + GLASS.hair, borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.5)' }}>
                  {isVideo ? (
                    <video src={c.downloadUrl} controls muted playsInline preload="metadata" style={{ width: '100%', display: 'block', maxHeight: 140, objectFit: 'cover', background: '#000' }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.downloadUrl} alt={c.viewportLabel || c.label || 'capture'} style={{ width: '100%', display: 'block', maxHeight: 140, objectFit: 'cover', background: '#000' }} />
                  )}
                  <div style={{ padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ ...ui.label, color: GLASS.inkSoft }}>{c.viewportLabel || c.label || c.variant}</span>
                    <a href={c.downloadUrl} target="_blank" rel="noreferrer" style={{ ...ui.btn(), height: 28, padding: '0 12px', fontSize: 10, textDecoration: 'none' }}>Open</a>
                  </div>
                </div>
              );
            })}
            {!captures.length ? <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute }}>No captures yet.</span> : null}
          </RailCard>

          </div>
        </div>
        </>
        ) : null}
      </div>

      {/* ── Render console — client-side terminal, reuses the dashboard terminal's
          One Dark look. Closeable + non-blocking: dismissing it does NOT stop the
          render (it's plain JS already running); the toast reports the outcome. ── */}
      {renderConsoleOpen ? (
        <div
          id="studio-render-console"
          role="dialog"
          aria-modal="false"
          aria-label="Render progress"
          onClick={(e) => { if (e.target === e.currentTarget) setRenderConsoleOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'clamp(1rem, 5vw, 2rem)', boxSizing: 'border-box',
            background: 'rgba(10,10,16,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <style>{`
            @keyframes srt-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
            @keyframes srt-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
            #studio-render-console .srt-line { display: grid; grid-template-columns: 4.2rem 1fr; gap: 0.5em; font-family: "Space Mono", monospace; font-size: 0.68rem; line-height: 1.65; align-items: baseline; }
            #studio-render-console .srt-pfx { text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-size: 0.64rem; letter-spacing: 0.02em; }
            #studio-render-console .srt-msg { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
            #studio-render-console .srt-line { color: var(--term-fg); }
            #studio-render-console .srt-active .srt-pfx { color: var(--term-active-pfx); }
            #studio-render-console .srt-active .srt-msg { color: var(--term-active-msg); font-weight: 700; }
            #studio-render-console .srt-ok .srt-pfx { color: var(--term-ok-pfx); }
            #studio-render-console .srt-ok .srt-msg { color: var(--term-ok-msg); }
            #studio-render-console .srt-error .srt-pfx { color: var(--term-error-pfx); }
            #studio-render-console .srt-error .srt-msg { color: var(--term-error-msg); }
            #studio-render-console .srt-dim .srt-pfx, #studio-render-console .srt-dim .srt-msg { color: var(--term-dim); }
            #studio-render-console .srt-caret { display: inline-block; width: 0.45em; height: 0.95em; background: var(--term-caret); vertical-align: text-bottom; margin-left: 2px; animation: srt-blink 1s step-start infinite; }
          `}</style>

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative', width: '100%', maxWidth: '40rem',
              padding: 'clamp(1.1rem, 4vw, 1.6rem)', borderRadius: 10, boxSizing: 'border-box',
              background: '#ffffff',
              boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15)',
              border: '1px solid rgba(255,255,255,0.5)',
            }}
          >
            {/* Brand row — logo + brand + close, exactly like the dashboard RUN modal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'space-between' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/img/circle_logo.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: '2.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.35)', display: 'block' }} />
              <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>Mockup Video</span>
              <button
                type="button"
                id="studio-render-console-close"
                onClick={() => setRenderConsoleOpen(false)}
                aria-label="Close render console"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: '"Space Mono", monospace', fontSize: '0.8rem', color: 'rgba(42,36,32,0.55)', letterSpacing: '0.06em' }}
              >[ ✕ ]</button>
            </div>

            {/* Marquee — big Doto, same phrasing/scale as the RUN modal */}
            <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', animation: 'srt-marquee 18s linear infinite', willChange: 'transform' }}>
                {['a', 'b'].map((k) => (
                  <span key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ margin: 0, flexShrink: 0, whiteSpace: 'nowrap', color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 7rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: '"Doto", "Space Mono", monospace', fontWeight: 700 }}>{'RENDERING MOCKUP VIDEO · '.repeat(2)}</span>
                ))}
              </div>
            </div>

            {/* Terminal */}
            <div style={{ background: 'var(--term-bg)', border: '1px solid var(--term-border)', borderTop: '1px solid var(--term-border-top)', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--term-shadow)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--term-titlebar-border)', background: 'var(--term-titlebar-bg)' }}>
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(255,95,86,0.65)' }} />
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(255,189,46,0.65)' }} />
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(39,201,63,0.65)' }} />
                <span style={{ flex: 1, textAlign: 'center', fontFamily: '"Space Mono", monospace', fontSize: '0.62rem', letterSpacing: '0.08em', color: 'var(--term-title-fg)' }}>render.process</span>
              </div>
              <div
                ref={renderLogRef}
                style={{ padding: '0.7rem 0.85rem 0.8rem', height: '11rem', maxHeight: '40vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}
              >
                {renderLog.length === 0 ? (
                  <div className="srt-line srt-dim"><span className="srt-pfx">RENDER</span><span className="srt-msg">Starting…</span></div>
                ) : renderLog.map((line, i) => (
                  <div key={`srl-${i}`} className={`srt-line srt-${line.type}`}>
                    <span className="srt-pfx">{line.prefix}</span>
                    <span className="srt-msg">{line.text}</span>
                    {line.cursor ? <span className="srt-caret" /> : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer — host (left) + Open Video link on success, like the RUN modal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontFamily: '"Space Mono", monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.32)', marginTop: '0.9rem', borderTop: '1px solid rgba(212,196,171,0.4)', paddingTop: '0.7rem' }}>
              <span>{renderHost || ' '}</span>
              {renderPhase === 'done' && renderVideoUrl ? (
                <a href={renderVideoUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', textDecoration: 'underline', color: '#2a2420', fontFamily: '"Space Mono", monospace', fontSize: '0.72rem', textTransform: 'none', letterSpacing: 0 }}>Open Video <UpRightArrow style={{ marginLeft: '0.15rem', opacity: 0.82 }} /></a>
              ) : (
                <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: '0.02em' }}>
                  {renderPhase === 'failed' ? 'Render failed — close and try again.' : 'Rendering on GPU — saves to your assets.'}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Render outcome toast — mirrors the dashboard #run-error-toast pattern ── */}
      {renderToast ? (
        <div
          id="studio-render-toast"
          data-type={renderToast.type}
          role={renderToast.type === 'error' ? 'alert' : 'status'}
          aria-live={renderToast.type === 'error' ? 'assertive' : 'polite'}
          style={{
            position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, maxWidth: '24rem',
            display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem 1rem', borderRadius: 10,
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.12)',
            fontFamily: '"Space Mono", monospace', fontSize: '0.72rem', lineHeight: 1.4, letterSpacing: '0.02em',
            background: renderToast.type === 'error' ? 'rgba(255,250,248,0.92)' : 'rgba(248,255,250,0.94)',
            border: '1px solid ' + (renderToast.type === 'error' ? 'rgba(215,25,33,0.32)' : 'rgba(33,150,83,0.32)'),
            color: renderToast.type === 'error' ? 'rgba(150,22,28,0.92)' : 'rgba(22,110,60,0.95)',
          }}
        >
          <span style={{ flexShrink: 0, marginTop: '0.35rem', width: '0.5rem', height: '0.5rem', borderRadius: 999, background: renderToast.type === 'error' ? '#d71921' : '#2f9e44' }} />
          <span>{renderToast.text}</span>
          <button
            type="button"
            onClick={() => setRenderToast(null)}
            aria-label="Dismiss"
            style={{ flexShrink: 0, marginLeft: '0.25rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', color: 'inherit', opacity: 0.6 }}
          >✕</button>
        </div>
      ) : null}

    </div>
  );
}
