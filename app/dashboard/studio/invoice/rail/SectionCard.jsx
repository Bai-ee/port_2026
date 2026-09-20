'use client';

// Invoice Studio rail — SectionCard: the shared wrapper every per-SECTION
// rail card (CoverCard, InvoiceMetaCard, BillToCard, ... ContactFooterCard)
// renders through, on top of rail-ui's `RailCard`. One rail card per
// features/invoices/registry.js section id, rather than the old
// convenience-grouped 10-card layout — see
// docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md's P4 follow-up.
//
// Owns three things every section card needs identically:
//   1. A GRAB BAR + EYE toggle, both via RailCard's `leading` prop (a
//      sibling of the expand `<button>`, rendered before it — see
//      rail-ui.jsx's own header comment on why that keeps a click on either
//      from bubbling into `onToggle`, though the grab bar's own onClick
//      deliberately still calls it — see point 3). Two elements, left to
//      right: the grab bar itself — full header-row height, flush against
//      the card's own left edge (no self border-radius; `.studio-rail-card`
//      's own `overflow:hidden` + rounded corners clip it into shape, so it
//      reads as an extension of the card, not a floating pill inset from
//      it) — then the eye, immediately left of the title. This is the
//      drag-to-reorder handle (../useRailDragReorder.js, owned by
//      InvoiceRail.jsx — that hook reads
//      `e.target.closest('.studio-rail-card-grab')` to decide whether a
//      press-and-hold started on THIS element specifically); its dotted
//      texture (grabBarStyle() below) is a deliberate "grippy" surface cue,
//      not just a color block. Purely decorative to assistive tech
//      (`aria-hidden`) since it triggers no action a keyboard/screen-reader
//      user can't already reach via the card's own title button — this
//      rework drops the old ↑/↓ reorder buttons entirely, so there is no
//      longer a keyboard-operable way to reorder sections; that trade-off
//      is deliberate (an explicit "remove the up/down UI" ask), not an
//      oversight.
//   2. The EYE toggle. On = `sections.include[sectionId] !== false`. No
//      `title` attribute anywhere here — the canvas/rail root sets
//      `data-tooltip-disabled="true"` because the owner asked for hover
//      tooltips gone; `aria-label` is the only accessible name.
//   3. The "off" dim: when a section is excluded, its title and its whole
//      field body render at opacity 0.45 so it reads as off at a glance —
//      but the grab bar + eye are siblings of the dimmed subtree, not
//      descendants of it, so they stay full-strength and clickable (a CSS
//      opacity on a shared ancestor would have dimmed them too, since
//      opacity multiplies down the tree — that's why this wraps
//      title/children individually instead).
//
// Per-section bespoke icons (`icon`/`color`, still accepted by every one of
// the 14 caller files) are no longer rendered here — every card now carries
// exactly one icon-like element, the eye, in place of the 14 different
// colored ones. The prop is deliberately left unread rather than stripped
// from all 14 callers — see this rework's own notes for the follow-up.
//
// `title` may be a plain string OR a node (DepositCard computes its own
// dynamic per-invoice title — a genuinely custom `totals.depositLabel`
// override, else the doc-kind-resolved `paymentDueLabel` — mirroring
// render.js's buildDeposit() exactly, so the rail and the printed heading
// can never disagree).
//
// ── Default-title resolution (design-layer plan Q0, L16) ────────────────
// For every section whose printed heading is a STATIC string today (every
// card below except Cover/Contact footer, which print no heading at all —
// L16 — and Deposit, which already computes its own dynamic per-invoice
// title from `totals.depositLabel`, a pre-existing override this rework
// does not touch), the resolved title now comes from
// `resolveInvoiceLabels(draft.invoice)` (features/invoices/model.js) FIRST,
// falling back to the card's own `title` prop only if resolution produces
// nothing. Every docKind:'invoice'/labels:{} default in DOC_KIND_LABELS is
// pinned to match what each card already hardcodes as its `title` prop
// (model-contract.test.js pins this), so this is a no-op today — no visible
// Studio change — and only starts mattering once a later lane (Lane B, Q2)
// lets an operator change `invoice.docKind` or `invoice.labels`. The card's
// own `title` prop stays as a fallback string, never a second live source of
// truth (L16's own wording).

import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { RailCard, GLASS } from '../../components/rail-ui';
import { resolveInvoiceLabels } from '../../../../../features/invoices/model.js';

// ── Touch-target sizing (design-layer plan Q1, L17) ─────────────────────
// The eye toggle is a small precision target (26px) tuned for a mouse. On a
// coarse pointer (touch) it needs at least a 44x44 CSS-pixel hit area
// without inflating the DESKTOP rail, which stays pixel-identical to today.
// Detected via JS (`matchMedia('(pointer: coarse)')`) rather than a literal
// CSS `@media` block: this component mounts once per section (14 times),
// and a `<style>` tag would either duplicate 14x in the DOM or need to live
// in a file this lane doesn't own (InvoiceRail.jsx's shared stylesheet) —
// the task's own "@media (pointer: coarse) or similar" wording licenses
// this approach. The grab bar widens on touch too, for the same reason —
// a 26px-wide strip is still a mouse-precision target, not a thumb one.
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener('change', update);
    else if (mq.addListener) mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else if (mq.removeListener) mq.removeListener(update);
    };
  }, []);
  return coarse;
}

const EYE_BTN_SIZE_DESKTOP = 26;
const EYE_BTN_SIZE_TOUCH = 44;
const GRAB_BAR_WIDTH_DESKTOP = 26;
const GRAB_BAR_WIDTH_TOUCH = 40;

function eyeButtonStyle(coarse) {
  const size = coarse ? EYE_BTN_SIZE_TOUCH : EYE_BTN_SIZE_DESKTOP;
  return {
    width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'rgba(255,255,255,0.7)',
    color: GLASS.ink, cursor: 'pointer', flexShrink: 0,
    margin: coarse ? '0 8px 0 8px' : '0 10px 0 6px',
  };
}

// The `.studio-rail-card-grab` class is what useRailDragReorder.js's
// handlePointerDown looks for (InvoiceRail.jsx) — this element IS the drag
// handle, not just a visual hint next to one. `alignSelf:'stretch'` inside
// RailCard's `display:flex; alignItems:center` header row is what makes it
// span the row's own height without any manual measurement; `margin:0` on
// its left/top/bottom is what lets it "take over" the card's whole left
// edge flush, rather than sit inset as a small pill — no self border-radius
// either, since `.studio-rail-card`'s own `overflow:hidden` + rounded
// corners clip this into the matching shape for free.
//
// The dotted radial-gradient background is the "grippy, like traction"
// texture the owner asked for in place of a flat color bar — small raised-
// looking dots read as a physical grab surface (a rubberized handle, a
// tire's tread) the way a plain rounded pill didn't. This is the ONE, fixed
// dot definition — hover/dragging never override it with a DIFFERENT
// radial-gradient (an earlier pass did, and it read as clunky: a browser
// can't animate between two different gradient values, so the dot layer
// just popped between states while the background tint eased). Instead
// InvoiceRail.jsx's shared `<style>` block darkens this exact texture via
// `filter: brightness()` on hover/dragging (keyed off this same class, plus
// a `.invoice-rail-row-dragging` modifier InvoiceRail puts on the row
// wrapper while THIS card is the one being dragged) — a property a browser
// CAN animate smoothly, so both layers now fade together.
function grabBarStyle(coarse) {
  const width = coarse ? GRAB_BAR_WIDTH_TOUCH : GRAB_BAR_WIDTH_DESKTOP;
  // Small and dense on purpose — a few big, widely-spaced dots read as
  // "polka dot pattern," not a physical grip surface. Real traction texture
  // (a rubber handle, a tire tread) is fine-grained: tiny dots packed close
  // enough that the eye reads them as a matte SURFACE rather than counting
  // individual circles.
  const dot = coarse ? 0.9 : 0.7;
  const cell = coarse ? 5 : 4;
  return {
    display: 'block', alignSelf: 'stretch', flexShrink: 0,
    width, margin: 0,
    backgroundColor: 'rgba(20,20,30,0.05)',
    backgroundImage: `radial-gradient(circle, rgba(20,20,30,0.55) ${dot}px, transparent ${dot}px)`,
    backgroundSize: `${cell}px ${cell}px`,
    backgroundPosition: 'center',
    cursor: 'grab',
  };
}

// sectionId -> the resolveInvoiceLabels() key that prints as this section's
// heading. cover/contactFooter/deposit are deliberately absent — see the
// header comment above.
const SECTION_ID_TO_LABEL_KEY = {
  invoiceMeta: 'invoiceDetails',
  billTo: 'billToLabel',
  projectSummary: 'summaryLabel',
  lineItems: 'lineItemsLabel',
  standaloneItems: 'additionalItemsLabel',
  totals: 'totalsLabel',
  recommendation: 'recommendationLabel',
  flow: 'flowLabel',
  terms: 'termsLabel',
  payment: 'paymentLabel',
  notes: 'notesLabel',
};

// `subtitle` is intentionally NOT destructured/forwarded to RailCard, even
// though every one of the 14 leaf card files still passes one (a category/
// item count, a dollar amount, a client name) — a header row with a
// subtitle is visibly taller than one without, so as long as some cards had
// one and others didn't, the collapsed rail read as uneven row heights
// rather than a uniform list. Dropping it here (one file) was simpler and
// lower-risk than stripping the prop out of all 14 callers, same tradeoff
// as the earlier `icon` removal — see this file's own top-of-file note.
export default function SectionCard({
  sectionId, id, title, open, onToggle, draft, children,
}) {
  const coarse = useCoarsePointer();
  const on = draft.sections.include[sectionId] !== false;
  const dim = { opacity: on ? 1 : 0.45 };

  const labelKey = SECTION_ID_TO_LABEL_KEY[sectionId];
  const resolvedTitle = labelKey ? resolveInvoiceLabels(draft.invoice)[labelKey] : null;
  const displayTitle = resolvedTitle || title;
  const titleText = typeof displayTitle === 'string' ? displayTitle : sectionId;

  const grabBar = (
    <span
      className="studio-rail-card-grab"
      aria-hidden="true"
      onClick={onToggle}
      style={grabBarStyle(coarse)}
    />
  );

  const eyeToggle = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); draft.toggleSection(sectionId); }}
      aria-label={on ? `Hide ${titleText}` : `Show ${titleText}`}
      aria-pressed={on}
      style={eyeButtonStyle(coarse)}
    >
      {on ? <Eye size={coarse ? 18 : 14} strokeWidth={2} /> : <EyeOff size={coarse ? 18 : 14} strokeWidth={2} />}
    </button>
  );

  return (
    <RailCard
      id={id}
      leading={<>{grabBar}{eyeToggle}</>}
      title={<span style={dim}>{displayTitle}</span>}
      inertWhenClosed
      open={open}
      onToggle={onToggle}
    >
      <div style={dim}>{children}</div>
    </RailCard>
  );
}
