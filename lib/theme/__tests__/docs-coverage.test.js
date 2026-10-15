// docs/source-of-truth/THEME-STUDIO.md must keep up with the code: every token, every
// validation code and every script it names has to exist.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_NAMES, ROLE_TOKEN_NAMES } from '../tokens.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const doc = fs.readFileSync(path.join(root, 'docs/source-of-truth/THEME-STUDIO.md'), 'utf8');
const validateSrc = fs.readFileSync(path.join(root, 'lib/theme/validate.js'), 'utf8');
const migrateSrc = fs.readFileSync(path.join(root, 'lib/theme/migrate.js'), 'utf8');

test('every role token is documented in the roles table', () => {
  const missing = ROLE_TOKEN_NAMES.filter((t) => !doc.includes(`\`${t}\``));
  assert.deepEqual(missing, []);
});

test('composite tokens are documented (shorthand groups allowed)', () => {
  const covered = (t) =>
    doc.includes(t) ||
    (/^--t-shadow-(sm|md|lg)$/.test(t) && doc.includes('--t-shadow-sm/md/lg')) ||
    (/^--t-scene-(base|secondary|highlight)$/.test(t) && doc.includes('--t-scene-base/secondary/highlight'));
  const missing = TOKEN_NAMES.filter((t) => !ROLE_TOKEN_NAMES.includes(t) && !covered(t));
  assert.deepEqual(missing, []);
});

test('every validation code raised by the code is in the documented table', () => {
  const codes = new Set([...(validateSrc + migrateSrc).matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]));
  codes.delete('INTERNAL');
  codes.delete('NO_MIGRATION');
  const missing = [...codes].filter((c) => !doc.includes(`\`${c}\``) && !doc.includes(c));
  assert.deepEqual(missing, []);
});

test('scripts named in the doc exist', () => {
  for (const f of ['build-theme.mjs', 'check-theme.mjs', 'codemod-literals.mjs', 'e2e-theme.mjs']) {
    assert.ok(doc.includes(f), `${f} not documented`);
    assert.ok(fs.existsSync(path.join(root, 'scripts/theme', f)), `${f} missing`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['theme:build'], 'node scripts/theme/build-theme.mjs');
  assert.equal(pkg.scripts['theme:check'], 'node scripts/theme/check-theme.mjs');
  assert.ok(doc.includes('npm run theme:build') && doc.includes('npm run theme:check'));
});
