// Renders a normalized invoice (features/invoices/model.js) into a complete,
// self-contained HTML document styled with the shared brief design system
// (features/scout-intake/brief-css.cjs) so invoices read as briefs. Section
// gating/order comes from features/invoices/registry.js. Idioms (esc(),
// stat(), list(), the Google Fonts <link>, the local <style> add-on on top
// of BRIEF_CSS) are copied from features/leadgen/estimate-renderer.js so the
// two renderers stay visually consistent.
//
// Client-safe by design (Invoice Studio plan D1/D2): this module imports
// only other client-safe ESM (model.js, registry.js) plus the generated
// brief-css.js mirror below — no createRequire(), no brand-marks.js, and
// (as of the D13 bundle-inspection follow-up) no payment-qr.js either. The
// HITLOOP identity (logo + signature) is never baked in here; a caller that
// wants it opts in via the `brand` option (D8), which keeps those data URIs
// out of any bundle that doesn't explicitly ask for them. Same story for the
// resolved payment QR image: this file used to statically import
// resolvePaymentQr from payment-qr.js, which put the Venmo QR data URI and
// handle in EVERY bundle that imports this module — including the public
// one — regardless of whether an invoice ever set payment.qr. The caller now
// resolves it (if at all) and passes the already-resolved code as
// `options.paymentQr`; see buildPayment() and renderInvoiceDocument()'s doc
// comment below.
import { normalizeInvoice, formatMoney, resolveInvoiceLabels, resolveDepositHeading } from './model.js';
import { resolveInvoiceSections } from './registry.js';
// Generated ESM mirror of brief-css.cjs (scripts/sync-brief-css.mjs) — see
// that file's header. The .cjs stays the source of truth; this import is
// what makes render.js followable by a client bundle (a client can't follow
// createRequire()/require(), which is what used to sit here).
import { BRIEF_CSS } from './brief-css.js';
// Design-layer plan §3.2/§3.3 (Q3, Lane T) — client-safe/pure, same family as
// model.js/registry.js (no createRequire, no framework import). theme-schema.js
// deliberately does NOT import this file (see its own header comment: "Lane
// T's job (Q3)" to wire it in), so this is a one-directional import with no
// cycle. normalizeTheme() is called defensively below — a caller SHOULD
// already be passing a normalized theme (useInvoiceDraft.js's `theme` state
// only ever holds a normalizeTheme() result), but this file never trusts
// options.theme's own shape.
import { normalizeTheme, themeToCss, themeFontsHref } from '../../app/dashboard/studio/invoice/themes/theme-schema.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── editable-mode annotations (Invoice Studio plan §4.4) ────────────────
// Attribute-only hooks for the Studio canvas bridge — a same-origin iframe
// the parent page drives directly via contentDocument (plan D3), never an
// injected <script>. Every helper below is a no-op passthrough when
// `editable` is falsy (or the value being wrapped is empty), so the default
// — and every existing caller before this option existed — renders
// byte-identical HTML. See features/invoices/__tests__/invoices.test.js for
// the regression test that pins this.

// Wraps a rendered value in a span carrying its draft path, so the canvas
// bridge can bind input/blur events to exactly this node and reformat it on
// commit. `raw` is the unformatted value (money/number/date types restore
// this on focus); pass null for text/multiline/enum fields, which have no
// separate raw form. Returns `displayHtml` unchanged — no wrapper element —
// whenever `editable` is off or there is nothing to show, so a field that is
// honestly empty today (and therefore already skipped by its caller) stays
// exactly as absent in editable mode as it is now.
function editableField(path, type, raw, displayHtml, editable) {
  if (!editable || !displayHtml) return displayHtml;
  const rawAttr = raw !== null && raw !== undefined && raw !== ''
    ? ` data-inv-raw="${esc(raw)}"`
    : '';
  return `<span data-inv-field="${esc(path)}" data-inv-type="${esc(type)}"${rawAttr}>${displayHtml}</span>`;
}

// Marks a computed value (item/category totals, the totals panel's own
// figures) as a patch-in target only — recomputed by computeTotals() on the
// draft side and never itself user-editable, so it carries no type/raw.
function derivedField(path, displayHtml, editable) {
  if (!editable || !displayHtml) return displayHtml;
  return `<span data-inv-derived="${esc(path)}">${displayHtml}</span>`;
}

// data-inv-row marks a repeatable row's own wrapper element (not a child
// span), so the bridge can find/insert/remove/reorder the whole row. `kind`
// mirrors invoice-fields.js's renderedIndexToDraftIndex() vocabulary
// ('subItems' | 'chips' | 'flowSteps' | 'terms') for the four arrays whose
// rendered index can differ from the draft index (model.js drops blank
// rows); category/item/standaloneItem rows use their stable model id
// instead, since normalizeInvoice preserves those (model.js:60,72).
function rowAttr(kind, idOrIndex, editable) {
  return editable ? ` data-inv-row="${esc(kind)}:${esc(idOrIndex)}"` : '';
}

function sectionAttr(sectionId, editable) {
  return editable ? ` data-inv-section="${esc(sectionId)}"` : '';
}

function list(items, opts = {}) {
  const { editable, kind, pathFor } = opts;
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return '<li>—</li>';
  return rows.map((item, i) => {
    const attr = kind ? rowAttr(kind, i, editable) : '';
    const field = pathFor ? editableField(pathFor(i), 'text', null, esc(item), editable) : esc(item);
    return `<li${attr}>${field}</li>`;
  }).join('');
}

// label gets escaped here; value is assumed pre-escaped/safe HTML by the
// caller (matches features/leadgen/estimate-renderer.js's stat()).
// `labelField` optionally replaces the plain esc(label) with an
// editableField()-wrapped version (e.g. totals.discountLabel) — omitted, the
// label renders exactly as before.
function fact(label, value, labelField) {
  if (!value) return '';
  return `<div class="invoice-fact"><dt>${labelField || esc(label)}</dt><dd>${value}</dd></div>`;
}

function facts(rows) {
  const body = rows.filter(Boolean).join('');
  return body ? `<dl class="invoice-facts">${body}</dl>` : '';
}

function stat(label, value) {
  return `<div class="stat-row"><div class="k">${esc(label)}</div><div class="v">${value || '—'}</div></div>`;
}

// A bare YYYY-MM-DD parses as UTC midnight, which formats as the PREVIOUS day
// in any negative-offset timezone — an invoice dated Sep 2 was printing Sep 1.
// Parse date-only strings as local time; leave full timestamps alone.
function toLocalDate(iso) {
  if (!iso) return new Date();
  const value = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T00:00:00` : iso;
  return new Date(value);
}

// `locale` defaults to 'en-US' so every existing 1-arg call site keeps
// producing today's exact output — a caller that resolves a non-default
// invoice.locale (design-layer plan §3.1) passes it as the 2nd argument.
// Duplicated locally rather than imported from model.js (see this file's own
// header comment on why); model.js's formatDatePretty (invoice-fields.js)
// and formatMoney follow the identical try/catch-on-invalid-locale pattern.
function formatDate(iso, locale = 'en-US') {
  const date = toLocalDate(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString(locale || 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function formatDateTime(iso, locale = 'en-US') {
  const date = toLocalDate(iso);
  try {
    return date.toLocaleString(locale || 'en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}

function resolvePdfHref(options) {
  const path = String(options.pdfPath || '');
  if (/^https?:\/\//i.test(path)) return path;
  const origin = String(options.origin || '').replace(/\/$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return origin ? `${origin}${rel}` : rel;
}

// An invoice is ONE page — never a per-section slide deck. The cover
// treatment is the sheet's header; every other section is a compact stacked
// block under it. Nothing here emits BRIEF_CSS's `section.page` (100vh +
// print `page-break-after:always`) or a `data-pdf-page` marker, which is
// what `api/_lib/browserless.cjs` breaks pages on — so the PDF flows as a
// single continuous document too.
//
// sub/body are pre-built HTML fragments (caller escapes any interpolated
// text). `brand` (options.brand, see renderInvoiceDocument) is
// { logo, signature, wordmark } | null. The mark <img> is emitted only when
// brand.logo is present (no logo, no data URI at all, not an empty tag).
//
// The big headline is `headlineText` — the resolved document-kind label
// ("Invoice", "Quote", "Receipt", "Estimate", "Credit Note" — see
// resolveInvoiceLabels()'s `title` key), NOT the issuer's brand name. It used
// to be sourced from `brand.wordmark` (a hardcoded "HITLOOP"), which meant
// every real invoice's masthead said the issuer's own company name rather
// than what the document actually IS — and a brand-less (public) render got
// no headline at all, an empty gap at the top of the sheet. Document-kind
// text has no owner-identity concern either way, so it renders for every
// caller, admin or public. The issuer's own name is still stated in Invoice
// details and the footer — this line has never been the right place for it.
//
// In `editable` mode the headline is a real bound field (`labels.title`,
// same override key resolveInvoiceLabels() already reads) — an operator can
// click in and type their own masthead text directly on the canvas. An
// edit that's later cleared back to blank falls through to the doc-kind
// default on the next render (resolveInvoiceLabels() only honors a
// non-blank override), matching every other optional label override.
// No eyebrow strip and no brand marquee: the invoice number and status are
// already stated in the Invoice details block, and a repeating name band is
// pitch-deck furniture on a document someone has to pay from.
//
// `draftLogoDataUrl` (design-layer plan L9, Q2 Lane B) is the operator's own
// uploaded `invoice.logoDataUrl` — rendered ONLY when no admin `brand.logo`
// is present, since the admin brand mark always wins. It gets its own id
// (`invoice-draft-logo`, distinct from the reserved admin-mark id). Sized via
// an INLINE style (matching #invoice-brand-logo's own CSS rule) rather than
// a new rule added to INVOICE_CSS: that block is static/always-emitted, so
// any addition to it would change every render's byte count — an inline
// style is only ever emitted alongside this specific <img>, which itself
// only exists when there is something to show.
function hero(id, sub, body, brand, sectionId, editable, draftLogoDataUrl, headlineText) {
  const mark = brand?.logo
    ? `<img id="invoice-brand-logo" src="${brand.logo.dataUri}" alt="${esc(brand.wordmark || '')}" width="${brand.logo.width}" height="${brand.logo.height}" />`
    : (draftLogoDataUrl ? `<img id="invoice-draft-logo" src="${esc(draftLogoDataUrl)}" alt="" style="display:block;width:56px;height:auto;margin:0;flex:0 0 auto;" />` : '');
  const headline = headlineText
    ? `<h1 class="invoice-hero-title">${editableField('labels.title', 'text', null, esc(headlineText), editable)}</h1>`
    : '';
  return `
  <header id="${esc(id)}" class="invoice-hero"${sectionAttr(sectionId, editable)}>
    <div class="invoice-hero-mark">
      ${mark}
      ${headline}
    </div>
    ${sub ? `<p class="invoice-hero-sub">${sub}</p>` : ''}
    ${body}
  </header>`;
}

function block(id, label, body, sectionId, editable, labelField) {
  return `
  <section id="${esc(id)}" class="invoice-block"${sectionAttr(sectionId, editable)}>
    <h2 class="invoice-block-label">${labelField || esc(label)}</h2>
    ${body}
  </section>`;
}

// One line per item across the full sheet width: what the work is, how many
// hours, the rate, and that item's amount. The old stacked version restated
// the amount under itself as "qty x rate" and pushed each item over four
// lines. A note or sub-items add a second line — nothing takes more.
// `itemPath`/`itemId`/`rowKind` are only present when the caller wants
// editable annotations (buildLineItems passes the category-scoped path +
// 'item'; buildStandaloneItems passes the top-level path + 'standaloneItem');
// omitted, this renders exactly as before.
function renderItemRow(item, currency, opts = {}) {
  const { itemPath, itemId, rowKind, editable, locale } = opts;
  const isTextCost = Boolean(item.costLabel);
  const hours = isTextCost || item.qty == null ? '' : `${item.qty} hr${Number(item.qty) === 1 ? '' : 's'}`;
  const rate = isTextCost ? '' : `${formatMoney(item.unitPrice, currency, locale)}/hr`;
  const amount = isTextCost ? item.costLabel : formatMoney(item.total, currency, locale);
  const nameField = itemPath ? editableField(`${itemPath}.name`, 'text', null, esc(item.name), editable) : esc(item.name);
  const noteField = item.note
    ? `<span class="invoice-item-note">${itemPath ? editableField(`${itemPath}.note`, 'text', null, esc(item.note), editable) : esc(item.note)}</span>`
    : '';
  const subsField = item.subItems.length
    ? `<span class="invoice-item-subs">${item.subItems.map((sub, i) => {
        const subPath = itemPath ? `${itemPath}.subItems[${i}]` : '';
        const nameHtml = subPath ? editableField(`${subPath}.name`, 'text', null, esc(sub.name), editable) : esc(sub.name);
        const costHtml = sub.cost ? ` (${subPath ? editableField(`${subPath}.cost`, 'text', null, esc(sub.cost), editable) : esc(sub.cost)})` : '';
        return editable && subPath
          ? `<span${rowAttr('subItems', i, editable)}>${nameHtml}${costHtml}</span>`
          : `${nameHtml}${costHtml}`;
      }).join(' · ')}</span>`
    : '';
  const detail = [noteField, subsField].filter(Boolean).join(' ');
  const hoursField = itemPath ? editableField(`${itemPath}.qty`, 'number', item.qty, esc(hours), editable) : esc(hours);
  const rateField = itemPath ? editableField(`${itemPath}.unitPrice`, 'money', item.unitPrice, esc(rate), editable) : esc(rate);
  const amountField = isTextCost
    ? (itemPath ? editableField(`${itemPath}.costLabel`, 'text', null, esc(amount), editable) : esc(amount))
    : (itemPath ? derivedField(`${itemPath}.total`, esc(amount), editable) : esc(amount));
  const rowAttrStr = rowKind && itemId != null ? rowAttr(rowKind, itemId, editable) : '';
  return `
    <div class="invoice-item-row"${rowAttrStr}>
      <div class="invoice-item-task">
        <span class="invoice-item-name">${nameField}</span>
        ${detail ? `<span class="invoice-item-detail">${detail}</span>` : ''}
      </div>
      <div class="invoice-item-hours">${hoursField}</div>
      <div class="invoice-item-rate">${rateField}</div>
      <div class="invoice-item-amount">${amountField}</div>
    </div>`;
}

// ── Section builders ────────────────────────────────────────────────────
// Each takes (invoice, options) and returns '' when the section has no data
// to show (honest skip — never a broken half-block). `options.editable`
// gates the data-inv-* annotations below; `options.brand` (cover/footer
// only) gates the HITLOOP marks. Neither changes what renders when off.

function buildCover(invoice, options) {
  const { projectTitle, projectSubtitle, invoiceNumber, status, issueDate, dueDate, billTo, totals, currency } = invoice;
  const editable = options.editable;
  const labels = options.labels || {};
  // The header is what this document IS (the big headline, sourced from
  // labels.title — see hero()'s own comment) plus its number. The issuer's
  // mark/name is the logo image beside it (or nothing, on a public render);
  // the project this document covers is the Project summary section's job,
  // and the amount belongs with the money blocks below, not the masthead.
  // "Bill To"/"Issue Date"/"Due Date" below are this strip's own fixed
  // captions, not a resolveInvoiceLabels() key — no docKind/labels entry
  // exists for them (only billToLabel/issueLabel/dueLabel, used by Invoice
  // details' differently-worded facts), so they stay hardcoded on purpose.
  const body = `
    <div class="meta">
      <div><div class="k">Bill To</div><div class="v">${editableField('billTo.name', 'text', null, esc(billTo.name || '—'), editable)}</div></div>
      <div><div class="k">Issue Date</div><div class="v">${editableField('issueDate', 'date', issueDate, esc(issueDate), editable)}</div></div>
      <div><div class="k">Due Date</div><div class="v">${editableField('dueDate', 'date', dueDate, esc(dueDate || '—'), editable)}</div></div>
    </div>`;
  // Just the number — the doc-kind word is already the big headline above,
  // so repeating "Invoice"/"Quote" here would be pure repetition.
  const sub = `<span class="invoice-hero-number">${editableField('invoiceNumber', 'text', null, esc(invoiceNumber), editable)}</span>`;
  return hero('invoice-cover-section', sub, body, options.brand, 'cover', editable, invoice.logoDataUrl, labels.title);
}

function buildInvoiceMeta(invoice, options) {
  const { invoiceNumber, status, issueDate, dueDate, paymentTerms, poNumber, servicePeriod, currency, from, locale } = invoice;
  const editable = options.editable;
  const labels = options.labels || {};
  const periodStart = servicePeriod.start
    ? editableField('servicePeriod.start', 'date', servicePeriod.start, esc(formatDate(servicePeriod.start, locale)), editable)
    : '';
  const periodEnd = servicePeriod.end
    ? editableField('servicePeriod.end', 'date', servicePeriod.end, esc(formatDate(servicePeriod.end, locale)), editable)
    : '';
  const period = servicePeriod.start && servicePeriod.end
    ? `${periodStart} — ${periodEnd}`
    : (servicePeriod.start ? `From ${periodStart}` : '');
  // Two columns: what this document IS on the left, who is billing on the
  // right. Both are facts a payer's AP desk looks for before paying.
  const detail = facts([
    fact(labels.numberLabel || 'Invoice #', editableField('invoiceNumber', 'text', null, esc(invoiceNumber), editable)),
    fact(labels.statusLabel || 'Status', `<span class="invoice-status is-${esc(status)}">${editableField('status', 'enum', null, esc(status), editable)}</span>`),
    fact(labels.issueLabel || 'Issued', editableField('issueDate', 'date', issueDate, esc(formatDate(issueDate, locale)), editable)),
    fact(labels.dueLabel || 'Due', editableField('dueDate', 'date', dueDate, esc(formatDate(dueDate, locale)), editable)),
    fact(labels.paymentTermsLabel || 'Terms', editableField('paymentTerms', 'text', null, esc(paymentTerms), editable)),
    fact(labels.poNumberLabel || 'PO number', editableField('poNumber', 'text', null, esc(poNumber), editable)),
    fact(labels.servicePeriodLabel || 'Service period', period),
    fact(labels.currencyLabel || 'Currency', editableField('currency', 'enum', null, esc(currency), editable)),
  ]);
  // `from.name` is always populated (normalizeFromParty falls back to
  // DEFAULT_FROM), so the "Billed by" fact maps to whichever field is
  // actually on screen: legalName when set, else name.
  const billedByPath = from.legalName ? 'from.legalName' : 'from.name';
  const issuer = facts([
    fact(labels.billedByLabel || 'Billed by', editableField(billedByPath, 'text', null, esc(from.legalName || from.name), editable)),
    from.legalName && from.name !== from.legalName ? fact(labels.tradingAsLabel || 'Trading as', editableField('from.name', 'text', null, esc(from.name), editable)) : '',
    fact(labels.addressLabel || 'Address', editableField('from.address', 'multiline', from.address, esc(from.address).replace(/\n/g, '<br/>'), editable)),
    fact(labels.emailLabel || 'Email', `<a class="invoice-link" href="mailto:${esc(from.email)}">${editableField('from.email', 'text', null, esc(from.email), editable)}</a>`),
    fact(labels.phoneLabel || 'Phone', editableField('from.phone', 'text', null, esc(from.phone), editable)),
    fact(labels.siteLabel || 'Site', editableField('from.site', 'text', null, esc(from.site), editable)),
    fact(labels.taxIdLabel || 'Tax ID', editableField('from.taxId', 'text', null, esc(from.taxId), editable)),
  ]);
  if (!detail && !issuer) return '';
  return block('invoice-meta-section', labels.invoiceDetails || 'Invoice details', `<div class="invoice-two-up">${detail}${issuer}</div>`, 'invoiceMeta', editable);
}


function buildBillTo(invoice, options) {
  const { billTo } = invoice;
  const editable = options.editable;
  const labels = options.labels || {};
  const body = facts([
    fact(labels.clientLabel || 'Client', editableField('billTo.name', 'text', null, esc(billTo.name), editable)),
    fact(labels.contactLabel || 'Contact', editableField('billTo.contact', 'text', null, esc(billTo.contact), editable)),
    fact(labels.emailLabel || 'Email', billTo.email ? `<a class="invoice-link" href="mailto:${esc(billTo.email)}">${editableField('billTo.email', 'text', null, esc(billTo.email), editable)}</a>` : ''),
    fact(labels.addressLabel || 'Address', editableField('billTo.address', 'multiline', billTo.address, esc(billTo.address).replace(/\n/g, '<br/>'), editable)),
  ]);
  if (!body) return '';
  return block('invoice-bill-to-section', labels.billToLabel || 'Bill to', body, 'billTo', editable);
}


function buildProjectSummary(invoice, options) {
  const { projectTitle, projectSubtitle, categories, standaloneItems, meta } = invoice;
  const labels = options.labels || {};
  const categoryCount = categories.filter((c) => c.items.length).length;
  const itemCount = categories.reduce((sum, c) => sum + c.items.length, 0) + standaloneItems.length;
  // categoryCount/itemCount are derived tallies (no model path) and
  // meta.preparedBy is not in the editable path grammar (§4.1) — nothing
  // here is annotated beyond the section wrapper itself. "Prepared by" has
  // no resolveInvoiceLabels() key either (not in INVOICE_LABEL_KEYS) — stays
  // hardcoded.
  const body = `<div class="card">
    ${stat(labels.categoriesLabel || 'Categories', esc(String(categoryCount)))}
    ${stat(labels.lineItemsLabel || 'Line items', esc(String(itemCount)))}
    ${meta.preparedBy ? stat('Prepared by', esc(meta.preparedBy)) : ''}
  </div>`;
  return block('invoice-project-summary-section', labels.summaryLabel || 'Summary', body, 'projectSummary', options.editable);
}

function buildLineItems(invoice, options) {
  const categories = invoice.categories.filter((c) => c.items.length > 0);
  if (!categories.length) return '';
  const editable = options.editable;
  const labels = options.labels || {};
  const head = `
    <div class="invoice-item-row invoice-item-head">
      <div class="invoice-item-task">${esc(labels.taskLabel || 'Task')}</div>
      <div class="invoice-item-hours">${esc(labels.hoursLabel || 'Hours')}</div>
      <div class="invoice-item-rate">${esc(labels.rateLabel || 'Rate')}</div>
      <div class="invoice-item-amount">${esc(labels.amountLabel || 'Amount')}</div>
    </div>`;
  const body = categories.map((cat) => `
    <div class="invoice-item-group"${rowAttr('category', cat.id, editable)}>
      ${cat.name ? `<div class="invoice-category-label">${editableField(`categories[${cat.id}].name`, 'text', null, esc(cat.name), editable)}</div>` : ''}
      ${head}
      ${cat.items.map((item) => renderItemRow(item, invoice.currency, {
        itemPath: `categories[${cat.id}].items[${item.id}]`,
        itemId: item.id,
        rowKind: 'item',
        editable,
        locale: invoice.locale,
      })).join('')}
    </div>`).join('');
  return block('invoice-line-items-section', labels.lineItemsLabel || 'Line items', body, 'lineItems', editable);
}

function buildStandaloneItems(invoice, options) {
  if (!invoice.standaloneItems.length) return '';
  const editable = options.editable;
  const labels = options.labels || {};
  const body = `<div class="card">${invoice.standaloneItems.map((item) => renderItemRow(item, invoice.currency, {
    itemPath: `standaloneItems[${item.id}]`,
    itemId: item.id,
    rowKind: 'standaloneItem',
    editable,
    locale: invoice.locale,
  })).join('')}</div>`;
  return block('invoice-standalone-items-section', labels.additionalItemsLabel || 'Additional items', body, 'standaloneItems', editable);
}

function buildTotals(invoice, options) {
  const { totals, currency, locale } = invoice;
  const editable = options.editable;
  const labels = options.labels || {};
  if (!totals.subtotal && !totals.total && !totals.amountPaid) return '';
  const money = (value) => esc(formatMoney(value, currency, locale));
  // Ends on the balance, which is the only number the reader has to act on.
  // Currency code rides the settled figures so a non-US payer is not guessing
  // which dollar this is.
  const hasAdjustments = Boolean(totals.discount || totals.tax);
  // totals.discountLabel/taxLabel are a pre-existing PER-INVOICE override
  // mechanism (unrelated to invoice.labels — left untouched); only their
  // hardcoded FALLBACK text ('Discount'/'Tax') now resolves from
  // resolveInvoiceLabels() so an unoverridden Quote/Estimate/etc. still gets
  // its own doc-kind terminology.
  const discountLabelField = editableField('totals.discountLabel', 'text', null, esc(totals.discountLabel || labels.discountLabel || 'Discount'), editable);
  const taxLabelField = editableField('totals.taxLabel', 'text', null, esc(totals.taxLabel || labels.taxLabel || 'Tax'), editable);
  const rows = facts([
    hasAdjustments ? fact(labels.subtotalLabel || 'Subtotal', derivedField('totals.subtotal', money(totals.subtotal), editable)) : '',
    totals.discount ? fact(totals.discountLabel || labels.discountLabel || 'Discount', `−${editableField('totals.discount', 'money', totals.discount, money(totals.discount), editable)}`, discountLabelField) : '',
    totals.tax ? fact(totals.taxLabel || labels.taxLabel || 'Tax', editableField('totals.tax', 'money', totals.tax, money(totals.tax), editable), taxLabelField) : '',
    hasAdjustments || totals.amountPaid ? fact(labels.totalLabel || 'Total', `${derivedField('totals.total', money(totals.total), editable)} ${esc(currency)}`) : '',
    totals.amountPaid ? fact(labels.amountPaidLabel || 'Amount paid', `−${editableField('totals.amountPaid', 'money', totals.amountPaid, money(totals.amountPaid), editable)}`) : '',
  ]);
  const balancePath = totals.amountPaid ? 'totals.balanceDue' : 'totals.total';
  // 'Total due' (the no-amountPaid branch) has no resolveInvoiceLabels() key
  // — only the amountPaid branch ('Balance due') matches labels.balanceLabel
  // — so only that branch swaps.
  const balance = `
    <div class="invoice-balance">
      <span class="invoice-balance-label">${esc(totals.amountPaid ? (labels.balanceLabel || 'Balance due') : 'Total due')}</span>
      <span class="invoice-balance-value">${derivedField(balancePath, money(totals.amountPaid ? totals.balanceDue : totals.total), editable)} <span class="invoice-balance-currency">${esc(currency)}</span></span>
    </div>`;
  const paidMark = invoice.status === 'paid' && totals.balanceDue <= 0
    ? '<div class="invoice-paid-mark">Paid in full</div>'
    : '';
  return block('invoice-totals-panel', labels.totalsLabel || 'Totals', `${rows}${balance}${paidMark}`, 'totals', editable);
}


function buildDeposit(invoice, options) {
  const { totals, currency, locale } = invoice;
  const editable = options.editable;
  if (!(totals.deposit > 0)) return '';
  // resolveDepositHeading() (model.js) is the ONE Deposit-heading resolver,
  // shared with the rail's DepositCard so they can never disagree. See its
  // own comment for why the literal 'Payment due' string is treated as
  // "unset" rather than a genuine override — model.js's computeTotals()
  // always backfills totals.depositLabel with that exact string.
  const depositHeading = resolveDepositHeading(invoice);
  // The label is the block's heading, switchable to "Deposit due" (or
  // anything else) per invoice via totals.depositLabel — that per-invoice
  // override mechanism is untouched. It used to be repeated as a caption
  // inside the container above the amount; the container now holds the
  // figure and nothing else.
  const partial = totals.total > 0 && totals.deposit < totals.total
    ? `<div class="invoice-due-of">of ${derivedField('totals.total', esc(formatMoney(totals.total, currency, locale)), editable)} total</div>`
    : '';
  const body = `
    <div class="card" style="text-align:center">
      <div class="invoice-total-value" style="margin:4px 0">${editableField('totals.deposit', 'money', totals.deposit, esc(formatMoney(totals.deposit, currency, locale)), editable)}</div>
      ${partial}
    </div>`;
  const depositLabelField = editableField('totals.depositLabel', 'text', null, esc(depositHeading), editable);
  return block('invoice-deposit-section', depositHeading, body, 'deposit', editable, depositLabelField);
}

function buildRecommendation(invoice, options) {
  const { recommendation } = invoice;
  const editable = options.editable;
  const labels = options.labels || {};
  if (!recommendation.name && !recommendation.body && !recommendation.chips.length) return '';
  const body = `
    <div class="card">
      ${recommendation.body ? `<p class="sub" style="font-size:18px;margin-bottom:20px">${editableField('recommendation.body', 'multiline', recommendation.body, esc(recommendation.body), editable)}</p>` : ''}
      ${recommendation.chips.length ? `<div class="invoice-chip-row">${recommendation.chips.map((c, i) => `<span class="invoice-chip"${rowAttr('chips', i, editable)}>${editableField(`recommendation.chips[${i}]`, 'text', null, esc(c), editable)}</span>`).join('')}</div>` : ''}
    </div>`;
  return block('invoice-recommendation-section', labels.recommendationLabel || 'Recommendation', `<p class="invoice-recommendation-name">${editableField('recommendation.name', 'text', null, esc(recommendation.name || labels.recommendationLabel || 'Recommendation'), editable)}</p>${body}`, 'recommendation', editable);
}

function buildFlow(invoice, options) {
  const steps = invoice.flowSteps;
  const editable = options.editable;
  const labels = options.labels || {};
  if (!steps.length) return '';
  const nodes = steps.map((step, i) => `
    <div class="node"${rowAttr('flowSteps', i, editable)}>
      <div class="n">Step ${i + 1}${step.color ? ` · ${editableField(`flowSteps[${i}].color`, 'text', null, esc(step.color), editable)}` : ''}</div>
      <div class="t">${editableField(`flowSteps[${i}].platform`, 'text', null, esc(step.platform || '—'), editable)}</div>
      <p>${editableField(`flowSteps[${i}].label`, 'text', null, esc(step.label), editable)}${step.tech ? `<br/><span class="mono" style="font-size:11px;color:var(--ink-soft)">${editableField(`flowSteps[${i}].tech`, 'text', null, esc(step.tech), editable)}</span>` : ''}</p>
    </div>`).join('');
  return block('invoice-flow-section', labels.flowLabel || 'How it works', `<div class="flow">${nodes}</div>`, 'flow', editable);
}

function buildTerms(invoice, options) {
  const editable = options.editable;
  const labels = options.labels || {};
  if (!invoice.terms.length) return '';
  const body = `<div class="card"><ul class="invoice-list">${list(invoice.terms, { editable, kind: 'terms', pathFor: (i) => `terms[${i}]` })}</ul></div>`;
  return block('invoice-terms-section', labels.termsLabel || 'Terms', body, 'terms', editable);
}

function buildPayment(invoice, options) {
  const { payment } = invoice;
  const editable = options.editable;
  const labels = options.labels || {};
  // The caller resolves payment.qr -> an actual code (or doesn't), never
  // this file — see the module header and renderInvoiceDocument()'s
  // options.paymentQr doc comment.
  const qr = options.paymentQr || null;
  if (!payment.method && !payment.instructions && !payment.link && !payment.handle && !qr) return '';
  // payment.handle is rendered but is NOT in the §4.1 path grammar
  // (payment.{method,instructions,link} only) — left unannotated; see this
  // lane's handoff report for other lanes to confirm intent.
  const rows = `<div class="card">
    ${payment.method ? stat('Method', editableField('payment.method', 'text', null, esc(payment.method), editable)) : ''}
    ${payment.handle ? stat('Send to', `<strong>${esc(payment.handle)}</strong>`) : ''}
    ${payment.instructions ? stat('Instructions', editableField('payment.instructions', 'multiline', payment.instructions, esc(payment.instructions), editable)) : ''}
    ${payment.link ? stat('Link', `<a class="invoice-link" href="${esc(payment.link)}" target="_blank" rel="noopener noreferrer">${editableField('payment.link', 'text', null, esc(payment.link), editable)}</a>`) : ''}
  </div>`;
  // The code always sits to the RIGHT of the details, never below: scanning it
  // is the fast path to getting paid.
  // No caption under the code: the rail and handle are already stated in the
  // Method and Send-to rows beside it. The alt text still names both, so a
  // screen reader or a failed image load loses nothing.
  // Twice opt-in now: the invoice itself must set payment.qr to a known key
  // (default '' -> normalizePayment leaves it '') AND the caller must have
  // resolved that key and passed it as options.paymentQr — omitting either
  // one, which the public path always does, means no QR image and no data
  // URI ever reaches this render at all.
  const qrBlock = qr
    ? `<figure id="invoice-payment-qr" class="invoice-payment-qr">
        <img src="${qr.dataUri}" alt="${esc(qr.label)} payment QR code for ${esc(qr.handle || payment.handle || '')}" width="150" height="150" />
      </figure>`
    : '';
  const body = qrBlock
    ? `<div class="invoice-payment-split">${rows}${qrBlock}</div>`
    : rows;
  return block('invoice-payment-section', labels.paymentLabel || 'Payment', body, 'payment', editable);
}

function buildNotes(invoice, options) {
  const editable = options.editable;
  const labels = options.labels || {};
  if (!invoice.notes) return '';
  const body = `<div class="card"><p class="sub" style="font-size:16px;white-space:pre-wrap">${editableField('notes', 'multiline', invoice.notes, esc(invoice.notes), editable)}</p></div>`;
  return block('invoice-notes-section', labels.notesLabel || 'Notes', body, 'notes', editable);
}

// Two facts only — when it was generated and who it is for — pinned to the
// left and right edges of the sheet. The invoice number, issuing name and
// prepared-by line are all stated above; repeating them here just made the
// footer wrap onto three ragged lines.
function buildContactFooter(invoice, options = {}) {
  // A fixed contact address, not a per-invoice value: whoever is reading this
  // needs one way to reach a person about it. Sourced from DEFAULT_FROM so the
  // address lives in exactly one file.
  // The issuer's details carry who to pay, where they are and how to reach
  // them, in one compact stack: name, then address, then the contact line,
  // plus a tax ID only when one is set. That stack sits flush LEFT and the
  // signature flush RIGHT — both are direct children of the footer, so its own
  // `justify-content:space-between` drives the split (no wrapper span; one
  // used to hold the pair together and pinned them mid-sheet).
  const editable = options.editable;
  const brand = options.brand;
  const { from } = invoice;
  const contact = [
    from.email ? `<a class="invoice-link" href="mailto:${esc(from.email)}">${editableField('from.email', 'text', null, esc(from.email), editable)}</a>` : '',
    from.phone ? editableField('from.phone', 'text', null, esc(from.phone), editable) : '',
    from.site ? editableField('from.site', 'text', null, esc(from.site), editable) : '',
  ].filter(Boolean).join(' · ');
  const billedByPath = from.legalName ? 'from.legalName' : 'from.name';
  const identity = [
    `<span class="invoice-signer-name">${editableField(billedByPath, 'text', null, esc(from.legalName || from.name), editable)}</span>`,
    from.address ? `<span>${editableField('from.address', 'multiline', from.address, esc(from.address).replace(/\n/g, ', '), editable)}</span>` : '',
    contact ? `<span>${contact}</span>` : '',
    from.taxId ? `<span>Tax ID · ${editableField('from.taxId', 'text', null, esc(from.taxId), editable)}</span>` : '',
  ].filter(Boolean).join('');
  // Signature <img> only when a brand's signature mark is supplied — no
  // brand, no image, no data URI (D8): see the `brand` option docs above
  // renderInvoiceDocument.
  const signatureMark = brand?.signature
    ? `<img id="invoice-brand-signature" src="${brand.signature.dataUri}" alt="Signed, ${esc(from.name)}" width="${brand.signature.width}" height="${brand.signature.height}" />`
    : '';
  return `
  <footer id="invoice-contact-footer-section"${sectionAttr('contactFooter', editable)}>
    <span id="invoice-signer-block" class="invoice-signer">${identity}</span>
    ${signatureMark}
  </footer>`;
}

const SECTION_BUILDERS = {
  cover: buildCover,
  invoiceMeta: buildInvoiceMeta,
  billTo: buildBillTo,
  projectSummary: buildProjectSummary,
  lineItems: buildLineItems,
  standaloneItems: buildStandaloneItems,
  totals: buildTotals,
  deposit: buildDeposit,
  recommendation: buildRecommendation,
  flow: buildFlow,
  terms: buildTerms,
  payment: buildPayment,
  notes: buildNotes,
  contactFooter: buildContactFooter,
};

// Invoice-specific classes layered on top of the shared BRIEF_CSS (which
// already supplies .page/.card/.stat-row/.flow/.bento/print page-breaks).
const INVOICE_CSS = `
  /* Plain white ground, black type. BRIEF_CSS's palette is cream + tinted ink
     with a gradient body wash; an invoice is a document someone prints and
     files, so the tokens are overridden at the root and the wash is removed
     outright rather than layered over. */
  :root, html, body {
    --bg:#ffffff; --card:#ffffff; --ink:#000000; --ink-soft:#000000;
    --line:rgba(0,0,0,0.18); --hl:transparent;
  }
  html, body { background:#ffffff !important; background-image:none !important; color:#000000; }
  body::before, body::after { display:none !important; content:none !important; }
  .card { background:#ffffff; box-shadow:none; }
  .invoice-hero-sub, .invoice-block-label, .stat-row .k, #invoice-contact-footer-section,
  .invoice-list, .invoice-category-label, .invoice-subitem-list li, .invoice-chip { color:#000000; }
  /* Mark and wordmark read as one lockup on a single baseline. */
  .invoice-hero-mark { display:flex; align-items:center; gap:14px; margin:0 0 10px; }
  #invoice-brand-logo { display:block; width:56px; height:auto; margin:0; flex:0 0 auto; }
  .invoice-signer { display:flex; flex-direction:column; gap:2px; text-align:left; text-transform:none; letter-spacing:.04em; line-height:1.5; }
  .invoice-signer .invoice-link { text-decoration:none; }
  .invoice-signer-name { font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
  #invoice-brand-signature { display:block; width:78px; height:auto; }

  /* One sheet — the cover treatment is the header, everything else stacks
     under it. These rules deliberately override BRIEF_CSS's slide-deck
     geometry (section.page = 100vh + print page-break-after). */
  .invoice-sheet { max-width:min(1180px, 94vw); margin:0 auto; padding:clamp(22px,4vw,44px) var(--gutter) clamp(28px,5vw,52px); }
  .invoice-hero { padding-bottom:20px; margin-bottom:22px; border-bottom:1px solid var(--line); }
  .invoice-hero-title { font-family:'Doto',monospace; font-weight:900; font-size:clamp(30px,6vw,60px); line-height:.94; letter-spacing:0; margin:0; color:var(--ink); }
  .invoice-hero-sub { font-family:'Space Mono',monospace; font-size:13px; letter-spacing:.18em; text-transform:uppercase; line-height:1.4; color:var(--ink-soft); margin:0 0 18px; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .invoice-hero-number { font-weight:700; letter-spacing:.12em; }
  /* BRIEF_CSS scopes the cover meta grid and marquee scale to \`.cover\` (a
     slide class this layout no longer emits), so the sheet restates them at
     invoice scale: a 4-up meta row, and a brand band sized as a rule rather
     than a full-bleed headline. */
  /* Spread across the full sheet width with the last field flush right — a
     3-column grid left it starting at the 2/3 mark with a ragged right edge. */
  .invoice-hero .meta { display:flex; justify-content:space-between; align-items:flex-start; gap:16px 28px; flex-wrap:wrap; margin-top:18px; border-top:1px solid var(--line); padding-top:16px; }
  .invoice-hero .meta > div { min-width:0; }
  .invoice-hero .meta > div:last-child { text-align:right; }
  .invoice-hero .meta .k { font-family:'Space Mono',monospace; font-size:10px; letter-spacing:.25em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:5px; }
  .invoice-hero .meta .v { font-family:'Space Grotesk',sans-serif; font-size:16px; word-break:break-word; }
  @media (max-width:620px) { .invoice-hero .meta > div:last-child { text-align:left; } }
  .invoice-block { margin:0 0 20px; break-inside:avoid; page-break-inside:avoid; }
  .invoice-block-label { font-family:'Space Mono',monospace; font-size:11px; font-weight:700; letter-spacing:.22em; text-transform:uppercase; color:var(--ink-soft); margin:0 0 10px; }
  .invoice-block .card { padding:clamp(14px,2.4vw,22px); }
  .invoice-block .stat-row { padding:12px 0; }
  #invoice-contact-footer-section { width:100%; padding:16px 0 0; margin-top:4px; border-top:1px solid var(--line); justify-content:space-between; align-items:center; gap:16px; }
  /* Grid, not flex-wrap: the code stays beside the details at every width.
     A wrapping flex row let the details card's min-content width shove the
     code onto its own line, stranding it under the block. */
  .invoice-payment-split { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:18px; align-items:start; }
  .invoice-payment-split > .card { min-width:0; }
  .invoice-payment-qr { margin:0; display:flex; align-items:center; justify-content:center; padding:14px; border:1px solid var(--line); border-radius:18px; background:#fff; }
  .invoice-payment-qr img { display:block; width:150px; height:150px; image-rendering:pixelated; }
  /* Narrow sheets shrink the code rather than moving it. */
  @media (max-width:560px) {
    .invoice-payment-split { gap:12px; }
    .invoice-payment-qr { padding:8px; }
    .invoice-payment-qr img { width:104px; height:104px; }
  }
  /* Fact rows: label left, value right, hairline between. Deliberately not
     cards — three stacked identity cards was chrome competing with content,
     and this reads as a ledger, which is what an invoice is. */
  .invoice-facts { margin:0; display:block; }
  .invoice-fact { display:grid; grid-template-columns:minmax(120px,34%) minmax(0,1fr); gap:14px; padding:9px 0; border-bottom:1px solid var(--line); align-items:baseline; }
  .invoice-fact:last-child { border-bottom:none; }
  .invoice-fact dt { font-family:'Space Mono',monospace; font-size:10px; letter-spacing:.18em; text-transform:uppercase; }
  .invoice-fact dd { margin:0; font-family:'Space Grotesk',sans-serif; font-size:13px; line-height:1.45; min-width:0; overflow-wrap:anywhere; }
  /* 2D by nature (two independent columns of rows), so Grid, not flex-wrap. */
  .invoice-two-up { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:0 40px; }
  .invoice-status { font-family:'Space Mono',monospace; font-size:10px; letter-spacing:.16em; text-transform:uppercase; border:1px solid var(--ink); padding:2px 8px; border-radius:999px; }
  .invoice-status.is-paid { background:var(--ink); color:#fff; }
  /* The one number the reader has to act on gets the weight. */
  .invoice-balance { display:flex; justify-content:space-between; align-items:baseline; gap:16px; flex-wrap:wrap; margin-top:14px; padding-top:14px; border-top:2px solid var(--ink); }
  .invoice-balance-label { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; }
  .invoice-balance-value { font-family:'Doto',monospace; font-weight:900; font-size:clamp(26px,4.4vw,44px); line-height:1; }
  .invoice-balance-currency { font-family:'Space Mono',monospace; font-weight:400; font-size:12px; letter-spacing:.14em; }
  .invoice-due-of { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; opacity:.72; }
  .invoice-paid-mark { margin-top:10px; font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.2em; text-transform:uppercase; }
  .invoice-item-group { margin:0 0 18px; }
  .invoice-item-row { display:grid; grid-template-columns:minmax(0,1fr) 82px 104px 116px; gap:14px; align-items:baseline; width:100%; padding:11px 0; border-bottom:1px solid var(--line); }
  .invoice-item-row:last-child { border-bottom:none; }
  .invoice-item-head { padding:6px 0; border-bottom:1px solid var(--ink); font-family:'Space Mono',monospace; font-size:10px; letter-spacing:.18em; text-transform:uppercase; }
  .invoice-item-head > div { font-family:'Space Mono',monospace; font-size:10px; font-weight:400; letter-spacing:.18em; text-transform:uppercase; }
  .invoice-item-task { min-width:0; display:flex; flex-direction:column; gap:3px; }
  .invoice-item-name { font-family:'Space Grotesk',sans-serif; font-size:13px; line-height:1.4; }
  .invoice-item-detail { font-family:'Space Grotesk',sans-serif; font-size:12px; line-height:1.4; opacity:.72; }
  .invoice-item-hours, .invoice-item-rate, .invoice-item-amount { font-family:'Space Mono',monospace; font-size:13px; text-align:right; white-space:nowrap; }
  .invoice-item-amount { font-weight:700; }
  @media (max-width:560px) {
    .invoice-item-row { grid-template-columns:minmax(0,1fr) auto; row-gap:4px; }
    .invoice-item-task { grid-column:1 / -1; }
    .invoice-item-hours, .invoice-item-rate { text-align:left; opacity:.72; font-size:11px; }
    .invoice-item-amount { grid-column:2; }
  }
  .invoice-recommendation-name { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:clamp(17px,2.6vw,21px); line-height:1.3; margin:0 0 10px; color:var(--ink); }
  .invoice-list { margin:0; padding-left:18px; color:var(--ink); font-family:'Space Grotesk'; font-size:15px; line-height:1.65; }
  .invoice-list li { margin:0 0 8px; }
  .invoice-total-value { font-family:'Doto'; font-size:clamp(34px,5.6vw,62px); font-weight:900; letter-spacing:0; line-height:.88; color:var(--ink); }
  .invoice-link { color:var(--ink); text-decoration:underline; text-underline-offset:4px; word-break:break-all; }
  .invoice-category-label { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:12px; }
  .invoice-subitem-list { list-style:none; margin:10px 0 0; padding:0 0 0 18px; border-left:1px dashed var(--line); }
  .invoice-subitem-list li { display:flex; justify-content:space-between; gap:12px; font-family:'Space Grotesk'; font-size:13px; color:var(--ink-soft); padding:4px 0; }
  .invoice-chip-row { display:flex; flex-wrap:wrap; gap:8px; }
  .invoice-chip { display:inline-block; padding:7px 14px; border:1px solid var(--line); border-radius:999px; background:rgba(255,255,255,.55); font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.08em; }
  .invoice-pdf-link { position:fixed; top:16px; right:16px; z-index:10; display:inline-block; padding:10px 18px; border-radius:999px; background:var(--ink); color:#fefdf9; font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.12em; text-transform:uppercase; text-decoration:none; box-shadow:0 4px 16px rgba(0,0,0,.18); }
  @page { margin:12mm; }
  @media print {
    .invoice-pdf-link { display:none; }
    .invoice-sheet { max-width:none; margin:0; padding:0; }
    .invoice-block { margin-bottom:14px; }
    .invoice-hero { margin-bottom:16px; padding-bottom:14px; }
  }
`;

// Enabled-but-empty sections skip themselves (honest empty state), which can
// leave a near-blank document that reads as a broken render. renderInvoiceDocument
// reports which enabled sections actually produced output so a caller — the
// Invoice Builder's live preview — can say WHY the page looks sparse instead of
// leaving the operator guessing.
//
// options.brand — { logo, signature, wordmark } | null (default). null (or
// omitted) means the document carries NO HITLOOP logo, NO signature image,
// NO cover wordmark headline, and no data URI for any of it — not an empty
// <img>, nothing at all. A caller that wants today's look (the server
// publish path) passes the HITLOOP marks explicitly, e.g.
// `{ brand: HITLOOP_BRAND }` from features/invoices/brand-marks.js.
//
// options.defaultFrom — the identity blank `from.*` fields backfill from,
// forwarded to normalizeInvoice() (see model.js for the full contract).
// Omitted (or `null`) means NO backfill — blank fields stay blank. A caller
// that wants the real owner identity (the server publish path, the admin
// Studio path) must explicitly import DEFAULT_FROM from
// features/invoices/default-from.js and pass it here.
//
// options.paymentQr — an already-resolved `{ label, handle, dataUri }` | null
// (default). render.js does not import payment-qr.js itself (same bundle
// reasoning as `brand`/`defaultFrom` — that module's Venmo QR data URI and
// handle must not sit in a bundle that never asked for them), so a caller
// that wants the invoice's payment.qr key resolved to an actual code must
// resolve it itself (`resolvePaymentQr(invoice.payment.qr)`, imported from
// features/invoices/payment-qr.js) and pass the result here. Omitted, no QR
// image renders even when the invoice's own payment.qr key is set.
//
// options.editable — boolean, default off. When true, every text-bearing
// leaf that maps to an addressable draft path (see the Invoice Studio plan's
// §4.1 FIELD_PATHS grammar) is wrapped with data-inv-field/data-inv-type
// (+ data-inv-raw for money/number/date), computed values carry
// data-inv-derived, section wrappers carry data-inv-section, and repeatable
// rows carry data-inv-row. No <script> is ever injected — the Studio canvas
// is a same-origin iframe that attaches its own listeners. Off (the
// default), none of the above appears and the output is unchanged.
export function renderInvoiceDocument(invoice, options = {}) {
  const inv = normalizeInvoice(invoice || {}, { clientId: options.clientId, defaultFrom: options.defaultFrom });
  const order = resolveInvoiceSections(options.sections || null);
  const rendered = [];
  const skipped = [];

  // ── Theme + print geometry (design-layer plan §3.3, Q3) ─────────────────
  // theme:null/omitted (the default — L1) must leave every value below at
  // its empty/'' state so the document head is byte-identical to before this
  // option existed; see the pinned byte-identity test in invoices.test.js and
  // this lane's own invoice-themes.test.js.
  const theme = normalizeTheme(options.theme);
  // options.paper is an independent, optional override (§3.3): "theme.paper
  // wins" — it is only ever consulted when there is NO theme at all. An
  // unrecognized value collapses to null exactly like normalizeTheme() does
  // for an unknown theme id, rather than being passed through raw.
  const explicitPaper = !theme && (options.paper === 'letter' || options.paper === 'a4' || options.paper === 'fluid')
    ? options.paper
    : null;
  // themeToCss() already emits its own @page rule (size+margin for
  // letter/a4, margin-only for fluid) as the tail of its returned string —
  // see that function's own comment. This adds ONLY the print-color-adjust
  // fix on top (needed for a themed background — Studio Dark's dark ground
  // in particular — to survive an actual print/PDF; browsers otherwise drop
  // backgrounds by default). Conditioned on `theme` so the untouched default
  // never gains this text (would otherwise perturb the golden fixture).
  const themeCss = theme
    ? `${themeToCss(theme)}\nhtml[data-invoice-theme="${theme.id}"], body[data-invoice-theme="${theme.id}"] { -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }`
    : '';
  const themeFontHref = theme ? themeFontsHref(theme) : '';
  // Standalone Letter/A4 geometry (no theme) — L8: "only explicit non-fluid
  // output adds size/geometry overrides". `paper:'fluid'` with no theme is
  // intentionally a no-op (the untouched default's own `@page{margin:12mm;}`
  // in INVOICE_CSS already stands). Margins default to 'normal' (14mm,
  // matching theme-schema.js's own MARGIN_MM.normal) — there is no theme
  // object here to read a margin preference from.
  const paperOnlyCss = explicitPaper === 'letter' || explicitPaper === 'a4'
    ? `@page{size:${explicitPaper};margin:14mm;}`
    : '';
  // Print pagination (Q3's own explicit scope): per-row and totals no-split
  // protection, plus a targeted override that lets the LINE ITEMS section
  // itself flow/split across a page boundary (a long item list is naturally
  // taller than one page — forcing the whole block to avoid breaking would
  // either overflow the page or force it onto its own page, neither of which
  // stops a row splitting) while each row (.invoice-item-row) and the totals
  // figure (.invoice-balance) still individually avoid a mid-row/mid-figure
  // split. `#invoice-line-items-section`'s id beats the static `.invoice-block`
  // class (INVOICE_CSS, always emitted) on specificity, so it un-does that
  // rule's break-inside:avoid for this one section without touching the
  // shared class.
  //
  // Conditional on theme/explicitPaper for the same reason paperOnlyCss is:
  // the untouched Default (no theme, no options.paper) must stay
  // byte-identical to the golden fixture (L1) — this pass does not change
  // how the Default prints. The fix ships wherever a document actually opts
  // into real print geometry, either a built-in theme or an explicit `paper`
  // override; see this lane's manual verification (25-item Letter check
  // under Ledger/Editorial).
  const paginationCss = theme || explicitPaper === 'letter' || explicitPaper === 'a4'
    ? '.invoice-item-row{break-inside:avoid;page-break-inside:avoid;}'
      + '.invoice-balance{break-inside:avoid;page-break-inside:avoid;}'
      + '#invoice-line-items-section{break-inside:auto;page-break-inside:auto;}'
    : '';
  // Both computed as '' when nothing to add, so interpolating them directly
  // into the head template below contributes NOTHING (not even a blank
  // line) to the default byte-identical case.
  const extraFontLinkHtml = themeFontHref ? `\n  <link rel="stylesheet" href="${esc(themeFontHref)}"/>` : '';
  const extraStyleHtml = [themeCss, paperOnlyCss, paginationCss]
    .filter(Boolean)
    .map((css) => `\n  <style>${css}</style>`)
    .join('');

  // Document-kind + editable-label terminology (design-layer plan L16,
  // §3.1) — resolved ONCE per render and threaded to every section builder
  // via `options.labels`, so the renderer and the rail (SectionCard.jsx)
  // never disagree about what a section is called. Every builder falls back
  // to its own historical hardcoded literal when a given key resolves to
  // nothing (defensive only — resolveInvoiceLabels() always returns a full
  // set), which is what keeps the default (docKind absent, labels:{})
  // output byte-identical to before this option existed.
  const optionsWithLabels = { ...options, labels: resolveInvoiceLabels(inv) };

  const sectionsHtml = order
    .filter((id) => id !== 'contactFooter')
    .map((id) => {
      const html = SECTION_BUILDERS[id]?.(inv, optionsWithLabels) || '';
      (html ? rendered : skipped).push(id);
      return html;
    })
    .filter(Boolean)
    .join('\n');

  const footerHtml = order.includes('contactFooter') ? buildContactFooter(inv, optionsWithLabels) : '';
  if (order.includes('contactFooter')) (footerHtml ? rendered : skipped).push('contactFooter');

  const pdfLink = options.pdfPath
    ? `<a id="invoice-pdf-download-link" class="invoice-pdf-link" href="${esc(resolvePdfHref(options))}" target="_blank" rel="noopener noreferrer">Download PDF</a>`
    : '';

  const html = `<!doctype html>
<html lang="en"${theme ? ` data-invoice-theme="${esc(theme.id)}"` : ''}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(inv.projectTitle)} · ${esc(inv.invoiceNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300..700&family=Space+Mono:wght@400;700&display=swap"/>${extraFontLinkHtml}
  <style>${BRIEF_CSS}</style>
  <style>${INVOICE_CSS}</style>${extraStyleHtml}
</head>
<body>
  ${pdfLink}
  <main class="invoice-sheet">
    ${sectionsHtml}
    ${footerHtml}
  </main>
</body>
</html>`;

  // Rough content height at the PDF's 1200px width, used to size the PDF page
  // box so an invoice prints as ONE page instead of paginating mid-total.
  // Deliberately generous — overshooting adds trailing whitespace, while
  // undershooting splits the document, which is the failure that matters.
  const itemCount = inv.categories.reduce((n, cat) => n + cat.items.length, 0) + inv.standaloneItems.length;
  const estimatedHeightPx = 220 // sheet padding
    + (rendered.includes('cover') ? 300 : 0)
    + (rendered.includes('invoiceMeta') ? 330 : 0)
    + (rendered.includes('billTo') ? 190 : 0)
    + (rendered.includes('lineItems') ? 130 + itemCount * 62 + inv.categories.length * 40 : 0)
    + (rendered.includes('standaloneItems') ? 120 : 0)
    + (rendered.includes('totals') ? 230 : 0)
    + (rendered.includes('deposit') ? 200 : 0)
    + (rendered.includes('recommendation') ? 220 : 0)
    + (rendered.includes('flow') ? 260 : 0)
    + (rendered.includes('terms') ? 60 + inv.terms.length * 34 : 0)
    + (rendered.includes('payment') ? 250 : 0)
    + (rendered.includes('notes') ? 120 : 0)
    + (rendered.includes('contactFooter') ? 90 : 0);

  return { html, renderedSections: rendered, skippedSections: skipped, estimatedHeightPx };
}

// Thin wrapper — the document string alone, for callers that only publish it.
export function renderInvoiceHtml(invoice, options = {}) {
  return renderInvoiceDocument(invoice, options).html;
}

export default renderInvoiceHtml;
