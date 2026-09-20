// Invoice Studio design-layer plan Q2, Lane B — render.js's document-
// semantics wiring (docKind/labels/locale/logoDataUrl actually reaching the
// rendered HTML). model.js's own contract (DOC_KIND_LABELS,
// resolveInvoiceLabels, normalizeInvoice's field validation) is covered by
// model-contract.test.js; this file only exercises what render.js DOES with
// those values once resolved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeInvoice, DOC_KINDS, DOC_KIND_LABELS } from '../model.js';
import { renderInvoiceHtml } from '../render.js';
import { HITLOOP_BRAND } from '../brand-marks.js';
import { SAMPLE_INVOICE } from './fixtures/sample-invoice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAFT_LOGO_DATA_URL = 'data:image/png;base64,aGVsbG8=';

test('every DOC_KIND renders its own terminology (spot-check a handful of labels per kind)', () => {
  for (const kind of DOC_KINDS) {
    const invoice = normalizeInvoice({ ...SAMPLE_INVOICE, docKind: kind });
    const html = renderInvoiceHtml(invoice);
    const labels = DOC_KIND_LABELS[kind];
    assert.ok(html.includes(labels.title), `${kind}: missing cover kicker "${labels.title}"`);
    assert.ok(html.includes(labels.invoiceDetails), `${kind}: missing "${labels.invoiceDetails}" heading`);
    assert.ok(html.includes(labels.billToLabel), `${kind}: missing "${labels.billToLabel}" heading`);
    assert.ok(html.includes(labels.totalsLabel), `${kind}: missing "${labels.totalsLabel}" heading`);
    assert.ok(html.includes(labels.lineItemsLabel), `${kind}: missing "${labels.lineItemsLabel}" heading`);
  }
});

test('buildDeposit falls back to the docKind paymentDueLabel default when totals.depositLabel is unset', () => {
  // SAMPLE_INVOICE sets its own totals.depositLabel ('Deposit to begin'), a
  // pre-existing per-invoice override this lane deliberately leaves alone —
  // it wins over labels.paymentDueLabel by design, so this check uses a
  // fresh invoice without that override to see the docKind default itself.
  for (const kind of DOC_KINDS) {
    const invoice = normalizeInvoice({ docKind: kind, standaloneItems: [{ name: 'Work', qty: 1, unitPrice: 100 }], totals: { deposit: 50 } });
    const html = renderInvoiceHtml(invoice);
    assert.ok(html.includes(DOC_KIND_LABELS[kind].paymentDueLabel), `${kind}: missing default deposit heading "${DOC_KIND_LABELS[kind].paymentDueLabel}"`);
  }
});

test('an explicit invoice.labels override wins over the docKind default in the rendered output', () => {
  const invoice = normalizeInvoice({ ...SAMPLE_INVOICE, labels: { billToLabel: 'Ship to' } });
  const html = renderInvoiceHtml(invoice);
  assert.ok(html.includes('Ship to'));
  // The default docKind's own "Bill to" heading (block()'s exact wrapped
  // form) must no longer appear once overridden.
  assert.ok(!html.includes('>Bill to<'));
});

test('an override on a Quote also wins over that docKind\'s own (different) default', () => {
  const invoice = normalizeInvoice({ ...SAMPLE_INVOICE, docKind: 'quote', labels: { billToLabel: 'Custom quote-for label' } });
  const html = renderInvoiceHtml(invoice);
  assert.ok(html.includes('Custom quote-for label'));
  assert.ok(!html.includes('>Quote for<'));
});

test('de-DE locale visibly reformats a date and a money value vs the en-US default', () => {
  const htmlUS = renderInvoiceHtml(normalizeInvoice({ ...SAMPLE_INVOICE, locale: 'en-US' }));
  const htmlDE = renderInvoiceHtml(normalizeInvoice({ ...SAMPLE_INVOICE, locale: 'de-DE' }));
  assert.notEqual(htmlUS, htmlDE);
  // en-US: "Sep 2, 2026" month abbreviation; de-DE never produces that exact
  // English abbreviation for the same ISO date.
  assert.ok(htmlUS.includes('Sep 2, 2026'));
  assert.ok(!htmlDE.includes('Sep 2, 2026'));
  // Money: the standalone "Design + setup" item is $4,000.00 in en-US
  // (period decimal separator); de-DE swaps to a comma decimal separator, so
  // the exact en-US string never appears in the de-DE render.
  assert.ok(htmlUS.includes('$4,000.00'));
  assert.ok(!htmlDE.includes('$4,000.00'));
});

test('docKind/labels/locale absent (default) stays byte-identical to the golden fixture — Lane B safety net', () => {
  const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/invoice-baseline-pre-studio.html'), 'utf8');
  const after = renderInvoiceHtml(SAMPLE_INVOICE, { brand: HITLOOP_BRAND, editable: false });
  assert.equal(after, baseline);
});

test('logoDataUrl set + brand:null renders the draft logo image with no owner identity anywhere', () => {
  const invoice = { ...SAMPLE_INVOICE, logoDataUrl: DRAFT_LOGO_DATA_URL, from: {}, payment: {} };
  const html = renderInvoiceHtml(invoice, { brand: null, defaultFrom: null });
  assert.ok(html.includes('id="invoice-draft-logo"'));
  assert.ok(html.includes(DRAFT_LOGO_DATA_URL));
  assert.ok(!html.includes('id="invoice-brand-logo"'));
  assert.ok(!html.includes('id="invoice-brand-signature"'));
  for (const needle of ['bryanballi', 'HITLOOP', 'Bryan-Balli', '3122865129', 'Chicago']) {
    assert.ok(!html.includes(needle), `leaked owner identity string: ${needle}`);
  }
});

test('logoDataUrl set + brand:HITLOOP_BRAND — the admin brand logo wins, draft logo does not appear (L9)', () => {
  const invoice = { ...SAMPLE_INVOICE, logoDataUrl: DRAFT_LOGO_DATA_URL };
  const html = renderInvoiceHtml(invoice, { brand: HITLOOP_BRAND });
  assert.ok(html.includes('id="invoice-brand-logo"'));
  assert.ok(!html.includes('id="invoice-draft-logo"'));
  assert.ok(!html.includes(DRAFT_LOGO_DATA_URL));
});

test('no logoDataUrl and no brand renders no logo image of either kind', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { brand: null });
  assert.ok(!html.includes('id="invoice-brand-logo"'));
  assert.ok(!html.includes('id="invoice-draft-logo"'));
});
