'use client';

// Brief Studio - live preview of the client brief document. Same frame, zoom and
// paper presentation as InvoiceCanvas, but read-only: no contenteditable, no
// two-way bridge, no HoloPaper.
//
// The document is rendered IN THE BROWSER by features/client-brief/render.js
// (the same function the server publish route calls), from the draft's markdown
// parsed by features/client-brief/parse.js. This file imports only those two
// (both client-safe); never publish.js (it pulls in node crypto). The HITLOOP
// brand mark is an admin-only dynamic import, exactly like InvoiceCanvas.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Download, FilePlus2, AlertTriangle } from 'lucide-react';
import { GLASS, ui } from '../components/rail-ui';
import { parseClientBrief } from '../../../../features/client-brief/parse.js';
import { renderClientBriefDocument } from '../../../../features/client-brief/render.js';

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;
// The document is laid out at this width (an A4 sheet at 96dpi) and painted down
// to fit the board; one A4 page is the paper the canvas fits against.
const LAYOUT_WIDTH = 860;
const PAGE_HEIGHT = Math.round(LAYOUT_WIDTH * (297 / 210));
const SLIDER_COLUMN_WIDTH = 26;
const ARTBOARD_PAD_X = 64;
const ARTBOARD_PAD_X_NARROW = 16;
const ARTBOARD_PAD_TOP = 44;
const ARTBOARD_PAD_BOTTOM = 92;
const MOBILE_ARTBOARD_HEIGHT = 560;
const RENDER_DEBOUNCE_MS = 250;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BriefCanvas({
  title = '', text = '', themeId = null, clientName = '', isAdmin = false, isNarrow = false, onNewBrief = null,
}) {
  const iframeRef = useRef(null);
  const stageRowRef = useRef(null);
  const resizeObserverRef = useRef(null);

  // Brand mark: admin only, reached only through a dynamic import so a public
  // bundle never carries the owner's logo data.
  const [brand, setBrand] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!isAdmin) { setBrand(null); return undefined; }
    import('../../../../features/invoices/brand-marks.js')
      .then(({ HITLOOP_BRAND }) => { if (!cancelled) setBrand(HITLOOP_BRAND || null); })
      .catch(() => { if (!cancelled) setBrand(null); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const [docHtml, setDocHtml] = useState('');
  const [renderError, setRenderError] = useState('');
  const [docHeight, setDocHeight] = useState(PAGE_HEIGHT);
  const [asOf] = useState(todayIso);

  // Debounced render: parse + render on every pause in typing.
  useEffect(() => {
    if (!String(text).trim()) { setDocHtml(''); setRenderError(''); return undefined; }
    const timer = setTimeout(() => {
      try {
        const model = parseClientBrief(text, { title: String(title || '').slice(0, 140), clientName, asOf });
        const { html } = renderClientBriefDocument(model, { theme: themeId ? { id: themeId } : null, brand });
        setDocHtml(html);
        setRenderError('');
      } catch (err) {
        setRenderError(err instanceof Error ? err.message : 'Could not render the brief.');
      }
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, title, themeId, clientName, brand, asOf]);

  const handleFrameLoad = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    let doc = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    const measure = () => {
      if (!doc || !doc.body) return;
      // Measure the BODY: documentElement.scrollHeight is clamped to the
      // iframe's own viewport height, which this component sets from this value.
      const h = doc.body.scrollHeight || 0;
      if (h > 0) setDocHeight(h);
    };
    measure();
    if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
    if (doc && doc.documentElement && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(doc.documentElement);
      resizeObserverRef.current = ro;
    }
  }, []);
  useEffect(() => () => { if (resizeObserverRef.current) resizeObserverRef.current.disconnect(); }, []);

  const [zoomFactor, setZoomFactor] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: LAYOUT_WIDTH, height: 0 });
  useEffect(() => {
    const el = stageRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0] && entries[0].contentRect;
      if (rect && rect.width) setContainerSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit against one A4 page (a longer document grows the sheet downward instead
  // of shrinking the type), then zoom is a multiplier on top of fit.
  const fitScale = useMemo(() => {
    const chromeX = isNarrow ? ARTBOARD_PAD_X_NARROW * 2 : ARTBOARD_PAD_X * 2;
    const byWidth = (containerSize.width - chromeX) / LAYOUT_WIDTH;
    const byHeight = containerSize.height && !isNarrow
      ? (containerSize.height - (ARTBOARD_PAD_TOP + ARTBOARD_PAD_BOTTOM)) / PAGE_HEIGHT
      : Infinity;
    return Math.max(0.1, Math.min(byWidth, byHeight));
  }, [containerSize, isNarrow]);
  const scale = Math.max(0.05, fitScale * zoomFactor);
  const sheetHeight = Math.max(PAGE_HEIGHT, docHeight);

  const handlePrint = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame || !frame.contentWindow) return;
    let doc = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    const fontsReady = doc && doc.fonts && typeof doc.fonts.ready?.then === 'function' ? doc.fonts.ready : Promise.resolve();
    try {
      await Promise.race([fontsReady, new Promise((resolve) => { setTimeout(resolve, 1500); })]);
    } catch { /* a rejected fonts.ready must never block printing */ }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }, []);

  const handleDownloadHtml = useCallback(() => {
    if (!docHtml) return;
    const safeName = String(title || 'client-brief').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'client-brief';
    triggerDownload(new Blob([docHtml], { type: 'text/html' }), `${safeName}.html`);
  }, [docHtml, title]);

  const hasText = Boolean(String(text).trim());

  return (
    <div id="brief-studio-canvas" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: isNarrow ? 'auto' : '100%', minHeight: 0 }}>
      <div
        id="brief-studio-stage-row"
        ref={stageRowRef}
        data-tooltip-disabled="true"
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0,
          padding: isNarrow ? '12px 12px 0' : '64px 24px 0',
          ...(isNarrow ? { flex: 'none' } : { flex: 1, minHeight: 0 }),
        }}
      >
        <div
          id="brief-studio-zoom-slider-column"
          style={{
            position: 'absolute', left: isNarrow ? 8 : 18, top: '50%', transform: 'translateY(-50%)',
            zIndex: 3, width: SLIDER_COLUMN_WIDTH, boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}
        >
          <input
            id="brief-studio-zoom-slider"
            type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={zoomFactor}
            onChange={(e) => setZoomFactor(Number(e.target.value))}
            aria-label="Zoom"
            style={{
              height: 128, width: 24, margin: 0, writingMode: 'vertical-rl', direction: 'rtl',
              WebkitAppearance: 'slider-vertical', accentColor: GLASS.ink, cursor: 'ns-resize',
            }}
          />
          <span id="brief-studio-zoom-readout" style={{ ...ui.label, fontSize: 9, letterSpacing: '0.04em', width: '100%', textAlign: 'center' }}>
            {`${Math.round(zoomFactor * 100)}%`}
          </span>
        </div>

        <div
          id="brief-studio-artboard-area"
          style={{
            flex: 1, minWidth: 0, maxWidth: '100%', display: 'flex', justifyContent: 'center', overflow: 'auto', boxSizing: 'border-box',
            padding: isNarrow
              ? `${ARTBOARD_PAD_TOP / 2}px ${ARTBOARD_PAD_X_NARROW}px ${ARTBOARD_PAD_BOTTOM / 2}px`
              : `${ARTBOARD_PAD_TOP}px ${ARTBOARD_PAD_X}px ${ARTBOARD_PAD_BOTTOM}px`,
            ...(isNarrow ? { height: MOBILE_ARTBOARD_HEIGHT, flex: 'none', width: '100%' } : { minHeight: 0, maxHeight: '100%' }),
          }}
        >
          {renderError ? (
            <div
              id="brief-studio-render-error"
              role="alert"
              style={{
                alignSelf: 'flex-start', display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: 520, padding: '14px 16px', borderRadius: 10,
                background: 'rgba(254,226,226,0.9)', border: '1px solid rgba(248,113,113,0.4)', fontFamily: GLASS.mono, fontSize: 12, lineHeight: 1.5, color: GLASS.ink,
              }}
            >
              <AlertTriangle size={16} strokeWidth={2.5} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn&apos;t render this brief: {renderError}</span>
            </div>
          ) : (
            <div
              id="brief-studio-paper-shell"
              style={{
                flexShrink: 0, position: 'relative', background: '#ffffff', borderRadius: 4, margin: 'auto', overflow: 'hidden',
                width: LAYOUT_WIDTH * scale, height: sheetHeight * scale,
                boxShadow: '0 22px 60px rgba(20,20,30,0.22), 0 4px 16px rgba(0,0,0,0.10)',
              }}
            >
              {hasText ? (
                <iframe
                  id="brief-studio-preview-frame"
                  ref={iframeRef}
                  title="Client brief preview"
                  srcDoc={docHtml}
                  onLoad={handleFrameLoad}
                  style={{
                    display: 'block', width: LAYOUT_WIDTH, height: docHeight, border: 'none',
                    transform: `scale(${scale})`, transformOrigin: 'top left', background: '#ffffff',
                  }}
                />
              ) : (
                <div
                  id="brief-studio-empty-hint"
                  style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: GLASS.sans, fontSize: 13, color: GLASS.inkMute, lineHeight: 1.5 }}
                >
                  Paste the client breakdown (Markdown) in the Content card to preview it here.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        id="brief-studio-actions-row"
        style={{
          flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
          padding: isNarrow ? '10px 12px 16px' : '14px 24px 22px',
        }}
      >
        <button type="button" onClick={() => { if (typeof onNewBrief === 'function') onNewBrief(); }} style={{ ...ui.btn(false), gap: 6 }}>
          <FilePlus2 size={14} strokeWidth={2.5} /> New brief
        </button>
        <button type="button" onClick={handleDownloadHtml} disabled={!docHtml} style={{ ...ui.btn(false), gap: 6, opacity: docHtml ? 1 : 0.5 }}>
          <Download size={14} strokeWidth={2.5} /> Download .html
        </button>
        <button type="button" id="brief-studio-print-btn" className="cta-pill-btn" onClick={handlePrint} disabled={!docHtml} style={{ ...ui.cta, gap: 8, opacity: docHtml ? 1 : 0.5 }}>
          <Printer size={14} strokeWidth={2.5} /> Print / Save PDF
        </button>
      </div>
    </div>
  );
}
