'use client';

// Invoice Studio rail — Publish card (lane D). ADMIN ONLY — InvoiceRail
// mounts this card only when `isAdmin` is true (handoff requirement #1); a
// signed-out visitor must see no publish affordance at all, not a disabled
// one, so this file assumes it is never rendered for one.
//
// Ports InvoiceBuilderCard.jsx's section 09 verbatim: same endpoint
// (POST /api/dashboard/custom-briefs), same payload shape
// ({ kind:'invoice', invoice, sections, title, briefSlug, public }), same
// response shape (`data.brief || data`, publicUrl/pdfDownloadUrl/pdfUrl).
// The only substitution is the auth transport — this card uses the Studio
// shell's `authedFetch` (attaches the bearer token itself, throws a plain
// Error if signed out) instead of the card's own manual
// `user.getIdToken()` + raw `fetch`; no `apiPath`/impersonation wrapper,
// matching how every other authed Studio action already calls `authedFetch`
// with a plain path (StudioPage.jsx's studio-render/studio-default-recipe
// calls) rather than the dashboard's client-impersonation-aware `apiPath`.
//
// Publish-identity state (title/slug/public toggle/saved slug/published
// brief) is owned by the parent InvoiceRail, not this file — SavedInvoicesCard
// needs to write the same state when "Open in editor" loads a saved invoice,
// and only a shared ancestor can do that for two sibling cards. See
// InvoiceRail.jsx's `publish` prop for the full shape.

import React from 'react';
import { UploadCloud } from 'lucide-react';
import { RailCard, GLASS, ui } from '../../components/rail-ui';
import { RailFieldGrid, RailTextInput } from './rail-field-controls';
import { briefSlugify } from '../../../../../lib/dashboard/brief-drafts';

function pdfLinkFor(brief) {
  return brief?.pdfDownloadUrl || brief?.pdfUrl || (brief?.publicUrl ? `${brief.publicUrl}/pdf` : '');
}

export default function PublishCard({ draft, publish, open, onToggle }) {
  const { invoice } = draft;
  const {
    title, slugInput, publicToggle, savedSlug, publishedBrief, publishing, error, publishedAt, copiedLink,
    setTitle, setSlugInput, setPublicToggle, submit, copyLink,
  } = publish;

  return (
    <RailCard
      id="invoice-rail-publish-card" icon={<UploadCloud size={18} strokeWidth={2} />} title="Publish"
      subtitle={draft.dirty ? 'Unsaved changes' : savedSlug ? 'Saved' : 'Not saved'} color="#2a2420" open={open} onToggle={onToggle}
    >
      <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, lineHeight: 1.5 }}>
        Saves this invoice to a hosted URL with a downloadable PDF. Publishing again updates the same link.
      </span>

      <RailFieldGrid>
        <RailTextInput label="Title" value={title} placeholder={`Invoice ${invoice.invoiceNumber}`} onChange={setTitle} />
        <div>
          <span style={{ ...ui.label, display: 'block', marginBottom: 6 }}>Visibility</span>
          <select
            value={publicToggle ? 'on' : 'off'}
            onChange={(e) => setPublicToggle(e.target.value === 'on')}
            style={{ width: '100%', height: 38, borderRadius: 9, border: '1px solid ' + GLASS.hair, padding: '0 12px', fontFamily: GLASS.sans, fontSize: 12.5, background: 'rgba(255,255,255,0.7)' }}
          >
            <option value="on">Public (hosted link)</option>
            <option value="off">Private (save only)</option>
          </select>
        </div>
      </RailFieldGrid>

      {!savedSlug ? (
        <RailTextInput
          label="URL slug (auto-generated from the title if blank)"
          value={slugInput} placeholder={briefSlugify(title || `Invoice ${invoice.invoiceNumber}`)}
          onChange={setSlugInput}
        />
      ) : (
        <span id="invoice-rail-publish-editing-saved-hint" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, lineHeight: 1.5 }}>
          Editing the saved invoice &ldquo;{savedSlug}.&rdquo; Save &amp; Publish updates this link.
        </span>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 2 }}>
        <button
          type="button"
          onClick={submit}
          disabled={publishing || !draft.ready}
          style={{ ...ui.cta, opacity: publishing || !draft.ready ? 0.6 : 1, cursor: publishing || !draft.ready ? 'default' : 'pointer' }}
        >
          {publishing ? 'Publishing…' : savedSlug ? 'Save & Republish' : 'Save & Publish'}
        </button>
        {publishing ? (
          <span id="invoice-rail-publish-progress" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>
            Saving and rendering the PDF (about 10s).
          </span>
        ) : null}
      </div>

      {publishedBrief?.publicUrl ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a href={publishedBrief.publicUrl} target="_blank" rel="noopener noreferrer" style={{ ...ui.btn(false), textDecoration: 'none' }}>Open ↗</a>
          <button type="button" onClick={() => copyLink(publishedBrief.publicUrl)} style={ui.btn(false)}>{copiedLink ? 'Copied ✓' : 'Copy public link'}</button>
          {pdfLinkFor(publishedBrief) ? (
            <a href={pdfLinkFor(publishedBrief)} target="_blank" rel="noopener noreferrer" download style={{ ...ui.btn(false), textDecoration: 'none' }}>Download PDF</a>
          ) : null}
        </div>
      ) : null}

      {error ? <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: '#dc2626' }}>{error}</span> : null}
      {publishedBrief?.publicUrl ? (
        <span id="invoice-rail-publish-published-url-hint" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, overflowWrap: 'anywhere' }}>
          {publishedAt ? `Published ${publishedAt} · ` : ''}{publishedBrief.publicUrl}
        </span>
      ) : null}
    </RailCard>
  );
}
