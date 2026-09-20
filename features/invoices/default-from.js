// The owner's real issuing identity. Split out of model.js on purpose
// (Invoice Studio plan D13 bundle-inspection follow-up): model.js is
// imported by the PUBLIC Invoice Studio client bundle (it's the pure,
// import-free normalizer every lane relies on), so a module-level
// DEFAULT_FROM constant sitting IN model.js shipped Bryan Balli's real
// email/phone/address as literal strings in that bundle — readable in
// devtools — regardless of whether any code path on the public render used
// them. Runtime option gating (`defaultFrom: null`) cannot fix that; only
// moving the identity out of the module graph the public bundle imports can.
//
// A caller now MUST explicitly import THIS file and pass its value as
// normalizeInvoice()'s `context.defaultFrom` (or renderInvoiceDocument()'s
// `options.defaultFrom`) to reach it at all — model.js itself no longer
// references it, and its own default flipped to "no backfill" (see
// model.js's normalizeInvoice() doc comment). Known reachable-only-from
// callers: app/api/dashboard/custom-briefs/route.js (server publish),
// features/invoices/default-draft.js (admin card seed), and
// app/dashboard/studio/invoice/InvoiceCanvas.jsx's admin-only dynamic
// import (mirrors brand-marks.js's own admin-only dynamic-import pattern).
export const DEFAULT_FROM = {
  name: 'Bryan Balli',
  // Who the payment is actually made out to, when that differs from the
  // display name, plus the tax identity a client needs for a 1099/W-9.
  legalName: '',
  taxId: '',
  email: 'bryanballi@gmail.com',
  phone: '3122865129',
  site: '',
  address: 'Chicago, IL',
};

export default DEFAULT_FROM;
