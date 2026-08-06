import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_SCHEMA_VERSION,
  addTemplate, findTemplate, renameTemplate, updateTemplateRecipe,
  duplicateTemplate, archiveTemplate, unarchiveTemplate,
  listActiveTemplates, listArchivedTemplates, exportTemplateJSON,
  parseTemplateListJSON,
} from '../templates.js';
import {
  ELEMENT_PRESETS_KEY, MAX_ELEMENT_PRESETS,
  nextElementPresetId, createElementPreset, isValidElementPreset, sanitizeElementPresetRecipe,
  LOOK_PRESETS_KEY, MAX_LOOK_PRESETS,
  nextLookPresetId, createLookPreset, isValidLookPreset, sanitizeLookPresetRecipe,
  RENDER_PRESETS_KEY, MAX_RENDER_PRESETS,
  nextRenderPresetId, createRenderPreset, isValidRenderPreset, sanitizeRenderPresetRecipe,
  importPresetJSON, parsePresetListJSON,
} from '../preset-kinds.js';

const NOW = 1700000000000;

// One config per kind — drives a parameterized suite below so the three
// parallel kinds get IDENTICAL coverage without three copy-pasted files.
const KINDS = [
  {
    kind: 'element', label: 'Element Preset', prefix: 'element',
    key: ELEMENT_PRESETS_KEY, max: MAX_ELEMENT_PRESETS,
    nextId: nextElementPresetId, create: createElementPreset, isValid: isValidElementPreset,
    defaultName: 'Untitled Element Preset',
    sampleRecipe: { type: 'kinetic-rings', values: { material: { color: '#d8dce2' }, motion: { speed: 0.4 } } },
  },
  {
    kind: 'look', label: 'Look Preset', prefix: 'look',
    key: LOOK_PRESETS_KEY, max: MAX_LOOK_PRESETS,
    nextId: nextLookPresetId, create: createLookPreset, isValid: isValidLookPreset,
    defaultName: 'Untitled Look Preset',
    sampleRecipe: { envId: 'room', bgColor: '#000000' },
  },
  {
    kind: 'render', label: 'Render Preset', prefix: 'render',
    key: RENDER_PRESETS_KEY, max: MAX_RENDER_PRESETS,
    nextId: nextRenderPresetId, create: createRenderPreset, isValid: isValidRenderPreset,
    defaultName: 'Untitled Render Preset',
    sampleRecipe: { videoSeconds: 5, videoFormat: 'mp4' },
  },
];

function validPreset(cfg, overrides = {}) {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION, id: `${cfg.prefix}-1`, scope: 'local', kind: cfg.kind,
    name: `Test ${cfg.label}`, recipe: cfg.sampleRecipe, archived: false, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PRESETS_KEY / MAX constants — sanity, distinct per kind.
// ─────────────────────────────────────────────────────────────────────────

test('each kind has its own distinct localStorage key and a MAX cap matching MAX_TEMPLATES (40)', () => {
  const keys = new Set(KINDS.map((cfg) => cfg.key));
  assert.equal(keys.size, KINDS.length, 'keys must be distinct across kinds');
  KINDS.forEach((cfg) => {
    assert.ok(cfg.key.includes(cfg.kind));
    assert.equal(cfg.max, 40);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Parameterized per-kind suite: next-id scan, create/add/find/rename/
// duplicate/archive/unarchive/export/import round-trip.
// ─────────────────────────────────────────────────────────────────────────

KINDS.forEach((cfg) => {
  test(`${cfg.kind}: nextPresetId scans existing ids for the next free N, prefix "${cfg.prefix}-", never Math.random()`, () => {
    assert.equal(cfg.nextId([]), `${cfg.prefix}-1`);
    assert.equal(cfg.nextId([`${cfg.prefix}-1`, `${cfg.prefix}-2`]), `${cfg.prefix}-3`);
    assert.equal(cfg.nextId([`${cfg.prefix}-5`, `${cfg.prefix}-2`]), `${cfg.prefix}-6`);
    assert.equal(cfg.nextId([`${cfg.prefix}-abc`, 'not-an-id']), `${cfg.prefix}-1`, 'non-matching ids should not influence the scan');
  });

  test(`${cfg.kind}: create${cfg.label.replace(/ /g, '').replace('Preset', 'Preset')} builds a valid preset, derives a collision-safe id, clamps a blank name to the kind default`, () => {
    const list = [validPreset(cfg, { id: `${cfg.prefix}-1` })];
    const t = cfg.create(list, { name: '  ', recipe: cfg.sampleRecipe, now: NOW });
    assert.equal(t.id, `${cfg.prefix}-2`);
    assert.equal(t.name, cfg.defaultName);
    assert.equal(t.scope, 'local');
    assert.equal(t.kind, cfg.kind);
    assert.equal(t.archived, false);
    assert.ok(cfg.isValid(t));
  });

  test(`${cfg.kind}: create — a non-object recipe falls back to an empty object rather than storing garbage`, () => {
    const t = cfg.create([], { name: 'X', recipe: 'not an object', now: NOW });
    assert.deepEqual(t.recipe, {});
  });

  test(`${cfg.kind}: isValid rejects every required-field violation independently`, () => {
    const base = validPreset(cfg);
    assert.ok(cfg.isValid(base));
    assert.equal(cfg.isValid({ ...base, schemaVersion: 2 }), false);
    assert.equal(cfg.isValid({ ...base, id: '' }), false);
    assert.equal(cfg.isValid({ ...base, id: 123 }), false);
    assert.equal(cfg.isValid({ ...base, scope: 'global' }), false);
    assert.equal(cfg.isValid({ ...base, name: '' }), false);
    assert.equal(cfg.isValid({ ...base, recipe: null }), false);
    assert.equal(cfg.isValid({ ...base, recipe: 'not an object' }), false);
    assert.equal(cfg.isValid({ ...base, createdAt: 'yesterday' }), false);
    assert.equal(cfg.isValid(null), false);
    assert.equal(cfg.isValid(undefined), false);
  });

  test(`${cfg.kind}: addTemplate appends, truncating the OLDEST entries once over MAX_TEMPLATES (shared cap, reused as-is from templates.js)`, () => {
    let list = [];
    for (let i = 0; i < cfg.max + 5; i += 1) {
      list = addTemplate(list, cfg.create(list, { name: `T${i}`, recipe: cfg.sampleRecipe, now: NOW + i }));
    }
    assert.equal(list.length, cfg.max);
    assert.equal(list[0].name, 'T5', 'the oldest 5 entries should have been dropped, oldest-first');
    assert.equal(list[list.length - 1].name, `T${cfg.max + 4}`);
  });

  test(`${cfg.kind}: findTemplate returns the matching preset or null (generic, reused as-is)`, () => {
    const list = [validPreset(cfg, { id: `${cfg.prefix}-1` }), validPreset(cfg, { id: `${cfg.prefix}-2` })];
    assert.equal(findTemplate(list, `${cfg.prefix}-2`).id, `${cfg.prefix}-2`);
    assert.equal(findTemplate(list, `${cfg.prefix}-missing`), null);
  });

  test(`${cfg.kind}: renameTemplate updates only the target's name and updatedAt, leaves others untouched (generic, reused as-is)`, () => {
    const list = [validPreset(cfg, { id: `${cfg.prefix}-1`, name: 'A' }), validPreset(cfg, { id: `${cfg.prefix}-2`, name: 'B' })];
    const renamed = renameTemplate(list, `${cfg.prefix}-1`, 'New Name', NOW + 1000);
    assert.equal(renamed[0].name, 'New Name');
    assert.equal(renamed[0].updatedAt, NOW + 1000);
    assert.deepEqual(renamed[1], list[1]);
  });

  test(`${cfg.kind}: updateTemplateRecipe overwrites an existing preset's recipe, not a new one (generic, reused as-is)`, () => {
    const list = [validPreset(cfg, { id: `${cfg.prefix}-1` })];
    const updated = updateTemplateRecipe(list, `${cfg.prefix}-1`, { patched: true }, NOW + 1);
    assert.equal(updated.length, 1);
    assert.deepEqual(updated[0].recipe, { patched: true });
  });

  test(`${cfg.kind}: duplicateTemplate creates a fresh-id " copy" appended without mutating the source (generic, reused as-is)`, () => {
    const list = [validPreset(cfg, { id: `${cfg.prefix}-1`, name: 'Original' })];
    const next = duplicateTemplate(list, `${cfg.prefix}-1`, NOW + 1);
    assert.equal(next.length, 2);
    assert.equal(next[1].name, 'Original copy');
    assert.notEqual(next[1].id, `${cfg.prefix}-1`);
    assert.deepEqual(next[0], list[0]);
  });

  test(`${cfg.kind}: archiveTemplate / unarchiveTemplate / listActiveTemplates / listArchivedTemplates — soft-delete only (generic, reused as-is)`, () => {
    const list = [validPreset(cfg, { id: `${cfg.prefix}-1` }), validPreset(cfg, { id: `${cfg.prefix}-2` })];
    const archived = archiveTemplate(list, `${cfg.prefix}-1`, NOW + 1);
    assert.equal(archived.length, 2, 'archiving must never remove the entry from the list');
    assert.equal(archived[0].archived, true);
    assert.deepEqual(listActiveTemplates(archived).map((t) => t.id), [`${cfg.prefix}-2`]);
    assert.deepEqual(listArchivedTemplates(archived).map((t) => t.id), [`${cfg.prefix}-1`]);
    const restored = unarchiveTemplate(archived, `${cfg.prefix}-1`, NOW + 2);
    assert.equal(restored[0].archived, false);
  });

  test(`${cfg.kind}: exportTemplateJSON / importPresetJSON round-trips a preset, assigning a FRESH id and resetting archived/timestamps`, () => {
    const source = cfg.create([], { name: 'Exported', recipe: cfg.sampleRecipe, now: NOW });
    const localList = addTemplate([], source);
    const archivedSource = { ...source, archived: true };
    const json = exportTemplateJSON(archivedSource);
    const { list, error } = importPresetJSON(localList, json, NOW + 5000, { kind: cfg.kind, createFn: cfg.create });
    assert.equal(error, null);
    assert.equal(list.length, 2);
    const imported = list[1];
    assert.notEqual(imported.id, source.id, 'import must never trust/reuse the exported id');
    assert.equal(imported.archived, false, 'an imported preset must always start active');
    assert.equal(imported.createdAt, NOW + 5000);
    assert.deepEqual(imported.recipe, cfg.sampleRecipe);
  });

  test(`${cfg.kind}: importPresetJSON rejects invalid JSON without mutating the list`, () => {
    const list = [validPreset(cfg, { id: `${cfg.prefix}-1` })];
    const result = importPresetJSON(list, 'not json at all', NOW, { kind: cfg.kind, createFn: cfg.create });
    assert.equal(result.list, list);
    assert.ok(result.error);
  });

  test(`${cfg.kind}: importPresetJSON rejects an unrecognized schema version`, () => {
    const result = importPresetJSON([], JSON.stringify({ schemaVersion: 99, kind: cfg.kind, recipe: {} }), NOW, { kind: cfg.kind, createFn: cfg.create });
    assert.ok(result.error);
  });

  test(`${cfg.kind}: importPresetJSON rejects a well-formed object of a DIFFERENT kind, with a "Not a valid ${cfg.label}." style error`, () => {
    const otherKind = KINDS.find((k) => k.kind !== cfg.kind).kind;
    const wrongKind = JSON.stringify({ schemaVersion: TEMPLATE_SCHEMA_VERSION, id: 'x', scope: 'local', kind: otherKind, name: 'Wrong Kind', recipe: {}, createdAt: NOW, updatedAt: NOW });
    const result = importPresetJSON([], wrongKind, NOW, { kind: cfg.kind, createFn: cfg.create });
    assert.equal(result.list.length, 0);
    assert.ok(result.error);
    assert.ok(result.error.includes(cfg.label), `error should name the expected kind: ${result.error}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isValid<Kind>Preset kind-discriminator — an Element Preset object must
// NOT validate as a Look Preset (or Render Preset) and vice versa, for
// every pairing.
// ─────────────────────────────────────────────────────────────────────────

test('isValid<Kind>Preset: a preset object only validates against its OWN kind, never a sibling kind', () => {
  KINDS.forEach((cfg) => {
    const own = validPreset(cfg);
    assert.ok(cfg.isValid(own), `${cfg.kind} preset must validate against its own isValid fn`);
    KINDS.filter((other) => other.kind !== cfg.kind).forEach((other) => {
      assert.equal(other.isValid(own), false, `a ${cfg.kind} preset must NOT validate as a ${other.kind} preset`);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sanitizeElementPresetRecipe
// ─────────────────────────────────────────────────────────────────────────

const FALLBACK_ELEMENT_RECIPE = {
  type: 'kinetic-rings',
  values: { material: { color: '#d8dce2', metalness: 1 }, motion: { speed: 0.4 }, appearance: { count: 3 } },
};

test('sanitizeElementPresetRecipe: a well-formed recipe passes through with type + all three value groups kept', () => {
  const raw = { type: 'orb-constellation', values: { material: { color: '#fff' }, motion: { speed: 1 }, appearance: { count: 5 } } };
  const out = sanitizeElementPresetRecipe(raw, FALLBACK_ELEMENT_RECIPE);
  assert.deepEqual(out, raw);
});

test('sanitizeElementPresetRecipe: non-string type falls back to the fallback type; a non-object values.<group> falls back to the fallback group individually', () => {
  const raw = { type: 123, values: { material: 'not an object', motion: { speed: 0.9 } } };
  const out = sanitizeElementPresetRecipe(raw, FALLBACK_ELEMENT_RECIPE);
  assert.equal(out.type, FALLBACK_ELEMENT_RECIPE.type);
  assert.deepEqual(out.values.material, FALLBACK_ELEMENT_RECIPE.values.material, 'invalid material falls back to the current value');
  assert.deepEqual(out.values.motion, { speed: 0.9 }, 'the one valid group in the same object still applies');
  assert.deepEqual(out.values.appearance, FALLBACK_ELEMENT_RECIPE.values.appearance);
});

test('sanitizeElementPresetRecipe: missing values entirely falls back to the fallback\'s groups', () => {
  const out = sanitizeElementPresetRecipe({ type: 'chrome-ribbon' }, FALLBACK_ELEMENT_RECIPE);
  assert.equal(out.type, 'chrome-ribbon');
  assert.deepEqual(out.values, FALLBACK_ELEMENT_RECIPE.values);
});

test('sanitizeElementPresetRecipe: null/non-object raw falls back to the fallback recipe entirely, never throws', () => {
  assert.deepEqual(sanitizeElementPresetRecipe(null, FALLBACK_ELEMENT_RECIPE), FALLBACK_ELEMENT_RECIPE);
  assert.deepEqual(sanitizeElementPresetRecipe('garbage', FALLBACK_ELEMENT_RECIPE), FALLBACK_ELEMENT_RECIPE);
  assert.deepEqual(sanitizeElementPresetRecipe(undefined, FALLBACK_ELEMENT_RECIPE), FALLBACK_ELEMENT_RECIPE);
});

test('sanitizeElementPresetRecipe: a malformed fallback never throws — degrades to an empty type/values shape', () => {
  assert.deepEqual(sanitizeElementPresetRecipe(null, null), { type: '', values: {} });
  assert.deepEqual(sanitizeElementPresetRecipe(null, 'garbage'), { type: '', values: {} });
});

// ─────────────────────────────────────────────────────────────────────────
// sanitizeLookPresetRecipe
// ─────────────────────────────────────────────────────────────────────────

const FALLBACK_LOOK_RECIPE = {
  fx: { bloom: true, bloomStrength: 0.55, treatment: 'halftone', colA: '#101014' },
  fxPresetId: 'noir',
  mat: { finish: 'glossy', baseColor: '#101114', roughness: 0.12 },
  envId: 'room', envIntensity: 1.7,
  bgMode: 'color', bgColor: '#f2efe6', sceneId: '',
  lightCans: [
    { on: true, color: '#ffffff', intensity: 1.6, az: 35, el: 40 },
    { on: true, color: '#88ffee', intensity: 0.6, az: -140, el: 15 },
    { on: false, color: '#ffffff', intensity: 1, az: -35, el: 20 },
    { on: false, color: '#ffffff', intensity: 1, az: 180, el: 60 },
  ],
  lightTemplate: 'studio', lookSeed: 3,
  shotCam: { use: true, az: 24, el: 12, dist: 3.2, fov: 40 },
  diffusionCamera: {
    enabled: true, locked: false, focalTarget: 'origin',
    focusDistance: 2.2, aperture: 0.4, falloff: 0.5, diffusionRadius: 0.3,
    highlightBloom: 0.2, foregroundBias: 0, backgroundBias: 0,
  },
  camSeed: 2,
};

test('sanitizeLookPresetRecipe: a well-formed recipe passes every field through unchanged', () => {
  const out = sanitizeLookPresetRecipe(FALLBACK_LOOK_RECIPE, FALLBACK_LOOK_RECIPE);
  assert.deepEqual(out, FALLBACK_LOOK_RECIPE);
});

test('sanitizeLookPresetRecipe: envIntensity/bgColor/lookSeed/camSeed validated independently, invalid members fall back to current', () => {
  const raw = { envIntensity: 'bright', bgColor: 'not-hex', lookSeed: 9, camSeed: 'nope' };
  const out = sanitizeLookPresetRecipe(raw, FALLBACK_LOOK_RECIPE);
  assert.equal(out.envIntensity, FALLBACK_LOOK_RECIPE.envIntensity);
  assert.equal(out.bgColor, FALLBACK_LOOK_RECIPE.bgColor);
  assert.equal(out.lookSeed, 9);
  assert.equal(out.camSeed, FALLBACK_LOOK_RECIPE.camSeed);
});

test('sanitizeLookPresetRecipe: envId/bgMode/sceneId/lightTemplate/fxPresetId are generic non-empty strings (no enum list available), non-string/blank falls back', () => {
  const raw = { envId: 'sunset', bgMode: 123, sceneId: 'thriller', lightTemplate: '', fxPresetId: 'golden-hour' };
  const out = sanitizeLookPresetRecipe(raw, FALLBACK_LOOK_RECIPE);
  assert.equal(out.envId, 'sunset');
  assert.equal(out.bgMode, FALLBACK_LOOK_RECIPE.bgMode, 'non-string bgMode falls back');
  assert.equal(out.sceneId, 'thriller');
  assert.equal(out.lightTemplate, FALLBACK_LOOK_RECIPE.lightTemplate, 'blank string falls back');
  assert.equal(out.fxPresetId, 'golden-hour');
});

test('sanitizeLookPresetRecipe: fx/mat are shallow-typed — booleans/numbers/hex-strings validated by inferred type from the fallback shape, invalid members dropped individually, unknown keys ignored', () => {
  const raw = {
    fx: { bloom: 'yes', bloomStrength: 0.9, treatment: 'riso-duotone', colA: 'not-hex', unknownKey: 'ignored' },
    mat: { finish: 'matte', baseColor: 'garbage', roughness: 0.5 },
  };
  const out = sanitizeLookPresetRecipe(raw, FALLBACK_LOOK_RECIPE);
  assert.equal(out.fx.bloom, FALLBACK_LOOK_RECIPE.fx.bloom, 'non-boolean bloom falls back');
  assert.equal(out.fx.bloomStrength, 0.9);
  assert.equal(out.fx.treatment, 'riso-duotone', 'treatment is a generic string field, not enum-checked here');
  assert.equal(out.fx.colA, FALLBACK_LOOK_RECIPE.fx.colA, 'invalid hex falls back');
  assert.equal(out.fx.unknownKey, undefined, 'keys not present on the fallback shape are never adopted');
  assert.equal(out.mat.finish, 'matte');
  assert.equal(out.mat.baseColor, FALLBACK_LOOK_RECIPE.mat.baseColor, 'invalid hex falls back');
  assert.equal(out.mat.roughness, 0.5);
});

test('sanitizeLookPresetRecipe: lightCans reuses scene-recipe.js\'s sanitizeLightCans — the [null,null,null,null] crash reproduction resolves to well-formed cans', () => {
  const out = sanitizeLookPresetRecipe({ lightCans: [null, null, null, null] }, FALLBACK_LOOK_RECIPE);
  assert.equal(out.lightCans.length, 4);
  out.lightCans.forEach((c) => assert.equal(typeof c.on, 'boolean'));
});

test('sanitizeLookPresetRecipe: shotCam/diffusionCamera reuse scene-recipe.js\'s own sanitizers unchanged', () => {
  const out = sanitizeLookPresetRecipe({ shotCam: { use: true, fov: 'wide' }, diffusionCamera: { locked: 'yes' } }, FALLBACK_LOOK_RECIPE);
  assert.equal(out.shotCam.use, true);
  assert.equal(out.shotCam.fov, FALLBACK_LOOK_RECIPE.shotCam.fov, 'invalid numeric field falls back');
  assert.equal(out.diffusionCamera.locked, FALLBACK_LOOK_RECIPE.diffusionCamera.locked, 'non-boolean locked must fall back, never be treated as truthy');
});

test('sanitizeLookPresetRecipe: null/non-object raw falls back to the fallback recipe entirely, never throws', () => {
  assert.deepEqual(sanitizeLookPresetRecipe(null, FALLBACK_LOOK_RECIPE), FALLBACK_LOOK_RECIPE);
  assert.deepEqual(sanitizeLookPresetRecipe('garbage', FALLBACK_LOOK_RECIPE), FALLBACK_LOOK_RECIPE);
});

test('sanitizeLookPresetRecipe: a missing/malformed fallback never throws — degrades to safe defaults', () => {
  const out = sanitizeLookPresetRecipe(null, null);
  assert.equal(out.envId, 'room');
  assert.equal(out.bgMode, 'color');
  assert.equal(out.bgColor, '#000000');
  assert.equal(out.lightTemplate, 'studio');
  assert.equal(out.lookSeed, 1);
  assert.equal(out.camSeed, 1);
  assert.equal(out.lightCans.length, 4);
  assert.equal(typeof out.shotCam, 'object');
  assert.equal(typeof out.diffusionCamera, 'object');
});

// ─────────────────────────────────────────────────────────────────────────
// sanitizeRenderPresetRecipe
// ─────────────────────────────────────────────────────────────────────────

const FALLBACK_RENDER_RECIPE = {
  videoSeconds: 8, videoFormat: 'mp4', frameId: 'off',
  clothAspect: 'auto', artworkRatio: null, elementQualityTier: 'draft',
};

test('sanitizeRenderPresetRecipe: a well-formed recipe passes every field through unchanged', () => {
  const raw = { videoSeconds: 12, videoFormat: 'webm', frameId: 'gold-leaf', clothAspect: 'portrait', artworkRatio: 0.75, elementQualityTier: 'final' };
  assert.deepEqual(sanitizeRenderPresetRecipe(raw, FALLBACK_RENDER_RECIPE), raw);
});

test('sanitizeRenderPresetRecipe: invalid videoSeconds/videoFormat/frameId/clothAspect/elementQualityTier fall back individually', () => {
  const raw = { videoSeconds: 'long', videoFormat: 123, frameId: '', clothAspect: 456, elementQualityTier: '' };
  const out = sanitizeRenderPresetRecipe(raw, FALLBACK_RENDER_RECIPE);
  assert.equal(out.videoSeconds, FALLBACK_RENDER_RECIPE.videoSeconds);
  assert.equal(out.videoFormat, FALLBACK_RENDER_RECIPE.videoFormat);
  assert.equal(out.frameId, FALLBACK_RENDER_RECIPE.frameId);
  assert.equal(out.clothAspect, FALLBACK_RENDER_RECIPE.clothAspect);
  assert.equal(out.elementQualityTier, FALLBACK_RENDER_RECIPE.elementQualityTier);
});

test('sanitizeRenderPresetRecipe: artworkRatio accepts a finite number OR null (a real, meaningful value), rejects anything else', () => {
  assert.equal(sanitizeRenderPresetRecipe({ artworkRatio: 0.5 }, FALLBACK_RENDER_RECIPE).artworkRatio, 0.5);
  assert.equal(sanitizeRenderPresetRecipe({ artworkRatio: null }, { ...FALLBACK_RENDER_RECIPE, artworkRatio: 0.5 }).artworkRatio, null, 'null is a legitimate value (aspect-fit passthrough), not itself invalid');
  assert.equal(sanitizeRenderPresetRecipe({ artworkRatio: 'wide' }, FALLBACK_RENDER_RECIPE).artworkRatio, FALLBACK_RENDER_RECIPE.artworkRatio, 'a non-numeric, non-null value falls back to the current one');
  assert.equal(sanitizeRenderPresetRecipe({ artworkRatio: NaN }, FALLBACK_RENDER_RECIPE).artworkRatio, FALLBACK_RENDER_RECIPE.artworkRatio);
});

test('sanitizeRenderPresetRecipe: null/non-object raw falls back to the fallback recipe entirely, never throws', () => {
  assert.deepEqual(sanitizeRenderPresetRecipe(null, FALLBACK_RENDER_RECIPE), FALLBACK_RENDER_RECIPE);
  assert.deepEqual(sanitizeRenderPresetRecipe('garbage', FALLBACK_RENDER_RECIPE), FALLBACK_RENDER_RECIPE);
});

test('sanitizeRenderPresetRecipe: a missing/malformed fallback never throws — degrades to safe defaults', () => {
  const out = sanitizeRenderPresetRecipe(null, null);
  assert.equal(out.videoSeconds, 5);
  assert.equal(out.videoFormat, 'mp4');
  assert.equal(out.frameId, 'off');
  assert.equal(out.clothAspect, 'auto');
  assert.equal(out.artworkRatio, null);
  assert.equal(out.elementQualityTier, 'draft');
});

// ── parsePresetListJSON — the kind-aware fix for templates.js's own
// parseTemplateListJSON hardcoding kind==='scene' internally (would
// otherwise silently return an empty list for every element/look/render
// preset list read back from localStorage). ──

KINDS.forEach(({ kind, label, create, isValid, sampleRecipe }) => {
  test(`parsePresetListJSON (${label}): round-trips a real list through JSON exactly as isValid<Kind>Preset accepts it`, () => {
    const t1 = create([], { name: 'A', recipe: sampleRecipe, now: NOW });
    const t2 = create([t1], { name: 'B', recipe: sampleRecipe, now: NOW });
    const json = JSON.stringify([t1, t2]);
    const parsed = parsePresetListJSON(json, { isValidFn: isValid });
    assert.deepEqual(parsed, [t1, t2]);
  });

  test(`parsePresetListJSON (${label}): a foreign-kind entry in the same list is dropped, not the whole list`, () => {
    const own = create([], { name: 'Mine', recipe: sampleRecipe, now: NOW });
    const foreign = { ...own, id: 'other-1', kind: kind === 'element' ? 'look' : 'element' };
    const parsed = parsePresetListJSON(JSON.stringify([own, foreign]), { isValidFn: isValid });
    assert.deepEqual(parsed, [own]);
  });
});

test('parsePresetListJSON: malformed JSON, non-array JSON, or missing input all return an empty list — never throws', () => {
  assert.deepEqual(parsePresetListJSON('not json', { isValidFn: isValidElementPreset }), []);
  assert.deepEqual(parsePresetListJSON('{"not":"an array"}', { isValidFn: isValidElementPreset }), []);
  assert.deepEqual(parsePresetListJSON(undefined, { isValidFn: isValidElementPreset }), []);
});

test('parsePresetListJSON: THE exact regression this function fixes — templates.js\'s own parseTemplateListJSON would silently empty this same list', () => {
  const preset = createElementPreset([], { name: 'Regression check', recipe: { type: 'kinetic-rings', values: {} }, now: NOW });
  const json = JSON.stringify([preset]);
  assert.deepEqual(parsePresetListJSON(json, { isValidFn: isValidElementPreset }), [preset], 'the kind-aware parser keeps it');
  assert.deepEqual(parseTemplateListJSON(json), [], 'the Scene-Template-only parser (kind===\'scene\' hardcoded) drops it — this is the exact gap parsePresetListJSON exists to close');
});
