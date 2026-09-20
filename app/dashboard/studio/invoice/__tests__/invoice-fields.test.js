import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_PATHS, getAtPath, setAtPath, parseValue, formatValue, fieldMeta,
  structureKey, renderedIndexToDraftIndex,
} from '../invoice-fields.js';

// A minimal-but-representative draft covering every path family in the
// §4.1 grammar: id-keyed rows (categories/items/standaloneItems),
// index-keyed rows (subItems/terms/chips/flowSteps), and plain nested
// scalars (from/billTo/totals/payment).
function sampleDraft() {
  return {
    invoiceNumber: 'INV-2026-0903-AB12',
    currency: 'USD',
    status: 'draft',
    issueDate: '2026-09-03',
    dueDate: '2026-09-17',
    paymentTerms: 'Net 14',
    poNumber: '',
    servicePeriod: { start: '', end: '' },
    projectTitle: 'Website Refresh',
    projectSubtitle: 'Phase 1',
    notes: 'Thanks!',
    from: { name: 'Studio Co', legalName: '', taxId: '', email: 'hello@studio.co', phone: '', site: '', address: '' },
    billTo: { name: 'Client Inc', contact: 'Jane', email: 'jane@client.co', address: '123 Main St' },
    categories: [
      {
        id: 'cat-1',
        name: 'Design',
        items: [
          {
            id: 'item-1', name: 'Homepage', note: '', qty: 2, unitPrice: 150, total: 300, costLabel: '',
            subItems: [{ name: 'Wireframes', cost: '$50' }, { name: '', cost: '' }, { name: 'Hi-fi', cost: '$100' }],
          },
        ],
      },
    ],
    standaloneItems: [
      { id: 'sa-1', name: 'Setup fee', note: '', qty: 1, unitPrice: 400, total: 400, costLabel: '', subItems: [] },
    ],
    totals: {
      subtotal: 700, discount: 0, discountLabel: '', tax: 0, taxLabel: '', total: 700,
      amountPaid: 0, deposit: 200, depositLabel: 'Payment due',
      monthlyLabel: 'Monthly Recurring', monthlyValue: '', oneTimeLabel: '1-Time Setup', oneTimeValue: '',
    },
    recommendation: { name: 'Growth', body: 'Best fit.', chips: ['', 'Fast', '  ', 'Reliable'] },
    flowSteps: [{ platform: '', color: '', label: '', tech: '' }, { platform: 'Shopify', color: '#000', label: 'Storefront', tech: 'Liquid' }],
    terms: ['', 'Net 14 from invoice date', '   ', '50% deposit required'],
    payment: { method: 'Wire', handle: '', instructions: 'Pay via wire.', link: 'https://pay.example.com', qr: '' },
  };
}

// ── getAtPath / setAtPath round trips — one per path family ─────────────

test('get/set round trip: top-level scalar', () => {
  const draft = sampleDraft();
  assert.equal(getAtPath(draft, 'invoiceNumber'), 'INV-2026-0903-AB12');
  const next = setAtPath(draft, 'invoiceNumber', 'INV-9999');
  assert.equal(getAtPath(next, 'invoiceNumber'), 'INV-9999');
  assert.equal(draft.invoiceNumber, 'INV-2026-0903-AB12'); // original untouched
});

test('get/set round trip: nested object scalar (from.email)', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'from.email', 'new@studio.co');
  assert.equal(getAtPath(next, 'from.email'), 'new@studio.co');
  assert.equal(getAtPath(next, 'from.name'), 'Studio Co'); // sibling field untouched
});

test('get/set round trip: nested object scalar (servicePeriod.start)', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'servicePeriod.start', '2026-09-01');
  assert.equal(getAtPath(next, 'servicePeriod.start'), '2026-09-01');
  assert.equal(getAtPath(next, 'servicePeriod.end'), '');
});

test('get/set round trip: id-keyed row (categories[<id>].name)', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'categories[cat-1].name', 'Design & Dev');
  assert.equal(getAtPath(next, 'categories[cat-1].name'), 'Design & Dev');
});

test('get/set round trip: id-keyed nested row (categories[<id>].items[<id>].qty)', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'categories[cat-1].items[item-1].qty', 5);
  assert.equal(getAtPath(next, 'categories[cat-1].items[item-1].qty'), 5);
  assert.equal(getAtPath(next, 'categories[cat-1].items[item-1].name'), 'Homepage');
});

test('get/set round trip: index-keyed row nested under an id-keyed row (subItems[<i>].name)', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'categories[cat-1].items[item-1].subItems[2].name', 'Hi-fi mockups');
  assert.equal(getAtPath(next, 'categories[cat-1].items[item-1].subItems[2].name'), 'Hi-fi mockups');
  // untouched sibling sub-item keeps its value
  assert.equal(getAtPath(next, 'categories[cat-1].items[item-1].subItems[0].name'), 'Wireframes');
});

test('get/set round trip: standaloneItems by id (…same as items)', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'standaloneItems[sa-1].unitPrice', 500);
  assert.equal(getAtPath(next, 'standaloneItems[sa-1].unitPrice'), 500);
});

test('get/set round trip: totals.*', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'totals.discount', 50);
  assert.equal(getAtPath(next, 'totals.discount'), 50);
  assert.equal(getAtPath(next, 'totals.subtotal'), 700); // sibling untouched
});

test('get/set round trip: recommendation.{name,body} and chips[<i>]', () => {
  const draft = sampleDraft();
  let next = setAtPath(draft, 'recommendation.name', 'Scale');
  next = setAtPath(next, 'recommendation.chips[1]', 'Very fast');
  assert.equal(getAtPath(next, 'recommendation.name'), 'Scale');
  assert.equal(getAtPath(next, 'recommendation.chips[1]'), 'Very fast');
  assert.equal(getAtPath(next, 'recommendation.chips[3]'), 'Reliable'); // untouched
});

test('get/set round trip: flowSteps[<i>].*', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'flowSteps[1].tech', 'Hydrogen');
  assert.equal(getAtPath(next, 'flowSteps[1].tech'), 'Hydrogen');
  assert.equal(getAtPath(next, 'flowSteps[1].platform'), 'Shopify');
});

test('get/set round trip: terms[<i>]', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'terms[1]', 'Net 30 from invoice date');
  assert.equal(getAtPath(next, 'terms[1]'), 'Net 30 from invoice date');
});

test('get/set round trip: payment.*', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'payment.method', 'Venmo');
  assert.equal(getAtPath(next, 'payment.method'), 'Venmo');
  assert.equal(getAtPath(next, 'payment.link'), 'https://pay.example.com');
});

test('setAtPath is immutable with structural sharing — untouched branches keep their reference', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'categories[cat-1].items[item-1].name', 'Homepage v2');
  assert.notEqual(next, draft);
  assert.notEqual(next.categories, draft.categories);
  // Untouched top-level fields keep their original reference.
  assert.equal(next.totals, draft.totals);
  assert.equal(next.standaloneItems, draft.standaloneItems);
  assert.equal(next.payment, draft.payment);
});

test('getAtPath returns undefined for an id that no longer exists (removed row)', () => {
  const draft = sampleDraft();
  assert.equal(getAtPath(draft, 'categories[cat-999].name'), undefined);
  assert.equal(getAtPath(draft, 'categories[cat-1].items[item-999].qty'), undefined);
});

test('setAtPath on a resolved-away path is a safe no-op (returns the same draft)', () => {
  const draft = sampleDraft();
  const next = setAtPath(draft, 'categories[cat-999].name', 'Ghost');
  assert.equal(next, draft);
});

// ── money round trip (explicitly required by the P0 handoff) ────────────

test('money round trip: "$1,234.50" -> 1234.5 -> "$1,234.50"', () => {
  const parsed = parseValue('money', '$1,234.50');
  assert.equal(parsed, 1234.5);
  const formatted = formatValue('money', parsed, 'USD');
  assert.equal(formatted, '$1,234.50');
});

test('money parse strips stray whitespace/commas from pasted currency text', () => {
  assert.equal(parseValue('money', ' $ 2,000.00 '), 2000);
  assert.equal(parseValue('money', '0'), 0);
  assert.equal(parseValue('money', ''), 0);
});

test('number parse/format round trip', () => {
  assert.equal(parseValue('number', '5'), 5);
  assert.equal(formatValue('number', 5), '5');
});

// Design-layer plan §3.1 — formatValue's 4th argument (locale) is optional
// and defaults to 'en-US', so every existing 2/3-arg rail-card call site
// keeps its current output.
test('formatValue locale is optional; a resolved locale visibly changes money/date formatting', () => {
  assert.equal(formatValue('money', 1234.5, 'USD'), '$1,234.50');
  assert.notEqual(formatValue('money', 1234.5, 'EUR', 'de-DE'), formatValue('money', 1234.5, 'EUR', 'en-US'));
  assert.equal(formatValue('date', '2026-09-02'), formatValue('date', '2026-09-02', 'USD', 'en-US'));
  assert.notEqual(formatValue('date', '2026-09-02', 'USD', 'de-DE'), formatValue('date', '2026-09-02', 'USD', 'en-US'));
});

// ── renderedIndexToDraftIndex — holes in all four filtered arrays ───────
// Mirrors features/invoices/model.js's row-dropping filters: terms/chips
// via normalizeList (non-empty trimmed string survives), flowSteps
// (platform || label survives), subItems (name survives).

test('renderedIndexToDraftIndex: terms with holes (blank/whitespace-only rows dropped)', () => {
  const draft = sampleDraft();
  // draft.terms = ['', 'Net 14 from invoice date', '   ', '50% deposit required']
  // rendered survivors, in draft-index order: 1, 3
  assert.equal(renderedIndexToDraftIndex('terms', draft.terms, 0), 1);
  assert.equal(renderedIndexToDraftIndex('terms', draft.terms, 1), 3);
  assert.equal(renderedIndexToDraftIndex('terms', draft.terms, 2), -1); // no third survivor
});

test('renderedIndexToDraftIndex: chips with holes', () => {
  const draft = sampleDraft();
  // draft.recommendation.chips = ['', 'Fast', '  ', 'Reliable']
  assert.equal(renderedIndexToDraftIndex('chips', draft.recommendation.chips, 0), 1);
  assert.equal(renderedIndexToDraftIndex('chips', draft.recommendation.chips, 1), 3);
});

test('renderedIndexToDraftIndex: flowSteps with a fully-empty row dropped', () => {
  const draft = sampleDraft();
  // draft.flowSteps = [{empty}, {platform:'Shopify',...}] — only index 1 survives
  assert.equal(renderedIndexToDraftIndex('flowSteps', draft.flowSteps, 0), 1);
  assert.equal(renderedIndexToDraftIndex('flowSteps', draft.flowSteps, 1), -1);
});

test('renderedIndexToDraftIndex: subItems with an unnamed row dropped', () => {
  const draft = sampleDraft();
  const subItems = draft.categories[0].items[0].subItems; // [Wireframes, {blank}, Hi-fi]
  assert.equal(renderedIndexToDraftIndex('subItems', subItems, 0), 0);
  assert.equal(renderedIndexToDraftIndex('subItems', subItems, 1), 2);
  assert.equal(renderedIndexToDraftIndex('subItems', subItems, 2), -1);
});

test('renderedIndexToDraftIndex: unknown kind or negative index returns -1', () => {
  const draft = sampleDraft();
  assert.equal(renderedIndexToDraftIndex('bogus', draft.terms, 0), -1);
  assert.equal(renderedIndexToDraftIndex('terms', draft.terms, -1), -1);
});

// ── fieldMeta / FIELD_PATHS ───────────────────────────────────────────────

test('fieldMeta resolves a real (id-bearing) path to its template entry', () => {
  const meta = fieldMeta('categories[cat-1].items[item-1].qty');
  assert.deepEqual(meta, { type: 'number', section: 'lineItems', editable: true, label: 'Qty' });
});

test('fieldMeta resolves an index-keyed real path to its template entry', () => {
  const meta = fieldMeta('recommendation.chips[3]');
  assert.equal(meta.type, 'text');
  assert.equal(meta.section, 'recommendation');
  assert.equal(meta.editable, true);
});

test('fieldMeta returns undefined for a path outside the public editable grammar (payment.qr/handle)', () => {
  assert.equal(fieldMeta('payment.qr'), undefined);
  assert.equal(fieldMeta('payment.handle'), undefined);
});

test('FIELD_PATHS covers every path family named in the §4.1 grammar', () => {
  const paths = FIELD_PATHS.map((e) => e.path);
  for (const expected of [
    'labels.title',
    'invoiceNumber', 'currency', 'status', 'issueDate', 'dueDate', 'paymentTerms', 'poNumber',
    'servicePeriod.start', 'servicePeriod.end', 'projectTitle', 'projectSubtitle', 'notes',
    'from.name', 'from.legalName', 'from.taxId', 'from.email', 'from.phone', 'from.site', 'from.address',
    'billTo.name', 'billTo.contact', 'billTo.email', 'billTo.address',
    'categories[].name', 'categories[].items[].name', 'categories[].items[].note',
    'categories[].items[].qty', 'categories[].items[].unitPrice', 'categories[].items[].costLabel',
    'categories[].items[].subItems[].name', 'categories[].items[].subItems[].cost',
    'standaloneItems[].name', 'standaloneItems[].note', 'standaloneItems[].qty',
    'standaloneItems[].unitPrice', 'standaloneItems[].costLabel',
    'standaloneItems[].subItems[].name', 'standaloneItems[].subItems[].cost',
    'totals.subtotal', 'totals.discount', 'totals.discountLabel', 'totals.tax', 'totals.taxLabel',
    'totals.total', 'totals.deposit', 'totals.depositLabel', 'totals.amountPaid',
    'totals.monthlyLabel', 'totals.monthlyValue', 'totals.oneTimeLabel', 'totals.oneTimeValue',
    'recommendation.name', 'recommendation.body', 'recommendation.chips[]',
    'flowSteps[].platform', 'flowSteps[].color', 'flowSteps[].label', 'flowSteps[].tech',
    'terms[]', 'payment.method', 'payment.instructions', 'payment.link',
  ]) {
    assert.ok(paths.includes(expected), `FIELD_PATHS missing "${expected}"`);
  }
  assert.equal(paths.length, 63);
  assert.ok(FIELD_PATHS.every((e) => e.editable === true));
});

// ── structureKey ──────────────────────────────────────────────────────────

test('structureKey is stable for the same structure and changes only on structural edits', () => {
  const draft = sampleDraft();
  const sections = { include: { cover: true, lineItems: true }, order: ['cover', 'lineItems'] };
  const keyA = structureKey(draft, sections);
  const keyB = structureKey(sampleDraft(), sections); // fresh equal-shape draft
  assert.equal(keyA, keyB);

  // A pure text edit (no row added/removed, no toggle/reorder) — key unchanged.
  const textEdited = setAtPath(draft, 'categories[cat-1].items[item-1].name', 'New name');
  assert.equal(structureKey(textEdited, sections), keyA);

  // Adding a category changes the key.
  const withNewCategory = { ...draft, categories: [...draft.categories, { id: 'cat-2', name: '', items: [] }] };
  assert.notEqual(structureKey(withNewCategory, sections), keyA);

  // A section include toggle changes the key.
  const toggled = { include: { ...sections.include, lineItems: false }, order: sections.order };
  assert.notEqual(structureKey(draft, toggled), keyA);

  // A term COUNT change (add/remove) changes the key even though terms have no ids.
  const withExtraTerm = { ...draft, terms: [...draft.terms, 'New term'] };
  assert.notEqual(structureKey(withExtraTerm, sections), keyA);
});

// Design-layer plan L7 — theme is an optional 3rd argument, and structureKey
// covers docKind/labels/locale/logo presence + theme id/paper/margins on top
// of everything above.
test('structureKey(draft, sections) with theme omitted keeps the 2-arg contract', () => {
  const draft = sampleDraft();
  const sections = { include: { cover: true }, order: ['cover'] };
  assert.equal(structureKey(draft, sections), structureKey(draft, sections, null));
});

test('structureKey changes when docKind, labels, locale, or logo presence changes, not on value-only edits within them', () => {
  const draft = { ...sampleDraft(), docKind: 'invoice', labels: {}, locale: 'en-US', logoDataUrl: null };
  const sections = { include: { cover: true }, order: ['cover'] };
  const keyA = structureKey(draft, sections);

  assert.notEqual(structureKey({ ...draft, docKind: 'quote' }, sections), keyA);
  assert.notEqual(structureKey({ ...draft, labels: { billToLabel: 'Ship to' } }, sections), keyA);
  assert.notEqual(structureKey({ ...draft, locale: 'de-DE' }, sections), keyA);
  assert.notEqual(structureKey({ ...draft, logoDataUrl: 'data:image/png;base64,aGk=' }, sections), keyA);

  // Fresh equal-shape draft with the same fields -> same key (stability, not
  // just "differs from A" — mirrors the sibling test above).
  const keyB = structureKey({ ...sampleDraft(), docKind: 'invoice', labels: {}, locale: 'en-US', logoDataUrl: null }, sections);
  assert.equal(keyA, keyB);
});

test('structureKey changes when the theme id/paper/margins changes but not on color-only differences', () => {
  const draft = sampleDraft();
  const sections = { include: { cover: true }, order: ['cover'] };
  const ledger = { id: 'ledger', paper: 'letter', margins: 'normal', colors: { paper: '#f7f5ef' } };
  const keyNoTheme = structureKey(draft, sections, null);
  const keyLedger = structureKey(draft, sections, ledger);
  assert.notEqual(keyNoTheme, keyLedger);

  // Same id/paper/margins, different colors -> same key (colors are a value
  // patch via the theme <style> block, never a structural re-render).
  const ledgerRecolored = { ...ledger, colors: { paper: '#ffffff' } };
  assert.equal(structureKey(draft, sections, ledger), structureKey(draft, sections, ledgerRecolored));
});
