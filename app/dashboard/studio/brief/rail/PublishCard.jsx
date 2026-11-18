'use client';

// Brief Studio rail - Publish card (admin only; BriefRail mounts it only for an
// admin). Clone of Invoice Studio's PublishCard publishing half: public toggle,
// Publish / Update in place (same slug), copy link, open, download PDF, and the
// identical share-image (OG) editor with a live preview. Every call goes
// through `publish.api()` (adds `?as=<clientId>`), and the card is disabled
// until a client is picked.

import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { RailCard, GLASS, ui } from '../../components/rail-ui';
import { RailFieldGrid, RailTextInput, RailSegmented, RailEmptyHint } from '../../invoice/rail/rail-field-controls';
import { firstParagraphText, suggestClientBriefOg } from '../../../../../features/client-brief/og.js';
import { BRIEF_MAX_CHARS } from '../brief-draft-storage';

const OG_PREVIEW_DEBOUNCE_MS = 600;
const DEFAULT_TITLE = 'Client Brief';

export function firstHeading(text) {
  const match = String(text || '').match(/^ {0,3}#\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].replace(/[*_`]/g, '').trim() : '';
}

export function effectiveBriefTitle(title, text) {
  return (String(title || '').trim() || firstHeading(text) || DEFAULT_TITLE).slice(0, 140);
}

function pdfLinkFor(brief) {
  return brief?.pdfDownloadUrl || brief?.pdfUrl || (brief?.publicUrl ? `${brief.publicUrl}/pdf` : '');
}

// Live share-image preview: the admin og-preview route runs the SAME renderer
// as the public /og-image route. Debounced; writes nothing.
function OgPreview({ draft, publish, open }) {
  const [src, setSrc] = useState('');
  const [status, setStatus] = useState('');
  const urlRef = useRef('');
  const { api, authedFetch, clientName } = publish;
  const title = effectiveBriefTitle(draft.title, draft.text);
  const depsKey = [
    title, clientName, draft.ogSubhead, draft.hideOgSubhead ? 1 : 0, draft.ogTitleLines.join('|'), draft.ogLines.join('|'),
    firstParagraphText(draft.text, 240),
  ].join('\u0001');

  useEffect(() => {
    if (!open || !authedFetch || !publish.clientId) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus('Rendering…');
      try {
        const res = await authedFetch(api('/api/dashboard/custom-briefs/og-preview'), {
          method: 'POST',
          body: JSON.stringify({
            kind: 'client-brief', title, clientName, description: firstParagraphText(draft.text, 240),
            ogSubhead: draft.ogSubhead, hideOgSubhead: draft.hideOgSubhead, ogTitleLines: draft.ogTitleLines, ogLines: draft.ogLines,
          }),
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
  }, [depsKey, open, authedFetch, publish.clientId]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return (
    <div id="brief-rail-publish-og-preview" style={{ display: 'grid', gap: 8 }}>
      <span style={{ ...ui.label, display: 'block' }}>Share image (OG) preview</span>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1200 / 630', borderRadius: 10, overflow: 'hidden', border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.5)' }}>
        {src ? <img src={src} alt="Share image preview" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        {status ? (
          <span style={{ position: 'absolute', left: 8, bottom: 6, ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 6 }}>{status}</span>
        ) : null}
      </div>
      {src ? <a href={src} download={`${title} OG image.jpg`} style={{ ...ui.btn(false), textDecoration: 'none', justifySelf: 'start' }}>Download image</a> : null}
    </div>
  );
}

export default function PublishCard({ draft, publish, open, onToggle }) {
  const {
    clientId, clientName, publishing, error, publishedBrief, publishedAt, copiedLink, submit, copyLink,
  } = publish;
  const savedSlug = draft.savedSlug;
  const overLimit = draft.text.length > BRIEF_MAX_CHARS;
  const canSubmit = Boolean(clientId) && Boolean(draft.text.trim()) && !overLimit && !publishing && draft.ready;
  const setLine = (key, index, value) => draft.patch((current) => {
    const next = [...current[key]];
    next[index] = value;
    return { [key]: next };
  });

  // Prefill the share-image fields once, the first time the card opens with
  // nothing typed (a loaded saved brief restores its own first).
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open || seededRef.current) return;
    seededRef.current = true;
    const allEmpty = !draft.ogSubhead.trim() && !draft.ogLines.some((l) => l.trim()) && !draft.ogTitleLines.some((l) => l.trim());
    if (!allEmpty) return;
    const s = suggestClientBriefOg({ title: effectiveBriefTitle(draft.title, draft.text), clientName, text: draft.text });
    draft.patch({ ogTitleLines: s.ogTitleLines, ogSubhead: s.ogSubhead, ogLines: s.ogLines });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <RailCard
      id="brief-rail-publish-card" icon={<UploadCloud size={18} strokeWidth={2} />} title="Publish"
      subtitle={!clientId ? 'Pick a client first' : draft.dirty ? 'Unsaved changes' : savedSlug ? 'Saved' : 'Not saved'} color="#2a2420" open={open} onToggle={onToggle}
    >
      <RailEmptyHint>
        Saves this brief for {clientName || 'the selected client'} to a hosted URL with a downloadable PDF. {savedSlug ? 'Updating keeps the same link.' : ''}
      </RailEmptyHint>

      <div>
        <span style={{ ...ui.label, display: 'block', marginBottom: 6 }}>Visibility</span>
        <select
          id="brief-rail-visibility-select"
          value={draft.publicToggle ? 'on' : 'off'}
          onChange={(e) => draft.patch({ publicToggle: e.target.value === 'on' })}
          style={{ width: '100%', height: 38, borderRadius: 9, border: '1px solid ' + GLASS.hair, padding: '0 12px', fontFamily: GLASS.sans, fontSize: 12.5, background: 'rgba(255,255,255,0.7)' }}
        >
          <option value="on">Public (hosted link)</option>
          <option value="off">Private (save only)</option>
        </select>
      </div>

      {savedSlug ? (
        <span id="brief-rail-publish-editing-saved-hint" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, lineHeight: 1.5 }}>
          Editing the saved brief &ldquo;{savedSlug}.&rdquo; Update keeps this link.
        </span>
      ) : null}

      <OgPreview draft={draft} publish={publish} open={open} />
      <div id="brief-rail-publish-og-fields">
        <RailFieldGrid>
          <RailTextInput
            label="Subhead" value={draft.ogSubhead}
            placeholder={clientName ? `Using the default: first paragraph` : 'e.g. Weekly growth plan'}
            onChange={(v) => draft.patch({ ogSubhead: v })} maxLength={160}
          />
        </RailFieldGrid>
        <div style={{ marginTop: 6 }}>
          <RailSegmented label="Subhead line" options={['Show', 'Hide']} value={draft.hideOgSubhead ? 'Hide' : 'Show'} onSelect={(v) => draft.patch({ hideOgSubhead: v === 'Hide' })} />
        </div>
        <div style={{ marginTop: 6 }}>
          <RailFieldGrid>
            <RailTextInput label="Headline line 1" value={draft.ogTitleLines[0] || ''} placeholder="Blank = auto from Title" onChange={(v) => setLine('ogTitleLines', 0, v)} maxLength={40} />
            <RailTextInput label="Headline line 2 (blank = off)" value={draft.ogTitleLines[1] || ''} placeholder="" onChange={(v) => setLine('ogTitleLines', 1, v)} maxLength={40} />
          </RailFieldGrid>
        </div>
        <div style={{ marginTop: 6 }}>
          <RailFieldGrid>
            <RailTextInput label="Extra line 1 (blank = off)" value={draft.ogLines[0] || ''} placeholder="" onChange={(v) => setLine('ogLines', 0, v)} maxLength={120} />
            <RailTextInput label="Extra line 2 (blank = off)" value={draft.ogLines[1] || ''} placeholder="" onChange={(v) => setLine('ogLines', 1, v)} maxLength={120} />
          </RailFieldGrid>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 2 }}>
        <button
          type="button"
          id="brief-rail-publish-btn"
          onClick={submit}
          disabled={!canSubmit}
          style={{ ...ui.cta, opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'default' }}
        >
          {publishing ? 'Publishing…' : savedSlug ? 'Update' : 'Publish'}
        </button>
        {publishing ? (
          <span id="brief-rail-publish-progress" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>
            Saving and rendering the PDF (about 10s).
          </span>
        ) : null}
      </div>

      {publishedBrief?.public && publishedBrief?.publicUrl ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a href={publishedBrief.publicUrl} target="_blank" rel="noopener noreferrer" style={{ ...ui.btn(false), textDecoration: 'none' }}>Open ↗</a>
          <button type="button" onClick={() => copyLink(publishedBrief.publicUrl)} style={ui.btn(false)}>{copiedLink ? 'Copied ✓' : 'Copy public link'}</button>
          {pdfLinkFor(publishedBrief) ? (
            <a href={pdfLinkFor(publishedBrief)} target="_blank" rel="noopener noreferrer" download style={{ ...ui.btn(false), textDecoration: 'none' }}>Download PDF</a>
          ) : null}
        </div>
      ) : null}

      {error ? <span role="alert" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: '#dc2626' }}>{error}</span> : null}
      {publishedBrief?.publicUrl ? (
        <span id="brief-rail-publish-published-url-hint" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, overflowWrap: 'anywhere' }}>
          {publishedAt ? `Published ${publishedAt} · ` : ''}{publishedBrief.publicUrl}
        </span>
      ) : null}
    </RailCard>
  );
}
