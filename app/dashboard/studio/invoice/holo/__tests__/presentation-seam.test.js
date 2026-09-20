// HoloPaper handoff H0 — "smallest prop seams through InvoiceStudio,
// InvoiceRail, and CoverCard, feature off." Static source-content checks
// (no DOM/jsdom in this repo's node:test runner — see draft-storage.test.js
// for the same constraint/pattern) that the seam threads through.
//
// The last two tests below were ORIGINALLY written as negative placeholders
// ("no Holo UI yet", "InvoiceCanvas untouched") while H0 was the only phase
// complete. H2 (see h2-integration-seam.test.js) has since built the actual
// CoverCard controls and InvoiceCanvas wiring on top of this exact seam —
// that is this phase working as designed, not a regression — so these two
// are now updated to the equivalent POSITIVE checks instead of being
// deleted, keeping this file's own record of "the seam exists and is
// actually used" accurate post-integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoiceDir = path.resolve(__dirname, '../..');

function readSource(relPath) {
  return fs.readFileSync(path.join(invoiceDir, relPath), 'utf8');
}

test('InvoiceStudio.jsx instantiates useInvoicePresentation() and threads it to InvoiceRail', () => {
  const source = readSource('InvoiceStudio.jsx');
  assert.match(source, /import\s*\{\s*useInvoicePresentation\s*\}\s*from\s*'\.\/holo\/useInvoicePresentation'/);
  assert.match(source, /const presentation = useInvoicePresentation\(\)/);
  assert.match(source, /<InvoiceRail[\s\S]*?presentation=\{presentation\}[\s\S]*?\/>/);
});

test('InvoiceRail.jsx accepts a presentation prop and forwards it to every section card', () => {
  const source = readSource('rail/InvoiceRail.jsx');
  assert.match(source, /presentation\s*=\s*null/);
  assert.match(source, /<CardComponent[\s\S]*?presentation=\{presentation\}[\s\S]*?\/>/);
});

test('CoverCard.jsx accepts a presentation prop and (post-H2) actually renders the Holo Paper subsection from it', () => {
  const source = readSource('rail/CoverCard.jsx');
  assert.match(source, /presentation\s*=\s*null/);
  assert.ok(source.includes('invoice-rail-cover-holo-section'), 'H2 wired the real Holo Paper subsection here');
});

test('InvoiceCanvas.jsx (post-H2) reaches Holo/Three code only through a dynamic import, never a static one', () => {
  const source = readSource('InvoiceCanvas.jsx');
  // The hard H8 guarantee: no static three/three-stdlib import, ever.
  assert.ok(!/from ['"]three['"]/.test(source));
  assert.ok(!/from ['"]three-stdlib['"]/.test(source));
  // H2 (plus the orchestrator's own H8 fix — see h2-integration-seam.test.js)
  // does now reference `/holo/`, but only via lazy(() => import('./holo/...')),
  // never a static top-of-file import of a holo/ module.
  assert.ok(source.includes('/holo/'), 'InvoiceCanvas.jsx now lazy-loads the Holo overlay from ./holo/');
  assert.match(source, /lazy\(\(\) => import\('\.\/holo\/InvoiceHoloOverlay'\)\)/);
  assert.ok(
    !/^import\s+.*from\s+'\.\/holo\//m.test(source),
    'no holo/ module may be a static top-of-file import — every one must be reached via lazy()/dynamic import()',
  );
});
