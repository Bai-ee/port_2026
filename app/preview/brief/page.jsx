'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../AuthContext';

// Dev preview — fetches /api/dashboard/brief-preview with the user's token,
// dumps the HTML into an iframe so you can see the newspaper design against
// the last pipeline run without re-running anything.

export default function BriefPreviewRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState({ status: 'idle', message: '', bodyHtml: '', stylesCss: '' });

  useEffect(() => {
    if (!loading && !user) router.replace('/login?redirect=/preview/brief');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setState({ status: 'loading', message: '', bodyHtml: '', stylesCss: '' });
      try {
        const token = typeof user.getIdToken === 'function'
          ? await user.getIdToken()
          : null;
        if (!token) throw new Error('Could not resolve auth token.');

        const res = await fetch('/api/dashboard/brief-preview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const full = await res.text();
        if (!res.ok) throw new Error(full || `HTTP ${res.status}`);

        // Extract the head <style> block AND the body content so the styles
        // actually apply when we inject into this React page. The brief's
        // CSS targets `body{}` and `html,body{}` for background gradients and
        // margins — rewrite those selectors to a scoped `.brief-root{}` so
        // they apply to our wrapper div instead of the app's actual <body>.
        // The PDF render is unaffected because that path serves the full
        // document where body{} is correct.
        const styleMatch = full.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        const bodyMatch  = full.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        let stylesCss = styleMatch ? styleMatch[1] : '';
        // Rewrite top-level body / html,body selectors so gradients land on
        // the wrapper. Only rewrites at rule boundaries to avoid false hits.
        stylesCss = stylesCss
          .replace(/(^|\n|\}|\*\/)\s*html\s*,\s*body\s*\{/g, '$1 .brief-root{')
          .replace(/(^|\n|\}|\*\/)\s*body\s*\{/g, '$1 .brief-root{');
        const bodyInner = bodyMatch ? bodyMatch[1] : full;

        if (cancelled) return;
        setState({ status: 'ready', message: '', stylesCss, bodyHtml: bodyInner });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
            bodyHtml: '',
            stylesCss: '',
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  if (loading || !user) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        Resolving session…
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#2A2420', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '10px 16px',
          background: '#1a1614',
          color: '#F5F1DF',
          fontFamily: '"Space Mono", ui-monospace, monospace',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(245,241,223,0.2)',
        }}
      >
        <span>Brief Preview · Live Render</span>
        <span style={{ opacity: 0.6 }}>
          {state.status === 'loading' && 'Loading…'}
          {state.status === 'ready'   && 'Ready'}
          {state.status === 'error'   && 'Error'}
        </span>
      </header>

      {state.status === 'error' ? (
        <pre style={{ padding: 24, color: '#ffb3b3', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>
          {state.message}
        </pre>
      ) : state.bodyHtml ? (
        // Inject the brief's head <style> block + <body> content directly
        // into this document. Fonts loaded by app/layout.jsx (Doto + Space
        // Grotesk + Space Mono) apply here because we now share the same
        // document context as the app shell.
        <div style={{ flex: 1, width: '100%', overflow: 'auto' }}>
          {state.stylesCss ? (
            <style dangerouslySetInnerHTML={{ __html: state.stylesCss }} />
          ) : null}
          <div
            className="brief-root"
            dangerouslySetInnerHTML={{ __html: state.bodyHtml }}
          />
        </div>
      ) : (
        <div style={{ padding: 24, color: '#F5F1DF', fontFamily: 'system-ui, sans-serif' }}>Loading brief…</div>
      )}
    </div>
  );
}
