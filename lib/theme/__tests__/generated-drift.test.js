// The checked-in generated artefacts must equal a fresh build of production-theme.json.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionOutputs } from '../production/build-outputs.js';
import { toCss } from '../css.js';
import { resolveBoth } from '../resolve.js';
import { validateDefinition } from '../validate.js';
import { TOKEN_NAMES } from '../tokens.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const production = read('lib/theme/production/production-theme.json');
const out = buildProductionOutputs(production);

test('production-theme.json is valid and canonical', () => {
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.deepEqual(out.warnings, []);
  assert.equal(production, out.files.canonicalJson, 'run `npm run theme:build` after exporting a theme: the file must be canonical');
  assert.equal(validateDefinition(JSON.parse(production)).ok, true);
});

test('styles/theme/theme.generated.css equals toCss(production)', () => {
  assert.equal(read('styles/theme/theme.generated.css'), out.files.css);
  assert.equal(out.files.css, toCss(JSON.parse(production)));
});

test('resolved.generated.json and the slim runtime file equal fresh output', () => {
  assert.equal(read('lib/theme/production/resolved.generated.json'), out.files.resolved);
  assert.equal(read('lib/theme/production/resolved.runtime.generated.json'), out.files.runtime);
  assert.equal(read('lib/theme/production/resolved.runtime.generated.js'), out.files.runtimeModule);
  const slim = JSON.parse(out.files.runtime);
  assert.ok(Buffer.byteLength(out.files.runtime) < 25 * 1024, 'the runtime file stays small enough for the main bundle');
  assert.deepEqual(Object.keys(slim.light.tokens), [...TOKEN_NAMES]);
  assert.equal(slim.defaults.viewerPreference, 'dark');
  const full = JSON.parse(out.files.resolved);
  assert.deepEqual(full.light, JSON.parse(JSON.stringify(resolveBoth(JSON.parse(production)).light)));
  assert.equal(full.light.tokens['--t-page'], slim.light.tokens['--t-page']);
  assert.deepEqual(full.light.scene, slim.light.scene);
});

test('the runtime ES module exports exactly the slim JSON', async () => {
  const mod = await import('../production/resolved.runtime.generated.js');
  assert.deepEqual(mod.default, JSON.parse(out.files.runtime));
});

test('baseline.report.json equals the report for the baseline', () => {
  assert.equal(read('lib/theme/production/baseline.report.json'), out.files.baselineReport);
});
