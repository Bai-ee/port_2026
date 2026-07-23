// Element catalog — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md.
// One entry per selectable cinematic element: a field spec (validation bounds
// consumed by schema.js), declarative UI control metadata (bucket/key pairs
// the generic Inspector renders — see StudioElementInspector.jsx), curated
// presets, safe randomization ranges, and a performance-cost estimate. Pure
// data/logic (no React, no three.js) so it can be unit tested directly.
//
// Phase 1 registered exactly one type — the existing Holo Paper glass shell,
// `singleInstanceRenderer: true` because there is exactly one live
// `world.glassMesh`. Phase 2 adds the first real multi-instance-capable
// elements (see elements/factories.js for what actually renders them):
// Kinetic Rings, Chrome Ribbon, Translucent Monoliths, Liquid-Glass Lens, and
// Floating Media Frame. Every entry here MUST have a matching factory in
// factories.js before it's wired into ClothStudio's live-object sync effect
// — an entry with no factory would be selectable but invisible, which is
// exactly the kind of "pretend it works" state this project avoids.

export const ELEMENT_CATEGORIES = [
  'glass', 'geometry', 'light', 'particles', 'media', 'architectural', 'floor', 'hero',
];

// Ceiling on how many NON-PRIMARY instances (duplicates of a
// singleInstanceRenderer type, or added/duplicated real elements) can exist
// as data at once. Real elements are also bounded by the performance budget
// (quality.js); this is a simpler hard cap so "Add"/"Duplicate" can't grow
// the list unboundedly regardless of individual cost.
export const MAX_EXTRA_INSTANCES = 8;

// Shared transform bounds/controls — every element type uses the same
// position/rotation/scale envelope (world-unit position, degrees rotation,
// uniform-only scale in the UI even though the schema is per-axis-ready).
// Exported so elements/placement.js's default-placement search respects the
// exact same clamps validators.js will apply anyway — computing a position/
// scale outside these and letting normalizeElementInstance silently clamp it
// back would quietly invalidate the placement math.
export const TRANSFORM_RANGES = {
  position: { min: -1.5, max: 1.5 },
  scale: { min: 0.4, max: 2.2 },
};
const TRANSFORM_FIELD_SPEC = {
  position: { type: 'vec3', min: TRANSFORM_RANGES.position.min, max: TRANSFORM_RANGES.position.max, default: [0, 0, 0] },
  rotation: { type: 'vec3', min: -180, max: 180, default: [0, 0, 0] },
  scale: { type: 'vec3', min: TRANSFORM_RANGES.scale.min, max: TRANSFORM_RANGES.scale.max, default: [1, 1, 1] },
};
const TRANSFORM_CONTROLS = [
  { bucket: 'transform', key: 'position', label: 'POSITION', kind: 'vec3', min: -1.5, max: 1.5, step: 0.05 },
  { bucket: 'transform', key: 'rotation', label: 'ROTATION', kind: 'vec3', min: -180, max: 180, step: 5, unit: 'deg' },
  { bucket: 'transform', key: 'scale', label: 'SCALE', kind: 'uniform-scale', min: 0.4, max: 2.2, step: 0.02 },
];

export const ELEMENT_CATALOG = {
  'glass-petal-sphere': {
    type: 'glass-petal-sphere',
    label: 'Glass Petal Sphere',
    category: 'glass',
    description: 'Five-petal tapered-torus transmission-glass shell wrapped around the sheet.',
    // Rendered today by the existing Holo Paper `glass` state/mesh — real
    // preview support. Cloud Run final-frame rendering (art-scene-v2) is
    // Phase 6+ work, so this is PREVIEW ONLY for export until that lands.
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 6,
    defaultEnabled: false,
    defaultDepth: 'hero',
    // Only one instance of this type can actually drive the three.js scene
    // (there is exactly one `world.glassMesh`). Additional instances
    // (Duplicate) are data-only — see elements/scene-elements.js.
    singleInstanceRenderer: true,
    // Conservative LOCAL bounding-sphere radius (world units, at scale 1) —
    // elements/placement.js multiplies this by the instance's own authored
    // scale to get the world-space radius used for frame/safe-zone checks. A
    // sphere is exact here (not just "conservative enough"): every mesh in
    // this shell is built with its own local origin at this object's origin,
    // and its only motion (glass.rotate) is a rotation through that same
    // origin — rotation about a fixed origin never changes any point's
    // distance FROM that origin, so the static geometry's bounding sphere is
    // already an exact bound on everything the animation can ever occupy.
    // makePetalGeo (ClothStudio.jsx): max R=1.08, max tube=0.21 (PETALS[]
    // below). A torus vertex's tube-local offset is bounded by `tube` before
    // the taper-shaping; after it, X/Y offset from the ring point is at most
    // 0.5*tube≈0.105 and the replaced Z is at most tube*2.3≈0.483 (taper
    // maxes at 1). Max distance from origin ≈ sqrt((1.08+0.105)² + 0.483²)
    // ≈ 1.28 — rounded up for margin. (Each petal's own PETALS[].rot is a
    // rotation about the shared origin, so it doesn't change this bound —
    // same invariant as the animation argument above.)
    bounds: { localRadius: 1.35 },
    // The hero centerpiece is DESIGNED to sit on/around the artwork (its own
    // description: "wrapped around the sheet") — an artwork-safe-zone
    // overlap is expected, not a placement mistake. Frame-edge clipping is
    // still flagged normally; only the safe-zone code is downgraded to
    // "intentional-overlap" (see placement.js placementWarningForInstance).
    intentionalOverlap: true,
    // Validation/clamping bounds per nested bucket — consumed generically by
    // elements/validators.js via elements/schema.js. Every key declared here
    // is the ONLY key that can ever reach a normalized instance; anything
    // else in raw input is dropped.
    fieldSpec: {
      transform: {
        position: { type: 'vec3', min: -1.5, max: 1.5, default: [0, 0, 0] },
        // Degrees (matches this file's existing shotCam.az/el convention) —
        // converted to radians only at the point of applying to three.js.
        rotation: { type: 'vec3', min: -180, max: 180, default: [0, 0, 0] },
        // Vector-shaped so the schema is per-axis-ready, but the UI only
        // exposes ONE uniform scale control (see controls below) — per-axis
        // scale UI is deferred, not the data shape.
        scale: { type: 'vec3', min: 0.4, max: 2.2, default: [1, 1, 1] },
      },
      material: {
        tint: { type: 'color', default: '#ffffff' },
        clarity: { type: 'number', min: 0, max: 0.4, default: 0.06 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        rotSpeed: { type: 'number', min: 0.05, max: 2, default: 0.4 },
      },
      appearance: {}, // no fields yet for this type — anything raw is dropped
    },
    // Declarative UI control metadata for this type ONLY — the Inspector's
    // glass branch is hand-written (special-cased, untouched since Phase 1)
    // and does not read this array. Kept for documentation/tests.
    controls: [
      { field: 'position.x', label: 'POSITION X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05 },
      { field: 'position.y', label: 'POSITION Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05 },
      { field: 'position.z', label: 'POSITION Z', kind: 'slider', min: -1.5, max: 1.5, step: 0.05 },
      { field: 'rotation.x', label: 'ROTATION X', kind: 'slider', min: -180, max: 180, step: 5, unit: 'deg' },
      { field: 'rotation.y', label: 'ROTATION Y', kind: 'slider', min: -180, max: 180, step: 5, unit: 'deg' },
      { field: 'rotation.z', label: 'ROTATION Z', kind: 'slider', min: -180, max: 180, step: 5, unit: 'deg' },
      { field: 'scale', label: 'SCALE', kind: 'slider', min: 0.4, max: 2.2, step: 0.02, uniform: true },
      { field: 'rotate', label: 'ROTATE', kind: 'toggle' },
      { field: 'rotSpeed', label: 'ROTATE SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
      { field: 'clarity', label: 'CLARITY', kind: 'slider', min: 0, max: 0.4, step: 0.01 },
      { field: 'tint', label: 'TINT', kind: 'color' },
    ],
    presets: [
      { id: 'clear-crystal', label: 'Clear Crystal', values: { scale: 1, tint: '#ffffff', clarity: 0.02, rotate: true, rotSpeed: 0.3 } },
      { id: 'rose-tint', label: 'Rose Tint', values: { scale: 1.15, tint: '#f4c9d8', clarity: 0.1, rotate: true, rotSpeed: 0.5 } },
      { id: 'slow-drift', label: 'Slow Drift', values: { scale: 0.85, tint: '#dfeef8', clarity: 0.18, rotate: true, rotSpeed: 0.1 } },
    ],
    // Safe randomization ranges — deliberately the same bounds as the shipped
    // sliders, so "randomize" can never produce an out-of-spec scene. Scoped
    // to material/motion/scale only — position/rotation stay untouched by
    // randomize until safe-zone/collision guardrails exist (later phase).
    randomRanges: {
      scale: [0.4, 2.2],
      rotSpeed: [0.05, 2],
      clarity: [0, 0.4],
      tintPalette: ['#ffffff', '#f4c9d8', '#dfeef8', '#fff3d0', '#e6dcff', '#d8f5ec'],
    },
    quality: { minTier: 'draft', estimatedCost: 6 },
  },

  // ── Phase 2 — first professional pack. All five share the bucket/key
  // control convention (`controls: [{bucket,key,...}]`, `randomRanges:
  // {material:{},motion:{},appearance:{}}`, nested preset `values`) that the
  // generic Inspector/randomizer (elements/scene-elements.js) drive off of —
  // unlike glass, which stays hand-wired to its own `glass` state. ──

  'kinetic-rings': {
    type: 'kinetic-rings',
    label: 'Kinetic Rings',
    category: 'geometry',
    description: 'One to five independently-orbiting rings encircling the sheet.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Local bounding-sphere radius at the TOPOLOGY MAXIMUM (count=5, the
    // widest ring: R=0.55+4*0.14=1.11, +tube 0.025) — factories.js
    // ringsRebuild. Rotation-about-origin invariant (see the glass entry's
    // comment above) means this is exact regardless of orbit speed/motion.
    // Rounded up from 1.135 for margin.
    bounds: { localRadius: 1.2 },
    // Rings are DESIGNED to encircle the artwork — safe-zone overlap is the
    // entire point of this element, not an accident.
    intentionalOverlap: true,
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#7dd3fc' },
        metalness: { type: 'number', min: 0, max: 1, default: 0.85 },
        roughness: { type: 'number', min: 0, max: 1, default: 0.15 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.5 },
      },
      appearance: {
        count: { type: 'number', min: 1, max: 5, default: 3 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'RING COUNT', kind: 'slider', min: 1, max: 5, step: 1 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'metalness', label: 'METALNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'ORBIT', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'ORBIT SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'chrome-orbit', label: 'Chrome Orbit', values: { material: { color: '#d8dce2', metalness: 1, roughness: 0.08 }, appearance: { count: 3 }, motion: { speed: 0.4 } } },
      { id: 'glass-halo', label: 'Glass Halo', values: { material: { color: '#eaf6ff', metalness: 0.1, roughness: 0.05 }, appearance: { count: 2 }, motion: { speed: 0.25 } } },
      { id: 'neon-rings', label: 'Neon Rings', values: { material: { color: '#ff5fce', metalness: 0.6, roughness: 0.3 }, appearance: { count: 5 }, motion: { speed: 0.9 } } },
    ],
    randomRanges: {
      material: { color: ['#7dd3fc', '#d8dce2', '#eaf6ff', '#ff5fce', '#ffe08a', '#c9f7d0'], metalness: [0.2, 1], roughness: [0.02, 0.5] },
      motion: { speed: [0.1, 1.5] },
      appearance: { count: [1, 5] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  'chrome-ribbon': {
    type: 'chrome-ribbon',
    label: 'Chrome Ribbon',
    category: 'geometry',
    description: 'A twisted metallic ribbon tracing a sine-wave path behind the sheet.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Local bounding-sphere radius — factories.js ribbonRebuild's curve
    // spans x in [-0.8,0.8] (dominant term, `twists` only changes frequency
    // of the y/z sine terms, not their amplitude, so it's topology-max-
    // independent), plus a cross-section buffer. Rotation-about-origin
    // invariant applies here too (ribbonAnimate only rotates motion, never
    // translates it), so this bound holds through the drift animation.
    bounds: { localRadius: 0.9 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#d8dce2' },
        roughness: { type: 'number', min: 0, max: 1, default: 0.2 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.4 },
      },
      appearance: {
        twists: { type: 'number', min: 1, max: 4, default: 2 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'twists', label: 'TWISTS', kind: 'slider', min: 1, max: 4, step: 1 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'DRIFT', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'DRIFT SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'polished-steel', label: 'Polished Steel', values: { material: { color: '#c7cbd1', roughness: 0.06 }, appearance: { twists: 2 } } },
      { id: 'rose-gold', label: 'Rose Gold', values: { material: { color: '#e8b7a4', roughness: 0.15 }, appearance: { twists: 3 } } },
      { id: 'gunmetal', label: 'Gunmetal', values: { material: { color: '#41454b', roughness: 0.3 }, appearance: { twists: 1 } } },
    ],
    randomRanges: {
      material: { color: ['#d8dce2', '#c7cbd1', '#e8b7a4', '#41454b', '#f4e7c7'], roughness: [0.02, 0.5] },
      motion: { speed: [0.1, 1.2] },
      appearance: { twists: [1, 4] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  'translucent-monoliths': {
    type: 'translucent-monoliths',
    label: 'Translucent Monoliths',
    category: 'architectural',
    description: 'One to six frosted acrylic columns standing behind the sheet.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Local bounding-sphere radius at topology max (count=6, spacing=0.32 —
    // factories.js monolithsRebuild): outermost box center at ±0.8, box
    // half-extents (0.08,0.5,0.08) → farthest corner = sqrt(0.88²+0.5²+0.08²)
    // = 1.0153. Rounded up minimally for margin — this feeds a perspective
    // feasibility search where every extra tenth costs real reachable scale,
    // so precision matters more here than it used to.
    bounds: { localRadius: 1.02 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#e8f2ff' },
        opacity: { type: 'number', min: 0.1, max: 0.6, default: 0.35 },
      },
      motion: {
        rotate: { type: 'boolean', default: false },
        speed: { type: 'number', min: 0.05, max: 1, default: 0.2 },
      },
      appearance: {
        count: { type: 'number', min: 1, max: 6, default: 3 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'COLUMN COUNT', kind: 'slider', min: 1, max: 6, step: 1 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'opacity', label: 'OPACITY', kind: 'slider', min: 0.1, max: 0.6, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'DRIFT', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'DRIFT SPEED', kind: 'slider', min: 0.05, max: 1, step: 0.05 },
    ],
    presets: [
      { id: 'gallery-frost', label: 'Gallery Frost', values: { material: { color: '#f4f4f6', opacity: 0.3 }, appearance: { count: 3 } } },
      { id: 'midnight-glass', label: 'Midnight Glass', values: { material: { color: '#1b2740', opacity: 0.45 }, appearance: { count: 5 } } },
      { id: 'sunrise-tint', label: 'Sunrise Tint', values: { material: { color: '#ffd9b0', opacity: 0.25 }, appearance: { count: 2 } } },
    ],
    randomRanges: {
      material: { color: ['#e8f2ff', '#f4f4f6', '#1b2740', '#ffd9b0', '#d9ffe6'], opacity: [0.15, 0.55] },
      motion: { speed: [0.05, 0.8] },
      appearance: { count: [1, 6] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  'liquid-glass-lens': {
    type: 'liquid-glass-lens',
    label: 'Liquid-Glass Lens',
    category: 'glass',
    description: 'A thick refractive disc that magnifies whatever sits behind it.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 6,
    defaultEnabled: true,
    defaultDepth: 'foreground',
    // Local bounding-sphere radius — factories.js lensRebuild's disc: radius
    // 0.45, half-thickness 0.06 → sqrt(0.45²+0.06²) = 0.4540. No appearance
    // fields, so this doesn't vary by topology. Rounded up minimally for
    // margin — see the translucent-monoliths entry for why precision matters
    // here now.
    bounds: { localRadius: 0.46 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        tint: { type: 'color', default: '#ffffff' },
        clarity: { type: 'number', min: 0, max: 0.4, default: 0.05 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.3 },
      },
      appearance: {},
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'material', key: 'tint', label: 'TINT', kind: 'color' },
      { bucket: 'material', key: 'clarity', label: 'CLARITY', kind: 'slider', min: 0, max: 0.4, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'ROTATE', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'ROTATE SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'clear-lens', label: 'Clear Lens', values: { material: { tint: '#ffffff', clarity: 0.02 } } },
      { id: 'amber-lens', label: 'Amber Lens', values: { material: { tint: '#f4c98a', clarity: 0.12 } } },
      { id: 'arctic-lens', label: 'Arctic Lens', values: { material: { tint: '#cfeaff', clarity: 0.18 } } },
    ],
    randomRanges: {
      material: { tint: ['#ffffff', '#f4c98a', '#cfeaff', '#f4c9d8', '#dfeef8'], clarity: [0, 0.35] },
      motion: { speed: [0.1, 1.5] },
    },
    quality: { minTier: 'draft', estimatedCost: 6 },
  },

  'floating-media-frame': {
    type: 'floating-media-frame',
    label: 'Floating Media Frame',
    category: 'media',
    description: 'A bordered frame floating near the sheet. Ships with a placeholder content pane — real artwork mapping is later-phase work.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 3,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Local bounding-sphere radius — factories.js frameRebuild's plane pair:
    // w=0.7,h=0.9, centered at the origin → sqrt(0.35²+0.45²) ≈ 0.570.
    // frameAnimate only oscillates rotation.y within ±0.25 rad (bounded, not
    // continuous) but the rotation-about-origin invariant makes this bound
    // exact for ANY rotation angle, bounded or not. Rounded up for margin.
    bounds: { localRadius: 0.65 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#202225' },
        opacity: { type: 'number', min: 0.4, max: 1, default: 0.9 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 1, default: 0.15 },
      },
      appearance: {
        borderWidth: { type: 'number', min: 0.02, max: 0.2, default: 0.06 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'borderWidth', label: 'BORDER WIDTH', kind: 'slider', min: 0.02, max: 0.2, step: 0.01 },
      { bucket: 'material', key: 'color', label: 'FRAME COLOR', kind: 'color' },
      { bucket: 'material', key: 'opacity', label: 'CONTENT OPACITY', kind: 'slider', min: 0.4, max: 1, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'DRIFT', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'DRIFT SPEED', kind: 'slider', min: 0.05, max: 1, step: 0.05 },
    ],
    presets: [
      { id: 'gallery-black', label: 'Gallery Black', values: { material: { color: '#101114', opacity: 0.95 }, appearance: { borderWidth: 0.05 } } },
      { id: 'brushed-metal', label: 'Brushed Metal', values: { material: { color: '#9aa0a8', opacity: 0.85 }, appearance: { borderWidth: 0.08 } } },
      { id: 'gold-leaf', label: 'Gold Leaf', values: { material: { color: '#c9a24a', opacity: 0.9 }, appearance: { borderWidth: 0.1 } } },
    ],
    randomRanges: {
      material: { color: ['#101114', '#9aa0a8', '#c9a24a', '#eef1f4', '#3a2f28'], opacity: [0.5, 1] },
      motion: { speed: [0.05, 0.7] },
      appearance: { borderWidth: [0.02, 0.18] },
    },
    quality: { minTier: 'draft', estimatedCost: 3 },
  },

  // ── Phase 3 — homepage particle hero (docs/plans/ORIGINAL-STUDIO-
  // CINEMATIC-SETS-4K-PLAN.md). elements/particle-math.js is a byte-faithful
  // extraction of ox.jsx's ParticleSwarm formula (verified against an
  // independent oracle in its own test file) — ox.jsx itself is untouched.
  // The homepage's own camera (z=100, fov=60) and this Studio's (z=2.6,
  // fov=40) are wildly different scales; STUDIO_SCALE_RATIO below rescales
  // every shape param by the ratio of the two cameras' Z=0 frame half-
  // heights, so the swarm reads as the same shape at Studio's scale rather
  // than either invisible or blown out. `particleSize` is NOT scaled by this
  // ratio — it's a per-dot render size, not a shape dimension, and scaling
  // it by ~1/61 would make every particle sub-pixel; it's set directly for
  // Studio's own scale instead.
  'homepage-particle-hero': {
    type: 'homepage-particle-hero',
    label: 'Homepage Particle Hero',
    category: 'particles',
    description: 'The homepage’s stereographic-projected particle swarm, rescaled to this Studio’s camera. A full-scene atmospheric backdrop, not a small accent — it deliberately wraps the whole sheet.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 8,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Local bounding-sphere radius — empirically sampled (not hand-derived):
    // computeParticleTarget's actual (x,y,z) output, swept across many
    // (index, time) combinations AND across this type's full appearance-
    // slider range (chaos/waveAmplitude are NOT topology fields — see
    // heroTopologySignature in factories.js — so a user can dial either to
    // its max WITHOUT triggering a geometry rebuild; the declared bound must
    // still cover that, same as every other type's bound covers its
    // topology maximum), tops out around 2.05 world units from the origin at
    // PARTICLE_SCALE (factories.js) and max chaos/waveAmplitude. Rounded up
    // for margin.
    bounds: { localRadius: 2.1 },
    // Deliberately wraps/surrounds the artwork, same design intent as
    // Kinetic Rings — an artwork-safe-zone overlap is the point, not a
    // placement mistake.
    intentionalOverlap: true,
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {},
      motion: {
        rotate: { type: 'boolean', default: true }, // "FLOW" — whether the swarm's internal simulation time advances at all
        speed: { type: 'number', min: 0.05, max: 2, default: 1 }, // multiplies ox.jsx's speedMult*animationSpeed together into one control
      },
      appearance: {
        particleCount: { type: 'number', min: 50, max: 1200, default: 400 },
        chaos: { type: 'number', min: 0, max: 1.5, default: 0.8 },
        flow: { type: 'number', min: 0, max: 2, default: 0.6 },
        waveAmplitude: { type: 'number', min: 0, max: 0.3, default: 0.098 },
        hueSpeed: { type: 'number', min: 0, max: 0.1, default: 0.02 },
        saturation: { type: 'number', min: 0, max: 1, default: 0.85 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'particleCount', label: 'PARTICLE COUNT', kind: 'slider', min: 50, max: 1200, step: 50 },
      { bucket: 'appearance', key: 'chaos', label: 'CHAOS', kind: 'slider', min: 0, max: 1.5, step: 0.05 },
      { bucket: 'appearance', key: 'flow', label: 'FLOW RATE', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { bucket: 'appearance', key: 'waveAmplitude', label: 'WAVE AMPLITUDE', kind: 'slider', min: 0, max: 0.3, step: 0.01 },
      { bucket: 'appearance', key: 'hueSpeed', label: 'HUE DRIFT SPEED', kind: 'slider', min: 0, max: 0.1, step: 0.005 },
      { bucket: 'appearance', key: 'saturation', label: 'SATURATION', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'FLOW', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'FLOW SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'homepage-classic', label: 'Homepage Classic', values: { appearance: { chaos: 0.8, flow: 0.6, waveAmplitude: 0.098, hueSpeed: 0.02, saturation: 0.85 }, motion: { speed: 1 } } },
      { id: 'calm-drift', label: 'Calm Drift', values: { appearance: { chaos: 0.3, flow: 0.3, waveAmplitude: 0.04, hueSpeed: 0.01, saturation: 0.7 }, motion: { speed: 0.5 } } },
      { id: 'storm', label: 'Storm', values: { appearance: { chaos: 1.4, flow: 1.5, waveAmplitude: 0.24, hueSpeed: 0.06, saturation: 1 }, motion: { speed: 1.8 } } },
    ],
    randomRanges: {
      motion: { speed: [0.3, 1.8] },
      appearance: { chaos: [0.2, 1.4], flow: [0.2, 1.6], waveAmplitude: [0.02, 0.24], hueSpeed: [0.005, 0.07], saturation: [0.5, 1] },
    },
    quality: { minTier: 'draft', estimatedCost: 8 },
  },

  // ── Phase 3 — GLB import (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-
  // PLAN.md "GLB import and asset safety"). Rendered by elements/factories.js
  // glb* functions + elements/glb-loader.js's normalize/override helpers.
  // `appearance.assetId` is a REFERENCE (a Firestore doc id from the
  // admin-only /api/dashboard/studio-assets library — components/
  // GlbAssetControl.jsx), not catalog-fixed data, hence the new `'string'`
  // field type (validators.js) rather than 'enum'.
  'glb-import': {
    type: 'glb-import',
    label: 'GLB Import',
    category: 'media',
    description: 'An uploaded, admin-approved .glb model — Draco/Meshopt/KTX2 supported, animation-selectable, material overrides.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 7,
    defaultEnabled: true,
    defaultDepth: 'hero',
    // Every loaded GLB is normalized (elements/glb-loader.js
    // normalizeGLBTransform, factories.js GLB_NORMALIZE_TARGET_RADIUS) so
    // its STATIC bind-pose bounding sphere is exactly radius 0.4 — NOT a
    // full unit sphere like the "scale=1" convention other types loosely
    // suggest. That was a deliberate, measured correction: at radius 1.0,
    // the real placement search (elements/placement.js
    // defaultTransformForFormat) cannot clear frame+safe-zone in ANY
    // format within TRANSFORM_RANGES — genuinely too large, the same
    // constraint translucent-monoliths' 1.02 already runs into. 0.4 was
    // found by probing downward until every format cleared comfortably
    // again; it lands close to liquid-glass-lens's own established,
    // working radius. 0.46 here (not 0.4) is a further, SEPARATE margin on
    // top of that, for a WEAKER guarantee the other six types' bounds
    // don't need (all proven exact for every possible animation state —
    // see their own comments): an uploaded GLB's own animation clips can,
    // in principle, translate a node beyond the static bind-pose bound —
    // documented honestly rather than claimed as exact.
    bounds: { localRadius: 0.46 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        overrideEnabled: { type: 'boolean', default: false },
        tint: { type: 'color', default: '#ffffff' },
        metalness: { type: 'number', min: 0, max: 1, default: 0.5 },
        roughness: { type: 'number', min: 0, max: 1, default: 0.5 },
      },
      // 'rotate'/'speed' repurposed as PLAY/SPEED for the model's own
      // AnimationMixer — same precedent as homepage-particle-hero's
      // motion.rotate driving its "FLOW" toggle instead of literal spin.
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 1 },
      },
      appearance: {
        assetId: { type: 'string', maxLength: 64, default: '' },
        animationClip: { type: 'string', maxLength: 128, default: '' },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      // Custom control kind — StudioElementInspector.jsx renders
      // GlbAssetControl for this one, which owns both appearance.assetId
      // AND appearance.animationClip (the animation list depends on which
      // asset is selected, so they're one coupled control, not two
      // independent bucket/key sliders).
      { bucket: 'appearance', key: 'assetId', label: 'GLB ASSET', kind: 'glb-asset' },
      { bucket: 'motion', key: 'rotate', label: 'PLAY ANIMATION', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'ANIMATION SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
      { bucket: 'material', key: 'overrideEnabled', label: 'MATERIAL OVERRIDE', kind: 'toggle' },
      { bucket: 'material', key: 'tint', label: 'OVERRIDE TINT', kind: 'color' },
      { bucket: 'material', key: 'metalness', label: 'OVERRIDE METALNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'roughness', label: 'OVERRIDE ROUGHNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
    ],
    // No presets — a preset's `values` are catalog-fixed, but the one field
    // that actually defines "the look" here (which uploaded asset) is a
    // per-deployment reference no catalog entry can bake in.
    presets: [],
    // No safe randomization ranges either, for the same reason —
    // randomizing this type would only ever touch transform/material-
    // override (never asset selection, which stays deliberately manual).
    randomRanges: {
      material: { metalness: [0, 1], roughness: [0, 1] },
      motion: { speed: [0.2, 1.8] },
    },
    quality: { minTier: 'draft', estimatedCost: 7 },
  },

  // ── Phase 4 — Optical pack (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-
  // PLAN.md "Element library" #3-5). First of five bounded Phase 4 packs;
  // the other two "Glass and optical" entries (Glass Petal Sphere,
  // Liquid-Glass Lens) already shipped in Phase 1/2. Same procedural-
  // geometry, no-custom-shader approach as every Phase 2 element — no new
  // rendering technique introduced, just new shapes/material combinations
  // built from the same THREE.MeshPhysicalMaterial vocabulary
  // translucent-monoliths/liquid-glass-lens already established.

  'prismatic-slab': {
    type: 'prismatic-slab',
    label: 'Prismatic Slab',
    category: 'glass',
    description: 'A beveled acrylic/glass monolith with iridescence, dispersion, internal tint, and a soft emissive edge glow.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'foreground',
    // Local bounding-sphere radius — factories.js slabRebuild's RoundedBox:
    // half-extents (0.3, 0.45, thickness/2) at topology-max thickness=0.3
    // (appearance.thickness range), plus the 0.04 bevel radius. Farthest
    // corner = sqrt(0.3²+0.45²+0.15²+bevel) ≈ sqrt(0.09+0.2025+0.0225) =
    // 0.561. Rotation-about-origin invariant (slabAnimate only rotates
    // motion, same as every Phase 2 type) makes this exact regardless of
    // spin. Rounded up for margin.
    bounds: { localRadius: 0.6 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        tint: { type: 'color', default: '#eaf6ff' },
        iridescence: { type: 'number', min: 0, max: 1, default: 0.6 },
        dispersion: { type: 'number', min: 0, max: 1, default: 0.3 },
        edgeGlow: { type: 'number', min: 0, max: 1, default: 0.25 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.3 },
      },
      appearance: {
        thickness: { type: 'number', min: 0.08, max: 0.3, default: 0.15 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'thickness', label: 'THICKNESS', kind: 'slider', min: 0.08, max: 0.3, step: 0.01 },
      { bucket: 'material', key: 'tint', label: 'TINT', kind: 'color' },
      { bucket: 'material', key: 'iridescence', label: 'IRIDESCENCE', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'dispersion', label: 'DISPERSION', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'edgeGlow', label: 'EDGE GLOW', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'ROTATE', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'ROTATE SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'clear-prism', label: 'Clear Prism', values: { material: { tint: '#ffffff', iridescence: 0.4, dispersion: 0.5, edgeGlow: 0.1 } } },
      { id: 'aurora-slab', label: 'Aurora Slab', values: { material: { tint: '#cfeaff', iridescence: 0.85, dispersion: 0.3, edgeGlow: 0.4 } } },
      { id: 'amber-glow', label: 'Amber Glow', values: { material: { tint: '#f4c98a', iridescence: 0.2, dispersion: 0.15, edgeGlow: 0.6 } } },
    ],
    randomRanges: {
      material: { tint: ['#ffffff', '#cfeaff', '#f4c98a', '#f4c9d8', '#dfeef8'], iridescence: [0, 1], dispersion: [0, 0.6], edgeGlow: [0, 0.6] },
      motion: { speed: [0.1, 1.5] },
      appearance: { thickness: [0.08, 0.3] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  'iridescent-film': {
    type: 'iridescent-film',
    label: 'Iridescent Film',
    category: 'glass',
    description: 'A thin waving holographic sheet — amplitude, frequency, and curl drive a real per-vertex wave, not a shader trick.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Local bounding-sphere radius — a fixed 1.2x0.8 plane's half-diagonal
    // (sqrt(0.6²+0.4²) ≈ 0.721) plus the topology-max wave displacement
    // along local Z (appearance.amplitude range, max 0.15). The vertex
    // wave only ever moves a point along local Z (see filmAnimate) — its
    // XY position, and therefore its in-plane distance-from-origin
    // component, never changes — so the two combine via Pythagoras exactly
    // (not just conservatively): sqrt(0.721²+0.15²) ≈ 0.736. The
    // rotation-about-origin invariant (filmAnimate's rotate control) then
    // applies on top of that, same as every other type. Rounded up.
    bounds: { localRadius: 0.8 },
    intentionalOverlap: false,
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        tint: { type: 'color', default: '#eaf6ff' },
        iridescence: { type: 'number', min: 0, max: 1, default: 0.75 },
        translucency: { type: 'number', min: 0.3, max: 1, default: 0.7 },
      },
      motion: {
        rotate: { type: 'boolean', default: true }, // whether the wave animates at all
        speed: { type: 'number', min: 0.05, max: 2, default: 0.6 },
      },
      appearance: {
        amplitude: { type: 'number', min: 0, max: 0.15, default: 0.06 },
        frequency: { type: 'number', min: 0.5, max: 4, default: 1.5 },
        curl: { type: 'number', min: 0, max: 1, default: 0.3 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'amplitude', label: 'WAVE AMPLITUDE', kind: 'slider', min: 0, max: 0.15, step: 0.005 },
      { bucket: 'appearance', key: 'frequency', label: 'WAVE FREQUENCY', kind: 'slider', min: 0.5, max: 4, step: 0.1 },
      { bucket: 'appearance', key: 'curl', label: 'CURL', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'tint', label: 'TINT', kind: 'color' },
      { bucket: 'material', key: 'iridescence', label: 'SPECTRAL INTENSITY', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'translucency', label: 'TRANSLUCENCY', kind: 'slider', min: 0.3, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'FLUTTER', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'FLUTTER SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'soft-shimmer', label: 'Soft Shimmer', values: { appearance: { amplitude: 0.03, frequency: 1, curl: 0.15 }, material: { iridescence: 0.5, translucency: 0.85 } } },
      { id: 'holo-flag', label: 'Holo Flag', values: { appearance: { amplitude: 0.1, frequency: 2, curl: 0.5 }, material: { iridescence: 0.9, translucency: 0.6 } } },
      { id: 'still-sheet', label: 'Still Sheet', values: { appearance: { amplitude: 0.01, frequency: 0.5, curl: 0 }, material: { iridescence: 0.3, translucency: 0.9 } } },
    ],
    randomRanges: {
      material: { tint: ['#eaf6ff', '#f4c9d8', '#fff3d0', '#e6dcff', '#d8f5ec'], iridescence: [0.2, 1], translucency: [0.4, 1] },
      motion: { speed: [0.2, 1.6] },
      appearance: { amplitude: [0, 0.13], frequency: [0.5, 3.5], curl: [0, 1] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  'gel-panels': {
    type: 'gel-panels',
    label: 'Gel Panels',
    category: 'glass',
    description: 'Two to four overlapping transparent colored panels that drift and blend at their intersections.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Local bounding-sphere radius at topology max (count=4 — factories.js
    // panelsRebuild): each panel is a fixed 0.8x0.8 plane offset from the
    // origin by at most 0.1 along local Z for the intersection-blend
    // stagger; half-diagonal sqrt(0.4²+0.4²)≈0.566, combined with the 0.1
    // Z offset (Pythagoras, same in-plane/out-of-plane independence
    // argument as iridescent-film above) → sqrt(0.566²+0.1²)≈0.575.
    // Rotation-about-origin invariant applies on top (panelsAnimate only
    // rotates each panel about its own fixed local origin). Rounded up.
    bounds: { localRadius: 0.6 },
    intentionalOverlap: true, // panels are DESIGNED to overlap each other and the artwork — that's the whole point of "intersection blend"
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#7dd3fc' },
        opacity: { type: 'number', min: 0.15, max: 0.6, default: 0.35 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 1, default: 0.15 },
      },
      appearance: {
        count: { type: 'number', min: 2, max: 4, default: 3 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'PANEL COUNT', kind: 'slider', min: 2, max: 4, step: 1 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'opacity', label: 'OPACITY', kind: 'slider', min: 0.15, max: 0.6, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'DRIFT', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'DRIFT SPEED', kind: 'slider', min: 0.05, max: 1, step: 0.05 },
    ],
    presets: [
      { id: 'cool-gel', label: 'Cool Gel', values: { material: { color: '#7dd3fc', opacity: 0.3 }, appearance: { count: 3 } } },
      { id: 'warm-gel', label: 'Warm Gel', values: { material: { color: '#ffb37a', opacity: 0.4 }, appearance: { count: 4 } } },
      { id: 'mono-gel', label: 'Mono Gel', values: { material: { color: '#e8e8f0', opacity: 0.25 }, appearance: { count: 2 } } },
    ],
    randomRanges: {
      material: { color: ['#7dd3fc', '#ffb37a', '#e8e8f0', '#ff9fd6', '#c9f7d0'], opacity: [0.2, 0.55] },
      motion: { speed: [0.05, 0.8] },
      appearance: { count: [2, 4] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },
  // ── Phase 4 — Reflective/Sculptural pack (docs/plans/ORIGINAL-STUDIO-
  // CINEMATIC-SETS-4K-PLAN.md "Element library" #8-11; #6-7, Chrome Ribbon
  // and Kinetic Rings, already shipped in Phase 2). Same procedural
  // THREE.MeshPhysicalMaterial/MeshStandardMaterial vocabulary as every
  // prior pack. Every declared `bounds.localRadius` below was independently
  // measured (three.js's own `computeBoundingSphere()` at each type's real
  // topology-maximum parameters, run from a standalone Node script — not
  // hand-derived-only) before being rounded up for margin.

  'orb-constellation': {
    type: 'orb-constellation',
    label: 'Orb Constellation',
    category: 'geometry',
    description: 'A cluster of instanced glass/chrome/emissive orbs, evenly distributed on a spherical shell and slowly orbiting as one.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 6,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Measured (bound-check script, count=14/clusterSpread=1/sizeVariance=1
    // — the catalog maxima): every orb CENTER sits at EXACTLY clusterRadius
    // from the origin (spherical-Fibonacci-lattice formula — see
    // factories.js orbUpdateLayout), so farthest-point = clusterRadius +
    // largest orb's own radius = 0.6 + 0.06*2 = 0.72, measured 0.7179.
    // Rotation-about-origin invariant (orbAnimate only rotates the whole
    // InstancedMesh) applies on top. Rounded up for margin.
    bounds: { localRadius: 0.75 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#eaf6ff' },
        metalness: { type: 'number', min: 0, max: 1, default: 0.7 },
        roughness: { type: 'number', min: 0, max: 1, default: 0.2 },
        emissiveStrength: { type: 'number', min: 0, max: 1, default: 0.15 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.3 },
      },
      appearance: {
        count: { type: 'number', min: 4, max: 14, default: 8 },
        clusterSpread: { type: 'number', min: 0.3, max: 1, default: 0.65 },
        sizeVariance: { type: 'number', min: 0, max: 1, default: 0.4 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'ORB COUNT', kind: 'slider', min: 4, max: 14, step: 1 },
      { bucket: 'appearance', key: 'clusterSpread', label: 'CLUSTER SPREAD', kind: 'slider', min: 0.3, max: 1, step: 0.02 },
      { bucket: 'appearance', key: 'sizeVariance', label: 'SIZE VARIANCE', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'metalness', label: 'METALNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'emissiveStrength', label: 'GLOW', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'ORBIT', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'ORBIT SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'chrome-cluster', label: 'Chrome Cluster', values: { material: { color: '#d8dce2', metalness: 1, roughness: 0.1, emissiveStrength: 0 }, appearance: { count: 10, clusterSpread: 0.7, sizeVariance: 0.3 } } },
      { id: 'glass-swarm', label: 'Glass Swarm', values: { material: { color: '#eaf6ff', metalness: 0.1, roughness: 0.05, emissiveStrength: 0.05 }, appearance: { count: 8, clusterSpread: 0.6, sizeVariance: 0.5 } } },
      { id: 'ember-cloud', label: 'Ember Cloud', values: { material: { color: '#ff9d5c', metalness: 0.3, roughness: 0.4, emissiveStrength: 0.6 }, appearance: { count: 12, clusterSpread: 0.85, sizeVariance: 0.6 } } },
    ],
    randomRanges: {
      material: { color: ['#eaf6ff', '#d8dce2', '#ff9d5c', '#c9f7d0', '#ff5fce'], metalness: [0.1, 1], roughness: [0.02, 0.6], emissiveStrength: [0, 0.6] },
      motion: { speed: [0.1, 1.2] },
      appearance: { count: [4, 14], clusterSpread: [0.4, 1], sizeVariance: [0, 0.8] },
    },
    quality: { minTier: 'draft', estimatedCost: 6 },
  },

  'inflatable-forms': {
    type: 'inflatable-forms',
    label: 'Inflatable Forms',
    category: 'geometry',
    description: 'A single glossy inflatable blob that breathes and wobbles — pressure, roundness, and surface finish are all adjustable.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // CORRECTED (external review caught the original derivation getting the
    // order of operations backwards — see factories.js's forms section
    // header comment for the full explanation). `inflation` is a mesh-level
    // scale applied AFTER formsAnimate's per-vertex wobble displacement, so
    // it multiplies the ALREADY-displaced local radius rather than adding to
    // it separately: true max = (restRadius_max + wobble_max) * inflation_max
    // = (0.4 + 0.12) * 1.3 = 0.676, NOT restRadius_max*inflation_max +
    // wobble_max (0.64) as the original comment/bound claimed. Independently
    // re-measured by running the REAL factory (create+applyInstance+animate,
    // at appearance maxima, swept across many frames/phases) and reading the
    // actual rendered vertex positions rather than re-deriving by hand only
    // — confirmed 0.6760000357234999, matching the corrected formula exactly.
    // Rotation-about-origin invariant still applies on top (formsAnimate
    // only rotates motion, never translates it). Rounded up for a larger
    // margin than the original (too-tight) bound had.
    bounds: { localRadius: 0.72 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#ffb37a' },
        roughness: { type: 'number', min: 0, max: 1, default: 0.25 },
        metalness: { type: 'number', min: 0, max: 0.4, default: 0.05 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 1.5, default: 0.4 },
      },
      appearance: {
        inflation: { type: 'number', min: 0.6, max: 1.3, default: 1 },
        wobble: { type: 'number', min: 0, max: 0.12, default: 0.04 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'inflation', label: 'INFLATION', kind: 'slider', min: 0.6, max: 1.3, step: 0.02 },
      { bucket: 'appearance', key: 'wobble', label: 'WOBBLE', kind: 'slider', min: 0, max: 0.12, step: 0.005 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS (MATTE/GLOSS)', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'metalness', label: 'METALNESS', kind: 'slider', min: 0, max: 0.4, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'LIVE', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'DRIFT/WOBBLE SPEED', kind: 'slider', min: 0.05, max: 1.5, step: 0.05 },
    ],
    presets: [
      { id: 'glossy-pillow', label: 'Glossy Pillow', values: { material: { color: '#ffb37a', roughness: 0.08, metalness: 0.02 }, appearance: { inflation: 1.15, wobble: 0.03 } } },
      { id: 'matte-blob', label: 'Matte Blob', values: { material: { color: '#c9c2ff', roughness: 0.7, metalness: 0 }, appearance: { inflation: 0.85, wobble: 0.08 } } },
      { id: 'chrome-bubble', label: 'Chrome Bubble', values: { material: { color: '#d8dce2', roughness: 0.05, metalness: 0.35 }, appearance: { inflation: 1, wobble: 0.02 } } },
    ],
    randomRanges: {
      material: { color: ['#ffb37a', '#c9c2ff', '#d8dce2', '#7dd3fc', '#c9f7d0'], roughness: [0.05, 0.8], metalness: [0, 0.35] },
      motion: { speed: [0.1, 1.2] },
      appearance: { inflation: [0.7, 1.25], wobble: [0, 0.1] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  'mirror-fragments': {
    type: 'mirror-fragments',
    label: 'Mirror Fragments',
    category: 'geometry',
    description: 'Two to six floating reflective shards, fanned around one shared pivot with adjustable spread and camera-facing bias.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'foreground',
    // Every shard shares the group's own local origin — fanned by rotation
    // ONLY (factories.js mirrorRebuild/mirrorUpdateLayout never translate a
    // shard), so the rotation-about-origin invariant makes a single shard's
    // own bounding sphere the exact bound for the whole fan regardless of
    // spread/cameraFacingBias/stagger. Measured (bound-check script):
    // PlaneGeometry(0.35, 0.55)'s half-diagonal = 0.3260. Rounded up.
    bounds: { localRadius: 0.35 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#e4e8ee' },
        metalness: { type: 'number', min: 0.5, max: 1, default: 0.95 },
        roughness: { type: 'number', min: 0, max: 0.5, default: 0.08 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 1.5, default: 0.3 },
      },
      appearance: {
        count: { type: 'number', min: 2, max: 6, default: 4 },
        spread: { type: 'number', min: 20, max: 150, default: 70 },
        cameraFacingBias: { type: 'number', min: 0, max: 1, default: 0.4 },
        stagger: { type: 'number', min: 0, max: 1, default: 0.5 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'SHARD COUNT', kind: 'slider', min: 2, max: 6, step: 1 },
      { bucket: 'appearance', key: 'spread', label: 'FAN SPREAD', kind: 'slider', min: 20, max: 150, step: 2, unit: 'deg' },
      { bucket: 'appearance', key: 'cameraFacingBias', label: 'CAMERA-FACING BIAS', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'appearance', key: 'stagger', label: 'REVEAL STAGGER', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'color', label: 'TINT', kind: 'color' },
      { bucket: 'material', key: 'metalness', label: 'METALNESS', kind: 'slider', min: 0.5, max: 1, step: 0.01 },
      { bucket: 'material', key: 'roughness', label: 'REFLECTION ROUGHNESS', kind: 'slider', min: 0, max: 0.5, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'SWAY', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'SWAY SPEED', kind: 'slider', min: 0.05, max: 1.5, step: 0.05 },
    ],
    presets: [
      { id: 'wide-fan', label: 'Wide Fan', values: { appearance: { count: 6, spread: 130, cameraFacingBias: 0.2, stagger: 0.7 }, material: { metalness: 0.98, roughness: 0.04 } } },
      { id: 'tight-shards', label: 'Tight Shards', values: { appearance: { count: 3, spread: 30, cameraFacingBias: 0.6, stagger: 0.3 }, material: { metalness: 0.9, roughness: 0.15 } } },
      { id: 'rose-mirror', label: 'Rose Mirror', values: { appearance: { count: 4, spread: 70, cameraFacingBias: 0.4, stagger: 0.5 }, material: { color: '#f4c9d8', metalness: 0.92, roughness: 0.1 } } },
    ],
    randomRanges: {
      material: { color: ['#e4e8ee', '#f4c9d8', '#cfeaff', '#d8dce2', '#ffe08a'], metalness: [0.6, 1], roughness: [0, 0.35] },
      motion: { speed: [0.1, 1.2] },
      appearance: { count: [2, 6], spread: [30, 140], cameraFacingBias: [0, 1], stagger: [0, 1] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  'logo-sculpture': {
    type: 'logo-sculpture',
    label: 'Logo Sculpture',
    category: 'geometry',
    description: 'A beveled, extruded abstract emblem — a procedural sculptural silhouette (not an uploaded brand mark; wiring a client’s actual logo is later-phase work), with edge glow and slow spin.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Measured (bound-check script, depth/bevel at their catalog maxima
    // 0.22/0.05, after geo.center()): 0.4842. Rotation-about-origin
    // invariant applies on top (sculptureAnimate only rotates motion).
    // Rounded up for margin.
    bounds: { localRadius: 0.52 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        tint: { type: 'color', default: '#eaf6ff' },
        metalness: { type: 'number', min: 0, max: 1, default: 0.6 },
        roughness: { type: 'number', min: 0, max: 1, default: 0.25 },
        edgeGlow: { type: 'number', min: 0, max: 1, default: 0.3 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.4 },
      },
      appearance: {
        depth: { type: 'number', min: 0.06, max: 0.22, default: 0.12 },
        bevel: { type: 'number', min: 0.005, max: 0.05, default: 0.02 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'depth', label: 'DEPTH', kind: 'slider', min: 0.06, max: 0.22, step: 0.01 },
      { bucket: 'appearance', key: 'bevel', label: 'BEVEL', kind: 'slider', min: 0.005, max: 0.05, step: 0.005 },
      { bucket: 'material', key: 'tint', label: 'TINT', kind: 'color' },
      { bucket: 'material', key: 'metalness', label: 'METALNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'edgeGlow', label: 'EDGE GLOW', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'SPIN', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'SPIN SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'polished-emblem', label: 'Polished Emblem', values: { material: { tint: '#eaf6ff', metalness: 0.85, roughness: 0.08, edgeGlow: 0.15 }, appearance: { depth: 0.14, bevel: 0.03 } } },
      { id: 'matte-monolith', label: 'Matte Monolith', values: { material: { tint: '#20242c', metalness: 0.1, roughness: 0.6, edgeGlow: 0.5 }, appearance: { depth: 0.2, bevel: 0.015 } } },
      { id: 'gold-mark', label: 'Gold Mark', values: { material: { tint: '#c9a24a', metalness: 0.9, roughness: 0.15, edgeGlow: 0.2 }, appearance: { depth: 0.16, bevel: 0.04 } } },
    ],
    randomRanges: {
      material: { tint: ['#eaf6ff', '#20242c', '#c9a24a', '#f4c9d8', '#7dd3fc'], metalness: [0.1, 1], roughness: [0.05, 0.7], edgeGlow: [0, 0.6] },
      motion: { speed: [0.1, 1.5] },
      appearance: { depth: [0.08, 0.2], bevel: [0.008, 0.045] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  // ── Phase 4 — Architectural pack (docs/plans/ORIGINAL-STUDIO-CINEMATIC-
  // SETS-4K-PLAN.md "Element library" #14-17; #12-13, Translucent Monoliths
  // and Floating Media Frames, already shipped in Phase 2). Same procedural
  // vocabulary as every prior pack. `bounds.localRadius` below is a
  // PLACEHOLDER pending the mandatory real-factory measurement pass (the
  // discipline external review made mandatory after the Inflatable Forms
  // bound bug) — do not treat as final until that measurement lands.

  'light-tubes': {
    type: 'light-tubes',
    label: 'Light Tubes',
    category: 'architectural',
    description: 'A thin glowing tube tracing a gentle path behind the sheet — temperature, intensity, and flicker, self-illuminated (no separate scene light).',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // MEASURED by running the real factory (create -> applyInstance -> 300
    // animate() frames at appearance maxima curl=3, reading actual rendered
    // vertex positions, not hand-derived only — the discipline external
    // review made mandatory after the Inflatable Forms bound bug): 0.7799.
    // The path's own endpoint (x=0.75 at t=1) plus the tube's own radius
    // (0.025) dominates once curl is an integer (sin(2π·curl)=0 at the
    // endpoint, so the y-term vanishes there and only the z-term and tube
    // radius add to x). Rounded up for margin.
    bounds: { localRadius: 0.82 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#7dd3fc' },
        intensity: { type: 'number', min: 0.5, max: 3, default: 1.5 },
        flicker: { type: 'number', min: 0, max: 1, default: 0.15 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.5 },
      },
      appearance: {
        curl: { type: 'number', min: 1, max: 3, default: 2 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'curl', label: 'PATH CURL', kind: 'slider', min: 1, max: 3, step: 1 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'intensity', label: 'INTENSITY', kind: 'slider', min: 0.5, max: 3, step: 0.05 },
      { bucket: 'material', key: 'flicker', label: 'FLICKER', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'LIT', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'FLICKER SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'neon-blue', label: 'Neon Blue', values: { material: { color: '#7dd3fc', intensity: 1.8, flicker: 0.05 }, appearance: { curl: 2 } } },
      { id: 'warm-tube', label: 'Warm Tube', values: { material: { color: '#ffb37a', intensity: 1.4, flicker: 0.1 }, appearance: { curl: 1 } } },
      { id: 'failing-sign', label: 'Failing Sign', values: { material: { color: '#ff5fce', intensity: 1.2, flicker: 0.6 }, appearance: { curl: 3 } } },
    ],
    randomRanges: {
      material: { color: ['#7dd3fc', '#ffb37a', '#ff5fce', '#c9f7d0', '#eaf6ff'], intensity: [0.8, 2.5], flicker: [0, 0.5] },
      motion: { speed: [0.2, 1.5] },
      appearance: { curl: [1, 3] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  'wireframe-sculpture': {
    type: 'wireframe-sculpture',
    label: 'Wireframe Sculpture',
    category: 'architectural',
    description: 'A geodesic wireframe built from real 3D struts, not flat lines — topology density, strut thickness, and a deterministic reveal scan.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // MEASURED (real factory, 300 animate() frames, appearance maxima
    // detail=2/thickness=0.035): 0.5345. Every EdgesGeometry vertex sits
    // EXACTLY at the icosahedron's own radius (0.5 — PolyhedronGeometry
    // normalizes every subdivided vertex onto that sphere, an exact
    // property, not approximate), so the strut geometry's own cross-
    // section thickness is the only thing that can push a rendered point
    // beyond that — consistent with the measured ~0.5+thickness. Rounded
    // up for margin.
    bounds: { localRadius: 0.57 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#7dd3fc' },
        opacity: { type: 'number', min: 0.3, max: 1, default: 0.75 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.4 },
      },
      appearance: {
        detail: { type: 'number', min: 0, max: 2, default: 1 },
        thickness: { type: 'number', min: 0.01, max: 0.035, default: 0.018 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'detail', label: 'TOPOLOGY DENSITY', kind: 'slider', min: 0, max: 2, step: 1 },
      { bucket: 'appearance', key: 'thickness', label: 'STRUT THICKNESS', kind: 'slider', min: 0.01, max: 0.035, step: 0.002 },
      { bucket: 'material', key: 'color', label: 'EMISSIVE COLOR', kind: 'color' },
      { bucket: 'material', key: 'opacity', label: 'OPACITY', kind: 'slider', min: 0.3, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'SCAN', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'SCAN SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'low-poly', label: 'Low Poly', values: { appearance: { detail: 0, thickness: 0.025 }, material: { color: '#7dd3fc', opacity: 0.85 } } },
      { id: 'geodesic-dense', label: 'Geodesic Dense', values: { appearance: { detail: 2, thickness: 0.012 }, material: { color: '#eaf6ff', opacity: 0.6 } } },
      { id: 'amber-scan', label: 'Amber Scan', values: { appearance: { detail: 1, thickness: 0.018 }, material: { color: '#ffb37a', opacity: 0.75 } } },
    ],
    randomRanges: {
      material: { color: ['#7dd3fc', '#eaf6ff', '#ffb37a', '#ff5fce', '#c9f7d0'], opacity: [0.4, 1] },
      motion: { speed: [0.1, 1.5] },
      appearance: { detail: [0, 2], thickness: [0.01, 0.03] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  'portal-plane': {
    type: 'portal-plane',
    label: 'Portal Plane',
    category: 'architectural',
    description: 'A luminous ring with a translucent interior glow, pulsing open and closed behind the hero.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Ring size caught and corrected during live verification: the first
    // version (TorusGeometry(0.5, 0.03,...)) rendered as a completely
    // invisible ring — smaller than the cloth sheet's own half-extents
    // (CLOTH_ASPECTS.landscape, ClothStudio.jsx, half-width 0.86) and sat
    // entirely hidden behind the opaque sheet at this centered/intentional-
    // overlap default. factories.js's PORTAL_RING_RADIUS/PORTAL_TUBE_RADIUS
    // were resized to 1.05/0.04 — a visible HALO around the artwork, the
    // same "wraps/pokes out around the sheet" relationship Kinetic Rings/
    // Homepage Particle Hero already establish. The ring is a fixed,
    // unanimated shape — a torus's own max distance from center is exactly
    // its own ring-radius + tube-radius (1.05+0.04=1.09), a well-known EXACT
    // property, not an approximation. The inner disc is smaller (1.01) and
    // only ever pulses WITHIN itself (portalAnimate scales the disc down,
    // never up past its own build-time radius), so it never exceeds the
    // ring. Rounded up for margin.
    bounds: { localRadius: 1.15 },
    // Centered/intentional-overlap by design (elements/placement.js
    // ELEMENT_ANCHORS xSign:0,ySign:0) — a portal "behind the hero" is
    // meant to sit right where the hero is, same treatment as Kinetic
    // Rings/Homepage Particle Hero.
    intentionalOverlap: true,
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#7dd3fc' },
        rimIntensity: { type: 'number', min: 0, max: 2, default: 0.8 },
        interiorOpacity: { type: 'number', min: 0.1, max: 0.6, default: 0.3 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.5 },
      },
      appearance: {
        pulseDepth: { type: 'number', min: 0, max: 1, default: 0.4 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'pulseDepth', label: 'PULSE DEPTH', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'rimIntensity', label: 'RIM INTENSITY', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { bucket: 'material', key: 'interiorOpacity', label: 'INTERIOR GLOW', kind: 'slider', min: 0.1, max: 0.6, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'PULSE', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'PULSE SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'calm-glow', label: 'Calm Glow', values: { material: { color: '#7dd3fc', rimIntensity: 0.6, interiorOpacity: 0.25 }, appearance: { pulseDepth: 0.2 } } },
      { id: 'deep-pulse', label: 'Deep Pulse', values: { material: { color: '#eaf6ff', rimIntensity: 1.2, interiorOpacity: 0.4 }, appearance: { pulseDepth: 0.8 } } },
      { id: 'ember-portal', label: 'Ember Portal', values: { material: { color: '#ffb37a', rimIntensity: 1, interiorOpacity: 0.35 }, appearance: { pulseDepth: 0.5 } } },
    ],
    randomRanges: {
      material: { color: ['#7dd3fc', '#eaf6ff', '#ffb37a', '#ff5fce', '#c9f7d0'], rimIntensity: [0.3, 1.6], interiorOpacity: [0.15, 0.55] },
      motion: { speed: [0.2, 1.5] },
      appearance: { pulseDepth: [0.1, 0.9] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  'cloth-banners': {
    type: 'cloth-banners',
    label: 'Cloth Banners',
    category: 'architectural',
    description: 'A tall, borderless fabric panel hanging from a pinned top edge, swaying in a wind whose strength and fabric weight are both adjustable. Ships with a placeholder print texture — real artwork mapping is later-phase work.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // MEASURED (real factory, 300 animate() frames, appearance maxima
    // weight=0.3/windStrength=0.12): 0.8515. Wind sway is an X-axis-ONLY
    // displacement (same axis the panel's own half-width is measured
    // along, unlike Iridescent Film's Z-wave which is orthogonal to its
    // in-plane extent) — every vertex at a given height gets the SAME sway
    // value regardless of its own X, so the worst case is the bottom
    // corner (max distFromPin AND max |x|=halfWidth) getting the full
    // sway added on top of its own base X: halfWidth(0.25) +
    // sway_max(windStrength_max(0.12) * (1/weight_min(0.3)) * 1) = 0.25 +
    // 0.4 = 0.65, combined with the unchanged Y half-height (0.55) via
    // Pythagoras: sqrt(0.65²+0.55²)=0.8515 — matches the measurement
    // exactly. Rounded up for margin.
    bounds: { localRadius: 0.9 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#f4f4f6' },
        opacity: { type: 'number', min: 0.4, max: 1, default: 0.92 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 1.5, default: 0.5 },
      },
      appearance: {
        weight: { type: 'number', min: 0.3, max: 1, default: 0.6 },
        windStrength: { type: 'number', min: 0, max: 0.12, default: 0.05 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'weight', label: 'FABRIC WEIGHT', kind: 'slider', min: 0.3, max: 1, step: 0.02 },
      { bucket: 'appearance', key: 'windStrength', label: 'WIND STRENGTH', kind: 'slider', min: 0, max: 0.12, step: 0.005 },
      { bucket: 'material', key: 'color', label: 'TINT', kind: 'color' },
      { bucket: 'material', key: 'opacity', label: 'OPACITY', kind: 'slider', min: 0.4, max: 1, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'WIND', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'WIND SPEED', kind: 'slider', min: 0.05, max: 1.5, step: 0.05 },
    ],
    presets: [
      { id: 'gallery-banner', label: 'Gallery Banner', values: { material: { color: '#f4f4f6', opacity: 0.95 }, appearance: { weight: 0.8, windStrength: 0.02 } } },
      { id: 'light-silk', label: 'Light Silk', values: { material: { color: '#eaf6ff', opacity: 0.75 }, appearance: { weight: 0.35, windStrength: 0.1 } } },
      { id: 'storm-flag', label: 'Storm Flag', values: { material: { color: '#20242c', opacity: 0.9 }, appearance: { weight: 0.4, windStrength: 0.12 } } },
    ],
    randomRanges: {
      material: { color: ['#f4f4f6', '#eaf6ff', '#20242c', '#c9a24a', '#7dd3fc'], opacity: [0.5, 1] },
      motion: { speed: [0.1, 1.2] },
      appearance: { weight: [0.35, 0.95], windStrength: [0, 0.1] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  // ── Phase 4 — Atmospheric/Surface pack (docs/plans/ORIGINAL-STUDIO-
  // CINEMATIC-SETS-4K-PLAN.md "Element library" #18-21). Same procedural
  // vocabulary as every prior pack — no custom shaders. `bounds.localRadius`
  // below is a PLACEHOLDER pending the mandatory real-factory measurement
  // pass (the discipline external review made mandatory after the
  // Inflatable Forms bound bug) — do not treat as final until that
  // measurement lands.

  'particle-ribbon': {
    type: 'particle-ribbon',
    label: 'Particle Ribbon',
    category: 'particles',
    description: 'A stream of instanced particles flowing along a fixed path, fading in and out as they travel — count, turbulence, trail width, and flow speed are all adjustable.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // MEASURED by running the real factory (create -> applyInstance -> 300
    // animate() frames at appearance maxima turbulence=1/trailWidth=0.04,
    // reading actual rendered instance-transformed vertex positions, not
    // hand-derived only): 0.7705. A real bug was caught and fixed while
    // building this calibration script: THREE.InstancedMesh initializes
    // every instance's matrix to IDENTITY (verified directly), so without
    // an explicit initial layout call, a freshly-built ribbon rendered as
    // `count` full-size (unit icosahedron, radius 1) dots stacked at the
    // origin until the FIRST animate() frame ran — factories.js now calls
    // ribbonParticlesUpdateLayout once during rebuild (same "set initial
    // instance transforms during applyInstance" precedent Orb Constellation/
    // Wireframe Sculpture already establish) so this is never the state a
    // freshly-added or motion-paused ribbon can be caught in. Rounded up
    // for margin.
    bounds: { localRadius: 0.82 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#7dd3fc' },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.6 },
      },
      appearance: {
        count: { type: 'number', min: 20, max: 150, default: 70 },
        turbulence: { type: 'number', min: 0, max: 1, default: 0.4 },
        trailWidth: { type: 'number', min: 0.01, max: 0.04, default: 0.022 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'PARTICLE COUNT', kind: 'slider', min: 20, max: 150, step: 5 },
      { bucket: 'appearance', key: 'turbulence', label: 'TURBULENCE', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'appearance', key: 'trailWidth', label: 'TRAIL WIDTH', kind: 'slider', min: 0.01, max: 0.04, step: 0.002 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'motion', key: 'rotate', label: 'FLOW', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'FLOW SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'calm-stream', label: 'Calm Stream', values: { appearance: { count: 50, turbulence: 0.15, trailWidth: 0.02 }, material: { color: '#7dd3fc' }, motion: { speed: 0.4 } } },
      { id: 'dense-current', label: 'Dense Current', values: { appearance: { count: 130, turbulence: 0.5, trailWidth: 0.018 }, material: { color: '#eaf6ff' }, motion: { speed: 0.9 } } },
      { id: 'chaotic-embers', label: 'Chaotic Embers', values: { appearance: { count: 90, turbulence: 0.9, trailWidth: 0.03 }, material: { color: '#ffb37a' }, motion: { speed: 1.2 } } },
    ],
    randomRanges: {
      material: { color: ['#7dd3fc', '#eaf6ff', '#ffb37a', '#ff5fce', '#c9f7d0'] },
      motion: { speed: [0.2, 1.5] },
      appearance: { count: [30, 140], turbulence: [0.1, 0.9], trailWidth: [0.012, 0.035] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  'caustic-water-light': {
    type: 'caustic-water-light',
    label: 'Caustic Water Light',
    category: 'light',
    description: 'A soft, animated caustic-light glow — scale, contrast, color, and direction are all adjustable, self-illuminated (no separate scene light).',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // The disc (CircleGeometry(0.55, ...)) never deforms — appearance
    // fields (scale/contrast/direction) only ever rewrite texture texels,
    // never vertex positions — so this bound is EXACT (a circle's own
    // radius), not an approximation, and carries no measurement risk the
    // way any deforming-geometry type does. MEASURED (real factory, 300
    // frames at appearance maxima) confirmed exactly 0.5500000281231232 —
    // matching the declared disc radius to float precision, before and
    // after animation identically. Rounded up for a small margin anyway.
    bounds: { localRadius: 0.58 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#8fd8ff' },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.5 },
      },
      appearance: {
        scale: { type: 'number', min: 0.5, max: 3, default: 1.4 },
        contrast: { type: 'number', min: 0, max: 1, default: 0.5 },
        direction: { type: 'number', min: 0, max: 360, default: 30 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'scale', label: 'PATTERN SCALE', kind: 'slider', min: 0.5, max: 3, step: 0.05 },
      { bucket: 'appearance', key: 'contrast', label: 'CONTRAST', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'appearance', key: 'direction', label: 'LIGHT DIRECTION', kind: 'slider', min: 0, max: 360, step: 5, unit: 'deg' },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'motion', key: 'rotate', label: 'RIPPLE', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'RIPPLE SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'pool-blue', label: 'Pool Blue', values: { material: { color: '#8fd8ff' }, appearance: { scale: 1.2, contrast: 0.4, direction: 20 } } },
      { id: 'sharp-noon', label: 'Sharp Noon', values: { material: { color: '#eaf6ff' }, appearance: { scale: 1.8, contrast: 0.85, direction: 0 } } },
      { id: 'amber-shallows', label: 'Amber Shallows', values: { material: { color: '#ffcf8f' }, appearance: { scale: 1, contrast: 0.3, direction: 60 } } },
    ],
    randomRanges: {
      material: { color: ['#8fd8ff', '#eaf6ff', '#ffcf8f', '#c9f7d0', '#f4c9d8'] },
      motion: { speed: [0.2, 1.5] },
      appearance: { scale: [0.7, 2.5], contrast: [0.15, 0.9], direction: [0, 360] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  'volumetric-light-cone': {
    type: 'volumetric-light-cone',
    label: 'Volumetric Light Cone',
    category: 'light',
    description: 'A soft, self-illuminated beam sweeping slowly behind the sheet — angle, length, density, color, and noise are all adjustable.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 4,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Exact, not measured-only: the cone's apex sits at the local origin
    // (coneRebuild's `geo.translate(0, -length/2, 0)`), so the farthest
    // point is always the base rim's corner — sqrt(bottomRadius² +
    // length²) where bottomRadius = tan(angle/2)*length. At the catalog
    // maxima (angle=60°, length=1.4): bottomRadius = tan(30°)*1.4 ≈ 0.808,
    // sqrt(0.808²+1.4²) ≈ 1.6166. sweepAnimate only rotates the whole
    // motion group (rotation-about-origin invariant), so this bound holds
    // through the animation too. MEASURED (real factory, 300 frames)
    // confirmed 1.6165807477908556, matching the hand formula exactly —
    // cross-checked, not just asserted. Rounded up for margin.
    bounds: { localRadius: 1.7 },
    // Centered/intentional-overlap by design (elements/placement.js
    // ELEMENT_ANCHORS xSign:0,ySign:0) — first tried at a corner and came
    // back genuinely infeasible in every format at this large a bound
    // (checked directly via defaultTransformForFormat, not assumed); a
    // beam shining down through/behind the hero reads as centered anyway,
    // same treatment as Kinetic Rings/Homepage Particle Hero.
    intentionalOverlap: true,
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#eaf6ff' },
        density: { type: 'number', min: 0.05, max: 0.5, default: 0.2 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.4 },
      },
      appearance: {
        angle: { type: 'number', min: 15, max: 60, default: 30 },
        length: { type: 'number', min: 0.6, max: 1.4, default: 1 },
        noise: { type: 'number', min: 0, max: 1, default: 0.3 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'angle', label: 'CONE ANGLE', kind: 'slider', min: 15, max: 60, step: 1, unit: 'deg' },
      { bucket: 'appearance', key: 'length', label: 'LENGTH', kind: 'slider', min: 0.6, max: 1.4, step: 0.02 },
      { bucket: 'appearance', key: 'noise', label: 'NOISE', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'density', label: 'DENSITY', kind: 'slider', min: 0.05, max: 0.5, step: 0.01 },
      { bucket: 'motion', key: 'rotate', label: 'SWEEP', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'SWEEP SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'soft-beam', label: 'Soft Beam', values: { appearance: { angle: 22, length: 1, noise: 0.15 }, material: { color: '#eaf6ff', density: 0.15 } } },
      { id: 'wide-glow', label: 'Wide Glow', values: { appearance: { angle: 50, length: 1.2, noise: 0.4 }, material: { color: '#ffcf8f', density: 0.25 } } },
      { id: 'flickering-shaft', label: 'Flickering Shaft', values: { appearance: { angle: 18, length: 1.3, noise: 0.8 }, material: { color: '#c9d8ff', density: 0.3 } } },
    ],
    randomRanges: {
      material: { color: ['#eaf6ff', '#ffcf8f', '#c9d8ff', '#c9f7d0', '#f4c9d8'], density: [0.08, 0.4] },
      motion: { speed: [0.15, 1.4] },
      appearance: { angle: [18, 55], length: [0.7, 1.35], noise: [0, 0.85] },
    },
    quality: { minTier: 'draft', estimatedCost: 4 },
  },

  'topographic-floor': {
    type: 'topographic-floor',
    label: 'Topographic Floor',
    category: 'floor',
    description: 'A tilted, undulating terrain surface rising behind the sheet — amplitude and frequency control the wave/dune read, fading toward the center so it never collides with the artwork.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // MEASURED (real factory, 300 frames, appearance maxima amplitude=0.18/
    // frequency=3): 0.9603. Cross-checked by hand: the plane's own
    // half-diagonal (sqrt(0.8²+0.5²)=0.9434, the pre-animate() measured
    // value exactly) plus the corner's own falloff-scaled max Z-
    // displacement (falloff=1 at the corner, amplitude=0.18) combine via
    // Pythagoras (Z is orthogonal to the plane's own in-plane extent, same
    // independence argument as Iridescent Film): sqrt(0.9434²+0.18²) ≈
    // 0.9605, matching the measurement. The fixed TOPO_TILT_RAD rotation
    // baked into the mesh at build time doesn't change this — a bounding
    // sphere is rotation-invariant regardless of which axis a child mesh
    // is tilted on internally. Rounded up for margin.
    bounds: { localRadius: 1.02 },
    // Centered/intentional-overlap by design (elements/placement.js
    // ELEMENT_ANCHORS xSign:0,ySign:0) — a corner anchor (xSign:0,ySign:-1,
    // then xSign:1,ySign:-1) was tried first and both came back genuinely
    // infeasible in every format (checked directly via
    // defaultTransformForFormat, not assumed); a rising terrain backdrop
    // wrapping the whole scene reads as centered anyway, same treatment as
    // Homepage Particle Hero.
    intentionalOverlap: true,
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#3a4a5c' },
        roughness: { type: 'number', min: 0.2, max: 1, default: 0.7 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 1.5, default: 0.3 },
      },
      appearance: {
        amplitude: { type: 'number', min: 0, max: 0.18, default: 0.08 },
        frequency: { type: 'number', min: 0.5, max: 3, default: 1.2 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'amplitude', label: 'AMPLITUDE', kind: 'slider', min: 0, max: 0.18, step: 0.005 },
      { bucket: 'appearance', key: 'frequency', label: 'FREQUENCY', kind: 'slider', min: 0.5, max: 3, step: 0.1 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS', kind: 'slider', min: 0.2, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'DISPLACE', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'DISPLACE SPEED', kind: 'slider', min: 0.05, max: 1.5, step: 0.05 },
    ],
    presets: [
      { id: 'gentle-dunes', label: 'Gentle Dunes', values: { appearance: { amplitude: 0.04, frequency: 0.8 }, material: { color: '#c9a24a', roughness: 0.85 } } },
      { id: 'rolling-hills', label: 'Rolling Hills', values: { appearance: { amplitude: 0.1, frequency: 1.4 }, material: { color: '#3a4a5c', roughness: 0.7 } } },
      { id: 'choppy-waves', label: 'Choppy Waves', values: { appearance: { amplitude: 0.15, frequency: 2.4 }, material: { color: '#1b3a4a', roughness: 0.4 } } },
    ],
    randomRanges: {
      material: { color: ['#3a4a5c', '#c9a24a', '#1b3a4a', '#4a3a5c', '#2f2f2f'], roughness: [0.3, 0.95] },
      motion: { speed: [0.1, 1.2] },
      appearance: { amplitude: [0.02, 0.16], frequency: [0.6, 2.8] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  // ── Phase 4 — Hero pack, final pack (docs/plans/ORIGINAL-STUDIO-
  // CINEMATIC-SETS-4K-PLAN.md "Element library" #24-26; #22-23, Homepage
  // Particle Hero and GLB Import, already shipped in Phase 3). Same
  // procedural vocabulary as every prior pack. `bounds.localRadius` below
  // is a PLACEHOLDER pending the mandatory real-factory measurement pass
  // (the discipline external review made mandatory after the Inflatable
  // Forms bound bug) — do not treat as final until that measurement lands.

  'metaball-bloom': {
    type: 'metaball-bloom',
    label: 'Metaball / Ferrofluid Bloom',
    category: 'hero',
    description: 'A cluster of soft, overlapping glass/metal blobs that orbit and pulse toward a shared center — attraction, surface tension, and material read (metallic/glass/ink) are all adjustable. Overlap reads as merging; true isosurface blending is out of scope.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 6,
    defaultEnabled: true,
    defaultDepth: 'background',
    // CORRECTED (external review): the original calibration measured only
    // appearance MAXIMA (count=10/attraction=1/surfaceTension=1) without
    // checking which direction each field actually pushes the bound —
    // attraction=1 is the TIGHTEST orbit (`orbitRadius=0.35*(1-0.7)=0.105`)
    // and surfaceTension=1 gives the MOST size-uniform (not largest) blobs,
    // so that combination was the LEAST extreme case, not the worst one.
    // `attraction` PULLS blobs toward the center (semantically: high
    // attraction = tight cluster), so attraction=0 is the loosest/widest
    // orbit (`orbitRadius=0.35`, more than 3x the attraction=1 case); low
    // surfaceTension leaves every blob at its full, un-shrunk radius. A
    // full sweep of the real factory across the actual appearance ranges
    // (not just the numeric endpoints assumed to be "max") confirmed
    // count=10/attraction=0/surfaceTension=0 is the true worst case:
    // 0.5128, matching the external review's own independent measurement
    // (0.5128122018) closely. Rounded up for margin.
    bounds: { localRadius: 0.55 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#c9c2ff' },
        metalness: { type: 'number', min: 0, max: 1, default: 0.3 },
        roughness: { type: 'number', min: 0, max: 1, default: 0.15 },
        transmission: { type: 'number', min: 0, max: 1, default: 0.6 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.5 },
      },
      appearance: {
        count: { type: 'number', min: 4, max: 10, default: 6 },
        attraction: { type: 'number', min: 0, max: 1, default: 0.5 },
        surfaceTension: { type: 'number', min: 0, max: 1, default: 0.4 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'BLOB COUNT', kind: 'slider', min: 4, max: 10, step: 1 },
      { bucket: 'appearance', key: 'attraction', label: 'ATTRACTION', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'appearance', key: 'surfaceTension', label: 'SURFACE TENSION', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'metalness', label: 'METALNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'transmission', label: 'TRANSMISSION', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'PULSE', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'PULSE SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'ferrofluid-ink', label: 'Ferrofluid Ink', values: { material: { color: '#1a1a22', metalness: 0.9, roughness: 0.2, transmission: 0.05 }, appearance: { count: 8, attraction: 0.7, surfaceTension: 0.6 } } },
      { id: 'glass-bloom', label: 'Glass Bloom', values: { material: { color: '#eaf6ff', metalness: 0, roughness: 0.05, transmission: 0.9 }, appearance: { count: 6, attraction: 0.4, surfaceTension: 0.3 } } },
      { id: 'chrome-cluster', label: 'Chrome Cluster', values: { material: { color: '#d8dce2', metalness: 1, roughness: 0.1, transmission: 0 }, appearance: { count: 10, attraction: 0.6, surfaceTension: 0.7 } } },
    ],
    randomRanges: {
      material: { color: ['#c9c2ff', '#1a1a22', '#eaf6ff', '#d8dce2', '#ff9d5c'], metalness: [0, 1], roughness: [0.02, 0.6], transmission: [0, 0.9] },
      motion: { speed: [0.2, 1.5] },
      appearance: { count: [4, 10], attraction: [0.2, 0.9], surfaceTension: [0, 0.8] },
    },
    quality: { minTier: 'draft', estimatedCost: 6 },
  },

  'kinetic-type-totem': {
    type: 'kinetic-type-totem',
    label: 'Kinetic Type Totem',
    category: 'hero',
    description: 'A vertical stack of beveled, extruded blocks — an abstract procedural totem, not real editable text — with a glow sweep rising through it. Depth, bevel, and block count are all adjustable.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // MEASURED (real factory, 300 frames, appearance maxima count=6/
    // depth=0.16/bevel=0.03): 0.6507. This geometry (a stack of extruded
    // rounded-rect blocks) is complex enough that exact hand verification
    // isn't practical — the measurement itself, not a hand formula, is the
    // primary source here, consistent with the discipline this file's own
    // review established for any shape too irregular for a clean closed
    // form. Rounded up for a larger-than-usual margin given that.
    bounds: { localRadius: 0.7 },
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        tint: { type: 'color', default: '#eaf6ff' },
        metalness: { type: 'number', min: 0, max: 1, default: 0.5 },
        roughness: { type: 'number', min: 0, max: 1, default: 0.3 },
        edgeGlow: { type: 'number', min: 0, max: 1, default: 0.4 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.5 },
      },
      appearance: {
        count: { type: 'number', min: 3, max: 6, default: 4 },
        depth: { type: 'number', min: 0.05, max: 0.16, default: 0.09 },
        bevel: { type: 'number', min: 0.005, max: 0.03, default: 0.015 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'BLOCK COUNT', kind: 'slider', min: 3, max: 6, step: 1 },
      { bucket: 'appearance', key: 'depth', label: 'DEPTH', kind: 'slider', min: 0.05, max: 0.16, step: 0.005 },
      { bucket: 'appearance', key: 'bevel', label: 'BEVEL', kind: 'slider', min: 0.005, max: 0.03, step: 0.002 },
      { bucket: 'material', key: 'tint', label: 'TINT', kind: 'color' },
      { bucket: 'material', key: 'metalness', label: 'METALNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'roughness', label: 'ROUGHNESS', kind: 'slider', min: 0, max: 1, step: 0.01 },
      { bucket: 'material', key: 'edgeGlow', label: 'GLOW SWEEP', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'motion', key: 'rotate', label: 'SWEEP', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'SWEEP SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'polished-totem', label: 'Polished Totem', values: { material: { tint: '#eaf6ff', metalness: 0.8, roughness: 0.1, edgeGlow: 0.25 }, appearance: { count: 5, depth: 0.1, bevel: 0.02 } } },
      { id: 'matte-monolith', label: 'Matte Monolith', values: { material: { tint: '#20242c', metalness: 0.1, roughness: 0.6, edgeGlow: 0.6 }, appearance: { count: 4, depth: 0.14, bevel: 0.01 } } },
      { id: 'gold-glyphs', label: 'Gold Glyphs', values: { material: { tint: '#c9a24a', metalness: 0.9, roughness: 0.15, edgeGlow: 0.3 }, appearance: { count: 6, depth: 0.08, bevel: 0.025 } } },
    ],
    randomRanges: {
      material: { tint: ['#eaf6ff', '#20242c', '#c9a24a', '#f4c9d8', '#7dd3fc'], metalness: [0.1, 1], roughness: [0.05, 0.7], edgeGlow: [0, 0.8] },
      motion: { speed: [0.1, 1.5] },
      appearance: { count: [3, 6], depth: [0.06, 0.15], bevel: [0.008, 0.028] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },

  'echo-feedback-tunnel': {
    type: 'echo-feedback-tunnel',
    label: 'Echo Feedback Tunnel',
    category: 'hero',
    description: 'A bounded chain of ring echoes flowing through depth, each one decaying in scale and shifting in hue — simulates tunnel travel without moving the real camera or any unbounded feedback loop.',
    previewSupported: true,
    finalRenderSupported: false,
    performanceCost: 5,
    defaultEnabled: true,
    defaultDepth: 'background',
    // Ring size caught and corrected during live verification (same lesson
    // Portal Plane already taught this pack, applied proactively here too
    // — and still caught live, since the FIRST version at
    // TUNNEL_RING_RADIUS=0.4 was tried first without a preceding bound-
    // check catching it, matching how this exact mistake happens): a
    // nearest ring smaller than the cloth sheet's own half-extents
    // (CLOTH_ASPECTS.landscape, ClothStudio.jsx, half-width 0.86) sat
    // entirely hidden behind the opaque sheet, at every depth, in every
    // screenshot. Resized to TUNNEL_RING_RADIUS=1/TUNNEL_TUBE_RADIUS=0.035
    // — a real halo, re-measured (real factory, 300 frames, appearance
    // maxima count=14/decay=0.95/hueShift=1): 1.3108. Rounded up for
    // margin.
    bounds: { localRadius: 1.38 },
    // Centered/intentional-overlap by design (elements/placement.js
    // ELEMENT_ANCHORS xSign:0,ySign:0) — a receding tunnel wrapping the
    // whole scene reads as centered anyway, same treatment as Homepage
    // Particle Hero/Volumetric Light Cone (both preemptively centered
    // given this pack's own established pattern: a bound this large is
    // genuinely infeasible at a real corner in every format).
    intentionalOverlap: true,
    fieldSpec: {
      transform: TRANSFORM_FIELD_SPEC,
      material: {
        color: { type: 'color', default: '#7dd3fc' },
        rimIntensity: { type: 'number', min: 0, max: 2, default: 0.7 },
      },
      motion: {
        rotate: { type: 'boolean', default: true },
        speed: { type: 'number', min: 0.05, max: 2, default: 0.5 },
      },
      appearance: {
        count: { type: 'number', min: 6, max: 14, default: 9 },
        decay: { type: 'number', min: 0.5, max: 0.95, default: 0.8 },
        hueShift: { type: 'number', min: 0, max: 1, default: 0.3 },
      },
    },
    controls: [
      ...TRANSFORM_CONTROLS,
      { bucket: 'appearance', key: 'count', label: 'ECHO COUNT', kind: 'slider', min: 6, max: 14, step: 1 },
      { bucket: 'appearance', key: 'decay', label: 'DECAY', kind: 'slider', min: 0.5, max: 0.95, step: 0.01 },
      { bucket: 'appearance', key: 'hueShift', label: 'HUE SHIFT', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { bucket: 'material', key: 'color', label: 'COLOR', kind: 'color' },
      { bucket: 'material', key: 'rimIntensity', label: 'RIM INTENSITY', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { bucket: 'motion', key: 'rotate', label: 'TRAVEL', kind: 'toggle' },
      { bucket: 'motion', key: 'speed', label: 'TRAVEL SPEED', kind: 'slider', min: 0.05, max: 2, step: 0.05 },
    ],
    presets: [
      { id: 'calm-corridor', label: 'Calm Corridor', values: { material: { color: '#7dd3fc', rimIntensity: 0.5 }, appearance: { count: 8, decay: 0.85, hueShift: 0.15 } } },
      { id: 'deep-warp', label: 'Deep Warp', values: { material: { color: '#eaf6ff', rimIntensity: 1.2 }, appearance: { count: 14, decay: 0.65, hueShift: 0.6 } } },
      { id: 'ember-echo', label: 'Ember Echo', values: { material: { color: '#ffb37a', rimIntensity: 0.9 }, appearance: { count: 10, decay: 0.75, hueShift: 0.35 } } },
    ],
    randomRanges: {
      material: { color: ['#7dd3fc', '#eaf6ff', '#ffb37a', '#ff5fce', '#c9f7d0'], rimIntensity: [0.3, 1.6] },
      motion: { speed: [0.15, 1.6] },
      appearance: { count: [6, 14], decay: [0.55, 0.9], hueShift: [0, 0.9] },
    },
    quality: { minTier: 'draft', estimatedCost: 5 },
  },
};

export function getElementDefinition(type) {
  return ELEMENT_CATALOG[type] || null;
}

export function listElementDefinitions() {
  return Object.values(ELEMENT_CATALOG);
}
