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

import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { RailCard, GLASS, ui } from '../../components/rail-ui';
import { RailFieldGrid, RailTextInput, RailSegmented } from './rail-field-controls';
import { briefSlugify } from '../../../../../lib/dashboard/brief-drafts';
import { resolveInvoiceLabels } from '../../../../../features/invoices/model.js';
import { formatValue } from '../invoice-fields';

const OG_PREVIEW_DEBOUNCE_MS = 600;

// Live OG share-image preview. POSTs the unsaved draft + the three OG
// controls to the admin og-preview route, which runs the SAME renderer as
// the public /og-image route, so this is the real image, not a mock-up.
// Debounced on every input that changes the picture (title, eyebrow,
// subhead, hide toggle, bill-to, total, due date, doc kind).
function OgPreview({ draft, publish, open }) {
  const { invoice } = draft;
  const { title, ogLabel, ogSubhead, hideOgSubhead, ogLines, ogTitleLines, authedFetch } = publish;
  const [src, setSrc] = useState('');
  const [status, setStatus] = useState('');
  const urlRef = useRef('');
  const docTitle = resolveInvoiceLabels(invoice).title || 'Invoice';
  const effectiveTitle = (title || `${docTitle} ${invoice.invoiceNumber || ''}`).trim();
  const depsKey = [
    effectiveTitle, ogLabel, ogSubhead, hideOgSubhead ? 1 : 0, (ogLines || []).join('|'), (ogTitleLines || []).join('|'),
    invoice.docKind, invoice.invoiceNumber, invoice.billTo?.name, invoice.dueDate, invoice.currency, invoice.locale,
    Number(invoice.totals?.total) || 0, Number(invoice.totals?.subtotal) || 0,
    Number(invoice.totals?.discount) || 0, Number(invoice.totals?.tax) || 0,
  ].join('\u0001');

  useEffect(() => {
    if (!open || !authedFetch) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus('Rendering…');
      try {
        const res = await authedFetch('/api/dashboard/custom-briefs/og-preview', {
          method: 'POST',
          body: JSON.stringify({ title: effectiveTitle, invoice, ogLabel, ogSubhead, hideOgSubhead, ogLines, ogTitleLines }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Preview failed (HTTP ${res.status}).`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setSrc(next);
        setStatus('');
      } catch (err) {
        if (!cancelled) setStatus(err instanceof Error ? err.message : 'Could not render the preview.');
      }
    }, OG_PREVIEW_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, open, authedFetch]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return (
    <div id="invoice-rail-publish-og-preview" style={{ display: 'grid', gap: 8 }}>
      <span style={{ ...ui.label, display: 'block' }}>Share image (OG) preview</span>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1200 / 630', borderRadius: 10, overflow: 'hidden', border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.5)' }}>
        {src ? <img src={src} alt="Share image preview" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        {status ? (
          <span style={{ position: 'absolute', left: 8, bottom: 6, ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 6 }}>{status}</span>
        ) : null}
      </div>
      {src ? <a href={src} download={`${effectiveTitle || 'invoice'} OG image.jpg`} style={{ ...ui.btn(false), textDecoration: 'none', justifySelf: 'start' }}>Download image</a> : null}
    </div>
  );
}

function pdfLinkFor(brief) {
  return brief?.pdfDownloadUrl || brief?.pdfUrl || (brief?.publicUrl ? `${brief.publicUrl}/pdf` : '');
}

export default function PublishCard({ draft, publish, open, onToggle }) {
  const { invoice } = draft;
  const {
    title, slugInput, publicToggle, savedSlug, publishedBrief, publishing, error, publishedAt, copiedLink,
    setTitle, setSlugInput, setPublicToggle, submit, copyLink,
    ogSubhead, hideOgSubhead, setOgSubhead, setHideOgSubhead, ogLines, setOgLines, ogTitleLines, setOgTitleLines,
  } = publish;
  const setOgTitleLine = (index, value) => setOgTitleLines((prev) => { const next = [...(prev || ['', ''])]; next[index] = value; return next; });
  const setOgLine = (index, value) => setOgLines((prev) => { const next = [...(prev || ['', ''])]; next[index] = value; return next; });
  const billToName = String(invoice.billTo?.name || '').trim();

  // Prefill the share-image fields from the invoice the first time the card
  // opens with nothing typed (a saved invoice restores its own values before
  // this runs), so the operator sees real text, not placeholders. Clearing
  // a field afterwards keeps it clear — this only runs while ALL are empty.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open || seededRef.current) return;
    const allEmpty = !String(ogSubhead || '').trim() && !(ogLines || []).some((line) => String(line || '').trim())
      && !(ogTitleLines || []).some((line) => String(line || '').trim());
    if (!allEmpty) { seededRef.current = true; return; }
    const labels = resolveInvoiceLabels(invoice);
    const itemNames = (invoice.categories || []).flatMap((cat) => cat.items || []).concat(invoice.standaloneItems || [])
      .map((item) => String(item?.name || '').trim()).filter(Boolean).slice(0, 3);
    const dueText = invoice.dueDate ? `${labels.dueLabel || 'Due'} ${formatValue('date', invoice.dueDate, invoice.currency, invoice.locale)}` : '';
    const deposit = Number(invoice.totals?.deposit) || 0;
    const depositText = deposit > 0 ? `${formatValue('money', deposit, invoice.currency, invoice.locale)} deposit to begin` : '';
    seededRef.current = true;
    // Headline split: first word(s) up to ~18 chars on line 1, rest on line 2.
    const docTitle = resolveInvoiceLabels(invoice).title || 'Invoice';
    const words = (title || `${docTitle} ${invoice.invoiceNumber || ''}`).trim().split(/\s+/).filter(Boolean);
    let line1 = ''; let line2 = '';
    for (const word of words) {
      if (!line2 && (line1 ? `${line1} ${word}` : word).length <= 18) line1 = line1 ? `${line1} ${word}` : word;
      else line2 = line2 ? `${line2} ${word}` : word;
    }
    setOgTitleLines([line1, line2]);
    setOgSubhead(billToName ? `Prepared for ${billToName}` : '');
    setOgLines([
      itemNames.join(' + '),
      [dueText, depositText].filter(Boolean).join(' · '),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

      <OgPreview draft={draft} publish={publish} open={open} />
      <div id="invoice-rail-publish-og-fields">
        <RailFieldGrid>
          <RailTextInput
            label="Subhead" value={ogSubhead}
            placeholder={billToName ? `Using the default: Prepared for ${billToName}` : 'e.g. Website + merch, delivered by the 14th'}
            onChange={setOgSubhead} maxLength={160}
          />
        </RailFieldGrid>
        <div style={{ marginTop: 6 }}>
          <RailSegmented label="Subhead line" options={['Show', 'Hide']} value={hideOgSubhead ? 'Hide' : 'Show'} onSelect={(v) => setHideOgSubhead(v === 'Hide')} />
        </div>
        <div style={{ marginTop: 6 }}>
          <RailFieldGrid>
            <RailTextInput label="Headline line 1" value={ogTitleLines?.[0] || ''} placeholder="Blank = auto from Title" onChange={(v) => setOgTitleLine(0, v)} maxLength={40} />
            <RailTextInput label="Headline line 2 (blank = off)" value={ogTitleLines?.[1] || ''} placeholder="" onChange={(v) => setOgTitleLine(1, v)} maxLength={40} />
          </RailFieldGrid>
        </div>
        <div style={{ marginTop: 6 }}>
          <RailFieldGrid>
            <RailTextInput label="Extra line 1 (blank = off)" value={ogLines?.[0] || ''} placeholder="e.g. Website + merch" onChange={(v) => setOgLine(0, v)} maxLength={120} />
            <RailTextInput label="Extra line 2 (blank = off)" value={ogLines?.[1] || ''} placeholder="e.g. Target launch Nov 14" onChange={(v) => setOgLine(1, v)} maxLength={120} />
          </RailFieldGrid>
        </div>
      </div>

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
