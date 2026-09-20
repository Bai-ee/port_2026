// Invoice Studio Q1 (Lane E) — useInvoiceBridge.js's pure helpers, tested
// directly (no DOM/jsdom in this repo's node:test runner — see
// draft-storage.test.js for the same constraint/pattern). The DOM-wiring
// half of the bridge (attach(), listener setup, contentDocument walking) is
// verified by hand in a real browser instead — see this lane's own report.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCanvasEditPath, computeDerivedPatches, parseItemPricePath, rawTextForType,
} from '../useInvoiceBridge.js';

// ── resolveCanvasEditPath ──────────────────────────────────────────────────

test('resolveCanvasEditPath: id-keyed paths pass through unchanged', () => {
  const invoice = { categories: [{ id: 'cat-1', items: [{ id: 'item-1', name: 'Design' }] }] };
  assert.equal(resolveCanvasEditPath(invoice, 'categories[cat-1].name'), 'categories[cat-1].name');
  assert.equal(resolveCanvasEditPath(invoice, 'categories[cat-1].items[item-1].name'), 'categories[cat-1].items[item-1].name');
  assert.equal(resolveCanvasEditPath(invoice, 'standaloneItems[item-9].qty'), 'standaloneItems[item-9].qty');
});

test('resolveCanvasEditPath: flat, non-indexed paths pass through unchanged', () => {
  const invoice = {};
  assert.equal(resolveCanvasEditPath(invoice, 'invoiceNumber'), 'invoiceNumber');
  assert.equal(resolveCanvasEditPath(invoice, 'from.email'), 'from.email');
  assert.equal(resolveCanvasEditPath(invoice, 'servicePeriod.start'), 'servicePeriod.start');
});

test('resolveCanvasEditPath: terms[] translates a rendered index past a blank hole', () => {
  const invoice = { terms: ['Net 30', '', 'No refunds'] };
  // Rendered order (blanks dropped): ['Net 30', 'No refunds'] -> rendered
  // index 1 is 'No refunds', which lives at DRAFT index 2.
  assert.equal(resolveCanvasEditPath(invoice, 'terms[0]'), 'terms[0]');
  assert.equal(resolveCanvasEditPath(invoice, 'terms[1]'), 'terms[2]');
});

test('resolveCanvasEditPath: terms[] with an out-of-range rendered index -> null', () => {
  const invoice = { terms: ['Net 30', ''] };
  assert.equal(resolveCanvasEditPath(invoice, 'terms[5]'), null);
});

test('resolveCanvasEditPath: recommendation.chips[] translates past a blank hole', () => {
  const invoice = { recommendation: { chips: ['', 'Fast', 'Reliable'] } };
  assert.equal(resolveCanvasEditPath(invoice, 'recommendation.chips[0]'), 'recommendation.chips[1]');
  assert.equal(resolveCanvasEditPath(invoice, 'recommendation.chips[1]'), 'recommendation.chips[2]');
});

test('resolveCanvasEditPath: flowSteps[].field translates the index and keeps the field', () => {
  const invoice = {
    flowSteps: [
      { platform: '', color: '', label: '' }, // dropped (no platform/label)
      { platform: 'X', color: 'blue', label: 'Post' },
    ],
  };
  assert.equal(resolveCanvasEditPath(invoice, 'flowSteps[0].platform'), 'flowSteps[1].platform');
  assert.equal(resolveCanvasEditPath(invoice, 'flowSteps[0].tech'), 'flowSteps[1].tech');
});

test('resolveCanvasEditPath: subItems under a category item translates against that item\'s own list', () => {
  const invoice = {
    categories: [{
      id: 'cat-1',
      items: [{
        id: 'item-1',
        subItems: [{ name: '' }, { name: 'Extra hosting', cost: '10' }],
      }],
    }],
  };
  assert.equal(
    resolveCanvasEditPath(invoice, 'categories[cat-1].items[item-1].subItems[0].name'),
    'categories[cat-1].items[item-1].subItems[1].name',
  );
  assert.equal(
    resolveCanvasEditPath(invoice, 'categories[cat-1].items[item-1].subItems[0].cost'),
    'categories[cat-1].items[item-1].subItems[1].cost',
  );
});

test('resolveCanvasEditPath: subItems under a standalone item translates against that item\'s own list', () => {
  const invoice = {
    standaloneItems: [{
      id: 'item-9',
      subItems: [{ name: 'Kept' }, { name: '' }, { name: 'Also kept' }],
    }],
  };
  // Rendered order: ['Kept', 'Also kept'] -> rendered index 1 is draft index 2.
  assert.equal(
    resolveCanvasEditPath(invoice, 'standaloneItems[item-9].subItems[1].name'),
    'standaloneItems[item-9].subItems[2].name',
  );
});

test('resolveCanvasEditPath: a removed row (index no longer resolves) -> null', () => {
  const invoice = { terms: ['Only one left'] };
  assert.equal(resolveCanvasEditPath(invoice, 'terms[3]'), null);
  const emptyInvoice = { categories: [{ id: 'cat-1', items: [{ id: 'item-1', subItems: [] }] }] };
  assert.equal(resolveCanvasEditPath(emptyInvoice, 'categories[cat-1].items[item-1].subItems[0].name'), null);
});

// ── parseItemPricePath ─────────────────────────────────────────────────────

test('parseItemPricePath: category-item qty/unitPrice', () => {
  assert.deepEqual(
    parseItemPricePath('categories[cat-1].items[item-1].qty'),
    { kind: 'category', catId: 'cat-1', itemId: 'item-1', field: 'qty' },
  );
  assert.deepEqual(
    parseItemPricePath('categories[cat-1].items[item-1].unitPrice'),
    { kind: 'category', catId: 'cat-1', itemId: 'item-1', field: 'unitPrice' },
  );
});

test('parseItemPricePath: standalone-item qty/unitPrice', () => {
  assert.deepEqual(
    parseItemPricePath('standaloneItems[item-9].qty'),
    { kind: 'standalone', itemId: 'item-9', field: 'qty' },
  );
});

test('parseItemPricePath: a non-price field on the same row -> null', () => {
  assert.equal(parseItemPricePath('categories[cat-1].items[item-1].name'), null);
  assert.equal(parseItemPricePath('categories[cat-1].items[item-1].costLabel'), null);
});

test('parseItemPricePath: an unrelated path -> null', () => {
  assert.equal(parseItemPricePath('totals.subtotal'), null);
  assert.equal(parseItemPricePath('invoiceNumber'), null);
});

// ── rawTextForType ──────────────────────────────────────────────────────────

test('rawTextForType: date passes through as-is', () => {
  assert.equal(rawTextForType('date', '2026-09-03'), '2026-09-03');
  assert.equal(rawTextForType('date', ''), '');
});

test('rawTextForType: money/number stringify the numeric value', () => {
  assert.equal(rawTextForType('money', 150), '150');
  assert.equal(rawTextForType('money', 150.5), '150.5');
  assert.equal(rawTextForType('number', 3), '3');
  assert.equal(rawTextForType('money', 'not-a-number'), '0');
});

// ── computeDerivedPatches ────────────────────────────────────────────────────

test('computeDerivedPatches: item totals and invoice totals for a plain qty x price invoice', () => {
  const invoice = {
    currency: 'USD',
    categories: [{
      id: 'cat-1',
      items: [{ id: 'item-1', qty: 2, unitPrice: 50, total: 100, costLabel: '' }],
    }],
    standaloneItems: [{ id: 'item-9', qty: 1, unitPrice: 25, total: 25, costLabel: '' }],
    totals: { discount: 0, tax: 0, amountPaid: 0 },
  };
  const patches = computeDerivedPatches(invoice);
  const byPath = Object.fromEntries(patches.map((p) => [p.path, p.display]));
  assert.equal(byPath['categories[cat-1].items[item-1].total'], '$100.00');
  assert.equal(byPath['standaloneItems[item-9].total'], '$25.00');
  assert.equal(byPath['totals.subtotal'], '$125.00');
  assert.equal(byPath['totals.total'], '$125.00');
  assert.equal(byPath['totals.balanceDue'], '$125.00');
});

test('computeDerivedPatches: a cost-labeled item is excluded from the item-total patch list', () => {
  const invoice = {
    currency: 'USD',
    categories: [{
      id: 'cat-1',
      items: [
        { id: 'item-1', qty: 1, unitPrice: 10, total: 10, costLabel: '' },
        { id: 'item-2', qty: 1, unitPrice: 0, total: 0, costLabel: 'Included' },
      ],
    }],
    standaloneItems: [],
    totals: {},
  };
  const patches = computeDerivedPatches(invoice);
  const paths = patches.map((p) => p.path);
  assert.ok(paths.includes('categories[cat-1].items[item-1].total'));
  assert.ok(!paths.includes('categories[cat-1].items[item-2].total'));
});

test('computeDerivedPatches: discount/tax/amountPaid factor into subtotal/total/balanceDue', () => {
  const invoice = {
    currency: 'USD',
    categories: [{ id: 'cat-1', items: [{ id: 'item-1', qty: 1, unitPrice: 200, total: 200, costLabel: '' }] }],
    standaloneItems: [],
    totals: { discount: 20, tax: 10, amountPaid: 50 },
  };
  const patches = computeDerivedPatches(invoice);
  const byPath = Object.fromEntries(patches.map((p) => [p.path, p.display]));
  // subtotal = 200; total = 200 - 20 + 10 = 190; balanceDue = 190 - 50 = 140.
  assert.equal(byPath['totals.subtotal'], '$200.00');
  assert.equal(byPath['totals.total'], '$190.00');
  assert.equal(byPath['totals.balanceDue'], '$140.00');
});

test('computeDerivedPatches: an invoice with only cost-labeled items still produces totals patches', () => {
  const invoice = {
    currency: 'USD',
    categories: [{ id: 'cat-1', items: [{ id: 'item-1', qty: 1, unitPrice: 0, total: 0, costLabel: 'Included' }] }],
    standaloneItems: [],
    totals: {},
  };
  const patches = computeDerivedPatches(invoice);
  const byPath = Object.fromEntries(patches.map((p) => [p.path, p.display]));
  assert.equal(byPath['totals.subtotal'], '$0.00');
  assert.equal(byPath['totals.total'], '$0.00');
  assert.equal(patches.some((p) => p.path.endsWith('.total') && p.path.startsWith('categories')), false);
});
