import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipe, normalizeRecipe, migrateRecipe, buildProvenance } from '../recipe.js';

// A local fake template satisfying the template-module CONTRACT documented
// in recipe.js's header / PAINT_STUDIO_CLAUDE_HANDOFF.md. Deliberately does
// NOT import the real ./templates/index.js catalog (owned by a sibling
// agent building in parallel) — every test below injects this fake via the
// `deps` override so results never depend on whether/when that file lands.
const FAKE_TEMPLATE = {
  id: 'fake',
  version: 3,
  label: 'Fake',
  defaults: {
    paletteId: 'a',
    background: { color: '#ffffff' },
    params: { density: 0.5, scale: 1 },
  },
  schema: {
    params: {
      density: { min: 0, max: 1, step: 0.1, default: 0.5 },
      scale: { min: 0.5, max: 2, step: 0.1, default: 1 },
    },
  },
  palettes: [
    { id: 'a', label: 'A', colors: ['#000'] },
    { id: 'b', label: 'B', colors: ['#fff'] },
  ],
  render() {},
};

const deps = {
  getTemplate: (id) => (id === FAKE_TEMPLATE.id ? FAKE_TEMPLATE : undefined),
  listTemplates: () => [FAKE_TEMPLATE],
};

// ── createRecipe ────────────────────────────────────────────────────────

test('createRecipe: resolves the template, merges overrides onto defaults, and normalizes', () => {
  const recipe = createRecipe('fake', { params: { density: 0.9 } }, deps);
  assert.equal(recipe.templateId, 'fake');
  assert.equal(recipe.templateVersion, 3);
  assert.equal(recipe.schemaVersion, 3);
  assert.equal(recipe.params.density, 0.9);
  assert.equal(recipe.params.scale, 1); // untouched default preserved
  assert.equal(recipe.paletteId, 'a');
  assert.equal(recipe.background.color, '#ffffff');
  assert.equal(recipe.output.formatId, 'desktop');
  assert.equal(recipe.output.width, 2560);
  assert.equal(recipe.output.height, 1440);
});

test('createRecipe: throws a clear error for an unresolved templateId', () => {
  assert.throws(() => createRecipe('does-not-exist', {}, deps), /templateId/i);
});

test('createRecipe: an explicit output.formatId override is honored', () => {
  const recipe = createRecipe('fake', { output: { formatId: 'square' } }, deps);
  assert.equal(recipe.output.formatId, 'square');
  assert.equal(recipe.output.width, 2048);
  assert.equal(recipe.output.height, 2048);
});

test('createRecipe: does not mutate the template defaults object', () => {
  const before = JSON.stringify(FAKE_TEMPLATE.defaults);
  createRecipe('fake', { params: { density: 0.9 }, paletteId: 'b' }, deps);
  assert.equal(JSON.stringify(FAKE_TEMPLATE.defaults), before);
});

// ── normalizeRecipe: param clamping ─────────────────────────────────────

test('normalizeRecipe: clamps out-of-range params to the template schema bounds', () => {
  const out = normalizeRecipe({
    templateId: 'fake',
    params: { density: 99, scale: -5 },
  }, deps);
  assert.equal(out.params.density, 1); // clamped to max
  assert.equal(out.params.scale, 0.5); // clamped to min
});

test('normalizeRecipe: drops incoming param keys not present in the template schema', () => {
  const out = normalizeRecipe({
    templateId: 'fake',
    params: { density: 0.5, scale: 1, bogusKey: 12345 },
  }, deps);
  assert.deepEqual(Object.keys(out.params).sort(), ['density', 'scale']);
});

test('normalizeRecipe: a missing/non-finite param falls back to its own schema default', () => {
  const out1 = normalizeRecipe({ templateId: 'fake', params: {} }, deps);
  assert.equal(out1.params.density, 0.5);
  assert.equal(out1.params.scale, 1);

  const out2 = normalizeRecipe({ templateId: 'fake', params: { density: 'nope', scale: NaN } }, deps);
  assert.equal(out2.params.density, 0.5);
  assert.equal(out2.params.scale, 1);
});

test('normalizeRecipe: snaps clamped values to the schema step', () => {
  const out = normalizeRecipe({ templateId: 'fake', params: { density: 0.4133333 } }, deps);
  assert.equal(out.params.density, 0.4);
});

// ── normalizeRecipe: palette / background fallback ──────────────────────

test("normalizeRecipe: an unknown paletteId falls back to the template's first palette", () => {
  const out = normalizeRecipe({ templateId: 'fake', paletteId: 'not-real' }, deps);
  assert.equal(out.paletteId, 'a');
});

test('normalizeRecipe: a known paletteId is preserved', () => {
  const out = normalizeRecipe({ templateId: 'fake', paletteId: 'b' }, deps);
  assert.equal(out.paletteId, 'b');
});

test('normalizeRecipe: an invalid/missing background.color falls back to the template default', () => {
  const out1 = normalizeRecipe({ templateId: 'fake', background: { color: 'not-a-hex' } }, deps);
  assert.equal(out1.background.color, '#ffffff');

  const out2 = normalizeRecipe({ templateId: 'fake', background: {} }, deps);
  assert.equal(out2.background.color, '#ffffff');

  const out3 = normalizeRecipe({ templateId: 'fake' }, deps);
  assert.equal(out3.background.color, '#ffffff');
});

test('normalizeRecipe: a valid #rgb or #rrggbb background.color is preserved', () => {
  assert.equal(normalizeRecipe({ templateId: 'fake', background: { color: '#abc' } }, deps).background.color, '#abc');
  assert.equal(normalizeRecipe({ templateId: 'fake', background: { color: '#123456' } }, deps).background.color, '#123456');
});

// ── normalizeRecipe: output is always recomputed ────────────────────────

test('normalizeRecipe: output.width/height are always recomputed from formatId, never trusted from input', () => {
  const out = normalizeRecipe({
    templateId: 'fake',
    output: { formatId: 'mobile', width: 99999, height: 1 },
  }, deps);
  assert.equal(out.output.formatId, 'mobile');
  assert.equal(out.output.width, 1170);
  assert.equal(out.output.height, 2532);
});

test('normalizeRecipe: an unknown/missing output.formatId falls back to the default format', () => {
  const out = normalizeRecipe({ templateId: 'fake', output: { formatId: 'not-a-format' } }, deps);
  assert.equal(out.output.formatId, 'desktop');
  assert.equal(out.output.width, 2560);
  assert.equal(out.output.height, 1440);
});

// ── normalizeRecipe: template resolution / version stamping ─────────────

test('normalizeRecipe: templateVersion always reflects the live template version, not a stale input value', () => {
  const out = normalizeRecipe({ templateId: 'fake', templateVersion: 999 }, deps);
  assert.equal(out.templateVersion, 3);
});

test('normalizeRecipe: an unresolved templateId falls back to the first template from listTemplates()', () => {
  const out = normalizeRecipe({ templateId: 'ghost-template' }, deps);
  assert.equal(out.templateId, 'fake');
  assert.equal(out.templateVersion, 3);
});

// ── normalizeRecipe: seed coercion ──────────────────────────────────────

test('normalizeRecipe: seed is coerced to a non-negative integer, falling back to 1 when missing/invalid', () => {
  assert.equal(normalizeRecipe({ templateId: 'fake', seed: 42.9 }, deps).seed, 42);
  assert.equal(normalizeRecipe({ templateId: 'fake', seed: -5 }, deps).seed, 1);
  assert.equal(normalizeRecipe({ templateId: 'fake', seed: 'nope' }, deps).seed, 1);
  assert.equal(normalizeRecipe({ templateId: 'fake' }, deps).seed, 1);
  assert.equal(normalizeRecipe({ templateId: 'fake', seed: 0 }, deps).seed, 0);
});

// ── migrateRecipe ────────────────────────────────────────────────────────

test('migrateRecipe: a missing schemaVersion migrates to the current schema and is fully normalized', () => {
  const out = migrateRecipe({ templateId: 'fake', params: { density: 50 } }, deps);
  assert.equal(out.schemaVersion, 3);
  assert.equal(out.params.density, 1); // clamped to schema max
});

test('migrateRecipe: an invalid schemaVersion also migrates rather than throwing', () => {
  const out = migrateRecipe({ templateId: 'fake', schemaVersion: 'not-a-number' }, deps);
  assert.equal(out.schemaVersion, 3);
});

test('migrateRecipe: V1 saved wallpapers remain title-free until the designer enables typography', () => {
  const out = migrateRecipe({ templateId: 'fake', schemaVersion: 1 }, deps);
  assert.equal(out.text.enabled, false);
});

test('normalizeRecipe: adds bounded book typography defaults and preserves valid edits', () => {
  const defaults = normalizeRecipe({ templateId: 'fake' }, deps);
  assert.equal(defaults.text.enabled, true);
  assert.equal(defaults.text.layout, 'chapter');
  const out = normalizeRecipe({
    templateId: 'fake',
    text: { enabled: true, headline: '  The   Good  Chapter ', subhead: 'A subtitle', layout: 'cover', spacer: 'rules', color: '#c01256' },
  }, deps);
  assert.deepEqual(out.text, { enabled: true, headline: 'The Good Chapter', subhead: 'A subtitle', layout: 'cover', spacer: 'rules', color: '#c01256', headlineScale: 1, subheadScale: 1, backdrop: { enabled: true, intensity: 0.9, blur: 0.72, size: 0.9, falloff: 0.62 } });
});

// ── buildProvenance ──────────────────────────────────────────────────────

test('buildProvenance: returns the exact documented shape', () => {
  const recipe = createRecipe('fake', {}, deps);
  const provenance = buildProvenance(recipe, {
    rendererRevision: 'rev-123',
    createdAt: '2026-08-24T00:00:00.000Z',
  });
  assert.deepEqual(Object.keys(provenance).sort(), [
    'background',
    'createdAt',
    'output',
    'paletteId',
    'params',
    'rendererRevision',
    'schemaVersion',
    'seed',
    'templateId',
    'templateVersion',
    'text',
    'tool',
  ].sort());
  assert.equal(provenance.schemaVersion, recipe.schemaVersion);
  assert.equal(provenance.templateId, recipe.templateId);
  assert.equal(provenance.templateVersion, recipe.templateVersion);
  assert.equal(provenance.seed, recipe.seed);
  assert.equal(provenance.paletteId, recipe.paletteId);
  assert.deepEqual(provenance.params, recipe.params);
  assert.deepEqual(provenance.background, recipe.background);
  assert.deepEqual(provenance.output, recipe.output);
  assert.equal(provenance.rendererRevision, 'rev-123');
  assert.equal(provenance.createdAt, '2026-08-24T00:00:00.000Z');
  assert.equal(provenance.tool, 'paint-studio');
});

test('buildProvenance: is pure — never calls Date.now()/new Date() itself', () => {
  const originalNow = Date.now;
  let called = false;
  Date.now = (...args) => {
    called = true;
    return originalNow(...args);
  };
  try {
    const recipe = createRecipe('fake', {}, deps);
    buildProvenance(recipe, { rendererRevision: 'r1', createdAt: 'fixed-timestamp' });
  } finally {
    Date.now = originalNow;
  }
  assert.equal(called, false, 'buildProvenance must not read the clock');
});
