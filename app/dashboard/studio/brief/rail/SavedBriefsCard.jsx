'use client';

// Brief Studio rail - Saved briefs card (admin only). Lists the picked client's
// client briefs (GET ?kind=client-brief), opens one in the editor (markdown,
// title, OG fields, theme), and unpublishes / republishes / deletes. Like
// SavedInvoicesCard, but with the lifecycle actions.

import React from 'react';
import { Archive } from 'lucide-react';
import { RailCard, GLASS, ui } from '../../components/rail-ui';

function pdfLinkFor(brief) {
  return brief?.pdfDownloadUrl || brief?.pdfUrl || (brief?.publicUrl ? `${brief.publicUrl}/pdf` : '');
}

const small = { ...ui.btn(false), height: 28, fontSize: 10.5 };

export default function SavedBriefsCard({ savedList, activeSlug, open, onToggle }) {
  const { items, loading, error, reload, openSaved, setPublic, remove, busySlug, clientReady } = savedList;
  return (
    <RailCard
      id="brief-rail-saved-briefs-card" icon={<Archive size={18} strokeWidth={2} />} title="Saved briefs"
      subtitle={clientReady ? `${items.length} saved` : 'Pick a client first'} color="#64748b" open={open} onToggle={onToggle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>This client&apos;s client briefs. Open one to keep editing.</span>
        <button type="button" onClick={reload} disabled={loading || !clientReady} style={{ ...small, height: 28, padding: '0 10px', fontSize: 10, flexShrink: 0 }}>↻ Refresh</button>
      </div>

      {error ? (
        <span role="alert" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: '#dc2626' }}>{error}</span>
      ) : loading ? (
        <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>Loading…</span>
      ) : items.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((brief) => {
            const key = brief.id || brief.briefSlug;
            const busy = busySlug === brief.briefSlug;
            const active = activeSlug && activeSlug === brief.briefSlug;
            return (
              <div
                key={key}
                id={`brief-rail-saved-brief-${key}`}
                style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 10, border: '1px solid ' + (active ? GLASS.ink : GLASS.hair), background: 'rgba(255,255,255,0.4)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: GLASS.sans, fontSize: 12.5, fontWeight: 600, color: GLASS.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {brief.title || brief.briefSlug}
                  </span>
                  <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, flexShrink: 0 }}>
                    {brief.public ? 'Public' : 'Unpublished'} · {brief.updatedAt ? new Date(brief.updatedAt).toLocaleDateString() : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} onClick={() => openSaved(brief)} style={small}>Open in editor</button>
                  {brief.public && brief.publicUrl ? (
                    <a href={brief.publicUrl} target="_blank" rel="noopener noreferrer" style={{ ...small, textDecoration: 'none' }}>View ↗</a>
                  ) : null}
                  {brief.public && pdfLinkFor(brief) ? (
                    <a href={pdfLinkFor(brief)} target="_blank" rel="noopener noreferrer" download style={{ ...small, textDecoration: 'none' }}>PDF ↓</a>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => setPublic(brief, !brief.public)} style={small}>
                    {brief.public ? 'Unpublish' : 'Republish'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => remove(brief)} style={small}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>{clientReady ? 'No client briefs saved yet.' : 'Pick a client to see their briefs.'}</span>
      )}
    </RailCard>
  );
}
