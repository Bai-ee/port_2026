// Primary cloth shape — maps the SHARED primary sheet state (mat/phys/anim +
// the primary artwork) onto a `hanging-tshirt` catalog-shaped instance, so
// the T-shirt primary mode can be driven through the exact same
// getFactory('hanging-tshirt') create/applyInstance/animate/dispose contract
// a real extraInstances entry uses — see ClothStudio.jsx's dedicated tshirt
// lifecycle effect for the caller. Pure/no DOM/no three.js — testable in
// isolation (see __tests__/primary-cloth.test.js).
//
// Precedence rule (task requirement #4 — "avoid two competing primary
// artwork libraries"): once the T-shirt is the active primary shape, the
// CURRENT primary artwork (the same image the flyer sheet renders) is the
// ONLY source for the front print — `hasArtwork`/the resolved artwork URL is
// what feeds `logoAssetId` here. The older browser-local
// `TSHIRT_LOGO_LIB_KEY` library (ClothStudio.jsx `logoLibrary` state) is not
// read by this module and no longer reachable from the UI once
// `hanging-tshirt` is `singleInstanceRenderer` (see catalog.js) — it is kept
// only because deleting it outright would touch more files than this
// refactor's stated scope, not because it still participates in primary
// artwork resolution.

// Mirrors factories.js's own TSHIRT_SIM_PARAMS_MIN/MAX_GRAVITY exactly —
// duplicated (not imported) because factories.js doesn't export them and
// re-deriving `weight` from `phys.gravity` needs the SAME two numbers the
// forward mapping (tshirtSimParams) uses, or the round trip drifts.
const TSHIRT_SIM_PARAMS_MIN_GRAVITY = 1.6;
const TSHIRT_SIM_PARAMS_MAX_GRAVITY = 3.4;

// Bend is conventionally softer than stretch for woven cotton — the sheet
// only exposes one STIFFNESS dial, so bendStiffness is derived from it at a
// fixed ratio rather than needing a second shared control.
export const TSHIRT_BEND_STIFFNESS_RATIO = 0.6;

// anim.turbulence is already a 0..1 dial (same one the sheet's own step()
// reads for wind amplitude) — scaled to land within the catalog fieldSpec's
// windStrength range [0, 0.4] (see catalog.js hanging-tshirt.fieldSpec).
export const TSHIRT_WIND_STRENGTH_SCALE = 0.4;

// The sheet has no direction axis to share, so the T-shirt's wind direction
// is a fixed internal default — reuses the catalog fieldSpec's own default
// (35deg) rather than inventing a new number.
export const TSHIRT_PRIMARY_WIND_DIRECTION_DEG = 35;

export const PRIMARY_TSHIRT_INSTANCE_ID = 'primary-tshirt';
// Synthetic ctx.logoAssetsById key the primary artwork is exposed under —
// see the module header's precedence rule.
export const PRIMARY_ARTWORK_LOGO_ID = 'primary-artwork';

export const DEFAULT_TSHIRT_PRINT = {
  hangerVisible: true, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
};

/** Inverse of factories.js tshirtSimParams' gravity formula. Not clamped — the
 * caller (normalizeElementInstance) clamps the result to the catalog
 * fieldSpec's declared weight range, which is what keeps the simulation
 * inside its measured-stable bounds regardless of how far outside tshirt's
 * own range the sheet's own GRAVITY slider (0..4) is set. */
export function gravityToWeight(gravity) {
  if (!Number.isFinite(gravity)) return 0.5;
  return (gravity - TSHIRT_SIM_PARAMS_MIN_GRAVITY) / (TSHIRT_SIM_PARAMS_MAX_GRAVITY - TSHIRT_SIM_PARAMS_MIN_GRAVITY);
}

/**
 * CORRECTION (Codex review): the T-shirt only inherited color/roughness/bump
 * — Metalness, Finish, Clearcoat and (native-PBR) Iridescence stayed active
 * in the UI but were silently dropped. Metalness/Clearcoat/Iridescence now
 * map onto the SAME real MeshPhysicalMaterial properties the panel materials
 * already support (see factories.js tshirtMakePanelMaterial/
 * tshirtUpdateMaterial). Finish (glossy/satin/matte) has no property of its
 * own on either shape — on the SHEET it's a derived roughness/clearcoat
 * adjustment (ClothStudio.jsx's material effect); this reproduces that EXACT
 * formula so Finish genuinely affects the T-shirt too, not just the hidden
 * sheet. The bespoke holo-foil shader (sparkle/banding/hue-shift) has no
 * MeshPhysicalMaterial equivalent and stays sheet-only — disclosed via UI
 * copy, not silently dropped.
 */
export function mapPrimaryMaterialToTshirt(mat) {
  let roughness = mat.roughness;
  let clearcoat = mat.clearcoat;
  if (mat.finish === 'matte') { roughness = Math.max(roughness, 0.7); clearcoat *= 0.15; }
  else if (mat.finish === 'satin') { roughness = Math.min(1, roughness + 0.28); clearcoat *= 0.5; }
  return {
    color: mat.baseColor,
    roughness,
    normalStrength: mat.bump,
    metalness: mat.metalness,
    clearcoat,
    coatRoughness: mat.coatRoughness,
    iridescence: mat.iridescence,
    // CORRECTION (Codex review, round 3): sheen is a real MeshPhysicalMaterial
    // property (see factories.js tshirtUpdateMaterial) — direct pass-through,
    // no finish-adjustment (the sheet doesn't adjust sheen by finish either).
    sheen: mat.sheen,
  };
}

/**
 * Builds a RAW (unclamped) `hanging-tshirt`-shaped instance from the primary
 * sheet's own shared state. The caller MUST pass this through
 * `normalizeElementInstance(raw, 'hanging-tshirt')` (elements/schema.js)
 * before handing it to the factory — that's what clamps every numeric field
 * to the catalog's declared bounds (the same bounds the catalog's own
 * "measured never grows unbounded" stability comment relies on), exactly the
 * same validation path a real extraInstances entry already goes through.
 */
export function buildPrimaryTshirtInstanceRaw({ mat, phys, anim, tshirtPrint, hasArtwork }) {
  return {
    id: PRIMARY_TSHIRT_INSTANCE_ID,
    type: 'hanging-tshirt',
    enabled: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    material: mapPrimaryMaterialToTshirt(mat),
    motion: {
      rotate: Boolean(anim.on),
      speed: anim.speed,
    },
    appearance: {
      weight: gravityToWeight(phys.gravity),
      stretchStiffness: phys.stiffness,
      bendStiffness: phys.stiffness * TSHIRT_BEND_STIFFNESS_RATIO,
      damping: phys.damping,
      windStrength: anim.on ? anim.turbulence * TSHIRT_WIND_STRENGTH_SCALE : 0,
      windDirection: TSHIRT_PRIMARY_WIND_DIRECTION_DEG,
      windTurbulence: anim.turbulence,
      hangerVisible: Boolean(tshirtPrint?.hangerVisible),
      logoAssetId: hasArtwork ? PRIMARY_ARTWORK_LOGO_ID : '',
      logoX: tshirtPrint?.x ?? 0,
      logoY: tshirtPrint?.y ?? 0,
      logoScale: tshirtPrint?.scale ?? 1,
      logoRotation: tshirtPrint?.rotation ?? 0,
      logoOpacity: tshirtPrint?.opacity ?? 1,
    },
  };
}

/**
 * Migration for saved-state compatibility (task requirement #8). Reads the
 * RAW (pre-restoreExtraInstances) saved `extraInstances` array — raw, not
 * normalized, because restoreExtraInstances would otherwise either drop an
 * unrecognized/soon-to-be-singleton-only type or normalize away exactly the
 * fields this needs to read. Always strips EVERY 'hanging-tshirt' entry from
 * the returned `remainingExtraInstances` (the first enabled one is migrated;
 * any others — disabled or duplicate — are simply dropped, never rendered
 * again, matching "never render the migrated T-shirt plus the flyer
 * together"). Only genuinely garment-specific fields (hanger + print
 * placement) are carried over — weight/stiffness/damping/wind are now driven
 * by the SHARED phys/anim state, so migrating the old per-instance values
 * for those would silently overwrite the user's current sheet physics
 * instead of leaving them alone.
 *
 * CORRECTION (Codex review): a legacy shirt that was DISABLED must not
 * activate T-shirt mode — `migrated` is `false` whenever every legacy entry
 * is disabled (or none exist at all). `remainingExtraInstances` still strips
 * every legacy `hanging-tshirt` entry (disabled or not) regardless, so a
 * disabled shirt is removed, never left inert in `extraInstances` — it just
 * doesn't flip the primary shape. Only a genuinely ENABLED legacy shirt
 * migrates into primary T-shirt mode.
 */
export function extractLegacyTshirtMigration(rawExtraInstances) {
  const list = Array.isArray(rawExtraInstances) ? rawExtraInstances : [];
  const legacyEntries = list.filter((inst) => inst && inst.type === 'hanging-tshirt');
  if (!legacyEntries.length) {
    return { migrated: false, tshirtPrint: null, remainingExtraInstances: list };
  }
  const remainingExtraInstances = list.filter((inst) => !inst || inst.type !== 'hanging-tshirt');
  const enabled = legacyEntries.find((inst) => inst.enabled !== false);
  if (!enabled) {
    return { migrated: false, tshirtPrint: null, remainingExtraInstances };
  }
  const a = enabled.appearance || {};
  const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  return {
    migrated: true,
    tshirtPrint: {
      hangerVisible: typeof a.hangerVisible === 'boolean' ? a.hangerVisible : DEFAULT_TSHIRT_PRINT.hangerVisible,
      x: num(a.logoX, DEFAULT_TSHIRT_PRINT.x),
      y: num(a.logoY, DEFAULT_TSHIRT_PRINT.y),
      scale: num(a.logoScale, DEFAULT_TSHIRT_PRINT.scale),
      rotation: num(a.logoRotation, DEFAULT_TSHIRT_PRINT.rotation),
      opacity: num(a.logoOpacity, DEFAULT_TSHIRT_PRINT.opacity),
    },
    remainingExtraInstances,
  };
}
