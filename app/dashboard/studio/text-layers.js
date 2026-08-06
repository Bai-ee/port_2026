// Studio Hero Text Builder — Phase 1 pure logic (schema, sanitizer, Google
// Font catalog, frame-relative layout math, text-canvas layout spec). See
// docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md for the full plan;
// this module is the "Locked Design Decision #7" pure module, same tier as
// diffusion-focus.js — no React, no DOM, no three.js import. Every
// DOM-dependent input (canvas text measurement) is dependency-injected via a
// `measure(text, fontString) -> px` function so this file stays testable
// under plain node:test with zero browser/WebGL context.
//
// This file's exported names are a CONTRACT: two other agents are wiring
// ClothStudio.jsx (overlay scene/plane/texture lifecycle, render-loop
// compositing) and components/StudioHeroTextCard.jsx (the HERO TEXT card UI)
// against this exact API in parallel. Do not rename exports.
//
// Two coordinate systems matter here and must not be conflated:
//   1. Frame-relative layout (anchorX/anchorY/sizePct/maxWidthPct) — 0..1 or
//      %-of-frame-rect values, resolved against `resolveFrameRect`'s output
//      (CSS px, origin top-left, +y down — the same convention
//      ClothStudio.jsx's `computeFrameRect` already uses for the capture
//      frame). This is what makes one authored hero re-anchor correctly when
//      the user switches capture frame (square -> vertical, etc.) instead of
//      needing per-frame re-authoring.
//   2. The overlay THREE.Scene's own world space (Locked Design Decision
//      #1/#4) — center-origin, +y up, with its own fixed PerspectiveCamera
//      configured (by the ClothStudio wiring, not this module) so that
//      1 world unit == 1 CSS px at z=0. `layoutTextPlane` is the ONLY
//      function that crosses from space 1 into space 2.

// ── Schema constants ─────────────────────────────────────────────────────

export const MAX_TEXT_LAYERS = 3;

export const TEXT_ALIGNS = ['left', 'center', 'right'];

// ── Phase 2 — per-layer backdrop bar/pill ───────────────────────────────
// docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md Phase 2 ("optional
// per-layer backdrop bar/pill (drawn into the same text canvas, not a
// separate mesh)"). 'bar' = small fixed corner radius, 'pill' = fully
// rounded capsule (radius = half the box height) — see
// buildTextCanvasSpec's own backdropRects comment for the exact geometry.
export const TEXT_BACKDROPS = ['none', 'bar', 'pill'];

// ── Phase 3 — in/out animation enums ────────────────────────────────────
// docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md Phase 3. 'tracking'
// and 'wipe' are IN-only (there is no OUT equivalent — see
// computeTextAnimState's own header for why this materially simplifies the
// timing math: an OUT phase only ever needs fade/sink/blur); 'sink' is
// OUT-only (the "settle downward" complement of 'rise'). 'none' is valid on
// both sides and 'blur'/'fade' are valid on both sides.
export const TEXT_ANIM_INS = ['none', 'fade', 'rise', 'blur', 'tracking', 'wipe'];
export const TEXT_ANIM_OUTS = ['none', 'fade', 'sink', 'blur'];
export const TEXT_ANIM_EASES = ['linear', 'power2', 'power4'];

// The 'tracking' preset's peak letter-spacing multiplier (applied to the
// layer's OWN `tracking` field, not a replacement for it) — exported
// because ClothStudio's canvas-sizing code needs the SAME number to
// pre-size a tracking-animated layer's text canvas wide enough that the
// animated (wider) letter-spacing never clips against the canvas edge; see
// that wiring's own comment for the full reasoning. blurPx's/offsetYPct's
// own peak values (14px / 8%) have no such cross-module consumer, so they
// stay internal to computeTextAnimState below.
export const TEXT_ANIM_TRACKING_MAX_MUL = 1.35;

// Curated, display-worthy hero fonts. `weights` lists the numeric static
// weights actually published for that family on Google Fonts — sanitization
// clamps any requested weight to the NEAREST entry in this list (a family's
// "700" is meaningless if it only ships 400, e.g. Bebas Neue/Anton/Archivo
// Black are single-weight families). `fallback` is the CSS generic used when
// the Google Font hasn't loaded yet (or the user is offline — Locked Design
// Decision #5: never block the render loop on font loading, always draw a
// system-font fallback first).
export const GOOGLE_FONT_CATALOG = [
  { id: 'inter', label: 'Inter', family: 'Inter', weights: [400, 500, 600, 700, 800, 900], category: 'sans', fallback: 'sans-serif' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', weights: [300, 400, 500, 600, 700], category: 'sans', fallback: 'sans-serif' },
  { id: 'space-mono', label: 'Space Mono', family: 'Space Mono', weights: [400, 700], category: 'mono', fallback: 'monospace' },
  { id: 'bebas-neue', label: 'Bebas Neue', family: 'Bebas Neue', weights: [400], category: 'display', fallback: 'sans-serif' },
  { id: 'anton', label: 'Anton', family: 'Anton', weights: [400], category: 'display', fallback: 'sans-serif' },
  { id: 'archivo-black', label: 'Archivo Black', family: 'Archivo Black', weights: [400], category: 'display', fallback: 'sans-serif' },
  // The Comic Sans equivalent (owner request): Comic Neue is the
  // open-source redesign of Comic Sans on Google Fonts. Its fallback chain
  // is the real "Comic Sans MS" where the OS has it — the layer looks
  // comic-styled even before (or without) the webfont loading.
  { id: 'comic-neue', label: 'Comic Neue', family: 'Comic Neue', weights: [300, 400, 700], category: 'display', fallback: '"Comic Sans MS", "Comic Sans", cursive' },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900], category: 'serif', fallback: 'serif' },
  { id: 'fraunces', label: 'Fraunces', family: 'Fraunces', weights: [300, 400, 500, 600, 700, 800, 900], category: 'serif', fallback: 'serif' },
  { id: 'dm-serif-display', label: 'DM Serif Display', family: 'DM Serif Display', weights: [400], category: 'serif', fallback: 'serif' },
  { id: 'syne', label: 'Syne', family: 'Syne', weights: [400, 500, 600, 700, 800], category: 'display', fallback: 'sans-serif' },
  { id: 'unbounded', label: 'Unbounded', family: 'Unbounded', weights: [200, 300, 400, 500, 600, 700, 800, 900], category: 'display', fallback: 'sans-serif' },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: 'IBM Plex Mono', weights: [100, 200, 300, 400, 500, 600, 700], category: 'mono', fallback: 'monospace' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono', weights: [100, 200, 300, 400, 500, 600, 700, 800], category: 'mono', fallback: 'monospace' },
  { id: 'libre-caslon-text', label: 'Libre Caslon Text', family: 'Libre Caslon Text', weights: [400, 700], category: 'serif', fallback: 'serif' },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', weights: [200, 300, 400, 500, 600, 700], category: 'sans', fallback: 'sans-serif' },
  { id: 'work-sans', label: 'Work Sans', family: 'Work Sans', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], category: 'sans', fallback: 'sans-serif' },
];

export const DEFAULT_TEXT_LAYER = {
  on: true,
  text: 'HEADLINE',
  fontId: 'space-grotesk',
  weight: 700,
  // 'overlay' = screen-space layer pinned to the frame (original behavior);
  // 'scene' = a real plane INSIDE the 3D world at depth posZ — orbits with
  // the camera and participates in occlusion/diffusion like any element.
  placement: 'overlay',
  posZ: 0.6,
  sizePct: 12,
  leading: 1.05,
  tracking: 0,
  align: 'center',
  anchorX: 0.5,
  anchorY: 0.4,
  maxWidthPct: 85,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  color: '#ffffff',
  opacity: 1,
  uppercase: false,
  // Phase 3 — see the TEXT_ANIM_* enums above + computeTextAnimState below.
  // A layer sanitized before this field existed (old localStorage blob,
  // old cloud recipe) has no `anim` key at all — sanitizeTextLayer's own
  // `fb.anim || DEFAULT_TEXT_LAYER.anim` fallback chain means it always
  // resolves to exactly this default, never throws/undefined.
  anim: { in: 'fade', out: 'none', inDur: 0.8, outDur: 0.5, delay: 0, ease: 'power2' },
  // Phase 2 — per-layer backdrop bar/pill (TEXT_BACKDROPS above). A layer
  // sanitized before these fields existed has none of them at all —
  // sanitizeTextLayer's own per-field fallback chain (same discipline as
  // every other field below) resolves that to exactly 'none'/these
  // defaults, never throws/undefined, i.e. renders IDENTICALLY to before
  // this phase shipped.
  backdrop: 'none',
  backdropColor: '#000000',
  backdropOpacity: 0.55,
  backdropPadPct: 8,
};

// ── Phase 2 — authored hero layout presets ──────────────────────────────
// docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md Phase 2 ("Layout
// presets (hero-left / centered / lower-third / poster stack) as authored
// textLayers sets"). Applying a preset REPLACES every current layer with
// this exact set — it is not a set of field overrides merged onto whatever
// layers already exist. Each preset authors its OWN font/size/leading/
// anchor/align choices; it deliberately does NOT try to preserve the
// previous layers' fontId/sizePct/anchors "for continuity" — a layout
// preset is a composed look, not a per-field tweak, so keeping old field
// values would produce compositions the preset was never designed for.
// Entries carry no `id` (createTextLayer/sanitizeTextLayers assign ids
// positionally on apply, same as every other layer-list mutation) and, by
// construction, every field value here already sits inside
// sanitizeTextLayer's own bounds — see text-layers.test.js's "every preset
// layer sanitizes to itself unchanged" coverage.
export const HERO_LAYOUT_PRESETS = [
  {
    id: 'hero-left',
    label: 'Hero Left',
    layers: [
      {
        text: 'EYEBROW LABEL', fontId: 'ibm-plex-mono', weight: 500, uppercase: true,
        sizePct: 4.5, leading: 1.1, tracking: 0.12, align: 'left',
        anchorX: 0.08, anchorY: 0.3, maxWidthPct: 55, opacity: 0.75,
      },
      {
        text: 'BIG HEADLINE\nGOES HERE', fontId: 'space-grotesk', weight: 700, uppercase: false,
        sizePct: 15, leading: 1.02, tracking: -0.01, align: 'left',
        anchorX: 0.08, anchorY: 0.48, maxWidthPct: 68,
      },
    ],
  },
  {
    id: 'centered',
    label: 'Centered',
    layers: [
      {
        text: 'A CENTERED STATEMENT', fontId: 'fraunces', weight: 500, uppercase: false,
        sizePct: 13, leading: 1.08, tracking: 0, align: 'center',
        anchorX: 0.5, anchorY: 0.42, maxWidthPct: 72,
      },
    ],
  },
  {
    id: 'lower-third',
    label: 'Lower Third',
    layers: [
      {
        text: 'HEADLINE', fontId: 'inter', weight: 700, uppercase: false,
        sizePct: 8, leading: 1.05, tracking: 0, align: 'left',
        anchorX: 0.08, anchorY: 0.78, maxWidthPct: 60,
      },
      {
        text: 'Supporting subline goes here', fontId: 'inter', weight: 500, uppercase: false,
        sizePct: 4, leading: 1.2, tracking: 0, align: 'left',
        anchorX: 0.08, anchorY: 0.865, maxWidthPct: 55, opacity: 0.8,
      },
    ],
  },
  {
    id: 'poster-stack',
    label: 'Poster Stack',
    layers: [
      {
        text: 'POSTER\nSTACK', fontId: 'anton', weight: 400, uppercase: true,
        sizePct: 22, leading: 0.86, tracking: 0, align: 'center',
        anchorX: 0.5, anchorY: 0.38, maxWidthPct: 90,
      },
    ],
  },
];

// ── Internal sanitize helpers (not exported — implementation detail of the
// field-by-field bounds below, kept local so sanitizeTextLayer reads as a
// flat list of "field: rule" instead of inline ternary soup). ─────────────

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const isHexColor = (v) => typeof v === 'string' && HEX_COLOR_RE.test(v);

// Treats null/undefined/'' as "absent" (falls back) rather than letting
// Number(null) === 0 silently clamp to the field's minimum — a caller
// passing `sizePct: null` means "no opinion," not "as small as possible."
const clampNum = (v, min, max, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const sanitizeBool = (v, fallback) => (v === null || v === undefined ? Boolean(fallback) : Boolean(v));

const sanitizeText = (v, fallback) => {
  const source = v === null || v === undefined ? fallback : v;
  return String(source ?? '').slice(0, 400);
};

// A requested weight that isn't published by the resolved font snaps to the
// NEAREST weight that family actually ships (never silently drops to 400 —
// e.g. Anton (weights:[400]) asked for 700 must render its one real weight,
// not a nonexistent one the browser would ignore anyway). A raw weight that
// was actually SUPPLIED (even if invalid for this font) snaps to the
// nearest of THAT requested value — it must never quietly resolve to the
// fallback layer's unrelated weight instead. Only when raw omits weight
// entirely does the fallback layer's weight become the target (itself
// re-snapped to the current font, since switching fontId can invalidate a
// previously-valid fallback weight).
const nearestWeight = (weights, target) => weights.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best), weights[0]);
const resolveNearestWeight = (rawWeight, font, fallbackWeight) => {
  const weights = font && Array.isArray(font.weights) && font.weights.length ? font.weights : [400];
  const rawProvided = rawWeight !== undefined && rawWeight !== null && rawWeight !== '';
  const raw = Number(rawWeight);
  if (rawProvided && Number.isFinite(raw)) {
    return weights.includes(raw) ? raw : nearestWeight(weights, raw);
  }
  const fb = Number(fallbackWeight);
  const fbTarget = Number.isFinite(fb) ? fb : weights[0];
  return weights.includes(fbTarget) ? fbTarget : nearestWeight(weights, fbTarget);
};

// Field-by-field validate/clamp for the `anim` sub-object, same discipline
// as sanitizeTextLayer itself (independent per-field fallback, never an
// all-or-nothing reject). `fallback` defaults to DEFAULT_TEXT_LAYER.anim so
// a caller that never specifies one still gets a fully-shaped object back —
// this is what makes "an old layer without `anim` at all" and "a layer
// whose `anim` is present but malformed" both resolve to the same default
// instead of needing two different code paths.
function sanitizeTextAnim(raw, fallback = DEFAULT_TEXT_LAYER.anim) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : DEFAULT_TEXT_LAYER.anim;
  const inId = TEXT_ANIM_INS.includes(r.in) ? r.in : (TEXT_ANIM_INS.includes(fb.in) ? fb.in : DEFAULT_TEXT_LAYER.anim.in);
  const outId = TEXT_ANIM_OUTS.includes(r.out) ? r.out : (TEXT_ANIM_OUTS.includes(fb.out) ? fb.out : DEFAULT_TEXT_LAYER.anim.out);
  const easeId = TEXT_ANIM_EASES.includes(r.ease) ? r.ease : (TEXT_ANIM_EASES.includes(fb.ease) ? fb.ease : DEFAULT_TEXT_LAYER.anim.ease);
  return {
    in: inId,
    out: outId,
    inDur: clampNum(r.inDur, 0.1, 5, fb.inDur),
    outDur: clampNum(r.outDur, 0.1, 5, fb.outDur),
    delay: clampNum(r.delay, 0, 10, fb.delay),
    ease: easeId,
  };
}

// ── Schema sanitizers ────────────────────────────────────────────────────

/**
 * id + a fully sanitized DEFAULT_TEXT_LAYER merged with `overrides`. This is
 * the "new layer" constructor the HERO TEXT card's Add-layer button calls —
 * routing overrides through sanitizeTextLayer means an author can never
 * hand-construct an out-of-bounds layer (e.g. sizePct: 500) even by mistake.
 */
export function createTextLayer(id, overrides = {}) {
  const sanitized = sanitizeTextLayer({ ...DEFAULT_TEXT_LAYER, ...overrides }, DEFAULT_TEXT_LAYER);
  return { id, ...sanitized };
}

/**
 * Field-by-field validate/clamp against `fallback` (defaults to
 * DEFAULT_TEXT_LAYER). Every field is independently guarded so a single
 * corrupted key (a hand-edited localStorage blob, a stale cloud-template
 * shape) can't invalidate the whole layer — it just falls back to that one
 * field's fallback value while every other field passes through untouched.
 * Does NOT attach `id` — that's sanitizeTextLayers'/createTextLayer's job.
 */
export function sanitizeTextLayer(raw, fallback = DEFAULT_TEXT_LAYER) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : DEFAULT_TEXT_LAYER;

  const fontId = typeof r.fontId === 'string' && GOOGLE_FONT_CATALOG.some((f) => f.id === r.fontId)
    ? r.fontId
    : (typeof fb.fontId === 'string' && GOOGLE_FONT_CATALOG.some((f) => f.id === fb.fontId) ? fb.fontId : GOOGLE_FONT_CATALOG[0].id);
  const font = fontById(fontId);
  const weight = resolveNearestWeight(r.weight, font, fb.weight);

  const align = TEXT_ALIGNS.includes(r.align) ? r.align : (TEXT_ALIGNS.includes(fb.align) ? fb.align : TEXT_ALIGNS[1]);
  const color = isHexColor(r.color) ? r.color : (isHexColor(fb.color) ? fb.color : DEFAULT_TEXT_LAYER.color);

  // Phase 2 — per-layer backdrop bar/pill. Same independent-per-field
  // fallback discipline as every other field here: a layer sanitized before
  // these fields existed (old localStorage blob, old cloud recipe) has none
  // of them, so `r.backdrop`/`r.backdropColor` are undefined, `fb` (which
  // defaults to DEFAULT_TEXT_LAYER when no real fallback layer is passed)
  // supplies 'none'/'#000000', and the two clampNum fields below resolve to
  // DEFAULT_TEXT_LAYER's own 0.55/8 the same way clampNum already treats
  // any absent value.
  const backdrop = TEXT_BACKDROPS.includes(r.backdrop) ? r.backdrop : (TEXT_BACKDROPS.includes(fb.backdrop) ? fb.backdrop : DEFAULT_TEXT_LAYER.backdrop);
  const backdropColor = isHexColor(r.backdropColor) ? r.backdropColor : (isHexColor(fb.backdropColor) ? fb.backdropColor : DEFAULT_TEXT_LAYER.backdropColor);

  // Placement — 'overlay' (screen-space, pinned to the frame; the original
  // behavior and default) or 'scene' (a real plane inside the 3D world:
  // orbits with the camera, occluded by/occludes geometry, sits at posZ).
  const placement = ['overlay', 'scene'].includes(r.placement) ? r.placement
    : (['overlay', 'scene'].includes(fb.placement) ? fb.placement : 'overlay');

  return {
    on: sanitizeBool(r.on, fb.on),
    text: sanitizeText(r.text, fb.text),
    fontId,
    weight,
    placement,
    posZ: clampNum(r.posZ, -1.5, 1.5, fb.posZ),
    sizePct: clampNum(r.sizePct, 1, 60, fb.sizePct),
    leading: clampNum(r.leading, 0.7, 2.5, fb.leading),
    tracking: clampNum(r.tracking, -0.1, 0.5, fb.tracking),
    align,
    anchorX: clampNum(r.anchorX, 0, 1, fb.anchorX),
    anchorY: clampNum(r.anchorY, 0, 1, fb.anchorY),
    maxWidthPct: clampNum(r.maxWidthPct, 10, 100, fb.maxWidthPct),
    rotX: clampNum(r.rotX, -80, 80, fb.rotX),
    rotY: clampNum(r.rotY, -80, 80, fb.rotY),
    rotZ: clampNum(r.rotZ, -180, 180, fb.rotZ),
    color,
    opacity: clampNum(r.opacity, 0, 1, fb.opacity),
    uppercase: sanitizeBool(r.uppercase, fb.uppercase),
    anim: sanitizeTextAnim(r.anim, (fb.anim && typeof fb.anim === 'object') ? fb.anim : DEFAULT_TEXT_LAYER.anim),
    backdrop,
    backdropColor,
    backdropOpacity: clampNum(r.backdropOpacity, 0, 1, fb.backdropOpacity),
    backdropPadPct: clampNum(r.backdropPadPct, 0, 30, fb.backdropPadPct),
  };
}

/**
 * Always returns an array (never throws, never passes through unsanitized
 * data) — the single gate both localStorage load and cloud-template apply
 * go through. Non-array input (missing key on an old recipe, a corrupted
 * blob) returns a deep copy of `fallbackLayers` rather than an empty array,
 * so "no textLayers key at all" (old recipe) and "explicit empty array"
 * (user deleted every layer) both stay lossless round-trips at their
 * respective call sites' discretion.
 *
 * ids are ALWAYS reassigned positionally as 'txt-1', 'txt-2', ... — this is
 * the single deterministic rule that simultaneously handles missing ids,
 * duplicate ids, and stale ids left over from a reordered/deleted layer;
 * there is no separate "detect a collision" branch to get out of sync.
 */
export function sanitizeTextLayers(raw, fallbackLayers = []) {
  const fallbackArr = Array.isArray(fallbackLayers) ? fallbackLayers : [];
  if (!Array.isArray(raw)) return fallbackArr.map((layer) => ({ ...layer }));
  return raw.slice(0, MAX_TEXT_LAYERS).map((entry, i) => {
    const fb = fallbackArr[i] && typeof fallbackArr[i] === 'object' ? fallbackArr[i] : DEFAULT_TEXT_LAYER;
    return { id: `txt-${i + 1}`, ...sanitizeTextLayer(entry, fb) };
  });
}

/** Catalog entry for `fontId`, or the first catalog entry if unknown. */
export function fontById(fontId) {
  return GOOGLE_FONT_CATALOG.find((f) => f.id === fontId) || GOOGLE_FONT_CATALOG[0];
}

/** `https://fonts.googleapis.com/css2?family=<Family+With+Pluses>:wght@<weight>&display=swap` */
export function googleFontCssUrl(entry, weight) {
  const family = String(entry?.family || entry?.label || '').trim().split(/\s+/).join('+');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
}

// ── Frame-relative layout ────────────────────────────────────────────────

/**
 * Mirrors ClothStudio.jsx's `computeFrameRect` (line ~667) EXACTLY — same
 * 0.92 safety margin, same "largest centered rect of the target aspect that
 * fits the canvas" algorithm, same x/y/w/h CSS-px/top-left-origin return
 * shape. This is Locked Design Decision #3 ("frame-relative layout"): text
 * anchors are defined against whatever this function returns for the
 * ACTIVE capture frame, so switching frames (square -> vertical) re-anchors
 * text automatically instead of requiring per-frame re-authoring.
 *
 * `frameW`/`frameH` null/undefined == the 'off' frame (full canvas, no
 * fixed aspect) — same as ClothStudio's `frameFootprint` treating 'off' as
 * "occupies the whole 0.92 safe area," just written out with the same
 * explicit centering math (x/y) that a text layer's frame-relative anchor
 * math needs and the footprint-only helper doesn't bother computing.
 */
export function resolveFrameRect({ canvasW, canvasH, frameW, frameH }) {
  const cw = Number(canvasW) || 0;
  const ch = Number(canvasH) || 0;
  if (!frameW || !frameH) {
    const w = cw * 0.92;
    const h = ch * 0.92;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }
  const aspect = frameW / frameH;
  let w = cw * 0.92;
  let h = w / aspect;
  if (h > ch * 0.92) {
    h = ch * 0.92;
    w = h * aspect;
  }
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

// ── Text-canvas layout ───────────────────────────────────────────────────

// Text canvases draw at 2x frame-native resolution so 2x/Ultra video and PNG
// exports (ClothStudio's RESOLUTION_TIERS / pixelRatio boost) stay crisp
// with NO export-time redraw at a different scale — the SAME canvas texture
// serves the live preview and every export tier, because it was already
// drawn at the higher of the two resolutions from the start (Locked Design
// Decision #6). Export-time work is limited to re-running
// buildTextCanvasSpec at the (unchanged) frame-native size when the FRAME
// itself changes resolution tier, not a separate "upscale the text" pass.
export const TEXT_CANVAS_SCALE = 2;

// 1x px padding around the wrapped text block, proportional to font size —
// just enough that ascenders/descenders and the last glyph's letter-spacing
// overshoot never clip against the canvas-texture edge. An implementation
// detail (not part of the exported contract); callers should read spacing
// back off the returned spec (e.g. consecutive `lines[].y` deltas), never
// assume this constant.
const CANVAS_PADDING_FACTOR = 0.3;

// 1x px corner radius for a 'bar' backdrop (TEXT_BACKDROPS) — a small fixed
// rounding, NOT a capsule; clamped to half the box height at draw time
// (buildTextCanvasSpec below) so it never overshoots into a pill on a very
// small font size. 'pill' uses half the box height directly instead of this
// constant — see backdropRects' own comment below.
const BACKDROP_BAR_RADIUS_PX = 6;

// Greedy word-wrap: add one word at a time while the growing line still
// measures within maxWidthPx; overflow starts a new line. Only `measure()`
// (unscaled 1x) decides wrap points — letter-spacing is deliberately NOT
// part of the wrap-fit decision (it's a small, roughly per-character delta
// that would make wrap points depend on tracking in a way no author
// intuits: "changing letter-spacing reflowed my headline"). Tracking is
// still accounted for in the CANVAS's pixel width below, so a drawn line
// never clips even though it wasn't part of the wrap decision itself.
function wrapParagraph(paragraph, maxWidthPx, fontString, measure) {
  const words = String(paragraph).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (measure(candidate, fontString) <= maxWidthPx) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Pure text layout at frame-NATIVE resolution (the render-target pixel size
 * for the active capture frame — NOT the CSS on-canvas frameRect size;
 * `layoutTextPlane` below converts between the two). `measure` is called
 * with the UNSCALED (1x) fontString — the same string returned in
 * `fontString` — so an injected canvas-measurement function never needs to
 * know about TEXT_CANVAS_SCALE.
 *
 * Design choice (documented per the handoff plan): rather than have the
 * draw code `ctx.scale(TEXT_CANVAS_SCALE, TEXT_CANVAS_SCALE)` and draw at 1x
 * coordinates, this returns `canvasW`/`canvasH` (the actual canvas pixel
 * dimensions) and every LINE POSITION already multiplied by
 * TEXT_CANVAS_SCALE, and `fontPx`/`letterSpacingPx`/`lineHeightPx` also
 * already multiplied by TEXT_CANVAS_SCALE — so the draw code sets the
 * canvas's pixel width/height to canvasW/canvasH, builds its OWN scaled
 * `ctx.font` string from `weight` + the returned (scaled) `fontPx` + the
 * font's family/fallback, and draws every line straight at `lines[].x/y`
 * with zero `ctx.scale()` calls anywhere in the draw path. `fontString`
 * itself stays 1x — it exists for measurement/debugging parity with what
 * was passed into `measure()`, not for the actual scaled draw call.
 *
 * `lines[].y` is each line's VERTICAL CENTER (draw code must use
 * `ctx.textBaseline = 'middle'`), not a baseline — deliberately avoiding any
 * dependency on font ascent/descent metrics, which an injected `measure()`
 * has no obligation to expose.
 */
export function buildTextCanvasSpec({ layer, frameNativeW, frameNativeH, measure }) {
  const font = fontById(layer.fontId);
  const fontPx = (layer.sizePct / 100) * frameNativeH;
  const maxWidthPx = (layer.maxWidthPct / 100) * frameNativeW;
  const fontString = `${layer.weight} ${fontPx}px "${font.family}", ${font.fallback}`;
  const letterSpacingPx = layer.tracking * fontPx;
  const lineHeightPx = layer.leading * fontPx;

  const sourceText = typeof layer.text === 'string' ? layer.text : String(layer.text ?? '');
  const rawText = layer.uppercase ? sourceText.toUpperCase() : sourceText;
  const lineTexts = rawText.split('\n').flatMap((paragraph) => wrapParagraph(paragraph, maxWidthPx, fontString, measure));

  const lineWidths = lineTexts.map((text) => {
    const base = measure(text, fontString);
    const spacingExtra = text.length > 1 ? (text.length - 1) * letterSpacingPx : 0;
    return base + spacingExtra;
  });
  const maxLineWidth = lineWidths.length ? Math.max(...lineWidths) : 0;

  // Per-layer backdrop bar/pill (Phase 2, TEXT_BACKDROPS) — an optional ring
  // of extra padding around each LINE's own box, drawn behind the text (see
  // ClothStudio's drawTextLayerCanvas draw order: backdropRects first, text
  // on top). `backdropPad` folds straight into the SAME `padding` value the
  // canvas-sizing math below already used pre-Phase-2 — "expand canvasW/
  // canvasH for it" therefore needs no separate size pass; a wider/taller
  // canvas falls out of the existing formulas for free. Zero-cost/identical
  // output when backdrop is 'none' (backdropPad stays 0, same as before
  // this phase shipped).
  const backdropOn = layer.backdrop === 'bar' || layer.backdrop === 'pill';
  const backdropPad = backdropOn ? (Number(layer.backdropPadPct) || 0) / 100 * fontPx : 0;

  const padding = fontPx * CANVAS_PADDING_FACTOR + backdropPad;
  const canvasW = Math.max(1, Math.ceil((maxLineWidth + padding * 2) * TEXT_CANVAS_SCALE));
  const canvasH = Math.max(1, Math.ceil((lineTexts.length * lineHeightPx + padding * 2) * TEXT_CANVAS_SCALE));
  const paddingScaled = padding * TEXT_CANVAS_SCALE;
  const lineHeightScaled = lineHeightPx * TEXT_CANVAS_SCALE;

  const drawX = layer.align === 'left'
    ? paddingScaled
    : layer.align === 'right'
      ? canvasW - paddingScaled
      : canvasW / 2;

  const lines = lineTexts.map((text, i) => ({
    text,
    x: drawX,
    y: paddingScaled + lineHeightScaled * (i + 0.5),
  }));

  // backdropRects — one box per LINE (a short subline gets a short pill, not
  // the headline's full-width bar), pre-scaled to the SAME pixel space as
  // `lines[].x/y` above (the draw code does zero extra scale math). Box
  // width hugs that line's own measured width + 2*backdropPad; box height
  // hugs the FONT size (not the leading-inflated lineHeightPx — a backdrop
  // that used full line-height would look oversized whenever leading > 1).
  // `x` (the box's LEFT edge) honors align the same way `drawX` above does:
  // left/right keep the text's own inset edge fixed and grow the OTHER edge
  // outward; center grows symmetrically around the shared center x. Empty
  // array when backdrop is 'none' — never populated, never drawn.
  const backdropRects = backdropOn ? lineTexts.map((text, i) => {
    const lineWidthScaled = lineWidths[i] * TEXT_CANVAS_SCALE;
    const padScaled = backdropPad * TEXT_CANVAS_SCALE;
    const w = lineWidthScaled + padScaled * 2;
    const h = (fontPx + backdropPad * 2) * TEXT_CANVAS_SCALE;
    const x = layer.align === 'left'
      ? drawX - padScaled
      : layer.align === 'right'
        ? drawX - lineWidthScaled - padScaled
        : drawX - w / 2;
    const y = lines[i].y - h / 2;
    const radius = layer.backdrop === 'pill' ? h / 2 : Math.min(BACKDROP_BAR_RADIUS_PX * TEXT_CANVAS_SCALE, h / 2);
    return { x, y, w, h, radius };
  }) : [];

  return {
    canvasW,
    canvasH,
    lines,
    fontString,
    fontPx: fontPx * TEXT_CANVAS_SCALE,
    letterSpacingPx: letterSpacingPx * TEXT_CANVAS_SCALE,
    lineHeightPx: lineHeightScaled,
    align: layer.align,
    scale: TEXT_CANVAS_SCALE,
    backdropRects,
  };
}

/**
 * Converts a buildTextCanvasSpec result + the on-canvas CSS-px frameRect
 * (from resolveFrameRect) into overlay-scene plane placement — the ONE
 * function that crosses from frame-relative/top-left-origin space into the
 * overlay THREE.Scene's center-origin/+y-up world space. Requires the
 * ClothStudio wiring to configure the overlay camera so that 1 world unit
 * == 1 CSS px at z=0 (Locked Design Decision #1); this function does not
 * (and cannot, being pure/no-three.js) enforce that — it only produces
 * correct output given that convention holds.
 *
 * `stageW`/`stageH` are the overlay canvas's own CSS px dimensions (the
 * same `canvasW`/`canvasH` resolveFrameRect was called with) — needed
 * because "center-origin" is relative to the STAGE, not the frame.
 *
 * Horizontal anchor convention (align-aware — bug fix, Hero Text Builder
 * Phase 2): `anchorX` names the edge of the text BLOCK the layer's own
 * `align` grows from, matching how a designer thinks about a left/right-
 * aligned block, not always the block's horizontal CENTER:
 *   - align 'left'   -> anchorX is the block's LEFT edge (block extends
 *                       RIGHTWARD from the anchor; centerX = anchor + planeW/2)
 *   - align 'right'  -> anchorX is the block's RIGHT edge (block extends
 *                       LEFTWARD from the anchor; centerX = anchor - planeW/2)
 *   - align 'center' -> anchorX is the block's CENTER (unchanged from
 *                       before this fix; centerX = anchor)
 * Before this fix anchorX always named the CENTER regardless of align, so a
 * left-aligned layer with a small anchorX (e.g. hero-left's 0.08) had HALF
 * its plane width extending left of the anchor — often past the frame's
 * left edge entirely. Phase 1's only shipped preset was centered
 * (anchorX 0.5, align 'center'), where anchor-as-center and anchor-as-edge
 * coincide, masking the bug until Phase 2's left-aligned presets
 * (hero-left, lower-third) exposed it. Vertical stays center-anchored
 * (anchorY always names the block's vertical CENTER) — text growing
 * up/down off a single anchorY has no equivalent "which edge" convention
 * to pick, and no caller has asked for one.
 */
export function layoutTextPlane({ spec, layer, frameRect, frameNativeH, stageW, stageH }) {
  const pxScale = frameRect.h / frameNativeH;
  const planeW = (spec.canvasW / spec.scale) * pxScale;
  const planeH = (spec.canvasH / spec.scale) * pxScale;
  const anchorPxX = frameRect.x + layer.anchorX * frameRect.w;
  const blockCenterPxX = layer.align === 'left'
    ? anchorPxX + planeW / 2
    : layer.align === 'right'
      ? anchorPxX - planeW / 2
      : anchorPxX;
  const centerX = blockCenterPxX - stageW / 2;
  const centerY = stageH / 2 - (frameRect.y + layer.anchorY * frameRect.h);
  return { centerX, centerY, planeW, planeH };
}

// ── In-scene placement (placement: 'scene') ─────────────────────────────
// Maps the SAME anchor/size fields onto a fixed world-unit stage centered
// at the origin (where the primary subject lives; camera default z 2.6),
// instead of the overlay's CSS-pixel frame rect. Deliberately a FIXED
// stage — the world position of an in-scene layer must not drift with
// window size or frame preset; only its authored fields move it. Same
// align-aware anchor offsetting as layoutTextPlane above.
export const TEXT_WORLD_STAGE = { w: 2.0, h: 1.25 };

export function layoutTextPlaneWorld({ spec, layer, frameNativeH }) {
  const planeH = ((spec.canvasH / spec.scale) / frameNativeH) * TEXT_WORLD_STAGE.h;
  const planeW = planeH * (spec.canvasW / spec.canvasH);
  const anchorX = (layer.anchorX - 0.5) * TEXT_WORLD_STAGE.w;
  const centerX = layer.align === 'left'
    ? anchorX + planeW / 2
    : layer.align === 'right'
      ? anchorX - planeW / 2
      : anchorX;
  const centerY = (0.5 - layer.anchorY) * TEXT_WORLD_STAGE.h;
  const centerZ = clampNum(layer.posZ, -1.5, 1.5, DEFAULT_TEXT_LAYER.posZ);
  return { centerX, centerY, planeW, planeH, centerZ };
}

// ── Phase 3 — in/out animation timing ───────────────────────────────────
// docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md Phase 3. Pure
// timing math only — no DOM, no three.js, no requestAnimationFrame/Date.now.
// ClothStudio.jsx's render loop calls computeTextAnimState() once per
// enabled layer per frame (only while its shared `textAnimClock` is
// 'preview'/'export' — see that wiring's own comments for the 'idle'
// short-circuit) with a single "now" drawn from the SAME clock the loop
// already reads every frame for everything else (THREE.Clock#elapsedTime,
// seconds since world mount) — tStart/tEnd are stamped in that identical
// clock, never Date.now()/performance.now(), so preview and export share
// one time convention with zero cross-clock drift risk.
//
// Preset -> channel contract (every preset touches ONLY the channels
// listed below; every other channel stays at its IDENTITY value for that
// preset's entire phase — this is asserted directly by the "every preset
// maps to its expected channels only" test in text-anim.test.js):
//   fade           -> opacityMul                 0->1 (in) / 1->0 (out)
//   rise  (in only)-> opacityMul + offsetYPct     opacityMul as fade; offsetYPct +8%->0%
//   sink (out only)-> opacityMul + offsetYPct     opacityMul as fade; offsetYPct 0%->+8%
//   blur           -> opacityMul + blurPx         opacityMul as fade; blurPx 14->0 (in) / 0->14 (out)
//   tracking(in only)-> opacityMul + trackingMul  opacityMul as fade; trackingMul 1.35->1
//   wipe    (in only)-> clipT only                opacityMul stays 1 the WHOLE in-phase
//   none           -> that phase never modifies anything at all
// offsetYPct is a %-of-frame-height convention (matches sizePct/anchorY
// elsewhere in this module): positive = shifted DOWN in screen space, so
// the ClothStudio wiring must SUBTRACT it from a +y-up world-space
// position, not add it — see that wiring's own comment for the exact sign.
// blurPx is in the SAME "design px" convention fontPx's UNSCALED input
// uses (frame-native px, resolution-agnostic) — the imperative
// canvas-blur caller multiplies by TEXT_CANVAS_SCALE itself, exactly like
// every other draw-time scale-up in this module; this function stays
// resolution-agnostic on purpose.
//
// Three-phase timeline per layer:
//   1. IN phase  [tStart+delay, tStart+delay+inDur]  eases PRE-IN -> IDENTITY
//   2. MIDDLE    identity, held
//   3. OUT phase [tEnd-outDur, tEnd]                  eases IDENTITY -> POST-OUT
//      (only exists when tEnd is finite — Number.isFinite(tEnd) === false,
//      i.e. null/undefined/Infinity, means "no out window", matching the
//      live PREVIEW LOOP case where there is no known end instant yet)
// After tEnd (when an out window exists), the state HOLDS at the post-out
// endpoint forever — a caller that never resets the clock back to 'idle'
// keeps seeing the faded-out state, not a snap back to identity. This
// falls out of clamp01 naturally (see the implementation below) rather
// than needing a separate "tNow >= tEnd" branch.
//
// Overlap precedence (a short-duration edge case, not the normal path —
// real hero exports run several seconds against sub-second in/out
// durations): if tNow falls inside BOTH the in-window and the out-window
// at once (only possible when delay+inDur+outDur exceeds tEnd-tStart),
// the OUT phase's own eased value WINS outright for that frame — computed
// from a pure identity baseline, never blended with whatever the in-phase
// was mid-easing. This is a deliberate, deterministic simplification: the
// three-phase model above assumes non-overlapping windows, and "out always
// wins on overlap" keeps the function total (never NaN/undefined) without
// a fourth blended-transition case for an input shape no caller in this
// codebase actually produces (ClothStudio's own Preview button computes
// tEnd with an explicit hold margin specifically to avoid it).
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const TEXT_ANIM_EASE_FNS = {
  linear: (t) => t,
  power2: (t) => 1 - (1 - t) ** 2,
  power4: (t) => 1 - (1 - t) ** 4,
};

// Peak values for the channels whose identity is NOT 0/1 — kept local
// (TEXT_ANIM_TRACKING_MAX_MUL above is the one exception with a real
// cross-module consumer; see its own comment for why it's exported instead
// of living here).
const TEXT_ANIM_BLUR_MAX_PX = 14;
const TEXT_ANIM_OFFSET_MAX_PCT = 8;

const TEXT_ANIM_IDENTITY_STATE = Object.freeze({ opacityMul: 1, offsetYPct: 0, blurPx: 0, trackingMul: 1, clipT: 1 });

// Partial overrides at "full pre-in" (in-phase progress 0) / "full
// post-out" (out-phase progress 1) — any channel NOT listed here stays at
// its TEXT_ANIM_IDENTITY_STATE value for that preset's entire phase (this
// is the mechanism behind "every preset maps to its expected channels
// only": 'fade' never touches offsetYPct/blurPx/trackingMul/clipT because
// it never appears as a key below).
const TEXT_ANIM_IN_PRESET_STATE = {
  fade: { opacityMul: 0 },
  rise: { opacityMul: 0, offsetYPct: TEXT_ANIM_OFFSET_MAX_PCT },
  blur: { opacityMul: 0, blurPx: TEXT_ANIM_BLUR_MAX_PX },
  tracking: { opacityMul: 0, trackingMul: TEXT_ANIM_TRACKING_MAX_MUL },
  wipe: { clipT: 0 }, // opacityMul deliberately absent here -> stays identity (1)
};
const TEXT_ANIM_OUT_PRESET_STATE = {
  fade: { opacityMul: 0 },
  sink: { opacityMul: 0, offsetYPct: TEXT_ANIM_OFFSET_MAX_PCT },
  blur: { opacityMul: 0, blurPx: TEXT_ANIM_BLUR_MAX_PX },
};

const resolveTextAnimState = (partial) => ({ ...TEXT_ANIM_IDENTITY_STATE, ...partial });
const lerpTextAnimState = (fromPartial, toPartial, p) => {
  const from = resolveTextAnimState(fromPartial);
  const to = resolveTextAnimState(toPartial);
  const out = {};
  Object.keys(TEXT_ANIM_IDENTITY_STATE).forEach((key) => { out[key] = from[key] + (to[key] - from[key]) * p; });
  return out;
};

/**
 * Pure per-frame animation state for one layer — see this section's header
 * above for the full phase/precedence contract. `anim` is expected
 * pre-sanitized (sanitizeTextLayer's `.anim` shape) but every field is
 * defaulted defensively here too (unknown in/out/ease id -> 'none'/
 * 'power2', non-finite delay/inDur/outDur -> their DEFAULT_TEXT_LAYER.anim
 * value) so a hand-built test fixture — or a future caller — missing a
 * field never throws or produces NaN.
 */
export function computeTextAnimState({ anim, tNow, tStart, tEnd }) {
  const inKind = TEXT_ANIM_INS.includes(anim?.in) ? anim.in : 'none';
  const outKind = TEXT_ANIM_OUTS.includes(anim?.out) ? anim.out : 'none';
  if (inKind === 'none' && outKind === 'none') return { ...TEXT_ANIM_IDENTITY_STATE };

  const delay = Number.isFinite(anim?.delay) ? anim.delay : DEFAULT_TEXT_LAYER.anim.delay;
  const inDur = Number.isFinite(anim?.inDur) && anim.inDur > 0 ? anim.inDur : DEFAULT_TEXT_LAYER.anim.inDur;
  const outDur = Number.isFinite(anim?.outDur) && anim.outDur > 0 ? anim.outDur : DEFAULT_TEXT_LAYER.anim.outDur;
  const ease = TEXT_ANIM_EASE_FNS[anim?.ease] || TEXT_ANIM_EASE_FNS.power2;
  const t = Number.isFinite(tNow) ? tNow : 0;
  const start = Number.isFinite(tStart) ? tStart : 0;

  // Phase 1: IN — pre-in (p=0, clamped for any t <= inStart) eases to
  // identity (p=1, clamped for any t >= inStart+inDur) over inDur seconds.
  let state = { ...TEXT_ANIM_IDENTITY_STATE };
  if (inKind !== 'none') {
    const inStart = start + delay;
    const p = clamp01((t - inStart) / inDur);
    state = lerpTextAnimState(TEXT_ANIM_IN_PRESET_STATE[inKind], {}, ease(p));
  }

  // Phase 2/3: OUT — only exists when tEnd is a real, finite instant.
  // Before outStart this branch never runs (state stands as computed
  // above); from outStart onward it OVERWRITES state (see "overlap
  // precedence" in the header) — identity (p=0, clamped for t <= outStart)
  // easing to the post-out endpoint (p=1, clamped and HELD for any
  // t >= outStart+outDur, i.e. t >= tEnd).
  const hasOutWindow = Number.isFinite(tEnd);
  if (hasOutWindow && outKind !== 'none') {
    const outStart = tEnd - outDur;
    if (t >= outStart) {
      const p = clamp01((t - outStart) / outDur);
      state = lerpTextAnimState({}, TEXT_ANIM_OUT_PRESET_STATE[outKind], ease(p));
    }
  }

  return state;
}
