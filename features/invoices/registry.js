// Invoice section registry — which blocks renderInvoiceHtml() renders and in
// what order. Mirrors the include/order pattern in
// features/scout-intake/creative-brief-config.cjs (unknown ids dropped,
// missing ids appended in registry order, absent config = defaults = zero
// risk) but flat: invoice sections aren't grouped, they're one reorderable
// list, so `order` carries a single `sections` array instead of per-group
// arrays.

export const INVOICE_SECTIONS = [
  // Hints below are corrected to match render.js's as-built section builders
  // (Invoice Studio design-layer plan Q0) — several used to describe fields
  // (project title/subtitle, "payment pills") those builders never actually
  // print. `label` for standaloneItems is corrected to match the printed
  // heading too (buildStandaloneItems -> "Additional items", not "Standalone
  // items" — see app/dashboard/studio/invoice/rail/StandaloneItemsCard.jsx's
  // own header comment on this exact drift).
  { id: 'cover', label: 'Cover', hint: 'Header splash: invoice number, bill-to name, and issue/due dates.', defaultOn: true },
  { id: 'invoiceMeta', label: 'Invoice details', hint: 'Invoice number, status, issue/due dates, terms, and who it is from.', defaultOn: true },
  { id: 'billTo', label: 'Bill to', hint: 'Client name, contact, email, and address.', defaultOn: true },
  { id: 'projectSummary', label: 'Project summary', hint: 'Prints as "Summary" — category/line-item counts and who prepared it.', defaultOn: false },
  { id: 'lineItems', label: 'Line items', hint: 'Categories -> items -> sub-items with costs.', defaultOn: true },
  { id: 'standaloneItems', label: 'Additional items', hint: 'Items that do not belong to a category.', defaultOn: false },
  { id: 'totals', label: 'Totals', hint: 'Subtotal, discount, tax, total, and amount paid.', defaultOn: true },
  { id: 'deposit', label: 'Deposit', hint: 'Amount due now — heading defaults to "Payment due" (or "Deposit due").', defaultOn: true },
  { id: 'recommendation', label: 'Recommendation', hint: 'Recommended package with chips.', defaultOn: false },
  { id: 'flow', label: 'How it works', hint: 'Horizontal step-by-step flow cards.', defaultOn: false },
  { id: 'terms', label: 'Terms', hint: 'Terms and conditions list.', defaultOn: false },
  { id: 'payment', label: 'Payment', hint: 'Payment method, instructions, link, and QR (admin only).', defaultOn: true },
  { id: 'notes', label: 'Notes', hint: 'Freeform closing notes.', defaultOn: false },
  { id: 'contactFooter', label: 'Contact footer', hint: 'Closing footer reprinting the From name, address, and contact details.', defaultOn: true },
];

const SECTION_IDS = INVOICE_SECTIONS.map((s) => s.id);

export function defaultInvoiceSectionConfig() {
  const include = {};
  for (const section of INVOICE_SECTIONS) include[section.id] = section.defaultOn !== false;
  return { include, order: { sections: [...SECTION_IDS] } };
}

// Merge a raw stored/passed config onto defaults: unknown ids dropped,
// missing ids get their default (appended in registry order).
export function normalizeInvoiceSectionConfig(raw) {
  const def = defaultInvoiceSectionConfig();
  const include = { ...def.include };
  const rawInclude = raw && typeof raw.include === 'object' ? raw.include : {};
  for (const id of SECTION_IDS) {
    if (typeof rawInclude[id] === 'boolean') include[id] = rawInclude[id];
  }
  const rawOrder = Array.isArray(raw?.order?.sections) ? raw.order.sections.filter((id) => SECTION_IDS.includes(id)) : [];
  const order = { sections: [...rawOrder, ...SECTION_IDS.filter((id) => !rawOrder.includes(id))] };
  return { include, order };
}

// Ordered, enabled-only section ids for renderInvoiceHtml() to walk.
export function resolveInvoiceSections(config) {
  const normalized = normalizeInvoiceSectionConfig(config);
  return normalized.order.sections.filter((id) => normalized.include[id] === true);
}

export default INVOICE_SECTIONS;
