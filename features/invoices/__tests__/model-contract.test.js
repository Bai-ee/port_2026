// Invoice Studio design-layer plan Q0 — model.js contract additions
// (docKind, labels, locale, numberPattern, logoDataUrl, DOC_KIND_LABELS,
// INVOICE_LABEL_KEYS, resolveInvoiceLabels). Kept in its own file (rather
// than folded into invoices.test.js) per the plan's Q0 acceptance bullet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInvoice, formatMoney, DOC_KINDS, DOC_KIND_LABELS, INVOICE_LABEL_KEYS, resolveInvoiceLabels,
  resolveDepositHeading,
} from '../model.js';
import { renderInvoiceDocument } from '../render.js';

test('normalizeInvoice defaults docKind to invoice and preserves a known kind', () => {
  assert.equal(normalizeInvoice({}).docKind, 'invoice');
  assert.equal(normalizeInvoice({ docKind: 'quote' }).docKind, 'quote');
  assert.equal(normalizeInvoice({ docKind: 'bogus' }).docKind, 'invoice');
});

test('DOC_KINDS covers every DOC_KIND_LABELS entry and vice versa', () => {
  assert.deepEqual([...DOC_KINDS].sort(), Object.keys(DOC_KIND_LABELS).sort());
});

test('every DOC_KIND_LABELS entry defines every INVOICE_LABEL_KEYS key with real text', () => {
  for (const kind of DOC_KINDS) {
    for (const key of INVOICE_LABEL_KEYS) {
      const value = DOC_KIND_LABELS[kind][key];
      assert.equal(typeof value, 'string', `${kind}.${key} should be a string`);
      assert.ok(value.trim().length > 0, `${kind}.${key} should not be blank`);
    }
  }
});

test("DOC_KIND_LABELS.invoice matches today's hardcoded render.js terminology", () => {
  const inv = DOC_KIND_LABELS.invoice;
  assert.equal(inv.invoiceDetails, 'Invoice details');
  assert.equal(inv.billToLabel, 'Bill to');
  assert.equal(inv.summaryLabel, 'Summary');
  assert.equal(inv.lineItemsLabel, 'Line items');
  assert.equal(inv.additionalItemsLabel, 'Additional items');
  assert.equal(inv.totalsLabel, 'Totals');
  assert.equal(inv.paymentDueLabel, 'Payment due');
  assert.equal(inv.recommendationLabel, 'Recommendation');
  assert.equal(inv.flowLabel, 'How it works');
  assert.equal(inv.termsLabel, 'Terms');
  assert.equal(inv.paymentLabel, 'Payment');
  assert.equal(inv.notesLabel, 'Notes');
});

test('resolveInvoiceLabels falls back to invoice docKind defaults with no labels set', () => {
  const invoice = normalizeInvoice({});
  const resolved = resolveInvoiceLabels(invoice);
  assert.deepEqual(resolved, DOC_KIND_LABELS.invoice);
});

test('resolveInvoiceLabels resolves docKind defaults first, then explicit label overrides', () => {
  const invoice = normalizeInvoice({ docKind: 'quote', labels: { billToLabel: 'Custom Bill-To' } });
  const resolved = resolveInvoiceLabels(invoice);
  assert.equal(resolved.billToLabel, 'Custom Bill-To');
  assert.equal(resolved.totalsLabel, DOC_KIND_LABELS.quote.totalsLabel);
});

test('resolveInvoiceLabels ignores blank overrides and falls back on unknown docKind', () => {
  const invoice = normalizeInvoice({ docKind: 'nonsense', labels: { billToLabel: '   ' } });
  assert.deepEqual(resolveInvoiceLabels(invoice), DOC_KIND_LABELS.invoice);
});

// resolveInvoiceLabels() itself (not the normalizeInvoice()->normalizeLabels()
// pipeline, which coerces every value through cleanString/String()) rejects a
// non-string override outright — defensive against a caller handing it a raw,
// not-yet-normalized invoice-shaped object.
test('resolveInvoiceLabels rejects a non-string override value', () => {
  const resolved = resolveInvoiceLabels({ docKind: 'invoice', labels: { totalsLabel: 42 } });
  assert.equal(resolved.totalsLabel, 'Totals');
});

test('normalizeInvoice drops unknown label keys and trims kept ones', () => {
  const invoice = normalizeInvoice({ labels: { billToLabel: '  Ship to  ', bogusKey: 'nope' } });
  assert.equal(invoice.labels.billToLabel, 'Ship to');
  assert.equal('bogusKey' in invoice.labels, false);
});

test('normalizeInvoice defaults and validates locale', () => {
  assert.equal(normalizeInvoice({}).locale, 'en-US');
  assert.equal(normalizeInvoice({ locale: 'de-DE' }).locale, 'de-DE');
  assert.equal(normalizeInvoice({ locale: 'fr' }).locale, 'fr');
  assert.equal(normalizeInvoice({ locale: 'not a locale!!' }).locale, 'en-US');
});

test('formatMoney locale is optional and defaults to en-US output', () => {
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney(1234.5, 'USD'), '$1,234.50');
  assert.equal(formatMoney(1234.5, 'USD', 'en-US'), '$1,234.50');
  // A locale that visibly changes formatting (comma/period swap) — proves
  // the 3rd argument actually reaches Intl.NumberFormat.
  assert.notEqual(formatMoney(1234.5, 'EUR', 'de-DE'), formatMoney(1234.5, 'EUR', 'en-US'));
});

test('normalizeInvoice defaults and validates numberPattern grammar', () => {
  assert.equal(normalizeInvoice({}).numberPattern, 'INV-{YYYY}-{seq:3}');
  assert.equal(normalizeInvoice({ numberPattern: 'Q-{YY}{MM}-{seq:4}' }).numberPattern, 'Q-{YY}{MM}-{seq:4}');
  // Unknown token -> falls back rather than persisting garbage.
  assert.equal(normalizeInvoice({ numberPattern: '{bogus}-{seq:2}' }).numberPattern, 'INV-{YYYY}-{seq:3}');
  assert.equal(normalizeInvoice({ numberPattern: '{seq:9}' }).numberPattern, 'INV-{YYYY}-{seq:3}');
});

// HoloPaper handoff H0 contract repair: Deposit's rail title must route
// through the doc-kind-resolved paymentDueLabel, while a genuinely typed
// totals.depositLabel override still wins outright.
test('resolveDepositHeading falls back to the doc-kind-resolved paymentDueLabel when depositLabel is unset', () => {
  const invoiceKind = normalizeInvoice({ totals: { depositLabel: 'Payment due' } });
  assert.equal(resolveDepositHeading(invoiceKind), 'Payment due');

  const quoteKind = normalizeInvoice({ docKind: 'quote', totals: { depositLabel: 'Payment due' } });
  assert.equal(resolveDepositHeading(quoteKind), DOC_KIND_LABELS.quote.paymentDueLabel);
  assert.notEqual(DOC_KIND_LABELS.quote.paymentDueLabel, 'Payment due');
});

test('resolveDepositHeading honors an explicit invoice.labels.paymentDueLabel override with no depositLabel override', () => {
  const invoice = normalizeInvoice({ labels: { paymentDueLabel: 'Custom Due' }, totals: { depositLabel: 'Payment due' } });
  assert.equal(resolveDepositHeading(invoice), 'Custom Due');
});

test('resolveDepositHeading treats a genuinely custom totals.depositLabel as the strongest override', () => {
  const invoice = normalizeInvoice({ docKind: 'quote', totals: { depositLabel: 'Deposit due' } });
  assert.equal(resolveDepositHeading(invoice), 'Deposit due');
});

test('resolveDepositHeading matches the printed section heading render.js actually emits (drift guard)', () => {
  for (const docKind of DOC_KINDS) {
    const invoice = normalizeInvoice({ docKind, totals: { deposit: 500, total: 1000 } });
    const heading = resolveDepositHeading(invoice);
    const html = renderInvoiceDocument(invoice, { editable: false }).html;
    const sectionStart = html.indexOf('id="invoice-deposit-section"');
    assert.ok(sectionStart !== -1, `${docKind}: deposit section missing`);
    const h2Start = html.indexOf('invoice-block-label">', sectionStart) + 'invoice-block-label">'.length;
    const h2End = html.indexOf('<', h2Start);
    assert.equal(html.slice(h2Start, h2End), heading, `${docKind}: rail resolver disagrees with the printed heading`);
  }
});

test('normalizeInvoice only accepts a well-formed image data URL for logoDataUrl', () => {
  assert.equal(normalizeInvoice({}).logoDataUrl, null);
  const okPng = 'data:image/png;base64,aGVsbG8=';
  assert.equal(normalizeInvoice({ logoDataUrl: okPng }).logoDataUrl, okPng);
  const okSvg = 'data:image/svg+xml;base64,aGVsbG8=';
  assert.equal(normalizeInvoice({ logoDataUrl: okSvg }).logoDataUrl, okSvg);
  assert.equal(normalizeInvoice({ logoDataUrl: 'not-a-data-url' }).logoDataUrl, null);
  assert.equal(normalizeInvoice({ logoDataUrl: 'data:text/html;base64,aGVsbG8=' }).logoDataUrl, null);
});
