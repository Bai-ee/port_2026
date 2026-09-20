'use client';

// Invoice Studio rail — Saved invoices card (lane D). ADMIN ONLY — see
// PublishCard's header comment for the admin-gate contract (InvoiceRail
// mounts this only when `isAdmin`).
//
// Ports InvoiceBuilderCard.jsx's section 10 verbatim: same endpoint
// (GET /api/dashboard/custom-briefs?kind=invoice via `authedFetch`), same
// response shape (`data.briefs`). "Open in editor" calls the `openSaved`
// callback InvoiceRail wires up, which both hydrates the draft
// (`draft.openSavedInvoice`) AND resets this session's publish identity
// (title/slug/public toggle) to match the opened brief — see InvoiceRail
// .jsx's `handleOpenSavedInvoice`.
//
// ⚠️ The StrictMode cancelledRef reset-on-mount trap (InvoiceBuilderCard.jsx
// :250-260) applies to the list-loading effect this card's data comes from
// — it lives in InvoiceRail (the effect that calls `savedList.reload` on
// mount), not duplicated here.

import React from 'react';
import { Archive } from 'lucide-react';
import { RailCard, GLASS, ui } from '../../components/rail-ui';

function pdfLinkFor(brief) {
  return brief?.pdfDownloadUrl || brief?.pdfUrl || (brief?.publicUrl ? `${brief.publicUrl}/pdf` : '');
}

export default function SavedInvoicesCard({ savedList, open, onToggle }) {
  const { items, loading, error, reload, openSaved } = savedList;

  return (
    <RailCard
      id="invoice-rail-saved-invoices-card" icon={<Archive size={18} strokeWidth={2} />} title="Saved invoices"
      subtitle={`${items.length} saved`} color="#64748b" open={open} onToggle={onToggle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>Published invoices. Open one to keep editing.</span>
        <button type="button" onClick={reload} disabled={loading} style={{ ...ui.btn(false), height: 28, padding: '0 10px', fontSize: 10, flexShrink: 0 }}>↻ Refresh</button>
      </div>

      {error ? (
        <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: '#dc2626' }}>{error}</span>
      ) : loading ? (
        <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>Loading…</span>
      ) : items.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((brief) => {
            const key = brief.id || brief.briefSlug;
            return (
              <div
                key={key}
                id={`invoice-rail-saved-invoice-${key}`}
                style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 10, border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.4)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 12.5, fontWeight: 600, color: GLASS.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {brief.title || brief.invoice?.invoiceNumber || brief.briefSlug}
                  </span>
                  <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, flexShrink: 0 }}>
                    {brief.updatedAt ? new Date(brief.updatedAt).toLocaleDateString() : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => openSaved(brief)} style={{ ...ui.btn(false), height: 28, fontSize: 10.5 }}>Open in editor</button>
                  {brief.publicUrl ? (
                    <a href={brief.publicUrl} target="_blank" rel="noopener noreferrer" style={{ ...ui.btn(false), height: 28, fontSize: 10.5, textDecoration: 'none' }}>View ↗</a>
                  ) : null}
                  {pdfLinkFor(brief) ? (
                    <a href={pdfLinkFor(brief)} target="_blank" rel="noopener noreferrer" download style={{ ...ui.btn(false), height: 28, fontSize: 10.5, textDecoration: 'none' }}>PDF ↓</a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>No invoices saved yet.</span>
      )}
    </RailCard>
  );
}
