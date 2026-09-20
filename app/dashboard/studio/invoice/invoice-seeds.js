// Invoice Studio — starting drafts (docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md P0, D8/D10).
//
// ⚠️ THIS FILE IS THE PRIVACY BOUNDARY for Invoice Studio. publicSeed() is
// the only seed a signed-out visitor's draft can start from, and its output
// must carry zero trace of the owner: no name, email, phone, address,
// Venmo handle/QR, or brand marks. adminSeed() is today's Invoice Builder
// card behavior (features/invoices/default-draft.js's DEFAULT_DRAFT),
// unchanged — but reached only through a dynamic import() so none of that
// module's bytes (or features/invoices/default-from.js's DEFAULT_FROM,
// which default-draft.js itself now imports) ever land in the public tool's
// chunk. useInvoiceDraft.js is the only caller: it picks publicSeed() or
// adminSeed() once, at first mount, based on `isAdmin`.
//
// ⚠️ Do not add a static top-level `import` of
// features/invoices/default-draft.js, features/invoices/default-from.js,
// features/invoices/brand-marks.js, or features/invoices/payment-qr.js to
// this file — a static import pulls that module's bytes into EVERY bundle
// that imports this file, including the public one, even if the code path
// that reads it never runs. The seed-isolation test in
// __tests__/invoice-seeds.test.js asserts this file's own source has no
// such import.
//
// ⚠️ Gap CLOSED (was flagged here as a known gap outside this file's
// control; keeping the note for history). model.js's normalizeInvoice()
// used to backfill any BLANK invoice.from.* field with a module-level
// DEFAULT_FROM constant — Bryan's real email/phone/address — by DEFAULT,
// regardless of who was editing; publicSeed() ships those fields blank (per
// this file's contract below), which meant a public draft with an unfilled
// "From" party rendered the OWNER's real contact info until the visitor
// filled in their own. Bundle inspection then found the deeper version of
// the same problem: DEFAULT_FROM lived IN model.js, which the public client
// bundle imports, so the owner's identity shipped as literal strings in that
// bundle regardless of whether the public render path ever read them —
// runtime option gating alone cannot remove strings from a compiled bundle.
// Fix (Lane A): DEFAULT_FROM moved to its own features/invoices/default-from.js
// module; model.js no longer references it at all, and its own default
// inverted to "no backfill unless the caller explicitly passes it" (see
// model.js's normalizeInvoice() doc comment). InvoiceCanvas.jsx's admin path
// now reaches default-from.js the same way it already reached
// brand-marks.js — an admin-only dynamic import — so this file needs no
// changes of its own to stay a public/no-owner-identity boundary.

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultInvoiceNumber() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `INV-${stamp}-${Math.floor(100 + Math.random() * 900)}`;
}

function freshDueDate() {
  const due = new Date();
  due.setDate(due.getDate() + 14);
  return due.toISOString().slice(0, 10);
}

// Every totals field the rail/canvas binds to must exist — an absent key
// reads as "0"/"" through getAtPath anyway, but seeding them explicitly
// keeps both seeds structurally identical (useInvoiceDraft.js treats
// publicSeed()/adminSeed() output as interchangeable "starting drafts").
function blankTotals(overrides = {}) {
  return {
    subtotal: 0, discount: 0, discountLabel: '', tax: 0, taxLabel: '',
    total: 0, amountPaid: 0, deposit: 0, depositLabel: 'Payment due',
    monthlyLabel: 'Monthly Recurring', monthlyValue: '',
    oneTimeLabel: '1-Time Setup', oneTimeValue: '',
    ...overrides,
  };
}

/** The public, signed-out starting draft. Neutral placeholder text only —
 * no owner identity anywhere in this object. */
export function publicSeed() {
  return {
    status: 'draft',
    currency: 'USD',
    paymentTerms: 'Net 14',
    poNumber: '',
    invoiceNumber: defaultInvoiceNumber(),
    issueDate: todayIso(),
    dueDate: freshDueDate(),
    servicePeriod: { start: '', end: '' },
    // Placeholder text a stranger can see is a PROMPT, not a leak — "Your
    // name" tells them what to type without asserting a false fact the way
    // a pre-filled real name/email/phone would.
    from: {
      name: 'Your name',
      legalName: '',
      taxId: '',
      email: '',
      phone: '',
      site: '',
      address: '',
    },
    billTo: { name: '', contact: '', email: '', address: '' },
    projectTitle: 'Project Invoice',
    projectSubtitle: '',
    categories: [
      {
        id: makeId('cat'),
        name: 'Services',
        items: [{
          id: makeId('item'), name: 'Service', note: '',
          qty: 1, unitPrice: 0, total: 0, costLabel: '', subItems: [],
        }],
      },
    ],
    standaloneItems: [],
    totals: blankTotals(),
    recommendation: { name: '', body: '', chips: [] },
    flowSteps: [],
    terms: [],
    notes: '',
    // No method/handle/link/qr — an empty payment section is an honest
    // empty state (render.js skips sections with no data) rather than a
    // half-filled block pointing at nobody's account.
    payment: { method: '', handle: '', instructions: '', link: '', qr: '' },
  };
}

// Admin-only starting draft — ported verbatim from InvoiceBuilderCard.jsx's
// defaultInvoice(): today's DEFAULT_DRAFT plus fresh ids/invoiceNumber/dates
// and a computed `total` per item. The dynamic import is the whole point of
// this indirection (see the file header) — do not hoist it to a static
// top-level import.
async function buildAdminSeed() {
  const { DEFAULT_DRAFT } = await import('../../../../features/invoices/default-draft.js');
  const draft = structuredClone(DEFAULT_DRAFT);
  return {
    ...draft,
    invoiceNumber: defaultInvoiceNumber(),
    issueDate: todayIso(),
    dueDate: freshDueDate(),
    // Rows need stable local ids for React keys/path addressing; the shared
    // draft carries none (same reasoning as the card's own defaultInvoice()).
    categories: draft.categories.map((cat) => ({
      ...cat,
      id: makeId('cat'),
      items: cat.items.map((item) => ({
        ...item,
        id: makeId('item'),
        total: (Number(item.qty) || 0) * (Number(item.unitPrice) || 0),
      })),
    })),
    totals: blankTotals(draft.totals),
  };
}

/** Admin-only. Returns a Promise — callers (useInvoiceDraft.js) must only
 * invoke this behind an `isAdmin` check, so a signed-out session never
 * triggers the dynamic import in the first place. */
export function adminSeed() {
  return buildAdminSeed();
}
