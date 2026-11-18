'use client';

// Brief Studio - the right-hand rail. Built from the same rail primitives as
// Invoice Studio (RailCard / rail-field-controls) and the same accordion + shell
// (`useRailReveal`, one card open at a time). Cards: Client, Content, Theme, then
// an "Admin" divider and Publish + Saved briefs. This rail only mounts for an
// admin (BriefStudio is loaded only when isAdmin), so there is no signed-out path.
//
// Owns the publish + saved-list state that Publish and Saved briefs share.
// BriefStudio mounts it with `key={clientId}`, so switching client discards the
// publish result, the list and any open card state of the previous client. All
// calls go through `api(path)` = withImpersonation(path, clientId); publish and
// the list are DISABLED until a client is picked, and every answer is checked to
// be for the picked client (the server falls back to the admin's own client when
// `as` is missing, which must never be mistaken for the client's data).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRailReveal } from '../../components/useRailReveal';
import { GLASS, ui } from '../../components/rail-ui';
import { recordSavedSlug } from '../brief-draft-storage';
import { withImpersonation } from '../../../../../lib/dashboard/bootstrap-session.js';
import ClientCard from './ClientCard';
import ContentCard from './ContentCard';
import ThemeCard from './ThemeCard';
import PublishCard from './PublishCard';
import SavedBriefsCard from './SavedBriefsCard';

const ENDPOINT = '/api/dashboard/custom-briefs';
const WRONG_CLIENT = 'The server answered for a different client than the one picked. Check the Saved briefs list for both clients before publishing again.';

export default function BriefRail({
  isNarrow = false, railW = 336, authedFetch = null, draft, clients, clientsLoading, clientsError,
  clientId, onPickClient, clientName, initialBriefSlug = '',
}) {
  const railInnerRef = useRailReveal();
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const [openCardId, setOpenCardId] = useState(clientId ? 'content' : 'client');
  const toggleCard = useCallback((key) => setOpenCardId((prev) => (prev === key ? null : key)), []);

  const api = useCallback((path) => withImpersonation(path, clientId), [clientId]);

  // ── Publish ──────────────────────────────────────────────────────────────
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishedBrief, setPublishedBrief] = useState(null);
  const [publishedAt, setPublishedAt] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // "New brief" clears the slug; drop the previous result with it.
  useEffect(() => { if (!draft.savedSlug) setPublishedBrief(null); }, [draft.savedSlug]);

  // ── Saved list ───────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [busySlug, setBusySlug] = useState('');
  const listRequestRef = useRef(0);

  const loadList = useCallback(async () => {
    if (!authedFetch || !clientId) { setItems([]); return []; }
    const request = ++listRequestRef.current;
    setListLoading(true);
    setListError('');
    try {
      const res = await authedFetch(api(`${ENDPOINT}?kind=client-brief`), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not load saved briefs.');
      if (data.clientId !== clientId) throw new Error(WRONG_CLIENT);
      const list = Array.isArray(data.briefs) ? data.briefs : [];
      if (!cancelledRef.current && request === listRequestRef.current) setItems(list);
      return list;
    } catch (err) {
      if (!cancelledRef.current && request === listRequestRef.current) {
        setItems([]);
        setListError(err instanceof Error ? err.message : 'Could not load saved briefs.');
      }
      return [];
    } finally {
      if (!cancelledRef.current && request === listRequestRef.current) setListLoading(false);
    }
  }, [authedFetch, api, clientId]);

  const openSaved = useCallback((brief, { quiet = false } = {}) => {
    if (!brief) return;
    draft.loadSaved(brief);
    setPublishedBrief(brief);
    setPublishError('');
    setPublishedAt('');
    if (!quiet) setOpenCardId('publish');
  }, [draft]);

  // Load on mount (the rail is keyed by client) and open `?brief=<slug>` once.
  const initialOpenedRef = useRef(false);
  useEffect(() => {
    if (!clientId) return;
    loadList().then((list) => {
      if (initialOpenedRef.current || !initialBriefSlug || cancelledRef.current) return;
      initialOpenedRef.current = true;
      const match = list.find((b) => b.briefSlug === initialBriefSlug);
      if (match) openSaved(match);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const submit = useCallback(async () => {
    if (!authedFetch || !clientId || publishing) return;
    setPublishing(true);
    setPublishError('');
    // Snapshot of what is being published, for recordSavedSlug below.
    const submitted = {
      title: draft.title, text: draft.text, themeId: draft.themeId, publicToggle: draft.publicToggle, ogSubhead: draft.ogSubhead,
      hideOgSubhead: draft.hideOgSubhead, ogTitleLines: draft.ogTitleLines, ogLines: draft.ogLines,
    };
    try {
      const res = await authedFetch(api(ENDPOINT), {
        method: 'POST',
        body: JSON.stringify({
          kind: 'client-brief',
          text: draft.text,
          title: draft.title.trim(),
          theme: draft.themeId,
          public: draft.publicToggle,
          ogSubhead: draft.ogSubhead,
          hideOgSubhead: draft.hideOgSubhead,
          ogTitleLines: draft.ogTitleLines,
          ogLines: draft.ogLines,
          ...(draft.savedSlug ? { briefSlug: draft.savedSlug } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Publish failed (HTTP ${res.status}).`);
      if (data.clientId !== clientId) throw new Error(WRONG_CLIENT);
      const brief = data.brief || null;
      // Always record the slug against the client it was published for, even if
      // the operator switched client while this request was in flight.
      if (brief?.briefSlug) {
        try { recordSavedSlug(window.localStorage, clientId, brief.briefSlug, submitted); } catch { /* blocked storage */ }
      }
      if (!cancelledRef.current) {
        setPublishedBrief(brief);
        setPublishedAt(new Date().toLocaleTimeString());
        if (brief?.briefSlug) draft.markSaved(brief.briefSlug);
      }
      loadList();
    } catch (err) {
      if (!cancelledRef.current) setPublishError(err instanceof Error ? err.message : 'Could not publish the brief.');
    } finally {
      if (!cancelledRef.current) setPublishing(false);
    }
  }, [authedFetch, api, clientId, publishing, draft, loadList]);

  const copyLink = useCallback(async (url) => {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (typeof window !== 'undefined') window.prompt('Copy this link:', url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch { /* clipboard denied */ }
  }, []);

  const setPublic = useCallback(async (brief, nextPublic) => {
    if (!authedFetch || !clientId) return;
    if (nextPublic === false && typeof window !== 'undefined'
      && !window.confirm('Unpublish this brief? The link stops working and its PDF is deleted.')) return;
    setBusySlug(brief.briefSlug);
    setListError('');
    try {
      const res = await authedFetch(api(ENDPOINT), { method: 'PATCH', body: JSON.stringify({ briefSlug: brief.briefSlug, public: nextPublic }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not update the brief.');
      if (brief.briefSlug === draft.savedSlug) draft.patch({ publicToggle: nextPublic });
      await loadList();
    } catch (err) {
      if (!cancelledRef.current) setListError(err instanceof Error ? err.message : 'Could not update the brief.');
    } finally {
      if (!cancelledRef.current) setBusySlug('');
    }
  }, [authedFetch, api, clientId, draft, loadList]);

  const remove = useCallback(async (brief) => {
    if (!authedFetch || !clientId) return;
    if (typeof window !== 'undefined' && !window.confirm('Delete this client brief permanently?')) return;
    setBusySlug(brief.briefSlug);
    setListError('');
    try {
      const res = await authedFetch(api(ENDPOINT), { method: 'DELETE', body: JSON.stringify({ briefSlug: brief.briefSlug }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not delete the brief.');
      if (brief.briefSlug === draft.savedSlug) draft.patch({ savedSlug: '' });
      await loadList();
    } catch (err) {
      if (!cancelledRef.current) setListError(err instanceof Error ? err.message : 'Could not delete the brief.');
    } finally {
      if (!cancelledRef.current) setBusySlug('');
    }
  }, [authedFetch, api, clientId, draft, loadList]);

  const publish = {
    api, authedFetch, clientId, clientName, publishing, error: publishError, publishedBrief, publishedAt, copiedLink, submit, copyLink,
  };
  const savedList = {
    items, loading: listLoading, error: listError, reload: loadList, openSaved, setPublic, remove, busySlug, clientReady: Boolean(clientId),
  };

  return (
    <div
      id="brief-studio-rail"
      data-tooltip-disabled="true"
      style={{
        boxSizing: 'border-box', maxWidth: '100%', display: 'flex', flexDirection: 'column', overflow: 'visible', background: 'transparent',
        ...(isNarrow
          ? { position: 'relative', width: '100%', flex: 1, minHeight: 0, padding: '12px 20px', overflowY: 'auto' }
          : { position: 'absolute', top: 0, right: 0, bottom: 0, width: railW, padding: '14px 26px', zIndex: 10, overflowY: 'auto' }),
      }}
    >
      <style id="brief-rail-card-styles">{`
        #brief-studio-rail, #brief-studio-rail * { box-sizing: border-box; }
        .studio-rail-card {
          position: relative; border-radius: 1rem; overflow: hidden;
          background: rgba(255, 255, 255, 0.35);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
          transition: background 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.32s cubic-bezier(0.16,1,0.3,1);
        }
        @media (prefers-reduced-motion: reduce) { .studio-rail-card { transition: none; } }
        .studio-rail-card::before {
          content: ''; position: absolute; inset: 0; border-radius: 1rem; padding: 1px;
          background: rgba(176,176,182,0.6);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          pointer-events: none; opacity: 0.85; transition: opacity 0.45s ease; z-index: 0;
        }
        .studio-rail-card-content { position: relative; z-index: 1; }
        .studio-rail-card-btn { position: relative; z-index: 1; }
      `}</style>

      <div id="brief-studio-rail-inner" ref={railInnerRef} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <ClientCard
          clients={clients} clientsLoading={clientsLoading} clientsError={clientsError} clientId={clientId}
          onPick={onPickClient} open={openCardId === 'client'} onToggle={() => toggleCard('client')}
        />
        <ContentCard draft={draft} open={openCardId === 'content'} onToggle={() => toggleCard('content')} />
        <ThemeCard draft={draft} open={openCardId === 'theme'} onToggle={() => toggleCard('theme')} />

        <div
          id="brief-rail-admin-divider"
          role="separator"
          aria-label="Admin-only tools"
          style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 2px' }}
        >
          <span style={{ flex: 1, height: 1, background: GLASS.hair }} />
          <span style={{ ...ui.label, color: GLASS.inkMute }}>Admin</span>
          <span style={{ flex: 1, height: 1, background: GLASS.hair }} />
        </div>
        <PublishCard draft={draft} publish={publish} open={openCardId === 'publish'} onToggle={() => toggleCard('publish')} />
        <SavedBriefsCard savedList={savedList} activeSlug={draft.savedSlug} open={openCardId === 'saved'} onToggle={() => toggleCard('saved')} />
      </div>
    </div>
  );
}
