'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthContext';

// ── API helpers ────────────────────────────────────────────────────────────────

async function adminFetch(user, path, options = {}) {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ── AdminPage ──────────────────────────────────────────────────────────────────

const TABS = ['CLIENTS', 'QUEUE', 'FAILED', 'INTELLIGENCE'];

const AdminPage = () => {
  const { user, signOutUser } = useAuth();
  const [tab, setTab] = useState('CLIENTS');

  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState('');

  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState('');

  // Expanded detail: { type: 'config' | 'run', id, data, loading, error }
  const [detail, setDetail] = useState(null);

  // Action status: { runId, action, status: 'pending'|'ok'|'error', message }
  const [actionStatus, setActionStatus] = useState(null);

  // Intelligence panel state
  const [intelClientList, setIntelClientList]           = useState([]);
  const [intelClientListLoading, setIntelClientListLoading] = useState(false);
  const [selectedIntelClientId, setSelectedIntelClientId]   = useState('');
  const [intelData, setIntelData]                       = useState(null);
  const [intelDataLoading, setIntelDataLoading]         = useState(false);
  const [intelDataError, setIntelDataError]             = useState('');
  const [intelActionStatus, setIntelActionStatus]       = useState(null);

  // ── Data loaders ─────────────────────────────────────────────────────────────

  const loadClients = useCallback(async () => {
    if (!user) return;
    setClientsLoading(true);
    setClientsError('');
    try {
      const data = await adminFetch(user, '/api/admin/clients');
      setClients(data.clients || []);
    } catch (err) {
      setClientsError(err.message);
    } finally {
      setClientsLoading(false);
    }
  }, [user]);

  const loadRuns = useCallback(async (statusParam) => {
    if (!user) return;
    setRunsLoading(true);
    setRunsError('');
    try {
      const data = await adminFetch(user, `/api/admin/brief-runs?status=${statusParam}`);
      setRuns(data.runs || []);
    } catch (err) {
      setRunsError(err.message);
    } finally {
      setRunsLoading(false);
    }
  }, [user]);

  const loadIntelClientList = useCallback(async () => {
    if (!user) return;
    setIntelClientListLoading(true);
    try {
      const data = await adminFetch(user, '/api/admin/clients');
      const list = data.clients || [];
      setIntelClientList(list);
      setSelectedIntelClientId((prev) => prev || (list.length > 0 ? list[0].clientId : ''));
    } catch {
      // silent — selector degrades gracefully
    } finally {
      setIntelClientListLoading(false);
    }
  }, [user]);

  const loadIntelData = useCallback(async (clientId) => {
    if (!user || !clientId) return;
    setIntelDataLoading(true);
    setIntelDataError('');
    try {
      const data = await adminFetch(user, `/api/admin/intelligence?clientId=${encodeURIComponent(clientId)}`);
      setIntelData(data.clients?.[0] ?? null);
    } catch (err) {
      setIntelDataError(err.message);
      setIntelData(null);
    } finally {
      setIntelDataLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (tab === 'CLIENTS')      loadClients();
    if (tab === 'QUEUE')        loadRuns('queue');
    if (tab === 'FAILED')       loadRuns('failed');
    if (tab === 'INTELLIGENCE') loadIntelClientList();
  }, [tab, loadClients, loadRuns, loadIntelClientList]);

  useEffect(() => {
    if (tab === 'INTELLIGENCE' && selectedIntelClientId) loadIntelData(selectedIntelClientId);
  }, [selectedIntelClientId, loadIntelData, tab]);

  // ── Detail panel ─────────────────────────────────────────────────────────────

  const openConfig = async (clientId) => {
    if (detail?.id === clientId && detail?.type === 'config') {
      setDetail(null);
      return;
    }
    setDetail({ type: 'config', id: clientId, data: null, loading: true, error: '' });
    try {
      const data = await adminFetch(user, `/api/admin/client-configs?clientId=${clientId}`);
      setDetail({ type: 'config', id: clientId, data: data.config, loading: false, error: '' });
    } catch (err) {
      setDetail({ type: 'config', id: clientId, data: null, loading: false, error: err.message });
    }
  };

  const openRunDetail = async (runId) => {
    if (detail?.id === runId && detail?.type === 'run') {
      setDetail(null);
      return;
    }
    setDetail({ type: 'run', id: runId, data: null, loading: true, error: '' });
    try {
      const data = await adminFetch(user, `/api/admin/brief-runs?runId=${runId}`);
      setDetail({ type: 'run', id: runId, data: data.run, loading: false, error: '' });
    } catch (err) {
      setDetail({ type: 'run', id: runId, data: null, loading: false, error: err.message });
    }
  };

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleRequeue = async (runId) => {
    setActionStatus({ runId, action: 'requeue', status: 'pending', message: '' });
    try {
      await adminFetch(user, '/api/admin/requeue', {
        method: 'POST',
        body: JSON.stringify({ runId }),
      });
      setActionStatus({ runId, action: 'requeue', status: 'ok', message: 'Requeued.' });
      // Refresh the current list
      if (tab === 'QUEUE') loadRuns('queue');
      if (tab === 'FAILED') loadRuns('failed');
    } catch (err) {
      setActionStatus({ runId, action: 'requeue', status: 'error', message: err.message });
    }
  };

  const handleSourceAction = async (clientId, sourceId, action) => {
    setIntelActionStatus({ sourceId, action, status: 'pending' });
    try {
      await adminFetch(user, '/api/admin/intelligence/update-source', {
        method: 'POST',
        body: JSON.stringify({ clientId, sourceId, action }),
      });
      setIntelActionStatus({
        sourceId,
        action,
        status: 'ok',
        message: action === 'rerun' ? 'Queued.' : 'Updated.',
      });
      loadIntelData(clientId);
    } catch (err) {
      setIntelActionStatus({ sourceId, action, status: 'error', message: err.message });
    }
  };

  const handleToggleInjection = async (clientId, enabled) => {
    setIntelActionStatus({ sourceId: null, action: 'toggle-injection', status: 'pending' });
    try {
      await adminFetch(user, '/api/admin/intelligence/toggle-injection', {
        method: 'POST',
        body: JSON.stringify({ clientId, enabled }),
      });
      setIntelActionStatus({
        sourceId: null,
        action: 'toggle-injection',
        status: 'ok',
        message: `Injection ${enabled ? 'enabled' : 'disabled'}.`,
      });
      loadIntelData(clientId);
    } catch (err) {
      setIntelActionStatus({ sourceId: null, action: 'toggle-injection', status: 'error', message: err.message });
    }
  };

  const handleRunNow = async (runId) => {
    setActionStatus({ runId, action: 'run', status: 'pending', message: '' });
    try {
      // Fire and forget — worker may take minutes; we just submit and report submitted
      const body = JSON.stringify({ runId });
      user.getIdToken().then((token) =>
        fetch('/api/worker/run-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body,
        }).then((res) => res.json().catch(() => ({}))).then((data) => {
          setActionStatus({
            runId,
            action: 'run',
            status: data.ok === false ? 'error' : 'ok',
            message: data.ok === false ? (data.failedStage || 'Pipeline failed') : 'Submitted for execution.',
          });
          if (tab === 'QUEUE') loadRuns('queue');
        }).catch((err) => {
          setActionStatus({ runId, action: 'run', status: 'error', message: err.message });
        })
      );
      // Optimistic "submitted" — the real result comes back async above
      setActionStatus({ runId, action: 'run', status: 'pending', message: 'Submitted…' });
    } catch (err) {
      setActionStatus({ runId, action: 'run', status: 'error', message: err.message });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div data-admin-theme="dark" id="admin-shell">
      <style>{adminCss}</style>

      <header id="admin-header">
        <Link href="/" id="admin-brand">
          <span className="mark" />
          ADMIN / CONTROL PLANE
        </Link>
        <nav id="admin-nav">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`admin-tab${tab === t ? ' is-active' : ''}`}
              onClick={() => { setTab(t); setDetail(null); setActionStatus(null); setIntelActionStatus(null); }}
            >
              {t}
            </button>
          ))}
        </nav>
        <div id="admin-meta">
          <span className="meta-email">{user?.email}</span>
          <button type="button" className="admin-signout" onClick={signOutUser}>SIGN OUT</button>
        </div>
      </header>

      {/* ── Action status banner ─────────────────────────────────────────── */}
      {actionStatus ? (
        <div
          id="admin-action-banner"
          className={`action-banner action-banner-${actionStatus.status}`}
        >
          [{actionStatus.runId.slice(0, 8)}…] {actionStatus.action.toUpperCase()}
          {' · '}
          {actionStatus.status === 'pending' ? (actionStatus.message || 'WORKING…') : null}
          {actionStatus.status === 'ok' ? actionStatus.message : null}
          {actionStatus.status === 'error' ? `ERROR: ${actionStatus.message}` : null}
          <button
            type="button"
            className="banner-dismiss"
            onClick={() => setActionStatus(null)}
          >
            ✕
          </button>
        </div>
      ) : null}

      <main id="admin-content">

        {/* ── CLIENTS TAB ─────────────────────────────────────────────────── */}
        {tab === 'CLIENTS' ? (
          <section id="admin-clients-section">
            <div className="section-head">
              <span className="section-title">CLIENTS</span>
              <span className="section-count">{clientsLoading ? '…' : clients.length}</span>
              <button type="button" className="admin-refresh" onClick={loadClients}>REFRESH</button>
            </div>
            {clientsError ? <div className="admin-error">{clientsError}</div> : null}
            {!clientsLoading && !clientsError && clients.length === 0 ? (
              <div className="admin-empty">No clients found.</div>
            ) : null}
            {clients.length > 0 ? (
              <table className="admin-table" id="clients-table">
                <thead>
                  <tr>
                    <th>CLIENT</th>
                    <th>STATUS</th>
                    <th>LATEST RUN</th>
                    <th>OWNER</th>
                    <th>CREATED</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <React.Fragment key={c.clientId}>
                      <tr
                        id={`client-row-${c.clientId}`}
                        className={detail?.id === c.clientId ? 'is-expanded' : ''}
                      >
                        <td className="cell-primary">
                          <div className="cell-id">{c.clientId}</div>
                          <div className="cell-sub">{c.normalizedHost || c.websiteUrl}</div>
                        </td>
                        <td>
                          <span className={`status-badge status-${c.status}`}>
                            {c.status}
                          </span>
                        </td>
                        <td>
                          {c.latestRunStatus ? (
                            <span className={`status-badge status-${c.latestRunStatus}`}>
                              {c.latestRunStatus}
                            </span>
                          ) : <span className="cell-dim">—</span>}
                        </td>
                        <td className="cell-dim">{c.ownerEmail || '—'}</td>
                        <td className="cell-dim">{formatDate(c.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-action-btn"
                            onClick={() => openConfig(c.clientId)}
                          >
                            {detail?.id === c.clientId && detail?.type === 'config' ? 'HIDE CONFIG' : 'VIEW CONFIG'}
                          </button>
                        </td>
                      </tr>
                      {detail?.id === c.clientId && detail?.type === 'config' ? (
                        <tr id={`config-detail-${c.clientId}`} className="detail-row">
                          <td colSpan={6}>
                            {detail.loading ? (
                              <div className="detail-loading">LOADING CONFIG…</div>
                            ) : detail.error ? (
                              <div className="detail-error">{detail.error}</div>
                            ) : (
                              <div className="detail-config">
                                <ConfigView config={detail.data} />
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            ) : null}
            {clientsLoading ? <div className="admin-loading">LOADING…</div> : null}
          </section>
        ) : null}

        {/* ── QUEUE TAB ────────────────────────────────────────────────────── */}
        {tab === 'QUEUE' ? (
          <section id="admin-queue-section">
            <div className="section-head">
              <span className="section-title">QUEUE</span>
              <span className="section-count">{runsLoading ? '…' : runs.length}</span>
              <button type="button" className="admin-refresh" onClick={() => loadRuns('queue')}>REFRESH</button>
            </div>
            {runsError ? <div className="admin-error">{runsError}</div> : null}
            {!runsLoading && !runsError && runs.length === 0 ? (
              <div className="admin-empty">Queue is empty.</div>
            ) : null}
            {runs.length > 0 ? (
              <table className="admin-table" id="queue-table">
                <thead>
                  <tr>
                    <th>RUN ID</th>
                    <th>CLIENT</th>
                    <th>STATUS</th>
                    <th>ATTEMPTS</th>
                    <th>TRIGGER</th>
                    <th>CREATED</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} id={`queue-row-${run.id}`}>
                      <td className="cell-mono cell-id-sm">{run.id ? run.id.slice(0, 12) + '…' : '—'}</td>
                      <td className="cell-primary">{run.clientId}</td>
                      <td>
                        <span className={`status-badge status-${run.status}`}>{run.status}</span>
                      </td>
                      <td className="cell-dim cell-num">{run.attempts ?? '—'}</td>
                      <td className="cell-dim">{run.trigger || '—'}</td>
                      <td className="cell-dim">{formatDate(run.createdAt)}</td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="admin-action-btn"
                          onClick={() => handleRunNow(run.id)}
                          disabled={actionStatus?.runId === run.id && actionStatus.status === 'pending'}
                        >
                          RUN NOW
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {runsLoading ? <div className="admin-loading">LOADING…</div> : null}
          </section>
        ) : null}

        {/* ── FAILED TAB ────────────────────────────────────────────────────── */}
        {tab === 'FAILED' ? (
          <section id="admin-failed-section">
            <div className="section-head">
              <span className="section-title">FAILED RUNS</span>
              <span className="section-count">{runsLoading ? '…' : runs.length}</span>
              <button type="button" className="admin-refresh" onClick={() => loadRuns('failed')}>REFRESH</button>
            </div>
            {runsError ? <div className="admin-error">{runsError}</div> : null}
            {!runsLoading && !runsError && runs.length === 0 ? (
              <div className="admin-empty">No failed runs.</div>
            ) : null}
            {runs.length > 0 ? (
              <table className="admin-table" id="failed-table">
                <thead>
                  <tr>
                    <th>RUN ID</th>
                    <th>CLIENT</th>
                    <th>STAGE</th>
                    <th>ATTEMPTS</th>
                    <th>EXHAUSTED</th>
                    <th>FAILED AT</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <React.Fragment key={run.id}>
                      <tr id={`failed-row-${run.id}`} className={detail?.id === run.id ? 'is-expanded' : ''}>
                        <td className="cell-mono cell-id-sm">{run.id ? run.id.slice(0, 12) + '…' : '—'}</td>
                        <td className="cell-primary">{run.clientId}</td>
                        <td className="cell-warn">{run.error?.stage || '—'}</td>
                        <td className="cell-dim cell-num">{run.attempts ?? '—'}</td>
                        <td>
                          {run.error?.exhausted
                            ? <span className="badge-exhausted">YES</span>
                            : <span className="cell-dim">NO</span>}
                        </td>
                        <td className="cell-dim">{formatDate(run.error?.failedAt || run.completedAt)}</td>
                        <td className="cell-actions">
                          <button
                            type="button"
                            className="admin-action-btn"
                            onClick={() => handleRequeue(run.id)}
                            disabled={actionStatus?.runId === run.id && actionStatus.status === 'pending'}
                          >
                            REQUEUE
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn admin-action-btn-secondary"
                            onClick={() => openRunDetail(run.id)}
                          >
                            {detail?.id === run.id && detail?.type === 'run' ? 'HIDE' : 'DETAIL'}
                          </button>
                        </td>
                      </tr>
                      {detail?.id === run.id && detail?.type === 'run' ? (
                        <tr id={`run-detail-${run.id}`} className="detail-row">
                          <td colSpan={7}>
                            {detail.loading ? (
                              <div className="detail-loading">LOADING…</div>
                            ) : detail.error ? (
                              <div className="detail-error">{detail.error}</div>
                            ) : (
                              <div className="detail-config">
                                <RunDetail run={detail.data} />
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            ) : null}
            {runsLoading ? <div className="admin-loading">LOADING…</div> : null}
          </section>
        ) : null}

        {/* ── INTELLIGENCE TAB ──────────────────────────────────────────── */}
        {tab === 'INTELLIGENCE' ? (
          <section id="intelligence-panel-shell">
            <div className="section-head">
              <span className="section-title">INTELLIGENCE</span>
              <button
                type="button"
                className="admin-refresh"
                onClick={() => {
                  loadIntelClientList();
                  if (selectedIntelClientId) loadIntelData(selectedIntelClientId);
                }}
              >REFRESH</button>
            </div>

            {/* Client selector */}
            <div id="intelligence-client-selector">
              <span className="intel-label">CLIENT</span>
              <select
                className="intel-select"
                value={selectedIntelClientId}
                onChange={(e) => setSelectedIntelClientId(e.target.value)}
                disabled={intelClientListLoading}
              >
                {intelClientList.length === 0 && <option value="">—</option>}
                {intelClientList.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.companyName || c.clientId}{c.websiteUrl ? ` · ${c.websiteUrl}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Action status */}
            {intelActionStatus ? (
              <div
                id="intel-action-banner"
                className={`action-banner action-banner-${intelActionStatus.status}`}
              >
                {intelActionStatus.sourceId ? `[${intelActionStatus.sourceId}] ` : ''}
                {intelActionStatus.action.toUpperCase()}
                {' · '}
                {intelActionStatus.status === 'pending' ? 'WORKING…' : null}
                {intelActionStatus.status === 'ok' ? (intelActionStatus.message || 'DONE.') : null}
                {intelActionStatus.status === 'error' ? `ERROR: ${intelActionStatus.message}` : null}
                <button type="button" className="banner-dismiss" onClick={() => setIntelActionStatus(null)}>✕</button>
              </div>
            ) : null}

            {intelDataError ? <div className="admin-error">{intelDataError}</div> : null}
            {intelDataLoading ? <div className="admin-loading">LOADING INTELLIGENCE…</div> : null}

            {!intelDataLoading && intelData ? (
              <>
                {/* Client identity */}
                <div id="intelligence-client-identity" className="intel-identity-row">
                  <div className="intel-identity-name">{intelData.companyName || intelData.clientId}</div>
                  <div className="intel-identity-meta">
                    {intelData.websiteUrl ? (
                      <a href={intelData.websiteUrl} target="_blank" rel="noopener noreferrer" className="intel-link">
                        {intelData.websiteUrl}
                      </a>
                    ) : null}
                    {intelData.intelligence?.master?.meta ? (
                      <>
                        <span className="cell-dim">·</span>
                        <span className="cell-dim">v{intelData.intelligence.master.meta.schemaVersion || '—'}</span>
                        <span className="cell-dim">·</span>
                        <span className="cell-dim">updated {formatDate(intelData.intelligence.master.meta.updatedAt)}</span>
                        <span className="cell-dim">·</span>
                        <span className="cell-dim">~{intelData.intelligence.master.meta.briefingTokenEst ?? '?'} tokens</span>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Pipeline injection toggle */}
                <div id="intelligence-injection-toggle" className="intel-injection-row">
                  <span className="intel-label">PIPELINE INJECTION</span>
                  <span className={`status-badge ${intelData.intelligence?.master?.meta?.pipelineInjection ? 'status-active' : 'status-failed'}`}>
                    {intelData.intelligence?.master?.meta?.pipelineInjection ? 'ENABLED' : 'DISABLED'}
                  </span>
                  <button
                    type="button"
                    className="admin-action-btn"
                    disabled={intelActionStatus?.status === 'pending'}
                    onClick={() => handleToggleInjection(
                      intelData.clientId,
                      !intelData.intelligence?.master?.meta?.pipelineInjection
                    )}
                  >
                    {intelData.intelligence?.master?.meta?.pipelineInjection ? 'DISABLE' : 'ENABLE'}
                  </button>
                </div>

                {/* Sources table */}
                {intelData.intelligence?.sources?.length > 0 ? (
                  <div className="intel-section">
                    <div className="intel-section-label">SOURCES</div>
                    <table className="admin-table" id="intelligence-sources-table">
                      <thead>
                        <tr>
                          <th>SOURCE</th>
                          <th>STATUS</th>
                          <th>ENABLED</th>
                          <th>COST (USD)</th>
                          <th>FETCHED</th>
                          <th>REFRESH</th>
                          <th>ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {intelData.intelligence.sources.map((src) => {
                          const settings = intelData.intelligence.sourceSettings?.[src.id] || {};
                          return (
                            <tr key={src.id} id={`intelligence-source-row-${src.id}`}>
                              <td className="cell-primary">
                                <div className="cell-id">{src.id}</div>
                                <div className="cell-sub">{src.provider}</div>
                              </td>
                              <td>
                                <span className={`status-badge status-${src.status}`}>{src.status}</span>
                              </td>
                              <td>
                                <span className={`status-badge ${settings.enabled !== false ? 'status-active' : 'status-failed'}`}>
                                  {settings.enabled !== false ? 'YES' : 'NO'}
                                </span>
                              </td>
                              <td className="cell-dim cell-num">
                                {typeof src.cost?.usd === 'number' ? `$${src.cost.usd.toFixed(6)}` : '—'}
                              </td>
                              <td className="cell-dim">{formatDate(src.fetchedAt)}</td>
                              <td className="cell-dim">{settings.refreshPolicy || '—'}</td>
                              <td className="cell-actions">
                                <button
                                  type="button"
                                  className="admin-action-btn"
                                  disabled={intelActionStatus?.status === 'pending'}
                                  onClick={() => handleSourceAction(intelData.clientId, src.id, 'rerun')}
                                >RE-RUN</button>
                                {settings.enabled !== false ? (
                                  <button
                                    type="button"
                                    className="admin-action-btn admin-action-btn-secondary"
                                    disabled={intelActionStatus?.status === 'pending'}
                                    onClick={() => handleSourceAction(intelData.clientId, src.id, 'disable')}
                                  >DISABLE</button>
                                ) : (
                                  <button
                                    type="button"
                                    className="admin-action-btn"
                                    disabled={intelActionStatus?.status === 'pending'}
                                    onClick={() => handleSourceAction(intelData.clientId, src.id, 'enable')}
                                  >ENABLE</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-empty">No intelligence sources for this client.</div>
                )}

                {/* Cost ledger */}
                {intelData.intelligence?.master?.ledger ? (
                  <div id="intelligence-cost-ledger" className="intel-section">
                    <div className="intel-section-label">COST LEDGER (30D)</div>
                    <div className="intel-ledger-grid">
                      <div className="intel-ledger-item">
                        <div className="intel-ledger-value">
                          ${(intelData.intelligence.master.ledger.totals?.usd30d ?? 0).toFixed(6)}
                        </div>
                        <div className="intel-ledger-key">TOTAL USD</div>
                      </div>
                      <div className="intel-ledger-item">
                        <div className="intel-ledger-value">
                          {intelData.intelligence.master.ledger.totals?.quotaUnits30d ?? 0}
                        </div>
                        <div className="intel-ledger-key">QUOTA UNITS</div>
                      </div>
                      <div className="intel-ledger-item">
                        <div className="intel-ledger-value">
                          {intelData.intelligence.master.ledger.totals?.auditsCount30d ?? 0}
                        </div>
                        <div className="intel-ledger-key">AUDITS</div>
                      </div>
                    </div>
                    {intelData.intelligence.master.ledger.byProvider &&
                     Object.keys(intelData.intelligence.master.ledger.byProvider).length > 0 ? (
                      <div className="intel-by-provider">
                        {Object.entries(intelData.intelligence.master.ledger.byProvider).map(([provider, d]) => (
                          <div key={provider} className="intel-provider-row">
                            <span className="cf-key">{provider}</span>
                            <span className="cf-val">
                              ${(d.usd ?? 0).toFixed(6)} · {d.count ?? 0} runs · last {formatDate(d.lastFetchedAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Scout briefing preview */}
                {intelData.intelligence?.master?.digest ? (
                  <div id="intelligence-briefing-preview" className="intel-section">
                    <div className="intel-section-label">SCOUT BRIEFING PREVIEW</div>
                    <div className="intel-briefing-meta">
                      ~{intelData.intelligence.master.digest.totalTokenEst ?? '?'} tokens
                      {' · '}
                      generated {formatDate(intelData.intelligence.master.digest.generatedAt)}
                    </div>
                    <textarea
                      className="intel-briefing-text"
                      readOnly
                      value={
                        (intelData.intelligence.master.digest.briefingBullets || []).join('\n') ||
                        '(no briefing bullets)'
                      }
                    />
                  </div>
                ) : null}

                {/* Recent events */}
                {intelData.intelligence?.recentEvents?.length > 0 ? (
                  <div id="intelligence-recent-events" className="intel-section">
                    <div className="intel-section-label">
                      RECENT EVENTS ({intelData.intelligence.recentEvents.length})
                    </div>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>AT</th>
                          <th>SOURCE</th>
                          <th>KIND</th>
                          <th>PROVIDER</th>
                          <th>USD</th>
                          <th>DURATION</th>
                          <th>NOTE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {intelData.intelligence.recentEvents.map((ev, i) => (
                          <tr key={i}>
                            <td className="cell-dim">{formatDate(ev.at)}</td>
                            <td className="cell-mono cell-id-sm">{ev.sourceId || '—'}</td>
                            <td>
                              <span className={`status-badge ${ev.kind === 'error' ? 'status-error' : ev.kind === 'fetch' ? 'status-active' : 'status-queued'}`}>
                                {ev.kind}
                              </span>
                            </td>
                            <td className="cell-dim">{ev.provider || '—'}</td>
                            <td className="cell-dim cell-num">
                              {typeof ev.usd === 'number' ? `$${ev.usd.toFixed(6)}` : '—'}
                            </td>
                            <td className="cell-dim cell-num">
                              {ev.durationMs != null ? `${ev.durationMs}ms` : '—'}
                            </td>
                            <td className="cell-dim">{ev.note || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}

            {!intelDataLoading && !intelData && !intelDataError && selectedIntelClientId ? (
              <div className="admin-empty">No intelligence data for this client.</div>
            ) : null}
          </section>
        ) : null}

      </main>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const ConfigView = ({ config }) => {
  if (!config) return <div className="detail-loading">No config data.</div>;
  const { sourceInputs, providerConfig, moduleFlags, scoutConfig, createdAt, updatedAt } = config;
  return (
    <div id="config-view-panel">
      <div className="config-section">
        <div className="config-section-label">SOURCE INPUTS</div>
        <div className="config-field"><span className="cf-key">websiteUrl</span><span className="cf-val">{sourceInputs?.websiteUrl || '—'}</span></div>
        <div className="config-field"><span className="cf-key">ideaDescription</span><span className="cf-val">{sourceInputs?.ideaDescription || '—'}</span></div>
        <div className="config-field"><span className="cf-key">uploadedImageRefs</span><span className="cf-val">{JSON.stringify(sourceInputs?.uploadedImageRefs || [])}</span></div>
      </div>
      <div className="config-section">
        <div className="config-section-label">PROVIDER CONFIG</div>
        <div className="config-field"><span className="cf-key">defaultProvider</span><span className="cf-val">{providerConfig?.defaultProvider || '—'}</span></div>
      </div>
      {moduleFlags && Object.keys(moduleFlags).length > 0 ? (
        <div className="config-section">
          <div className="config-section-label">MODULE FLAGS</div>
          {Object.entries(moduleFlags).map(([k, v]) => (
            <div className="config-field" key={k}><span className="cf-key">{k}</span><span className="cf-val">{String(v)}</span></div>
          ))}
        </div>
      ) : null}
      {scoutConfig ? <ScoutConfigView scoutConfig={scoutConfig} /> : null}
      <div className="config-section">
        <div className="config-section-label">TIMESTAMPS</div>
        <div className="config-field"><span className="cf-key">createdAt</span><span className="cf-val">{createdAt || '—'}</span></div>
        <div className="config-field"><span className="cf-key">updatedAt</span><span className="cf-val">{updatedAt || '—'}</span></div>
      </div>
    </div>
  );
};

// ── Scout Config subview ─────────────────────────────────────────────────────
// Renders the per-client enrichment config generated by the intake pipeline.
// Used inline inside ConfigView on the admin tab. Designed for a quick
// human-readable scan of what the next scout pass would search for.

const ScoutConfigView = ({ scoutConfig }) => {
  if (!scoutConfig) return null;
  const meta = scoutConfig._meta || {};
  const active = Array.isArray(meta.capabilitiesActive) ? meta.capabilitiesActive : [];
  const inactive = Array.isArray(meta.capabilitiesInactive) ? meta.capabilitiesInactive : [];
  const reddit = scoutConfig.reddit || null;
  const scout = scoutConfig.scout || null;
  const weather = scoutConfig.weather || null;
  const reviews = scoutConfig.reviews || null;
  const instagram = scoutConfig.instagram || null;

  const cost = meta.runCostData?.estimatedCostUsd;
  return (
    <>
      <div className="config-section">
        <div className="config-section-label">SCOUT CONFIG · META</div>
        <div className="config-field"><span className="cf-key">clientType</span><span className="cf-val">{meta.clientType || '—'}</span></div>
        <div className="config-field"><span className="cf-key">websiteUrl</span><span className="cf-val">{meta.websiteUrl || '—'}</span></div>
        <div className="config-field"><span className="cf-key">generatedAt</span><span className="cf-val">{meta.generatedAt || '—'}</span></div>
        <div className="config-field"><span className="cf-key">genCost</span><span className="cf-val">{cost != null ? `$${Number(cost).toFixed(4)}` : '—'}</span></div>
        <div className="config-field"><span className="cf-key">active ({active.length})</span><span className="cf-val">{active.length ? active.join(' · ') : '—'}</span></div>
        {inactive.length ? (
          <div className="config-field"><span className="cf-key">inactive</span><span className="cf-val">{inactive.map((x) => `${x.id}(${x.reason})`).join(' · ')}</span></div>
        ) : null}
      </div>

      <div className="config-section">
        <div className="config-section-label">SCOUT CONFIG · IDENTITY</div>
        <div className="config-field"><span className="cf-key">clientName</span><span className="cf-val">{scoutConfig.clientName || '—'}</span></div>
        <div className="config-field"><span className="cf-key">timeZone</span><span className="cf-val">{scoutConfig.timeZone || '—'}</span></div>
      </div>

      <ChipsBlock label="BRAND KEYWORDS" items={scoutConfig.brandKeywords} />
      <ChipsBlock label="COMPETITORS (INFERRED)" items={scoutConfig.competitors} />
      <ChipsBlock label="CATEGORY TERMS" items={scoutConfig.categoryTerms} />
      <ChipsBlock label="KOLS" items={scoutConfig.kols} />

      {reddit ? (
        <div className="config-section">
          <div className="config-section-label">REDDIT</div>
          <div className="config-field"><span className="cf-key">subreddits</span><span className="cf-val">{reddit.subreddits?.join(' · ') || '—'}</span></div>
          <div className="config-field"><span className="cf-key">mentionQueries</span><span className="cf-val">{reddit.mentionQueries?.join(' · ') || '—'}</span></div>
          <div className="config-field"><span className="cf-key">opportunityQueries</span><span className="cf-val">{reddit.opportunityQueries?.join(' · ') || '—'}</span></div>
          <div className="config-field"><span className="cf-key">limitPerQuery</span><span className="cf-val">{reddit.limitPerQuery ?? '—'}</span></div>
        </div>
      ) : null}

      <CapabilityBlock label="WEATHER" data={weather} renderer={(w) => (
        <>
          <div className="config-field"><span className="cf-key">provider</span><span className="cf-val">{w.provider}</span></div>
          <div className="config-field"><span className="cf-key">neighborhoods</span><span className="cf-val">{(w.serviceNeighborhoods || []).map((n) => `${n.name} (${n.latitude?.toFixed(3)}, ${n.longitude?.toFixed(3)})`).join(' · ') || '—'}</span></div>
          <div className="config-field"><span className="cf-key">window</span><span className="cf-val">{`${w.operationalWindowStartHour}h → +${w.operationalWindowHours}h`}</span></div>
        </>
      )} />

      <CapabilityBlock label="REVIEWS" data={reviews} renderer={(r) => (
        <>
          <div className="config-field"><span className="cf-key">provider</span><span className="cf-val">{r.provider}</span></div>
          {(r.sources || []).map((s, i) => (
            <div className="config-field" key={i}><span className="cf-key">{s.label || s.key}</span><span className="cf-val">{s.query}</span></div>
          ))}
        </>
      )} />

      <CapabilityBlock label="INSTAGRAM" data={instagram} renderer={(ig) => (
        <>
          <div className="config-field"><span className="cf-key">provider</span><span className="cf-val">{ig.provider}</span></div>
          <div className="config-field"><span className="cf-key">handle</span><span className="cf-val">@{ig.handle}</span></div>
          <div className="config-field"><span className="cf-key">profileUrl</span><span className="cf-val">{ig.profileUrl}</span></div>
        </>
      )} />

      {scout ? (
        <div className="config-section">
          <div className="config-section-label">SCOUT · SEARCH PLAN</div>
          <div className="config-field"><span className="cf-key">freshnessDays</span><span className="cf-val">{scout.freshnessDays ?? '—'}</span></div>
          {scout.sourceFocus ? (
            <div className="config-field"><span className="cf-key">sourceFocus</span><span className="cf-val">{scout.sourceFocus}</span></div>
          ) : null}
          {scout.analysisInstructions ? (
            <div className="config-field"><span className="cf-key">analysisInstructions</span><span className="cf-val">{scout.analysisInstructions}</span></div>
          ) : null}
          {(scout.searchPlan || []).map((p, i) => (
            <div className="config-field" key={i} style={{ display: 'block', marginTop: i === 0 ? 8 : 12 }}>
              <div className="cf-key" style={{ marginBottom: 4 }}>{String(i + 1).padStart(2, '0')} · {p.label}</div>
              <div className="cf-val" style={{ display: 'block', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>{p.query}</div>
              <div className="cf-val" style={{ display: 'block', opacity: 0.7 }}>goal: {p.goal}</div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
};

const ChipsBlock = ({ label, items }) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className="config-section">
      <div className="config-section-label">{label} ({list.length})</div>
      {list.length ? (
        <div className="config-field"><span className="cf-val">{list.join(' · ')}</span></div>
      ) : (
        <div className="config-field"><span className="cf-val" style={{ opacity: 0.5 }}>(empty)</span></div>
      )}
    </div>
  );
};

const CapabilityBlock = ({ label, data, renderer }) => {
  if (!data) {
    return (
      <div className="config-section">
        <div className="config-section-label">{label}</div>
        <div className="config-field"><span className="cf-val" style={{ opacity: 0.5 }}>inactive for this client</span></div>
      </div>
    );
  }
  return (
    <div className="config-section">
      <div className="config-section-label">{label}</div>
      {renderer(data)}
    </div>
  );
};

const RunDetail = ({ run }) => {
  if (!run) return <div className="detail-loading">No run data.</div>;
  return (
    <div id="run-detail-panel">
      <div className="config-section">
        <div className="config-section-label">RUN INFO</div>
        <div className="config-field"><span className="cf-key">runId</span><span className="cf-val">{run.runId || run.id}</span></div>
        <div className="config-field"><span className="cf-key">clientId</span><span className="cf-val">{run.clientId}</span></div>
        <div className="config-field"><span className="cf-key">status</span><span className="cf-val">{run.status}</span></div>
        <div className="config-field"><span className="cf-key">attempts</span><span className="cf-val">{run.attempts}</span></div>
        <div className="config-field"><span className="cf-key">trigger</span><span className="cf-val">{run.trigger}</span></div>
        <div className="config-field"><span className="cf-key">createdAt</span><span className="cf-val">{run.createdAt || '—'}</span></div>
        <div className="config-field"><span className="cf-key">startedAt</span><span className="cf-val">{run.startedAt || '—'}</span></div>
        <div className="config-field"><span className="cf-key">completedAt</span><span className="cf-val">{run.completedAt || '—'}</span></div>
      </div>
      {run.error ? (
        <div className="config-section">
          <div className="config-section-label error-label">ERROR DETAIL (ADMIN ONLY)</div>
          <div className="config-field"><span className="cf-key">stage</span><span className="cf-val cf-err">{run.error.stage}</span></div>
          <div className="config-field"><span className="cf-key">message</span><span className="cf-val cf-err">{run.error.message}</span></div>
          <div className="config-field"><span className="cf-key">failedAt</span><span className="cf-val">{run.error.failedAt}</span></div>
          <div className="config-field"><span className="cf-key">exhausted</span><span className="cf-val">{String(run.error.exhausted)}</span></div>
        </div>
      ) : null}
      {run.workerLease ? (
        <div className="config-section">
          <div className="config-section-label">WORKER LEASE</div>
          <div className="config-field"><span className="cf-key">workerId</span><span className="cf-val">{run.workerLease.workerId}</span></div>
          <div className="config-field"><span className="cf-key">leasedAt</span><span className="cf-val">{run.workerLease.leasedAt}</span></div>
          <div className="config-field"><span className="cf-key">expiresAt</span><span className="cf-val">{run.workerLease.leaseExpiresAt}</span></div>
        </div>
      ) : null}
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toISOString().replace('T', ' ').slice(0, 16);
  } catch {
    return String(value);
  }
}

// ── CSS ────────────────────────────────────────────────────────────────────────

const adminCss = `
  [data-admin-theme="dark"] {
    --page: #000;
    --surface: #0a0a0a;
    --surface-raised: #111;
    --border: #1e1e1e;
    --border-visible: #2e2e2e;
    --text-disabled: #444;
    --text-secondary: #666;
    --text-primary: #aaa;
    --text-display: #e8e8e8;
    --accent: #D71921;
    --success: #4A9E5C;
    --warning: #D4A843;
    --font-mono: "Space Mono", monospace;
    --font-ui: "Space Grotesk", system-ui, sans-serif;
    background: var(--page);
    color: var(--text-primary);
    min-height: 100dvh;
    font-family: var(--font-ui);
    font-size: 13px;
  }
  [data-admin-theme="dark"] * { box-sizing: border-box; }
  #admin-shell { min-height: 100dvh; }
  #admin-header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 18px 40px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    flex-wrap: wrap;
  }
  #admin-brand {
    color: var(--text-display);
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  #admin-brand .mark {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--accent);
    position: relative;
    flex-shrink: 0;
  }
  #admin-brand .mark::after {
    content: "";
    position: absolute;
    inset: 2px;
    background: var(--accent);
  }
  #admin-nav {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  .admin-tab {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 7px 18px;
    color: var(--text-secondary);
    border: 1px solid transparent;
    cursor: pointer;
    background: none;
  }
  .admin-tab.is-active {
    color: var(--text-display);
    border-color: var(--border-visible);
    background: var(--surface-raised);
  }
  .admin-tab:hover:not(.is-active) { color: var(--text-primary); }
  #admin-meta {
    display: flex;
    align-items: center;
    gap: 20px;
    color: var(--text-disabled);
  }
  .meta-email { font-family: var(--font-mono); font-size: 10px; }
  .admin-signout {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .admin-signout:hover { color: var(--text-primary); }
  #admin-action-banner {
    padding: 10px 40px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .action-banner-pending { background: var(--surface-raised); color: var(--text-secondary); }
  .action-banner-ok { background: #0d1f12; color: var(--success); border-bottom: 1px solid #1a3522; }
  .action-banner-error { background: #1f0d0d; color: var(--accent); border-bottom: 1px solid #3d1414; }
  .banner-dismiss {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-disabled);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }
  #admin-content { padding: 40px; }
  .section-head {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 16px;
  }
  .section-title {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-display);
  }
  .section-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-disabled);
  }
  .admin-refresh {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    background: none;
    border: 1px solid var(--border-visible);
    padding: 5px 14px;
    cursor: pointer;
  }
  .admin-refresh:hover { color: var(--text-primary); border-color: var(--text-secondary); }
  .admin-loading, .admin-empty {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-disabled);
    padding: 24px 0;
  }
  .admin-error {
    padding: 12px 16px;
    background: #1f0d0d;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-bottom: 16px;
    border: 1px solid #3d1414;
  }
  .admin-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .admin-table th {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-disabled);
    text-align: left;
    padding: 0 12px 10px 0;
    border-bottom: 1px solid var(--border-visible);
    font-weight: 400;
  }
  .admin-table td {
    padding: 11px 12px 11px 0;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
    color: var(--text-primary);
  }
  .admin-table tr.is-expanded td { background: var(--surface); }
  .cell-primary { color: var(--text-display); font-size: 12px; }
  .cell-id { font-family: var(--font-mono); font-size: 11px; }
  .cell-id-sm { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
  .cell-sub { font-size: 10px; color: var(--text-disabled); margin-top: 3px; }
  .cell-dim { color: var(--text-disabled); font-size: 11px; }
  .cell-num { text-align: right; }
  .cell-mono { font-family: var(--font-mono); }
  .cell-warn { color: var(--warning); font-family: var(--font-mono); font-size: 11px; }
  .cell-actions { display: flex; gap: 8px; align-items: center; }
  .status-badge {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 3px 8px;
    border: 1px solid;
  }
  .status-active, .status-succeeded { color: var(--success); border-color: #1a3522; background: #0d1f12; }
  .status-provisioning, .status-queued { color: #7a8a9a; border-color: #252f38; background: #111a22; }
  .status-running { color: var(--warning); border-color: #3d320d; background: #1f1a0d; }
  .status-failed, .status-error { color: var(--accent); border-color: #3d1414; background: #1f0d0d; }
  .badge-exhausted {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.08em;
    color: var(--accent);
    border: 1px solid #3d1414;
    background: #1f0d0d;
    padding: 2px 7px;
  }
  .admin-action-btn {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 5px 12px;
    background: var(--surface-raised);
    border: 1px solid var(--border-visible);
    color: var(--text-display);
    cursor: pointer;
    white-space: nowrap;
  }
  .admin-action-btn:hover { border-color: var(--text-secondary); }
  .admin-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .admin-action-btn-secondary { color: var(--text-secondary); }
  .detail-row td { background: var(--surface) !important; border-bottom: 1px solid var(--border-visible) !important; }
  .detail-loading { padding: 16px; font-family: var(--font-mono); font-size: 11px; color: var(--text-disabled); }
  .detail-error { padding: 16px; font-family: var(--font-mono); font-size: 11px; color: var(--accent); }
  .detail-config { padding: 20px 0; }
  #config-view-panel, #run-detail-panel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
  }
  .config-section { display: flex; flex-direction: column; gap: 6px; }
  .config-section-label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-disabled);
    margin-bottom: 6px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 6px;
  }
  .error-label { color: var(--accent); }
  .config-field {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 8px;
    align-items: baseline;
    font-size: 11px;
  }
  .cf-key { font-family: var(--font-mono); color: var(--text-secondary); font-size: 10px; }
  .cf-val { color: var(--text-display); word-break: break-all; line-height: 1.4; }
  .cf-err { color: var(--accent); }
  /* ── Intelligence panel ────────────────────────────────────────────── */
  #intelligence-client-selector {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .intel-select {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--surface-raised);
    border: 1px solid var(--border-visible);
    color: var(--text-display);
    padding: 6px 12px;
    min-width: 320px;
    cursor: pointer;
  }
  .intel-label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-disabled);
    flex-shrink: 0;
  }
  .intel-identity-row {
    margin-bottom: 20px;
    padding: 16px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
  }
  .intel-identity-name {
    font-size: 15px;
    color: var(--text-display);
    margin-bottom: 6px;
  }
  .intel-identity-meta {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    font-size: 11px;
  }
  .intel-link {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    text-decoration: none;
  }
  .intel-link:hover { color: var(--text-primary); }
  .intel-injection-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
    padding: 12px 16px;
    border: 1px solid var(--border-visible);
  }
  .intel-section { margin-bottom: 32px; }
  .intel-section-label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-disabled);
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
  }
  .intel-ledger-grid {
    display: flex;
    gap: 32px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .intel-ledger-item { display: flex; flex-direction: column; gap: 4px; }
  .intel-ledger-value {
    font-family: var(--font-mono);
    font-size: 20px;
    color: var(--text-display);
  }
  .intel-ledger-key {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--text-disabled);
    text-transform: uppercase;
  }
  .intel-by-provider { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
  .intel-provider-row {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 8px;
    align-items: baseline;
    font-size: 11px;
  }
  .intel-briefing-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-disabled);
    margin-bottom: 8px;
  }
  .intel-briefing-text {
    width: 100%;
    min-height: 160px;
    max-height: 400px;
    background: var(--surface);
    border: 1px solid var(--border-visible);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 12px;
    resize: vertical;
    line-height: 1.6;
  }
  @media (max-width: 900px) {
    #admin-content { padding: 24px 20px; }
    #admin-header { padding: 16px 20px; }
    .admin-table th, .admin-table td { padding-right: 8px; font-size: 11px; }
    #config-view-panel, #run-detail-panel { grid-template-columns: 1fr; }
    .intel-select { min-width: 0; width: 100%; }
    .intel-ledger-grid { gap: 20px; }
  }
`;

export default AdminPage;
