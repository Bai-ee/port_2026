'use client';

// InvoiceBuilderCard — the admin "Invoice Builder" card.
//
// Builds a custom invoice (line items, totals, terms), toggles which sections
// render, previews it live, and publishes it to a hosted public URL with a
// downloadable PDF. Mirrors the Brief Composer card's grammar (section
// include-toggles + ordering + live preview, `.vrk-scope` UI kit) with a
// structured line-item data editor layered on top.
//
// Reuses the existing /api/dashboard/custom-briefs endpoint (kind: 'invoice')
// rather than a new route:
//   - POST { kind:'invoice', invoice, sections, title, briefSlug, public }
//     renders + publishes + generates a PDF, returns the saved brief
//     (publicUrl / publicPath, `${publicPath}/pdf`).
//   - POST { kind:'invoice', invoice, sections, preview:true } renders only
//     (writes nothing) and returns { ok:true, html }.
//   - GET  ?kind=invoice lists this client's saved invoices.
// Never render the preview by importing the server renderer client-side —
// it pulls a .cjs module and breaks `next dev`.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { briefSlugify } from '../../lib/dashboard/brief-drafts';
// model.js is import-free pure JS (unlike render.js, which pulls a .cjs
// module) so the client can share the issuing-party defaults with the server
// renderer instead of keeping a second copy in sync.
import { DEFAULT_DRAFT } from '../../features/invoices/default-draft';

const PREVIEW_DEBOUNCE_MS = 800;

// Toggleable/reorderable invoice sections. No server-side registry for this
// (unlike Brief Composer's admin GET) — the set is fixed by the invoice
// renderer's contract, so it lives here.
const SECTION_DEFS = [
  { id: 'cover', label: 'Cover', desc: 'Invoice title, project name, and header art.' },
  { id: 'invoiceMeta', label: 'Invoice details', desc: 'Invoice #, status, issue/due dates, currency.' },
  { id: 'billTo', label: 'Bill to', desc: 'Client contact and billing address.' },
  { id: 'projectSummary', label: 'Project summary', desc: 'Project title and subtitle.' },
  { id: 'lineItems', label: 'Line items', desc: 'Categorized services and pricing.' },
  { id: 'standaloneItems', label: 'Standalone items', desc: 'Items outside any category.' },
  { id: 'totals', label: 'Totals', desc: 'Subtotal, discount, tax, and total.' },
  { id: 'deposit', label: 'Deposit', desc: 'Deposit due now, plus a monthly/one-time split.' },
  { id: 'recommendation', label: 'Recommendation', desc: 'Recommended package, summary, and highlight chips.' },
  { id: 'flow', label: 'Flow / stack', desc: 'Platform-by-platform delivery flow.' },
  { id: 'terms', label: 'Terms', desc: 'Numbered terms and conditions.' },
  { id: 'payment', label: 'Payment', desc: 'How to pay — method, instructions, link.' },
  { id: 'notes', label: 'Notes', desc: 'Freeform closing notes.' },
  { id: 'contactFooter', label: 'Contact footer', desc: 'From-party contact block.' },
];
const DEFAULT_SECTION_ORDER = SECTION_DEFS.map((s) => s.id);
const STATUS_OPTIONS = ['draft', 'sent', 'paid'];

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function defaultInvoiceNumber() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `INV-${stamp}-${Math.floor(100 + Math.random() * 900)}`;
}

function emptyItem() {
  return { id: makeId('item'), name: '', note: '', qty: 1, unitPrice: 0, total: 0, costLabel: '', subItems: [] };
}
function emptyCategory() {
  return { id: makeId('cat'), name: '', items: [emptyItem()] };
}
// The starting draft lives in features/invoices/default-draft.js, shared with
// the /preview/invoice harness so both surfaces seed identically.
function defaultInvoice() {
  const draft = structuredClone(DEFAULT_DRAFT);
  const due = new Date();
  due.setDate(due.getDate() + 14);
  return {
    ...draft,
    invoiceNumber: defaultInvoiceNumber(),
    issueDate: todayIso(),
    dueDate: due.toISOString().slice(0, 10),
    // Rows need stable local ids for React keys; the shared draft carries none.
    categories: draft.categories.map((cat) => ({
      ...cat,
      id: makeId('cat'),
      items: cat.items.map((item) => ({
        ...item,
        id: makeId('item'),
        total: (Number(item.qty) || 0) * (Number(item.unitPrice) || 0),
      })),
    })),
    // Every totals field the form binds to must exist; the draft's own values
    // (deposit, labels) win over these zeros.
    totals: {
      subtotal: 0, discount: 0, discountLabel: '', tax: 0, taxLabel: '',
      total: 0, monthlyValue: '', oneTimeValue: 0,
      ...draft.totals,
    },
  };
}
// Mirrors `defaultOn` in features/invoices/registry.js — the set an invoice
// shows unless the operator turns more on. Kept in sync deliberately: the card
// cannot import the registry's server-side siblings, so a drift here would
// silently disagree with what a published invoice renders.
const DUE_HEADINGS = ['Payment due', 'Deposit due'];

const DEFAULT_ON_SECTIONS = ['cover', 'invoiceMeta', 'billTo', 'lineItems', 'totals', 'deposit', 'payment', 'contactFooter'];

function defaultSections() {
  const include = {};
  DEFAULT_SECTION_ORDER.forEach((id) => { include[id] = DEFAULT_ON_SECTIONS.includes(id); });
  return { include, order: [...DEFAULT_SECTION_ORDER] };
}

function normalizeItem(raw) {
  const qty = Number(raw?.qty);
  const unitPrice = Number(raw?.unitPrice);
  const total = Number(raw?.total);
  return {
    id: raw?.id || makeId('item'),
    name: raw?.name || '',
    note: raw?.note || '',
    qty: Number.isFinite(qty) ? qty : 0,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    total: Number.isFinite(total) ? total : 0,
    costLabel: raw?.costLabel || '',
    subItems: Array.isArray(raw?.subItems)
      ? raw.subItems.map((s) => ({ name: s?.name || '', cost: s?.cost || '' }))
      : [],
  };
}
// Reopening a saved invoice: fill in anything missing from the current shape
// with defaults so an older/partial saved doc never breaks the editor.
function normalizeInvoiceShape(raw) {
  const base = defaultInvoice();
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    ...base,
    ...src,
    invoiceNumber: src.invoiceNumber || base.invoiceNumber,
    status: STATUS_OPTIONS.includes(src.status) ? src.status : base.status,
    from: { ...base.from, ...(src.from || {}) },
    billTo: { ...base.billTo, ...(src.billTo || {}) },
    totals: { ...base.totals, ...(src.totals || {}) },
    recommendation: {
      ...base.recommendation,
      ...(src.recommendation || {}),
      chips: Array.isArray(src.recommendation?.chips) ? src.recommendation.chips : [],
    },
    payment: { ...base.payment, ...(src.payment || {}) },
    categories: Array.isArray(src.categories) && src.categories.length
      ? src.categories.map((cat) => ({
        id: cat?.id || makeId('cat'),
        name: cat?.name || '',
        items: Array.isArray(cat?.items) ? cat.items.map(normalizeItem) : [],
      }))
      : base.categories,
    standaloneItems: Array.isArray(src.standaloneItems) ? src.standaloneItems.map(normalizeItem) : [],
    flowSteps: Array.isArray(src.flowSteps)
      ? src.flowSteps.map((s) => ({ platform: s?.platform || '', color: s?.color || '', label: s?.label || '', tech: s?.tech || '' }))
      : [],
    terms: Array.isArray(src.terms) ? src.terms.map((t) => String(t ?? '')) : [],
  };
}
function normalizeSectionsShape(raw) {
  const include = {};
  DEFAULT_SECTION_ORDER.forEach((id) => { include[id] = true; });
  if (raw?.include && typeof raw.include === 'object') {
    Object.keys(raw.include).forEach((id) => {
      if (DEFAULT_SECTION_ORDER.includes(id)) include[id] = raw.include[id] !== false;
    });
  }
  const rawOrder = Array.isArray(raw?.order) ? raw.order.filter((id) => DEFAULT_SECTION_ORDER.includes(id)) : [];
  const order = [...rawOrder, ...DEFAULT_SECTION_ORDER.filter((id) => !rawOrder.includes(id))];
  return { include, order };
}
function pdfLinkFor(brief) {
  return brief?.pdfDownloadUrl || brief?.pdfUrl || (brief?.publicUrl ? `${brief.publicUrl}/pdf` : '');
}

// A single line item — name/qty/unit price (or a free-text cost label),
// an optional note, and an optional sub-item breakdown. Shared by both the
// categorized line items list and the standalone items list.
function ItemEditor({ item, idPrefix, onChange, onRemove }) {
  const computedTotal = round2((Number(item.qty) || 0) * (Number(item.unitPrice) || 0));
  const updateSubItem = (idx, patch) => {
    onChange({ subItems: item.subItems.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  };
  const addSubItem = () => onChange({ subItems: [...item.subItems, { name: '', cost: '' }] });
  const removeSubItem = (idx) => onChange({ subItems: item.subItems.filter((_, i) => i !== idx) });

  return (
    <div id={idPrefix} style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid var(--vrk-line)', borderRadius: 6, background: '#fff' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <div className="field" style={{ flex: '2 1 160px', minWidth: 0 }}>
          <span className="label">Item name</span>
          <input value={item.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="field" style={{ flex: '1 1 70px', minWidth: 70 }}>
          <span className="label">Qty</span>
          <input
            type="number" min="0" step="1" value={item.qty}
            onChange={(e) => { const qty = Number(e.target.value) || 0; onChange({ qty, total: round2(qty * (Number(item.unitPrice) || 0)) }); }}
          />
        </div>
        <div className="field" style={{ flex: '1 1 100px', minWidth: 90 }}>
          <span className="label">Unit price</span>
          <input
            type="number" min="0" step="0.01" value={item.unitPrice}
            onChange={(e) => { const unitPrice = Number(e.target.value) || 0; onChange({ unitPrice, total: round2((Number(item.qty) || 0) * unitPrice) }); }}
          />
        </div>
        <div className="field" style={{ flex: '1 1 100px', minWidth: 90 }}>
          <span className="label">Total</span>
          <input value={item.costLabel ? item.costLabel : computedTotal} readOnly disabled />
        </div>
      </div>

      <label className="field">
        <span className="label">Cost label (optional — overrides the qty × price display, e.g. &quot;$0–79/mo&quot; or &quot;Included&quot;)</span>
        <input value={item.costLabel} onChange={(e) => onChange({ costLabel: e.target.value })} placeholder="Leave blank to show qty × unit price" />
      </label>
      <label className="field">
        <span className="label">Note</span>
        <input value={item.note} onChange={(e) => onChange({ note: e.target.value })} placeholder="Optional description line" />
      </label>

      <div style={{ display: 'grid', gap: 6 }}>
        <span className="label">Sub-items</span>
        {item.subItems.map((sub, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8 }}>
            <input style={{ flex: 2, minWidth: 0 }} value={sub.name} placeholder="Sub-item name" onChange={(e) => updateSubItem(idx, { name: e.target.value })} />
            <input style={{ flex: 1, minWidth: 70 }} value={sub.cost} placeholder="Cost" onChange={(e) => updateSubItem(idx, { cost: e.target.value })} />
            <button type="button" className="mini-icon-btn" aria-label="Remove sub-item" onClick={() => removeSubItem(idx)}>×</button>
          </div>
        ))}
        <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={addSubItem}>+ Add sub-item</button>
      </div>

      <button type="button" className="btn btn-outline" style={{ justifySelf: 'start', color: 'var(--vrk-danger)' }} onClick={onRemove}>Remove item</button>
    </div>
  );
}

export function InvoiceBuilderCard({ user, apiPath }) {
  const toApiPath = typeof apiPath === 'function' ? apiPath : (path) => path;
  // Every async handler here discards its result when this is true. It MUST be
  // reset on mount, not just set on unmount: React's dev StrictMode mounts,
  // cleans up, then mounts again — leaving a set-once flag latched true for
  // the life of the real mount, which silently threw away every preview,
  // publish and list response (the request still ran; the UI just never
  // heard back).
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const [invoice, setInvoiceRaw] = useState(() => defaultInvoice());
  const [sections, setSectionsRaw] = useState(() => defaultSections());
  const [dirty, setDirty] = useState(false);
  const patchInvoice = useCallback((updater) => { setInvoiceRaw((prev) => updater(prev)); setDirty(true); }, []);
  const patchSections = useCallback((updater) => { setSectionsRaw((prev) => updater(prev)); setDirty(true); }, []);

  // Publish identity — which saved doc (if any) is currently open, and the
  // title/slug/public toggle used on the next Save & Publish.
  const [publishTitle, setPublishTitle] = useState('');
  const [publishSlugInput, setPublishSlugInput] = useState('');
  const [publicToggle, setPublicToggle] = useState(true);
  const [savedSlug, setSavedSlug] = useState('');
  const [publishedBrief, setPublishedBrief] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  // Publishing renders a PDF through Browserless — a ~10s round trip. Without
  // an explicit finished state the card looked like it had done nothing.
  const [publishedAt, setPublishedAt] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // Saved invoices list (reopen).
  const [savedInvoices, setSavedInvoices] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  // Live preview.
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  // Sections that are toggled ON but rendered nothing because they have no
  // data yet. Without this the preview just looks empty and reads as broken.
  const [previewSkipped, setPreviewSkipped] = useState([]);
  const previewTimerRef = useRef(null);
  const previewReqIdRef = useRef(0);

  const loadSavedInvoices = useCallback(async () => {
    if (!user) return;
    setListLoading(true);
    setListError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(toApiPath('/api/dashboard/custom-briefs?kind=invoice'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not load saved invoices.');
      if (!cancelledRef.current) setSavedInvoices(Array.isArray(data.briefs) ? data.briefs : []);
    } catch (err) {
      if (!cancelledRef.current) {
        setSavedInvoices([]);
        setListError(err instanceof Error ? err.message : 'Could not load saved invoices.');
      }
    } finally {
      if (!cancelledRef.current) setListLoading(false);
    }
  }, [user, toApiPath]);

  useEffect(() => { loadSavedInvoices(); }, [loadSavedInvoices]);

  const runPreview = useCallback(async () => {
    if (!user) return;
    const reqId = ++previewReqIdRef.current;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(toApiPath('/api/dashboard/custom-briefs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        body: JSON.stringify({ kind: 'invoice', invoice, sections, preview: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (cancelledRef.current || reqId !== previewReqIdRef.current) return;
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Preview failed (HTTP ${res.status}).`);
      setPreviewHtml(typeof data.html === 'string' ? data.html : '');
      setPreviewSkipped(Array.isArray(data.skippedSections) ? data.skippedSections : []);
    } catch (err) {
      if (!cancelledRef.current && reqId === previewReqIdRef.current) {
        setPreviewError(err instanceof Error ? err.message : 'Preview failed.');
      }
    } finally {
      if (!cancelledRef.current && reqId === previewReqIdRef.current) setPreviewLoading(false);
    }
  }, [user, invoice, sections, toApiPath]);

  // Debounced live preview. runPreview's identity changes whenever
  // invoice/sections change (they're in its dep array), which is what
  // re-fires this effect — the setTimeout below is what enforces the delay,
  // so this never fires a fetch on every keystroke.
  useEffect(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => { runPreview(); }, PREVIEW_DEBOUNCE_MS);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [runPreview]);

  const publishInvoice = useCallback(async () => {
    if (!user || publishing) return;
    setPublishing(true);
    setPublishError('');
    try {
      const token = await user.getIdToken();
      const title = (publishTitle || `Invoice ${invoice.invoiceNumber || ''}`).trim() || 'Invoice';
      const briefSlug = savedSlug || briefSlugify(publishSlugInput || title, `invoice${Date.now()}`);
      const res = await fetch(toApiPath('/api/dashboard/custom-briefs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        body: JSON.stringify({ kind: 'invoice', invoice, sections, title, briefSlug, public: publicToggle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Publish failed (HTTP ${res.status}).`);
      const brief = data.brief || data;
      if (!cancelledRef.current) {
        setPublishedBrief(brief);
        setSavedSlug(brief?.briefSlug || briefSlug);
        setPublishTitle(title);
        setPublishedAt(new Date().toLocaleTimeString());
        setDirty(false);
      }
      loadSavedInvoices();
    } catch (err) {
      if (!cancelledRef.current) setPublishError(err instanceof Error ? err.message : 'Could not publish the invoice.');
    } finally {
      if (!cancelledRef.current) setPublishing(false);
    }
  }, [user, publishing, publishTitle, publishSlugInput, savedSlug, publicToggle, invoice, sections, toApiPath, loadSavedInvoices]);

  const openSavedInvoice = useCallback((brief) => {
    if (!brief) return;
    setInvoiceRaw(normalizeInvoiceShape(brief.invoice));
    setSectionsRaw(normalizeSectionsShape(brief.sections));
    setSavedSlug(brief.briefSlug || brief.id || '');
    setPublishTitle(brief.title || '');
    setPublishSlugInput('');
    setPublicToggle(brief.public !== false);
    setPublishedBrief(brief);
    setPublishError('');
    setPublishedAt('');
    setDirty(false);
  }, []);

  const startNewInvoice = useCallback(() => {
    setInvoiceRaw(defaultInvoice());
    setSectionsRaw(defaultSections());
    setSavedSlug('');
    setPublishTitle('');
    setPublishSlugInput('');
    setPublicToggle(true);
    setPublishedBrief(null);
    setPublishError('');
    setPublishedAt('');
    setDirty(false);
  }, []);

  const copyPublicLink = useCallback(async (url) => {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (typeof window !== 'undefined') window.prompt('Copy this link:', url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch { /* clipboard denied — no-op */ }
  }, []);

  // ── Invoice field mutators ──────────────────────────────────────────────
  const updateInvoiceField = (patch) => patchInvoice((prev) => ({ ...prev, ...patch }));
  const updateFrom = (patch) => patchInvoice((prev) => ({ ...prev, from: { ...prev.from, ...patch } }));
  const updateBillTo = (patch) => patchInvoice((prev) => ({ ...prev, billTo: { ...prev.billTo, ...patch } }));
  const updateServicePeriod = (patch) => patchInvoice((prev) => ({
    ...prev,
    servicePeriod: { start: '', end: '', ...prev.servicePeriod, ...patch },
  }));
  const updateTotals = (patch) => patchInvoice((prev) => ({ ...prev, totals: { ...prev.totals, ...patch } }));
  const updateRecommendation = (patch) => patchInvoice((prev) => ({ ...prev, recommendation: { ...prev.recommendation, ...patch } }));
  const updatePayment = (patch) => patchInvoice((prev) => ({ ...prev, payment: { ...prev.payment, ...patch } }));

  const addCategory = () => patchInvoice((prev) => ({ ...prev, categories: [...prev.categories, emptyCategory()] }));
  const removeCategory = (catId) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.length > 1 ? prev.categories.filter((c) => c.id !== catId) : prev.categories,
  }));
  const updateCategory = (catId, patch) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.map((c) => (c.id === catId ? { ...c, ...patch } : c)),
  }));
  const addItem = (catId) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.map((c) => (c.id === catId ? { ...c, items: [...c.items, emptyItem()] } : c)),
  }));
  const removeItem = (catId, itemId) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.map((c) => (c.id === catId ? { ...c, items: c.items.filter((it) => it.id !== itemId) } : c)),
  }));
  const updateItem = (catId, itemId, patch) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.map((c) => (c.id !== catId ? c : { ...c, items: c.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) })),
  }));

  const addStandaloneItem = () => patchInvoice((prev) => ({ ...prev, standaloneItems: [...prev.standaloneItems, emptyItem()] }));
  const removeStandaloneItem = (itemId) => patchInvoice((prev) => ({ ...prev, standaloneItems: prev.standaloneItems.filter((it) => it.id !== itemId) }));
  const updateStandaloneItem = (itemId, patch) => patchInvoice((prev) => ({
    ...prev,
    standaloneItems: prev.standaloneItems.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
  }));

  const addTerm = () => patchInvoice((prev) => ({ ...prev, terms: [...prev.terms, ''] }));
  const removeTerm = (idx) => patchInvoice((prev) => ({ ...prev, terms: prev.terms.filter((_, i) => i !== idx) }));
  const updateTerm = (idx, value) => patchInvoice((prev) => ({ ...prev, terms: prev.terms.map((t, i) => (i === idx ? value : t)) }));

  const addChip = () => patchInvoice((prev) => ({ ...prev, recommendation: { ...prev.recommendation, chips: [...prev.recommendation.chips, ''] } }));
  const removeChip = (idx) => patchInvoice((prev) => ({ ...prev, recommendation: { ...prev.recommendation, chips: prev.recommendation.chips.filter((_, i) => i !== idx) } }));
  const updateChip = (idx, value) => patchInvoice((prev) => ({
    ...prev,
    recommendation: { ...prev.recommendation, chips: prev.recommendation.chips.map((c, i) => (i === idx ? value : c)) },
  }));

  const addFlowStep = () => patchInvoice((prev) => ({ ...prev, flowSteps: [...prev.flowSteps, { platform: '', color: '', label: '', tech: '' }] }));
  const removeFlowStep = (idx) => patchInvoice((prev) => ({ ...prev, flowSteps: prev.flowSteps.filter((_, i) => i !== idx) }));
  const updateFlowStep = (idx, patch) => patchInvoice((prev) => ({ ...prev, flowSteps: prev.flowSteps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }));

  const recalcTotals = () => {
    const items = [...invoice.categories.flatMap((c) => c.items), ...invoice.standaloneItems];
    const subtotal = round2(items.reduce((sum, it) => sum + (it.costLabel ? 0 : (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)), 0));
    const discount = Number(invoice.totals.discount) || 0;
    const tax = Number(invoice.totals.tax) || 0;
    const total = round2(Math.max(0, subtotal - discount + tax));
    updateTotals({ subtotal, total });
  };

  // ── Sections toggle/order ───────────────────────────────────────────────
  const toggleSection = (id) => patchSections((prev) => ({ ...prev, include: { ...prev.include, [id]: prev.include[id] === false } }));
  const moveSection = (id, dir) => patchSections((prev) => {
    const order = [...prev.order];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= order.length) return prev;
    [order[i], order[j]] = [order[j], order[i]];
    return { ...prev, order };
  });
  const orderedSections = sections.order.map((id) => SECTION_DEFS.find((s) => s.id === id)).filter(Boolean);
  const activeSectionCount = orderedSections.filter((s) => sections.include[s.id] !== false).length;

  return (
    <div className="tile-detail-tab-content" id="invoice-builder-root">
      <div className="vrk-scope" id="invoice-builder-shell" style={{ display: 'grid', gap: 16, padding: 16, alignContent: 'start', overflowY: 'auto' }}>

        <div id="invoice-builder-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span className="label" id="invoice-builder-status-label">
            {publishing ? 'Publishing…'
              : dirty ? 'Unsaved changes'
              : publishedAt ? `Published ✓ ${publishedAt}`
              : savedSlug ? 'Loaded — saved' : 'New invoice'}
          </span>
          <button type="button" className="btn btn-outline" onClick={startNewInvoice}>+ New Invoice</button>
        </div>

        {/* 01 — Invoice details: meta, from, bill to, project summary */}
        <section className="section" id="invoice-builder-details-section">
          <div className="section-head">
            <span className="index">01</span>
            <div>
              <h3>Invoice details</h3>
              <p>Invoice number, status, dates, currency, the billing parties, and the project this invoice covers.</p>
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span className="label">Invoice #</span>
              <input value={invoice.invoiceNumber} onChange={(e) => updateInvoiceField({ invoiceNumber: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Currency</span>
              <input value={invoice.currency} maxLength={3} onChange={(e) => updateInvoiceField({ currency: e.target.value.toUpperCase().slice(0, 3) })} />
            </label>
          </div>

          <div className="field">
            <span className="label">Status</span>
            <div className="segmented" role="group" aria-label="Invoice status">
              {STATUS_OPTIONS.map((s) => (
                <button key={s} type="button" className={invoice.status === s ? 'is-active' : ''} onClick={() => updateInvoiceField({ status: s })}>{s}</button>
              ))}
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span className="label">Issue date</span>
              <input type="date" value={invoice.issueDate} onChange={(e) => updateInvoiceField({ issueDate: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Due date</span>
              <input type="date" value={invoice.dueDate} onChange={(e) => updateInvoiceField({ dueDate: e.target.value })} />
            </label>
          </div>

          <div className="field-grid" id="invoice-builder-terms-fields">
            <label className="field">
              <span className="label">Payment terms</span>
              <input value={invoice.paymentTerms} onChange={(e) => updateInvoiceField({ paymentTerms: e.target.value })} placeholder="Net 14" />
            </label>
            <label className="field">
              <span className="label">PO number</span>
              <input value={invoice.poNumber} onChange={(e) => updateInvoiceField({ poNumber: e.target.value })} placeholder="Client's own reference" />
            </label>
            <label className="field">
              <span className="label">Service period start</span>
              <input type="date" value={invoice.servicePeriod?.start || ''} onChange={(e) => updateServicePeriod({ start: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Service period end</span>
              <input type="date" value={invoice.servicePeriod?.end || ''} onChange={(e) => updateServicePeriod({ end: e.target.value })} />
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span className="label">Project title</span>
              <input value={invoice.projectTitle} onChange={(e) => updateInvoiceField({ projectTitle: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Project subtitle</span>
              <input value={invoice.projectSubtitle} onChange={(e) => updateInvoiceField({ projectSubtitle: e.target.value })} />
            </label>
          </div>

          <div style={{ display: 'grid', gap: 10 }} id="invoice-builder-from-panel">
            <span className="label">From</span>
            <div className="field-grid">
              <label className="field"><span className="label">Name</span><input value={invoice.from.name} onChange={(e) => updateFrom({ name: e.target.value })} /></label>
              <label className="field"><span className="label">Email</span><input value={invoice.from.email} onChange={(e) => updateFrom({ email: e.target.value })} /></label>
              <label className="field"><span className="label">Phone</span><input value={invoice.from.phone} onChange={(e) => updateFrom({ phone: e.target.value })} /></label>
              <label className="field"><span className="label">Site</span><input value={invoice.from.site} onChange={(e) => updateFrom({ site: e.target.value })} /></label>
              <label className="field"><span className="label">Legal name</span><input value={invoice.from.legalName || ''} onChange={(e) => updateFrom({ legalName: e.target.value })} placeholder="If payment is made out to an entity" /></label>
              <label className="field"><span className="label">Tax ID / EIN</span><input value={invoice.from.taxId || ''} onChange={(e) => updateFrom({ taxId: e.target.value })} placeholder="For the client's 1099 / W-9" /></label>
            </div>
            <label className="field"><span className="label">Address</span><textarea rows={2} value={invoice.from.address} onChange={(e) => updateFrom({ address: e.target.value })} /></label>
          </div>

          <div style={{ display: 'grid', gap: 10 }} id="invoice-builder-bill-to-panel">
            <span className="label">Bill to</span>
            <div className="field-grid">
              <label className="field"><span className="label">Client name</span><input value={invoice.billTo.name} onChange={(e) => updateBillTo({ name: e.target.value })} /></label>
              <label className="field"><span className="label">Contact</span><input value={invoice.billTo.contact} onChange={(e) => updateBillTo({ contact: e.target.value })} /></label>
              <label className="field"><span className="label">Email</span><input value={invoice.billTo.email} onChange={(e) => updateBillTo({ email: e.target.value })} /></label>
            </div>
            <label className="field"><span className="label">Address</span><textarea rows={2} value={invoice.billTo.address} onChange={(e) => updateBillTo({ address: e.target.value })} /></label>
          </div>
        </section>

        {/* 02 — Line items (categorized) */}
        <section className="section" id="invoice-builder-line-items-panel">
          <div className="section-head">
            <span className="index">02</span>
            <div>
              <h3>Line items</h3>
              <p>Group services into categories. Price each item by qty × unit price, or use a free-text cost label (e.g. &quot;$0–79/mo&quot; or &quot;Included&quot;); add sub-items for a breakdown.</p>
            </div>
          </div>
          {invoice.categories.map((cat, catIdx) => (
            <div key={cat.id} id={`invoice-builder-category-${cat.id}`} style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--vrk-line)', borderRadius: 8, background: 'rgba(255,255,255,0.5)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="field" style={{ flex: 1, minWidth: 0 }}>
                  <span className="label">Category name</span>
                  <input value={cat.name} onChange={(e) => updateCategory(cat.id, { name: e.target.value })} placeholder={`Category ${catIdx + 1}`} />
                </label>
                <button type="button" className="btn btn-outline" onClick={() => removeCategory(cat.id)} disabled={invoice.categories.length <= 1}>Remove category</button>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {cat.items.map((item) => (
                  <ItemEditor
                    key={item.id}
                    item={item}
                    idPrefix={`invoice-builder-category-${cat.id}-item-${item.id}`}
                    onChange={(patch) => updateItem(cat.id, item.id, patch)}
                    onRemove={() => removeItem(cat.id, item.id)}
                  />
                ))}
              </div>
              <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={() => addItem(cat.id)}>+ Add item</button>
            </div>
          ))}
          <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={addCategory}>+ Add category</button>
        </section>

        {/* 03 — Standalone items */}
        <section className="section" id="invoice-builder-standalone-items-section">
          <div className="section-head">
            <span className="index">03</span>
            <div>
              <h3>Standalone items</h3>
              <p>Items that render outside any category — e.g. a one-off line at the bottom of the invoice.</p>
            </div>
          </div>
          {invoice.standaloneItems.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {invoice.standaloneItems.map((item) => (
                <ItemEditor
                  key={item.id}
                  item={item}
                  idPrefix={`invoice-builder-standalone-item-${item.id}`}
                  onChange={(patch) => updateStandaloneItem(item.id, patch)}
                  onRemove={() => removeStandaloneItem(item.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty">No standalone items yet.</div>
          )}
          <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={addStandaloneItem}>+ Add standalone item</button>
        </section>

        {/* 04 — Totals & deposit */}
        <section className="section" id="invoice-builder-totals-section">
          <div className="section-head">
            <span className="index">04</span>
            <div>
              <h3>Totals &amp; deposit</h3>
              <p>Subtotal, discount, tax, and total, plus an optional deposit and a monthly/one-time split.</p>
            </div>
          </div>

          <div className="field-grid">
            <label className="field"><span className="label">Subtotal</span><input type="number" step="0.01" value={invoice.totals.subtotal} onChange={(e) => updateTotals({ subtotal: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span className="label">Total</span><input type="number" step="0.01" value={invoice.totals.total} onChange={(e) => updateTotals({ total: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span className="label">Discount</span><input type="number" step="0.01" value={invoice.totals.discount} onChange={(e) => updateTotals({ discount: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span className="label">Discount label</span><input value={invoice.totals.discountLabel} onChange={(e) => updateTotals({ discountLabel: e.target.value })} placeholder="e.g. Bundle discount" /></label>
            <label className="field"><span className="label">Tax</span><input type="number" step="0.01" value={invoice.totals.tax} onChange={(e) => updateTotals({ tax: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span className="label">Tax label</span><input value={invoice.totals.taxLabel} onChange={(e) => updateTotals({ taxLabel: e.target.value })} placeholder="e.g. Sales tax" /></label>
          </div>
          <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={recalcTotals}>Recalculate subtotal/total from items</button>

          <div style={{ display: 'grid', gap: 10 }} id="invoice-builder-deposit-panel">
            <span className="label">Amount due</span>
            <div className="field-grid">
              <label className="field"><span className="label">Amount already paid</span><input type="number" step="0.01" value={invoice.totals.amountPaid || 0} onChange={(e) => updateTotals({ amountPaid: Number(e.target.value) || 0 })} /></label>
              <label className="field"><span className="label">Amount due now</span><input type="number" step="0.01" value={invoice.totals.deposit} onChange={(e) => updateTotals({ deposit: Number(e.target.value) || 0 })} /></label>
              <div className="field" id="invoice-builder-due-heading-field">
                <span className="label">Heading</span>
                {/* Two clicks for the common case, free text for everything
                    else — this string is the block's heading on the invoice. */}
                <div className="segmented" role="group" aria-label="Amount-due heading">
                  {DUE_HEADINGS.map((h) => (
                    <button key={h} type="button" className={invoice.totals.depositLabel === h ? 'is-active' : ''} onClick={() => updateTotals({ depositLabel: h })}>{h}</button>
                  ))}
                </div>
                <input value={invoice.totals.depositLabel} onChange={(e) => updateTotals({ depositLabel: e.target.value })} placeholder="Payment due" style={{ marginTop: 8 }} />
              </div>
              <label className="field"><span className="label">Monthly label</span><input value={invoice.totals.monthlyLabel} onChange={(e) => updateTotals({ monthlyLabel: e.target.value })} placeholder="e.g. Monthly retainer" /></label>
              <label className="field"><span className="label">Monthly value</span><input type="number" step="0.01" value={invoice.totals.monthlyValue} onChange={(e) => updateTotals({ monthlyValue: Number(e.target.value) || 0 })} /></label>
              <label className="field"><span className="label">One-time label</span><input value={invoice.totals.oneTimeLabel} onChange={(e) => updateTotals({ oneTimeLabel: e.target.value })} placeholder="e.g. Setup fee" /></label>
              <label className="field"><span className="label">One-time value</span><input type="number" step="0.01" value={invoice.totals.oneTimeValue} onChange={(e) => updateTotals({ oneTimeValue: Number(e.target.value) || 0 })} /></label>
            </div>
          </div>
        </section>

        {/* 05 — Recommendation & flow */}
        <section className="section" id="invoice-builder-recommendation-flow-section">
          <div className="section-head">
            <span className="index">05</span>
            <div>
              <h3>Recommendation &amp; flow</h3>
              <p>The recommended package callout and the platform-by-platform delivery flow.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10 }} id="invoice-builder-recommendation-panel">
            <span className="label">Recommendation</span>
            <label className="field"><span className="label">Package name</span><input value={invoice.recommendation.name} onChange={(e) => updateRecommendation({ name: e.target.value })} /></label>
            <label className="field"><span className="label">Body</span><textarea rows={3} value={invoice.recommendation.body} onChange={(e) => updateRecommendation({ body: e.target.value })} /></label>
            <div style={{ display: 'grid', gap: 6 }}>
              <span className="label">Highlight chips</span>
              {invoice.recommendation.chips.map((chip, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8 }}>
                  <input style={{ flex: 1, minWidth: 0 }} value={chip} onChange={(e) => updateChip(idx, e.target.value)} />
                  <button type="button" className="mini-icon-btn" aria-label={`Remove chip ${idx + 1}`} onClick={() => removeChip(idx)}>×</button>
                </div>
              ))}
              <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={addChip}>+ Add chip</button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10 }} id="invoice-builder-flow-panel">
            <span className="label">Flow / stack steps</span>
            {invoice.flowSteps.map((step, idx) => (
              <div key={idx} id={`invoice-builder-flow-step-${idx}`} style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid var(--vrk-line)', borderRadius: 6, background: '#fff' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <input style={{ flex: '1 1 120px', minWidth: 0 }} placeholder="Platform" value={step.platform} onChange={(e) => updateFlowStep(idx, { platform: e.target.value })} />
                  <input style={{ flex: '1 1 90px', minWidth: 0 }} placeholder="Color" value={step.color} onChange={(e) => updateFlowStep(idx, { color: e.target.value })} />
                  <input style={{ flex: '2 1 160px', minWidth: 0 }} placeholder="Label" value={step.label} onChange={(e) => updateFlowStep(idx, { label: e.target.value })} />
                  <input style={{ flex: '1 1 120px', minWidth: 0 }} placeholder="Tech" value={step.tech} onChange={(e) => updateFlowStep(idx, { tech: e.target.value })} />
                  <button type="button" className="mini-icon-btn" aria-label={`Remove step ${idx + 1}`} onClick={() => removeFlowStep(idx)}>×</button>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={addFlowStep}>+ Add step</button>
          </div>
        </section>

        {/* 06 — Terms, payment & notes */}
        <section className="section" id="invoice-builder-terms-payment-notes-section">
          <div className="section-head">
            <span className="index">06</span>
            <div>
              <h3>Terms, payment &amp; notes</h3>
              <p>Numbered terms, how to pay, and a freeform closing note.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6 }} id="invoice-builder-terms-panel">
            <span className="label">Terms</span>
            {invoice.terms.map((term, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8 }}>
                <span className="label" style={{ alignSelf: 'center', minWidth: 20 }}>{idx + 1}.</span>
                <input style={{ flex: 1, minWidth: 0 }} value={term} onChange={(e) => updateTerm(idx, e.target.value)} />
                <button type="button" className="mini-icon-btn" aria-label={`Remove term ${idx + 1}`} onClick={() => removeTerm(idx)}>×</button>
              </div>
            ))}
            <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={addTerm}>+ Add term</button>
          </div>

          <div className="field-grid" id="invoice-builder-payment-panel">
            <label className="field"><span className="label">Payment method</span><input value={invoice.payment.method} onChange={(e) => updatePayment({ method: e.target.value })} /></label>
            <label className="field"><span className="label">Payment link</span><input value={invoice.payment.link} onChange={(e) => updatePayment({ link: e.target.value })} /></label>
          </div>
          <label className="field"><span className="label">Payment instructions</span><textarea rows={3} value={invoice.payment.instructions} onChange={(e) => updatePayment({ instructions: e.target.value })} /></label>

          <label className="field"><span className="label">Notes</span><textarea rows={3} value={invoice.notes} onChange={(e) => updateInvoiceField({ notes: e.target.value })} /></label>
        </section>

        {/* 07 — Sections: toggle + reorder what renders */}
        <section className="section" id="invoice-builder-sections-panel">
          <div className="section-head">
            <span className="index">07</span>
            <div>
              <h3>Sections</h3>
              <p>Toggle which parts of the invoice render, and reorder them with ↑/↓.</p>
            </div>
            <span className="label">{activeSectionCount}/{orderedSections.length} on</span>
          </div>
          <div className="toggle-grid" id="invoice-section-toggle-row" role="group" aria-label="Invoice sections">
            {orderedSections.map((s, idx) => {
              const on = sections.include[s.id] !== false;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  className={`toggle-card${on ? ' is-on' : ''}`}
                  style={{ position: 'relative', cursor: 'pointer' }}
                  onClick={() => toggleSection(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(s.id); } }}
                >
                  <span className="check">{on ? '✓' : ''}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="toggle-title">{s.label}</span>
                    <span className="toggle-desc">{s.desc}</span>
                  </span>
                  <span style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" aria-label={`Move ${s.label} up`} disabled={idx === 0} onClick={(e) => { e.stopPropagation(); moveSection(s.id, -1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.4 : 1, fontSize: 11 }}>↑</button>
                    <button type="button" aria-label={`Move ${s.label} down`} disabled={idx === orderedSections.length - 1} onClick={(e) => { e.stopPropagation(); moveSection(s.id, 1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: idx === orderedSections.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === orderedSections.length - 1 ? 0.4 : 1, fontSize: 11 }}>↓</button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 08 — Live preview */}
        <section className="section" id="invoice-builder-preview-section">
          <div className="section-head">
            <span className="index">08</span>
            <div>
              <h3>Live preview</h3>
              <p>Auto-refreshes shortly after you stop editing. Reflects the section toggles/order above. Writes nothing — publish separately below.</p>
            </div>
            <span className="label">{previewLoading ? 'Rendering…' : 'Live'}</span>
          </div>
          {previewError ? <p className="hint-danger">{previewError}</p> : null}
          {previewSkipped.length ? (
            <p className="hint" id="invoice-builder-preview-skipped-hint">
              On but empty, so not shown:{' '}
              {previewSkipped.map((id) => SECTION_DEFS.find((s) => s.id === id)?.label || id).join(', ')}
              {' '}— fill those in above, or turn on other sections, and they appear here.
            </p>
          ) : null}
          <iframe
            id="invoice-builder-preview-frame"
            title="Invoice preview"
            srcDoc={previewHtml || '<!doctype html><html><body style="font:14px system-ui;color:#888;padding:24px;margin:0;">Preview will appear here once you add invoice details.</body></html>'}
            style={{ width: '100%', minHeight: 640, border: '1px solid rgba(42,36,32,0.12)', borderRadius: 8, background: '#fff' }}
          />
          <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={runPreview} disabled={previewLoading}>↻ Refresh preview</button>
        </section>

        {/* 09 — Publish */}
        <section className="section" id="invoice-builder-publish-section">
          <div className="section-head">
            <span className="index">09</span>
            <div>
              <h3>Publish</h3>
              <p>Saves the invoice to a hosted public URL with a downloadable PDF. Re-publishing the same invoice updates the same link.</p>
            </div>
            <span className="label">{dirty ? 'Unsaved changes' : 'Saved'}</span>
          </div>

          <div className="field-grid">
            <label className="field">
              <span className="label">Title</span>
              <input value={publishTitle} onChange={(e) => setPublishTitle(e.target.value)} placeholder={`Invoice ${invoice.invoiceNumber}`} />
            </label>
            <label className="field">
              <span className="label">Visibility</span>
              <select value={publicToggle ? 'on' : 'off'} onChange={(e) => setPublicToggle(e.target.value === 'on')}>
                <option value="on">Public (hosted link)</option>
                <option value="off">Private (save only)</option>
              </select>
            </label>
          </div>

          {!savedSlug ? (
            <label className="field">
              <span className="label">URL slug (optional — auto-generated from the title if blank)</span>
              <input value={publishSlugInput} onChange={(e) => setPublishSlugInput(e.target.value)} placeholder={briefSlugify(publishTitle || `Invoice ${invoice.invoiceNumber}`)} />
            </label>
          ) : (
            <span className="hint" id="invoice-builder-editing-saved-hint">Editing the saved invoice &ldquo;{savedSlug}&rdquo; — Save &amp; Publish updates this same link.</span>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button type="button" className="btn" style={{ background: '#2a2420', color: '#fff', borderColor: '#2a2420' }} onClick={publishInvoice} disabled={publishing}>
              {publishing ? 'Publishing…' : savedSlug ? 'Save & Republish' : 'Save & Publish'}
            </button>
            {publishing ? (
              <span className="hint" id="invoice-builder-publish-progress">Saving and rendering the PDF — about 10 seconds.</span>
            ) : null}
            {publishedBrief?.publicUrl ? (
              <>
                <a className="btn btn-outline" href={publishedBrief.publicUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>
                <button type="button" className="btn btn-outline" onClick={() => copyPublicLink(publishedBrief.publicUrl)}>{copiedLink ? 'Copied ✓' : 'Copy public link'}</button>
                {pdfLinkFor(publishedBrief) ? (
                  <a className="btn btn-outline" href={pdfLinkFor(publishedBrief)} target="_blank" rel="noopener noreferrer" download>Download PDF</a>
                ) : null}
              </>
            ) : null}
          </div>
          {publishError ? <p className="hint-danger">{publishError}</p> : null}
          {publishedBrief?.publicUrl ? (
            <span className="hint" id="invoice-builder-published-url-hint" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {publishedAt ? `Published ${publishedAt} · ` : ''}{publishedBrief.publicUrl}
            </span>
          ) : null}
        </section>

        {/* 10 — Saved invoices (reopen) */}
        <section className="section" id="invoice-builder-saved-invoices-section">
          <div className="section-head">
            <span className="index">10</span>
            <div>
              <h3>Saved invoices</h3>
              <p>Previously published invoices for this client. Open one to continue editing.</p>
            </div>
            <button type="button" className="btn btn-outline" onClick={loadSavedInvoices} disabled={listLoading}>↻ Refresh</button>
          </div>
          {listError ? (
            <p className="hint-danger">{listError}</p>
          ) : listLoading ? (
            <p className="hint">Loading…</p>
          ) : savedInvoices.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {savedInvoices.map((brief) => {
                const key = brief.id || brief.briefSlug;
                return (
                  <div key={key} className="list-card" id={`invoice-builder-saved-invoice-${key}`}>
                    <div className="list-head">
                      <span className="list-title" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{brief.title || brief.invoice?.invoiceNumber || brief.briefSlug}</span>
                      <span className="hint">{brief.updatedAt ? new Date(brief.updatedAt).toLocaleString() : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-outline" onClick={() => openSavedInvoice(brief)}>Open in editor</button>
                      {brief.publicUrl ? <a className="btn btn-outline" href={brief.publicUrl} target="_blank" rel="noopener noreferrer">View ↗</a> : null}
                      {pdfLinkFor(brief) ? <a className="btn btn-outline" href={pdfLinkFor(brief)} target="_blank" rel="noopener noreferrer" download>PDF ↓</a> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">No invoices saved yet.</div>
          )}
        </section>

      </div>
    </div>
  );
}
