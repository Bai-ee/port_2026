'use client';

// Invoice Studio — the live invoice canvas (docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md P3).
//
// Renders `invoice`/`sections` through features/invoices/render.js's
// renderInvoiceDocument() DIRECTLY IN THE BROWSER (plan D1) and drops the
// resulting HTML into a same-origin `srcdoc` iframe (D3) — no server round
// trip for the preview, no injected <script>. Presented as a white paper
// sheet with a drop shadow, sized so the WHOLE sheet fits on screen by
// default, with a vertical zoom slider pinned to the board's left edge that
// scales up/down from that fit (its readout is the factor, 100% = fit),
// auto-height sized from the document's own content, and a render-error
// fallback in place of a blank iframe.
//
// No "on but empty, so not shown" hint: the admin card carries one
// (components/dashboard/InvoiceBuilderCard.jsx ~line 845) because its preview
// is a small pane you scroll past, but here the whole sheet is on screen and
// the rail states each section's own emptiness ("0 TERMS", "0 FLOW STEPS"),
// so the banner was restating what the operator can already see.
//
// Re-render policy (plan §4.3 / D4): the srcDoc string is only recomputed
// when `structureKey(invoice, sections)` changes value — section
// toggle/reorder, add/remove row, currency, status. A value-only edit
// (typing) must never reach this and swap the iframe out from under a live
// caret. That is enforced below by keying the render effect on the
// structureKey STRING (not on `invoice`/`sections` themselves) — see the
// effect's own comment.
//
// Seam left for lane E's bridge (P5 — NOT implemented here):
//   - This component forwards its ref to the live <iframe> DOM node
//     (forwardRef + useImperativeHandle), so a future useInvoiceBridge()
//     hook mounted above this component can reach
//     `ref.current.contentDocument` / `.contentWindow` directly once it
//     exists — no prop drilling of internal state required.
//   - `onDocumentRendered(frameEl)` fires from the iframe's own `load`
//     event after every srcDoc swap (i.e. exactly when `contentDocument` is
//     freshly populated and safe to touch), so the bridge knows when to
//     (re)attach its `[data-inv-field]` listeners.
// This file does NOT attach any editable-node listeners itself and does NOT
// call applyFieldEdit — that is entirely P5's job. The auto-height
// ResizeObserver below is presentation-only (it reads layout, it does not
// read/write draft data) and is required by this phase's own "iframe
// auto-height" acceptance bullet, not a bridge feature.

import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  lazy, Suspense,
} from 'react';
import { Printer, Download, FilePlus2, AlertTriangle } from 'lucide-react';
import { GLASS, ui } from '../components/rail-ui';
// ⚠️ THE risk this lane exists to prove out (handoff §"Known risk you will
// hit first"): render.js was just made client-safe by lane A (createRequire
// -> a generated ESM brief-css.js mirror). Node ESM import is verified;
// this is the first CLIENT bundle (webpack/Next dev) import of it. If this
// import breaks `next dev`, STOP and report the exact error — do not work
// around it with a server round-trip.
import { renderInvoiceDocument } from '../../../../features/invoices/render.js';
// HoloPaper presentation layer (H2 integration — docs/plans/
// INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §6, H8). BOTH the snapshot pipeline
// (Lane R's useInvoiceTexture/invoice-dom-snapshot.js) and the Three.js
// scene (Lane S's InvoiceHoloSurface) must stay out of Standard mode's
// bundle path per H8's own wording ("...or snapshot code"). A hook call
// can't itself be deferred (Rules of Hooks), so `InvoiceHoloOverlay.jsx`
// wraps the `useInvoiceTexture()` call in its own component and this file
// reaches it ONLY through `lazy()` + `<Suspense>` below, rendered only once
// `holoEnabled` is true (see the render section's own comment) — so neither
// module is fetched until an operator actually turns Holo on.
const InvoiceHoloOverlayLazy = lazy(() => import('./holo/InvoiceHoloOverlay'));

// Zoom is a MULTIPLIER ON TOP OF FIT, never an absolute scale. 1 = "the whole
// sheet fits on screen", which is the default the operator returns to and the
// state the canvas re-derives on every resize and every document-height change.
// An absolute scale would silently stop fitting the moment the invoice grew a
// section or the window changed size.
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;
// The pixel width the document is rendered/measured at before the CSS
// `transform: scale()` zoom is applied — matches features/invoices/render.js's
// INVOICE_CSS `.invoice-sheet { max-width:min(1180px, 94vw) }` comfortably
// while staying narrow enough to need no horizontal scroll on a typical
// Studio board width.
const NATIVE_WIDTH = 900;
// One page, US Letter portrait (8.5 x 11) at NATIVE_WIDTH. The sheet is never
// drawn shorter than this, so section toggles change the CONTENT of the page
// and not the size of the paper. Note the published PDF is deliberately a
// single continuous page sized to its content (see renderInvoiceDocument's
// estimatedHeightPx), so this is the canvas's paper metaphor, not a print
// constraint imposed on the output.
const PAGE_HEIGHT = Math.round(NATIVE_WIDTH * (11 / 8.5));
// The document is laid out at THIS width and painted down to the page width,
// which is what lets it use the page's full width instead of being scaled into
// a narrow column in the middle of it (a uniform fit-to-page scale shortens and
// narrows in equal measure, so the sheet's width went unused).
//
// 1255 is chosen so the invoice's own `.invoice-sheet { max-width:min(1180px,
// 94vw) }` lands exactly on its 1180px cap: wider buys no more text per line,
// only interior gutter. Laying out this wide reflows the content onto fewer,
// longer lines, which is what makes the full section set fit a page at a
// readable size.
//
// Deliberately a CONSTANT, not solved per document: the "correct" width is the
// one whose content aspect matches the page, but measuring it means feeding the
// measurement back into the layout that produced it. That version oscillated
// and froze the renderer.
const LAYOUT_WIDTH = 1255;
// Painting the layout at this scale makes it exactly one page wide.
const CONTENT_SCALE = NATIVE_WIDTH / LAYOUT_WIDTH;
// Stage chrome. These drive BOTH the layout styles below and the fit maths —
// the fit scale is computed against the stage, so every pixel of chrome
// between the stage edge and the sheet has to be subtracted here or "fit"
// hands back a sheet fractionally too big and the artboard grows a scrollbar.
const SLIDER_COLUMN_WIDTH = 26;  // the zoom slider column, floated over the artboard's left padding
// The sheet's shadow is `0 22px 60px` + `0 4px 16px`, so it reaches ~60px to
// the sides and top and ~82px below. `overflow:auto` clips at the PADDING
// edge, so anything less than the shadow's own reach saws it off in a hard
// band instead of letting it fade out.
const ARTBOARD_PAD_X = 64;       // desktop; narrow uses ARTBOARD_PAD_X_NARROW
const ARTBOARD_PAD_X_NARROW = 16;
const ARTBOARD_PAD_TOP = 44;
const ARTBOARD_PAD_BOTTOM = 92;
// Only the artboard's own padding: the zoom slider is absolutely positioned
// over that left padding, so it costs the sheet no layout width.
const FIT_HORIZONTAL_CHROME = ARTBOARD_PAD_X * 2;
const FIT_VERTICAL_CHROME = ARTBOARD_PAD_TOP + ARTBOARD_PAD_BOTTOM;
const MOBILE_ARTBOARD_HEIGHT = 560;
const FALLBACK_DOC_HEIGHT = PAGE_HEIGHT;

// useInvoiceDraft.js's `sections` is the flat EDITOR shape:
// { include: {id: boolean}, order: string[] }. render.js's
// resolveInvoiceSections() (via registry.js's normalizeInvoiceSectionConfig)
// expects its own WIRE shape: { include, order: { sections: string[] } }.
// Passing the flat shape straight through silently loses the user's section
// ORDER — `raw.order.sections` reads as undefined off a bare array, so
// normalizeInvoiceSectionConfig falls back to registry order every time
// (include/on-off still works, since `include` itself needs no nesting).
// This conversion is the one piece of glue the canvas owns between the P0
// editor shape and lane A's renderer contract — see useInvoiceDraft.js's own
// "Sections shape" comment, which calls out this exact distinction.
function toWireSections(sections) {
  return {
    include: (sections && sections.include) || {},
    order: { sections: Array.isArray(sections && sections.order) ? sections.order : [] },
  };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const InvoiceCanvas = forwardRef(function InvoiceCanvas(
  {
    invoice,
    sections,
    // Design-layer plan §3.4 — both come from the ONE `useInvoiceDraft()`
    // computation (InvoiceStudio.jsx passes `draft.theme`/`draft.structureKey`
    // straight through); this component must not compute a second, divergent
    // structureKey from invoice/sections itself (L6).
    theme = null,
    structureKey,
    isAdmin = false,
    isNarrow = false,
    onNewInvoice = null,
    onDocumentRendered = null,
    // HoloPaper presentation layer (H2 — docs/plans/
    // INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §6). `presentation` is the INNER
    // state object ({holoEnabled, sceneInteractive, sceneStatus,
    // resetViewToken}) — InvoiceStudio.jsx passes `presentation.presentation`,
    // not the full useInvoicePresentation() return value (CoverCard gets that
    // full shape instead, since it also needs the setters). `setSceneStatus`/
    // `setSceneInteractive` let this component report scene lifecycle back
    // (ready/loading/fallback) and force interaction off on a WebGL fallback
    // (H16) — this file never calls `setHoloEnabled` itself; that control
    // lives entirely in CoverCard.
    presentation = null,
    setSceneStatus = null,
    setSceneInteractive = null,
  },
  ref,
) {
  const iframeRef = useRef(null);
  const stageRowRef = useRef(null);
  const artboardAreaRef = useRef(null);
  const paperShellRef = useRef(null);
  const resizeObserverRef = useRef(null);
  // Pinch binding for the iframe's own document, re-made on every srcDoc swap.
  const unbindFramePinchRef = useRef(null);
  const bindPinchRef = useRef(() => undefined);

  // Exposes the raw iframe DOM node (not a wrapper object) — a future bridge
  // reads `.contentDocument`/`.contentWindow` off it exactly like any other
  // iframe ref. `iframeRef.current` is read fresh on every call, so no
  // dependency array is needed for correctness; it only affects how often
  // React re-registers the handle, which is cheap.
  useImperativeHandle(ref, () => iframeRef.current);

  // ── Brand (D8/D10) ───────────────────────────────────────────────────
  // Admin-only, and reached ONLY via dynamic import — brand-marks.js's 57KB
  // of owner logo/signature data URIs must never sit in the bytes a public
  // visitor downloads just because this component imported it statically.
  // Mirrors invoice-seeds.js's own adminSeed() dynamic-import idiom.
  const [brand, setBrand] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!isAdmin) { setBrand(null); return undefined; }
    import('../../../../features/invoices/brand-marks.js')
      .then(({ HITLOOP_BRAND }) => { if (!cancelled) setBrand(HITLOOP_BRAND || null); })
      .catch(() => { if (!cancelled) setBrand(null); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  // ── Default-from identity (D13 bundle-inspection follow-up) ────────────
  // Same admin-only dynamic-import shape as `brand` above, for the same
  // reason: features/invoices/default-from.js's DEFAULT_FROM is the owner's
  // real email/phone/address as literal strings — a static import would put
  // them in every bundle that imports this component, including the public
  // one. model.js's own default flipped to "no backfill" (see model.js's
  // normalizeInvoice() doc comment), so admin editing needs this explicitly
  // to keep backfilling a blank `from` the way today's publish flow does.
  const [defaultFrom, setDefaultFrom] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!isAdmin) { setDefaultFrom(null); return undefined; }
    import('../../../../features/invoices/default-from.js')
      .then(({ DEFAULT_FROM }) => { if (!cancelled) setDefaultFrom(DEFAULT_FROM || null); })
      .catch(() => { if (!cancelled) setDefaultFrom(null); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  // ── Payment QR (D13 bundle-inspection follow-up) ────────────────────────
  // render.js no longer resolves invoice.payment.qr itself — the caller
  // must resolve it (features/invoices/payment-qr.js's resolvePaymentQr())
  // and pass the already-resolved code as options.paymentQr. Same admin-only
  // dynamic-import shape as `brand`/`defaultFrom`: payment-qr.js's Venmo QR
  // data URI and handle must never sit in the public bundle. Re-resolves
  // whenever the invoice's own qr key changes (e.g. the rail's payment
  // method picker), not just on mount.
  const [paymentQr, setPaymentQr] = useState(null);
  const paymentQrKey = invoice?.payment?.qr || '';
  useEffect(() => {
    let cancelled = false;
    if (!isAdmin || !paymentQrKey) { setPaymentQr(null); return undefined; }
    import('../../../../features/invoices/payment-qr.js')
      .then(({ resolvePaymentQr }) => { if (!cancelled) setPaymentQr(resolvePaymentQr(paymentQrKey) || null); })
      .catch(() => { if (!cancelled) setPaymentQr(null); });
    return () => { cancelled = true; };
  }, [isAdmin, paymentQrKey]);

  const [docHtml, setDocHtml] = useState('');
  const [renderError, setRenderError] = useState(null);
  // Seeded from renderInvoiceDocument()'s own estimatedHeightPx on every
  // structural re-render (a reasonable guess before the iframe has actually
  // laid out its content), then corrected/kept live by handleFrameLoad's
  // measure()+ResizeObserver below once the browser has real numbers.
  const [docHeight, setDocHeight] = useState(FALLBACK_DOC_HEIGHT);

  // HoloPaper presentation flags (H2), declared ahead of handleFrameLoad
  // below (which bumps loadTick) so nothing in this file reads a `const`
  // before its declaration line — see "── HoloPaper texture refresh
  // triggers" further down for the rest of this feature's state.
  const holoEnabled = Boolean(presentation && presentation.holoEnabled);
  const holoInteractive = Boolean(presentation && presentation.holoEnabled && presentation.sceneInteractive);
  const [loadTick, setLoadTick] = useState(0);
  // `holoEnabled` can be true from the very first render (H7/`holoEnabled`
  // persists locally, so a reload with Holo already on is expected use) —
  // but the iframe itself hasn't fired its first `load` yet at that point
  // (docHtml is still being computed/applied). Gate the actual Holo overlay
  // mount (below, in the render section) on having a real, once-loaded
  // document first, so scene creation/texture capture never races the
  // iframe's very first srcDoc application. Set once in handleFrameLoad and
  // never unset — later srcDoc swaps replace content but the iframe itself
  // has already "loaded once" for this purpose.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    try {
      const result = renderInvoiceDocument(invoice, {
        sections: toWireSections(sections),
        editable: true,
        brand,
        // Design-layer plan §3.3 — theme is an editor-only render option.
        // render.js does not consume it yet in this phase (Lane T wires it in
        // Q3); passing it now is forward-compatible plumbing only — an
        // unread options key changes nothing about today's output.
        theme,
        // D13 (bundle-inspection follow-up): model.js's own default is now
        // "no backfill" — a blank `from.*` field stays honestly blank unless
        // the caller explicitly passes the owner's real identity. `brand`
        // and `defaultFrom` are both null on the public path (isAdmin false,
        // see the state hooks above), so a public render never surfaces it.
        // On the admin path they resolve via the same dynamic-import shape,
        // matching today's publish behavior exactly (features/invoices/
        // render.js's own renderInvoiceDocument, and the invoices test suite's
        // "defaultFrom:null + brand:null leaves no owner identity anywhere in
        // the output" / "payment QR only renders when the caller resolves
        // and passes options.paymentQr" tests).
        defaultFrom,
        paymentQr,
      });
      setDocHtml(result.html);
      setDocHeight(result.estimatedHeightPx || FALLBACK_DOC_HEIGHT);
      setRenderError(null);
    } catch (err) {
      setRenderError((err && err.message) || 'Could not render this invoice.');
    }
    // Deliberately keyed on the structureKey STRING (passed in as a prop —
    // see the destructure comment above; this component computes no
    // second, divergent key), not `invoice`/`sections` directly. React
    // effects always read the latest closure when they DO run, so this
    // still picks up whatever was typed since the last structural change —
    // it just doesn't re-run (and swap srcDoc, destroying focus/caret) on
    // every keystroke. See the module header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, isAdmin, brand, defaultFrom, paymentQr]);

  // ── Auto-height (presentation only — measures, never mutates draft) ────
  // A ResizeObserver on contentDocument.documentElement, per §4.2's own
  // mechanics, kept live for the life of each document (not just once on
  // load) so it stays correct if a future bridge patches text in place
  // without a full srcDoc swap.
  const handleFrameLoad = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    let doc = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    const measure = () => {
      if (!doc || !doc.documentElement) return;
      // ⚠️ Measure the BODY, not documentElement. `documentElement.scrollHeight`
      // is clamped to at least the iframe's viewport height — and this
      // component sets that height FROM this measurement, so reading it makes
      // the value self-referential: it can grow but never shrink. That pinned
      // docHeight at a stale 2042px while the real content was 1467px and drove
      // the fit scale down to 0.24, painting a near-blank page.
      const h = doc.body && doc.body.scrollHeight
        ? doc.body.scrollHeight
        : doc.documentElement.scrollHeight || 0;
      // Raw CONTENT height. The sheet's own height is PAGE_HEIGHT (see
      // contentScale below) — these are deliberately two different numbers.
      if (h > 0) setDocHeight(h);
    };
    measure();
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (doc && doc.documentElement && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(doc.documentElement);
      resizeObserverRef.current = ro;
    }
    // Re-bind pinch to the fresh document: a srcDoc swap throws away the old
    // one along with every listener on it. `bindPinchRef` (not bindPinch
    // directly) keeps this callback off the pinch handler's identity, which
    // would otherwise churn the iframe's onLoad prop on every zoom change.
    if (unbindFramePinchRef.current) unbindFramePinchRef.current();
    unbindFramePinchRef.current = doc ? bindPinchRef.current(doc) : null;

    // Holo texture refresh trigger #1 (handoff §4): "iframe `load` after
    // structural rerender". `srcDoc` only swaps on a STRUCTURAL edit (see the
    // module header), so this fires exactly when a fresh document has just
    // replaced the old one — independent of `refreshKey` below, which is why
    // `useInvoiceTexture`'s own `loadTick` lever exists (see that hook's
    // header comment). Harmless while Holo is disabled — `useInvoiceTexture`
    // no-ops every trigger while `enabled` is false.
    setLoadTick((t) => t + 1);
    setHasLoadedOnce(true);

    if (typeof onDocumentRendered === 'function') onDocumentRendered(frame);
  }, [onDocumentRendered]);

  useEffect(() => () => {
    if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
    if (unbindFramePinchRef.current) unbindFramePinchRef.current();
  }, []);

  // ── HoloPaper texture refresh triggers (H2) ─────────────────────────────
  // Holo texture refresh trigger #2: "debounced draft.invoice/draft.lastEdit
  // changes while Holo is enabled". This component has no `draft` prop (P3's
  // own contract — see the module header, "nothing in this file reads/writes
  // invoice fields directly") and useInvoiceDraft.js/useInvoiceBridge.js are
  // both out of this lane's ownership, so a new prop threaded down from
  // InvoiceStudio was avoided on purpose. A MutationObserver on the iframe's
  // OWN live `contentDocument.body` is a self-contained way to see the same
  // signal: useInvoiceBridge.js patches text via plain `node.textContent =
  // ...` assignments (childList/characterData mutations) for BOTH canvas- and
  // rail-origin edits, so this single observer organically covers every edit
  // path without needing to know which one fired. Debounced locally (200ms)
  // to coalesce a burst of DOM mutations into one state bump per pause in
  // typing — useInvoiceTexture.js applies its OWN 250ms debounce on top of
  // this, per the handoff's "no more than one capture per 250ms" budget.
  const [bridgeEditTick, setBridgeEditTick] = useState(0);
  const bridgeEditTimerRef = useRef(null);
  useEffect(() => {
    if (!holoEnabled) return undefined;
    const frame = iframeRef.current;
    let doc = null;
    try { doc = frame && frame.contentDocument; } catch { doc = null; }
    if (!doc || !doc.body || typeof MutationObserver === 'undefined') return undefined;
    const scheduleBump = () => {
      if (bridgeEditTimerRef.current) clearTimeout(bridgeEditTimerRef.current);
      bridgeEditTimerRef.current = setTimeout(() => {
        bridgeEditTimerRef.current = null;
        setBridgeEditTick((t) => t + 1);
      }, 200);
    };
    const observer = new MutationObserver(scheduleBump);
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (bridgeEditTimerRef.current) { clearTimeout(bridgeEditTimerRef.current); bridgeEditTimerRef.current = null; }
    };
    // Re-attach on every Holo on/off flip AND every structural reload
    // (`loadTick`) — a srcDoc swap replaces `contentDocument` wholesale,
    // orphaning any observer still watching the OLD document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holoEnabled, loadTick]);

  // Holo texture refresh trigger #3: "theme, locale, label, logo, section
  // include/order, or document-kind changes" — all of these are STRUCTURAL
  // per invoice-fields.js's own structureKey(invoice, sections, theme), so
  // `structureKey` alone already covers this trigger (and #1's fallback
  // coverage) without re-deriving anything here.
  const refreshKey = `${structureKey}::${bridgeEditTick}`;

  // Texture pipeline (Lane R) — the actual `useInvoiceTexture()` call lives
  // inside the lazily-loaded InvoiceHoloOverlay.jsx (H8, see the module
  // header above), not here; this file only computes/forwards the plain
  // `refreshKey`/`loadTick` values it already needs to expose either way.

  // ── Reduced motion (H15) ────────────────────────────────────────────────
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', update);
    else if (typeof mq.addListener === 'function') mq.addListener(update); // older Safari
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', update);
      else if (typeof mq.removeListener === 'function') mq.removeListener(update);
    };
  }, []);

  // ── Visibility / offscreen pause ────────────────────────────────────────
  // Tab-hidden (Page Visibility API) is the mandatory half; an
  // IntersectionObserver on the paper shell additionally catches the sheet
  // scrolling out of view within a still-visible tab (the artboard area is
  // its own `overflow:auto` scroller — see #invoice-studio-artboard-area
  // below). Both feed InvoiceHoloSurface's `active` prop, which the surface
  // itself turns into scene.pause()/resume() (Lane S).
  const [tabVisible, setTabVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'));
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibilityChange = () => setTabVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const [inViewport, setInViewport] = useState(true);
  useEffect(() => {
    if (!holoEnabled) return undefined;
    const el = paperShellRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInViewport(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      setInViewport(entry ? entry.isIntersecting : true);
    }, { root: artboardAreaRef.current || null, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [holoEnabled]);

  const holoActive = tabVisible && inViewport;

  // ── Scene lifecycle reporting (H16) ─────────────────────────────────────
  useEffect(() => {
    if (typeof setSceneStatus !== 'function') return;
    // Turning Holo OFF already synchronously resets sceneStatus to 'idle'
    // inside useInvoicePresentation.js's own setHoloEnabled(false) — nothing
    // to mirror here for that direction.
    if (holoEnabled) setSceneStatus('loading');
  }, [holoEnabled, setSceneStatus]);

  const handleHoloReady = useCallback(() => {
    if (typeof setSceneStatus === 'function') setSceneStatus('ready');
  }, [setSceneStatus]);

  const handleHoloFallback = useCallback(() => {
    // H16: "falls back to Holo non-interactive DOM mode" — forcing
    // interaction off restores the live, editable iframe (see the iframe's
    // inert/aria-hidden wiring below) instead of stranding the operator on a
    // WebGL surface that just reported it cannot render.
    if (typeof setSceneStatus === 'function') setSceneStatus('fallback');
    if (typeof setSceneInteractive === 'function') setSceneInteractive(false);
  }, [setSceneStatus, setSceneInteractive]);

  // ── Zoom — fit-the-whole-sheet by default, slider scales from there ──────
  // `zoomFactor` is relative to the fit scale (1 = fits on screen), so the
  // default survives a window resize, a rail toggle that lengthens the
  // invoice, and a switch to a longer document — all of which change the fit
  // ratio underneath. Fitting on BOTH axes (contain, not fit-to-width) is what
  // "fit on screen" means for a document that is much taller than it is wide.
  const [zoomFactor, setZoomFactor] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: NATIVE_WIDTH, height: 0 });
  useEffect(() => {
    const el = stageRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0] && entries[0].contentRect;
      if (rect && rect.width) setContainerSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Fit-to-page ─────────────────────────────────────────────────────────
  // The SHEET is a fixed page; the DOCUMENT is scaled to fit inside it, the
  // way a printer's "fit to page" does. That is what keeps the paper one size
  // no matter which sections are switched on: a toggle changes what is printed
  // on the page, never the page.
  //
  // The alternative — sizing the sheet to its content — is what this used to
  // do, and it meant every toggle resized the paper (measured: aspect swinging
  // 2.27 -> 1.52 across three toggles).
  //
  // ⚠️ Known trade-off, accepted by the owner: the published PDF is a single
  // continuous page sized to its content, so once contentScale < 1 the canvas
  // renders the type smaller than the printed invoice does. The layout is
  // identical; only the scale differs.
  const contentScale = CONTENT_SCALE;
  // A document past one page grows the SHEET downward at the current scale
  // (paginating, not shrinking type to squeeze back onto one page) — see
  // fitScale below, which deliberately does not react to this value.
  const sheetHeight = Math.max(PAGE_HEIGHT, docHeight * contentScale);

  const fitScale = useMemo(() => {
    // Measured off the STAGE, never off the artboard: the artboard shrinks to
    // the paper, so measuring it would feed the paper's own size back into the
    // scale that sizes it — a loop that settles at the wrong number.
    const chromeX = isNarrow
      ? (ARTBOARD_PAD_X_NARROW * 2)
      : FIT_HORIZONTAL_CHROME;
    const byWidth = (containerSize.width - chromeX) / NATIVE_WIDTH;
    // Height only constrains when we actually know it (0 before first measure,
    // and on narrow screens the area is a fixed-height scroller where fitting
    // a tall invoice to it would shrink the sheet to unreadable).
    //
    // ⚠️ Fits against the CONSTANT one-page height, never the live `sheetHeight`
    // (which tracks docHeight). Fitting against `sheetHeight` made the on-screen
    // scale — and so the sheet's visible size/position — recompute on every
    // section toggle once a document ran past one page, which read as the sheet
    // "shifting" whenever an eye was switched on/off (owner-reported). A
    // multi-page document now stays at one-page scale and grows DOWN past the
    // fold instead (the artboard already scrolls — see its own comment); only
    // an explicit zoom or a window resize changes scale now.
    const byHeight = containerSize.height && !isNarrow
      ? (containerSize.height - FIT_VERTICAL_CHROME) / PAGE_HEIGHT
      : Infinity;
    return Math.max(0.1, Math.min(byWidth, byHeight));
  }, [containerSize, isNarrow]);

  const scale = Math.max(0.05, fitScale * zoomFactor);

  // ── Pinch to zoom ───────────────────────────────────────────────────────
  // Drives the SAME `zoomFactor` the slider does, so the slider tracks a
  // pinch and the Fit button still resets both.
  //
  // Two input paths, because a trackpad pinch is not a touch event on the
  // desktop web: macOS/Windows trackpads deliver it as `wheel` with
  // `ctrlKey` set (the same gesture the browser would otherwise use to zoom
  // the whole page — hence preventDefault, which needs a non-passive
  // listener and so cannot be a React onWheel prop). Touchscreens deliver a
  // real two-finger `touchmove`.
  //
  // Both are attached to the iframe's document as well as the artboard:
  // the iframe covers the entire sheet, and events over it never reach the
  // parent document, so pinching ON the invoice would otherwise do nothing.
  const pinchDistanceRef = useRef(0);
  const applyZoomDelta = useCallback((multiplier) => {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    setZoomFactor((prev) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * multiplier)));
  }, []);

  const bindPinch = useCallback((target) => {
    if (!target || typeof target.addEventListener !== 'function') return undefined;
    const touchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };
    const onWheel = (e) => {
      if (!e.ctrlKey) return; // a plain wheel still scrolls the artboard
      e.preventDefault();
      // exp() keeps the gesture symmetric: pinching out then back in the same
      // distance returns to the same zoom, which a linear step does not.
      applyZoomDelta(Math.exp(-e.deltaY * 0.01));
    };
    const onTouchStart = (e) => {
      if (e.touches.length === 2) pinchDistanceRef.current = touchDistance(e.touches);
    };
    const onTouchMove = (e) => {
      if (e.touches.length !== 2 || !pinchDistanceRef.current) return;
      e.preventDefault();
      const next = touchDistance(e.touches);
      applyZoomDelta(next / pinchDistanceRef.current);
      pinchDistanceRef.current = next;
    };
    const onTouchEnd = () => { pinchDistanceRef.current = 0; };

    target.addEventListener('wheel', onWheel, { passive: false });
    target.addEventListener('touchstart', onTouchStart, { passive: true });
    target.addEventListener('touchmove', onTouchMove, { passive: false });
    target.addEventListener('touchend', onTouchEnd, { passive: true });
    target.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchmove', onTouchMove);
      target.removeEventListener('touchend', onTouchEnd);
      target.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [applyZoomDelta]);

  bindPinchRef.current = bindPinch;
  useEffect(() => bindPinch(artboardAreaRef.current), [bindPinch]);

  // ── Actions (public-capable — D9) ───────────────────────────────────────
  // Design-layer plan Q3 (Lane T) — a themed invoice's webfonts (Ledger/
  // Editorial/Studio Dark's catalog faces, loaded via themeFontsHref()) are
  // NOT the default Doto/Space Grotesk/Space Mono trio every render already
  // preloads, so they may still be in flight the instant the operator clicks
  // Print. Give them a bounded chance to finish on the IFRAME's OWN
  // `document.fonts` (never the parent window's — that object has nothing to
  // do with what's rendered inside the iframe) before the print dialog
  // captures the page. Bounded so a font that never resolves (offline,
  // blocked request) cannot hang Print indefinitely; on the Default theme
  // (fonts already warm) this resolves near-instantly either way.
  const handlePrint = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame || !frame.contentWindow) return;
    let doc = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    const fontsReady = doc && doc.fonts && typeof doc.fonts.ready?.then === 'function'
      ? doc.fonts.ready
      : Promise.resolve();
    try {
      await Promise.race([fontsReady, new Promise((resolve) => { setTimeout(resolve, 1500); })]);
    } catch {
      // A rejected fonts.ready (rare) must never block printing.
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }, []);

  // `docHtml` (React state) is only refreshed on a STRUCTURAL re-render
  // (D4) — a value-only edit, from either the canvas or the rail, patches
  // the live iframe DOM directly via useInvoiceBridge.js and never touches
  // this string (Invoice Studio design-layer plan Q1). Downloading it
  // verbatim would silently drop every live edit made since the last
  // structural render. Serialize the LIVE document instead, on a clone with
  // the bridge's editor-only scaffolding stripped (the `contenteditable`
  // attribute it adds to every field, and its injected hover/focus outline
  // `<style>` tag) so the downloaded file is a clean snapshot, not a copy of
  // the in-Studio editing surface.
  const handleDownloadHtml = useCallback(() => {
    const frame = iframeRef.current;
    let liveDoc = null;
    try { liveDoc = frame && frame.contentDocument; } catch { liveDoc = null; }
    let html = docHtml;
    if (liveDoc && liveDoc.documentElement) {
      const clone = liveDoc.documentElement.cloneNode(true);
      clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
      const bridgeStyle = clone.querySelector('#invoice-bridge-canvas-highlight-style');
      if (bridgeStyle) bridgeStyle.remove();
      html = `<!doctype html>\n${clone.outerHTML}`;
    }
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const safeName = String((invoice && invoice.invoiceNumber) || 'invoice').replace(/[^a-z0-9-]+/gi, '-');
    triggerDownload(blob, `${safeName}.html`);
  }, [docHtml, invoice]);

  const handleNewInvoice = useCallback(() => {
    if (typeof onNewInvoice === 'function') onNewInvoice();
  }, [onNewInvoice]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: isNarrow ? 'auto' : '100%', minHeight: 0 }}>
      {/* Stage — the zoom slider column sits OUTSIDE the scrolling artboard
          area so it stays put against the paper's left edge when a zoomed-in
          sheet scrolls. The top padding clears the Studio's own fixed
          furniture (homepage logo top-left, tool switcher top-right), which
          overlay this board rather than sharing a row with it. */}
      <div
        id="invoice-studio-stage-row"
        ref={stageRowRef}
        // The Studio's shared GlassTooltipLayer auto-attaches a hover tooltip
        // to icon-only controls; on a canvas whose whole point is the document
        // it just covers the sheet. Opt the entire subtree out.
        data-tooltip-disabled="true"
        style={{
          position: 'relative',
          // Centered as a GROUP so the slider hugs the paper's left edge —
          // centering the artboard alone strands the slider against the board.
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 0,
          padding: isNarrow ? '12px 12px 0' : '64px 24px 0',
          ...(isNarrow ? { flex: 'none' } : { flex: 1, minHeight: 0 }),
        }}
      >
        <div
          id="invoice-studio-zoom-slider-column"
          style={{
            // Pinned to the board's left edge and vertically centred, rather
            // than sitting in the flex flow beside the sheet — it floats over
            // the artboard's left padding, so the sheet stays centred in the
            // full board width at every zoom.
            position: 'absolute', left: isNarrow ? 8 : 18, top: '50%', transform: 'translateY(-50%)',
            zIndex: 3, width: SLIDER_COLUMN_WIDTH, boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}
        >
          <input
            id="invoice-studio-zoom-slider"
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoomFactor}
            onChange={(e) => setZoomFactor(Number(e.target.value))}
            aria-label="Zoom"
            // Vertical range input: `writing-mode:vertical-rl` is the modern
            // way (Chrome 121+/Firefox), `slider-vertical` the legacy WebKit
            // one. Both are set so the control is vertical either way.
            style={{
              // Fixed track length: `flex:1` stretched it to the full board
              // height, which read as a page-scroll rail rather than a zoom.
              height: 128, width: 24, margin: 0,
              writingMode: 'vertical-rl', direction: 'rtl',
              WebkitAppearance: 'slider-vertical',
              accentColor: GLASS.ink, cursor: 'ns-resize',
            }}
          />
          <span
            id="invoice-studio-zoom-readout"
            style={{ ...ui.label, fontSize: 9, letterSpacing: '0.04em', width: '100%', textAlign: 'center' }}
          >
            {`${Math.round(zoomFactor * 100)}%`}
          </span>
        </div>

        <div
          id="invoice-studio-artboard-area"
          ref={artboardAreaRef}
          style={{
            // Fills the stage: the slider is absolutely positioned over the
            // left padding now, so nothing competes for flow width and the
            // sheet centres in the whole board.
            flex: 1, minWidth: 0, maxWidth: '100%',
            display: 'flex', justifyContent: 'center', overflow: 'auto', boxSizing: 'border-box',
            // The sheet's drop shadow reaches ~80px below it. `overflow:auto`
            // clips at the padding edge, so without this the shadow is sliced
            // off in a hard grey band that reads as a scrollbar.
            padding: isNarrow
              ? `${ARTBOARD_PAD_TOP / 2}px ${ARTBOARD_PAD_X_NARROW}px ${ARTBOARD_PAD_BOTTOM / 2}px`
              : `${ARTBOARD_PAD_TOP}px ${ARTBOARD_PAD_X}px ${ARTBOARD_PAD_BOTTOM}px`,
            ...(isNarrow
              ? { height: MOBILE_ARTBOARD_HEIGHT, flex: 'none', width: '100%' }
              : { minHeight: 0, maxHeight: '100%' }),
          }}
        >
        {renderError ? (
          <div
            id="invoice-studio-render-error"
            role="alert"
            style={{
              alignSelf: 'flex-start', display: 'flex', gap: 10, alignItems: 'flex-start',
              maxWidth: 520, padding: '14px 16px', borderRadius: 10,
              background: 'rgba(254,226,226,0.9)', border: '1px solid rgba(248,113,113,0.4)',
              fontFamily: GLASS.mono, fontSize: 12, lineHeight: 1.5, color: GLASS.ink,
            }}
          >
            <AlertTriangle size={16} strokeWidth={2.5} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Couldn&apos;t render this invoice: {renderError}</span>
          </div>
        ) : (
          <div
            id="invoice-studio-paper-shell"
            ref={paperShellRef}
            style={{
              // `margin:auto` centres the sheet on BOTH axes and, unlike
              // align-items:center, still lets an over-tall sheet scroll from
              // its top edge instead of clipping it.
              // overflow:hidden is load-bearing: `transform: scale()` shrinks
              // what the iframe PAINTS but leaves its layout box at the full
              // NATIVE_WIDTH x docHeight, which spills out of the scaled shell
              // and gives the artboard a phantom scrollbar.
              flexShrink: 0, position: 'relative', background: '#ffffff', borderRadius: 4,
              margin: 'auto', overflow: 'hidden',
              // The PAGE, not the content: constant while contentScale absorbs
              // however much document there is to fit on it.
              width: NATIVE_WIDTH * scale, height: sheetHeight * scale,
              boxShadow: '0 22px 60px rgba(20,20,30,0.22), 0 4px 16px rgba(0,0,0,0.10)',
            }}
          >
            <iframe
              id="invoice-studio-preview-frame"
              ref={iframeRef}
              title="Invoice preview"
              srcDoc={docHtml}
              onLoad={handleFrameLoad}
              // H6: interaction mode transfers pointer ownership to the WebGL
              // scene — the iframe stays mounted (never remounted/reloaded)
              // but becomes inert + hidden from assistive tech for that
              // period; turning interaction off simply drops both attributes,
              // restoring the SAME live document with every edit intact.
              inert={holoInteractive ? true : undefined}
              aria-hidden={holoInteractive ? 'true' : undefined}
              style={{
                display: 'block', width: LAYOUT_WIDTH, height: docHeight, border: 'none',
                // No centring offset needed: the layout is LAYOUT_WIDTH wide
                // and CONTENT_SCALE paints it to exactly NATIVE_WIDTH, so the
                // document already spans the full page width.
                transform: `scale(${scale * contentScale})`,
                transformOrigin: 'top left', background: '#ffffff',
              }}
            />
            {/* HoloPaper overlay/scene (H2). Only ever present in the DOM
                while Holo is enabled — Standard mode (`holoEnabled` false)
                renders none of this, keeping Standard's DOM/output identical
                to before this phase. `InvoiceHoloOverlayLazy` is a
                `React.lazy` import (see the module header) so its module —
                the `useInvoiceTexture()` snapshot pipeline, InvoiceHoloSurface,
                and (via InvoiceHoloSurface's own internal dynamic import)
                `three`/`three-stdlib` — is never fetched until this branch
                actually renders, i.e. never in Standard mode (H8). Positioned
                `absolute; inset:0` within this shell's own `position:relative`
                box, so it aligns exactly to the sheet without any separate
                measurement. */}
            {holoEnabled && hasLoadedOnce ? (
              <div
                id="invoice-studio-holo-overlay"
                style={{
                  position: 'absolute', inset: 0,
                  // H5: non-interactive Holo is pointer-through so the real
                  // iframe underneath stays directly clickable/editable.
                  // H6: interactive Holo owns the pointer.
                  pointerEvents: holoInteractive ? 'auto' : 'none',
                }}
              >
                <Suspense fallback={null}>
                  <InvoiceHoloOverlayLazy
                    iframeEl={iframeRef.current}
                    refreshKey={refreshKey}
                    loadTick={loadTick}
                    interactive={holoInteractive}
                    reducedMotion={reducedMotion}
                    active={holoActive}
                    resetViewToken={presentation ? presentation.resetViewToken : null}
                    onReady={handleHoloReady}
                    onFallback={handleHoloFallback}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
        )}
        </div>
      </div>

      <div
        id="invoice-studio-actions-row"
        style={{
          // Centred, so the actions sit under the sheet (which is itself
          // centred in the board) rather than trailing off to one side.
          flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap',
          padding: isNarrow ? '10px 12px 16px' : '14px 24px 22px',
        }}
      >
        {/* Autosave state is deliberately not surfaced here: "New draft" said
            nothing the operator needed, and the rail's Publish card already
            carries the saved/unsaved state that actually matters. */}
        <button onClick={handleNewInvoice} style={{ ...ui.btn(false), gap: 6 }}>
          <FilePlus2 size={14} strokeWidth={2.5} /> New invoice
        </button>
        <button onClick={handleDownloadHtml} style={{ ...ui.btn(false), gap: 6 }}>
          <Download size={14} strokeWidth={2.5} /> Download .html
        </button>
        <button id="invoice-studio-print-btn" className="cta-pill-btn" onClick={handlePrint} style={{ ...ui.cta, gap: 8 }}>
          <Printer size={14} strokeWidth={2.5} /> Print / Save PDF
        </button>
      </div>
    </div>
  );
});

export default InvoiceCanvas;
