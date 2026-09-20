'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Standalone copy of components/recreate/RecreateTerminal.jsx's contract
// (itself a light reimplementation of DashboardPage's `runWithTerminal` /
// adhocTerminal pattern) — same hook shape, same cosmetic-ticker +
// advance()/note() real-progress channel, same overlay/minimize-chip UX.
// Neither RecreateTerminal.jsx nor DashboardPage.jsx is touched; this is a
// separate copy so /looper doesn't depend on either.

function settleActiveLine(lines, type, prefix) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].cursor) {
      lines[i] = { ...lines[i], type, prefix, cursor: false };
      break;
    }
  }
  return lines;
}

export function useLooperTerminal() {
  const [terminal, setTerminal] = useState(null);
  const timerRef = useRef(null);

  const closeTerminal = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setTerminal(null);
  }, []);

  const minimizeTerminal = useCallback(() => {
    setTerminal((t) => (t ? { ...t, open: false } : t));
  }, []);

  const reopenTerminal = useCallback(() => {
    setTerminal((t) => (t ? { ...t, open: true } : t));
  }, []);

  // Auto-close on success after 4s. Errors stay open so the user can read
  // them / retry — closing an error terminal is the caller's job (LooperLandingPage
  // uses this to route back to the hero phase).
  useEffect(() => {
    if (terminal?.status !== 'done' || !terminal?.open) return undefined;
    const t = setTimeout(() => closeTerminal(), 4000);
    return () => clearTimeout(t);
  }, [terminal?.status, terminal?.open, closeTerminal]);

  const runWithTerminal = useCallback(async ({ title, brand, host, stages, task }) => {
    if (timerRef.current) clearInterval(timerRef.current);

    setTerminal({
      open: true,
      status: 'running',
      title,
      brand,
      host,
      lines: [
        { type: 'system', prefix: '$', text: host ? `${(brand || 'run').toLowerCase()} · ${host}` : (brand || 'run') },
        { type: 'dim', prefix: '', text: '─'.repeat(42) },
        { type: 'active', prefix: stages[0].pfx, text: stages[0].text, cursor: true },
      ],
    });

    let i = 0;
    let manual = false;
    const stopTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    // Cosmetic auto-advance while the caller hasn't manually driven the
    // ticker yet — the same "feels alive before real progress lands" trick
    // as RecreateTerminal.jsx.
    timerRef.current = setInterval(() => {
      if (manual) return;
      if (i >= stages.length - 1) return;
      i += 1;
      const s = stages[i];
      setTerminal((t) => {
        if (!t || t.status !== 'running') return t;
        const lines = settleActiveLine(t.lines.slice(), 'ok', '✓');
        lines.push({ type: 'active', prefix: s.pfx, text: s.text, cursor: true });
        return { ...t, lines };
      });
    }, 3500);

    const advance = (pfx, text) => {
      manual = true;
      stopTimer();
      setTerminal((t) => {
        if (!t || t.status !== 'running') return t;
        const lines = settleActiveLine(t.lines.slice(), 'ok', '✓');
        lines.push({ type: 'active', prefix: pfx, text, cursor: true });
        return { ...t, lines };
      });
    };

    const note = (text) => setTerminal((t) => (
      t && t.status === 'running' ? { ...t, lines: [...t.lines, { type: 'dim', prefix: '', text }] } : t
    ));

    try {
      const result = await task({ advance, note });
      stopTimer();
      setTerminal((t) => {
        if (!t) return t;
        const lines = settleActiveLine(t.lines.slice(), 'ok', '✓');
        lines.push({ type: 'ok', prefix: '✓', text: result?.doneText || 'done' });
        return { ...t, status: 'done', lines };
      });
      return result;
    } catch (err) {
      stopTimer();
      const msg = err?.message || 'failed';
      setTerminal((t) => {
        if (!t) return t;
        const lines = settleActiveLine(t.lines.slice(), 'error', '✗');
        lines.push({ type: 'error', prefix: '[ERR]', text: msg });
        return { ...t, status: 'error', lines };
      });
      throw err;
    }
  }, []);

  return { terminal, runWithTerminal, closeTerminal, minimizeTerminal, reopenTerminal };
}

export default function LooperTerminalOverlay({ terminal, onClose, onMinimize }) {
  const outputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [terminal?.lines]);

  if (!terminal?.open) return null;

  const running = terminal.status === 'running';

  return (
    <div id="looper-terminal-overlay" role="dialog" aria-modal="true" aria-label="Analyzing your track">
      <div id="looper-terminal-card">
        <div id="looper-terminal-brand-row">
          <span id="looper-terminal-brand-label">{terminal.brand || 'Looper'}</span>
          <button
            type="button"
            id="looper-terminal-close-btn"
            onClick={running ? onMinimize : onClose}
            aria-label={running ? 'Minimize (the run keeps going in the background)' : 'Close'}
          >
            [ ✕ ]
          </button>
        </div>

        <h2 id="looper-terminal-title">{terminal.title || 'WORKING'}</h2>

        <div id="looper-terminal-panel">
          <div id="looper-terminal-titlebar">
            <span className="lt-dot lt-dot-close" aria-hidden="true" />
            <span className="lt-dot lt-dot-min" aria-hidden="true" />
            <span className="lt-dot lt-dot-max" aria-hidden="true" />
            <span id="looper-terminal-titlebar-label">looper.process</span>
          </div>
          <div id="looper-terminal-embed" ref={outputRef}>
            {terminal.lines.map((line, i) => (
              <div key={i} className={`lt-line lt-${line.type}`}>
                <span className="lt-pfx">{line.prefix}</span>
                <span className="lt-msg">{line.text}</span>
                {line.cursor ? <span className="lt-caret" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>
        </div>

        <div id="looper-terminal-footer">
          <span id="looper-terminal-footer-host">{terminal.host || ' '}</span>
          <span id="looper-terminal-footer-note">
            {terminal.status === 'error' ? 'Analysis failed — close and try another file.' : 'You can close and come back anytime'}
          </span>
        </div>
      </div>

      <style jsx>{`
        #looper-terminal-overlay {
          position: fixed;
          inset: 0;
          z-index: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background: rgba(42, 36, 32, 0.14);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          /* The wash + blur land in half the time the hero chrome takes to
             fade out (LooperLandingPage ANALYZING_FADE_OUT_S = 0.6s), so the
             background is already soft before the text is gone. */
          animation: lt-overlay-in 300ms ease-out both;
        }
        @keyframes lt-overlay-in {
          from {
            opacity: 0;
            backdrop-filter: blur(0px);
            -webkit-backdrop-filter: blur(0px);
          }
          to {
            opacity: 1;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          #looper-terminal-overlay { animation: none; }
        }
        #looper-terminal-card {
          position: relative;
          width: 100%;
          max-width: 30rem;
          padding: clamp(1.25rem, 5vw, 2rem);
          border-radius: 10px;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(212, 196, 171, 0.82);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.4), 0px 20px 40px rgba(0, 0, 0, 0.15);
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
        }
        #looper-terminal-brand-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.75rem;
        }
        #looper-terminal-brand-label {
          font-size: 0.82rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(42, 36, 32, 0.44);
          font-weight: 700;
          font-family: "Space Mono", monospace;
        }
        #looper-terminal-close-btn {
          flex-shrink: 0;
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(42, 36, 32, 0.15);
          border-radius: 6px;
          padding: 6px 12px;
          font-family: "Space Mono", monospace;
          font-size: 12px;
          cursor: pointer;
          color: #2a2420;
          transition: background 200ms ease, color 200ms ease;
        }
        #looper-terminal-close-btn:hover,
        #looper-terminal-close-btn:focus-visible {
          background: #2a2420;
          color: #fff;
        }
        #looper-terminal-title {
          margin: 0 0 0.85rem;
          color: #2a2420;
          font-size: clamp(1.4rem, 5vw, 2.2rem);
          line-height: 1.05;
          letter-spacing: -0.03em;
          font-family: "Doto", "Space Mono", monospace;
          font-weight: 700;
        }
        #looper-terminal-panel {
          background: var(--term-bg);
          border: 1px solid var(--term-border);
          border-top: 1px solid var(--term-border-top);
          box-shadow: var(--term-shadow);
          border-radius: 10px;
          overflow: hidden;
        }
        #looper-terminal-titlebar {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid var(--term-titlebar-border);
          background: var(--term-titlebar-bg);
        }
        .lt-dot { width: 0.52rem; height: 0.52rem; border-radius: 999px; flex-shrink: 0; }
        .lt-dot-close { background: rgba(255, 95, 86, 0.65); }
        .lt-dot-min { background: rgba(255, 189, 46, 0.65); }
        .lt-dot-max { background: rgba(39, 201, 63, 0.65); }
        #looper-terminal-titlebar-label {
          flex: 1;
          text-align: center;
          font-family: "Space Mono", monospace;
          font-size: 0.62rem;
          letter-spacing: 0.08em;
          color: var(--term-title-fg);
        }
        #looper-terminal-embed {
          padding: 0.7rem 0.85rem 0.8rem;
          height: 9rem;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          max-height: 240px;
          overflow-y: auto;
          color: var(--term-fg);
          scrollbar-width: thin;
          scrollbar-color: var(--term-scroll-thumb) transparent;
        }
        .lt-line {
          display: grid;
          grid-template-columns: 4.2rem 1fr;
          gap: 0.5em;
          font-family: "Space Mono", monospace;
          font-size: 0.68rem;
          line-height: 1.65;
          align-items: baseline;
        }
        .lt-pfx { text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-size: 0.64rem; letter-spacing: 0.02em; }
        .lt-msg { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lt-active .lt-pfx { color: var(--term-active-pfx); }
        .lt-active .lt-msg { color: var(--term-active-msg); font-weight: 700; }
        .lt-ok .lt-pfx { color: var(--term-ok-pfx); }
        .lt-ok .lt-msg { color: var(--term-ok-msg); }
        .lt-error .lt-pfx { color: var(--term-error-pfx); }
        .lt-error .lt-msg { color: var(--term-error-msg); }
        .lt-dim, .lt-system { color: var(--term-dim); }
        .lt-caret {
          display: inline-block;
          width: 0.45em;
          height: 0.95em;
          background: var(--term-caret);
          vertical-align: text-bottom;
          margin-left: 2px;
          animation: lt-blink 1s step-start infinite;
        }
        @keyframes lt-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        #looper-terminal-footer {
          font-family: "Space Mono", monospace;
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(42, 36, 32, 0.32);
          margin-top: 0.9rem;
          border-top: 1px solid rgba(212, 196, 171, 0.4);
          padding-top: 0.75rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
        }
        @media (max-width: 480px) {
          #looper-terminal-overlay { padding: 0.5rem; }
          #looper-terminal-card { padding: 1.25rem; }
        }
      `}</style>
    </div>
  );
}
