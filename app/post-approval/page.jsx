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
  const [caption, setCaption] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [remix, setRemix] = useState(null);
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  const [copyRefreshing, setCopyRefreshing] = useState(false);
  const [remixing, setRemixing] = useState(false);

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
        setCaption(typeof data.caption === 'string' ? data.caption : '');
        setMetadata(data.metadata || null);
        setRemix(data.remix || null);
        setError(data.error || '');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  function applyReadyData(data) {
    setPreview((current) => ({ ...(current || {}), ...data }));
    if (typeof data.caption === 'string') setCaption(data.caption);
    if (data.metadata) setMetadata(data.metadata);
    if (Object.prototype.hasOwnProperty.call(data, 'remix')) setRemix(data.remix);
    if (data.state) setState(data.state);
  }

  async function runApprovalAction(action) {
    const res = await fetch('/api/public/social-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action }),
    });
    const data = await res.json().catch(() => ({}));
    applyReadyData(data);
    if (!res.ok && res.status !== 202) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function handleRefreshCopy() {
    if (copyRefreshing || remixing) return;
    setCopyRefreshing(true);
    setError('');
    try {
      await runApprovalAction('refresh-copy');
    } catch (err) {
      setError(err.message);
    } finally {
      setCopyRefreshing(false);
    }
  }

  async function handleRemix() {
    if (remixing || remix?.status === 'rendering') return;
    setRemixing(true);
    setError('');
    try {
      await runApprovalAction('remix');
    } catch (err) {
      setError(err.message);
    } finally {
      setRemixing(false);
    }
  }

  useEffect(() => {
    if (!token || remix?.status !== 'rendering') return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const data = await runApprovalAction('remix-status');
        if (cancelled) return;
        if (data.remix?.status === 'rendering') {
          timer = window.setTimeout(poll, 10000);
        } else if (data.error) {
          setError(data.error);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          timer = window.setTimeout(poll, 8000);
        }
      }
    };
    timer = window.setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // runApprovalAction intentionally reads only stable token + state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, remix?.status, remix?.jobId]);

  async function handlePost() {
    if (posting) return;
    const nextCaption = caption.trim();
    if (!nextCaption) {
      setError('Post copy is required.');
      return;
    }
    if (nextCaption.length > 280) {
      setError('X posts must be 280 characters or fewer.');
      return;
    }
    setPosting(true);
    setError('');
    try {
      const res = await fetch('/api/public/social-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, content: nextCaption }),
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
            <div style={styles.videoActions}>
              <button
                type="button"
                onClick={handleRemix}
                disabled={remixing || remix?.status === 'rendering'}
                style={{
                  ...styles.secondaryButton,
                  opacity: remixing || remix?.status === 'rendering' ? 0.55 : 1,
                }}
              >
                {remix?.status === 'rendering' ? 'Remixing…' : remixing ? 'Starting…' : 'Remix video'}
              </button>
              <span style={styles.remixNote}>
                {remix?.status === 'rendering'
                  ? 'A new render is processing. This video and its copy will update automatically.'
                  : 'Creates a new cut without posting it.'}
              </span>
            </div>
            {metadata ? (
              <dl style={styles.metadata}>
                <div style={styles.metadataRow}><dt style={styles.metadataTerm}>DJ</dt><dd style={styles.metadataValue}>{metadata.artist || 'Not recorded'}</dd></div>
                <div style={styles.metadataRow}><dt style={styles.metadataTerm}>Mix</dt><dd style={styles.metadataValue}>{metadata.mix || 'Not recorded'}</dd></div>
                <div style={styles.metadataRow}><dt style={styles.metadataTerm}>Source</dt><dd style={styles.metadataValue}>{metadata.sourceFolders?.join(', ') || 'Not recorded'}</dd></div>
                <div style={styles.metadataRow}><dt style={styles.metadataTerm}>Look</dt><dd style={styles.metadataValue}>{metadata.filter || 'Original'}</dd></div>
                <div style={styles.metadataRow}><dt style={styles.metadataTerm}>Length</dt><dd style={styles.metadataValue}>{metadata.duration || 30}s</dd></div>
              </dl>
            ) : null}
            <div style={styles.copyField}>
              <div style={styles.copyMeta}>
                <label htmlFor="post-approval-copy" style={styles.copyLabel}>Post copy</label>
                <div style={styles.copyTools}>
                  <button
                    type="button"
                    onClick={handleRefreshCopy}
                    disabled={copyRefreshing || remix?.status === 'rendering'}
                    aria-label="Reset post copy from video metadata"
                    title="Reset copy to DJ and mix"
                    style={{
                      ...styles.refreshButton,
                      opacity: copyRefreshing || remix?.status === 'rendering' ? 0.45 : 1,
                    }}
                  >
                    {copyRefreshing ? '…' : '↻'}
                  </button>
                  <span style={{ ...styles.count, color: caption.length > 280 ? '#ff7b72' : styles.count.color }}>
                    {caption.length}/280
                  </span>
                </div>
              </div>
              <textarea
                id="post-approval-copy"
                value={caption}
                onChange={(event) => {
                  setCaption(event.target.value);
                  if (error) setError('');
                }}
                maxLength={280}
                rows={4}
                spellCheck
                style={styles.caption}
              />
              <p style={styles.copyHint}>Default: DJ and mix name. Edit freely, or use ↻ to restore the video metadata copy. Nothing publishes until the final Post button.</p>
              {error ? <p style={styles.inlineError}>{error}</p> : null}
            </div>
            <button
              id="post-approval-action-shell"
              type="button"
              onClick={handlePost}
              disabled={posting || remix?.status === 'rendering' || !caption.trim() || caption.length > 280}
              style={{ ...styles.button, opacity: posting || remix?.status === 'rendering' || !caption.trim() || caption.length > 280 ? 0.55 : 1 }}
            >
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
  copyField: { margin: '0 0 20px', textAlign: 'left' },
  copyMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '0 2px 8px' },
  copyTools: { display: 'flex', alignItems: 'center', gap: 9 },
  copyLabel: { fontSize: 12, fontWeight: 700, color: 'rgba(245,245,245,0.88)' },
  count: { fontSize: 11, color: 'rgba(245,245,245,0.5)', fontVariantNumeric: 'tabular-nums' },
  refreshButton: { width: 28, height: 28, borderRadius: 999, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.07)', color: '#f5f5f5', fontSize: 17, lineHeight: 1, cursor: 'pointer' },
  caption: { boxSizing: 'border-box', display: 'block', width: '100%', resize: 'vertical', font: 'inherit', fontSize: 13, lineHeight: 1.6, color: 'rgba(245,245,245,0.9)', caretColor: '#f5f5f5', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none', borderRadius: 10, padding: '12px 14px', minHeight: 96 },
  copyHint: { fontSize: 11, lineHeight: 1.5, color: 'rgba(245,245,245,0.5)', margin: '7px 2px 0' },
  inlineError: { fontSize: 11, lineHeight: 1.5, color: '#ff7b72', margin: '7px 2px 0' },
  video: { width: '100%', borderRadius: 12, margin: '0 0 16px', background: '#000' },
  videoActions: { display: 'flex', alignItems: 'center', gap: 12, margin: '-2px 0 14px', textAlign: 'left' },
  secondaryButton: { flex: '0 0 auto', minHeight: 36, borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#f5f5f5', padding: '0 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  remixNote: { fontSize: 10, lineHeight: 1.45, color: 'rgba(245,245,245,0.48)' },
  metadata: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 0 18px', padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)', textAlign: 'left' },
  metadataRow: { minWidth: 0, margin: 0 },
  metadataTerm: { margin: '0 0 2px', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,245,245,0.4)' },
  metadataValue: { margin: 0, fontSize: 11, lineHeight: 1.35, color: 'rgba(245,245,245,0.82)', overflowWrap: 'anywhere' },
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
