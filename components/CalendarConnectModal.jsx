'use client';

// CalendarConnectModal.jsx — Knowledge Officer "Google Calendar" card body.
// Per-client, one-click Google Calendar connection (OAuth). Connecting lets the
// daily digest's "Today's Agenda" read this client's calendar. Styling reuses the
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

// Map the ?calendar=... redirect param (set by the OAuth callback) to a message.
function redirectNote() {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('calendar');
  if (!v) return null;
  if (v === 'connected') return { kind: 'ok', msg: 'Calendar connected.' };
  if (v === 'denied') return { kind: 'error', msg: 'Connection cancelled — access was not granted.' };
  if (v === 'unconfigured') return { kind: 'error', msg: 'Calendar OAuth is not configured on the server.' };
  return { kind: 'error', msg: 'Connection failed — please try again.' };
}

export function CalendarConnectView({ user }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [state, setState] = useState(null); // { configured, connected, email, calendarId }
  const [status, setStatus] = useState(redirectNote);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const data = await authFetch(user, '/api/dashboard/calendar/status');
      setState(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const connect = useCallback(async () => {
    if (!user) return;
    setStatus({ kind: 'pending', msg: 'Opening Google…' });
    try {
      const data = await authFetch(user, '/api/dashboard/calendar/connect', { method: 'POST', body: '{}' });
      if (data?.url && typeof window !== 'undefined') {
        window.location.href = data.url; // full-page redirect to Google consent
      } else {
        setStatus({ kind: 'error', msg: 'No authorization URL returned.' });
      }
    } catch (e) {
      setStatus({ kind: 'error', msg: e.message });
    }
  }, [user]);

  const disconnect = useCallback(async () => {
    if (!user) return;
    if (typeof window !== 'undefined' && !window.confirm('Disconnect this Google Calendar? The digest agenda will stop reading it.')) return;
    setStatus({ kind: 'pending', msg: 'Disconnecting…' });
    try {
      await authFetch(user, '/api/dashboard/calendar/disconnect', { method: 'POST', body: '{}' });
      setStatus({ kind: 'ok', msg: 'Disconnected.' });
      await load();
    } catch (e) {
      setStatus({ kind: 'error', msg: e.message });
    }
  }, [user, load]);

  if (loading) {
    return <div className="tile-detail-bento-cell" style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Checking connection…</span></div>;
  }
  if (error) {
    return <div className="tile-detail-bento-cell" style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Status failed</span><span style={emptyBody}>{error}</span></div>;
  }

  const configured = Boolean(state?.configured);
  const connected = Boolean(state?.connected);

  return (
    <div className="tile-detail-bento-cell tile-detail-tabbed-container">
      <div className="tile-detail-tab-content">
        <div className="tile-detail-tab-pane custom-brief-submit-pane">
          <section className="mb-config-section">
            <div className="mb-config-section-head">
              <span className="mb-config-section-index">01</span>
              <div>
                <h4>Google Calendar</h4>
                <p>Connect your Google Calendar so the daily digest can show your agenda under the executive summary. Read-only — we never edit or create events. Toggle the agenda on/off any time in the Market Signals card.</p>
              </div>
              <span className="mb-config-section-status">{connected ? 'Connected' : configured ? 'Not connected' : 'Unavailable'}</span>
            </div>

            {!configured ? (
              <div className="mb-config-field">
                <span className="mb-config-label">Server setup required</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Google Calendar OAuth isn&apos;t configured on the server yet. An admin needs to add the OAuth client credentials (GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI) before calendars can be connected.
                </span>
              </div>
            ) : connected ? (
              <div className="mb-config-field">
                <span className="mb-config-label">Connected account</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-display)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--success, #4A9E5C)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state?.email || 'Google account'}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>Calendar: {state?.calendarId || 'primary'}. The digest reads up to 5 days ahead.</span>
              </div>
            ) : (
              <div className="mb-config-field">
                <span className="mb-config-label">Not connected</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Click Connect to authorize read-only access to your Google Calendar. You&apos;ll be sent to Google&apos;s consent screen and returned here.
                </span>
              </div>
            )}
          </section>

          <div className="mb-config-actionbar">
            <span className="mb-config-actionbar-note">
              {status
                ? (status.kind === 'error' ? `Error: ${status.msg}` : status.msg)
                : connected ? 'Connected — the digest agenda uses this calendar.' : 'Read-only access. You can disconnect any time.'}
            </span>
            <div className="mb-config-actionbar-buttons">
              {connected ? (
                <button type="button" className="mb-config-mini-btn" onClick={disconnect} disabled={status?.kind === 'pending'}>Disconnect</button>
              ) : (
                <button type="button" className="tile-foot-rerun-btn" onClick={connect} disabled={!configured || status?.kind === 'pending'}>Connect Google Calendar</button>
              )}
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
