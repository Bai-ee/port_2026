// Invoice Studio — shared field grammar (docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md §4.1).
//
// The single definition of "which paths on an invoice draft are editable,
// what type they are, and how to get/set them" — both the rail (native
// inputs bound to draft values) and the canvas bridge (contenteditable DOM
// nodes bound to the same draft, per §4.2) go through this file, so the two
// views can never disagree about a field's shape.
//
// Client-safe on purpose: only imports features/invoices/model.js (pure ESM,
// no createRequire). Do NOT import render.js, brand-marks.js, payment-qr.js,
// or any .cjs here — any of those break `next dev` the moment this file is
// pulled into a client bundle (see model.js's own header comment).

import { formatMoney } from '../../../../features/invoices/model.js';

// ── Path grammar ────────────────────────────────────────────────────────
// A path is dot-separated segments; a segment may carry one bracket suffix
// addressing into an array: `key` or `key[bracket]`. Two addressing modes,
// chosen by which key owns the array (mirrors how the row actually gets
// looked up in the draft — see useInvoiceDraft.js's mutators):
//   - id-keyed:    categories, items, standaloneItems — bracket is a row's
//                  stable `id` (both normalizeInvoice and the card mint one
//                  per row and keep it across edits).
//   - index-keyed: everything else that takes a bracket (subItems, terms,
//                  recommendation.chips, flowSteps) — these rows carry no id
//                  in the draft shape, so the bracket is a plain array index.
const ID_KEYED_ARRAY_KEYS = new Set(['categories', 'items', 'standaloneItems']);

const PATH_SEGMENT_RE = /^([a-zA-Z0-9_]+)(?:\[([^\]]+)\])?$/;

// Splits "categories[cat-1].items[item-1].name" into
// [{key:'categories',bracket:'cat-1'}, {key:'items',bracket:'item-1'}, {key:'name',bracket:undefined}].
// Row ids/indices never contain '.', so a plain split on '.' is safe.
function parsePath(path) {
  const raw = String(path ?? '');
  return raw.split('.').map((segment) => {
    const match = PATH_SEGMENT_RE.exec(segment);
    if (!match) throw new Error(`invoice-fields: malformed path segment "${segment}" in "${raw}"`);
    return { key: match[1], bracket: match[2] };
  });
}

// The same path with every bracket's contents blanked — "categories[cat-1].items[item-1].name"
// -> "categories[].items[].name". This is the shape FIELD_PATHS entries are
// keyed by, so one template entry covers every row instance.
function templateOf(path) {
  return String(path ?? '').replace(/\[[^\]]*\]/g, '[]');
}

function findArrayIndex(list, key, bracket) {
  if (ID_KEYED_ARRAY_KEYS.has(key)) return list.findIndex((row) => row && row.id === bracket);
  const idx = Number(bracket);
  return Number.isInteger(idx) ? idx : -1;
}

/** Read a value out of a draft by path. Returns undefined for any path that
 * doesn't resolve (missing row, wrong shape) rather than throwing — a stale
 * canvas node referencing a since-removed row should read as "gone", not
 * crash the bridge. */
export function getAtPath(draft, path) {
  const tokens = parsePath(path);
  let node = draft;
  for (const token of tokens) {
    if (node == null) return undefined;
    node = node[token.key];
    if (token.bracket !== undefined) {
      if (!Array.isArray(node)) return undefined;
      const idx = findArrayIndex(node, token.key, token.bracket);
      node = idx >= 0 ? node[idx] : undefined;
    }
  }
  return node;
}

function setAtTokens(node, tokens, i, value) {
  if (i === tokens.length) return value;
  const token = tokens[i];
  if (token.bracket === undefined) {
    const base = node && typeof node === 'object' && !Array.isArray(node) ? node : {};
    return { ...base, [token.key]: setAtTokens(base[token.key], tokens, i + 1, value) };
  }
  const base = node && typeof node === 'object' && !Array.isArray(node) ? node : {};
  const list = Array.isArray(base[token.key]) ? base[token.key] : [];
  const idx = findArrayIndex(list, token.key, token.bracket);
  // Bracket doesn't resolve to an existing row (e.g. edit event fired after
  // the row was removed elsewhere) — no-op rather than fabricate a row out
  // of an edit event; the mutators (add*/remove*) own row creation.
  if (idx < 0) return node;
  const nextList = list.slice();
  nextList[idx] = setAtTokens(list[idx], tokens, i + 1, value);
  return { ...base, [token.key]: nextList };
}

/** Immutable set — returns a NEW draft with structural sharing: every
 * ancestor on the path is shallow-copied, every untouched sibling (other
 * categories, other items, other draft fields) keeps its original
 * reference. Unresolvable paths return `draft` unchanged (see setAtTokens). */
export function setAtPath(draft, path, value) {
  return setAtTokens(draft, parsePath(path), 0, value);
}

// ── Value parse/format ──────────────────────────────────────────────────
// parseValue: raw typed/pasted text -> a value fit to live in the draft.
// formatValue: a draft value -> the display text a UI should show for it
// (what canvas patchNodes() writes into textContent, and what a rail text
// input's value should be). Native rail widgets that want a specific wire
// format regardless of "pretty" display (`<input type="date">` wants ISO,
// `<input type="number">` wants a bare number) read/write the draft value
// directly via getAtPath/setAtPath instead of through formatValue — see
// useInvoiceDraft.js.

function stripMoneyChars(raw) {
  // Strip everything but digits, '.', and a leading '-' — handles "$1,234.50",
  // "1234.50", pasted currency symbols, stray whitespace.
  return String(raw ?? '').replace(/[^0-9.-]/g, '');
}

function parseNumeric(raw) {
  const cleaned = stripMoneyChars(raw);
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Bare YYYY-MM-DD parses as UTC midnight, which renders as the PREVIOUS day
// in any negative-offset timezone. Mirrors render.js's toLocalDate/formatDate
// (duplicated here, not imported — render.js pulls a .cjs module and this
// file must stay client-safe). Keep the two in sync if either changes.
function toLocalDate(iso) {
  if (!iso) return new Date(NaN);
  const value = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T00:00:00` : iso;
  return new Date(value);
}

// `locale` defaults to 'en-US' so every existing 1/2-arg caller (rail cards
// that never pass a locale) keeps today's exact "Sep 2, 2026" output — a
// caller that resolves a non-default invoice.locale (design-layer plan
// §3.1) passes it as the 2nd argument.
function formatDatePretty(iso, locale = 'en-US') {
  const date = toLocalDate(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString(locale || 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

// Best-effort free-text -> ISO date. A canvas date node is contenteditable
// plain text, so input can be anything a person types ("9/2/2026", "Sep 2
// 2026"); an unparseable string passes through unchanged rather than
// clobbering the field — normalizeInvoice() is the safety net on publish.
function parseDateText(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
}

export function parseValue(type, rawText) {
  switch (type) {
    case 'money':
    case 'number':
      return parseNumeric(rawText);
    case 'date':
      return parseDateText(rawText);
    case 'enum':
      return String(rawText ?? '').trim();
    case 'derived':
      // Not user-editable; pass through so a defensive caller doesn't throw.
      return rawText;
    case 'text':
    case 'multiline':
    default:
      // Never trim here — trimming mid-keystroke (a trailing space while
      // still typing) would fight the user's cursor. Committing surfaces
      // (blur, publish) trim via normalizeInvoice()/cleanString.
      return String(rawText ?? '');
  }
}

export function formatValue(type, value, currency = 'USD', locale = 'en-US') {
  switch (type) {
    case 'money':
      return formatMoney(value, currency, locale);
    case 'number':
      return String(Number.isFinite(Number(value)) ? Number(value) : 0);
    case 'date':
      return formatDatePretty(value, locale);
    case 'enum':
    case 'text':
    case 'multiline':
    case 'derived':
    default:
      return String(value ?? '');
  }
}

// ── Field catalog ────────────────────────────────────────────────────────
// One entry per path TEMPLATE (bracket contents blanked — see templateOf).
// `section` is an features/invoices/registry.js section id: it's what a
// `data-inv-section` wrapper in the rendered document carries (§4.4.3), so
// the bridge can open/highlight the right RailCard from a focused canvas
// node. Assignments below are matched 1:1 against render.js's current
// section builders (buildInvoiceMeta, buildBillTo, buildTotals, buildDeposit,
// etc.) except projectTitle/projectSubtitle, which have no other honest home
// than the 'projectSummary' section id despite render.js not yet placing
// them in its body — see the P0 handoff report for the full note.
const FIELD_PATHS = [
  // Masthead override — resolveInvoiceLabels() (model.js) reads this exact
  // key first; blank/absent falls back to the doc-kind default title ("Invoice",
  // "Quote", ...). Lives under the cover section id since it's rendered in
  // hero(), the cover block.
  { path: 'labels.title', type: 'text', label: 'Document title', section: 'cover', editable: true },
  { path: 'invoiceNumber', type: 'text', label: 'Invoice #', section: 'invoiceMeta', editable: true },
  { path: 'currency', type: 'text', label: 'Currency', section: 'invoiceMeta', editable: true },
  { path: 'status', type: 'enum', label: 'Status', section: 'invoiceMeta', editable: true },
  { path: 'issueDate', type: 'date', label: 'Issue date', section: 'invoiceMeta', editable: true },
  { path: 'dueDate', type: 'date', label: 'Due date', section: 'invoiceMeta', editable: true },
  { path: 'paymentTerms', type: 'text', label: 'Payment terms', section: 'invoiceMeta', editable: true },
  { path: 'poNumber', type: 'text', label: 'PO number', section: 'invoiceMeta', editable: true },
  { path: 'servicePeriod.start', type: 'date', label: 'Service period start', section: 'invoiceMeta', editable: true },
  { path: 'servicePeriod.end', type: 'date', label: 'Service period end', section: 'invoiceMeta', editable: true },

  { path: 'projectTitle', type: 'text', label: 'Project title', section: 'projectSummary', editable: true },
  { path: 'projectSubtitle', type: 'text', label: 'Project subtitle', section: 'projectSummary', editable: true },
  { path: 'notes', type: 'multiline', label: 'Notes', section: 'notes', editable: true },

  { path: 'from.name', type: 'text', label: 'From — name', section: 'invoiceMeta', editable: true },
  { path: 'from.legalName', type: 'text', label: 'From — legal name', section: 'invoiceMeta', editable: true },
  { path: 'from.taxId', type: 'text', label: 'From — tax ID', section: 'invoiceMeta', editable: true },
  { path: 'from.email', type: 'text', label: 'From — email', section: 'invoiceMeta', editable: true },
  { path: 'from.phone', type: 'text', label: 'From — phone', section: 'invoiceMeta', editable: true },
  { path: 'from.site', type: 'text', label: 'From — site', section: 'invoiceMeta', editable: true },
  { path: 'from.address', type: 'multiline', label: 'From — address', section: 'invoiceMeta', editable: true },

  { path: 'billTo.name', type: 'text', label: 'Bill to — name', section: 'billTo', editable: true },
  { path: 'billTo.contact', type: 'text', label: 'Bill to — contact', section: 'billTo', editable: true },
  { path: 'billTo.email', type: 'text', label: 'Bill to — email', section: 'billTo', editable: true },
  { path: 'billTo.address', type: 'multiline', label: 'Bill to — address', section: 'billTo', editable: true },

  { path: 'categories[].name', type: 'text', label: 'Category name', section: 'lineItems', editable: true },
  { path: 'categories[].items[].name', type: 'text', label: 'Item name', section: 'lineItems', editable: true },
  { path: 'categories[].items[].note', type: 'text', label: 'Item note', section: 'lineItems', editable: true },
  { path: 'categories[].items[].qty', type: 'number', label: 'Qty', section: 'lineItems', editable: true },
  { path: 'categories[].items[].unitPrice', type: 'money', label: 'Unit price', section: 'lineItems', editable: true },
  // Free-text override of the qty x unitPrice display ("$0-79/mo", "Included")
  // — never money-parsed, matches model.js normalizeItem's costLabel handling.
  { path: 'categories[].items[].costLabel', type: 'text', label: 'Cost label', section: 'lineItems', editable: true },
  { path: 'categories[].items[].subItems[].name', type: 'text', label: 'Sub-item name', section: 'lineItems', editable: true },
  { path: 'categories[].items[].subItems[].cost', type: 'text', label: 'Sub-item cost', section: 'lineItems', editable: true },

  { path: 'standaloneItems[].name', type: 'text', label: 'Item name', section: 'standaloneItems', editable: true },
  { path: 'standaloneItems[].note', type: 'text', label: 'Item note', section: 'standaloneItems', editable: true },
  { path: 'standaloneItems[].qty', type: 'number', label: 'Qty', section: 'standaloneItems', editable: true },
  { path: 'standaloneItems[].unitPrice', type: 'money', label: 'Unit price', section: 'standaloneItems', editable: true },
  { path: 'standaloneItems[].costLabel', type: 'text', label: 'Cost label', section: 'standaloneItems', editable: true },
  { path: 'standaloneItems[].subItems[].name', type: 'text', label: 'Sub-item name', section: 'standaloneItems', editable: true },
  { path: 'standaloneItems[].subItems[].cost', type: 'text', label: 'Sub-item cost', section: 'standaloneItems', editable: true },

  { path: 'totals.subtotal', type: 'money', label: 'Subtotal', section: 'totals', editable: true },
  { path: 'totals.discount', type: 'money', label: 'Discount', section: 'totals', editable: true },
  { path: 'totals.discountLabel', type: 'text', label: 'Discount label', section: 'totals', editable: true },
  { path: 'totals.tax', type: 'money', label: 'Tax', section: 'totals', editable: true },
  { path: 'totals.taxLabel', type: 'text', label: 'Tax label', section: 'totals', editable: true },
  { path: 'totals.total', type: 'money', label: 'Total', section: 'totals', editable: true },
  { path: 'totals.amountPaid', type: 'money', label: 'Amount already paid', section: 'totals', editable: true },
  { path: 'totals.deposit', type: 'money', label: 'Amount due now', section: 'deposit', editable: true },
  { path: 'totals.depositLabel', type: 'text', label: 'Amount-due heading', section: 'deposit', editable: true },
  // model.js's computeTotals passes these through cleanString (free text),
  // never through formatMoney — matching that contract (not the card's own
  // <input type="number"> control, which is stricter than the shared model
  // needs) is what keeps a round-trip through normalizeInvoice() lossless.
  { path: 'totals.monthlyLabel', type: 'text', label: 'Monthly label', section: 'deposit', editable: true },
  { path: 'totals.monthlyValue', type: 'text', label: 'Monthly value', section: 'deposit', editable: true },
  { path: 'totals.oneTimeLabel', type: 'text', label: 'One-time label', section: 'deposit', editable: true },
  { path: 'totals.oneTimeValue', type: 'text', label: 'One-time value', section: 'deposit', editable: true },

  { path: 'recommendation.name', type: 'text', label: 'Package name', section: 'recommendation', editable: true },
  { path: 'recommendation.body', type: 'multiline', label: 'Recommendation body', section: 'recommendation', editable: true },
  { path: 'recommendation.chips[]', type: 'text', label: 'Highlight chip', section: 'recommendation', editable: true },

  { path: 'flowSteps[].platform', type: 'text', label: 'Platform', section: 'flow', editable: true },
  { path: 'flowSteps[].color', type: 'text', label: 'Color', section: 'flow', editable: true },
  { path: 'flowSteps[].label', type: 'text', label: 'Label', section: 'flow', editable: true },
  { path: 'flowSteps[].tech', type: 'text', label: 'Tech', section: 'flow', editable: true },

  { path: 'terms[]', type: 'text', label: 'Term', section: 'terms', editable: true },

  { path: 'payment.method', type: 'text', label: 'Payment method', section: 'payment', editable: true },
  { path: 'payment.instructions', type: 'multiline', label: 'Payment instructions', section: 'payment', editable: true },
  { path: 'payment.link', type: 'text', label: 'Payment link', section: 'payment', editable: true },
];

const FIELD_META_BY_TEMPLATE = new Map(FIELD_PATHS.map((entry) => [entry.path, entry]));

/** Resolve a real path (real ids/indices) to its catalog entry's
 * {type, section, editable}. Undefined for anything not in FIELD_PATHS
 * (e.g. payment.qr / payment.handle — deliberately outside the public
 * editable grammar, see D8/D10). */
export function fieldMeta(path) {
  const entry = FIELD_META_BY_TEMPLATE.get(templateOf(path));
  if (!entry) return undefined;
  const { type, section, editable, label } = entry;
  return { type, section, editable, label };
}

export { FIELD_PATHS };

// ── Structure key (§4.3 re-render policy) ──────────────────────────────
// A cheap deterministic fingerprint (not a cryptographic hash — a plain
// canonical string is enough since the only operation is equality-checking
// against the previous render) over everything that changes DOM shape:
// section include/order, currency/status (both feed section bodies that
// gate on them — e.g. the "paid" stamp), every stable row id in its current
// order (categories, their items, standaloneItems — a reorder or add/remove
// needs new DOM), and the plain counts of the four id-less arrays (terms,
// chips, flowSteps, subItems per item) since those only need a re-render
// when a row is added/removed, never when their text changes (that's a
// live patch, not structural — D4).
//
// `sections` is the card's own shape (see useInvoiceDraft.js /
// InvoiceBuilderCard.jsx's defaultSections/normalizeSectionsShape):
// { include: {id: boolean}, order: string[] } — a flat ordered id list, NOT
// registry.js's { order: { sections: [...] } } nesting.
//
// `theme` (design-layer plan L7, added Q0) is a ThemePreset | null
// (app/dashboard/studio/invoice/themes/theme-schema.js's normalizeTheme()
// return shape) — optional and defaults to null so every pre-theme caller
// (still 2-arg today) keeps producing the exact same key it always has.
// Only theme id/paper/margins feed the key (not colors/fonts/why): those are
// the only theme fields that change DOM shape (the `data-invoice-theme`
// marker + @page geometry) — a color-only preset swap is a value patch, not
// a structural one, same reasoning as every other field below.
export function structureKey(draft, sections, theme = null) {
  const inv = draft && typeof draft === 'object' ? draft : {};
  const sec = sections && typeof sections === 'object' ? sections : { include: {}, order: [] };
  const include = sec.include && typeof sec.include === 'object' ? sec.include : {};
  const order = Array.isArray(sec.order) ? sec.order : [];
  const categories = Array.isArray(inv.categories) ? inv.categories : [];
  const standaloneItems = Array.isArray(inv.standaloneItems) ? inv.standaloneItems : [];
  const labels = inv.labels && typeof inv.labels === 'object' ? inv.labels : {};

  const parts = [
    Object.keys(include).sort().map((id) => `${id}:${include[id] !== false ? 1 : 0}`).join(','),
    order.join(','),
    String(inv.currency || ''),
    String(inv.status || ''),
    categories.map((c) => `${c?.id}[${(Array.isArray(c?.items) ? c.items : []).map((it) => it?.id).join(',')}]`).join('|'),
    standaloneItems.map((it) => it?.id).join(','),
    `terms=${Array.isArray(inv.terms) ? inv.terms.length : 0}`,
    `chips=${Array.isArray(inv.recommendation?.chips) ? inv.recommendation.chips.length : 0}`,
    `flowSteps=${Array.isArray(inv.flowSteps) ? inv.flowSteps.length : 0}`,
    // Sub-item counts, in category/item order then standalone order — a
    // sub-item add/remove on any single item is still structural even
    // though that item's own id is unchanged.
    categories.flatMap((c) => (Array.isArray(c?.items) ? c.items : []).map((it) => (Array.isArray(it?.subItems) ? it.subItems.length : 0))).join(','),
    standaloneItems.map((it) => (Array.isArray(it?.subItems) ? it.subItems.length : 0)).join(','),
    // docKind/labels/locale/logo — design-layer plan L7. Labels are sorted
    // key:value pairs (order-independent, matches the `include` treatment
    // above); logo is presence + length only (never the data itself — a
    // multi-hundred-KB base64 string has no business inside a fingerprint).
    `docKind=${inv.docKind || ''}`,
    `labels=${Object.keys(labels).sort().map((k) => `${k}:${labels[k]}`).join(',')}`,
    `locale=${inv.locale || ''}`,
    `logo=${inv.logoDataUrl ? inv.logoDataUrl.length : 0}`,
    // Theme — id/paper/margins only, see the doc comment above.
    `theme=${theme?.id || ''}:${theme?.paper || ''}:${theme?.margins || ''}`,
  ];
  return parts.join('#');
}

// ── Rendered index <-> draft index ──────────────────────────────────────
// model.js drops rows when rendering four array kinds — terms/chips via
// normalizeList (non-empty trimmed string survives), flowSteps (platform ||
// label survives), subItems (name survives). A canvas `data-inv-row`
// attribute on the Nth *rendered* row must map back to the row's real index
// in the *draft* array (which still has the holes) before a rail/draft edit
// can target it. `list` is the raw draft array itself — callers already
// have it in hand (draft.terms, draft.recommendation.chips, draft.flowSteps,
// or one item's own .subItems — subItems has no single owner array, so this
// takes the list directly rather than `(draft)` + an item/category id).
const RENDER_KEEP_FILTERS = {
  terms: (row) => String(row ?? '').trim().length > 0,
  chips: (row) => String(row ?? '').trim().length > 0,
  flowSteps: (row) => Boolean(String(row?.platform ?? '').trim() || String(row?.label ?? '').trim()),
  subItems: (row) => String(row?.name ?? '').trim().length > 0,
};

export function renderedIndexToDraftIndex(kind, list, renderedIndex) {
  const keep = RENDER_KEEP_FILTERS[kind];
  const rows = Array.isArray(list) ? list : [];
  if (!keep || renderedIndex < 0) return -1;
  let seen = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (keep(rows[i])) {
      seen += 1;
      if (seen === renderedIndex) return i;
    }
  }
  return -1;
}
