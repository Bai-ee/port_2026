// HoloPaper handoff H0 contract repair: New Document is the ONLY action that
// reserves a sequence number (docs/source-of-truth/INVOICE-STUDIO.md §6).
// InvoiceMetaCard.jsx used to expose a manual "Reserve next number" button
// that called reserveNextNumber() directly, letting an operator mint a
// number as a side effect of rail interaction rather than New Document.
// There is no DOM/jsdom in this repo's node:test runner (see
// draft-storage.test.js for the same constraint), so this is a static
// source-content regression guard rather than a rendered-click test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoiceDir = path.resolve(__dirname, '..');

function readSource(relPath) {
  return fs.readFileSync(path.join(invoiceDir, relPath), 'utf8');
}

test('InvoiceMetaCard.jsx no longer imports or calls the mutating reserveNextNumber()', () => {
  const source = readSource('rail/InvoiceMetaCard.jsx');
  assert.ok(!source.includes('reserveNextNumber'), 'InvoiceMetaCard.jsx must not reference reserveNextNumber');
});

test('InvoiceMetaCard.jsx keeps a non-mutating pattern preview and the duplicate-number warning', () => {
  const source = readSource('rail/InvoiceMetaCard.jsx');
  assert.ok(source.includes('formatNumberFromPattern'), 'pattern preview helper should remain');
  assert.ok(source.includes('isDuplicateNumber'), 'duplicate-number warning helper should remain');
  assert.ok(source.includes('invoice-rail-invoice-meta-number-duplicate-warning'), 'duplicate warning DOM node should remain');
});

test('reserveNextNumber() is only imported by useInvoiceDraft.js (New Document) and its own tests', () => {
  const featuresDir = path.resolve(__dirname, '../../../../../features/invoices');
  const searchRoots = [invoiceDir, featuresDir];
  const allowedFiles = new Set([
    path.join(invoiceDir, 'useInvoiceDraft.js'),
    path.join(invoiceDir, 'identity/numbering.js'),
    path.join(invoiceDir, 'identity/__tests__/numbering.test.js'),
    path.join(invoiceDir, '__tests__/numbering-reservation-contract.test.js'),
  ]);
  // Match an actual import or call, not a prose comment mentioning the name
  // (e.g. book.js's header comment contrasting its own save pattern).
  const usagePattern = /import\s*\{[^}]*\breserveNextNumber\b[^}]*\}\s*from|\breserveNextNumber\s*\(/;

  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.jsx?$/.test(entry.name)) out.push(full);
    }
  }

  const files = [];
  for (const root of searchRoots) walk(root, files);

  const offenders = [];
  for (const file of files) {
    if (allowedFiles.has(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (usagePattern.test(source)) offenders.push(path.relative(invoiceDir, file));
  }
  assert.deepEqual(offenders, [], `reserveNextNumber() referenced outside the allowed set: ${offenders.join(', ')}`);
});
