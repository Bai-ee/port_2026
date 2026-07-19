'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Copy, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';

// X Command Center — Phase 0: connect the @bai_ee account over OAuth 2.0
// user-context (PKCE) and prove bookmark access with one gated test call.
// The OAuth 1.0a keys behind Copywriter/Schedule Posts cannot read bookmarks;
// this card owns the second auth path (features/social-posting/x-oauth.js).
// Spend rules: docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md — every
// credit-metered call here goes through an explicit confirm that names the
// call count, because X spend is invisible to the Operating Cost card.
//
// Styles are a scoped styled-jsx block (xp-*) mirroring CopywriterCard's
// white-theme values — its cw-* styles are component-scoped and unreachable.

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_TRIES = 30;

function formatWhen(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function XProfileCard({ getIdToken }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [adminBlocked, setAdminBlocked] = useState(false);
  const [confirmVerify, setConfirmVerify] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [copiedCallback, setCopiedCallback] = useState(false);

  const pollRef = useRef(null);

  const apiFetch = useCallback(async (body = null) => {
    const token = await getIdToken();
    const options = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }
      : { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' };
    const res = await fetch('/api/social-posting/x-oauth', options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }, [getIdToken]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch();
      setStatus(data);
      setAdminBlocked(false);
      return data;
    } catch (err) {
      if (err.status === 403) setAdminBlocked(true);
      else if (!silent) setNotice({ kind: 'error', text: err.message });
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadStatus();
    return stopPolling;
  }, [loadStatus, stopPolling]);

  // After Connect opens the X authorize tab, watch for the callback landing.
  const beginConnectPolling = useCallback(() => {
    stopPolling();
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      const data = await loadStatus({ silent: true });
      if (data?.connected || tries >= POLL_MAX_TRIES) {
        stopPolling();
        if (data?.connected) setNotice({ kind: 'ok', text: `Connected as @${data.username}.` });
      }
    }, POLL_INTERVAL_MS);
  }, [loadStatus, stopPolling]);

  async function connect() {
    if (busy) return;
    setBusy('connect');
    setNotice(null);
    try {
      const data = await apiFetch({ action: 'start' });
      window.open(data.url, '_blank', 'noopener');
      setNotice({ kind: 'ok', text: 'Authorize in the X tab that just opened — this card updates itself when the callback lands.' });
      beginConnectPolling();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy('disconnect');
    setNotice(null);
    try {
      await apiFetch({ action: 'disconnect' });
      setConfirmDisconnect(false);
      setVerifyResult(null);
      await loadStatus();
      setNotice({ kind: 'ok', text: 'Disconnected — stored tokens deleted and revoked.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function runVerify() {
    if (busy) return;
    setBusy('verify');
    setNotice(null);
    try {
      const data = await apiFetch({ action: 'verify-bookmarks' });
      setVerifyResult({ ok: true, ...data.result });
      setConfirmVerify(false);
    } catch (err) {
      setVerifyResult({ ok: false, message: err.message });
      setConfirmVerify(false);
    } finally {
      setBusy('');
    }
  }

  function copyCallbackUrl() {
    if (!status?.callbackUrl) return;
    navigator.clipboard?.writeText(status.callbackUrl).then(() => {
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 1600);
    });
  }

  const configReady = Boolean(status?.config?.hasClientId && status?.config?.hasClientSecret);
  const connected = Boolean(status?.connected);
  const spinner = <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" />;

  const styles = (
    <style jsx>{`
      /* Single-column vertical stack — white theme (dashboard modal style guide) */
      #x-profile-card { margin-top: 18px; display: grid; gap: 14px; }
      .xp-panel { border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.72); border-radius: 16px; padding: 16px; box-shadow: 0 1px 0 rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.4); backdrop-filter: blur(20px); }
      .xp-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
      .xp-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.62); }
      .xp-head small { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(42,36,32,0.5); }
      .xp-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; background: rgba(255,255,255,0.6); color: #2a2420; min-height: 38px; padding: 0 15px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); transition: background 160ms ease, box-shadow 160ms ease, border-color 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
      button:hover:not(:disabled) { background: rgba(255,255,255,0.95); border-color: rgba(42,36,32,0.2); box-shadow: 0 4px 14px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.5); transform: translateY(-1px); }
      button:active:not(:disabled) { transform: translateY(0); transition-duration: 80ms; }
      button:disabled { opacity: 0.48; cursor: not-allowed; }
      .xp-primary { background: #2a2420; color: #ffffff; border-color: #2a2420; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
      .xp-primary:hover:not(:disabled) { background: #3a332e; border-color: #3a332e; box-shadow: 0 4px 14px rgba(42,36,32,0.2), inset 0 1px 0 rgba(255,255,255,0.12); }
      .xp-notice, .xp-error { margin: 12px 0 0; font-size: 12px; line-height: 1.4; }
      .xp-notice-ok { color: #285f3b; }
      .xp-notice-error, .xp-error { color: #9f1f17; }
      .xp-muted { font-size: 12px; line-height: 1.4; color: rgba(42,36,32,0.6); }
      .xp-sub { margin: -4px 0 12px; font-size: 12px; line-height: 1.5; color: rgba(42,36,32,0.55); }
      .xp-sub strong { color: rgba(42,36,32,0.8); }
      .xp-empty { border: 1px dashed rgba(42,36,32,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 20px 16px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.55); }
      .xp-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .xp-chip { display: inline-flex; align-items: center; min-height: 28px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; padding: 0 12px; border-radius: 999px; background: rgba(42,36,32,0.06); border: 1px solid rgba(42,36,32,0.08); color: #3a332e; text-transform: capitalize; }
      .xp-chip-muted { background: rgba(255,255,255,0.5); border-color: rgba(42,36,32,0.14); color: rgba(42,36,32,0.6); text-transform: none; }
      .xp-recs { margin: 0; padding-left: 16px; display: grid; gap: 6px; }
      .xp-recs li { font-size: 12px; line-height: 1.45; color: rgba(42,36,32,0.72); }
      .xp-recs strong { color: #2a2420; }
      code { font-family: var(--font-mono); font-size: 11px; background: rgba(42,36,32,0.06); padding: 1px 5px; border-radius: 5px; color: #2a2420; }
    `}</style>
  );

  if (adminBlocked) {
    return (
      <div id="x-profile-card">
        <section id="x-profile-admin-gate-panel" className="xp-panel">
          <div className="xp-head"><span className="xp-kicker">X Command Center</span></div>
          <div className="xp-empty">Admin only — this card manages the live @bai_ee X account.</div>
        </section>
        {styles}
      </div>
    );
  }

  return (
    <div id="x-profile-card">
      {/* ── Connection ─────────────────────────────────────────────── */}
      <section id="x-profile-connection-panel" className="xp-panel">
        <div className="xp-head">
          <span className="xp-kicker"><Link2 size={13} /> Connection</span>
          <small>{connected ? 'OAUTH 2.0 · LIVE ACCOUNT' : 'OAUTH 2.0 · PKCE'}</small>
        </div>
        {loading ? (
          <div className="xp-empty">Checking connection…</div>
        ) : connected ? (
          <>
            <p className="xp-sub">
              Connected as <strong>@{status.username}</strong>
              {status.expiresAt ? <> · token refreshes automatically (current one expires {formatWhen(status.expiresAt)})</> : null}
            </p>
            <div className="xp-tags" style={{ marginBottom: 10 }}>
              {(status.scope || []).map((s) => <span key={s} className="xp-chip xp-chip-muted">{s}</span>)}
            </div>
            <div className="xp-actions">
              <button type="button" onClick={() => loadStatus()} disabled={!!busy}>
                <RefreshCw size={14} /> Refresh
              </button>
              {confirmDisconnect ? (
                <>
                  <button type="button" className="xp-primary" onClick={disconnect} disabled={!!busy}>
                    {busy === 'disconnect' ? spinner : <Unplug size={14} />} Confirm disconnect
                  </button>
                  <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={!!busy}>Cancel</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={!!busy}>
                  <Unplug size={14} /> Disconnect
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="xp-sub">
              Link the <strong>@bai_ee</strong> account with OAuth 2.0 user-context. Bookmarks (and later phases) need this —
              the existing OAuth 1.0a posting keys cannot reach them. Connecting is free; no credit-metered calls run without a confirm.
            </p>
            <div className="xp-actions">
              <button type="button" className="xp-primary" onClick={connect} disabled={!!busy || !configReady}>
                {busy === 'connect' ? spinner : <Link2 size={14} />} Connect X account
              </button>
              <button type="button" onClick={() => loadStatus()} disabled={!!busy}>
                <RefreshCw size={14} /> Refresh status
              </button>
            </div>
            {!configReady ? <p className="xp-error">Server is missing the OAuth 2.0 app credentials — finish the setup steps below first.</p> : null}
          </>
        )}
        {notice ? <p className={`xp-notice xp-notice-${notice.kind}`}>{notice.text}</p> : null}
      </section>

      {/* ── One-time app setup (shown until env creds exist) ───────── */}
      {!loading && !configReady ? (
        <section id="x-profile-setup-panel" className="xp-panel">
          <div className="xp-head"><span className="xp-kicker">One-time setup</span><small>DEVELOPER.X.COM</small></div>
          <ol className="xp-recs" style={{ listStyle: 'decimal', paddingLeft: 18 }}>
            <li>In the X developer console, open the HitLoop app → <strong>OAuth 2.0 Keys</strong> → Edit settings.</li>
            <li>Type <strong>Web App</strong> (confidential client); confirm the callback URL below is listed.</li>
            <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong>.</li>
          </ol>
          <div className="xp-actions" style={{ alignItems: 'center' }}>
            <code style={{ wordBreak: 'break-all', flex: 1 }}>{status?.callbackUrl || '…'}</code>
            <button type="button" onClick={copyCallbackUrl}>
              {copiedCallback ? <Check size={13} /> : <Copy size={13} />} {copiedCallback ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="xp-sub" style={{ marginTop: 8 }}>
            Put them into <code>.env.local</code> (and Vercel) as <code>X_OAUTH_CLIENT_ID</code> / <code>X_OAUTH_CLIENT_SECRET</code>,
            restart <code>npm run dev</code>, and hit Refresh status.
          </p>
        </section>
      ) : null}

      {/* ── Bookmark access proof (the Phase 0 exit test) ──────────── */}
      <section id="x-profile-bookmark-verify-panel" className="xp-panel">
        <div className="xp-head">
          <span className="xp-kicker"><Bookmark size={13} /> Bookmark access</span>
          <small>SPEND-GATED</small>
        </div>
        <p className="xp-sub">
          Confirms the connected token + plan tier can actually read your bookmarks before Phase 1 builds on them.
        </p>
        {confirmVerify ? (
          <>
            <p className="xp-error" style={{ marginBottom: 8 }}>
              This makes 1–2 credit-metered X API calls (bookmarks lookup, possibly a /users/me resolve). Spend is real,
              irreversible, and does <strong>not</strong> appear in the Operating Cost card.
            </p>
            <div className="xp-actions">
              <button type="button" className="xp-primary" onClick={runVerify} disabled={!!busy}>
                {busy === 'verify' ? spinner : <ShieldCheck size={14} />} Yes — run the test call
              </button>
              <button type="button" onClick={() => setConfirmVerify(false)} disabled={!!busy}>Cancel</button>
            </div>
          </>
        ) : (
          <div className="xp-actions">
            <button type="button" onClick={() => setConfirmVerify(true)} disabled={!!busy || !connected}>
              <ShieldCheck size={14} /> Verify bookmark access
            </button>
          </div>
        )}
        {!connected && !loading ? <p className="xp-muted">Connect the account first.</p> : null}
        {verifyResult ? (
          verifyResult.ok ? (
            <p className="xp-notice xp-notice-ok">
              Bookmarks reachable as @{verifyResult.username} — API returned {verifyResult.resultCount} item{verifyResult.resultCount === 1 ? '' : 's'}.
              {verifyResult.sample ? <> Latest: “{verifyResult.sample.text}”</> : null} Phase 1 is unblocked.
            </p>
          ) : (
            <p className="xp-notice xp-notice-error">{verifyResult.message}</p>
          )
        ) : null}
      </section>

      {/* ── Roadmap ────────────────────────────────────────────────── */}
      <section id="x-profile-roadmap-panel" className="xp-panel">
        <div className="xp-head"><span className="xp-kicker">Coming next</span><small>PHASES</small></div>
        <ul className="xp-recs">
          <li><strong>Bookmarks → content.</strong> Fetch + cache bookmarks, pick one, generate scored drafts into the shared queue.</li>
          <li><strong>Profile panel.</strong> Live profile snapshot; bio/name edits drafted here, applied deliberately.</li>
          <li><strong>Engagement.</strong> Like, repost, reply, delete, pin — each behind its own confirm.</li>
          <li><strong>Audience ops.</strong> The unfollow backlog (185 pending) surfaced with capped, approved batches.</li>
        </ul>
      </section>

      {styles}
    </div>
  );
}
