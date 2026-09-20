'use client';

// Invoice Studio — the canvas ⇄ draft bridge (Q1 / Lane E,
// docs/plans/INVOICE-STUDIO-DESIGN-LAYER-HANDOFF.md, mechanics from
// docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md §4.2).
//
// Parent-side only. The iframe (InvoiceCanvas.jsx) stays a dumb `srcDoc`
// document — same-origin, so this file drives its `contentDocument` directly.
// No `<script>` is ever injected into the document.
//
// ── Why a bridge, not more props ─────────────────────────────────────────
// InvoiceCanvas.jsx already forwards its ref to the raw <iframe> DOM node and
// calls `onDocumentRendered(frameEl)` once per srcDoc swap (i.e. once per
// STRUCTURAL re-render — see useInvoiceDraft.js's structureKey and D4: a
// value-only edit never swaps srcDoc). That single seam is everything this
// hook needs: `attach(frameEl)` runs exactly when a fresh contentDocument
// exists, wires up every `[data-inv-field]` node, and everything else
// (patching values back into the canvas, patching derived totals) is driven
// by plain React effects watching the ONE shared draft
// (`app/dashboard/studio/invoice/useInvoiceDraft.js`'s return value) — never
// a second state path.
//
// ── Direction summary (tool handoff §4.2) ──────────────────────────────────
//   attach:        after each render, every [data-inv-field] node becomes
//                   contenteditable="plaintext-only" and gets
//                   focus/input/blur/keydown listeners.
//   canvas -> draft: debounced (200ms) input -> parseValue -> either
//                   draft.applyFieldEdit(path, value, 'canvas') or, for
//                   qty/unitPrice, draft.updateItem/updateStandaloneItem
//                   (see the qty/unitPrice note below).
//   draft -> canvas: every draft.lastEdit patches the matching (non-focused)
//                   [data-inv-field] node(s); every draft.invoice change
//                   patches every [data-inv-derived] node (item totals,
//                   subtotal/total/balanceDue) via computeTotals.
//   commit:         blur/Enter reformats the node from the committed value
//                   (money/date normalize on exit); Escape reverts to the
//                   last committed value.
//   focus sync:     canvas focus opens the owning RailCard + highlights the
//                   matching rail control — see the "no focus-steal" note
//                   below for why this does NOT call InvoiceRail's own
//                   focusField() (which does a real .focus()).
//
// ── Rendered index != draft index ───────────────────────────────────────
// `terms[]`, `recommendation.chips[]`, `flowSteps[]`, and any item's
// `subItems[]` are the four kinds features/invoices/model.js DROPS blank rows
// from on every render — so a canvas `data-inv-field="terms[1]"` may refer to
// a different row than draft index 1. `resolveCanvasEditPath()` below is the
// one place that translation happens, using invoice-fields.js's own exported
// `renderedIndexToDraftIndex()`. `categories`/`items`/`standaloneItems` are
// id-keyed and never need translation.
//
// ── qty/unitPrice never go through applyFieldEdit ──────────────────────────
// useInvoiceDraft.js's `updateItem`/`updateStandaloneItem` are the ONLY place
// that recomputes `item.total = round2(qty*unitPrice)` — see
// ItemFieldsEditor.jsx's own header comment for the same rule on the rail
// side. `applyFieldEdit`'s setAtPath would blindly overwrite qty/unitPrice
// and leave `item.total` (and therefore subtotal/total, which
// features/invoices/model.js's computeTotals resums straight from item
// totals on every render) stale. Both fields are id-keyed paths, so no
// rendered-index translation is needed for them either.
//
// ── Derived totals are the bridge's own job ────────────────────────────────
// `totals.subtotal`/`totals.total`/`totals.balanceDue` and every item's
// `.total` are emitted as `data-inv-derived` (patch-in only, never
// contenteditable) — confirmed against features/invoices/render.js's
// buildTotals()/renderItemRow(). computeTotals() (features/invoices/model.js)
// resums them straight from the current items on every RENDER, but a
// value-only qty/price edit never triggers a render (D4) — so nothing else
// in this app recomputes them on a plain edit. This hook recomputes them
// itself (computeDerivedPatches(), same computeTotals() import invoice-fields
// .js already proves is client-safe) and patches the DOM directly, on every
// draft.invoice change (not just qty/price edits — this also fixes discount/
// tax/amountPaid edited from the RAIL not live-reflecting on the canvas,
// which was a standing gap before this bridge existed).
//
// ── No literal focus-steal on canvas -> rail ──────────────────────────────
// InvoiceRail.jsx's exposed `focusField(path)` opens the owning card AND
// calls a real `el.focus({preventScroll:true})` on the rail input. Calling
// that from a canvas node's own `focus` handler would immediately move DOM
// focus away from the contenteditable node the user just clicked into —
// every keystroke after the first click would land in the rail's <input>,
// not the canvas, which breaks "type in canvas" outright and contradicts the
// Q1 acceptance line "typing in canvas... caret never jumps." So canvas focus
// here only opens the section (`railRef.current.openSection(sectionId)` —
// no focus side effect) and applies a transient highlight to the matching
// rail control found via its own `data-inv-rail-field` attribute. Rail ->
// canvas focus sync (scrolling/highlighting the canvas node when a rail
// input gains focus) is deliberately NOT implemented here: doing it without
// editing any rail card file would need document-level focus delegation on
// the rail's DOM plus a forward (draft index -> rendered index) translation
// helper that doesn't exist anywhere in this codebase, and it isn't in the
// design-layer plan's Q1 accept list (only the canvas->rail direction is).
//
// ── status/currency: commit on blur/Enter only ─────────────────────────────
// invoice-fields.js's structureKey() (not owned by this lane) includes both
// `currency` and `status` as structural inputs (they gate section bodies —
// e.g. the "paid" stamp). A debounced applyFieldEdit firing mid-keystroke on
// either field would trigger a full structural re-render (srcDoc swap) and
// visibly disrupt typing on exactly those two fields — the same caret-loss
// failure D4 exists to prevent, just from a P0 contract this lane cannot
// edit. The safe, fully in-ownership mitigation: these two fields simply
// never call applyFieldEdit from the debounced input tick, only from
// blur/Enter (reformat:true).

import { useCallback, useEffect, useRef } from 'react';
import {
  getAtPath, parseValue, formatValue, renderedIndexToDraftIndex,
} from './invoice-fields.js';
// Client-safe (pure ESM, no createRequire) — invoice-fields.js already
// imports formatMoney from this exact module, proving the import shape is
// safe for the client bundle. See that file's own header comment.
import { computeTotals } from '../../../../features/invoices/model.js';

const RAW_TYPES = new Set(['money', 'number', 'date']);
const INPUT_DEBOUNCE_MS = 200;
const STRUCTURAL_RISK_FIELDS = new Set(['currency', 'status']);
const HIGHLIGHT_STYLE_ID = 'invoice-bridge-canvas-highlight-style';
const RAIL_HIGHLIGHT_STYLE_ID = 'invoice-bridge-rail-highlight-style';
const RAIL_HIGHLIGHT_CLASS = 'inv-rail-field-highlight-flash';

// ── Path tokenizer (mirrors invoice-fields.js's own PATH_SEGMENT_RE/
// parsePath — that file's version is private, so this is an independent
// copy per this lane's own ownership, not an import) ────────────────────
const PATH_SEGMENT_RE = /^([a-zA-Z0-9_]+)(?:\[([^\]]+)\])?$/;

function parseSegments(path) {
  const raw = String(path ?? '');
  if (!raw) return null;
  const segments = raw.split('.').map((segment) => {
    const match = PATH_SEGMENT_RE.exec(segment);
    if (!match) return null;
    return { key: match[1], bracket: match[2] };
  });
  return segments.some((s) => !s) ? null : segments;
}

function segmentsToPath(segments) {
  return segments.map((s) => (s.bracket !== undefined ? `${s.key}[${s.bracket}]` : s.key)).join('.');
}

/**
 * Translate a CANVAS-rendered path (bracket contents may be a rendered
 * index, for the four kinds model.js filters) into the real, draft-accurate
 * path invoice-fields.js's getAtPath/setAtPath/applyFieldEdit expect.
 * Returns null when the row no longer resolves (e.g. removed elsewhere while
 * this edit was in flight) — mirrors setAtPath's own "unresolvable path,
 * no-op" contract rather than fabricating a row.
 * Pure: reads `invoice`, never mutates it. No DOM.
 */
export function resolveCanvasEditPath(invoice, renderedPath) {
  const segments = parseSegments(renderedPath);
  if (!segments || !segments.length) return null;

  // terms[N]
  if (segments.length === 1 && segments[0].key === 'terms' && segments[0].bracket !== undefined) {
    const idx = Number(segments[0].bracket);
    const draftIdx = renderedIndexToDraftIndex('terms', invoice?.terms, idx);
    return draftIdx >= 0 ? `terms[${draftIdx}]` : null;
  }

  // recommendation.chips[N]
  if (
    segments.length === 2
    && segments[0].key === 'recommendation'
    && segments[1].key === 'chips'
    && segments[1].bracket !== undefined
  ) {
    const idx = Number(segments[1].bracket);
    const draftIdx = renderedIndexToDraftIndex('chips', invoice?.recommendation?.chips, idx);
    return draftIdx >= 0 ? `recommendation.chips[${draftIdx}]` : null;
  }

  // flowSteps[N] or flowSteps[N].<field>
  if (segments[0].key === 'flowSteps' && segments[0].bracket !== undefined) {
    const idx = Number(segments[0].bracket);
    const draftIdx = renderedIndexToDraftIndex('flowSteps', invoice?.flowSteps, idx);
    if (draftIdx < 0) return null;
    const tail = segmentsToPath(segments.slice(1));
    return tail ? `flowSteps[${draftIdx}].${tail}` : `flowSteps[${draftIdx}]`;
  }

  // ...subItems[N] or ...subItems[N].<field> — owner is
  // categories[c].items[i] or standaloneItems[i]; subItems has no single
  // owner array, so the owning item is resolved first (getAtPath) and N is
  // translated against THAT item's own raw subItems list.
  const subIdx = segments.findIndex((s) => s.key === 'subItems' && s.bracket !== undefined);
  if (subIdx > 0) {
    const ownerSegments = segments.slice(0, subIdx);
    const ownerPath = segmentsToPath(ownerSegments);
    const owner = getAtPath(invoice, ownerPath);
    const rawSubItems = owner && Array.isArray(owner.subItems) ? owner.subItems : [];
    const renderedIdx = Number(segments[subIdx].bracket);
    const draftIdx = renderedIndexToDraftIndex('subItems', rawSubItems, renderedIdx);
    if (draftIdx < 0) return null;
    const tail = segmentsToPath(segments.slice(subIdx + 1));
    return tail ? `${ownerPath}.subItems[${draftIdx}].${tail}` : `${ownerPath}.subItems[${draftIdx}]`;
  }

  // Id-keyed (categories/items/standaloneItems) or any flat, non-indexed
  // path — draft-accurate as rendered, no translation needed.
  return renderedPath;
}

/**
 * A CANVAS-rendered path pointing at a category-item or standalone-item
 * qty/unitPrice field -> the mutator call shape needed to route it through
 * useInvoiceDraft.js's centralized total recompute instead of applyFieldEdit.
 * Both owner kinds are id-keyed, so no rendered-index translation applies —
 * this is a plain structural parse. Returns null for any other path.
 * Pure. No DOM.
 */
export function parseItemPricePath(renderedPath) {
  const segments = parseSegments(renderedPath);
  if (!segments) return null;
  const field = segments[segments.length - 1];
  if (!field || (field.key !== 'qty' && field.key !== 'unitPrice')) return null;

  if (
    segments.length === 3
    && segments[0].key === 'categories' && segments[0].bracket !== undefined
    && segments[1].key === 'items' && segments[1].bracket !== undefined
  ) {
    return { kind: 'category', catId: segments[0].bracket, itemId: segments[1].bracket, field: field.key };
  }
  if (
    segments.length === 2
    && segments[0].key === 'standaloneItems' && segments[0].bracket !== undefined
  ) {
    return { kind: 'standalone', itemId: segments[0].bracket, field: field.key };
  }
  return null;
}

/**
 * value -> the RAW editable text a canvas node should show on focus (money/
 * number types edit as a bare number, date as its already-ISO form). Mirrors
 * what render.js bakes into data-inv-raw at render time; the bridge keeps
 * this attribute fresh itself after every commit since value-only edits
 * never re-render (see the module header).
 * Pure.
 */
export function rawTextForType(type, value) {
  if (type === 'date') return value == null ? '' : String(value);
  if (type === 'money' || type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : '0';
  }
  return String(value ?? '');
}

/**
 * Every data-inv-derived patch the current draft implies: each numerically-
 * priced item's own .total, plus totals.subtotal/total/balanceDue via
 * computeTotals() (features/invoices/model.js) — the SAME function
 * render.js's own render pass uses, so this never drifts from what a
 * structural re-render would have produced. Cost-labeled items are excluded
 * (render.js emits their amount as an EDITABLE costLabel field, not a
 * derived total — see renderItemRow()). Pure: reads `invoice`, no DOM.
 */
export function computeDerivedPatches(invoice) {
  const inv = invoice && typeof invoice === 'object' ? invoice : {};
  const currency = inv.currency || 'USD';
  const locale = inv.locale || 'en-US';
  const patches = [];

  const pushItemTotal = (prefix, item) => {
    if (!item || item.costLabel) return;
    patches.push({ path: `${prefix}.total`, display: formatValue('money', item.total, currency, locale) });
  };
  (Array.isArray(inv.categories) ? inv.categories : []).forEach((cat) => {
    (Array.isArray(cat?.items) ? cat.items : []).forEach((item) => {
      pushItemTotal(`categories[${cat.id}].items[${item.id}]`, item);
    });
  });
  (Array.isArray(inv.standaloneItems) ? inv.standaloneItems : []).forEach((item) => {
    pushItemTotal(`standaloneItems[${item.id}]`, item);
  });

  const totals = computeTotals(inv);
  patches.push({ path: 'totals.subtotal', display: formatValue('money', totals.subtotal, currency, locale) });
  patches.push({ path: 'totals.total', display: formatValue('money', totals.total, currency, locale) });
  patches.push({ path: 'totals.balanceDue', display: formatValue('money', totals.balanceDue, currency, locale) });
  return patches;
}

function placeCaretAtEnd(el) {
  const doc = el && el.ownerDocument;
  const win = doc && doc.defaultView;
  if (!doc || !win || typeof doc.createRange !== 'function') return;
  try {
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = win.getSelection && win.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch { /* selection unsupported/detached node — no-op */ }
}

function ensureHighlightStyle(doc) {
  if (!doc || !doc.head || doc.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  // A rounded highlight box with generous breathing room on every side, not
  // a bare outline hugging the text. `box-shadow` (not `padding`/`margin`)
  // draws that breathing room: padding would change the node's own layout
  // box — shifting whatever sits beside/below it the instant a field is
  // clicked into, the exact class of "shift on interaction" bug this
  // canvas's fit-scale got fixed for (see InvoiceCanvas.jsx's fitScale
  // comment). box-shadow paints outside the box without occupying layout
  // space, so the halo appears inset-like on all four sides with zero
  // reflow — three stacked layers at increasing spread stand in for
  // top/bottom/left/right padding here, since a single box-shadow ring
  // reads as a border, not a padded field. `border-radius: 999px` (rather
  // than a fixed px value) always yields a full stadium/pill shape
  // regardless of a field's own size — short money/date fields and long
  // name/address ones alike.
  //
  // Colors are the SAME three stops as GLASS.accent (rail-ui.jsx) — the
  // gradient already used for the rail's own CTA buttons and its logo mark
  // — sampled as three separate hsl() box-shadow layers (box-shadow can't
  // paint an actual multi-stop gradient) so the focus halo reads as the
  // same cyan → purple → pink identity as the rest of the page, not a
  // generic "selection blue."
  style.textContent = `
    [data-inv-field] { cursor: text; border-radius: 999px; transition: background-color 0.18s ease, box-shadow 0.18s ease; }
    [data-inv-field]:hover { background: hsla(262,90%,55%,0.05); box-shadow: 0 0 0 6px hsla(262,90%,55%,0.05); }
    [data-inv-field]:focus {
      outline: none;
      background: hsla(262,80%,60%,0.08);
      box-shadow:
        0 0 0 1.5px hsla(185,90%,42%,0.6),
        0 0 0 9px hsla(262,90%,55%,0.14),
        0 0 0 15px hsla(314,90%,55%,0.07);
    }
  `;
  doc.head.appendChild(style);
}

// Rail highlight CSS lives in the PARENT document (the rail is never inside
// the iframe), injected once — a transient visual pulse on the rail control
// that owns whatever field the operator just focused on the canvas. No rail
// file needs to know about this; it only needs the class name applied.
function ensureRailHighlightStyle() {
  if (typeof document === 'undefined' || !document.head || document.getElementById(RAIL_HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = RAIL_HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${RAIL_HIGHLIGHT_CLASS} {
      outline: 2px solid rgba(37,99,235,0.85) !important;
      outline-offset: 1px;
      transition: outline-color 0.2s ease;
    }
  `;
  document.head.appendChild(style);
}

export function useInvoiceBridge(iframeRef, draft, railRef) {
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const focusedNodeRef = useRef(null);
  const committedRef = useRef(new WeakMap());
  const debounceTimersRef = useRef(new Map());
  const railHighlightTimerRef = useRef(null);

  useEffect(() => { ensureRailHighlightStyle(); }, []);

  const clearAllDebounces = useCallback(() => {
    debounceTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    debounceTimersRef.current.clear();
  }, []);

  // ── Rail highlight (D1 — no focus-steal) ─────────────────────────────────
  const highlightRailField = useCallback((draftPath) => {
    if (!draftPath) return;
    const root = typeof document !== 'undefined' ? document.getElementById('invoice-studio-rail-inner') : null;
    if (!root) return;
    let el = null;
    try { el = root.querySelector(`[data-inv-rail-field="${CSS.escape(String(draftPath))}"]`); } catch { el = null; }
    if (!el) return;
    if (railHighlightTimerRef.current) clearTimeout(railHighlightTimerRef.current);
    el.classList.add(RAIL_HIGHLIGHT_CLASS);
    railHighlightTimerRef.current = setTimeout(() => { el.classList.remove(RAIL_HIGHLIGHT_CLASS); }, 900);
  }, []);

  // Routes a parsed value to whichever mutator actually owns the write —
  // qty/unitPrice (id-keyed, no rendered-index translation needed) go
  // through updateItem/updateStandaloneItem so useInvoiceDraft.js keeps
  // recomputing item.total centrally; everything else resolves its real
  // (translated, for the four filtered kinds) draft path and goes through
  // applyFieldEdit. Shared by both the normal commit path and Escape's
  // revert, so a revert writes the SAME way a real edit would have.
  const writeValueToDraft = useCallback((currentDraft, renderedPath, value) => {
    const pricePath = parseItemPricePath(renderedPath);
    if (pricePath) {
      if (pricePath.kind === 'category') {
        currentDraft.updateItem(pricePath.catId, pricePath.itemId, { [pricePath.field]: value });
      } else {
        currentDraft.updateStandaloneItem(pricePath.itemId, { [pricePath.field]: value });
      }
      return;
    }
    const draftPath = resolveCanvasEditPath(currentDraft.invoice, renderedPath);
    if (draftPath != null) currentDraft.applyFieldEdit(draftPath, value, 'canvas');
  }, []);

  // ── Commit routine ────────────────────────────────────────────────────────
  const commitFromNode = useCallback((node, { reformat }) => {
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    const type = node.dataset.invType;
    const renderedPath = node.dataset.invField;
    const rawText = node.textContent;
    const parsed = parseValue(type, rawText);
    const isPriceField = Boolean(parseItemPricePath(renderedPath));

    if (!isPriceField && STRUCTURAL_RISK_FIELDS.has(renderedPath) && !reformat) {
      // D4 — never write currency/status from the debounced input tick;
      // commit only lands on blur/Enter, avoiding a mid-keystroke structural
      // re-render (structureKey includes both fields).
    } else {
      writeValueToDraft(currentDraft, renderedPath, parsed);
    }

    // committedRef is the "revert to on Escape" baseline — it must reflect
    // only the value as of the last successful blur/Enter COMMIT, never an
    // in-progress debounced auto-apply tick. Updating it on every 200ms tick
    // would make Escape revert to whatever was last auto-saved mid-typing
    // instead of the value the field actually had before this edit began.
    // `value` (the actual draft-typed value, not just its display text) is
    // stored too, so a later Escape can write the exact reverted value back
    // through writeValueToDraft — reverting only the DOM text and leaving a
    // debounce-applied partial edit sitting in the draft would desync the
    // canvas from the rail/draft it's supposed to mirror.
    if (reformat) {
      const currency = currentDraft.invoice?.currency;
      const locale = currentDraft.invoice?.locale;
      const display = formatValue(type, parsed, currency, locale);
      node.textContent = display;
      const raw = rawTextForType(type, parsed);
      committedRef.current.set(node, { display, raw, value: parsed });
      if (RAW_TYPES.has(type)) node.dataset.invRaw = raw;
    }
  }, [writeValueToDraft]);

  // ── attach() — stable identity; reads draftRef/railRef fresh inside its
  // own listener closures, so it never needs to be re-created per render. ──
  const attach = useCallback((frameEl) => {
    if (!frameEl) return;
    let doc = null;
    try { doc = frameEl.contentDocument; } catch { doc = null; }
    if (!doc) return;

    // Fresh document each call (a srcDoc swap destroys the previous one
    // wholesale) — clearing here only guards a same-tick edge case, not
    // real cross-generation duplication.
    clearAllDebounces();
    focusedNodeRef.current = null;
    ensureHighlightStyle(doc);

    const seedInvoice = draftRef.current?.invoice;
    const nodes = doc.querySelectorAll('[data-inv-field]');
    nodes.forEach((node) => {
      node.setAttribute('contenteditable', 'plaintext-only');
      const seedPath = resolveCanvasEditPath(seedInvoice, node.dataset.invField);
      committedRef.current.set(node, {
        display: node.textContent,
        raw: node.dataset.invRaw ?? null,
        value: seedPath != null ? getAtPath(seedInvoice, seedPath) : undefined,
      });

      const onFocus = () => {
        focusedNodeRef.current = node;
        const type = node.dataset.invType;
        if (RAW_TYPES.has(type) && node.dataset.invRaw != null) {
          node.textContent = node.dataset.invRaw;
          placeCaretAtEnd(node);
        }
        const sectionEl = node.closest('[data-inv-section]');
        const sectionId = sectionEl && sectionEl.getAttribute('data-inv-section');
        if (sectionId && railRef && railRef.current && typeof railRef.current.openSection === 'function') {
          railRef.current.openSection(sectionId);
        }
        const draftPath = resolveCanvasEditPath(draftRef.current?.invoice, node.dataset.invField);
        if (draftPath) highlightRailField(draftPath);
      };

      const onInput = () => {
        const existing = debounceTimersRef.current.get(node);
        if (existing) clearTimeout(existing);
        const timerId = setTimeout(() => {
          debounceTimersRef.current.delete(node);
          commitFromNode(node, { reformat: false });
        }, INPUT_DEBOUNCE_MS);
        debounceTimersRef.current.set(node, timerId);
      };

      const onBlur = () => {
        const existing = debounceTimersRef.current.get(node);
        if (existing) { clearTimeout(existing); debounceTimersRef.current.delete(node); }
        commitFromNode(node, { reformat: true });
        if (focusedNodeRef.current === node) focusedNodeRef.current = null;
      };

      const onKeydown = (e) => {
        const type = node.dataset.invType;
        if (e.key === 'Enter' && type !== 'multiline') {
          e.preventDefault();
          node.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          const existing = debounceTimersRef.current.get(node);
          if (existing) { clearTimeout(existing); debounceTimersRef.current.delete(node); }
          const committed = committedRef.current.get(node);
          if (committed) {
            node.textContent = committed.display;
            if (RAW_TYPES.has(type)) node.dataset.invRaw = committed.raw;
            // Revert the DRAFT too, not just the node's own display text — a
            // debounced auto-apply tick may already have written a partial
            // edit through to the draft (and therefore the rail/canvas
            // elsewhere) before Escape was pressed; leaving that write in
            // place while only fixing this node's text would desync the
            // canvas from the draft it mirrors.
            const currentDraft = draftRef.current;
            if (currentDraft && committed.value !== undefined) {
              writeValueToDraft(currentDraft, node.dataset.invField, committed.value);
            }
          }
          node.blur();
        }
      };

      node.addEventListener('focus', onFocus);
      node.addEventListener('input', onInput);
      node.addEventListener('blur', onBlur);
      node.addEventListener('keydown', onKeydown);
    });
  }, [clearAllDebounces, commitFromNode, highlightRailField, railRef, writeValueToDraft]);

  // ── draft -> canvas: value patch (D2) — every lastEdit patches every
  // matching, non-focused [data-inv-field] node (a field can render in more
  // than one place — e.g. billTo.name on the cover AND the Bill To card). ──
  useEffect(() => {
    const lastEdit = draft.lastEdit;
    if (!lastEdit) return;
    const frame = iframeRef.current;
    let doc = null;
    try { doc = frame?.contentDocument; } catch { doc = null; }
    if (!doc) return;
    const currency = draft.invoice?.currency;
    const locale = draft.invoice?.locale;
    doc.querySelectorAll('[data-inv-field]').forEach((node) => {
      if (node === focusedNodeRef.current) return;
      const renderedPath = node.dataset.invField;
      const draftPath = resolveCanvasEditPath(draft.invoice, renderedPath);
      if (draftPath !== lastEdit.path) return;
      const type = node.dataset.invType;
      const value = getAtPath(draft.invoice, draftPath);
      const display = formatValue(type, value, currency, locale);
      node.textContent = display;
      const raw = rawTextForType(type, value);
      committedRef.current.set(node, { display, raw, value });
      if (RAW_TYPES.has(type)) node.dataset.invRaw = raw;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.lastEdit]);

  // ── draft -> canvas: derived patch (D3) — every invoice change keeps
  // data-inv-derived nodes (item totals, subtotal/total/balanceDue) live,
  // regardless of whether the edit came from the rail or the canvas. ──
  useEffect(() => {
    const frame = iframeRef.current;
    let doc = null;
    try { doc = frame?.contentDocument; } catch { doc = null; }
    if (!doc) return;
    const patches = computeDerivedPatches(draft.invoice);
    if (!patches.length) return;
    const byPath = new Map(patches.map((p) => [p.path, p.display]));
    doc.querySelectorAll('[data-inv-derived]').forEach((node) => {
      const display = byPath.get(node.dataset.invDerived);
      if (display !== undefined) node.textContent = display;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.invoice]);

  // ── Mobile keyboard: keep the focused node visible (best-effort — see
  // this lane's own report for the honest limitation: the iframe is
  // CSS-transform-scaled inside a scrolling parent artboard, so this is a
  // reasonable approximation, not pixel-exact positioning). Registered ONCE
  // (mount-only deps) so it never duplicates across attach() calls. ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return undefined;
    const vv = window.visualViewport;
    const onViewportChange = () => {
      const node = focusedNodeRef.current;
      if (!node) return;
      try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* no-op */ }
      const frame = iframeRef.current;
      if (frame) {
        try { frame.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* no-op */ }
      }
    };
    vv.addEventListener('resize', onViewportChange);
    vv.addEventListener('scroll', onViewportChange);
    return () => {
      vv.removeEventListener('resize', onViewportChange);
      vv.removeEventListener('scroll', onViewportChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    clearAllDebounces();
    if (railHighlightTimerRef.current) clearTimeout(railHighlightTimerRef.current);
  }, [clearAllDebounces]);

  return { attach };
}

export default useInvoiceBridge;
