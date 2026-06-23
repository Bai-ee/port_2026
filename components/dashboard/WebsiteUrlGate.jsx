'use client';

import { useCallback, useState } from 'react';

// Shown when a signed-in user has no assigned dashboard. Collects a website URL
// and provisions their client (which queues the first Creative Brief) BEFORE the
// dashboard is processed. URL is required.
export default function WebsiteUrlGate({ user, onProvisioned, initialUrl = '' }) {
  const [url, setUrl] = useState(initialUrl || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async (e) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = url.trim();
    if (!trimmed || !/\.[a-z]{2,}/i.test(trimmed)) {
      setError('Enter a valid website URL (e.g. yoursite.com).');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/clients/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ websiteUrl: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not set up your dashboard.');
      }
      onProvisioned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up your dashboard.');
      setBusy(false);
    }
  }, [url, busy, user, onProvisioned]);

  return (
    <main
      id="website-url-gate"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
        color: '#1a1a1a',
        fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
      }}
    >
      <section
        id="website-url-gate-card"
        style={{
          width: 'min(100%, 440px)',
          display: 'grid',
          gap: 16,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid #E4E4E4',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 12,
          padding: 24,
        }}
      >
        <span style={{ fontSize: 9, fontFamily: '"Space Mono", ui-monospace, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8a8a', fontWeight: 700 }}>
          Set up your workspace
        </span>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0 }}>
          Add your website to begin
        </h1>
        <p style={{ margin: 0, color: '#444', fontSize: 14, lineHeight: 1.55 }}>
          We build your first Creative Brief from your site. Enter your website URL to start.
        </p>

        <form id="website-url-gate-form" onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 4 }}>
          <input
            id="website-url-gate-input"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yoursite.com"
            disabled={busy}
            style={{
              height: 44,
              width: '100%',
              borderRadius: 10,
              border: '1px solid #E4E4E4',
              padding: '0 14px',
              fontSize: 14,
              fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
              color: '#1a1a1a',
              background: 'rgba(255,255,255,0.9)',
              outline: 'none',
            }}
          />
          {error ? (
            <span id="website-url-gate-error" style={{ fontSize: 12, color: '#b4231f', fontFamily: '"Space Mono", ui-monospace, monospace', lineHeight: 1.4 }}>
              {error}
            </span>
          ) : null}
          <button
            id="website-url-gate-submit"
            type="submit"
            disabled={busy}
            style={{
              height: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              background: busy
                ? 'linear-gradient(135deg, #b9b9b9 0%, #9a9a9a 100%)'
                : 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '0 18px',
              fontSize: 13,
              fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
              fontWeight: 700,
              letterSpacing: '0.01em',
              lineHeight: 1,
              cursor: busy ? 'default' : 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
            }}
          >
            {busy ? 'Setting up…' : 'Create my dashboard'}
          </button>
        </form>
      </section>
    </main>
  );
}
