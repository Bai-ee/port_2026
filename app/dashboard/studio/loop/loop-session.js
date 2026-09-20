// loop-session.js — Loop Studio cloud saves ("loop sessions"), Feature 2 of
// the Loop Studio saves handoff. Pure module (no React, no DOM, no Web
// Audio) — same standalone tier as loop-engine.js/workbench-view.js, so it
// is directly testable under node:test AND safely dynamic-import()able from
// the CommonJS server module api/_lib/studio-templates.cjs, exactly the way
// that module already dynamic-imports elements/preset-kinds.js +
// elements/scene-recipe.js (see its loadStudioModules()).
//
// Recipe shape (kind: 'loop', schemaVersion 1) — a snapshot of the Grid/
// Readout/Loops-inspector/Export dials LoopStudio.jsx needs to fully
// reconstruct a working session, PLUS which source track it was working on:
//
//   enginePath      string|null   last-loaded KNOWN ENGINE TRACKS path
//                                 (loopcore), or null for a local-file
//                                 session (local file BYTES are never
//                                 persisted — see the handoff's hard rule).
//   sourceName      string|null   display name of the source (file name or
//                                 engine track basename), for the "re-drop
//                                 X to restore" / status-line UX.
//   bpm             number        clampBpm()'d, [30,300]
//   barsPerLoop     integer       [1,64]
//   offsetSamples   integer
//   meter           integer       [2,12]
//   phaseOverride   integer|null
//   overlays        { beats, downbeats, phaseCandidates, boundaries,
//                     transientRisk, clickRisk }: booleans
//   zoomFactor      number        clampZoom()'d, [1,64] (workbench-view.js's
//                                 ZOOM_MIN/ZOOM_MAX)
//   repairStrategy  one of REPAIR_STRATEGY_VALUES
//   repeatCount     integer       [1,16]
//   verdictSummary  { total, pass, warn, fail } non-negative ints — OPTIONAL,
//                                 omitted entirely when not supplied/valid
//                                 (no "last known verdict" fabricated).
//
// sanitizeLoopSessionRecipe(raw) whitelists/clamps every field above and
// strips anything else, same "never trust stored/incoming JSON, always
// resolve to a safe shape" discipline elements/preset-kinds.js's own
// sanitize<Kind>PresetRecipe functions use. Unlike those three (which take
// a `fallback` recipe to merge against), a loop session has no natural
// fallback recipe to merge onto, so a genuinely hopeless `raw` (not a plain
// object at all) returns `null` rather than fabricating one from nothing —
// the one place this module's signature differs from preset-kinds.js's.
// Every individual field, by contrast, always resolves to a safe default
// when it's missing or the wrong shape/type/range — never null/undefined
// propagating into the stored recipe (except phaseOverride, enginePath,
// sourceName, and verdictSummary, which are legitimately optional/null).

import { clampBpm } from './loop-engine.js';
import { clampZoom, ZOOM_MIN } from './workbench-view.js';

export const LOOP_SESSION_SCHEMA_VERSION = 1;

// Mirrors LoopStudio.jsx's own DEFAULT_OVERLAYS key set exactly (module-
// local duplication, same precedent as preset-kinds.js's DEFAULT_LOOK_*
// constants — this module can't import a 'use client' component file).
const OVERLAY_KEYS = ['beats', 'downbeats', 'phaseCandidates', 'boundaries', 'transientRisk', 'clickRisk'];

// Mirrors LoopStudio.jsx's own REPAIR_STRATEGIES value list exactly — a
// small, stable enum, so (unlike Scene Template's many ClothStudio-local
// enums) an exact allow-list here is both safe and cheap to keep in sync.
export const REPAIR_STRATEGY_VALUES = ['none', 'equal_power_crossfade', 'zero_cross_snap', 'microfade', 'silence_trim'];
const DEFAULT_REPAIR_STRATEGY = 'equal_power_crossfade';

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(raw, min, max, fallback) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampIntOrNull(raw, min, max) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function clampNonNegInt(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function clampString(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s ? s.slice(0, maxLen) : null;
}

function sanitizeOverlays(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const out = {};
  OVERLAY_KEYS.forEach((key) => { out[key] = r[key] === true; });
  return out;
}

/**
 * { total, pass, warn, fail } non-negative ints — OPTIONAL. Returns
 * `undefined` (never included in the sanitized recipe) unless `raw` is a
 * plain object supplying at least one valid non-negative-int field; any
 * field missing/invalid within an otherwise-valid object falls back to 0
 * (a genuinely-zero count, not "unknown"), matching how verification.report
 * .summary itself is always a fully-populated {total,pass,warn,fail} object
 * whenever it exists at all.
 */
function sanitizeVerdictSummary(raw) {
  if (!isPlainObject(raw)) return undefined;
  const total = clampNonNegInt(raw.total);
  const pass = clampNonNegInt(raw.pass);
  const warn = clampNonNegInt(raw.warn);
  const fail = clampNonNegInt(raw.fail);
  if (total === null && pass === null && warn === null && fail === null) return undefined;
  return {
    total: total ?? 0, pass: pass ?? 0, warn: warn ?? 0, fail: fail ?? 0,
  };
}

/**
 * Whitelist/clamp an untrusted `raw` value into a valid loop-session
 * recipe. Returns `null` for hopeless input (not a plain object at all —
 * see the header comment for why this differs from preset-kinds.js's own
 * sanitizers). Otherwise ALWAYS returns a fully-valid recipe: every field
 * missing or out of range/type resolves to a safe default rather than
 * propagating garbage or throwing.
 */
export function sanitizeLoopSessionRecipe(raw) {
  if (!isPlainObject(raw)) return null;
  const verdictSummary = sanitizeVerdictSummary(raw.verdictSummary);
  return {
    schemaVersion: LOOP_SESSION_SCHEMA_VERSION,
    enginePath: clampString(raw.enginePath, 512),
    sourceName: clampString(raw.sourceName, 120),
    bpm: clampBpm(raw.bpm),
    barsPerLoop: clampInt(raw.barsPerLoop, 1, 64, 4),
    offsetSamples: clampInt(raw.offsetSamples, -2_000_000_000, 2_000_000_000, 0),
    meter: clampInt(raw.meter, 2, 12, 4),
    phaseOverride: clampIntOrNull(raw.phaseOverride, 0, 100_000),
    overlays: sanitizeOverlays(raw.overlays),
    zoomFactor: clampZoom(raw.zoomFactor ?? ZOOM_MIN),
    repairStrategy: REPAIR_STRATEGY_VALUES.includes(raw.repairStrategy) ? raw.repairStrategy : DEFAULT_REPAIR_STRATEGY,
    repeatCount: clampInt(raw.repeatCount, 1, 16, 4),
    ...(verdictSummary !== undefined ? { verdictSummary } : {}),
  };
}

/**
 * Builds the live-recipe object LoopStudio.jsx's CloudTemplateSection
 * `onCaptureRecipe` hands to the server on Save — a plain assembly of the
 * caller's current state, NOT itself run through sanitizeLoopSessionRecipe
 * (same precedent as ClothStudio.jsx's own captureSceneRecipe: the server
 * is the real sanitization boundary — see api/_lib/studio-templates.cjs's
 * validateAndSanitizeRecipe, which always re-sanitizes on write).
 */
export function captureLoopSessionRecipe(state = {}) {
  return {
    schemaVersion: LOOP_SESSION_SCHEMA_VERSION,
    enginePath: state.enginePath ?? null,
    sourceName: state.sourceName ?? null,
    bpm: state.bpm,
    barsPerLoop: state.barsPerLoop,
    offsetSamples: state.offsetSamples,
    meter: state.meter,
    phaseOverride: state.phaseOverride ?? null,
    overlays: { ...(state.overlays || {}) },
    zoomFactor: state.zoomFactor,
    repairStrategy: state.repairStrategy,
    repeatCount: state.repeatCount,
    ...(state.verdictSummary ? { verdictSummary: { ...state.verdictSummary } } : {}),
  };
}
