'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Public, unauthenticated approval page for the "Post to X" email button.
// Publishing happens ONLY on an explicit click here (a POST) — the emailed
// link itself never publishes, so an email scanner prefetching it is inert.
//
// The token rides as ?token= rather than a /[token] path segment so this page
// prerenders as STATIC. A dynamic segment would make it a serverless function,
// and Vercel Hobby caps a deployment at 12. Nothing here needs the server: the
// page fetches its own preview client-side.

const STATE_COPY = {
  loading: { title: 'Loading…', body: '' },
  invalid: { title: 'Link not valid', body: 'This approval link could not be verified. It may be corrupted — ask for a fresh one.' },
  'not-found': { title: 'Link not found', body: 'This approval link does not match any pending post.' },
  expired: { title: 'Link expired', body: 'This approval link is more than 48 hours old and has expired. Approve or reject from the dashboard instead.' },
  revoked: { title: 'Link revoked', body: 'This approval link was revoked from the dashboard and can no longer be used.' },
  'already-posted': { title: 'Already posted', body: 'This post has already been published — this link has done its job.' },
  posted: { title: 'Posted', body: 'The post is live.' },
  failed: { title: 'Publish failed', body: 'The token was accepted, but publishing failed. Re-approve from the dashboard to try again.' },
  server: { title: 'Temporarily unavailable', body: 'The server is misconfigured for approvals right now — this is not a problem with your link. Try again shortly or contact support.' },
  error: { title: 'Something went wrong', body: 'Could not load this approval link. Try again in a moment.' },
};

function PostApprovalView() {
  const token = useSearchParams().get('token') || '';
  const [state, setState] = useState('loading');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!token) { setState('invalid'); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/social-approve?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setState(data.state || 'error');
        setPreview(data);
        setError(data.error || '');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function handlePost() {
    if (posting) return;
    setPosting(true);
    try {
      const res = await fetch('/api/public/social-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      setState(data.state || 'error');
      setError(data.error || '');
    } catch {
      setState('error');
    } finally {
      setPosting(false);
    }
  }

  const copy = STATE_COPY[state] || STATE_COPY.error;
  const ready = state === 'ready';

  return (
    <main id="post-approval-page" style={styles.page}>
      <div style={styles.card}>
        <p style={styles.kicker}>Social Auto-Publish</p>

        {state === 'loading' ? (
          <p style={styles.body}>Loading…</p>
        ) : ready ? (
          <>
            <h1 style={styles.title}>Ready to post</h1>
            <p style={styles.targetLine}>
              This will publish to <strong>{preview?.clientName || 'this client'}</strong>&apos;s{' '}
              <strong>{(preview?.platform || 'x').toUpperCase()}</strong> account
              {preview?.handle ? <> — <strong>@{preview.handle}</strong></> : null}.
            </p>
            {preview?.videoUrl ? (
              <video id="post-approval-video" src={preview.videoUrl} controls playsInline style={styles.video} />
            ) : null}
            <p style={styles.caption}>{preview?.caption}</p>
            <button id="post-approval-action-shell" type="button" onClick={handlePost} disabled={posting} style={styles.button}>
              {posting ? 'Posting…' : `Post to ${(preview?.platform || 'x').toUpperCase()}`}
            </button>
          </>
        ) : (
          <>
            <h1 style={styles.title}>{copy.title}</h1>
            <p style={styles.body}>{error || copy.body}</p>
          </>
        )}
      </div>
    </main>
  );
}

// useSearchParams needs a Suspense boundary for the page to prerender.
export default function PostApprovalPage() {
  return (
    <Suspense fallback={<main id="post-approval-page" style={styles.page}><div style={styles.card}><p style={styles.body}>Loading…</p></div></main>}>
      <PostApprovalView />
    </Suspense>
  );
}

const styles = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: '#0a0a0a',
    color: '#f5f5f5',
    fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif',
  },
  card: { maxWidth: 480, width: '100%', textAlign: 'center' },
  kicker: { fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,245,245,0.5)', margin: '0 0 12px' },
  title: { fontSize: 20, margin: '0 0 12px', letterSpacing: '0.01em' },
  targetLine: { fontSize: 14, lineHeight: 1.6, color: 'rgba(245,245,245,0.85)', margin: '0 0 16px' },
  body: { fontSize: 13, lineHeight: 1.6, color: 'rgba(245,245,245,0.7)' },
  caption: { fontSize: 13, lineHeight: 1.6, color: 'rgba(245,245,245,0.85)', whiteSpace: 'pre-wrap', textAlign: 'left', background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px', margin: '0 0 20px' },
  video: { width: '100%', borderRadius: 12, margin: '0 0 16px', background: '#000' },
  button: {
    width: '100%',
    minHeight: 46,
    borderRadius: 999,
    border: 'none',
    background: '#f5f5f5',
    color: '#0a0a0a',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
};
