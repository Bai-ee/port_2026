'use client';

// Brief Studio (?tool=brief) - ADMIN ONLY. Built on the Invoice Studio template:
// canvas (BriefCanvas) left, rail (BriefRail) right, the same shell and the same
// narrow/mobile behaviour (board absolute `left:0 right:railW` on desktop, a
// stacked block when `isNarrow`).
//
// StudioPage loads this file with dynamic() and mounts it only when `isAdmin`;
// the "Admin only" panel for everyone else lives in ./BriefAdminOnly (outside
// this chunk). As a second guard this component renders nothing without
// `isAdmin`, and useBriefDraft never touches localStorage for a non-admin.
//
// The default client comes from `?as=<clientId>` (the dashboard launcher puts it
// there, since impersonation lives in the dashboard tab's sessionStorage); a
// `?brief=<slug>` opens that saved brief once. `authedFetch` is the Studio
// shell's and is left alone: every call wraps its PATH with withImpersonation.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useBriefDraft } from './useBriefDraft';
import BriefCanvas from './BriefCanvas';
import BriefRail from './rail/BriefRail';
import { readBriefStudioParams } from '../../../../features/client-brief/studio-link.js';

function initialParams() {
  if (typeof window === 'undefined') return { clientId: '', briefSlug: '' };
  return readBriefStudioParams(window.location.search);
}

export default function BriefStudio({ isNarrow = false, railW = 336, isAdmin = false, authedFetch = null }) {
  const [params] = useState(initialParams);
  const [clientId, setClientId] = useState(params.clientId);
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState('');

  // Admin client picker: GET /api/admin/clients (as the dashboard does).
  useEffect(() => {
    if (!isAdmin || !authedFetch) return undefined;
    let cancelled = false;
    setClientsLoading(true);
    setClientsError('');
    (async () => {
      try {
        const res = await authedFetch('/api/admin/clients', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Could not load clients.');
        if (!cancelled) setClients(Array.isArray(data.clients) ? data.clients.filter((c) => c?.clientId) : []);
      } catch (err) {
        if (!cancelled) setClientsError(err instanceof Error ? err.message : 'Could not load clients.');
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, authedFetch]);

  const draft = useBriefDraft({ isAdmin, clientId });

  // Keep the URL's ?as= in step with the picked client (cosmetic, shareable).
  const pickClient = useCallback((next) => {
    setClientId(next);
    try {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set('as', next); else url.searchParams.delete('as');
      url.searchParams.delete('brief');
      window.history.replaceState(null, '', url.toString());
    } catch { /* URL update is cosmetic */ }
  }, []);

  const clientName = useMemo(() => {
    const picked = clients.find((c) => c.clientId === clientId);
    return picked ? (picked.companyName || picked.clientId) : '';
  }, [clients, clientId]);

  if (!isAdmin) return null;

  return (
    <>
      <div
        id="brief-studio-board"
        style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 'none' }
            : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW }),
        }}
      >
        <BriefCanvas
          title={draft.title}
          text={draft.text}
          themeId={draft.themeId}
          clientName={clientName}
          isAdmin={isAdmin}
          isNarrow={isNarrow}
          onNewBrief={draft.startNew}
        />
      </div>

      <BriefRail
        key={clientId || 'no-client'}
        isNarrow={isNarrow}
        railW={railW}
        authedFetch={authedFetch}
        draft={draft}
        clients={clients}
        clientsLoading={clientsLoading}
        clientsError={clientsError}
        clientId={clientId}
        onPickClient={pickClient}
        clientName={clientName}
        initialBriefSlug={params.briefSlug}
      />
    </>
  );
}
