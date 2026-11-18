'use client';

// Client Brief (admin) - paste a client's Markdown breakdown, preview it
// exactly as it will render (the layout is the pasted text, in order), publish a
// hosted URL + PDF + share image, and manage this client's client briefs:
// load a saved one back into the editor and re-publish to the SAME link,
// copy / open / PDF / unpublish / republish / delete. Publishing mirrors
// Invoice Studio's Publish card (public toggle, OG share-image fields with a
// live preview). Rendering happens on the server (POST
// /api/dashboard/custom-briefs with kind:'client-brief'); this component never
// builds the document HTML itself.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { firstParagraphText, suggestClientBriefOg } from '../../features/client-brief/og.js';

const ENDPOINT = '/api/dashboard/custom-briefs';
const OG_PREVIEW_ENDPOINT = '/api/dashboard/custom-briefs/og-preview';
const MAX_CHARS = 50000;
const OG_PREVIEW_DEBOUNCE_MS = 600;
const DEFAULT_TITLE = 'Client Brief';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function firstHeading(text) {
  const match = String(text || '').match(/^ {0,3}#\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].replace(/[*_`]/g, '').trim() : '';
}

const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 };

export function ClientBriefCard({ user, apiPath, clientName }) {
  const toApiPath = typeof apiPath === 'function' ? apiPath : (path) => path;
  const displayClient = clientName || 'the selected client';

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [publicToggle, setPublicToggle] = useState(true);
  const [editingSlug, setEditingSlug] = useState('');
  const [ogOpen, setOgOpen] = useState(false);
  const [ogLabel, setOgLabel] = useState('');
  const [ogSubhead, setOgSubhead] = useState('');
  const [hideOgSubhead, setHideOgSubhead] = useState(false);
  const [ogTitleLines, setOgTitleLines] = useState(['', '']);
  const [ogLines, setOgLines] = useState(['', '']);
  const [ogSrc, setOgSrc] = useState('');
  const [ogStatus, setOgStatus] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [notice, setNotice] = useState('');
  const [published, setPublished] = useState(null);
  const [briefs, setBriefs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [busySlug, setBusySlug] = useState('');
  const cancelledRef = useRef(false);
  const seededRef = useRef(false);
  const ogUrlRef = useRef('');

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const authedRequest = useCallback(async (method, path, body) => {
    const token = await user.getIdToken();
    return fetch(toApiPath(path), {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }, [user, toApiPath]);

  const authedFetch = useCallback(async (method, path, body) => {
    const res = await authedRequest(method, path, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
    return data;
  }, [authedRequest]);

  const loadBriefs = useCallback(async () => {
    if (!user) return;
    setListLoading(true);
    setListError('');
    try {
      const data = await authedFetch('GET', `${ENDPOINT}?kind=client-brief`);
      if (!cancelledRef.current) setBriefs(Array.isArray(data.briefs) ? data.briefs : []);
    } catch (err) {
      if (!cancelledRef.current) {
        setBriefs([]);
        setListError(err instanceof Error ? err.message : 'Could not load client briefs.');
      }
    } finally {
      if (!cancelledRef.current) setListLoading(false);
    }
  }, [user, authedFetch]);

  useEffect(() => { loadBriefs(); }, [loadBriefs]);

  const effectiveTitle = (title.trim() || firstHeading(text) || DEFAULT_TITLE).slice(0, 140);
  const ogPayload = {
    ogLabel, ogSubhead, hideOgSubhead, ogTitleLines, ogLines,
  };

  // Prefill the share-image fields once, the first time the OG section opens
  // with nothing typed (a loaded saved brief restores its own values first).
  // Clearing a field afterwards keeps it clear.
  useEffect(() => {
    if (!ogOpen || seededRef.current) return;
    seededRef.current = true;
    const allEmpty = !ogSubhead.trim() && !ogLines.some((l) => l.trim()) && !ogTitleLines.some((l) => l.trim());
    if (!allEmpty) return;
    const suggestion = suggestClientBriefOg({ title: effectiveTitle, clientName, text });
    setOgTitleLines(suggestion.ogTitleLines);
    setOgSubhead(suggestion.ogSubhead);
    setOgLines(suggestion.ogLines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ogOpen]);

  // Live OG preview: the admin og-preview route runs the SAME renderer as the
  // public /og-image route. Debounced; writes nothing.
  const ogDepsKey = [effectiveTitle, clientName, ogLabel, ogSubhead, hideOgSubhead ? 1 : 0, ogTitleLines.join('|'), ogLines.join('|'), firstParagraphText(text, 240)].join('\u0001');
  useEffect(() => {
    if (!ogOpen || !user) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setOgStatus('Rendering…');
      try {
        const res = await authedRequest('POST', OG_PREVIEW_ENDPOINT, {
          kind: 'client-brief',
          title: effectiveTitle,
          clientName,
          description: firstParagraphText(text, 240),
          ...ogPayload,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Preview failed (HTTP ${res.status}).`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        if (ogUrlRef.current) URL.revokeObjectURL(ogUrlRef.current);
        ogUrlRef.current = next;
        setOgSrc(next);
        setOgStatus('');
      } catch (err) {
        if (!cancelled) setOgStatus(err instanceof Error ? err.message : 'Could not render the preview.');
      }
    }, OG_PREVIEW_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ogDepsKey, ogOpen, user]);

  useEffect(() => () => { if (ogUrlRef.current) URL.revokeObjectURL(ogUrlRef.current); }, []);

  const bodyForServer = () => ({
    kind: 'client-brief',
    text,
    title: title.trim(),
    ...ogPayload,
  });

  const runPreview = useCallback(async () => {
    if (!user || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError('');
    setNotice('');
    try {
      const data = await authedFetch('POST', ENDPOINT, { ...bodyForServer(), preview: true });
      if (!cancelledRef.current) setPreviewHtml(typeof data.html === 'string' ? data.html : '');
    } catch (err) {
      if (!cancelledRef.current) {
        setPreviewHtml('');
        setPreviewError(err instanceof Error ? err.message : 'Preview failed.');
      }
    } finally {
      if (!cancelledRef.current) setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, previewLoading, authedFetch, text, title, ogLabel, ogSubhead, hideOgSubhead, ogTitleLines, ogLines]);

  const publish = useCallback(async () => {
    if (!user || publishing || !text.trim()) return;
    const verb = editingSlug ? 'Update' : 'Publish';
    const ok = typeof window === 'undefined'
      ? true
      : window.confirm(publicToggle
        ? `${verb} this brief for ${displayClient}? ${editingSlug ? 'The same link is kept and the PDF is re-rendered.' : 'It creates a hosted link and PDF that anyone with the link can open.'}`
        : `${verb} this brief for ${displayClient} as private (saved, no public link)?`);
    if (!ok) return;
    setPublishing(true);
    setPublishError('');
    setNotice('');
    try {
      const data = await authedFetch('POST', ENDPOINT, {
        ...bodyForServer(),
        public: publicToggle,
        ...(editingSlug ? { briefSlug: editingSlug } : {}),
      });
      if (!cancelledRef.current) {
        setPublished(data?.brief || null);
        if (data?.brief?.briefSlug) setEditingSlug(data.brief.briefSlug);
        const base = data?.brief?.public && data?.brief?.publicUrl ? `${editingSlug ? 'Updated' : 'Published'}: ${data.brief.publicUrl}` : 'Saved (private).';
        setNotice(data?.pdf && data.pdf.ok === false && data?.brief?.public ? `${base} (PDF will generate on first download.)` : base);
      }
      await loadBriefs();
    } catch (err) {
      if (!cancelledRef.current) setPublishError(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      if (!cancelledRef.current) setPublishing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, publishing, text, title, publicToggle, editingSlug, displayClient, authedFetch, loadBriefs, ogLabel, ogSubhead, hideOgSubhead, ogTitleLines, ogLines]);

  const copyLink = useCallback(async (url) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (typeof window !== 'undefined') window.prompt('Copy this link:', url);
      setNotice('Link copied.');
    } catch {
      if (typeof window !== 'undefined') window.prompt('Copy this link:', url);
    }
  }, []);

  const padTwo = (list) => [list?.[0] || '', list?.[1] || ''];

  const loadIntoEditor = useCallback((brief) => {
    seededRef.current = true; // a saved brief restores its own OG values; never re-prefill over them
    setEditingSlug(brief.briefSlug);
    setTitle(brief.title || '');
    setText(brief.sourceText || '');
    setPublicToggle(brief.public === true);
    setOgLabel(brief.ogLabel || '');
    setOgSubhead(brief.ogSubhead || '');
    setHideOgSubhead(brief.hideOgSubhead === true);
    // Keep a third headline line (allowed, as invoices; settable from MCP) even though the card edits two.
    setOgTitleLines([...padTwo(brief.ogTitleLines), ...(brief.ogTitleLines?.[2] ? [brief.ogTitleLines[2]] : [])]);
    setOgLines(padTwo(brief.ogLines));
    setPublished(brief);
    setPreviewHtml('');
    setPreviewError('');
    setPublishError('');
    setNotice(`Loaded "${brief.title}" for editing. Publishing again updates the same link.`);
  }, []);

  const startNew = useCallback(() => {
    seededRef.current = false;
    setEditingSlug('');
    setTitle('');
    setText('');
    setPublicToggle(true);
    setOgLabel('');
    setOgSubhead('');
    setHideOgSubhead(false);
    setOgTitleLines(['', '']);
    setOgLines(['', '']);
    setPublished(null);
    setPreviewHtml('');
    setNotice('');
    setPublishError('');
  }, []);

  const setPublic = useCallback(async (brief, nextPublic) => {
    if (nextPublic === false && typeof window !== 'undefined'
      && !window.confirm('Unpublish this brief? The link stops working and its PDF is deleted.')) return;
    setBusySlug(brief.briefSlug);
    setListError('');
    try {
      await authedFetch('PATCH', ENDPOINT, { briefSlug: brief.briefSlug, public: nextPublic });
      await loadBriefs();
    } catch (err) {
      if (!cancelledRef.current) setListError(err instanceof Error ? err.message : 'Could not update the brief.');
    } finally {
      if (!cancelledRef.current) setBusySlug('');
    }
  }, [authedFetch, loadBriefs]);

  const remove = useCallback(async (brief) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this client brief permanently?')) return;
    setBusySlug(brief.briefSlug);
    setListError('');
    try {
      await authedFetch('DELETE', ENDPOINT, { briefSlug: brief.briefSlug });
      if (editingSlug === brief.briefSlug) startNew();
      await loadBriefs();
    } catch (err) {
      if (!cancelledRef.current) setListError(err instanceof Error ? err.message : 'Could not delete the brief.');
    } finally {
      if (!cancelledRef.current) setBusySlug('');
    }
  }, [authedFetch, loadBriefs, editingSlug, startNew]);

  const overLimit = text.length > MAX_CHARS;
  const setLine = (setter) => (index, value) => setter((prev) => { const next = [...prev]; next[index] = value; return next; });
  const setTitleLine = setLine(setOgTitleLines);
  const setExtraLine = setLine(setOgLines);
  const pdfHref = published?.pdfDownloadUrl || published?.pdfUrl || (published?.publicUrl ? `${published.publicUrl}/pdf` : '');

  return (
    <div id="client-brief-panel" className="tile-detail-bento-cell" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div id="client-brief-input-row" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {editingSlug && (
          <p id="client-brief-editing-hint" className="mu-label" style={{ margin: 0 }}>
            Editing a saved client brief. Publishing again updates the same link.{' '}
            <button type="button" id="client-brief-new-btn" className="mu-btn-outline" onClick={startNew}>New brief</button>
          </p>
        )}
        <label className="mu-field">
          <span className="mu-label">Title (blank = first heading)</span>
          <input
            id="client-brief-title-input"
            className="mu-input"
            value={title}
            maxLength={140}
            placeholder={firstHeading(text) || DEFAULT_TITLE}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="mu-field">
          <span className="mu-label">Markdown for {displayClient}</span>
          <textarea
            id="client-brief-paste-input"
            className="mu-textarea"
            rows={14}
            value={text}
            spellCheck={false}
            placeholder="Paste the client breakdown (Markdown). It is published exactly as pasted, in the same order."
            onChange={(e) => setText(e.target.value)}
          />
          <span className="mu-label" style={{ opacity: overLimit ? 1 : 0.6 }}>
            {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
          </span>
        </label>

        <div id="client-brief-publish-controls-row" style={rowStyle}>
          <label className="mu-field" style={{ minWidth: 200 }}>
            <span className="mu-label">Visibility</span>
            <select
              id="client-brief-visibility-select"
              className="mu-input"
              value={publicToggle ? 'on' : 'off'}
              onChange={(e) => setPublicToggle(e.target.value === 'on')}
            >
              <option value="on">Public (hosted link)</option>
              <option value="off">Private (save only)</option>
            </select>
          </label>
          <button type="button" id="client-brief-og-toggle-btn" className="mu-btn-outline" aria-expanded={ogOpen} onClick={() => setOgOpen((v) => !v)}>
            {ogOpen ? 'Hide share image' : 'Share image (OG)'}
          </button>
        </div>

        {ogOpen && (
          <div id="client-brief-og-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div id="client-brief-og-preview" style={{ display: 'grid', gap: 8 }}>
              <span className="mu-label">Share image (OG) preview</span>
              <div style={{ position: 'relative', width: '100%', aspectRatio: '1200 / 630', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--t-border-subtle)', background: 'var(--t-surface)' }}>
                {ogSrc ? <img src={ogSrc} alt="Share image preview" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                {ogStatus ? <span className="mu-label" style={{ position: 'absolute', left: 8, bottom: 6 }}>{ogStatus}</span> : null}
              </div>
              {ogSrc ? <a className="mu-btn-outline" href={ogSrc} download={`${effectiveTitle} OG image.jpg`} style={{ justifySelf: 'start' }}>Download image</a> : null}
            </div>
            <div id="client-brief-og-fields" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="mu-field">
                <span className="mu-label">Subhead (blank = first paragraph)</span>
                <input id="client-brief-og-subhead-input" className="mu-input" value={ogSubhead} maxLength={160} onChange={(e) => setOgSubhead(e.target.value)} />
              </label>
              <label className="mu-field" style={{ maxWidth: 240 }}>
                <span className="mu-label">Subhead line</span>
                <select id="client-brief-og-subhead-visibility-select" className="mu-input" value={hideOgSubhead ? 'hide' : 'show'} onChange={(e) => setHideOgSubhead(e.target.value === 'hide')}>
                  <option value="show">Show</option>
                  <option value="hide">Hide</option>
                </select>
              </label>
              <div id="client-brief-og-title-lines-row" style={gridStyle}>
                <label className="mu-field">
                  <span className="mu-label">Headline line 1</span>
                  <input className="mu-input" value={ogTitleLines[0]} maxLength={40} placeholder="Blank = auto from title" onChange={(e) => setTitleLine(0, e.target.value)} />
                </label>
                <label className="mu-field">
                  <span className="mu-label">Headline line 2 (blank = off)</span>
                  <input className="mu-input" value={ogTitleLines[1]} maxLength={40} onChange={(e) => setTitleLine(1, e.target.value)} />
                </label>
              </div>
              <div id="client-brief-og-extra-lines-row" style={gridStyle}>
                <label className="mu-field">
                  <span className="mu-label">Extra line 1 (blank = off)</span>
                  <input className="mu-input" value={ogLines[0]} maxLength={120} onChange={(e) => setExtraLine(0, e.target.value)} />
                </label>
                <label className="mu-field">
                  <span className="mu-label">Extra line 2 (blank = off)</span>
                  <input className="mu-input" value={ogLines[1]} maxLength={120} onChange={(e) => setExtraLine(1, e.target.value)} />
                </label>
              </div>
            </div>
          </div>
        )}

        <div id="client-brief-actions-row" style={rowStyle}>
          <button type="button" id="client-brief-preview-btn" className="mu-btn-outline" disabled={!text.trim() || overLimit || previewLoading} onClick={runPreview}>
            {previewLoading ? 'Rendering…' : 'Preview'}
          </button>
          <button type="button" id="client-brief-publish-btn" className="mu-btn-outline" disabled={!text.trim() || overLimit || publishing} onClick={publish}>
            {publishing ? 'Publishing…' : editingSlug ? 'Update' : 'Publish'}
          </button>
        </div>
        {previewError && <p id="client-brief-preview-error" role="alert" style={{ margin: 0 }}>{previewError}</p>}
        {publishError && <p id="client-brief-publish-error" role="alert" style={{ margin: 0 }}>{publishError}</p>}
        {notice && <p id="client-brief-notice" role="status" style={{ margin: 0, overflowWrap: 'anywhere' }}>{notice}</p>}
        {published?.public && published?.publicUrl && (
          <div id="client-brief-published-actions-row" style={rowStyle}>
            <a className="mu-btn-outline" href={published.publicUrl} target="_blank" rel="noopener noreferrer">Open</a>
            <button type="button" className="mu-btn-outline" onClick={() => copyLink(published.publicUrl)}>Copy link</button>
            {pdfHref ? <a className="mu-btn-outline" href={pdfHref} target="_blank" rel="noopener noreferrer">Download PDF</a> : null}
          </div>
        )}
      </div>

      {previewHtml && (
        <iframe
          id="client-brief-preview-frame"
          title="Client brief preview"
          sandbox=""
          srcDoc={previewHtml}
          style={{ width: '100%', height: 560, border: '1px solid var(--t-border-subtle)', borderRadius: 12, background: 'var(--t-surface)' }}
        />
      )}

      <div id="client-brief-published-list">
        <h4 className="mu-label" style={{ margin: '0 0 8px' }}>Client briefs for {displayClient}</h4>
        {listLoading && <p style={{ margin: 0 }}>Loading…</p>}
        {listError && <p role="alert" style={{ margin: 0 }}>{listError}</p>}
        {!listLoading && !listError && briefs.length === 0 && <p style={{ margin: 0 }}>None yet.</p>}
        {briefs.map((brief) => {
          const busy = busySlug === brief.briefSlug;
          return (
            <div
              key={brief.id}
              id={`client-brief-row-${brief.id}`}
              style={{ ...rowStyle, padding: '10px 0', borderBottom: '1px dashed var(--t-border-subtle)' }}
            >
              <span className="mu-chip">{formatDate(brief.updatedAt || brief.createdAt)}</span>
              <strong style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>{brief.title}</strong>
              <span className="mu-chip">{brief.public ? 'Public' : 'Unpublished'}</span>
              <button type="button" className="mu-btn-outline" disabled={busy} onClick={() => loadIntoEditor(brief)}>Edit</button>
              {brief.public && (
                <>
                  <button type="button" className="mu-btn-outline" onClick={() => copyLink(brief.publicUrl)}>Copy link</button>
                  <a className="mu-btn-outline" href={brief.publicPath} target="_blank" rel="noopener noreferrer">Open</a>
                  <a className="mu-btn-outline" href={brief.pdfDownloadPath} target="_blank" rel="noopener noreferrer">Download PDF</a>
                </>
              )}
              <button type="button" className="mu-btn-outline" disabled={busy} onClick={() => setPublic(brief, !brief.public)}>
                {brief.public ? 'Unpublish' : 'Republish'}
              </button>
              <button type="button" className="mu-btn-outline" disabled={busy} onClick={() => remove(brief)}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ClientBriefCard;
