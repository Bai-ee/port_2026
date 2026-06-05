'use client';

// AdminEmailModals.jsx — admin-only modal content for the dashboard "Admin"
// bucket. Two views rendered inside the standard tile-detail modal:
//   • AdminEmailDigestView   — view the digest email (content + analytics) + send
//   • AdminEmailSettingsView — enable / format / customize the digest summary
// Logic and state live here to keep DashboardPage.jsx lean. Styling reuses the
// dashboard's established modal classes (tile-detail-*, mb-config-*).

import React, { useCallback, useEffect, useState } from 'react';

async function authFetch(user, path, options = {}) {
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

// ── Email Digest: view the rendered email + analytics, send on demand ─────────
export function AdminEmailDigestView({ user }) {
  const [tab, setTab] = useState('email');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { html, paragraph }
  const [status, setStatus] = useState(null);    // { kind, msg }

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const data = await authFetch(user, '/api/admin/daily-digest?preview=1');
      setPreview({ html: data.html || '', paragraph: data.paragraph || data.summary?.paragraph || '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const send = useCallback(async () => {
    if (!user) return;
    if (typeof window !== 'undefined' && !window.confirm('Send the digest email now?')) return;
    setStatus({ kind: 'pending', msg: 'Sending…' });
    try {
      await authFetch(user, '/api/admin/daily-digest?send=1');
      setStatus({ kind: 'ok', msg: 'Sent.' });
    } catch (e) {
      setStatus({ kind: 'error', msg: e.message });
    }
  }, [user]);

  return (
    <div className="tile-detail-bento-cell tile-detail-tabbed-container">
      <div className="tile-detail-tabs">
        <button type="button" className={`tile-detail-tab${tab === 'email' ? ' tile-detail-tab--active' : ''}`} onClick={() => setTab('email')}>EMAIL</button>
        <button type="button" className={`tile-detail-tab${tab === 'summary' ? ' tile-detail-tab--active' : ''}`} onClick={() => setTab('summary')}>SUMMARY</button>
      </div>
      <div className="tile-detail-tab-content">
        {loading ? (
          <div style={emptyWrap}><span style={emptyLabel}>Loading preview…</span></div>
        ) : error ? (
          <div style={emptyWrap}><span style={emptyLabel}>Preview failed</span><span style={emptyBody}>{error}</span></div>
        ) : tab === 'email' ? (
          <div className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
            {preview?.html ? (
              <iframe
                title="Daily digest email"
                srcDoc={preview.html}
                style={{ width: '100%', height: '100%', minHeight: 620, border: '1px solid rgba(42,36,32,0.08)', borderRadius: 8, background: '#fff' }}
              />
            ) : (
              <div style={emptyWrap}><span style={emptyLabel}>No email content</span></div>
            )}
          </div>
        ) : (
          <div className="tile-detail-tab-pane" style={{ padding: 18 }}>
            <p style={{ fontSize: 14, lineHeight: 1.62, color: 'var(--text-display)', margin: 0 }}>
              {preview?.paragraph || 'No summary text — the LLM summary may be disabled in Email Settings.'}
            </p>
          </div>
        )}
      </div>
      <div className="mb-config-actionbar">
        <span className="mb-config-actionbar-note">
          {status ? (status.kind === 'error' ? `Error: ${status.msg}` : status.msg) : 'Preview is generated live; Send delivers to the configured recipient.'}
        </span>
        <div className="mb-config-actionbar-buttons">
          <button type="button" className="mb-config-mini-btn" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button type="button" className="tile-foot-rerun-btn" onClick={send} disabled={status?.kind === 'pending'}>Send Now</button>
        </div>
      </div>
    </div>
  );
}

// ── Email Settings: enable / format / customize the LLM summary ───────────────
export function AdminEmailSettingsView({ user }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [docs, setDocs] = useState([]);
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const data = await authFetch(user, '/api/admin/digest-config');
      setForm(data.config || null);
      setDocs(data.docs || []);
      setClientId(data.clientId || '');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (!user || !form) return;
    setStatus({ kind: 'pending', msg: 'Saving…' });
    try {
      const data = await authFetch(user, '/api/admin/digest-config', { method: 'POST', body: JSON.stringify(form) });
      setForm(data.config);
      setStatus({ kind: 'ok', msg: 'Saved.' });
    } catch (e) {
      setStatus({ kind: 'error', msg: e.message });
    }
  }, [user, form]);

  if (loading) {
    return <div className="tile-detail-bento-cell" style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Loading settings…</span></div>;
  }
  if (error) {
    return <div className="tile-detail-bento-cell" style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Settings failed</span><span style={emptyBody}>{error}</span></div>;
  }
  if (!form) {
    return <div className="tile-detail-bento-cell" style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>No config</span></div>;
  }

  return (
    <div className="tile-detail-bento-cell tile-detail-tabbed-container">
      <div className="tile-detail-tab-content">
        <div className="tile-detail-tab-pane custom-brief-submit-pane">
          <section className="mb-config-section">
            <div className="mb-config-section-head">
              <span className="mb-config-section-index">01</span>
              <div>
                <h4>Summary generation</h4>
                <p>The LLM writes the opening paragraph from your calendar, analytics, and recent uploads.</p>
              </div>
              <span className="mb-config-section-status">{clientId || 'no client'}</span>
            </div>
            <div className="custom-brief-submit-grid">
              <label className="mb-config-field">
                <span className="mb-config-label">LLM summary</span>
                <select className="mb-config-input" value={form.summaryEnabled ? 'on' : 'off'} onChange={(e) => setForm((f) => ({ ...f, summaryEnabled: e.target.value === 'on' }))}>
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </label>
              <label className="mb-config-field">
                <span className="mb-config-label">Recent docs fed</span>
                <input type="number" min="1" max="20" className="mb-config-input" value={form.recentDocsCount} onChange={(e) => setForm((f) => ({ ...f, recentDocsCount: Number(e.target.value) }))} />
              </label>
            </div>
            <label className="mb-config-field">
              <span className="mb-config-label">Tone</span>
              <input className="mb-config-input" value={form.tone || ''} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))} />
            </label>
            <label className="mb-config-field">
              <span className="mb-config-label">Extra instructions</span>
              <textarea className="mb-config-textarea" rows={4} placeholder="Optional steering (e.g. flag overdue tasks, highlight revenue)…" value={form.extraInstructions || ''} onChange={(e) => setForm((f) => ({ ...f, extraInstructions: e.target.value }))} />
            </label>
          </section>

          <section className="mb-config-section">
            <div className="mb-config-section-head">
              <span className="mb-config-section-index">02</span>
              <div>
                <h4>Documents feeding the summary</h4>
                <p>The most recent uploads from this client's Company Brain.</p>
              </div>
              <span className="mb-config-section-status">{docs.length} doc{docs.length === 1 ? '' : 's'}</span>
            </div>
            {docs.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {docs.map((d) => (
                  <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--text-display)', borderBottom: '1px dashed rgba(42,36,32,0.12)', padding: '6px 0' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{d.chars}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tile-analyzer-solutions-empty">No knowledge-base docs found for this client.</p>
            )}
          </section>

          {status?.kind === 'error' && <p className="mb-config-error">{status.msg}</p>}
          <div className="mb-config-actionbar">
            <span className="mb-config-actionbar-note">
              {status && status.kind !== 'error' ? status.msg : 'Saved settings apply to the next digest and live previews.'}
            </span>
            <div className="mb-config-actionbar-buttons">
              <button type="button" className="tile-foot-rerun-btn" onClick={save} disabled={status?.kind === 'pending'}>{status?.kind === 'pending' ? 'Saving…' : 'Save Config'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const emptyWrap = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, gap: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: 40 };
const emptyLabel = { fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 };
const emptyBody = { fontSize: 13, lineHeight: 1.6, maxWidth: 360 };
