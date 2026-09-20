// The single starting draft for a new invoice. Imported by BOTH the Invoice
// Builder card (its new-invoice seed) and the /preview/invoice harness (its
// JSON textarea seed) so the two surfaces cannot drift into showing different
// "defaults" — that divergence is exactly what made the card look broken next
// to the harness.
//
// Import-free on purpose: this file, model.js and registry.js are the only
// invoice modules a client bundle may import (render.js pulls a .cjs module
// through createRequire and breaks `next dev`).
//
// Values here are a starting point shown in editable form fields, never a
// silent server-side default — see DEFAULT_FROM in default-from.js for the
// one thing that IS a renderer-level default (moved out of model.js so the
// public client bundle, which imports model.js, never carries it — see
// default-from.js's header).

import { DEFAULT_FROM } from './default-from.js';

export const DEFAULT_DRAFT = {
  status: 'draft',
  currency: 'USD',
  paymentTerms: 'Net 14',
  poNumber: '',
  servicePeriod: { start: '', end: '' },
  from: { ...DEFAULT_FROM },
  // Generic placeholder client — this is a starting TEMPLATE shown to every
  // new invoice, not a real engagement, so it shouldn't name an actual past
  // client/company. `from` above stays the owner's real issuing identity
  // (DEFAULT_FROM) since that's genuinely needed for real invoicing; only
  // the bill-to/project side is a fill-in-the-blank example.
  billTo: {
    name: 'John Smith',
    contact: '',
    email: 'john.smith@example.com',
    address: '',
  },
  projectTitle: 'Website Development',
  projectSubtitle: '',
  categories: [
    {
      name: 'Design & Development',
      items: [{ name: 'Design & Development', note: '', qty: 20, unitPrice: 75, costLabel: '', subItems: [] }],
    },
  ],
  standaloneItems: [],
  // Deposit and Payment are ON by default (see registry.js), so the draft
  // carries values for them — an enabled section with no data renders nothing,
  // which reads as a broken preview.
  totals: {
    amountPaid: 0,
    deposit: 750,
    depositLabel: 'Payment due',
    monthlyLabel: 'Monthly Recurring',
    monthlyValue: '',
    oneTimeLabel: '1-Time Design + Set Up',
  },
  recommendation: { name: '', body: '', chips: [] },
  flowSteps: [],
  terms: [],
  notes: '',
  payment: {
    method: 'Venmo',
    handle: '@Bryan-Balli',
    instructions: 'Scan the code to pay.',
    link: '',
    qr: 'venmo',
  },
};

export default DEFAULT_DRAFT;
