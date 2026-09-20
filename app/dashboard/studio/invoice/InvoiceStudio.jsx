'use client';

// Invoice Studio (?tool=invoice) — docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md P3.
//
// Two-pane shell, same shape as every other Studio tool (copied from
// ./paint/PaintStudio.jsx): board absolute `left:0 right:railW` on desktop,
// full-width stacked block when `isNarrow`; rail absolute right, fixed
// `railW` wide on desktop, stacked below when narrow.
//
// Owns the ONE shared draft (useInvoiceDraft — P0), and renders it into the
// board via <InvoiceCanvas> (this lane, P3: layout/zoom/actions/render-error/
// skipped-section states — all read-only against the draft, no editing).
// The rail column is a MOUNT POINT ONLY: lane D fills it with RailCards in
// P4. Nothing in this file reads/writes invoice fields directly — that
// stays inside useInvoiceDraft.js (P0) and, later, useInvoiceBridge.js (P5).
//
// Public by design (plan D7): every prop below is accepted for shape parity
// with the other Studio tools, but `isAdmin`/`authedFetch`/`user` are not
// read here at all — InvoiceCanvas only spends `isAdmin` (which starting
// seed + which brand to render with), never a network call. Admin-only
// affordances (Publish, Saved invoices) live entirely in lane D's rail cards,
// gated there, not here.

import React, { useCallback, useRef } from 'react';
import { useInvoiceDraft } from './useInvoiceDraft';
import { useInvoiceBridge } from './useInvoiceBridge';
import { useInvoicePresentation } from './holo/useInvoicePresentation';
import InvoiceCanvas from './InvoiceCanvas';
import InvoiceRail from './rail/InvoiceRail';

export default function InvoiceStudio({ isNarrow = false, railW = 336, isAdmin = false, authedFetch = null, user = null }) {
  const draft = useInvoiceDraft({ isAdmin });
  // HoloPaper presentation layer (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md
  // §3/§6 H2) — the ONE instance, threaded to both InvoiceCanvas (the Holo
  // overlay/scene mount point) and InvoiceRail -> CoverCard (the operator
  // toggles). See useInvoicePresentation.js for the full contract.
  const presentation = useInvoicePresentation();
  const railRef = useRef(null);
  // Q1 (Lane E) — the canvas <-> draft bridge (docs/plans/
  // INVOICE-STUDIO-DESIGN-LAYER-HANDOFF.md, mechanics from
  // INVOICE-STUDIO-TOOL-HANDOFF.md §4.2). `iframeRef` is handed to
  // InvoiceCanvas's forwarded ref (the raw <iframe> DOM node); `bridge.attach`
  // is handed to InvoiceCanvas's onDocumentRendered, which fires once per
  // srcDoc swap. `railRef` lets the bridge open the owning RailCard when a
  // canvas field is focused — see useInvoiceBridge.js's own header comment
  // for why that stops short of a literal DOM focus-steal.
  const iframeRef = useRef(null);
  const bridge = useInvoiceBridge(iframeRef, draft, railRef);

  // "New invoice" resets the draft AND the rail's publish identity — otherwise
  // the rail keeps showing "editing saved <slug>" against a draft that is no
  // longer that invoice, and the next Save & Republish would overwrite the old
  // link with unrelated content.
  const startNewInvoice = useCallback(() => {
    draft.startNewInvoice();
    railRef.current?.resetPublishIdentity();
  }, [draft]);

  return (
    <>
      {/* ── Board — the live invoice canvas. ── */}
      <div
        id="invoice-studio-board"
        style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 'none' }
            : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW }),
        }}
      >
        <InvoiceCanvas
          ref={iframeRef}
          invoice={draft.invoice}
          sections={draft.sections}
          theme={draft.theme}
          structureKey={draft.structureKey}
          isAdmin={isAdmin}
          isNarrow={isNarrow}
          onNewInvoice={startNewInvoice}
          onDocumentRendered={bridge.attach}
          // HoloPaper presentation layer (H2 integration — docs/plans/
          // INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §6). `presentation.presentation`
          // is the read-only state object ({holoEnabled, sceneInteractive,
          // sceneStatus, resetViewToken}); `setSceneStatus`/`setSceneInteractive`
          // let the canvas report scene lifecycle (ready/loading/fallback) and
          // force interaction off on a WebGL fallback (H16) — CoverCard owns the
          // operator-facing toggles via the same `presentation` instance passed
          // to InvoiceRail below.
          presentation={presentation.presentation}
          setSceneStatus={presentation.setSceneStatus}
          setSceneInteractive={presentation.setSceneInteractive}
        />
      </div>

      {/* ── Rail — lane D's InvoiceRail (P4). It renders its own
          #invoice-studio-rail / #invoice-studio-rail-inner shell and owns the
          rail reveal, so it REPLACES the mount point this file used to carry
          rather than nesting inside it. Its ref exposes focusField(path) /
          openSection(key) for P5's bridge, plus resetPublishIdentity(), which
          "New invoice" calls so the rail's "editing saved X" label clears with
          the draft. ── */}
      <InvoiceRail
        ref={railRef}
        isNarrow={isNarrow}
        railW={railW}
        isAdmin={isAdmin}
        authedFetch={authedFetch}
        user={user}
        draft={draft}
        presentation={presentation}
      />
    </>
  );
}
