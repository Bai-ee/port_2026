'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../AuthContext';

// OAuth consent screen for MCP connectors (ChatGPT, Claude). The connector sends the owner here with the standard
// authorize parameters; the owner signs in with the existing Firebase login (admin accounts only), then Allows or
// Denies. Allow asks /api/oauth/authorize (which re-checks admin server-side) for a single-use code and redirects.
// Presentation only: all validation and the code issue happen on the server.
// A client connect link (resource = /api/client-mcp/c/...) needs no sign-in: the link is the credential, and the
// connection is read-only for that one client (features/client-mcp).

const PARAM_KEYS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

const shell = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0b0b0c', color: '#f2f2f0', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' };
const card = { width: '100%', maxWidth: 440, background: '#161618', border: '1px solid #2a2a2e', borderRadius: 14, padding: 24, boxSizing: 'border-box' };
const btn = (primary) => ({ flex: 1, padding: '12px 16px', borderRadius: 10, border: primary ? 'none' : '1px solid #3a3a40', background: primary ? '#f2f2f0' : 'transparent', color: primary ? '#0b0b0c' : '#f2f2f0', fontSize: 15, fontWeight: 600, cursor: 'pointer' });

function AuthorizeInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading } = useAuth();
  const [check, setCheck] = useState({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(() => Object.fromEntries(PARAM_KEYS.map((k) => [k, search.get(k) || undefined])), [search]);
  const queryString = search.toString();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/oauth/authorize?${queryString}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.ok) setCheck({ state: 'ready', clientName: data.clientName, redirectHost: data.redirectHost, kind: data.kind || 'owner', clientLabel: data.clientLabel || '' });
        else setCheck({ state: 'invalid', message: data.error_description || data.error || 'This authorization request is not valid.' });
      } catch {
        if (!cancelled) setCheck({ state: 'invalid', message: 'Could not reach HITLOOP. Try again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [queryString]);

  useEffect(() => {
    if (check.state === 'ready' && check.kind !== 'client' && !loading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(`/oauth/authorize?${queryString}`)}`);
    }
  }, [check.state, loading, user, router, queryString]);

  const allow = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const headers = { 'content-type': 'application/json' };
      if (check.kind !== 'client') headers.authorization = `Bearer ${await user.getIdToken()}`;
      const res = await fetch('/api/oauth/authorize', { method: 'POST', headers, body: JSON.stringify(params) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirectUrl) throw new Error(data.error_description || data.error || 'Authorization failed.');
      window.location.assign(data.redirectUrl);
    } catch (e) {
      setError(e.message || 'Authorization failed.');
      setBusy(false);
    }
  }, [user, params, check.kind]);

  const deny = useCallback(() => {
    const u = new URL(params.redirect_uri);
    u.searchParams.set('error', 'access_denied');
    if (params.state) u.searchParams.set('state', params.state);
    window.location.assign(u.toString());
  }, [params]);

  let body;
  if (check.state === 'loading' || (check.state === 'ready' && check.kind !== 'client' && (loading || !user))) {
    body = <p id="oauth-authorize-status-message" style={{ margin: 0, color: '#a0a0a6' }}>Checking the request...</p>;
  } else if (check.state === 'invalid') {
    body = (
      <>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Cannot connect</h1>
        <p id="oauth-authorize-error-message" style={{ margin: 0, color: '#d98c8c' }}>{check.message}</p>
      </>
    );
  } else if (check.kind === 'client') {
    body = (
      <>
        <h1 id="oauth-authorize-client-heading" style={{ fontSize: 20, margin: '0 0 8px' }}>Connect {check.clientName} to {check.clientLabel} data?</h1>
        <p id="oauth-authorize-client-redirect-host-panel" style={{ margin: '0 0 16px', padding: '10px 12px', background: '#0b0b0c', border: '1px solid #3a3a40', borderRadius: 10, color: '#a0a0a6', lineHeight: 1.5, wordBreak: 'break-all' }}>
          You will be sent back to
          <strong id="oauth-authorize-client-redirect-host" style={{ display: 'block', color: '#f2f2f0', fontSize: 17 }}>{check.redirectHost}</strong>
          Only continue if you recognise this address.
        </p>
        <ul id="oauth-authorize-client-permissions-list" style={{ margin: '0 0 20px', paddingLeft: 20, lineHeight: 1.6 }}>
          <li>read {check.clientLabel}&apos;s website stats, marketing reports, brand brain, content calendar and post results</li>
        </ul>
        <p style={{ margin: '0 0 20px', color: '#a0a0a6', fontSize: 13 }}>Read-only. It cannot post, schedule, approve or change anything, and it sees no other client&apos;s data.</p>
        {error ? <p id="oauth-authorize-client-action-error" style={{ margin: '0 0 12px', color: '#d98c8c' }}>{error}</p> : null}
        <div id="oauth-authorize-client-actions-row" style={{ display: 'flex', gap: 12 }}>
          <button id="oauth-authorize-client-deny-button" type="button" style={btn(false)} onClick={deny} disabled={busy}>Deny</button>
          <button id="oauth-authorize-client-allow-button" type="button" style={btn(true)} onClick={allow} disabled={busy}>{busy ? 'Connecting...' : 'Allow'}</button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h1 id="oauth-authorize-heading" style={{ fontSize: 20, margin: '0 0 8px' }}>Allow {check.clientName} to access HITLOOP?</h1>
        <p id="oauth-authorize-redirect-host-panel" style={{ margin: '0 0 16px', padding: '10px 12px', background: '#0b0b0c', border: '1px solid #3a3a40', borderRadius: 10, color: '#a0a0a6', lineHeight: 1.5, wordBreak: 'break-all' }}>
          You will be sent back to
          <strong id="oauth-authorize-redirect-host" style={{ display: 'block', color: '#f2f2f0', fontSize: 17 }}>{check.redirectHost}</strong>
          Only continue if you recognise this address.
        </p>
        <p style={{ margin: '0 0 16px', color: '#a0a0a6', lineHeight: 1.5 }}>
          <strong style={{ color: '#f2f2f0' }}>{check.clientName}</strong> will be able to:
        </p>
        <ul id="oauth-authorize-permissions-list" style={{ margin: '0 0 20px', paddingLeft: 20, lineHeight: 1.6 }}>
          <li>read all client-admin data (database records, strategy, posts, costs)</li>
          <li>request syncs (paid ones become a card you must confirm in HITLOOP)</li>
          <li>propose changes (nothing applies until you confirm it in HITLOOP)</li>
        </ul>
        <p style={{ margin: '0 0 20px', color: '#a0a0a6', fontSize: 13 }}>It cannot post, schedule, approve, delete or send anything. Signed in as {user?.email}.</p>
        {error ? <p id="oauth-authorize-action-error" style={{ margin: '0 0 12px', color: '#d98c8c' }}>{error}</p> : null}
        <div id="oauth-authorize-actions-row" style={{ display: 'flex', gap: 12 }}>
          <button id="oauth-authorize-deny-button" type="button" style={btn(false)} onClick={deny} disabled={busy}>Deny</button>
          <button id="oauth-authorize-allow-button" type="button" style={btn(true)} onClick={allow} disabled={busy}>{busy ? 'Allowing...' : 'Allow'}</button>
        </div>
      </>
    );
  }

  return (
    <main id="oauth-authorize-shell" style={shell}>
      <section id="oauth-authorize-card" style={card}>{body}</section>
    </main>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <AuthorizeInner />
    </Suspense>
  );
}
