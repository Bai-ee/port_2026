import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeInvoice, computeTotals, formatMoney, invoiceNumberFor } from '../model.js';
import { INVOICE_SECTIONS, defaultInvoiceSectionConfig, normalizeInvoiceSectionConfig, resolveInvoiceSections } from '../registry.js';
import { renderInvoiceHtml } from '../render.js';
import { HITLOOP_BRAND } from '../brand-marks.js';
import { DEFAULT_FROM } from '../default-from.js';
import { resolvePaymentQr } from '../payment-qr.js';
import { SAMPLE_INVOICE } from './fixtures/sample-invoice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('normalizeInvoice never throws on empty input and fills defaults', () => {
  const invoice = normalizeInvoice();
  assert.equal(invoice.status, 'draft');
  assert.match(invoice.invoiceNumber, /^INV-\d{4}-\d{4}-[A-Z0-9]{4}$/);
  assert.match(invoice.issueDate, /^\d{4}-\d{2}-\d{2}$/);
  // Absent due date falls back to issue + 14 days, matching what the Invoice
  // Builder card computes — both surfaces must agree on net-14.
  assert.match(invoice.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(
    Math.round((new Date(invoice.dueDate) - new Date(invoice.issueDate)) / 86400000),
    14,
  );
  assert.equal(invoice.currency, 'USD');
  assert.deepEqual(invoice.categories, []);
  assert.deepEqual(invoice.standaloneItems, []);
  assert.equal(invoice.totals.subtotal, 0);
  assert.equal(invoice.totals.total, 0);
});

test('normalizeInvoice fills defaults on partial input without dropping what was given', () => {
  const invoice = normalizeInvoice({
    projectTitle: 'Website Refresh',
    categories: [{ name: 'Design', items: [{ name: 'Homepage' }] }],
  });
  assert.equal(invoice.projectTitle, 'Website Refresh');
  assert.equal(invoice.categories.length, 1);
  assert.equal(invoice.categories[0].items[0].name, 'Homepage');
  // No unitPrice given -> numeric item defaults to qty 1 / unitPrice 0 / total 0.
  assert.equal(invoice.categories[0].items[0].qty, 1);
  assert.equal(invoice.categories[0].items[0].total, 0);
});

test('computeTotals sums numeric items and excludes text-cost items', () => {
  const invoice = normalizeInvoice({
    categories: [
      {
        name: 'Hardware',
        items: [
          { name: 'Register', qty: 2, unitPrice: 300 }, // 600, numeric
          { name: 'Subscription', costLabel: '$0-79/mo' }, // text cost, excluded
        ],
      },
    ],
    standaloneItems: [{ name: 'Setup', qty: 1, unitPrice: 400 }],
  });
  const totals = computeTotals(invoice);
  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.total, 1000);
});

test('computeTotals applies discount and tax on top of the numeric subtotal', () => {
  const invoice = normalizeInvoice({
    standaloneItems: [{ name: 'Build', qty: 1, unitPrice: 1000 }],
    totals: { discount: 100, discountLabel: 'Referral', tax: 50, taxLabel: 'Sales tax' },
  });
  assert.equal(invoice.totals.subtotal, 1000);
  assert.equal(invoice.totals.discount, 100);
  assert.equal(invoice.totals.tax, 50);
  assert.equal(invoice.totals.total, 950); // 1000 - 100 + 50
});

test('computeTotals passes deposit through unchanged and is pure (no mutation)', () => {
  const raw = { standaloneItems: [{ name: 'Build', qty: 1, unitPrice: 500 }], totals: { deposit: 250 } };
  const invoice = normalizeInvoice(raw);
  const before = JSON.stringify(invoice);
  const totals = computeTotals(invoice);
  assert.equal(totals.deposit, 250);
  assert.equal(JSON.stringify(invoice), before);
});

test('formatMoney formats USD currency', () => {
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney('not-a-number'), '$0.00');
});

test('invoiceNumberFor is deterministic for the same seed', () => {
  const a = invoiceNumberFor('client-42-Website Updates');
  const b = invoiceNumberFor('client-42-Website Updates');
  assert.equal(a, b);
  assert.match(a, /^INV-\d{4}-\d{4}-[A-Z0-9]{4}$/);
});

test('registry: default config orders every section and honors each defaultOn', () => {
  const config = defaultInvoiceSectionConfig();
  // Order always covers the whole registry — only visibility varies.
  assert.deepEqual(config.order.sections, INVOICE_SECTIONS.map((s) => s.id));
  for (const section of INVOICE_SECTIONS) {
    assert.equal(config.include[section.id], section.defaultOn !== false);
  }
});

// Pinned so an accidental flip of a `defaultOn` flag fails here rather than
// silently changing what every new invoice publishes. The card mirrors this
// list in DEFAULT_ON_SECTIONS (it cannot import the registry's server-side
// siblings) — change both together.
test('registry: the default-visible set covers a legitimate invoice', () => {
  assert.deepEqual(
    resolveInvoiceSections(defaultInvoiceSectionConfig()),
    ['cover', 'invoiceMeta', 'billTo', 'lineItems', 'totals', 'deposit', 'payment', 'contactFooter'],
  );
});

test('registry: normalizeInvoiceSectionConfig drops unknown ids and appends missing ones', () => {
  const normalized = normalizeInvoiceSectionConfig({
    include: { cover: true, bogus: true },
    order: { sections: ['totals', 'bogus', 'cover'] },
  });
  assert.ok(!('bogus' in normalized.include));
  assert.ok(!normalized.order.sections.includes('bogus'));
  assert.deepEqual(normalized.order.sections.slice(0, 2), ['totals', 'cover']);
  assert.equal(normalized.order.sections.length, INVOICE_SECTIONS.length);
});

test('resolveInvoiceSections returns ordered, enabled-only ids', () => {
  const ids = resolveInvoiceSections({
    include: { cover: true, billTo: false, totals: true },
    order: { sections: ['totals', 'cover', 'billTo'] },
  });
  assert.deepEqual(ids.slice(0, 2), ['totals', 'cover']);
  assert.ok(!ids.includes('billTo'));
});

test('renderInvoiceHtml starts with a doctype and is a complete document', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('</html>'));
});

test('renderInvoiceHtml section gating: disabled section is absent, enabled section is present', () => {
  const onHtml = renderInvoiceHtml(SAMPLE_INVOICE, {
    sections: { include: { billTo: true }, order: { sections: [] } },
  });
  const offHtml = renderInvoiceHtml(SAMPLE_INVOICE, {
    sections: { include: { billTo: false }, order: { sections: [] } },
  });
  assert.ok(onHtml.includes('id="invoice-bill-to-section"'));
  assert.ok(!offHtml.includes('id="invoice-bill-to-section"'));
});

test('renderInvoiceHtml honors configured section order', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE, {
    sections: {
      include: { totals: true, billTo: true, cover: false, invoiceMeta: false, projectSummary: false, lineItems: false, standaloneItems: false, deposit: false, recommendation: false, flow: false, terms: false, payment: false, notes: false, contactFooter: false },
      order: { sections: ['totals', 'billTo'] },
    },
  });
  const totalsIdx = html.indexOf('id="invoice-totals-panel"');
  const billToIdx = html.indexOf('id="invoice-bill-to-section"');
  assert.ok(totalsIdx > -1 && billToIdx > -1);
  assert.ok(totalsIdx < billToIdx);
});

test('renderInvoiceHtml skips a section with no data even when enabled (honest empty state)', () => {
  const invoice = normalizeInvoice({ projectTitle: 'Bare Invoice' }); // no billTo, no notes, no payment
  const html = renderInvoiceHtml(invoice);
  assert.ok(!html.includes('id="invoice-bill-to-section"'));
  assert.ok(!html.includes('id="invoice-notes-section"'));
  assert.ok(!html.includes('id="invoice-payment-section"'));
});

test('renderInvoiceHtml escapes hostile input', () => {
  const invoice = normalizeInvoice({
    projectTitle: '<script>alert(1)</script>',
    billTo: { name: '<img src=x onerror=alert(1)>' },
    notes: '"><script>evil()</script>',
  });
  const html = renderInvoiceHtml(invoice);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('<script>evil()</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderInvoiceHtml includes a Download PDF link only when pdfPath is supplied', () => {
  const withPdf = renderInvoiceHtml(SAMPLE_INVOICE, { pdfPath: '/api/invoices/foo.pdf', origin: 'https://hitloop.agency' });
  const withoutPdf = renderInvoiceHtml(SAMPLE_INVOICE);
  assert.ok(withPdf.includes('id="invoice-pdf-download-link"'));
  assert.ok(withPdf.includes('https://hitloop.agency/api/invoices/foo.pdf'));
  assert.ok(!withoutPdf.includes('id="invoice-pdf-download-link"'));
});

// Invoice Studio plan D2/D8/§4.4 regression guard — this is the gate that
// matters most: the published invoice and its PDF must not change by one
// byte now that render.js takes `brand`/`editable` options and imports
// BRIEF_CSS through the generated ESM mirror instead of createRequire().
//
// The comparison is against a frozen fixture rather than a live "before"
// call: features/invoices/ has no committed history to diff against (it was
// untracked when this lane started), so invoice-baseline-pre-studio.html was
// captured by running the exact pre-P1 render.js (unconditional HITLOOP
// marks, no createRequire replaced yet) against SAMPLE_INVOICE once, before
// any of this lane's edits landed. It should not need regenerating for a
// refactor — a diff here should mean the publish/PDF path changed. It WAS
// deliberately regenerated once since, for an owner-requested visual change:
// the cover's big headline now shows the document-kind label ("Invoice",
// "Quote", ...) instead of the hardcoded "HITLOOP" wordmark — see hero()'s
// own header comment in render.js. Any future intentional visual change
// should regenerate it the same way (render SAMPLE_INVOICE with
// `{ brand: HITLOOP_BRAND, editable: false }` and diff the two by eye before
// overwriting), never as a reflex to make a red test green.
test('renderInvoiceHtml is byte-identical with the HITLOOP brand and editable off', () => {
  const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/invoice-baseline-pre-studio.html'), 'utf8');
  const after = renderInvoiceHtml(SAMPLE_INVOICE, { brand: HITLOOP_BRAND, editable: false });
  assert.equal(after, baseline);
});

test('brand:null (and brand omitted) emits no logo, no signature, and no brand data URI', () => {
  const withNullBrand = renderInvoiceHtml(SAMPLE_INVOICE, { brand: null });
  const withNoBrandOption = renderInvoiceHtml(SAMPLE_INVOICE);
  for (const html of [withNullBrand, withNoBrandOption]) {
    assert.ok(!html.includes('id="invoice-brand-logo"'));
    assert.ok(!html.includes('id="invoice-brand-signature"'));
    // SAMPLE_INVOICE never sets payment.qr, so a data: URI in the output can
    // only be the HITLOOP logo/signature — assert none leaked in at all.
    assert.ok(!html.includes('data:image'));
  }
});

test('brand:HITLOOP_BRAND emits both marks with no other change', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { brand: HITLOOP_BRAND });
  assert.ok(html.includes('id="invoice-brand-logo"'));
  assert.ok(html.includes('id="invoice-brand-signature"'));
});

test('editable:true annotates known field/derived/section/row paths; editable off has none', () => {
  // standaloneItems/terms/recommendation/flow are defaultOn:false in the
  // registry — switch them on so every path family under test actually
  // renders (this is a markup-shape assertion, not a defaults regression
  // test — see 'registry: the default-visible set...' above for that).
  const sections = { include: { standaloneItems: true, terms: true, recommendation: true, flow: true } };
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { editable: true, sections });
  assert.ok(html.includes('data-inv-field="invoiceNumber"'));
  assert.ok(html.includes('data-inv-field="billTo.name"'));
  assert.ok(html.includes('data-inv-field="from.email"'));
  assert.ok(html.includes(`data-inv-field="categories[pos].items[square-restaurants].costLabel"`));
  assert.ok(html.includes(`data-inv-field="categories[pos].items[square-restaurants].subItems[0].name"`));
  assert.ok(html.includes(`data-inv-field="standaloneItems[design-setup].qty" data-inv-type="number" data-inv-raw="1"`));
  assert.ok(html.includes(`data-inv-derived="standaloneItems[design-setup].total"`));
  assert.ok(html.includes('data-inv-derived="totals.total"'));
  assert.ok(html.includes('data-inv-section="billTo"'));
  assert.ok(html.includes('data-inv-section="lineItems"'));
  assert.ok(html.includes(`data-inv-row="category:pos"`));
  assert.ok(html.includes(`data-inv-row="item:square-restaurants"`));
  assert.ok(html.includes('data-inv-row="terms:0"'));
  assert.ok(html.includes('data-inv-row="chips:0"'));
  assert.ok(html.includes('data-inv-row="flowSteps:0"'));

  const off = renderInvoiceHtml(SAMPLE_INVOICE);
  assert.ok(!off.includes('data-inv-'));
});

// D13 follow-up (plan owner-approved, round 1 — runtime option gating): the
// `brand` option alone didn't cover normalizeInvoice's automatic DEFAULT_FROM
// backfill — a public draft with a still-blank `from` would otherwise render
// Bryan Balli's real email/phone/address regardless of `brand`. This pins
// the fully-locked-down public render path: no owner identity, no wordmark,
// anywhere in the output. (defaultFrom omitted here is equivalent to `null`
// — see the next test — but both are asserted for clarity at the call site.)
test('defaultFrom:null + brand:null leaves no owner identity anywhere in the output', () => {
  const draftWithBlankFrom = { billTo: { name: 'Test Client' } }; // from omitted entirely
  const html = renderInvoiceHtml(draftWithBlankFrom, { defaultFrom: null, brand: null });
  for (const needle of ['bryanballi', '3122865129', 'Chicago', 'HITLOOP', 'Bryan-Balli']) {
    assert.ok(!html.includes(needle), `leaked owner identity string: ${needle}`);
  }
});

// D13 follow-up round 2 (bundle-inspection): round 1's runtime gating still
// left DEFAULT_FROM as a module-level const IN model.js, which the public
// client bundle imports — so the owner's real email/phone/address shipped
// as literal strings in that bundle regardless of any option, readable in
// devtools. Fix: DEFAULT_FROM moved to its own default-from.js module and
// model.js's default INVERTED — omitted (or null) now means NO backfill.
// This is the behavior change from the previous version of this test (which
// asserted the opposite: omitted meaning "backfill").
test('defaultFrom omitted (or null) no longer backfills DEFAULT_FROM — inverted default', () => {
  const withoutOption = renderInvoiceHtml({ billTo: { name: 'Test Client' } });
  const withNull = renderInvoiceHtml({ billTo: { name: 'Test Client' } }, { defaultFrom: null });
  for (const html of [withoutOption, withNull]) {
    assert.ok(!html.includes('bryanballi@gmail.com'));
    assert.ok(!html.includes('Chicago'));
  }
});

// Proves the explicit-pass path (what the server publish route and the
// admin Studio path both do) still produces today's fully-identified output
// — the inversion above only changes the DEFAULT, not what an explicit
// `defaultFrom: DEFAULT_FROM` does.
test('defaultFrom: DEFAULT_FROM (imported from default-from.js) backfills exactly as before', () => {
  const html = renderInvoiceHtml({ billTo: { name: 'Test Client' } }, { defaultFrom: DEFAULT_FROM });
  assert.ok(html.includes('bryanballi@gmail.com'));
  assert.ok(html.includes('Chicago'));
});

// D13 follow-up round 2 also moved payment-qr.js resolution out of render.js
// (a static `import { resolvePaymentQr } from './payment-qr.js'` put the
// Venmo QR data URI and @Bryan-Balli handle in the public bundle too,
// regardless of whether any invoice ever set payment.qr). The caller now
// resolves it and passes the result as options.paymentQr.
test('payment QR only renders when the caller resolves and passes options.paymentQr', () => {
  const invoice = normalizeInvoice(
    { payment: { qr: 'venmo', handle: '@Bryan-Balli' }, standaloneItems: [{ name: 'Work', qty: 1, unitPrice: 100 }] },
    { defaultFrom: null },
  );
  const withoutQr = renderInvoiceHtml(invoice, { brand: null });
  assert.ok(!withoutQr.includes('data:image'));
  assert.ok(!withoutQr.includes('id="invoice-payment-qr"'));

  const qr = resolvePaymentQr(invoice.payment.qr);
  const withQr = renderInvoiceHtml(invoice, { brand: null, paymentQr: qr });
  assert.ok(withQr.includes('id="invoice-payment-qr"'));
  assert.ok(withQr.includes(qr.dataUri));
});

// Fixture render for human review — not an assertion-heavy test, just keeps
// a reproducible sample HTML file on disk so the visual output can be
// eyeballed without re-running a throwaway script.
test('fixture: writes the sample invoice render for human review', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { clientId: 'its-raw-poke', brandLabel: "It's Raw Poke" });
  const outDir = path.resolve(__dirname, '../../../docs/plans/fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'invoice-sample.html'), html);
  assert.ok(html.startsWith('<!doctype html>'));
});
