'use client';

// Dev previewer for the invoice renderer — the same job app/preview/brief does
// for the newspaper brief: see the real render without driving the dashboard.
//
// Why it exists separately from the Invoice Builder card's own live preview:
// the card is a full editor behind the dashboard shell (heavy, admin bucket,
// slow to reach when you are iterating on section markup). This page is a
// paste-JSON-and-look harness for the renderer itself.
//
// It renders through POST /api/dashboard/custom-briefs { preview: true },
// which is side-effect free — no Firestore write, no Storage, no Browserless
// spend. features/invoices/render.js is NEVER imported here: it pulls
// brief-css.cjs through createRequire and would break next dev in a client
// bundle. model.js and registry.js are import-free, so they are safe.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../AuthContext';
import { INVOICE_SECTIONS } from '../../../features/invoices/registry';
import { normalizeInvoice } from '../../../features/invoices/model';
// Same starting draft the Invoice Builder card seeds from — one constant, so
// the harness and the card can never show different "defaults".
import { DEFAULT_DRAFT } from '../../../features/invoices/default-draft';

const RENDER_DEBOUNCE_MS = 600;

const MONO = '"Space Mono", ui-monospace, monospace';

export default function InvoicePreviewRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [draftText, setDraftText] = useState(() => JSON.stringify(DEFAULT_DRAFT, null, 2));
  const [include, setInclude] = useState(() => {
    const map = {};
    INVOICE_SECTIONS.forEach((s) => { map[s.id] = s.defaultOn !== false; });
    return map;
  });
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState('idle'); // idle | rendering | ready | error
  const [message, setMessage] = useState('');

  const timerRef = useRef(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?redirect=/preview/invoice');
  }, [user, loading, router]);

  // Parse locally so a JSON typo shows up instantly instead of costing a
  // round trip, and so the totals readout can be computed without the server.
  const parsed = useMemo(() => {
    try {
      return { invoice: JSON.parse(draftText), error: '' };
    } catch (err) {
      return { invoice: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [draftText]);

  const totals = useMemo(() => {
    if (!parsed.invoice) return null;
    try {
      return normalizeInvoice(parsed.invoice).totals;
    } catch {
      return null;
    }
  }, [parsed.invoice]);

  const render = useCallback(async () => {
    if (!user || !parsed.invoice) return;
    const reqId = ++reqIdRef.current;
    setStatus('rendering');
    setMessage('');
    try {
      const token = typeof user.getIdToken === 'function' ? await user.getIdToken() : null;
      if (!token) throw new Error('Could not resolve auth token.');
      const res = await fetch('/api/dashboard/custom-briefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind: 'invoice',
          preview: true,
          invoice: parsed.invoice,
          sections: { include },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (reqId !== reqIdRef.current) return; // a newer edit already won
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setHtml(String(data.html || ''));
      setStatus('ready');
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [user, parsed.invoice, include]);

  // Debounced auto-render — a keystroke in the JSON box must not fire a request.
  useEffect(() => {
    if (!user || !parsed.invoice) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { render(); }, RENDER_DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [user, parsed.invoice, include, render]);

  if (loading || !user) {
    return <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>Resolving session…</div>;
  }

  const statusLabel = parsed.error ? 'JSON error'
    : status === 'rendering' ? 'Rendering…'
    : status === 'error' ? 'Error'
    : status === 'ready' ? 'Ready'
    : 'Idle';

  return (
    <div id="invoice-preview-shell" style={{ minHeight: '100dvh', background: '#2A2420', display: 'flex', flexDirection: 'column' }}>
      <header
        id="invoice-preview-topbar"
        style={{
          padding: '10px 16px', background: '#1a1614', color: '#F5F1DF', fontFamily: MONO,
          fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          borderBottom: '1px solid rgba(245,241,223,0.2)',
        }}
      >
        <span>Invoice Preview · Live Render</span>
        <span style={{ opacity: 0.6 }}>{statusLabel}</span>
      </header>

      <div id="invoice-preview-body" style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap' }}>
        <aside
          id="invoice-preview-controls"
          style={{
            flex: '1 1 320px', maxWidth: 420, minWidth: 280, display: 'flex', flexDirection: 'column',
            gap: 12, padding: 14, background: '#1f1a17', color: '#F5F1DF',
            borderRight: '1px solid rgba(245,241,223,0.14)', overflowY: 'auto',
          }}
        >
          <div id="invoice-preview-section-toggles">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', opacity: 0.65 }}>SECTIONS</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={miniBtn} onClick={() => setInclude(Object.fromEntries(INVOICE_SECTIONS.map((s) => [s.id, true])))}>all</button>
                <button type="button" style={miniBtn} onClick={() => setInclude(Object.fromEntries(INVOICE_SECTIONS.map((s) => [s.id, false])))}>none</button>
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {INVOICE_SECTIONS.map((section) => {
                const on = include[section.id] !== false;
                return (
                  <button
                    key={section.id}
                    type="button"
                    id={`invoice-preview-toggle-${section.id}`}
                    title={section.hint}
                    aria-pressed={on}
                    onClick={() => setInclude((prev) => ({ ...prev, [section.id]: !on }))}
                    style={{
                      ...miniBtn,
                      background: on ? '#F5F1DF' : 'transparent',
                      color: on ? '#1a1614' : 'rgba(245,241,223,0.7)',
                      borderColor: on ? '#F5F1DF' : 'rgba(245,241,223,0.28)',
                    }}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>

          {totals ? (
            <div id="invoice-preview-totals-readout" style={{ fontFamily: MONO, fontSize: 10, opacity: 0.7, lineHeight: 1.7 }}>
              subtotal {totals.subtotal} · total {totals.total} · deposit {totals.deposit}
              {totals.monthlyValue ? ` · monthly ${totals.monthlyValue}` : ''}
            </div>
          ) : null}

          <label htmlFor="invoice-preview-json" style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', opacity: 0.65 }}>
            INVOICE JSON
          </label>
          <textarea
            id="invoice-preview-json"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1, minHeight: 260, resize: 'vertical', padding: 10, borderRadius: 6,
              border: '1px solid ' + (parsed.error ? '#ff8f8f' : 'rgba(245,241,223,0.22)'),
              background: '#12100e', color: '#F5F1DF', fontFamily: MONO, fontSize: 11, lineHeight: 1.5,
            }}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={miniBtn} onClick={() => render()} disabled={!parsed.invoice}>re-render</button>
            <button type="button" style={miniBtn} onClick={() => setDraftText(JSON.stringify(DEFAULT_DRAFT, null, 2))}>reset sample</button>
          </div>

          {parsed.error ? (
            <p id="invoice-preview-json-error" style={{ margin: 0, color: '#ffb3b3', fontFamily: MONO, fontSize: 11 }}>{parsed.error}</p>
          ) : null}
          {message ? (
            <p id="invoice-preview-render-error" style={{ margin: 0, color: '#ffb3b3', fontFamily: MONO, fontSize: 11, whiteSpace: 'pre-wrap' }}>{message}</p>
          ) : null}
        </aside>

        <main id="invoice-preview-stage" style={{ flex: '3 1 520px', minWidth: 320, minHeight: 480, display: 'flex' }}>
          {html ? (
            <iframe
              id="invoice-preview-frame"
              title="Invoice preview"
              srcDoc={html}
              style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
            />
          ) : (
            <div style={{ margin: 'auto', color: 'rgba(245,241,223,0.5)', fontFamily: MONO, fontSize: 12 }}>
              {parsed.error ? 'Fix the JSON to render.' : 'Rendering…'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const miniBtn = {
  padding: '5px 10px',
  borderRadius: 999,
  border: '1px solid rgba(245,241,223,0.28)',
  background: 'transparent',
  color: 'rgba(245,241,223,0.85)',
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
