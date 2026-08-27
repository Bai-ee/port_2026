'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Admin · Dashboard Failures — Phase 6 of docs/plans/
// DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md. Lists every OPEN
// dashboard-creation-failure incident (GET /api/admin/dashboard-failures)
// with the safe incident fields AND the full admin-only diagnostic
// (brief_runs.error, never sent to the client), plus two actions:
//   - Requeue & run: POSTs {action:'requeue'}, then fires a client-side
//     POST to /api/worker/run-brief — mirrors AdminPage.jsx's existing
//     handleRunNow so the client's terminal starts running promptly rather
//     than waiting on the cron backstop.
//   - Resolve without retry: POSTs {action:'resolve'} with an optional note.
// Either action clears the client's gate; the list re-fetches afterward so
// a resolved incident disappears from view immediately.

async function authFetch(user, path, options = {}) {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function triggerWorkerRun(user, runId) {
  // Fire-and-forget, client-side (browser → relative path on the same
  // already-authenticated admin session) — deliberately NOT a server-side
  // self-fetch, which would need the digest-self-origin.cjs SSO-bypass
  // treatment for this project's Vercel Deployment Protection.
  user.getIdToken().then((token) => {
    fetch('/api/worker/run-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId }),
    }).catch(() => {});
  }).catch(() => {});
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');

const NOTIFICATION_LABEL = {
  sent: 'Bryan notified',
  failed: 'Notify failed — recorded only',
  not_configured: 'Notify not configured — recorded only',
};

const DFI_CSS = `
#dashboard-failures-view-shell { color: #2a2420; }
#dashboard-failures-view-shell .dfi-empty { padding: 14px; border: 1px solid rgba(42,36,32,0.12); border-radius: 8px; background: rgba(255,255,255,0.5); font: 600 12px/1.5 "Space Mono", ui-monospace, monospace; color: rgba(42,36,32,0.6); }
#dashboard-failures-view-shell .dfi-err { padding: 10px 12px; border: 1px solid #9f1f17; border-radius: 8px; background: rgba(159,31,23,0.06); color: #9f1f17; font-size: 12px; }
#dashboard-failures-view-shell details.dfi-card { border: 1px solid rgba(42,36,32,0.12); border-radius: 8px; background: rgba(255,255,255,0.78); overflow: hidden; }
#dashboard-failures-view-shell details.dfi-card + details.dfi-card { margin-top: 8px; }
#dashboard-failures-view-shell .dfi-card > summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; }
#dashboard-failures-view-shell .dfi-card > summary::-webkit-details-marker { display: none; }
#dashboard-failures-view-shell .dfi-card[open] > summary { border-bottom: 1px solid rgba(42,36,32,0.14); background: rgba(255,255,255,0.4); }
#dashboard-failures-view-shell .dfi-client-name { font: 700 14px/1.3 "Space Grotesk", system-ui, sans-serif; display: flex; align-items: center; gap: 8px; min-width: 0; }
#dashboard-failures-view-shell .dfi-client-name::before { content: "▸"; color: rgba(42,36,32,0.52); font-size: 10px; transition: transform 160ms ease; }
#dashboard-failures-view-shell .dfi-card[open] > summary .dfi-client-name::before { transform: rotate(90deg); }
#dashboard-failures-view-shell .dfi-meta { font: 600 11px/1.4 "Space Mono", ui-monospace, monospace; color: rgba(42,36,32,0.52); }
#dashboard-failures-view-shell .dfi-body { padding: 12px 14px 14px; display: grid; gap: 10px; }
#dashboard-failures-view-shell .dfi-row { display: flex; gap: 8px; font-size: 12px; }
#dashboard-failures-view-shell .dfi-row-label { color: rgba(42,36,32,0.52); min-width: 110px; font-family: "Space Mono", ui-monospace, monospace; }
#dashboard-failures-view-shell .dfi-diag { font-family: "Space Mono", ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word; padding: 8px 10px; border: 1px solid rgba(159,31,23,0.25); border-radius: 6px; background: rgba(159,31,23,0.05); color: #6b1610; }
#dashboard-failures-view-shell .dfi-actions { display: flex; gap: 8px; flex-wrap: wrap; }
#dashboard-failures-view-shell .dfi-btn { padding: 8px 13px; border: 1px solid rgba(42,36,32,0.12); border-radius: 8px; background: rgba(255,255,255,0.6); color: #2a2420; font: 700 12px/1 "Space Mono", ui-monospace, monospace; cursor: pointer; }
#dashboard-failures-view-shell .dfi-btn:hover:not(:disabled) { background: #fff; }
#dashboard-failures-view-shell .dfi-btn:disabled { opacity: 0.5; cursor: not-allowed; }
#dashboard-failures-view-shell .dfi-note-input { width: 100%; min-height: 60px; padding: 8px; border: 1px solid rgba(42,36,32,0.15); border-radius: 6px; font: 500 12px/1.4 "Space Mono", ui-monospace, monospace; box-sizing: border-box; }
#dashboard-failures-view-shell .dfi-status { font-size: 11px; font-weight: 700; }
#dashboard-failures-view-shell .dfi-status.is-ok { color: #285f3b; }
#dashboard-failures-view-shell .dfi-status.is-error { color: #9f1f17; }
`;

function IncidentCard({ incident, onRequeue, onResolve, actionStatus }) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');

  const status = actionStatus?.incidentId === incident.incidentId ? actionStatus : null;
  const busy = status?.status === 'pending';

  return (
    <details className="dfi-card" id={`dashboard-failures-incident-${incident.incidentId}`}>
      <summary>
        <span className="dfi-client-name">{incident.companyName || incident.clientId}</span>
        <span className="dfi-meta">{incident.publicCode} · {incident.publicStage} · {fmtDate(incident.failedAt)}</span>
      </summary>
      <div className="dfi-body">
        <div className="dfi-row"><span className="dfi-row-label">Client ID</span><span>{incident.clientId}</span></div>
        <div className="dfi-row"><span className="dfi-row-label">Website</span><span>{incident.websiteUrl || '(none submitted)'}</span></div>
        <div className="dfi-row"><span className="dfi-row-label">Owner email</span><span>{incident.ownerEmail || '(none on file)'}</span></div>
        <div className="dfi-row"><span className="dfi-row-label">Run ID</span><span>{incident.runId}</span></div>
        <div className="dfi-row"><span className="dfi-row-label">Client sees</span><span>{incident.publicMessage}</span></div>
        <div className="dfi-row"><span className="dfi-row-label">Notification</span><span>{NOTIFICATION_LABEL[incident.notification?.status] || 'Unknown'}</span></div>
        <div className="dfi-row"><span className="dfi-row-label">Attempts</span><span>{incident.attempts ?? '—'}</span></div>
        <div>
          <div className="dfi-row-label" style={{ marginBottom: 4 }}>Admin diagnostic (never shown to the client)</div>
          <div className="dfi-diag">
            {incident.internalError
              ? `${incident.internalError.stage || 'unknown'}: ${incident.internalError.message || '(no message)'}`
              : 'No brief_runs.error on record.'}
          </div>
        </div>

        {resolving ? (
          <div>
            <textarea
              className="dfi-note-input"
              id={`dashboard-failures-note-${incident.incidentId}`}
              placeholder="Optional note for the audit record (e.g. why no retry)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="dfi-actions" style={{ marginTop: 8 }}>
              <button type="button" className="dfi-btn" disabled={busy} onClick={() => onResolve(incident, note)}>
                {busy && status?.action === 'resolve' ? 'Resolving…' : 'Confirm resolve'}
              </button>
              <button type="button" className="dfi-btn" disabled={busy} onClick={() => setResolving(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="dfi-actions">
            <button type="button" className="dfi-btn" disabled={busy} onClick={() => onRequeue(incident)}>
              {busy && status?.action === 'requeue' ? 'Requeuing…' : 'Requeue & run'}
            </button>
            <button type="button" className="dfi-btn" disabled={busy} onClick={() => setResolving(true)}>Resolve without retry</button>
          </div>
        )}

        {status && status.status !== 'pending' ? (
          <span className={`dfi-status ${status.status === 'ok' ? 'is-ok' : 'is-error'}`}>{status.message}</span>
        ) : null}
      </div>
    </details>
  );
}

export default function AdminDashboardFailuresView({ user }) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionStatus, setActionStatus] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const data = await authFetch(user, '/api/admin/dashboard-failures');
      setIncidents(data.incidents || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleRequeue = async (incident) => {
    setActionStatus({ incidentId: incident.incidentId, action: 'requeue', status: 'pending', message: '' });
    try {
      await authFetch(user, '/api/admin/dashboard-failures', {
        method: 'POST',
        body: JSON.stringify({ action: 'requeue', clientId: incident.clientId, runId: incident.runId }),
      });
      triggerWorkerRun(user, incident.runId);
      setActionStatus({ incidentId: incident.incidentId, action: 'requeue', status: 'ok', message: 'Requeued — worker triggered.' });
      load();
    } catch (err) {
      setActionStatus({ incidentId: incident.incidentId, action: 'requeue', status: 'error', message: err.message });
    }
  };

  const handleResolve = async (incident, note) => {
    setActionStatus({ incidentId: incident.incidentId, action: 'resolve', status: 'pending', message: '' });
    try {
      await authFetch(user, '/api/admin/dashboard-failures', {
        method: 'POST',
        body: JSON.stringify({ action: 'resolve', clientId: incident.clientId, incidentId: incident.incidentId, note: note || null }),
      });
      setActionStatus({ incidentId: incident.incidentId, action: 'resolve', status: 'ok', message: 'Resolved.' });
      load();
    } catch (err) {
      setActionStatus({ incidentId: incident.incidentId, action: 'resolve', status: 'error', message: err.message });
    }
  };

  return (
    <div id="dashboard-failures-view-shell">
      <style>{DFI_CSS}</style>
      {error ? <div className="dfi-err">{error}</div> : null}
      {!error && loading && incidents.length === 0 ? <div className="dfi-empty">Loading…</div> : null}
      {!error && !loading && incidents.length === 0 ? <div className="dfi-empty">No open incidents.</div> : null}
      {incidents.map((incident) => (
        <IncidentCard
          key={incident.incidentId || incident.clientId}
          incident={incident}
          onRequeue={handleRequeue}
          onResolve={handleResolve}
          actionStatus={actionStatus}
        />
      ))}
    </div>
  );
}
