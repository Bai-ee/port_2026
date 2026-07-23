// Generic, catalog-driven field validation/clamping — used by schema.js to
// normalize every nested bucket (material/motion/appearance/transform) against
// an explicit per-type field spec declared in catalog.js. Unknown keys are
// dropped (only keys present in the spec ever reach the output), numbers are
// clamped to their declared [min, max], and anything malformed falls back to
// the spec's declared default rather than passing through. Pure logic — no
// React, no three.js — so it's unit-testable on its own.

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isHexColor(value) {
  return typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

// Per-component clamp — a partially-malformed vector keeps its valid
// components rather than discarding the whole thing (index 1 bad, 0 and 2
// fine → only index 1 falls back).
export function clampVec3(raw, spec) {
  const fallback = spec.default;
  if (!Array.isArray(raw)) return [...fallback];
  return [0, 1, 2].map((i) => clampNumber(raw[i], spec.min, spec.max, fallback[i]));
}

// A bounded, sanitized free string — for values like an uploaded asset's id
// or a selected animation-clip name, which come from a dynamic (not catalog-
// fixed) list and so can't use 'enum'. Still never passed through
// unvalidated: non-strings and anything past maxLength fall back to the
// spec's default, exactly like every other field type here.
export function clampString(value, maxLength, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLength || 200);
}

/**
 * Build a normalized nested bucket from raw input against a field spec:
 * `{ key: { type: 'number'|'boolean'|'color'|'enum'|'vec3'|'string', min?, max?, values?, maxLength?, default } }`.
 * Every key declared in the spec is present in the output; every key NOT
 * declared in the spec is dropped — unknown/stale/foreign fields can never
 * leak through.
 */
export function normalizeFieldGroup(raw, spec) {
  const out = {};
  Object.keys(spec || {}).forEach((key) => {
    const fieldSpec = spec[key];
    const rawValue = raw && typeof raw === 'object' ? raw[key] : undefined;
    switch (fieldSpec.type) {
      case 'number':
        out[key] = rawValue === undefined
          ? fieldSpec.default
          : clampNumber(rawValue, fieldSpec.min, fieldSpec.max, fieldSpec.default);
        break;
      case 'boolean':
        out[key] = typeof rawValue === 'boolean' ? rawValue : fieldSpec.default;
        break;
      case 'color':
        out[key] = isHexColor(rawValue) ? rawValue : fieldSpec.default;
        break;
      case 'enum':
        out[key] = (fieldSpec.values || []).includes(rawValue) ? rawValue : fieldSpec.default;
        break;
      case 'vec3':
        out[key] = clampVec3(rawValue, fieldSpec);
        break;
      case 'string':
        out[key] = rawValue === undefined ? fieldSpec.default : clampString(rawValue, fieldSpec.maxLength, fieldSpec.default);
        break;
      default:
        out[key] = fieldSpec.default;
    }
  });
  return out;
}

export function defaultsFromFieldGroup(spec) {
  const out = {};
  Object.keys(spec || {}).forEach((key) => {
    out[key] = spec[key].type === 'vec3' ? [...spec[key].default] : spec[key].default;
  });
  return out;
}
