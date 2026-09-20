'use client';

// Invoice Studio — the draft + section-config hook (docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md P0).
//
// Owns the one piece of state both the canvas (Lane C) and the rail
// (Lane D) read and write: the invoice draft, the section include/order
// config, and every mutator the old admin card had (ported from
// components/dashboard/InvoiceBuilderCard.jsx — that file is the reference
// for every add/remove/update shape below). New here, beyond the port:
// - `structureKey` (memoized) — §4.3's re-render gate.
// - `applyFieldEdit(path, value, origin)` — the one write path invoice-fields
//   paths go through, tagged with which surface ('canvas' | 'rail') made the
//   edit so that surface can be skipped when patching the other one back.
// - localStorage persistence — versioned, every read/write try/catch'd (a
//   private window or blocked site data throws on access, and the tool must
//   still render without it).
// - public/admin seed selection — see invoice-seeds.js. The public path
//   never statically imports anything that would pull owner identity in;
//   the admin seed is awaited from a dynamic import.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publicSeed, adminSeed } from './invoice-seeds.js';
import { getAtPath, setAtPath, structureKey as computeStructureKey } from './invoice-fields.js';
// registry.js is import-free pure ESM (same family as model.js) — importing
// it here instead of hand-duplicating the section id/defaultOn list (the
// way the admin card had to, since IT couldn't reach past render.js's
// createRequire boundary) means this hook can never drift from what the
// renderer actually treats as "on by default".
import { INVOICE_SECTIONS } from '../../../../features/invoices/registry.js';
// Client-safe/pure (same family as invoice-fields.js) — see that file's own
// header comment on why nothing in this directory imports render.js/.cjs.
import { normalizeTheme } from './themes/theme-schema.js';
// Q2 Lane B's numbering module (design-layer plan L11) — only its
// reserveNextNumber() export is called here, exactly once, from
// startNewInvoice() below. See that function's own comment for why.
import { reserveNextNumber } from './identity/numbering.js';

// Design-layer plan §3.4 — v2 is `{ v:2, invoice, sections, theme, savedAt }`.
// STORAGE_KEY_V1 is read-only now (migration source); nothing writes it
// anymore. `theme` is a top-level v2 field, deliberately separate from
// `invoice` (design-layer plan L4: "document semantics live in invoice;
// theme is separate").
export const STORAGE_KEY_V1 = 'invoice-studio-draft-v1';
export const STORAGE_KEY_V2 = 'invoice-studio-draft-v2';
const STORAGE_VERSION = 2;
const STATUS_OPTIONS = ['draft', 'sent', 'paid'];
const SECTION_IDS = INVOICE_SECTIONS.map((s) => s.id);
const DEFAULT_ON_SECTION_IDS = INVOICE_SECTIONS.filter((s) => s.defaultOn !== false).map((s) => s.id);

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function emptyItem() {
  return { id: makeId('item'), name: '', note: '', qty: 1, unitPrice: 0, total: 0, costLabel: '', subItems: [] };
}
function emptyCategory() {
  return { id: makeId('cat'), name: '', items: [emptyItem()] };
}

// ── Sections shape ─────────────────────────────────────────────────────
// { include: {id: boolean}, order: string[] } — flat, matching the admin
// card's own shape (NOT registry.js's { order: { sections: [...] } }
// nesting — that shape is render.js/resolveInvoiceSections' wire format,
// this is the editor's in-memory one). invoice-fields.js's structureKey()
// expects this exact shape.
function defaultSections() {
  const include = {};
  SECTION_IDS.forEach((id) => { include[id] = DEFAULT_ON_SECTION_IDS.includes(id); });
  return { include, order: [...SECTION_IDS] };
}

// Reopening a saved/restored config: anything missing defaults to ON, not
// to the registry defaultOn — a stored config with a field genuinely absent
// (older shape, hand-edited localStorage) is assumed unedited-since-default,
// and today's default for a never-mentioned section is visible. Only
// defaultSections() (a brand-new invoice) uses DEFAULT_ON_SECTION_IDS.
function normalizeSectionsShape(raw) {
  const include = {};
  SECTION_IDS.forEach((id) => { include[id] = true; });
  if (raw?.include && typeof raw.include === 'object') {
    Object.keys(raw.include).forEach((id) => {
      if (SECTION_IDS.includes(id)) include[id] = raw.include[id] !== false;
    });
  }
  const rawOrder = Array.isArray(raw?.order) ? raw.order.filter((id) => SECTION_IDS.includes(id)) : [];
  const order = [...rawOrder, ...SECTION_IDS.filter((id) => !rawOrder.includes(id))];
  return { include, order };
}

// ── Invoice shape backfill ──────────────────────────────────────────────
// Local-shape normalization for the EDITOR (stable ids for React keys/path
// addressing, blanks instead of thrown errors on partial/legacy data) — NOT
// features/invoices/model.js's normalizeInvoice(), which is the renderer's
// authoritative, server-matching normalize (fallbacks, DEFAULT_FROM, money
// rounding) and runs at render/publish time regardless of what this does.
function normalizeItemShape(raw) {
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
    subItems: Array.isArray(raw?.subItems) ? raw.subItems.map((s) => ({ name: s?.name || '', cost: s?.cost || '' })) : [],
  };
}

// Ported from the card's normalizeInvoiceShape, with one deliberate change:
// `base` is a parameter instead of a hardcoded defaultInvoice() call. The
// card always ran admin-only, so it had exactly one base; this tool has two
// (public/admin), and which one backfills a partial/legacy draft has to
// track whichever seed this session actually resolved — see loadBase() below.
function normalizeInvoiceShape(raw, base) {
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
      chips: Array.isArray(src.recommendation?.chips) ? src.recommendation.chips : (base.recommendation?.chips || []),
    },
    payment: { ...base.payment, ...(src.payment || {}) },
    categories: Array.isArray(src.categories) && src.categories.length
      ? src.categories.map((cat) => ({
        id: cat?.id || makeId('cat'),
        name: cat?.name || '',
        items: Array.isArray(cat?.items) ? cat.items.map(normalizeItemShape) : [],
      }))
      : base.categories,
    standaloneItems: Array.isArray(src.standaloneItems) ? src.standaloneItems.map(normalizeItemShape) : [],
    flowSteps: Array.isArray(src.flowSteps)
      ? src.flowSteps.map((s) => ({ platform: s?.platform || '', color: s?.color || '', label: s?.label || '', tech: s?.tech || '' }))
      : [],
    terms: Array.isArray(src.terms) ? src.terms.map((t) => String(t ?? '')) : [],
  };
}

// ── localStorage (best-effort; never throws) ────────────────────────────
// Exported (in addition to being used internally) so this pure,
// React-free storage/migration logic is directly unit-testable without a
// DOM renderer — see __tests__/draft-storage.test.js. Nothing else in this
// directory calls these from outside this file; the hook body below is
// still the only stateful caller.

// One-time v1 -> v2 migration (design-layer plan §3.4). Runs only when v2 is
// absent AND a v1 draft exists. The v2 write happens FIRST and is allowed to
// fail (quota/private-window) without touching v1 at all; only once that
// write has actually landed does this remove the v1 key — a caller that
// crashes/loses power between the two calls simply re-attempts the same
// migration next load, since v1 is still there and v2 still isn't.
export function migrateV1ToV2() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const v1Raw = window.localStorage.getItem(STORAGE_KEY_V1);
    if (!v1Raw) return null;
    const parsed = JSON.parse(v1Raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return null;
    if (!parsed.invoice || typeof parsed.invoice !== 'object') return null;
    const migrated = { invoice: parsed.invoice, sections: parsed.sections || null, theme: null };
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({
      v: STORAGE_VERSION, invoice: migrated.invoice, sections: migrated.sections, theme: null, savedAt: Date.now(),
    }));
    window.localStorage.removeItem(STORAGE_KEY_V1);
    return migrated;
  } catch {
    // Corrupt v1 JSON / blocked storage — nothing to migrate, no v1 removal.
    return null;
  }
}

export function readStoredDraft() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return migrateV1ToV2();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== STORAGE_VERSION) return null;
    if (!parsed.invoice || typeof parsed.invoice !== 'object') return null;
    return { invoice: parsed.invoice, sections: parsed.sections || null, theme: normalizeTheme(parsed.theme) };
  } catch {
    // Private window / blocked site data / corrupt JSON — the tool still
    // has to render, just without a restored draft.
    return null;
  }
}

export function writeStoredDraft(invoice, sections, theme) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({
      v: STORAGE_VERSION, invoice, sections, theme: theme || null, savedAt: Date.now(),
    }));
  } catch {
    // Quota exceeded / blocked storage — autosave is best-effort, never fatal.
  }
}

export function clearStoredDraft() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(STORAGE_KEY_V2);
    window.localStorage.removeItem(STORAGE_KEY_V1);
  } catch { /* no-op */ }
}

const AUTOSAVE_DEBOUNCE_MS = 500;

export function useInvoiceDraft({ isAdmin = false } = {}) {
  // Same StrictMode trap as InvoiceBuilderCard.jsx:250-260 — dev StrictMode
  // mounts, cleans up, then mounts again, so a set-once "cancelled" flag
  // latches true for the life of the real mount and silently drops the
  // admin seed's dynamic-import response (or a localStorage restore) that
  // resolves after the phantom cleanup. Reset on every mount, not just once.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  // Lazy initial state is ALWAYS the public seed, regardless of `isAdmin` —
  // never render even one admin-identity frame while the dynamic import
  // (below) is in flight. Admin sessions get swapped to adminSeed()'s
  // result (or a restored local draft normalized against it) once resolved.
  const [invoice, setInvoiceRaw] = useState(() => publicSeed());
  const [sections, setSectionsRaw] = useState(() => defaultSections());
  // Default theme is null ("Default", design-layer plan L1) — every draft
  // starts on today's byte-identical white/black look until the operator (or
  // a restored v2 draft) picks one of the three built-in presets.
  const [theme, setThemeRaw] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [lastEdit, setLastEdit] = useState(null); // { path, origin, at } — see applyFieldEdit

  // Tracks whether the user has already started editing by the time an
  // async base (admin seed) resolves — a slow dynamic import must never
  // clobber in-progress typing.
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  // The base this session actually resolved to (public or admin seed
  // shape) — normalizeInvoiceShape() backfills against this, so a restored
  // partial/legacy draft's missing fields come from the right identity.
  const baseRef = useRef(null);

  const patchInvoice = useCallback((updater) => { setInvoiceRaw((prev) => updater(prev)); setDirty(true); }, []);
  const patchSections = useCallback((updater) => { setSectionsRaw((prev) => updater(prev)); setDirty(true); }, []);

  // ── Initial load: restore a local draft if one exists, else seed fresh.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const base = isAdmin ? await adminSeed().catch(() => publicSeed()) : publicSeed();
      if (cancelled || cancelledRef.current || dirtyRef.current) return;
      baseRef.current = base;
      const stored = readStoredDraft();
      if (stored) {
        setInvoiceRaw(normalizeInvoiceShape(stored.invoice, base));
        setSectionsRaw(stored.sections ? normalizeSectionsShape(stored.sections) : defaultSections());
        setThemeRaw(normalizeTheme(stored.theme));
      } else {
        setInvoiceRaw(base);
        setSectionsRaw(defaultSections());
        setThemeRaw(null);
      }
      setDirty(false);
      setReady(true);
    }
    load();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // ── Autosave (debounced) — every draft/section change, once past the
  // initial load, so we don't stomp a not-yet-restored slot with the
  // lazy-initial public seed before load() has had a chance to run.
  const autosaveTimerRef = useRef(null);
  useEffect(() => {
    if (!ready) return undefined;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => { writeStoredDraft(invoice, sections, theme); }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, [invoice, sections, theme, ready]);

  // ── structureKey — memoized per §4.3/L7; recomputed only when its inputs
  // (not every keystroke on an unrelated field) actually change shape.
  const structureKeyValue = useMemo(() => computeStructureKey(invoice, sections, theme), [invoice, sections, theme]);

  // Only known built-ins ever land in state (design-layer plan L2/theme-schema
  // .js's own "normalizeTheme never trusts a persisted object's own
  // colors/fonts" contract) — a caller passing an already-normalized preset
  // (from BUILTIN_THEME_PRESETS/CoverCard's picker) or null both pass through
  // normalizeTheme unchanged; anything else collapses to null (Default).
  const setTheme = useCallback((next) => { setThemeRaw(normalizeTheme(next)); setDirty(true); }, []);

  // ── The one write path for invoice-fields.js paths. `value` is already
  // parsed (parseValue happened in the caller — the bridge/rail knows the
  // field's type, this hook doesn't need to). `origin` lets the caller that
  // owns the OTHER surface skip re-patching the one the edit came from.
  const applyFieldEdit = useCallback((path, value, origin = 'rail') => {
    setInvoiceRaw((prev) => setAtPath(prev, path, value));
    setDirty(true);
    setLastEdit({ path, origin, at: Date.now() });
  }, []);

  const readFieldAt = useCallback((path) => getAtPath(invoice, path), [invoice]);

  // ── Invoice field mutators (ported from InvoiceBuilderCard.jsx) ────────
  const updateInvoiceField = useCallback((patch) => patchInvoice((prev) => ({ ...prev, ...patch })), [patchInvoice]);
  const updateFrom = useCallback((patch) => patchInvoice((prev) => ({ ...prev, from: { ...prev.from, ...patch } })), [patchInvoice]);
  const updateBillTo = useCallback((patch) => patchInvoice((prev) => ({ ...prev, billTo: { ...prev.billTo, ...patch } })), [patchInvoice]);
  const updateServicePeriod = useCallback((patch) => patchInvoice((prev) => ({
    ...prev,
    servicePeriod: { start: '', end: '', ...prev.servicePeriod, ...patch },
  })), [patchInvoice]);
  const updateTotals = useCallback((patch) => patchInvoice((prev) => ({ ...prev, totals: { ...prev.totals, ...patch } })), [patchInvoice]);
  const updateRecommendation = useCallback((patch) => patchInvoice((prev) => ({ ...prev, recommendation: { ...prev.recommendation, ...patch } })), [patchInvoice]);
  const updatePayment = useCallback((patch) => patchInvoice((prev) => ({ ...prev, payment: { ...prev.payment, ...patch } })), [patchInvoice]);

  const addCategory = useCallback(() => patchInvoice((prev) => ({ ...prev, categories: [...prev.categories, emptyCategory()] })), [patchInvoice]);
  const removeCategory = useCallback((catId) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.length > 1 ? prev.categories.filter((c) => c.id !== catId) : prev.categories,
  })), [patchInvoice]);
  const updateCategory = useCallback((catId, patch) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.map((c) => (c.id === catId ? { ...c, ...patch } : c)),
  })), [patchInvoice]);
  const addItem = useCallback((catId) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.map((c) => (c.id === catId ? { ...c, items: [...c.items, emptyItem()] } : c)),
  })), [patchInvoice]);
  const removeItem = useCallback((catId, itemId) => patchInvoice((prev) => ({
    ...prev,
    categories: prev.categories.map((c) => (c.id === catId ? { ...c, items: c.items.filter((it) => it.id !== itemId) } : c)),
  })), [patchInvoice]);
  // Recomputes `total` itself whenever the patch touches qty/unitPrice (and
  // no costLabel override is set) — one source of truth for the math
  // instead of every caller (rail input, canvas edit) redoing qty*unitPrice.
  //
  // qty/unitPrice bypass applyFieldEdit (see ItemFieldsEditor.jsx's own
  // header comment for why), so they'd otherwise never set `lastEdit` —
  // and useInvoiceBridge.js's canvas value-patch effect is keyed on
  // `lastEdit.path`. Without this, a rail-side qty/price edit correctly
  // recomputes item.total (patched separately via the derived-totals
  // effect, which watches the whole invoice) but leaves the item's own
  // "N hrs" / "$X/hr" canvas text stale until the next structural
  // re-render. Firing `lastEdit` here — same shape `applyFieldEdit`
  // produces — closes that gap for free, no bridge-side special-casing.
  const updateItem = useCallback((catId, itemId, patch) => {
    patchInvoice((prev) => ({
      ...prev,
      categories: prev.categories.map((c) => (c.id !== catId ? c : {
        ...c,
        items: c.items.map((it) => {
          if (it.id !== itemId) return it;
          const next = { ...it, ...patch };
          if (!next.costLabel && ('qty' in patch || 'unitPrice' in patch)) {
            next.total = round2((Number(next.qty) || 0) * (Number(next.unitPrice) || 0));
          }
          return next;
        }),
      })),
    }));
    const field = 'qty' in patch ? 'qty' : ('unitPrice' in patch ? 'unitPrice' : null);
    if (field) setLastEdit({ path: `categories[${catId}].items[${itemId}].${field}`, origin: 'rail', at: Date.now() });
  }, [patchInvoice]);

  const addStandaloneItem = useCallback(() => patchInvoice((prev) => ({ ...prev, standaloneItems: [...prev.standaloneItems, emptyItem()] })), [patchInvoice]);
  const removeStandaloneItem = useCallback((itemId) => patchInvoice((prev) => ({ ...prev, standaloneItems: prev.standaloneItems.filter((it) => it.id !== itemId) })), [patchInvoice]);
  // See updateItem's comment above — same lastEdit gap, same fix.
  const updateStandaloneItem = useCallback((itemId, patch) => {
    patchInvoice((prev) => ({
      ...prev,
      standaloneItems: prev.standaloneItems.map((it) => {
        if (it.id !== itemId) return it;
        const next = { ...it, ...patch };
        if (!next.costLabel && ('qty' in patch || 'unitPrice' in patch)) {
          next.total = round2((Number(next.qty) || 0) * (Number(next.unitPrice) || 0));
        }
        return next;
      }),
    }));
    const field = 'qty' in patch ? 'qty' : ('unitPrice' in patch ? 'unitPrice' : null);
    if (field) setLastEdit({ path: `standaloneItems[${itemId}].${field}`, origin: 'rail', at: Date.now() });
  }, [patchInvoice]);

  // Sub-items (nested under either a category item or a standalone item) —
  // shared shape, addressed by parent kind so callers don't need two APIs.
  const updateSubItems = useCallback((parentKind, catId, itemId, updater) => patchInvoice((prev) => {
    const applyToItem = (it) => (it.id === itemId ? { ...it, subItems: updater(it.subItems) } : it);
    if (parentKind === 'standalone') {
      return { ...prev, standaloneItems: prev.standaloneItems.map(applyToItem) };
    }
    return {
      ...prev,
      categories: prev.categories.map((c) => (c.id !== catId ? c : { ...c, items: c.items.map(applyToItem) })),
    };
  }), [patchInvoice]);
  const addSubItem = useCallback((parentKind, catId, itemId) => updateSubItems(parentKind, catId, itemId, (subs) => [...subs, { name: '', cost: '' }]), [updateSubItems]);
  const removeSubItem = useCallback((parentKind, catId, itemId, idx) => updateSubItems(parentKind, catId, itemId, (subs) => subs.filter((_, i) => i !== idx)), [updateSubItems]);
  const updateSubItem = useCallback((parentKind, catId, itemId, idx, patch) => updateSubItems(parentKind, catId, itemId, (subs) => subs.map((s, i) => (i === idx ? { ...s, ...patch } : s))), [updateSubItems]);

  const addTerm = useCallback(() => patchInvoice((prev) => ({ ...prev, terms: [...prev.terms, ''] })), [patchInvoice]);
  const removeTerm = useCallback((idx) => patchInvoice((prev) => ({ ...prev, terms: prev.terms.filter((_, i) => i !== idx) })), [patchInvoice]);
  const updateTerm = useCallback((idx, value) => patchInvoice((prev) => ({ ...prev, terms: prev.terms.map((t, i) => (i === idx ? value : t)) })), [patchInvoice]);

  const addChip = useCallback(() => patchInvoice((prev) => ({ ...prev, recommendation: { ...prev.recommendation, chips: [...prev.recommendation.chips, ''] } })), [patchInvoice]);
  const removeChip = useCallback((idx) => patchInvoice((prev) => ({ ...prev, recommendation: { ...prev.recommendation, chips: prev.recommendation.chips.filter((_, i) => i !== idx) } })), [patchInvoice]);
  const updateChip = useCallback((idx, value) => patchInvoice((prev) => ({
    ...prev,
    recommendation: { ...prev.recommendation, chips: prev.recommendation.chips.map((c, i) => (i === idx ? value : c)) },
  })), [patchInvoice]);

  const addFlowStep = useCallback(() => patchInvoice((prev) => ({ ...prev, flowSteps: [...prev.flowSteps, { platform: '', color: '', label: '', tech: '' }] })), [patchInvoice]);
  const removeFlowStep = useCallback((idx) => patchInvoice((prev) => ({ ...prev, flowSteps: prev.flowSteps.filter((_, i) => i !== idx) })), [patchInvoice]);
  const updateFlowStep = useCallback((idx, patch) => patchInvoice((prev) => ({ ...prev, flowSteps: prev.flowSteps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) })), [patchInvoice]);

  // "Recalculate subtotal/total from items" — the card's button, ported.
  // Functional update (reads `prev`, not the closed-over `invoice`) so a
  // rapid double-click can't recompute from a stale snapshot.
  const recalcTotals = useCallback(() => {
    patchInvoice((prev) => {
      const items = [...prev.categories.flatMap((c) => c.items), ...prev.standaloneItems];
      const subtotal = round2(items.reduce((sum, it) => sum + (it.costLabel ? 0 : (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)), 0));
      const discount = Number(prev.totals.discount) || 0;
      const tax = Number(prev.totals.tax) || 0;
      const total = round2(Math.max(0, subtotal - discount + tax));
      return { ...prev, totals: { ...prev.totals, subtotal, total } };
    });
  }, [patchInvoice]);

  // ── Sections toggle/order ───────────────────────────────────────────────
  const toggleSection = useCallback((id) => patchSections((prev) => ({ ...prev, include: { ...prev.include, [id]: prev.include[id] === false } })), [patchSections]);
  // Adjacent-only swap. No rail UI calls this today (the ↑/↓ buttons it
  // backed were removed in favor of drag-to-reorder — see reorderSection
  // below) — kept as a plain, still-tested public mutator on the draft
  // rather than deleted, since it's a reasonable primitive for any future
  // caller that wants a single-step move without dragging.
  const moveSection = useCallback((id, dir) => patchSections((prev) => {
    const order = [...prev.order];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= order.length) return prev;
    [order[i], order[j]] = [order[j], order[i]];
    return { ...prev, order };
  }), [patchSections]);
  // Arbitrary reposition (rail drag-to-reorder — useRailDragReorder.js), vs.
  // moveSection's adjacent-only swap above. `toIndex` is where `id` should
  // land AFTER it's removed from its current slot — e.g. moving the first
  // of 4 items to toIndex 3 puts it last, not at the old index 3.
  const reorderSection = useCallback((id, toIndex) => patchSections((prev) => {
    const order = [...prev.order];
    const from = order.indexOf(id);
    if (from === -1) return prev;
    order.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, order.length));
    order.splice(clamped, 0, id);
    return { ...prev, order };
  }), [patchSections]);

  // ── Whole-draft operations ──────────────────────────────────────────────
  const startNewInvoice = useCallback(async () => {
    const base = isAdmin ? await adminSeed().catch(() => publicSeed()) : publicSeed();
    if (cancelledRef.current) return;
    // Design-layer plan L11 (Q2, Lane B integration — orchestrator-owned):
    // a number is reserved HERE, on New Document, and nowhere else — never
    // as a side effect of a render. reserveNextNumber() already normalizes
    // an absent docKind/numberPattern (neither field exists on a fresh
    // invoice-seeds.js seed — those only get backfilled once
    // model.js's normalizeInvoice() runs, at render time) to the
    // 'invoice' / 'INV-{YYYY}-{seq:3}' bucket, so this reserves correctly
    // even before the operator has ever touched the docKind/numbering
    // controls in CoverCard/InvoiceMetaCard.
    const reservedInvoice = { ...base, invoiceNumber: reserveNextNumber(base.docKind, base.numberPattern) };
    baseRef.current = reservedInvoice;
    setInvoiceRaw(reservedInvoice);
    setSectionsRaw(defaultSections());
    setDirty(false);
    clearStoredDraft();
  }, [isAdmin]);

  // Admin-only in practice (a saved/published brief only exists once an
  // admin has published one), but this function itself is just a shape
  // operation — no network call, no publish-state bookkeeping (title/slug/
  // public toggle stay owned by the rail's PublishCard/SavedInvoicesCard).
  const openSavedInvoice = useCallback((brief) => {
    if (!brief) return;
    const base = baseRef.current || publicSeed();
    setInvoiceRaw(normalizeInvoiceShape(brief.invoice, base));
    setSectionsRaw(normalizeSectionsShape(brief.sections));
    setDirty(false);
  }, []);

  return {
    invoice,
    sections,
    theme,
    setTheme,
    dirty,
    ready,
    structureKey: structureKeyValue,
    lastEdit,

    applyFieldEdit,
    readFieldAt,

    updateInvoiceField,
    updateFrom,
    updateBillTo,
    updateServicePeriod,
    updateTotals,
    updateRecommendation,
    updatePayment,

    addCategory,
    removeCategory,
    updateCategory,
    addItem,
    removeItem,
    updateItem,

    addStandaloneItem,
    removeStandaloneItem,
    updateStandaloneItem,

    addSubItem,
    removeSubItem,
    updateSubItem,

    addTerm,
    removeTerm,
    updateTerm,

    addChip,
    removeChip,
    updateChip,

    addFlowStep,
    removeFlowStep,
    updateFlowStep,

    recalcTotals,

    toggleSection,
    moveSection,
    reorderSection,

    startNewInvoice,
    openSavedInvoice,
  };
}

export default useInvoiceDraft;
