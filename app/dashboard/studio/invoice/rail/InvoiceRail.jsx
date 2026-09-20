'use client';

// Invoice Studio — the right-hand rail. Composes ONE rail card per invoice
// SECTION (features/invoices/registry.js's 14 ids), titled exactly as that
// section prints on the paper (see each card file's own header comment for
// its render.js source), plus the two admin-only, non-section cards
// (PublishCard, SavedInvoicesCard) below a visual divider. This supersedes
// the original lane-D P4 layout (10 cards grouped by editing convenience —
// Details/Parties/Line items/.../Sections) — see
// docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md for the P0-P4 history this
// builds on; the section-per-card rework is a follow-up, not part of that
// doc's phases.
//
// Section cards render in `draft.sections.order` — NOT a hardcoded list —
// so the rail re-orders itself live as the operator drags a card by its grab
// bar (useRailDragReorder.js, wired up below). Each card also carries an EYE
// toggle (right of its expand control, via RailCard's `trailing` prop) that
// flips `sections.include[id]` without expanding/collapsing — see
// SectionCard.jsx for both controls' implementation; it owns them once for
// every card below instead of every file re-wiring toggleSection itself.
//
// Owns the rail shell (`invoice-studio-rail` / `invoice-studio-rail-inner`,
// the ids lane C's InvoiceStudio.jsx reserves for this component), and owns
// the admin-only publish/saved-invoices state that two sibling cards
// (PublishCard, SavedInvoicesCard) both need to read and write (see
// PublishCard.jsx's header comment for why that can't live in either card
// alone).
//
// ── Props ───────────────────────────────────────────────────────────────
//   <InvoiceRail
//     ref={railRef}          // optional — see the ref API below
//     isNarrow={boolean}
//     railW={number}
//     isAdmin={boolean}
//     authedFetch={fn|null}  // Studio shell's authed fetch (StudioPage.jsx) —
//                             // required only for the two admin cards; a
//                             // signed-out mount never calls it
//     user={FirebaseUser|null} // accepted for prop-shape parity with the
//                             // rest of Studio; not read directly (authedFetch
//                             // already knows whether `user` exists)
//     draft={useInvoiceDraft() return value}  // the ONE draft both this
//                             // rail and the canvas (lane C) read/write
//   />
//
// ── Ref API (for lane C / lane E cross-component calls) ────────────────
//   focusField(path)         — §4.2 focus seam: opens the RailCard that owns
//                               `path` (found by data-inv-rail-field, not by
//                               invoice-fields.js's section metadata — see
//                               below) and focuses/scrolls to it. NOT wired
//                               to anything yet; lane E's bridge is the
//                               planned caller when a canvas node is
//                               clicked/focused.
//   openSection(cardKey)     — opens one card by its internal key (now the
//                               same string as its features/invoices
//                               /registry.js section id for every section
//                               card — 'publish'/'savedInvoices' for the two
//                               admin-only cards — see
//                               CARD_DOM_ID_TO_KEY below) without a specific
//                               field target.
//   resetPublishIdentity()   — clears the admin publish-identity state
//                               (title/slug/public toggle/published brief).
//                               Cross-lane convenience: the canvas's public
//                               "New invoice" action (P3, lane C) resets the
//                               DRAFT via `draft.startNewInvoice()`, but that
//                               call has no way to also clear THIS rail's
//                               separate publish-identity state (savedSlug
//                               etc. — deliberately not part of useInvoiceDraft,
//                               see useInvoiceDraft.js's own comment on
//                               openSavedInvoice). If lane C's "New invoice"
//                               button calls `railRef.current
//                               ?.resetPublishIdentity()` after
//                               `draft.startNewInvoice()`, the rail's status
//                               chip and saved-slug hint go back to "New
//                               invoice" too. If it doesn't, the only symptom
//                               is a stale label — Save & Publish still reads
//                               the CURRENT draft, so no data corruption.
//
// ── Focus-seam design note ───────────────────────────────────────────────
// `focusField` resolves a path to its owning card by walking the DOM
// (`el.closest('.studio-rail-card')` -> that card's `id` -> a lookup table)
// rather than by consulting invoice-fields.js's FIELD_PATHS `section`
// metadata. Now that there's one rail card per registry.js section id, the
// two mostly DO line up 1:1 — but walking the real DOM is still what's
// authoritative: `from.*` fields carry `section:'invoiceMeta'` in the
// shared catalog AND render on InvoiceMetaCard (render.js's buildInvoiceMeta
// prints the issuer block there), so for this rework the two happen to
// agree, but derived/unwired paths (recommendation.chips[] etc.) still only
// have one true home — whichever card actually renders the input.

import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { useRailReveal } from '../../components/useRailReveal';
import { briefSlugify } from '../../../../../lib/dashboard/brief-drafts';
import { GLASS, ui } from '../../components/rail-ui';
import { resolveInvoiceLabels } from '../../../../../features/invoices/model.js';
import { useRailDragReorder } from './useRailDragReorder';

import CoverCard from './CoverCard';
import InvoiceMetaCard from './InvoiceMetaCard';
import BillToCard from './BillToCard';
import ProjectSummaryCard from './ProjectSummaryCard';
import LineItemsCard from './LineItemsCard';
import StandaloneItemsCard from './StandaloneItemsCard';
import TotalsCard from './TotalsCard';
import DepositCard from './DepositCard';
import RecommendationCard from './RecommendationCard';
import FlowCard from './FlowCard';
import TermsCard from './TermsCard';
import PaymentCard from './PaymentCard';
import NotesCard from './NotesCard';
import ContactFooterCard from './ContactFooterCard';
import PublishCard from './PublishCard';
import SavedInvoicesCard from './SavedInvoicesCard';

// sectionId (features/invoices/registry.js) -> the rail card that renders
// it. Walked in `draft.sections.order`, NOT this object's key order — see
// the render section below — so the rail re-orders itself live when the
// operator moves a section.
const SECTION_CARD_COMPONENTS = {
  cover: CoverCard,
  invoiceMeta: InvoiceMetaCard,
  billTo: BillToCard,
  projectSummary: ProjectSummaryCard,
  lineItems: LineItemsCard,
  standaloneItems: StandaloneItemsCard,
  totals: TotalsCard,
  deposit: DepositCard,
  recommendation: RecommendationCard,
  flow: FlowCard,
  terms: TermsCard,
  payment: PaymentCard,
  notes: NotesCard,
  contactFooter: ContactFooterCard,
};
const SECTION_CARD_IDS = Object.keys(SECTION_CARD_COMPONENTS);

// DOM id (the RailCard's own `id` prop) -> openCards state key. Used only by
// the DOM-walking focus seam (see header comment) — nothing else reads this.
// Every section card's key IS its sectionId (SectionCard.jsx never renames
// it), so this map is mechanical for the 14 section cards; the two
// admin-only, non-section cards below the divider keep their own names.
const CARD_DOM_ID_TO_KEY = {
  'invoice-rail-cover-card': 'cover',
  'invoice-rail-invoice-meta-card': 'invoiceMeta',
  'invoice-rail-bill-to-card': 'billTo',
  'invoice-rail-project-summary-card': 'projectSummary',
  'invoice-rail-line-items-card': 'lineItems',
  'invoice-rail-standalone-items-card': 'standaloneItems',
  'invoice-rail-totals-card': 'totals',
  'invoice-rail-deposit-card': 'deposit',
  'invoice-rail-recommendation-card': 'recommendation',
  'invoice-rail-flow-card': 'flow',
  'invoice-rail-terms-card': 'terms',
  'invoice-rail-payment-card': 'payment',
  'invoice-rail-notes-card': 'notes',
  'invoice-rail-contact-footer-card': 'contactFooter',
  'invoice-rail-publish-card': 'publish',
  'invoice-rail-saved-invoices-card': 'savedInvoices',
};

const InvoiceRail = forwardRef(function InvoiceRail({
  isNarrow = false, railW = 336, isAdmin = false, authedFetch = null, user = null, draft,
  // HoloPaper presentation state (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md
  // §3) — a dormant prop seam this phase. Passed uniformly to every section
  // card below; only CoverCard will ever consume it, every other card
  // ignores the extra prop. Optional so every other Studio tool mounting
  // this rail shape (none do today) keeps working without it.
  presentation = null,
}, ref) {
  void user; // accepted for prop-shape parity with the rest of Studio; authedFetch already encodes whether a session exists

  const railInnerRef = useRailReveal();

  // Accordion: at most one card open at a time, across BOTH the 14 section
  // cards and the two admin-only ones below the divider — a single string
  // (or null) rather than InvoiceBuilderCard.jsx's old per-id boolean map,
  // since "close every other open card" needs no fan-out here. Clicking a
  // value on the canvas routes through `openSection` (see useInvoiceBridge
  // .js's focus handler -> `railRef.current.openSection(sectionId)`), so
  // this also closes whatever else was open the moment a different field
  // is clicked into.
  const [openCardId, setOpenCardId] = useState(null);
  const toggleCard = useCallback((key) => setOpenCardId((prev) => (prev === key ? null : key)), []);
  const openSection = useCallback((key) => setOpenCardId(key), []);

  // Press-and-hold drag-to-reorder for the 14 section cards — see
  // useRailDragReorder.js's own header for the full gesture contract. Scoped
  // to the section cards only (draft.sections.order); PublishCard/
  // SavedInvoicesCard below the admin divider aren't invoice sections and
  // carry no meaningful "order" to drag.
  const { setRowRef, handlePointerDown, handleClickCapture, draggingId } = useRailDragReorder(
    draft.sections.order, draft.reorderSection,
  );

  // Same StrictMode trap as InvoiceBuilderCard.jsx:250-260 (and
  // useInvoiceDraft.js's own copy of it) — dev StrictMode mounts, cleans up,
  // then mounts again, silently dropping any publish/list response that
  // resolves after the phantom cleanup unless this is reset on every mount.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  // ── Admin-only: publish identity ────────────────────────────────────────
  const [publishTitle, setPublishTitle] = useState('');
  const [publishSlugInput, setPublishSlugInput] = useState('');
  const [publicToggle, setPublicToggle] = useState(true);
  const [savedSlug, setSavedSlug] = useState('');
  const [publishedBrief, setPublishedBrief] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // ── Admin-only: saved invoices list ─────────────────────────────────────
  const [savedInvoices, setSavedInvoices] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const loadSavedInvoices = useCallback(async () => {
    if (!authedFetch) return;
    setListLoading(true);
    setListError('');
    try {
      const res = await authedFetch('/api/dashboard/custom-briefs?kind=invoice', { cache: 'no-store' });
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
  }, [authedFetch]);

  useEffect(() => {
    if (!isAdmin) return;
    loadSavedInvoices();
    // Deliberately only on isAdmin flipping true / mount — same "load once,
    // Refresh button for anything after" contract the admin card used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // POST /api/dashboard/custom-briefs — same endpoint, payload shape
  // ({kind:'invoice', invoice, sections, title, briefSlug, public}) and
  // response handling (`data.brief || data`) as InvoiceBuilderCard.jsx's
  // publishInvoice. Only the transport changed (authedFetch vs manual
  // getIdToken()+fetch) — see PublishCard.jsx's header comment.
  const publishInvoice = useCallback(async () => {
    if (!authedFetch || publishing) return;
    setPublishing(true);
    setPublishError('');
    try {
      const docTitle = resolveInvoiceLabels(draft.invoice).title || 'Invoice';
      const title = (publishTitle || `${docTitle} ${draft.invoice.invoiceNumber || ''}`).trim() || docTitle;
      const briefSlug = savedSlug || briefSlugify(publishSlugInput || title, `invoice${Date.now()}`);
      const res = await authedFetch('/api/dashboard/custom-briefs', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'invoice', invoice: draft.invoice, sections: draft.sections, title, briefSlug, public: publicToggle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Publish failed (HTTP ${res.status}).`);
      const brief = data.brief || data;
      if (!cancelledRef.current) {
        setPublishedBrief(brief);
        setSavedSlug(brief?.briefSlug || briefSlug);
        setPublishTitle(title);
        setPublishedAt(new Date().toLocaleTimeString());
      }
      loadSavedInvoices();
    } catch (err) {
      if (!cancelledRef.current) setPublishError(err instanceof Error ? err.message : 'Could not publish the invoice.');
    } finally {
      if (!cancelledRef.current) setPublishing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch, publishing, publishTitle, publishSlugInput, savedSlug, publicToggle, draft.invoice, draft.sections, loadSavedInvoices]);

  const copyPublicLink = useCallback(async (url) => {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (typeof window !== 'undefined') window.prompt('Copy this link:', url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch { /* clipboard denied — no-op */ }
  }, []);

  // "Open in editor" — hydrates the shared draft AND this rail's own
  // publish-identity state together, same as InvoiceBuilderCard.jsx's single
  // openSavedInvoice() did in one file (see PublishCard.jsx's header comment
  // for why the state had to move up here once Publish/SavedInvoices split
  // into two components).
  const openSavedInvoiceIntoEditor = useCallback((brief) => {
    if (!brief) return;
    draft.openSavedInvoice(brief);
    setSavedSlug(brief.briefSlug || brief.id || '');
    setPublishTitle(brief.title || '');
    setPublishSlugInput('');
    setPublicToggle(brief.public !== false);
    setPublishedBrief(brief);
    setPublishError('');
    setPublishedAt('');
    openSection('publish');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, openSection]);

  const resetPublishIdentity = useCallback(() => {
    setSavedSlug('');
    setPublishTitle('');
    setPublishSlugInput('');
    setPublicToggle(true);
    setPublishedBrief(null);
    setPublishError('');
    setPublishedAt('');
  }, []);

  // ── Focus seam (handoff requirement #4) ─────────────────────────────────
  const focusField = useCallback((path) => {
    const root = railInnerRef.current;
    if (!root || !path) return;
    let el = null;
    try { el = root.querySelector(`[data-inv-rail-field="${CSS.escape(String(path))}"]`); } catch { el = null; }
    if (!el) return;
    const cardEl = el.closest('.studio-rail-card');
    const cardKey = cardEl && CARD_DOM_ID_TO_KEY[cardEl.id];
    if (cardKey) openSection(cardKey);
    // A card's children are always mounted (RailCard clips via
    // maxHeight:0/overflow:hidden, it never unmounts them — see rail-ui.jsx),
    // so `el` is already reachable; the rAF just lets the just-opened card's
    // maxHeight transition start before focus/scroll, so a still-clipped
    // node doesn't scroll to a spot that's about to move.
    requestAnimationFrame(() => {
      try {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch { /* focus/scroll on a detached node — no-op */ }
    });
  }, [openSection]);

  useImperativeHandle(ref, () => ({ focusField, openSection, resetPublishIdentity }), [focusField, openSection, resetPublishIdentity]);

  const publish = {
    title: publishTitle, slugInput: publishSlugInput, publicToggle, savedSlug,
    publishedBrief, publishing, error: publishError, publishedAt, copiedLink,
    setTitle: setPublishTitle, setSlugInput: setPublishSlugInput, setPublicToggle,
    submit: publishInvoice, copyLink: copyPublicLink,
  };
  const savedList = {
    items: savedInvoices, loading: listLoading, error: listError,
    reload: loadSavedInvoices, openSaved: openSavedInvoiceIntoEditor,
  };

  return (
    <div
      id="invoice-studio-rail"
      data-tooltip-disabled="true"
      style={{
        boxSizing: 'border-box', maxWidth: '100%',
        display: 'flex', flexDirection: 'column', overflow: 'visible', background: 'transparent',
        // Horizontal padding is wider than the resting layout needs — this
        // is the drag-lift shadow's own bleed room. `overflowY:'auto'` below
        // is load-bearing for the rail's own scroll, but per the CSS spec a
        // non-'visible' overflow-y forces overflow-x to compute as 'auto'
        // too (can't have one axis truly 'visible' while the other clips) —
        // so the picked-up card's shadow (useRailDragReorder.js) hard-clips
        // at whatever this padding is the instant it tries to bleed past it.
        // Widening the padding is the low-risk fix (a portal that renders
        // the dragged card outside this scroller entirely would let it
        // bleed without bound, but is a much bigger change for a shadow).
        ...(isNarrow
          ? { position: 'relative', width: '100%', flex: 1, minHeight: 0, padding: '12px 20px', overflowY: 'auto' }
          : { position: 'absolute', top: 0, right: 0, bottom: 0, width: railW, padding: '14px 26px', zIndex: 10, overflowY: 'auto' }),
      }}
    >
      <style id="invoice-rail-card-styles">{`
        #invoice-studio-rail, #invoice-studio-rail * { box-sizing: border-box; }
        .studio-rail-card {
          position: relative; border-radius: 1rem; overflow: hidden;
          background: rgba(255, 255, 255, 0.35);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
          transition: background 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.32s cubic-bezier(0.16,1,0.3,1);
        }
        @media (prefers-reduced-motion: reduce) { .studio-rail-card { transition: none; } }
        /* Hairline ring — verbatim from ClothStudio/PaintStudio/LoopStudio's
           own copies of this block, so an invoice rail card is bordered
           identically to every other Studio tab's rail card. */
        .studio-rail-card::before {
          content: ''; position: absolute; inset: 0; border-radius: 1rem; padding: 1px;
          background: rgba(176,176,182,0.6);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          pointer-events: none; opacity: 0.85; transition: opacity 0.45s ease; z-index: 0;
        }
        .studio-rail-card-content { position: relative; z-index: 1; }
        .studio-rail-card-btn { position: relative; z-index: 1; }
        /* Every row's own transform transition — this ONE rule is what
           makes useRailDragReorder.js's neighbor shifts and its "pick up"
           lift ease smoothly instead of snapping; that file's own header
           comment ("Motion / easing") explains exactly when it gets turned
           off (live pointer-tracking, and the one-tick final commit) and
           why. The curve approximates a GSAP-style "power" ease-out — a
           quick, slightly overshooting settle — without adding a library
           for what's fundamentally a couple of animated CSS properties. */
        .invoice-rail-drag-row { transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1); }
        /* Drag handle (SectionCard.jsx) — hover/active states live here, not
           as inline styles, since plain React style props can't express
           :hover. Driven entirely by filter: brightness(), NOT by swapping
           background-color/background-image: a browser can animate filter
           smoothly, but it can't meaningfully animate BETWEEN two different
           radial-gradient() values (SectionCard.jsx's grabBarStyle() sets
           exactly one, constant dot pattern) — that mismatch was what made
           the old hover/drag states pop in instead of fading, since the
           background-color half eased while the dot layer just snapped.
           brightness() darkens the whole element (tint AND dots together)
           uniformly and animates like any other CSS property. Values stay
           gentle on purpose (0.9/0.8), matching the "should read as a quiet,
           secondary affordance" call from an earlier pass at this same
           element. The row wrapper's own invoice-rail-row-dragging class
           (set from useRailDragReorder.js's draggingId) drives the dragging
           state for whichever card is actually picked up — the cursor
           itself is forced globally on body during a real drag
           (useRailDragReorder.js's beginDrag/endDrag), not by this rule,
           since the pointer leaves this narrow strip within a pixel or two
           of any real drag. */
        .studio-rail-card-grab { transition: filter 0.15s ease; }
        .studio-rail-card-grab:hover { filter: brightness(0.9); }
        .invoice-rail-row-dragging .studio-rail-card-grab { filter: brightness(0.8); cursor: grabbing !important; }
      `}</style>

      <div id="invoice-studio-rail-inner" ref={railInnerRef} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        {draft.sections.order.map((sectionId) => {
          const CardComponent = SECTION_CARD_COMPONENTS[sectionId];
          if (!CardComponent) return null; // unknown id in a stored/legacy config — nothing to render
          const dragging = draggingId === sectionId;
          return (
            <div
              key={sectionId}
              id={`invoice-rail-drag-row-${sectionId}`}
              // `invoice-rail-drag-row` (always present) carries the shared
              // transform transition every row eases through (see the
              // stylesheet's own comment). `invoice-rail-row-dragging`
              // (conditional) additionally flips the grab bar's own cursor
              // to `grabbing` for whichever row is currently picked up,
              // without threading `dragging` down through SectionCard.jsx
              // or any of the 14 leaf card files.
              className={`invoice-rail-drag-row${dragging ? ' invoice-rail-row-dragging' : ''}`}
              ref={setRowRef(sectionId)}
              onPointerDown={handlePointerDown(sectionId)}
              onClickCapture={handleClickCapture}
              style={{
                position: 'relative',
                // The first two layers are the "lifted, light-from-above"
                // drop shadow (offset down, per the pick-up feel below) —
                // on their own they're nearly invisible on the card's TOP
                // edge, which reads as "the shadow cuts off" the moment a
                // drag carries the card up and over a neighbor (dragging
                // down never shows it, since that's the same direction the
                // shadow already falls). The third, zero-offset layer is a
                // small all-around ambient halo so every edge — including
                // the leading one when dragging upward — always shows some
                // glow, regardless of which way the card is moving.
                boxShadow: dragging
                  ? '0 16px 32px rgba(20,20,30,0.22), 0 4px 12px rgba(0,0,0,0.12), 0 0 18px rgba(20,20,30,0.16)'
                  : 'none',
                borderRadius: dragging ? '1rem' : undefined,
              }}
            >
              <CardComponent
                draft={draft}
                open={openCardId === sectionId}
                onToggle={() => toggleCard(sectionId)}
                presentation={presentation}
              />
            </div>
          );
        })}

        {isAdmin ? (
          <>
            <div
              id="invoice-rail-admin-divider"
              role="separator"
              aria-label="Admin-only tools"
              style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 2px' }}
            >
              <span style={{ flex: 1, height: 1, background: GLASS.hair }} />
              <span style={{ ...ui.label, color: GLASS.inkMute }}>Admin</span>
              <span style={{ flex: 1, height: 1, background: GLASS.hair }} />
            </div>
            <PublishCard draft={draft} publish={publish} open={openCardId === 'publish'} onToggle={() => toggleCard('publish')} />
            <SavedInvoicesCard savedList={savedList} open={openCardId === 'savedInvoices'} onToggle={() => toggleCard('savedInvoices')} />
          </>
        ) : null}
      </div>
    </div>
  );
});

export default InvoiceRail;
