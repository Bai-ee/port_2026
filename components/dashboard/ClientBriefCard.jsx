'use client';

// Client Brief (admin) — paste a client's breakdown text, preview it in the
// fixed brief template, publish a hosted URL + PDF, and manage this client's
// published client briefs (copy / open / PDF / unpublish / republish / delete).
// Rendering happens on the server (POST /api/dashboard/custom-briefs with
// kind:'client-brief'); this component never builds HTML itself.

import React, { useCallback, useEffect, useRef, useState } from 'react';

const ENDPOINT = '/api/dashboard/custom-briefs';
const MAX_CHARS = 50000;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ClientBriefCard({ user, apiPath, clientName }) {
  const toApiPath = typeof apiPath === 'function' ? apiPath : (path) => path;
  const displayClient = clientName || 'the selected client';

  const [title, setTitle] = useState('Client Brief');
  const [text, setText] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [notice, setNotice] = useState('');
  const [briefs, setBriefs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [busySlug, setBusySlug] = useState('');
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const authedFetch = useCallback(async (method, path, body) => {
    const token = await user.getIdToken();
    const res = await fetch(toApiPath(path), {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
    return data;
  }, [user, toApiPath]);

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

  const runPreview = useCallback(async () => {
    if (!user || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError('');
    setNotice('');
    try {
      const data = await authedFetch('POST', ENDPOINT, { kind: 'client-brief', text, title, preview: true });
      if (!cancelledRef.current) setPreviewHtml(typeof data.html === 'string' ? data.html : '');
    } catch (err) {
      if (!cancelledRef.current) {
        setPreviewHtml('');
        setPreviewError(err instanceof Error ? err.message : 'Preview failed.');
      }
    } finally {
      if (!cancelledRef.current) setPreviewLoading(false);
    }
  }, [user, previewLoading, authedFetch, text, title]);

  const publish = useCallback(async () => {
    if (!user || publishing || !text.trim()) return;
    const ok = typeof window === 'undefined'
      ? true
      : window.confirm(`Publish this brief for ${displayClient}? It creates a hosted link and PDF that anyone with the link can open.`);
    if (!ok) return;
    setPublishing(true);
    setPublishError('');
    setNotice('');
    try {
      const data = await authedFetch('POST', ENDPOINT, { kind: 'client-brief', text, title, public: true });
      if (!cancelledRef.current) {
        setNotice(data?.brief?.publicUrl ? `Published: ${data.brief.publicUrl}` : 'Published.');
        if (data?.pdf && data.pdf.ok === false) setNotice((prev) => `${prev} (PDF will generate on first download.)`);
      }
      await loadBriefs();
    } catch (err) {
      if (!cancelledRef.current) setPublishError(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      if (!cancelledRef.current) setPublishing(false);
    }
  }, [user, publishing, text, title, displayClient, authedFetch, loadBriefs]);

  const copyLink = useCallback(async (url) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (typeof window !== 'undefined') window.prompt('Copy this link:', url);
      setNotice('Link copied.');
    } catch {
      if (typeof window !== 'undefined') window.prompt('Copy this link:', url);
    }
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
      await loadBriefs();
    } catch (err) {
      if (!cancelledRef.current) setListError(err instanceof Error ? err.message : 'Could not delete the brief.');
    } finally {
      if (!cancelledRef.current) setBusySlug('');
    }
  }, [authedFetch, loadBriefs]);

  const overLimit = text.length > MAX_CHARS;

  return (
    <div id="client-brief-panel" className="tile-detail-bento-cell" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div id="client-brief-input-row" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="mu-field">
          <span className="mu-label">Title</span>
          <input
            id="client-brief-title-input"
            className="mu-input"
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="mu-field">
          <span className="mu-label">Breakdown for {displayClient}</span>
          <textarea
            id="client-brief-paste-input"
            className="mu-textarea"
            rows={14}
            value={text}
            spellCheck={false}
            placeholder="Paste the client breakdown text here (Markdown-style headings, Label: value lines and bullets work best)."
            onChange={(e) => setText(e.target.value)}
          />
          <span className="mu-label" style={{ opacity: overLimit ? 1 : 0.6 }}>
            {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
          </span>
        </label>
        <div id="client-brief-actions-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" id="client-brief-preview-btn" className="mu-btn-outline" disabled={!text.trim() || overLimit || previewLoading} onClick={runPreview}>
            {previewLoading ? 'Rendering…' : 'Preview'}
          </button>
          <button type="button" id="client-brief-publish-btn" className="mu-btn-outline" disabled={!text.trim() || overLimit || publishing} onClick={publish}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
        {previewError && <p id="client-brief-preview-error" role="alert" style={{ margin: 0 }}>{previewError}</p>}
        {publishError && <p id="client-brief-publish-error" role="alert" style={{ margin: 0 }}>{publishError}</p>}
        {notice && <p id="client-brief-notice" role="status" style={{ margin: 0 }}>{notice}</p>}
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
              style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed var(--t-border-subtle)' }}
            >
              <span className="mu-chip">{formatDate(brief.updatedAt || brief.createdAt)}</span>
              <strong style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>{brief.title}</strong>
              <span className="mu-chip">{brief.public ? 'Public' : 'Unpublished'}</span>
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
