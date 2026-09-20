// Pure invoice data model: normalize arbitrary/partial input into a
// complete invoice shape, compute totals, format money, and mint invoice
// numbers. No I/O, no framework deps — mirrors the money()/normalizeList()
// idioms in features/leadgen/estimate-generator.js so the two renderers stay
// consistent, but the shape supports the "It's Raw Poke" category -> item ->
// sub-item grammar (see clients/BRIEF_TEMPLATE_PROMPT.md) on top of plain
// numeric line items.

const STATUSES = ['draft', 'sent', 'paid'];

// ── Document kind + editable labels (Invoice Studio design-layer plan L5,
// §3.1). A document's terminology (what the header says, what the "billed
// by" fact is called, etc.) depends on WHAT the document is — an estimate
// says "Valid until", not "Due" — before any operator override is applied.
// DOC_KIND_LABELS is the single source of those per-kind defaults; the
// 'invoice' entry's values are pinned to what render.js already hardcodes
// today so a docKind-absent invoice with no labels override renders
// byte-identical output once a later lane wires resolveInvoiceLabels() into
// the renderer (this file does not read/write render.js — see the Invoice
// Studio design-layer handoff's Q0/Q2 lane split).
export const DOC_KINDS = ['invoice', 'quote', 'estimate', 'receipt', 'creditNote'];

export const INVOICE_LABEL_KEYS = [
  'title', 'numberLabel', 'invoiceDetails', 'statusLabel', 'issueLabel', 'dueLabel',
  'paymentTermsLabel', 'poNumberLabel', 'servicePeriodLabel', 'currencyLabel',
  'billedByLabel', 'tradingAsLabel', 'addressLabel', 'emailLabel', 'phoneLabel',
  'siteLabel', 'taxIdLabel', 'billToLabel', 'clientLabel', 'contactLabel',
  'summaryLabel', 'categoriesLabel', 'lineItemsLabel', 'taskLabel', 'hoursLabel',
  'rateLabel', 'amountLabel', 'additionalItemsLabel', 'totalsLabel', 'subtotalLabel',
  'discountLabel', 'taxLabel', 'totalLabel', 'amountPaidLabel', 'balanceLabel',
  'paymentDueLabel', 'recommendationLabel', 'flowLabel', 'termsLabel', 'paymentLabel',
  'notesLabel',
];

// Every value below is real, printable terminology — not a placeholder —
// since this file is the ONLY place a later lane may source per-docKind
// defaults from (design-layer plan L16: "hardcoded document-kind
// terminology must not become a second source of truth").
export const DOC_KIND_LABELS = {
  // Pinned to today's hardcoded strings throughout render.js — see that
  // file's block()/fact()/stat() call sites this mirrors.
  invoice: {
    title: 'Invoice', numberLabel: 'Invoice #', invoiceDetails: 'Invoice details',
    statusLabel: 'Status', issueLabel: 'Issued', dueLabel: 'Due',
    paymentTermsLabel: 'Terms', poNumberLabel: 'PO number', servicePeriodLabel: 'Service period',
    currencyLabel: 'Currency', billedByLabel: 'Billed by', tradingAsLabel: 'Trading as',
    addressLabel: 'Address', emailLabel: 'Email', phoneLabel: 'Phone', siteLabel: 'Site',
    taxIdLabel: 'Tax ID', billToLabel: 'Bill to', clientLabel: 'Client', contactLabel: 'Contact',
    summaryLabel: 'Summary', categoriesLabel: 'Categories', lineItemsLabel: 'Line items',
    taskLabel: 'Task', hoursLabel: 'Hours', rateLabel: 'Rate', amountLabel: 'Amount',
    additionalItemsLabel: 'Additional items', totalsLabel: 'Totals', subtotalLabel: 'Subtotal',
    discountLabel: 'Discount', taxLabel: 'Tax', totalLabel: 'Total', amountPaidLabel: 'Amount paid',
    balanceLabel: 'Balance due', paymentDueLabel: 'Payment due', recommendationLabel: 'Recommendation',
    flowLabel: 'How it works', termsLabel: 'Terms', paymentLabel: 'Payment', notesLabel: 'Notes',
  },
  quote: {
    title: 'Quote', numberLabel: 'Quote #', invoiceDetails: 'Quote details',
    statusLabel: 'Status', issueLabel: 'Issued', dueLabel: 'Valid until',
    paymentTermsLabel: 'Terms', poNumberLabel: 'Reference #', servicePeriodLabel: 'Project period',
    currencyLabel: 'Currency', billedByLabel: 'Prepared by', tradingAsLabel: 'Trading as',
    addressLabel: 'Address', emailLabel: 'Email', phoneLabel: 'Phone', siteLabel: 'Site',
    taxIdLabel: 'Tax ID', billToLabel: 'Quote for', clientLabel: 'Client', contactLabel: 'Contact',
    summaryLabel: 'Summary', categoriesLabel: 'Categories', lineItemsLabel: 'Line items',
    taskLabel: 'Task', hoursLabel: 'Hours', rateLabel: 'Rate', amountLabel: 'Amount',
    additionalItemsLabel: 'Additional items', totalsLabel: 'Estimated totals', subtotalLabel: 'Subtotal',
    discountLabel: 'Discount', taxLabel: 'Tax', totalLabel: 'Estimated total', amountPaidLabel: 'Amount paid',
    balanceLabel: 'Balance', paymentDueLabel: 'Deposit to proceed', recommendationLabel: 'Recommendation',
    flowLabel: 'How it works', termsLabel: 'Terms', paymentLabel: 'Payment', notesLabel: 'Notes',
  },
  estimate: {
    title: 'Estimate', numberLabel: 'Estimate #', invoiceDetails: 'Estimate details',
    statusLabel: 'Status', issueLabel: 'Issued', dueLabel: 'Valid until',
    paymentTermsLabel: 'Terms', poNumberLabel: 'Reference #', servicePeriodLabel: 'Project period',
    currencyLabel: 'Currency', billedByLabel: 'Prepared by', tradingAsLabel: 'Trading as',
    addressLabel: 'Address', emailLabel: 'Email', phoneLabel: 'Phone', siteLabel: 'Site',
    taxIdLabel: 'Tax ID', billToLabel: 'Estimate for', clientLabel: 'Client', contactLabel: 'Contact',
    summaryLabel: 'Summary', categoriesLabel: 'Categories', lineItemsLabel: 'Line items',
    taskLabel: 'Task', hoursLabel: 'Hours', rateLabel: 'Rate', amountLabel: 'Amount',
    additionalItemsLabel: 'Additional items', totalsLabel: 'Estimated totals', subtotalLabel: 'Subtotal',
    discountLabel: 'Discount', taxLabel: 'Tax', totalLabel: 'Estimated total', amountPaidLabel: 'Amount paid',
    balanceLabel: 'Balance', paymentDueLabel: 'Deposit to proceed', recommendationLabel: 'Recommendation',
    flowLabel: 'How it works', termsLabel: 'Terms', paymentLabel: 'Payment', notesLabel: 'Notes',
  },
  receipt: {
    title: 'Receipt', numberLabel: 'Receipt #', invoiceDetails: 'Receipt details',
    statusLabel: 'Status', issueLabel: 'Paid on', dueLabel: 'Due',
    paymentTermsLabel: 'Terms', poNumberLabel: 'Reference #', servicePeriodLabel: 'Service period',
    currencyLabel: 'Currency', billedByLabel: 'Received by', tradingAsLabel: 'Trading as',
    addressLabel: 'Address', emailLabel: 'Email', phoneLabel: 'Phone', siteLabel: 'Site',
    taxIdLabel: 'Tax ID', billToLabel: 'Received from', clientLabel: 'Client', contactLabel: 'Contact',
    summaryLabel: 'Summary', categoriesLabel: 'Categories', lineItemsLabel: 'Line items',
    taskLabel: 'Item', hoursLabel: 'Qty', rateLabel: 'Rate', amountLabel: 'Amount',
    additionalItemsLabel: 'Additional items', totalsLabel: 'Totals', subtotalLabel: 'Subtotal',
    discountLabel: 'Discount', taxLabel: 'Tax', totalLabel: 'Total paid', amountPaidLabel: 'Amount paid',
    balanceLabel: 'Balance', paymentDueLabel: 'Amount paid', recommendationLabel: 'Recommendation',
    flowLabel: 'How it works', termsLabel: 'Terms', paymentLabel: 'Payment method', notesLabel: 'Notes',
  },
  creditNote: {
    title: 'Credit Note', numberLabel: 'Credit note #', invoiceDetails: 'Credit note details',
    statusLabel: 'Status', issueLabel: 'Issued', dueLabel: 'Due',
    paymentTermsLabel: 'Terms', poNumberLabel: 'Reference #', servicePeriodLabel: 'Service period',
    currencyLabel: 'Currency', billedByLabel: 'Issued by', tradingAsLabel: 'Trading as',
    addressLabel: 'Address', emailLabel: 'Email', phoneLabel: 'Phone', siteLabel: 'Site',
    taxIdLabel: 'Tax ID', billToLabel: 'Credited to', clientLabel: 'Client', contactLabel: 'Contact',
    summaryLabel: 'Summary', categoriesLabel: 'Categories', lineItemsLabel: 'Line items',
    taskLabel: 'Item', hoursLabel: 'Qty', rateLabel: 'Rate', amountLabel: 'Amount',
    additionalItemsLabel: 'Additional items', totalsLabel: 'Totals', subtotalLabel: 'Subtotal',
    discountLabel: 'Discount', taxLabel: 'Tax', totalLabel: 'Total credit', amountPaidLabel: 'Amount refunded',
    balanceLabel: 'Balance', paymentDueLabel: 'Credit due', recommendationLabel: 'Recommendation',
    flowLabel: 'How it works', termsLabel: 'Terms', paymentLabel: 'Refund method', notesLabel: 'Notes',
  },
};

// Document-kind defaults resolve first; explicit invoice.labels[key]
// overrides second (design-layer plan L16/§3.1) — empty/invalid override
// values fall back to the docKind default rather than printing blank.
export function resolveInvoiceLabels(invoice) {
  const docKind = DOC_KIND_LABELS[invoice?.docKind] ? invoice.docKind : 'invoice';
  const defaults = DOC_KIND_LABELS[docKind];
  const overrides = invoice?.labels && typeof invoice.labels === 'object' ? invoice.labels : {};
  const resolved = { ...defaults };
  for (const key of INVOICE_LABEL_KEYS) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim()) resolved[key] = value.trim();
  }
  return resolved;
}

// The ONE Deposit-heading resolver, shared by render.js's buildDeposit() and
// the rail's DepositCard so they can never disagree. computeTotals() always
// backfills totals.depositLabel with the literal 'Payment due' when unset,
// so that exact string is treated as "not actually customized" and the
// doc-kind-resolved paymentDueLabel wins instead; anything else typed is a
// genuine per-invoice override and always wins.
export function resolveDepositHeading(invoice) {
  const totals = invoice?.totals || {};
  const override = totals.depositLabel && totals.depositLabel !== 'Payment due' ? totals.depositLabel : '';
  return override || resolveInvoiceLabels(invoice).paymentDueLabel || 'Payment due';
}

function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

// Integer-cent-safe rounding, same approach as estimate-generator's money().
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeList(input) {
  const raw = Array.isArray(input) ? input : (input ? String(input).split(/\n+/) : []);
  return raw.map((item) => cleanString(item)).filter(Boolean);
}

// ISO date (YYYY-MM-DD) or null when unparseable/absent — never throws.
function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSubItems(input) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row) => ({
      name: cleanString(row?.name ?? row?.label),
      cost: cleanString(row?.cost ?? row?.costLabel ?? (row?.value != null ? String(row.value) : '')),
    }))
    .filter((row) => row.name);
}

// An item is either numerically priced (qty x unitPrice -> total) or
// free-text priced (costLabel, e.g. "$0-79/mo", "Included"). A text cost
// never contributes to numeric totals — computeTotals() relies on that.
function normalizeItem(raw, index, prefix) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = cleanString(source.id, `${prefix}-${index + 1}`);
  const name = cleanString(source.name ?? source.label, `Item ${index + 1}`);
  const note = cleanString(source.note ?? source.description);
  const costLabel = cleanString(source.costLabel);
  const isTextCost = costLabel.length > 0;
  const qty = isTextCost ? null : (money(source.qty ?? 1) || 1);
  const unitPrice = isTextCost ? 0 : money(source.unitPrice ?? source.total ?? 0);
  const total = isTextCost ? 0 : money(qty * unitPrice);
  return { id, name, note, qty, unitPrice, total, costLabel, subItems: normalizeSubItems(source.subItems) };
}

function normalizeCategory(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = cleanString(source.id, `category-${index + 1}`);
  const items = Array.isArray(source.items)
    ? source.items.map((item, i) => normalizeItem(item, i, `${id}-item`))
    : [];
  // No "Category N" fallback: an unnamed group renders with no label rather
  // than a placeholder the reader has to decode.
  return { id, name: cleanString(source.name ?? source.label), items };
}

function normalizeParty(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    name: cleanString(source.name),
    legalName: cleanString(source.legalName),
    taxId: cleanString(source.taxId),
    email: cleanString(source.email),
    phone: cleanString(source.phone),
    site: cleanString(source.site),
    address: cleanString(source.address),
  };
}

// Per-field fallback, not an all-or-nothing default: an invoice that sets only
// `from.name` keeps that name and still gets the standing email/phone/address.
// `fallback` is the identity blanks backfill from. Invoice Studio plan D13:
// a public render must never surface the owner's real email/phone/address
// just because a visitor hasn't typed their own yet, so callers that opt out
// (fallback: null, see normalizeInvoice's `defaultFrom` option) get blank
// fields left honestly blank instead of silently becoming Bryan Balli's.
function normalizeFromParty(raw, fallback) {
  const party = normalizeParty(raw);
  const base = fallback || {};
  return {
    name: party.name || base.name || '',
    legalName: party.legalName || base.legalName || '',
    taxId: party.taxId || base.taxId || '',
    email: party.email || base.email || '',
    phone: party.phone || base.phone || '',
    site: party.site || base.site || '',
    address: party.address || base.address || '',
  };
}

function normalizeServicePeriod(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    start: normalizeDate(source.start) || '',
    end: normalizeDate(source.end) || '',
  };
}

function normalizeBillTo(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    name: cleanString(source.name),
    contact: cleanString(source.contact),
    email: cleanString(source.email),
    address: cleanString(source.address),
  };
}

function normalizeRecommendation(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    name: cleanString(source.name),
    body: cleanString(source.body),
    chips: normalizeList(source.chips),
  };
}

function normalizeFlowSteps(input) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row) => ({
      platform: cleanString(row?.platform),
      color: cleanString(row?.color),
      label: cleanString(row?.label),
      tech: cleanString(row?.tech),
    }))
    .filter((row) => row.platform || row.label);
}

function normalizePayment(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    method: cleanString(source.method),
    handle: cleanString(source.handle),
    instructions: cleanString(source.instructions),
    link: cleanString(source.link),
    // Key into features/invoices/payment-qr.js — the renderer resolves it to an
    // embedded image, so the invoice JSON stays readable instead of carrying a
    // 15KB data URI around.
    qr: cleanString(source.qr),
  };
}

function normalizeDocKind(value) {
  return DOC_KINDS.includes(value) ? value : 'invoice';
}

// Allow-listed string map — unknown keys dropped, blank/non-string values
// dropped (resolveInvoiceLabels() already treats "absent" as "use the
// docKind default", so there is no reason to persist an empty override).
function normalizeLabels(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const labels = {};
  for (const key of INVOICE_LABEL_KEYS) {
    const value = cleanString(source[key]);
    if (value) labels[key] = value;
  }
  return labels;
}

// A light shape check (xx or xx-XX), not a full BCP-47/CLDR validation —
// Intl.NumberFormat/DateTimeFormat throw on a truly invalid tag, and every
// caller that formats with it already catches that (formatMoney below).
const LOCALE_RE = /^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,7})*$/;
export function normalizeLocale(value) {
  const text = cleanString(value);
  return text && LOCALE_RE.test(text) ? text : 'en-US';
}

// Grammar per Invoice Studio design-layer plan §3.5: {YYYY}, {YY}, {MM}, and
// {seq:N} (N 1-6) only. This is a SHAPE check so a corrupted/hand-edited
// persisted invoice can never poison the model layer with a token the
// numbering generator (Invoice Studio plan Lane B's invoice/identity/*)
// doesn't understand — the richer duplicate-detection/generation logic lives
// there, not here.
// Exported (Invoice Studio design-layer plan Q2, Lane B) so the numbering UI
// can validate-as-you-type against the EXACT same grammar this normalizer
// enforces, rather than duplicating the regex and risking drift.
export const NUMBER_PATTERN_TOKEN_RE = /\{(YYYY|YY|MM|seq:[1-6])\}/g;
export const DEFAULT_NUMBER_PATTERN = 'INV-{YYYY}-{seq:3}';
export function normalizeNumberPattern(value) {
  const text = cleanString(value);
  if (!text) return DEFAULT_NUMBER_PATTERN;
  const stripped = text.replace(NUMBER_PATTERN_TOKEN_RE, '');
  // Any leftover '{'/'}' means a token this grammar doesn't recognize.
  return /[{}]/.test(stripped) ? DEFAULT_NUMBER_PATTERN : text;
}

const LOGO_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/;
function normalizeLogoDataUrl(value) {
  const text = String(value ?? '');
  return LOGO_DATA_URL_RE.test(text) ? text : null;
}

function normalizeMeta(raw, context) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    preparedBy: cleanString(source.preparedBy, cleanString(context?.preparedBy)),
    generatedAt: normalizeDate(source.generatedAt)
      ? new Date(source.generatedAt).toISOString()
      : new Date().toISOString(),
  };
}

function allNumericItems(invoice) {
  const categories = Array.isArray(invoice?.categories) ? invoice.categories : [];
  const standaloneItems = Array.isArray(invoice?.standaloneItems) ? invoice.standaloneItems : [];
  return [
    ...categories.flatMap((cat) => (Array.isArray(cat?.items) ? cat.items : [])),
    ...standaloneItems,
  ];
}

// subtotal = sum of numerically-priced items only (text-cost items opt out
// of the math by design). total = subtotal - discount + tax. deposit and
// the free-text monthly/one-time display values pass through unchanged.
// Pure: reads invoice, never mutates it.
export function computeTotals(invoice) {
  const items = allNumericItems(invoice);
  const subtotal = money(items.reduce((sum, item) => sum + (item?.costLabel ? 0 : money(item?.total ?? 0)), 0));
  const prior = invoice?.totals && typeof invoice.totals === 'object' ? invoice.totals : {};
  const discount = money(prior.discount ?? 0);
  const tax = money(prior.tax ?? 0);
  const total = money(subtotal - discount + tax);
  const currency = cleanString(invoice?.currency, 'USD');
  // A deposit that has been RECEIVED is a payment, not a request. Keeping it
  // separate from `deposit` is what lets the document say "total 1500, paid
  // 750, balance 750" honestly instead of restating the same figure twice.
  const amountPaid = money(prior.amountPaid ?? 0);
  return {
    subtotal,
    discount,
    discountLabel: cleanString(prior.discountLabel),
    tax,
    taxLabel: cleanString(prior.taxLabel),
    total,
    amountPaid,
    balanceDue: money(total - amountPaid),
    deposit: money(prior.deposit ?? 0),
    depositLabel: cleanString(prior.depositLabel, 'Payment due'),
    monthlyLabel: cleanString(prior.monthlyLabel, 'Monthly Recurring'),
    monthlyValue: cleanString(prior.monthlyValue),
    oneTimeLabel: cleanString(prior.oneTimeLabel, '1-Time Setup'),
    // A plain numeric invoice (no hand-written range string) still gets an
    // honest one-time figure instead of a blank field.
    oneTimeValue: cleanString(prior.oneTimeValue) || (total > 0 ? formatMoney(total, currency) : ''),
  };
}

// `locale` defaults to 'en-US' so every existing 1/2-arg call site (there
// are many — render.js, invoice-fields.js, this file's own computeTotals)
// keeps producing today's exact output; a caller that resolves a non-default
// invoice.locale (Invoice Studio design-layer plan §3.1) passes it as the
// 3rd argument.
export function formatMoney(value, currency = 'USD', locale = 'en-US') {
  const amount = money(value);
  try {
    return new Intl.NumberFormat(locale || 'en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

// Deterministic (same seed -> same suffix) but not wall-clock-independent —
// the date portion reflects real generation time, the suffix is a hash of
// the seed so repeat calls with the same seed produce the same number.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function invoiceNumberFor(seed) {
  const base = seed != null && String(seed).trim() ? String(seed) : `${Date.now()}-${Math.random()}`;
  const now = new Date();
  const year = now.getFullYear();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const suffix = hashString(base).toString(36).toUpperCase().padStart(4, '0').slice(0, 4);
  return `INV-${year}-${mmdd}-${suffix}`;
}

// Total-safe: never throws on partial/garbage input, fills every field with
// a sane default, and computes totals last (from the already-normalized
// categories/standaloneItems) so computeTotals() sees clean data.
//
// context.defaultFrom — the identity blank `from.*` fields backfill from.
// Omitted (or `null`) means NO backfill — blank fields stay honestly blank.
// This is INVERTED from an earlier version of this function, which held the
// owner's real identity as a module-level DEFAULT_FROM const right here and
// silently backfilled it by default. That was the actual privacy hole
// (Invoice Studio plan D13 bundle-inspection follow-up): model.js is
// imported by the PUBLIC client bundle, so the mere presence of that const
// shipped Bryan Balli's real email/phone/address as literal strings in the
// bundle regardless of whether the public render path ever used them —
// runtime option gating can't remove strings from a compiled bundle. A
// caller that wants the real identity now must explicitly import it from
// features/invoices/default-from.js and pass it as `context.defaultFrom`
// (the server publish path and the admin Studio path both do this).
export function normalizeInvoice(raw = {}, context = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const currency = cleanString(source.currency, 'USD').toUpperCase().slice(0, 3);
  const status = STATUSES.includes(source.status) ? source.status : 'draft';
  const seed = context.seed || `${context.clientId || ''}-${source.invoiceNumber || source.projectTitle || ''}-${source.issueDate || ''}`;

  const invoice = {
    invoiceNumber: cleanString(source.invoiceNumber) || invoiceNumberFor(seed),
    status,
    issueDate: normalizeDate(source.issueDate) || todayIso(),
    dueDate: normalizeDate(source.dueDate) || addDays(normalizeDate(source.issueDate) || todayIso(), 14),
    currency,
    // Client's own reference — plenty of companies will not pay an invoice
    // that does not carry their PO number.
    poNumber: cleanString(source.poNumber),
    // Stated terms, not just an implied due date.
    paymentTerms: cleanString(source.paymentTerms, 'Net 14'),
    servicePeriod: normalizeServicePeriod(source.servicePeriod),
    from: normalizeFromParty(source.from, context.defaultFrom),
    billTo: normalizeBillTo(source.billTo),
    projectTitle: cleanString(source.projectTitle, 'Project Invoice'),
    projectSubtitle: cleanString(source.projectSubtitle),
    categories: Array.isArray(source.categories) ? source.categories.map(normalizeCategory) : [],
    standaloneItems: Array.isArray(source.standaloneItems)
      ? source.standaloneItems.map((item, i) => normalizeItem(item, i, 'standalone'))
      : [],
    recommendation: normalizeRecommendation(source.recommendation),
    flowSteps: normalizeFlowSteps(source.flowSteps),
    terms: normalizeList(source.terms),
    notes: cleanString(source.notes),
    payment: normalizePayment(source.payment),
    meta: normalizeMeta(source.meta, context),
    // Invoice Studio design-layer plan L5/§3.1 — document identity fields.
    // None of these are read by render.js yet (that wiring is a later lane's
    // job), so adding them here cannot change any rendered byte: they are
    // pure passengers on the invoice object until a caller reads them.
    docKind: normalizeDocKind(source.docKind),
    labels: normalizeLabels(source.labels),
    locale: normalizeLocale(source.locale),
    numberPattern: normalizeNumberPattern(source.numberPattern),
    logoDataUrl: normalizeLogoDataUrl(source.logoDataUrl),
  };

  invoice.totals = computeTotals({ ...invoice, totals: source.totals });
  return invoice;
}

export default normalizeInvoice;
