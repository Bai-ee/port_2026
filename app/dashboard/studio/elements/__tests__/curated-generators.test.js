import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURATED_GENERATORS,
  generateCuratedSet,
  resolveCuratedDiffusionCamera,
} from '../curated-generators.js';
import { getElementDefinition } from '../catalog.js';
import { defaultTransformForFormat } from '../placement.js';

// ── CURATED_GENERATORS catalog shape ────────────────────────────────────────

test('CURATED_GENERATORS: exactly 12 entries with unique ids', () => {
  assert.equal(CURATED_GENERATORS.length, 12);
  const ids = new Set(CURATED_GENERATORS.map((g) => g.id));
  assert.equal(ids.size, 12);
});

// ── generateCuratedSet: per-generator coverage ──────────────────────────────

for (const generator of CURATED_GENERATORS) {
  test(`generateCuratedSet('${generator.id}'): returns extraInstances within [minCount, maxCount], types only from its own list, no duplicate type`, () => {
    const result = generateCuratedSet(generator.id, { seed: 1, formatId: 'landscape' });
    assert.ok(Array.isArray(result.extraInstances));
    assert.ok(result.extraInstances.length > 0);
    assert.ok(result.extraInstances.length >= generator.minCount);
    assert.ok(result.extraInstances.length <= generator.maxCount);

    const types = result.extraInstances.map((inst) => inst.type);
    types.forEach((type) => assert.ok(generator.elementTypes.includes(type)));
    assert.equal(new Set(types).size, types.length, 'no duplicate type within one call');
  });
}

// ── Determinism ──────────────────────────────────────────────────────────

test('generateCuratedSet: same seed -> deep-equal result', () => {
  const a = generateCuratedSet('glass-gallery', { seed: 7, formatId: 'landscape' });
  const b = generateCuratedSet('glass-gallery', { seed: 7, formatId: 'landscape' });
  assert.deepEqual(a, b);
});

test('generateCuratedSet: different seed -> different result for at least one generator', () => {
  let sawDifference = false;
  for (const generator of CURATED_GENERATORS) {
    const a = generateCuratedSet(generator.id, { seed: 7, formatId: 'landscape' });
    const b = generateCuratedSet(generator.id, { seed: 8, formatId: 'landscape' });
    const idsA = a.extraInstances.map((i) => i.id).join(',');
    const idsB = b.extraInstances.map((i) => i.id).join(',');
    const materialA = JSON.stringify(a.extraInstances.map((i) => i.material));
    const materialB = JSON.stringify(b.extraInstances.map((i) => i.material));
    if (idsA !== idsB || materialA !== materialB) {
      sawDifference = true;
      break;
    }
  }
  assert.ok(sawDifference, 'at least one generator must produce a different result for a different seed');
});

test('resolveCuratedDiffusionCamera: null config disables a previously enabled curated camera', () => {
  const nightPortal = generateCuratedSet('night-portal', { seed: 1 });
  const chromePlayground = generateCuratedSet('chrome-playground', { seed: 2 });
  const enabled = resolveCuratedDiffusionCamera(
    { enabled: false, focusDistance: 2.2, locked: false },
    nightPortal.diffusionCamera
  );
  const disabled = resolveCuratedDiffusionCamera(enabled, chromePlayground.diffusionCamera);

  assert.equal(enabled.enabled, true);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.focusDistance, 2.2, 'existing safe camera fields remain intact');
});

// ── Unknown generator id ─────────────────────────────────────────────────

test('generateCuratedSet: unknown generator id returns {feasible:false, error} without throwing', () => {
  const result = generateCuratedSet('not-a-real-generator', { seed: 1 });
  assert.deepEqual(result, { feasible: false, error: 'Unknown generator' });
});

// ── Placement is genuinely guarded (defaultTransformForFormat parity) ──────

const FORMATS = ['landscape', 'square', 'reel'];
const CHECK_GENERATOR_IDS = ['glass-gallery', 'night-portal'];

for (const generatorId of CHECK_GENERATOR_IDS) {
  for (const formatId of FORMATS) {
    test(`generateCuratedSet('${generatorId}', format '${formatId}'): every instance transform matches defaultTransformForFormat for its exact type/format`, () => {
      const result = generateCuratedSet(generatorId, { seed: 1, formatId });
      assert.ok(result.extraInstances.length > 0);
      result.extraInstances.forEach((instance) => {
        const def = getElementDefinition(instance.type);
        const expected = defaultTransformForFormat(instance.type, formatId, def);
        assert.deepEqual(instance.transform.position, expected.position);
        assert.deepEqual(instance.transform.scale, expected.scale);
      });
    });
  }
}
