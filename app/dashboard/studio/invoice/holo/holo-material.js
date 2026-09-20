// Invoice Studio HoloPaper — legibility-tuned holographic material
// (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §5, Lane S ownership).
//
// This is a FROZEN preset for PEARL/WHITE INVOICE PAPER, not the general-
// purpose decorative Holo Paper look ClothStudio ships. Every tunable below
// is deliberately dialed DOWN from what a decorative art object would use,
// because black and colored invoice text plus a logo, printed onto the
// texture this material displays, must stay clearly readable while the
// paper moves. The holographic response modulates highlight/specular/
// emissive appearance (a subtle iridescent sheen catching the light) — it
// never replaces or washes out the invoice texture's own base colors,
// because it is added via `totalEmissiveRadiance +=`, on top of the
// already-fully-resolved diffuse/map color, exactly like ClothStudio's own
// shader (see HOLO_FRAG_BODY below) — and it is further DAMPENED over dark
// ink pixels specifically (see "legibility mask" below) so printed text and
// a logo mark stay visibly darker/flatter than the surrounding paper.
//
// Shader wiring (onBeforeCompile injecting at the same two `#include`
// points, uniforms shared via Object.assign) is the exact proven technique
// from ClothStudio.jsx's mkClothMaterial (~line 4076) / holoUniforms
// (~line 4062) / HOLO_FRAG_PARS+HOLO_FRAG_BODY (~line 2234) — reused here,
// not imported (those consts are module-scope, not exported, and this
// file's own GLSL is independently tuned for legibility, not decoration).

// ── Tunable constants (frozen preset — no rail/slider exposes these this
// round; retune here if a future pass needs a different balance) ──────────

// Base intensity of the holographic band/sheen response. ClothStudio's own
// slider ranges roughly 0..1+ for a deliberately showy decorative look;
// this is a small fraction of that so the sheen reads as "foil highlight,"
// not "the page is glowing."
export const INVOICE_HOLO_INTENSITY = 0.16;
// Spatial frequency of the UV tiling the band pattern rides on. Larger =
// finer bands. Kept large enough that bands don't line up visibly with
// invoice text rows/columns at typical paper scale.
export const INVOICE_HOLO_SCALE = 10;
// Frequency of the diagonal interference bands themselves. Lower than a
// decorative preset would use — broader, calmer bands read as a soft sheen
// sweep rather than a busy moiré pattern crossing small print.
export const INVOICE_HOLO_BAND_FREQ = 0.22;
// How saturated the rainbow hue response gets. A fully saturated response
// would visibly tint black text and colored totals; this stays low so the
// color shift reads as a cool highlight, not a dye.
export const INVOICE_HOLO_SAT_BOOST = 0.32;
// Base hue offset — biased toward a cool pearl/blue-violet foil rather than
// cycling the full rainbow, matching "foil on white paper" rather than
// "disco sheet."
export const INVOICE_HOLO_HUE_SHIFT = 0.58;
// Sparkle glint density/brightness. Faint, occasional glints only — not a
// glitter field, which would compete with fine print for attention.
export const INVOICE_HOLO_SPARKLE = 0.10;
// Legibility mask floor — the minimum fraction of the (already restrained)
// holographic response that is still allowed to show over the DARKEST ink
// pixels (pure black text/logo strokes). 0 would make dark ink perfectly
// flat/dead; a small floor keeps it from looking like a cutout while still
// keeping it visibly calmer than the surrounding paper. See
// `buildInvoiceHoloFragBody()`'s luminance-masking comment below.
export const INVOICE_HOLO_DARK_MASK_FLOOR = 0.12;
// Luminance window (0..1, computed from the already-resolved diffuse color)
// over which the mask ramps from DARK_MASK_FLOOR up to full strength — text
// ink typically resolves well under LOW, bright paper background well over
// HIGH; values in between (mid-gray logo strokes, anti-aliased text edges)
// ramp smoothly instead of banding.
export const INVOICE_HOLO_MASK_LUMA_LOW = 0.15;
export const INVOICE_HOLO_MASK_LUMA_HIGH = 0.55;

// Pearl/white paper base color — NOT ClothStudio's near-black 0x101114
// decorative default (that color is the whole point of a "iridescent onyx"
// look; invoice paper must read as white/pearl paper first).
export const INVOICE_HOLO_BASE_COLOR = 0xfbfaf7;
// Physical-material tuning: lower roughness range (glossier) creates harder
// specular hot-spots that can blow out over small text; a higher roughness
// and near-zero metalness keep the surface reading as coated paper, not
// metal foil or plastic.
export const INVOICE_HOLO_ROUGHNESS = 0.34;
export const INVOICE_HOLO_METALNESS = 0.04;
export const INVOICE_HOLO_CLEARCOAT = 0.22;
export const INVOICE_HOLO_CLEARCOAT_ROUGHNESS = 0.35;
export const INVOICE_HOLO_SHEEN = 0.35;
export const INVOICE_HOLO_SHEEN_ROUGHNESS = 0.6;
export const INVOICE_HOLO_IRIDESCENCE = 0.16;
export const INVOICE_HOLO_IRIDESCENCE_IOR = 1.3;
export const INVOICE_HOLO_IRIDESCENCE_THICKNESS_RANGE = [100, 320];

// ── GLSL pieces ─────────────────────────────────────────────────────────
// Injected at the same two `#include` anchors ClothStudio proved out:
// `#include <common>` (uniforms/helper functions) and
// `#include <emissivemap_fragment>` (the actual per-pixel holo contribution
// — this anchor runs AFTER `#include <map_fragment>`/`#include
// <color_fragment>`, so `diffuseColor.rgb` is already the fully resolved
// texture-mapped color at this point, which is what makes the legibility
// mask below possible).

export function buildInvoiceHoloFragPars() {
  return `
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
}

export function buildInvoiceHoloFragBody() {
  return `
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
  vec3 holoCol = mix(vec3(0.92), hcHue2Rgb(hue), clamp(0.35 + 0.65 * uSatBoost, 0.0, 1.0));
  float holoAmt = uHoloIntensity * (0.22 + 0.78 * fres) * (0.55 + 0.45 * band);
  float glint = 0.0;
  if (uSparkle > 0.001) {
    vec2 cell = floor(huv * 46.0);
    float h = hcHash(cell);
    float tw = pow(0.5 + 0.5 * sin(uTime * (1.5 + h * 4.0) + h * 40.0), 6.0);
    glint = step(1.0 - uSparkle * 0.10, h) * tw * 5.0;
  }
  // Legibility mask — dampen the holographic response over dark ink/logo
  // pixels so printed text stays visibly darker/flatter than the paper
  // around it, instead of every pixel getting the same additive sheen
  // regardless of what's printed there. diffuseColor.rgb is the ALREADY
  // texture-mapped invoice snapshot color at this injection point (this
  // anchor runs after #include <map_fragment>/#include <color_fragment>),
  // so this reads the real per-pixel ink/paper luminance, not a guess.
  float hcLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float legibilityMask = mix(
    ${INVOICE_HOLO_DARK_MASK_FLOOR.toFixed(3)},
    1.0,
    smoothstep(${INVOICE_HOLO_MASK_LUMA_LOW.toFixed(3)}, ${INVOICE_HOLO_MASK_LUMA_HIGH.toFixed(3)}, hcLuma)
  );
  holoAmt *= legibilityMask;
  glint *= legibilityMask;
  totalEmissiveRadiance += holoCol * max(holoAmt, 0.0) + holoCol * glint * max(uHoloIntensity, uSparkle * 0.4);
}
#endif
`;
}

// Legacy-shaped exports (pre-built strings) for callers that just want the
// frozen GLSL without re-invoking the builder — the builder functions above
// exist so the dark-mask/luma constants stay the single source of truth
// (string-interpolated once) rather than duplicated as GLSL literals.
export const INVOICE_HOLO_FRAG_PARS = buildInvoiceHoloFragPars();
export const INVOICE_HOLO_FRAG_BODY = buildInvoiceHoloFragBody();

// ── Uniforms ────────────────────────────────────────────────────────────
// Fresh shared-uniform object seeded with the frozen constants above — the
// SAME object must be passed to both the front and back materials'
// onBeforeCompile (Object.assign into shader.uniforms), exactly like
// ClothStudio's own holoUniforms, so a single `.value` mutation (e.g.
// advancing uTime once per frame) is visible to both faces without a
// second write.
export function createInvoiceHoloUniforms() {
  return {
    uHoloIntensity: { value: INVOICE_HOLO_INTENSITY },
    uHoloScale: { value: INVOICE_HOLO_SCALE },
    uBandFreq: { value: INVOICE_HOLO_BAND_FREQ },
    uSatBoost: { value: INVOICE_HOLO_SAT_BOOST },
    uHueShift: { value: INVOICE_HOLO_HUE_SHIFT },
    uSparkle: { value: INVOICE_HOLO_SPARKLE },
    uTime: { value: 0 },
  };
}

// ── Material factory ───────────────────────────────────────────────────
// createInvoiceHoloMaterial(THREE, side, options) — builds a
// THREE.MeshPhysicalMaterial wired the same way ClothStudio's
// mkClothMaterial does (onBeforeCompile injecting the two GLSL pieces above
// at the same two `#include` anchors), but with the pearl/white paper
// tuning above instead of ClothStudio's decorative onyx defaults.
//
// `THREE` is passed in (not imported) so this file stays inert until the
// caller actually has a THREE namespace — invoice-holo-scene.js dynamically
// imports `three` itself and passes it through, matching ClothStudio's own
// `const THREE = await import('three')` pattern.
//
// options:
//   - holoUniforms (required) — shared uniforms object, see
//     createInvoiceHoloUniforms() above. Both the front and back materials
//     for one sheet MUST share the exact same object.
//   - map (optional) — initial color texture (usually set later via
//     setTexture on the scene; a material.map can also be reassigned after
//     construction — this factory does not require one up front).
//   - bumpMap (optional) — subtle surface-normal variation texture. Not
//     required; the invoice preset ships without one (out of this lane's
//     bounded anchor list — see invoice-holo-scene.js's own header) and
//     relies on clearcoat/sheen alone for texture.
export function createInvoiceHoloMaterial(THREE, side, options = {}) {
  if (!THREE || typeof THREE.MeshPhysicalMaterial !== 'function') {
    throw new Error('createInvoiceHoloMaterial requires a THREE namespace (THREE.MeshPhysicalMaterial)');
  }
  const {
    holoUniforms, map = null, bumpMap = null, color = INVOICE_HOLO_BASE_COLOR,
  } = options;
  if (!holoUniforms) {
    throw new Error('createInvoiceHoloMaterial requires options.holoUniforms (see createInvoiceHoloUniforms())');
  }
  const material = new THREE.MeshPhysicalMaterial({
    color,
    side,
    map,
    roughness: INVOICE_HOLO_ROUGHNESS,
    metalness: INVOICE_HOLO_METALNESS,
    clearcoat: INVOICE_HOLO_CLEARCOAT,
    clearcoatRoughness: INVOICE_HOLO_CLEARCOAT_ROUGHNESS,
    sheen: INVOICE_HOLO_SHEEN,
    sheenRoughness: INVOICE_HOLO_SHEEN_ROUGHNESS,
    sheenColor: new THREE.Color(0xffffff),
    iridescence: INVOICE_HOLO_IRIDESCENCE,
    iridescenceIOR: INVOICE_HOLO_IRIDESCENCE_IOR,
    iridescenceThicknessRange: INVOICE_HOLO_IRIDESCENCE_THICKNESS_RANGE,
    bumpMap,
    bumpScale: bumpMap ? 0.004 : 0,
  });
  material.defines = { ...(material.defines || {}), USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, holoUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${INVOICE_HOLO_FRAG_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${INVOICE_HOLO_FRAG_BODY}`);
  };
  return material;
}
