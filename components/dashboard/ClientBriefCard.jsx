'use client';

// Client Brief (admin) launcher. Writing, previewing and publishing now live in
// the Brief Studio (/dashboard/studio?tool=brief, built on the Invoice Studio
// template); this card opens it for the selected client and lists that client's
// saved client briefs (copy / open / PDF / unpublish / republish / delete).
// Rendering and publishing stay server-side (POST /api/dashboard/custom-briefs
// with kind:'client-brief'); this component never builds document HTML.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { briefStudioHref } from '../../features/client-brief/studio-link.js';

const ENDPOINT = '/api/dashboard/custom-briefs';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' };

export function ClientBriefCard({ user, apiPath, clientName, clientId }) {
  const toApiPath = typeof apiPath === 'function' ? apiPath : (path) => path;
  const displayClient = clientName || 'the selected client';

  const [briefs, setBriefs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [busySlug, setBusySlug] = useState('');
  const [notice, setNotice] = useState('');
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

  return (
    <div id="client-brief-panel" className="tile-detail-bento-cell" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div id="client-brief-launcher-row" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p id="client-brief-launcher-description" style={{ margin: 0 }}>
          Write, preview and publish client briefs for {displayClient} in the Brief Studio: paste the breakdown,
          pick a theme, and publish a hosted page, PDF and share image.
        </p>
        <div style={rowStyle}>
          <a
            id="client-brief-open-studio-link"
            className="mu-btn-outline"
            href={briefStudioHref({ clientId })}
            target="_blank"
            rel="noopener noreferrer"
          >
            OPEN STUDIO
          </a>
        </div>
        {notice && <p id="client-brief-notice" role="status" style={{ margin: 0 }}>{notice}</p>}
      </div>

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
              <a className="mu-btn-outline" href={briefStudioHref({ clientId, briefSlug: brief.briefSlug })} target="_blank" rel="noopener noreferrer">Edit in Studio</a>
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
