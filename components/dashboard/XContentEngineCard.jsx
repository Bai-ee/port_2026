'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { FolderTree, History, Library, Users } from 'lucide-react';
import BottomNav from './content-ui/ui/BottomNav';
import { Toast } from './content-ui/Feedback';
import ContentUiStyles from './content-ui/ContentUiStyles';
import { readImpersonateClientId, withImpersonation } from '../../lib/dashboard/bootstrap-session.js';

// Content Center — the inventory side of the content system: Library (ContentPackage
// rows), Buckets, Timeline and Clients. Today / Queue & Calendar / Strategy / Results /
// Telegram live in the Marketing Director cards (components/dashboard/marketing/*).
//
// Everything here is Firestore-only; no network spend.
//
// ⚠️ Styling trap (same as XCalendarCard / XMonitorCard): the CSS lives in
// content-ui/ContentUiStyles.jsx, a `<style jsx global>` with EVERY selector prefixed
// `.xce-scope` (this root carries that class), because
// plain `<style jsx>` only scopes JSX written directly in THIS component's
// return — markup rendered by the child panels never receives the generated
// class. Handing the tag a variable instead of an inline template literal
// fails the compile and renders an empty pane. All panel CSS therefore lives
// in this one block, and the panels emit classNames only.

const InventoryPanel = dynamic(() => import('./x-content/InventoryPanel'), { ssr: false });
const ClientCapturePanel = dynamic(() => import('./x-content/ClientCapturePanel'), { ssr: false });
const BucketsPanel = dynamic(() => import('./x-content/BucketsPanel'), { ssr: false });
const TimelinePanel = dynamic(() => import('./x-content/TimelinePanel'), { ssr: false });

const TABS = ['inventory', 'buckets', 'timeline', 'clients'];
const TAB_STORAGE_KEY = 'xce-last-tab';

// Content Center navigation: Library · Buckets · Timeline · Clients (inventory = Library).
const PRIMARY_TABS = [
  { id: 'inventory', label: 'Library', Icon: Library },
  { id: 'buckets', label: 'Buckets', Icon: FolderTree },
  { id: 'timeline', label: 'Timeline', Icon: History },
  { id: 'clients', label: 'Clients', Icon: Users },
];
const TOAST_MS = 3200;

// Per-viewer convenience only: any storage failure just means "start on Library".
function readSavedTab() {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(TAB_STORAGE_KEY) : null;
    return TABS.includes(saved) ? saved : 'inventory';
  } catch {
    return 'inventory';
  }
}

const ENDPOINT = '/api/dashboard/quote-targets';

export default function XContentEngineCard({ getIdToken, activeClientId, clientName }) {
  const [tab, setTab] = useState(readSavedTab);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    try { window.localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* storage unavailable */ }
  }, [tab]);
  const pickTab = useCallback((id) => { setTab(id); }, []);

  const [packages, setPackages] = useState([]);
  const [audit, setAudit] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [clientError, setClientError] = useState('');

  const call = useCallback(async (action, body = {}) => {
    const token = getIdToken ? await getIdToken() : null;
    const res = await fetch(withImpersonation(ENDPOINT, readImpersonateClientId()), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `${action} failed.`), { status: res.status, data });
    return data;
  }, [getIdToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const invRes = await call('inventory-list');
      setPackages(Array.isArray(invRes?.packages) ? invRes.packages : []);
      setAudit(invRes?.audit || null);
    } catch (err) {
      setError(err.message || 'Could not load the content engine.');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeClientId]);

  const onCaptureClient = useCallback(async (capture) => {
    setSavingId('capture');
    setClientError('');
    try {
      await call('capture-client-story', { capture });
      await load();
      showToast('Story captured');
      return true;
    } catch (err) {
      setClientError(err.message || 'Could not capture.');
      showToast(err.message || 'Could not capture.', 'error');
      return false;
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  const onDecidePackage = useCallback(async (action, id) => {
    setSavingId(id);
    setClientError('');
    try {
      await call(action, { id });
      await load();
      showToast(action === 'reject-package' ? 'Rejected' : 'Approved');
    } catch (err) {
      setClientError(err.message || 'Could not update approval.');
      showToast(err.message || 'Could not update approval.', 'error');
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  const onSave = useCallback(async (pkg) => {
    setSavingId(pkg?.id || 'new');
    setError('');
    try {
      await call('inventory-save', { pkg });
      await load();
      showToast('Saved');
    } catch (err) {
      setError(err.message || 'Could not save.');
      showToast(err.message || 'Could not save.', 'error');
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  const onDelete = useCallback(async (id) => {
    setSavingId(id);
    setError('');
    try {
      await call('inventory-delete', { id });
      await load();
      showToast('Deleted');
    } catch (err) {
      setError(err.message || 'Could not delete.');
      showToast(err.message || 'Could not delete.', 'error');
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  return (
    <div id="x-content-card" className="xce-scope">
      {clientName ? (
        <header id="x-content-header" className="xce-header">
          <p id="x-content-client-line" className="xce-client">{clientName}</p>
        </header>
      ) : null}

      {/* Tab row (hidden on phones in favour of the bottom nav). Owns the canonical x-content-tab-<id> ids at every width. */}
      <div id="x-content-tabs" className="xce-tabs" role="tablist">
        {PRIMARY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            id={`x-content-tab-${t.id}`}
            className={`xce-tab${tab === t.id ? ' xce-tab-active' : ''}`}
            onClick={() => pickTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
          >
            <t.Icon size={13} /> {t.label}{t.id === 'inventory' && packages.length ? ` (${packages.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'timeline' ? (
        <TimelinePanel call={call} />
      ) : tab === 'buckets' ? (
        <BucketsPanel call={call} packages={packages} loading={loading} error={error} onReload={() => load()} />
      ) : tab === 'clients' ? (
        <ClientCapturePanel
          packages={packages}
          loading={loading}
          error={clientError || error}
          savingId={savingId}
          onCapture={onCaptureClient}
          onApprove={(id) => onDecidePackage('approve-package', id)}
          onReject={(id) => onDecidePackage('reject-package', id)}
        />
      ) : (
        <InventoryPanel
          packages={packages}
          audit={audit}
          loading={loading}
          error={error}
          savingId={savingId}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}

      <Toast toast={toast} />

      {/* Phone (<=480px): sticky bottom nav. In flow after the panels, so it never covers content. */}
      <div id="x-content-mobile-bottom-nav-shell" className="xce-bottom-shell">
        <BottomNav
          id="x-content-mobile-bottom-nav"
          value={tab}
          onChange={pickTab}
          items={[
            { value: 'inventory', label: 'Library', icon: <Library size={18} /> },
            { value: 'buckets', label: 'Buckets', icon: <FolderTree size={18} /> },
            { value: 'timeline', label: 'Timeline', icon: <History size={18} /> },
            { value: 'clients', label: 'Clients', icon: <Users size={18} /> },
          ]}
        />
      </div>

      <ContentUiStyles />
    </div>
  );
}
