// Paint Studio — versioned recipe schema, normalization, and provenance.
// A recipe is the single source of truth for a piece of Paint artwork:
// { schemaVersion, templateId, templateVersion, seed, paletteId, background,
//   params, output }. `template + version + palette + params + seed` must
// always reproduce the same image (PAINT_STUDIO_PLAN.md "Expected result").
//
// This module is built against the template-module CONTRACT (see
// docs/plans/PAINT_STUDIO_CLAUDE_HANDOFF.md), not the real templates catalog
// under ./templates/, which a sibling agent builds in parallel and may not
// exist yet. Every exported function accepts an optional trailing `deps`
// bag ({ getTemplate, listTemplates }) that overrides template resolution
// for callers (tests) that need a self-contained fake template — real
// production call sites simply omit it and get the live ./templates/index.js
// catalog. Because that file may not exist yet while this module is being
// developed in parallel, the default resolver below is loaded with a
// top-level dynamic import guarded by try/catch: this module always loads
// cleanly, and once the sibling agent's ./templates/index.js lands, the real
// catalog is picked up automatically with no code change here.
import { snapToStep } from '../elements/randomize.js';
import { getPaintFormat, DEFAULT_PAINT_FORMAT_ID } from './output-formats.js';
import { normalizeBookTypography } from './book-typography.js';

export const CURRENT_SCHEMA_VERSION = 3;

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Best-effort default resolver. Resolves to `undefined` (never throws) when
// ./templates/index.js is not present yet — real callers only hit that path
// once the sibling agent's module has landed.
let realGetTemplate;
let realListTemplates;
try {
  const templatesModule = await import('./templates/index.js');
  realGetTemplate = templatesModule.getTemplate;
  realListTemplates = templatesModule.listTemplates;
} catch {
  realGetTemplate = undefined;
  realListTemplates = undefined;
}

function resolveGetTemplate(deps) {
  if (deps && typeof deps.getTemplate === 'function') return deps.getTemplate;
  return realGetTemplate;
}

function resolveListTemplates(deps) {
  if (deps && typeof deps.listTemplates === 'function') return deps.listTemplates;
  return realListTemplates;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Recursive plain-object merge. Never mutates `base` or `overrides`; array
// values and non-plain-object values in `overrides` replace `base` wholesale.
function deepMerge(base, overrides) {
  if (!isPlainObject(overrides)) return isPlainObject(base) ? { ...base } : base;
  const result = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(overrides)) {
    const overrideValue = overrides[key];
    if (isPlainObject(overrideValue) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], overrideValue);
    } else if (isPlainObject(overrideValue)) {
      result[key] = deepMerge({}, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

function toUint32Seed(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n) >>> 0;
}

// createRecipe(templateId, overrides = {}) — looks up the template, deep-
// merges `overrides` onto template.defaults, stamps schema/template
// versions, sets the output format (default unless overridden), then runs
// the result through normalizeRecipe. Throws a clear Error if templateId
// does not resolve to a real template.
export function createRecipe(templateId, overrides = {}, deps = {}) {
  const getTemplateFn = resolveGetTemplate(deps);
  if (typeof getTemplateFn !== 'function') {
    throw new Error('paint/recipe: no template resolver available (templates module not present and none injected)');
  }
  const template = getTemplateFn(templateId);
  if (!template) {
    throw new Error(`paint/recipe: unknown templateId "${templateId}"`);
  }

  const base = {
    templateId: template.id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    templateVersion: template.version,
    seed: template.defaults?.seed ?? 1,
    paletteId: template.defaults?.paletteId,
    background: template.defaults?.background,
    params: template.defaults?.params,
    output: { formatId: DEFAULT_PAINT_FORMAT_ID },
    text: { enabled: true, layout: 'chapter' },
  };
  const merged = deepMerge(base, overrides || {});
  return normalizeRecipe(merged, deps);
}

// normalizeRecipe(recipe) — pure. Given any recipe-shaped object (possibly
// stale/hand-edited/from an older schema version), returns a fully valid,
// clamped recipe. See the module header for the `deps` override contract.
export function normalizeRecipe(recipe, deps = {}) {
  const getTemplateFn = resolveGetTemplate(deps);
  if (typeof getTemplateFn !== 'function') {
    throw new Error('paint/recipe: no template resolver available (templates module not present and none injected)');
  }
  const input = isPlainObject(recipe) ? recipe : {};

  let template = getTemplateFn(input.templateId);
  if (!template) {
    const listTemplatesFn = resolveListTemplates(deps);
    const list = typeof listTemplatesFn === 'function' ? listTemplatesFn() : [];
    template = Array.isArray(list) ? list[0] : undefined;
  }
  if (!template) {
    throw new Error('paint/recipe: no templates available to normalize against');
  }

  const schemaParams = template.schema?.params || {};
  const inputParams = isPlainObject(input.params) ? input.params : {};
  const params = {};
  Object.keys(schemaParams).forEach((key) => {
    const bounds = schemaParams[key] || {};
    const { min, max, step, default: def } = bounds;
    let value = inputParams[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      value = def;
    }
    if (typeof min === 'number') value = Math.max(min, value);
    if (typeof max === 'number') value = Math.min(max, value);
    if (typeof step === 'number' && step > 0) value = snapToStep(value, step);
    if (typeof min === 'number') value = Math.max(min, value);
    if (typeof max === 'number') value = Math.min(max, value);
    params[key] = value;
  });

  const palettes = Array.isArray(template.palettes) ? template.palettes : [];
  let paletteId = input.paletteId;
  if (!palettes.some((palette) => palette.id === paletteId)) {
    paletteId = palettes[0]?.id ?? template.defaults?.paletteId;
  }

  const inputColor = isPlainObject(input.background) ? input.background.color : undefined;
  const backgroundColor = typeof inputColor === 'string' && HEX_COLOR_RE.test(inputColor)
    ? inputColor
    : (template.defaults?.background?.color || '#ffffff');

  const formatId = isPlainObject(input.output) ? input.output.formatId : undefined;
  const format = getPaintFormat(formatId);

  const seed = toUint32Seed(input.seed, undefined) ?? toUint32Seed(template.defaults?.seed, 1) ?? 1;
  const text = normalizeBookTypography(input.text);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    templateId: template.id,
    templateVersion: template.version,
    seed,
    paletteId,
    background: { color: backgroundColor },
    params,
    output: { formatId: format.id, width: format.w, height: format.h },
    text,
  };
}

// migrateRecipe(rawRecipe) — schemaVersion migration entry point. Only
// schemaVersion 1 exists today, so this defaults a missing/invalid
// schemaVersion to 1 and normalizes. A future schemaVersion 2 migration step
// slots into the switch below, falling through to normalizeRecipe.
export function migrateRecipe(rawRecipe, deps = {}) {
  const input = isPlainObject(rawRecipe) ? rawRecipe : {};
  const schemaVersion = Number.isFinite(input.schemaVersion) ? input.schemaVersion : 1;
  let coerced = { ...input, schemaVersion };

  switch (schemaVersion) {
    case 1:
      // Existing V1 wallpapers must not suddenly gain a title when loaded.
      coerced = {
        ...coerced,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        text: normalizeBookTypography(coerced.text || { enabled: false }),
      };
      return normalizeRecipe(coerced, deps);
    default:
      return normalizeRecipe(coerced, deps);
  }
}

// buildProvenance(recipe, { rendererRevision, createdAt }) — pure. Never
// reads the clock itself; callers pass `createdAt` as an ISO string.
export function buildProvenance(recipe, { rendererRevision, createdAt } = {}) {
  const r = isPlainObject(recipe) ? recipe : {};
  return {
    schemaVersion: r.schemaVersion,
    templateId: r.templateId,
    templateVersion: r.templateVersion,
    seed: r.seed,
    paletteId: r.paletteId,
    params: r.params,
    background: r.background,
    output: r.output,
    text: r.text,
    rendererRevision,
    createdAt,
    tool: 'paint-studio',
  };
}
