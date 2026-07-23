// Element instance schema — normalize/create/migrate a scene-element instance
// against its catalog entry (see catalog.js). Every element on the ELEMENTS
// rail card is one of these; unknown fields are stripped, numeric fields are
// clamped to catalog-declared bounds, and unknown types render as an explicit
// unsupported instance rather than throwing.

import { getElementDefinition } from './catalog.js';
import { normalizeFieldGroup, defaultsFromFieldGroup } from './validators.js';

export const ELEMENT_SCHEMA_VERSION = 1;

const DEPTH_VALUES = ['foreground', 'hero', 'background'];

// Fixed across every element type — part of the universal instance envelope,
// not catalog-specific.
const RANDOM_GROUP_SPEC = {
  transform: { type: 'boolean', default: false },
  material: { type: 'boolean', default: false },
  motion: { type: 'boolean', default: false },
  appearance: { type: 'boolean', default: false },
};

// formatOverrides holds per-format field overrides once the catalog declares
// any (none do yet in Phase 1) — until a type declares fields here, every key
// normalizes to an empty object so nothing can leak through.
function normalizeFormatOverrides() {
  return { landscape: {}, square: {}, reel: {} };
}

/**
 * Normalize a raw (possibly partial/stale/foreign) instance against its
 * catalog definition. Always returns a complete, versioned, serializable
 * object — never throws on malformed input. Every nested bucket is built via
 * an explicit allowlist (validators.normalizeFieldGroup): unknown keys are
 * dropped and numeric/color/enum/vector values are clamped/validated, never
 * passed through verbatim.
 */
export function normalizeElementInstance(raw = {}, typeOverride) {
  const type = typeOverride || raw?.type;
  const def = getElementDefinition(type);
  if (!def) {
    return {
      id: String(raw?.id || `unknown-${type || 'element'}`),
      type: type || 'unknown',
      version: ELEMENT_SCHEMA_VERSION,
      enabled: false,
      name: String(raw?.name || 'Unsupported element'),
      unsupported: true,
    };
  }
  const spec = def.fieldSpec || {};
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : def.label;
  return {
    id: String(raw?.id || `${def.type}-1`),
    type: def.type,
    version: ELEMENT_SCHEMA_VERSION,
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : Boolean(def.defaultEnabled),
    name,
    depth: DEPTH_VALUES.includes(raw?.depth) ? raw.depth : (def.defaultDepth || 'hero'),
    transform: normalizeFieldGroup(raw?.transform, spec.transform || {}),
    material: normalizeFieldGroup(raw?.material, spec.material || {}),
    motion: normalizeFieldGroup(raw?.motion, spec.motion || {}),
    appearance: normalizeFieldGroup(raw?.appearance, spec.appearance || {}),
    formatOverrides: normalizeFormatOverrides(),
    random: {
      locked: typeof raw?.random?.locked === 'boolean' ? raw.random.locked : false,
      groups: normalizeFieldGroup(raw?.random?.groups, RANDOM_GROUP_SPEC),
    },
    // Catalog-derived, never user-editable — raw.quality is intentionally
    // ignored entirely so a stale/foreign quality block can't override cost
    // accounting for this element type.
    quality: {
      minTier: def.quality?.minTier || 'draft',
      estimatedCost: def.quality?.estimatedCost ?? def.performanceCost ?? 1,
    },
    previewSupported: Boolean(def.previewSupported),
    finalRenderSupported: Boolean(def.finalRenderSupported),
  };
}

/** Create a fresh instance of `type` from its catalog defaults + overrides. */
export function createElementInstance(type, overrides = {}) {
  return normalizeElementInstance({ ...overrides, type }, type);
}

/** Catalog-declared defaults for a type's transform/material/motion/appearance. */
export function getElementDefaults(type) {
  const def = getElementDefinition(type);
  if (!def) return null;
  const spec = def.fieldSpec || {};
  return {
    transform: defaultsFromFieldGroup(spec.transform || {}),
    material: defaultsFromFieldGroup(spec.material || {}),
    motion: defaultsFromFieldGroup(spec.motion || {}),
    appearance: defaultsFromFieldGroup(spec.appearance || {}),
  };
}
