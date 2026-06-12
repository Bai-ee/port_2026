'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const BrandSystemChat = dynamic(() => import('./BrandSystemChat'), { ssr: false });

/**
 * Brand System build modal — same Terminal/Chat overlay shell as the intake
 * build modal (#intake-modal-overlay). Left column: live terminal log driven
 * by BrandSystemChat events. Right column: the chat itself.
 *
 * Reuses the global CSS classes defined in DashboardPage.jsx (term-line,
 * term-pfx, term-msg, term-caret, term-win-dot, etc.) so the look matches the
 * established intake terminal one-to-one.
 */
export default function BrandSystemBuildModal({ open, onClose, getIdToken, onComplete, apiPath }) {
  const [terminalLines, setTerminalLines] = useState([]);
  const [phase, setPhase] = useState('running'); // running | done | failed
  const terminalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines]);

  const handleLog = useCallback((line) => {
    setTerminalLines((prev) => {
      // Drop the previous "active" cursor line so only the latest one blinks.
      const trimmed = line.cursor ? prev.filter((l) => !l.cursor) : prev;
      return [...trimmed, line];
    });
    if (line.type === 'error') setPhase('failed');
  }, []);

  const handleComplete = useCallback((finalResult) => {
    setPhase('done');
    onComplete?.(finalResult);
  }, [onComplete]);

  const statusDotColor = phase === 'failed' ? '#D71921' : phase === 'done' ? '#4A9E5C' : '#D4A843';
  const statusPulse = phase === 'running' ? 'status-pulse 1.4s ease-in-out infinite' : 'none';

  return (
    <div id="intake-modal-overlay" role="dialog" aria-modal="true" aria-label="Brand System build"
      style={open ? undefined : { display: 'none' }}
    >
      <div
        id="intake-modal-card"
        data-with-survey="true"
        style={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          maxWidth: '52rem',
          padding: 'clamp(1.25rem, 5vw, 2rem)',
          borderRadius: '10px',
          boxSizing: 'border-box',
          background: 'rgba(255, 255, 255, 0.6)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
        }}
      >
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'space-between' }}>
          <img src="/img/profile2_400x400.png?v=1774582808" alt="" aria-hidden="true" style={{ width: '2.75rem', height: '2.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.35)', display: 'block' }} />
          <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            Brand System
          </span>
          <span
            id="brand-system-modal-status-orb"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.4rem', height: '2.4rem', borderRadius: '999px', background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(42,36,32,0.12)' }}
            aria-hidden="true"
          >
            <span style={{
              width: '0.46rem', height: '0.46rem', borderRadius: '999px',
              background: statusDotColor,
              animation: statusPulse,
            }} />
          </span>
        </div>

        {/* Marquee title — two copies, CSS-animated, matches intake modal pattern */}
        <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', animation: 'bsm-marquee 14s linear infinite', willChange: 'transform' }}>
            {['a', 'b'].map((k) => (
              <span key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{
                flexShrink: 0, whiteSpace: 'nowrap',
                color: '#2a2420',
                fontSize: 'clamp(1.5rem, 5vw, 3.4rem)',
                lineHeight: 1.05,
                letterSpacing: '-0.04em',
                fontFamily: '"Doto", "Space Mono", monospace',
                fontWeight: 700,
              }}>
                {'BRAND SYSTEM  ·  BUILD  ·  '}
              </span>
            ))}
          </div>
          <style>{`@keyframes bsm-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
        </div>

        {/* Terminal (left) + chat (right) */}
        <div id="intake-modal-body">
          <div id="intake-modal-terminal-col">
            <div id="intake-modal-terminal-titlebar">
              <span className="term-win-dot term-win-dot-close" />
              <span className="term-win-dot term-win-dot-min" />
              <span className="term-win-dot term-win-dot-max" />
              <span id="intake-modal-terminal-title">brand-system.build</span>
            </div>
            <div id="intake-modal-terminal-embed" ref={terminalRef}>
              {terminalLines.map((line, i) => (
                <div key={`bsl-${i}`} className={`term-line term-${line.type}`}>
                  <span className="term-pfx">{line.prefix}</span>
                  <span className="term-msg">{line.text}</span>
                  {line.cursor ? <span className="term-caret" /> : null}
                </div>
              ))}
            </div>
          </div>

          <div id="intake-modal-survey-col" data-resolved={phase === 'done' ? 'true' : 'false'}>
            <BrandSystemChat
              getIdToken={getIdToken}
              apiPath={apiPath}
              onComplete={handleComplete}
              onLog={handleLog}
            />
          </div>
        </div>

        {/* Footer */}
        <div id="intake-modal-footer">
          <span id="intake-modal-footer-host">brand-system</span>
          <button
            type="button"
            id="intake-modal-footer-cancel"
            onClick={onClose}
            aria-label="Close Brand System build"
          >[ {phase === 'done' ? 'close' : 'cancel'} ]</button>
        </div>
      </div>
    </div>
  );
}
