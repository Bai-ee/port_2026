// art-timeline.mjs — Phase C ("Interrupted export recovery" — timeline
// transport + server keyframed device scroll, STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md). Pure, Node-side only, zero I/O — same
// "pure normalize/validate boundary" discipline art-recipe.mjs documents
// for itself.
//
// Two responsibilities, deliberately kept separate:
//
//   - sanitizeArtTimeline(raw): reduces an untrusted, FULL v2 timeline blob
//     (app/dashboard/studio/timeline.js's own `{keyframes:[{t, recipe, ...}],
//     totalSeconds, loop}` shape — each keyframe's `recipe` is an OPAQUE
//     captureSceneRecipe() snapshot) down to the small shape this render
//     pass actually implements and persists:
//       { totalSeconds, keyframes: [{ t, scroll: { scrollPosition, posY } }, ...] }
//     This is what a job document stores — the full per-keyframe recipes
//     never leave the route. A structurally invalid keyframe (no plain-
//     object `recipe`) is dropped, mirroring timeline.js's own
//     sanitizeKeyframeV2. Pure bounds/clamp/sort logic only — it does NOT
//     validate whether a keyframe's recipe matches the base scene anywhere
//     outside the two whitelisted fields; see checkArtTimelineCapabilities
//     below for that.
//
//   - checkArtTimelineCapabilities(baseRecipe, rawTimeline): the honesty
//     check. Deep-diffs each surviving keyframe's own recipe — normalized
//     through the EXACT SAME normalizeArtSceneRecipe the base scene went
//     through, so both sides are always apples-to-apples regardless of
//     what shape the raw submission arrived in — against the base scene's
//     already-normalized recipe. Any differing field outside the
//     whitelist (devicePrimary.scrollPosition/posY) is reported as a
//     precise `timeline-field:<path>` name; differing orbitPose across
//     keyframes is reported as `timeline-orbit-pose`. Returns the SAME
//     `{ supported, unsupportedFeatures }` shape checkCapabilities does, so
//     a caller can merge the two lists into one 422 response.
//
// ── Why this file imports app/dashboard/studio/timeline.js directly
// (unlike art-recipe.mjs's ./vendor/elements/* imports) ───────────────────
// This module is imported ONLY by app/api/dashboard/proof-render/route.js
// — a Vercel Next.js route, bundled by Next's own tracer, which resolves
// relative imports anywhere in the repo. It is never imported by anything
// that ships inside services/studio-render/Dockerfile.proof (the separate
// Cloud Run worker only ever receives the ALREADY-REDUCED timeline as a
// plain persisted job field — see proof-render-worker.mjs/art-render.mjs/
// art-scene.mjs, none of which import this file). See art-recipe.mjs's own
// header for why ITS imports need the vendored mirror instead: that module
// IS reachable from the render pipeline's own capability-check call sites
// in a way this one is not.
//
// timeline.js is plain, dependency-free ESM (no React/DOM/three.js — the
// same "pure enough to import from a Node service" bar art-recipe.mjs's
// own vendored elements/ imports meet) — only MAX_TIMELINE_KEYFRAMES is
// reused from it here, so the keyframe cap can never drift between the
// client's own editor budget and this server boundary.
import { MAX_TIMELINE_KEYFRAMES } from '../../app/dashboard/studio/timeline.js';
import { normalizeArtSceneRecipe, RECIPE_KIND, RECIPE_SCHEMA_VERSION } from './art-recipe.mjs';

export { MAX_TIMELINE_KEYFRAMES };

const T_MIN = 0;
const T_MAX = 1;
// Mirrors art-recipe.mjs's DEVICE_PRIMARY_BOUNDS exactly for these two
// fields (scrollPosition/posY) — the ONLY fields this reduction extracts.
const SCROLL_POSITION_BOUNDS = [0, 1];
const POS_Y_BOUNDS = [-0.8, 0.8];
// Mirrors timeline.js's own (private, unexported) TOTAL_SECONDS bounds/
// default exactly — duplicated here for the same reason art-recipe.mjs
// duplicates ClothStudio.jsx's enum lists: nothing to import instead.
const TOTAL_SECONDS_MIN = 1;
const TOTAL_SECONDS_MAX = 120;
const TOTAL_SECONDS_DEFAULT = 8;
// Same rationale as timeline.js's own TIE_NUDGE — never hand the render
// loop a zero-width interpolation segment.
const TIE_NUDGE = 0.01;

function clamp(value, [min, max]) {
  return Math.min(max, Math.max(min, value));
}
function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * See module header. Absent/malformed `raw`, or a raw timeline whose every
 * keyframe fails the structural check, both reduce to
 * `{ totalSeconds: 0, keyframes: [] }` — the route treats zero surviving
 * keyframes identically to "no timeline was submitted at all" (see its own
 * comment), so a malformed/empty submission is inert, never an error.
 */
export function sanitizeArtTimeline(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const sourceKeyframes = Array.isArray(r.keyframes) ? r.keyframes : [];

  const kept = [];
  sourceKeyframes.slice(0, MAX_TIMELINE_KEYFRAMES).forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    if (!isPlainObject(entry.recipe)) return; // structural requirement — see header
    const t = isFiniteNum(entry.t) ? clamp(entry.t, [T_MIN, T_MAX]) : T_MIN;
    const dp = isPlainObject(entry.recipe.devicePrimary) ? entry.recipe.devicePrimary : {};
    const scrollPosition = isFiniteNum(dp.scrollPosition) ? clamp(dp.scrollPosition, SCROLL_POSITION_BOUNDS) : 0;
    const posY = isFiniteNum(dp.posY) ? clamp(dp.posY, POS_Y_BOUNDS) : 0;
    kept.push({ t, scroll: { scrollPosition, posY } });
  });

  kept.sort((a, b) => a.t - b.t);
  for (let i = 1; i < kept.length; i += 1) {
    if (kept[i].t <= kept[i - 1].t) kept[i].t = Math.min(T_MAX, kept[i - 1].t + TIE_NUDGE);
  }

  if (kept.length === 0) return { totalSeconds: 0, keyframes: [] };
  const totalSeconds = isFiniteNum(r.totalSeconds)
    ? clamp(r.totalSeconds, [TOTAL_SECONDS_MIN, TOTAL_SECONDS_MAX])
    : TOTAL_SECONDS_DEFAULT;
  return { totalSeconds, keyframes: kept };
}

// Small float-safe tolerance — both sides of the comparison ultimately
// derive from the same client-side number (buildTimelineSubmission sends
// `durationSeconds = timelineDuration(timeline)` verbatim), so a mismatch
// here means a genuinely different value, never float noise.
const DURATION_MATCH_EPSILON = 1e-6;

/**
 * The duration contract for a timeline-driven FINAL RENDER (mirrors Quick
 * Export's own exportTimeline — a timeline-driven capture runs for
 * timelineDuration(timeline), never the videoSeconds dial): the caller's
 * `durationSeconds` must equal `sanitizedTimeline.totalSeconds` exactly
 * (within float tolerance). Returns `true` on a MISMATCH (including a
 * non-finite/missing `durationSeconds`) — the route rejects loudly on
 * `true` rather than silently preferring either side. Not applicable to
 * Proof (its own durationSeconds is a fixed, small, deterministic-check
 * profile that intentionally never varies with timeline length — see the
 * route's own call-site comment) and never called there.
 */
export function timelineDurationMismatch(sanitizedTimeline, durationSeconds) {
  if (!Number.isFinite(durationSeconds)) return true;
  return Math.abs(durationSeconds - sanitizedTimeline.totalSeconds) > DURATION_MATCH_EPSILON;
}

// ── Deep-diff (the honesty core) ────────────────────────────────────────
// Dot-path convention matches timeline.js's own TIMELINE_LERP_WHITELIST
// (e.g. `glass.position.1`, `lightCans.0.intensity`) so a rejection name
// reads exactly like the whitelist entry a future tranche would add to
// support it.
function diffRecipePaths(a, b, prefix, out) {
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr) {
    if (a.length !== b.length) { out.push(prefix); return; }
    for (let i = 0; i < a.length; i += 1) {
      diffRecipePaths(a[i], b[i], prefix ? `${prefix}.${i}` : String(i), out);
    }
    return;
  }
  const aObj = isPlainObject(a);
  const bObj = isPlainObject(b);
  if (aObj && bObj) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach((k) => diffRecipePaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out));
    return;
  }
  if (aArr !== bArr || aObj !== bObj) { out.push(prefix); return; } // type mismatch — report at this path, don't recurse into it
  if (a !== b) out.push(prefix);
}

/** Every distinct dot-path where `a` and `b` differ, in first-seen order (a caller sorts if it wants determinism). */
function diffRecipes(a, b) {
  const out = [];
  diffRecipePaths(a, b, '', out);
  return out;
}

// This phase implements tweening ONLY these two leaves (see the handoff's
// own "Out of scope: widening the tween whitelist" line) — never widened
// here without a corresponding art-scene.mjs render-side change.
const ALLOWED_TIMELINE_PATHS = new Set(['devicePrimary.scrollPosition', 'devicePrimary.posY']);

// Device screen-source fields — the client strips these from every
// keyframe recipe before transport (app/dashboard/studio/timeline.js's
// buildTimelineSubmission), and this is defense-in-depth on top of that:
// never compared, regardless of whether they actually differ, because the
// BASE scene's own pinned screen is authoritative for the whole render
// (see the handoff's own design contract). `screenStillInvalid` is a
// normalization-only artifact (art-recipe.mjs's sanitizeDevicePrimary),
// never a real submitted field, so it's ignored on the same basis.
//
// ── Recovery round 2 (Defect 2) — full field-by-field ignore classification
// ───────────────────────────────────────────────────────────────────────
// `stageAspect` (measured live off the renderer's DOM canvas at every
// captureSceneRecipe() call — window size / rail layout, never authored)
// was rejecting real users on noise: two keyframes captured moments apart
// almost always carry slightly different values, and the base scene's
// stageAspect is ALREADY the sole input to the crop math for the ENTIRE
// render (art-scene-def.mjs resolveFrameRender is called once, from the
// top-level `recipe` param renderArtScene/inspectScene receive — never
// per-keyframe; a keyframe's own stageAspect is physically never read).
// That render pass audited EVERY key `captureSceneRecipe()` emits (cross-
// referenced against real grep evidence in this render pass, not assumed
// from art-render-validation.mjs's own older field-audit comment, which
// predates the Slice B/C scene-parity and Slice F1/tier work and is stale
// on two of these: `sceneSeed` now genuinely seeds the bgMode:'scene'
// backdrop grain, and `elementQualityTier` now genuinely sets the tshirt/
// device factory's build tier — both correctly still REJECT below).
//
//   IGNORED (qualifies under the handoff's own narrow bar — either the
//   server never reads the field when rendering ANY recipe (a), or the
//   field is environmental/derived AND the base scene's value alone
//   governs the WHOLE render by construction, so a keyframe's own value is
//   physically never consulted (b)):
//     stageAspect              (b) — see above; crop math reads only the
//                                    base recipe's value, once, for the
//                                    entire video.
//     cam.rotX/rotY/pan        (a) — orbit-drag preview toggles; zero
//                                    references anywhere in art-scene.mjs.
//     lightTemplate             (a) — informational label for how lightCans
//                                    was generated; lightCans itself (the
//                                    actual light values) is what renders.
//     camSeed                   (a) — provenance for an already-resolved
//                                    concrete shotCam value; never read.
//     fxPresetId                 (a) — provenance label for which fx preset
//                                    was last clicked; never read (and any
//                                    genuine fx DIFFERENCE it would imply
//                                    is independently caught by the `fx`
//                                    object comparison below, which stays
//                                    render-affecting — nothing is hidden).
//     videoSeconds/videoFormat  (a) — the BROWSER's own local Quick Export
//                                    dial/container choice; this render
//                                    pass's own fps/durationSeconds/preset
//                                    are separate, server-resolved values.
//     elementFormatId            (a) — editor-only placement-suggestion
//                                    preference for NEW extraInstances;
//                                    never read anywhere in the render
//                                    pipeline (extraInstances itself stays
//                                    fully compared/gated below).
//     bgFx.fit / bgFx.shiftY    (a) — only ever apply once bgMode:'image'
//                                    itself renders, which stays precisely
//                                    capability-gated (Slice D) — for any
//                                    recipe that reaches this diff at all,
//                                    these two are unconditionally unread.
//
//   NOT ignored — RENDER-AFFECTING, keeps rejecting a genuine differing
//   value by precise name (non-exhaustive; every other key not listed
//   above or below follows the same rule): mat, phys, anim, lightCans,
//   glass, shotCam, diffusionCamera, frameId, envId, fx, clothAspect,
//   clothShape, tshirtPrint, artworkRatio, artworkId, bgMode, bgColor,
//   bgFx.diffusion (feeds the diffusion composer's uBgDiffusion uniform),
//   sceneId, sceneTweaks (both genuinely compose the bgMode:'scene'
//   background), envIntensity, sceneSeed (seeds the scene backdrop's film
//   grain), lookSeed (seeds the cloth bump grain), perf (cloth tessellation
//   density), elementQualityTier (tshirt/device factory build tier),
//   extraInstances, textLayers, and every devicePrimary field outside the
//   scrollPosition/posY whitelist below and the screen-source set above.
//
//   NEVER CARRIED, so PHYSICALLY CANNOT appear in this diff at all (no
//   ignore-list entry needed — art-recipe.mjs's normalizeScene drops these
//   before either side of the diff exists): hudOn, elementLocks,
//   randomizeIntensity (all three are pure randomize-editor/HUD UI state
//   with zero render effect — see that module's own normalizeScene
//   docstring). `devicePrimary.captureSourceUrl`/`captureViewport`
//   (Recovery round 2's new client-only capture-provenance fields) are
//   likewise never carried by sanitizeDevicePrimary — same reasoning,
//   documented at that function's own call site in art-recipe.mjs.
const IGNORED_TIMELINE_EXACT_PATHS = new Set([
  'devicePrimary.live', 'devicePrimary.liveUrl', 'devicePrimary.captureUrl',
  'devicePrimary.uploadAssetId', 'devicePrimary.screenStillInvalid',
  'stageAspect',
  'cam.rotX', 'cam.rotY', 'cam.pan',
  'lightTemplate', 'camSeed', 'fxPresetId',
  'videoSeconds', 'videoFormat', 'elementFormatId',
  'bgFx.fit', 'bgFx.shiftY',
]);
function isIgnoredTimelinePath(path) {
  return IGNORED_TIMELINE_EXACT_PATHS.has(path)
    || path === 'devicePrimary.screenStill'
    || path.startsWith('devicePrimary.screenStill.');
}

/**
 * All-or-nothing equality for a keyframe's `orbitPose` (either `null` or a
 * finite 6-tuple — timeline.js's own sanitizeOrbitPose contract) — a plain
 * JSON round-trip is exact for that shape.
 */
function orbitPosesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Normalizes one raw keyframe recipe through the EXACT SAME
 * normalizeArtSceneRecipe the base scene goes through, so the two sides of
 * every diff are always comparable regardless of what shape the raw
 * submission arrived in. Never throws outward — normalizeArtSceneRecipe's
 * own ArtRecipeValidationError (oversized/non-serializable payload) is
 * caught by the caller, which treats that keyframe as having nothing
 * meaningful to diff (same leniency sanitizeArtTimeline's own structural
 * check applies for a keyframe that can't even be reduced).
 */
function normalizedKeyframeRecipe(rawRecipe) {
  return normalizeArtSceneRecipe({ kind: RECIPE_KIND, schemaVersion: RECIPE_SCHEMA_VERSION, scene: rawRecipe }).recipe;
}

/**
 * The honesty check (see module header). `baseRecipe` must already be a
 * NORMALIZED recipe (the route's own `normalizeArtSceneRecipe(...).recipe`
 * — never re-normalized here). `rawTimeline` is the untrusted, full client
 * submission (the same shape sanitizeArtTimeline reads).
 *
 * Returns `{ supported, unsupportedFeatures }` — the SAME shape
 * checkCapabilities returns, so a caller can concatenate the two lists
 * into one 422 response. Never short-circuits: every distinct differing
 * path across every keyframe is collected (sorted, for a deterministic
 * response) before returning — a caller sees the COMPLETE list of what's
 * unsupported. A structurally invalid keyframe (no plain-object `recipe`)
 * is silently skipped — the exact same keyframe sanitizeArtTimeline would
 * also drop, so there is nothing for this function to validate for it
 * either.
 */
export function checkArtTimelineCapabilities(baseRecipe, rawTimeline) {
  const sourceKeyframes = Array.isArray(rawTimeline?.keyframes) ? rawTimeline.keyframes.slice(0, MAX_TIMELINE_KEYFRAMES) : [];
  const validKeyframes = sourceKeyframes.filter((kf) => kf && typeof kf === 'object' && isPlainObject(kf.recipe));
  if (validKeyframes.length === 0) return { supported: true, unsupportedFeatures: [] };

  const fieldPaths = new Set();
  const orbitPoses = [];
  validKeyframes.forEach((kf) => {
    let normalizedKf;
    try {
      normalizedKf = normalizedKeyframeRecipe(kf.recipe);
    } catch {
      return; // malformed beyond the structural check (e.g. oversized) — nothing meaningful to diff
    }
    diffRecipes(baseRecipe, normalizedKf).forEach((path) => {
      if (isIgnoredTimelinePath(path) || ALLOWED_TIMELINE_PATHS.has(path)) return;
      fieldPaths.add(path);
    });
    orbitPoses.push(kf.orbitPose ?? null);
  });

  const unsupportedFeatures = [...fieldPaths].sort().map((path) => `timeline-field:${path}`);
  const orbitPoseVaries = orbitPoses.some((pose) => !orbitPosesEqual(pose, orbitPoses[0]));
  if (orbitPoseVaries) unsupportedFeatures.push('timeline-orbit-pose');

  return { supported: unsupportedFeatures.length === 0, unsupportedFeatures };
}
