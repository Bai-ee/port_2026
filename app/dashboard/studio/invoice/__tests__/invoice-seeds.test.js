import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicSeed, adminSeed } from '../invoice-seeds.js';
import { formatMoney } from '../../../../../features/invoices/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Owner-identity strings that must NEVER appear anywhere in publicSeed()'s
// output (docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md D8/D10). Checked against
// a JSON.stringify of the whole object so a leak nested at any depth (e.g.
// slipped into `notes` or `payment.instructions` by a future edit) is caught.
const OWNER_IDENTITY_STRINGS = ['bryanballi', '3122865129', 'bryan-balli', 'venmo'];

test('publicSeed(): output carries no owner identity string', () => {
  const seed = publicSeed();
  const haystack = JSON.stringify(seed).toLowerCase();
  for (const needle of OWNER_IDENTITY_STRINGS) {
    assert.ok(!haystack.includes(needle.toLowerCase()), `publicSeed() output contains "${needle}"`);
  }
});

test('publicSeed(): from-party and payment are neutral placeholders, not blank-but-defaulting', () => {
  const seed = publicSeed();
  assert.equal(seed.from.name, 'Your name');
  assert.equal(seed.from.email, '');
  assert.equal(seed.from.phone, '');
  assert.equal(seed.from.address, '');
  assert.equal(seed.payment.qr, '');
  assert.equal(seed.payment.handle, '');
});

test('publicSeed(): structurally valid starting draft (ids, dates, one seed category/item)', () => {
  const seed = publicSeed();
  assert.match(seed.invoiceNumber, /^INV-\d{8}-\d{3}$/);
  assert.match(seed.issueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(seed.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(seed.categories.length, 1);
  assert.ok(seed.categories[0].id);
  assert.ok(seed.categories[0].items[0].id);
  assert.equal(seed.categories[0].items[0].qty, 1);
});

test('adminSeed(): resolves (via dynamic import) to today\'s DEFAULT_DRAFT-based owner draft', async () => {
  const seed = await adminSeed();
  // Sanity: this IS the admin path — it should carry the real issuing party
  // (features/invoices/default-draft.js -> model.js's DEFAULT_FROM), proving
  // adminSeed() actually reached that module rather than silently falling
  // back to a neutral shape.
  assert.equal(seed.from.email, 'bryanballi@gmail.com');
  assert.ok(seed.categories.length >= 1);
  assert.ok(seed.categories[0].id);
});

test('adminSeed() and publicSeed() produce the same top-level shape', () => {
  const pub = publicSeed();
  return adminSeed().then((admin) => {
    assert.deepEqual(Object.keys(pub).sort(), Object.keys(admin).sort());
    assert.deepEqual(Object.keys(pub.totals).sort(), Object.keys(admin.totals).sort());
    assert.deepEqual(Object.keys(pub.payment).sort(), Object.keys(admin.payment).sort());
  });
});

// ── Module-graph isolation ────────────────────────────────────────────────
// No bundler available in this test run, so this is a static-source check:
// the PUBLIC path's own files (invoice-seeds.js, invoice-fields.js) must
// carry no STATIC top-level import of the owner-identity-bearing modules.
// A dynamic `import()` (admin-only, awaited behind an isAdmin check by the
// caller) is fine and expected for default-draft.js.

function staticImportLines(source) {
  return source.split('\n').filter((line) => /^\s*import\s[^(]/.test(line));
}

// Both files' own header comments deliberately NAME default-draft.js /
// DEFAULT_FROM / brand-marks.js / payment-qr.js — as a warning not to
// import them. Strip comments before scanning for actual code references,
// or that prose trips the very check it's explaining.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('invoice-seeds.js: no static import of default-draft.js, default-from.js, DEFAULT_FROM, brand-marks.js, or payment-qr.js', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../invoice-seeds.js'), 'utf8');
  const code = stripComments(source);
  const staticImports = staticImportLines(code);
  assert.ok(!staticImports.some((l) => /default-draft/.test(l)), 'static import of default-draft.js found');
  // default-from.js is the D13 bundle-inspection fix: DEFAULT_FROM moved out
  // of model.js into its own module specifically so a static import of it
  // (here or anywhere else reachable from the public bundle) is the actual
  // leak vector — assert this file never adds one.
  assert.ok(!staticImports.some((l) => /default-from/.test(l)), 'static import of default-from.js found');
  assert.ok(!staticImports.some((l) => /brand-marks/.test(l)), 'static import of brand-marks.js found');
  assert.ok(!staticImports.some((l) => /payment-qr/.test(l)), 'static import of payment-qr.js found');
  assert.ok(!code.includes('DEFAULT_FROM'), 'DEFAULT_FROM referenced in code');
  // The admin path must still be reachable — just lazily.
  assert.match(code, /import\(\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/features\/invoices\/default-draft\.js['"]\s*\)/);
});

test('invoice-fields.js: no import of default-draft.js, brand-marks.js, or payment-qr.js (only model.js)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../invoice-fields.js'), 'utf8');
  const code = stripComments(source);
  assert.ok(!code.includes('default-draft'));
  assert.ok(!code.includes('brand-marks'));
  assert.ok(!code.includes('payment-qr'));
  assert.ok(!code.includes('DEFAULT_FROM'));
  assert.match(code, /from '\.\.\/\.\.\/\.\.\/\.\.\/features\/invoices\/model\.js'/);
});

// Sanity that the real formatMoney (imported the same way invoice-fields.js
// imports it) behaves as invoice-fields.js's money round-trip test assumes —
// guards against the two files' import paths silently resolving differently.
test('model.js formatMoney is reachable from this test the same way invoice-fields.js reaches it', () => {
  assert.equal(formatMoney(1234.5), '$1,234.50');
});
