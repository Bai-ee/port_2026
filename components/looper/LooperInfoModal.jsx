'use client';

// /looper nav info modal — opened by #looper-nav-info-btn (the page-local
// replacement for the shared Header's "Clients" CTA). Three blocks:
//   1. what the studio is / how the flow works
//   2. a quick link straight into Loop Studio
//   3. a terms & conditions disclosure (collapsed by default)
//
// Card chrome deliberately mirrors LooperTerminal.jsx's #looper-terminal-card
// (same glass, radius, mono type) so both /looper overlays read as one system.
// Rendered under the terminal's z-index 500 so an in-flight analysis run always
// wins the foreground.

import { useCallback, useEffect, useState } from 'react';

const STUDIO_HREF = '/dashboard/studio?tool=loop';

const TERMS = [
  ['Your audio, your rights', 'Only upload tracks you own or have permission to process. You keep every right you came in with — uploading here transfers nothing.'],
  ['What the loops are', 'Slices, grids and exports you generate from your own audio are yours to use. Analysis output (BPM, downbeat grid, slice points) is a measurement, not a licence to material you do not own.'],
  ['Processing', 'Files are sent to the loop analysis engine to detect tempo and downbeats and to cut slices. Processing is functional only — audio is not used to train models or sold on.'],
  ['No guaranteed retention', 'This is a working tool, not storage. Keep your own copy of anything you care about; sessions and uploads can be cleared at any time.'],
  ['Provided as-is', 'Beat detection is an estimate and can be wrong on rubato, live or heavily swung material. The tool ships without warranty — check exports before you use them in a release.'],
  ['Acceptable use', 'No unlawful, infringing or abusive uploads, and no attempts to overload or reverse the analysis service.'],
  ['Changes', 'These terms can change as the tool changes. Continued use after an update means you accept the current version.'],
];

export default function LooperInfoModal({ open, onClose }) {
  const [termsOpen, setTermsOpen] = useState(false);

  // Esc closes — same affordance as the terminal overlay's close button.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose?.();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      id="looper-info-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="looper-info-title"
      onClick={onBackdrop}
    >
      <div id="looper-info-card">
        <div id="looper-info-brand-row">
          <span id="looper-info-brand-label">About · Looper</span>
          <button
            type="button"
            id="looper-info-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            [ ✕ ]
          </button>
        </div>

        <h2 id="looper-info-title">SEAMLESS LOOPS</h2>

        <p className="looper-info-copy">
          Drop a track and the engine runs real tempo and downbeat analysis on it — not a
          guess from the filename. Once the grid is locked, the track is cut into
          beat-accurate loops that start and end on the downbeat, so they repeat without
          a click or a drift.
        </p>

        <ol id="looper-info-steps">
          <li><span className="looper-info-step-idx">01</span><span>Upload a track — WAV, MP3, AIFF, FLAC or M4A.</span></li>
          <li><span className="looper-info-step-idx">02</span><span>The engine detects BPM, downbeat offset and grid confidence.</span></li>
          <li><span className="looper-info-step-idx">03</span><span>Loop Studio opens with the slices — audition, edit, export.</span></li>
        </ol>

        <a id="looper-info-studio-link" href={STUDIO_HREF}>
          <span>Open Loop Studio</span>
          <span aria-hidden="true">↗</span>
        </a>

        <div id="looper-info-terms-section">
          <button
            type="button"
            id="looper-info-terms-toggle"
            onClick={() => setTermsOpen((v) => !v)}
            aria-expanded={termsOpen}
            aria-controls="looper-info-terms-body"
          >
            <span>Terms &amp; Conditions</span>
            <span aria-hidden="true">{termsOpen ? '−' : '+'}</span>
          </button>

          {termsOpen ? (
            <div id="looper-info-terms-body">
              {TERMS.map(([heading, body]) => (
                <div className="looper-info-term" key={heading}>
                  <h3 className="looper-info-term-heading">{heading}</h3>
                  <p className="looper-info-term-copy">{body}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div id="looper-info-footer">
          <span>looper · beta</span>
          <span>Using the tool means you accept these terms</span>
        </div>
      </div>

      <style jsx>{`
        #looper-info-overlay {
          position: fixed;
          inset: 0;
          z-index: 420;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background: rgba(42, 36, 32, 0.14);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        #looper-info-card {
          position: relative;
          width: 100%;
          max-width: 32rem;
          max-height: min(84dvh, 44rem);
          overflow-y: auto;
          padding: clamp(1.25rem, 5vw, 2rem);
          border-radius: 10px;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(212, 196, 171, 0.82);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.4), 0px 20px 40px rgba(0, 0, 0, 0.15);
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
          font-family: "Space Grotesk", system-ui, sans-serif;
        }
        #looper-info-brand-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.75rem;
        }
        #looper-info-brand-label {
          font-size: 0.82rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(42, 36, 32, 0.44);
          font-weight: 700;
          font-family: "Space Mono", monospace;
        }
        #looper-info-close-btn {
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
        #looper-info-close-btn:hover,
        #looper-info-close-btn:focus-visible {
          background: #2a2420;
          color: #fff;
        }
        #looper-info-title {
          margin: 0 0 0.85rem;
          color: #2a2420;
          font-size: clamp(1.4rem, 5vw, 2.2rem);
          line-height: 1.05;
          letter-spacing: -0.03em;
          font-family: "Doto", "Space Mono", monospace;
          font-weight: 700;
        }
        .looper-info-copy {
          margin: 0 0 1rem;
          font-size: 0.9rem;
          line-height: 1.55;
          color: rgba(42, 36, 32, 0.78);
        }
        #looper-info-steps {
          list-style: none;
          margin: 0 0 1.25rem;
          padding: 0.85rem 0.95rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          border: 1px solid rgba(212, 196, 171, 0.6);
          border-radius: 8px;
          background: rgba(245, 241, 223, 0.45);
        }
        #looper-info-steps li {
          display: grid;
          grid-template-columns: 2rem 1fr;
          gap: 0.5rem;
          align-items: baseline;
          font-family: "Space Mono", monospace;
          font-size: 0.72rem;
          line-height: 1.55;
          color: rgba(42, 36, 32, 0.72);
        }
        .looper-info-step-idx {
          color: rgba(42, 36, 32, 0.38);
          letter-spacing: 0.08em;
        }
        #looper-info-studio-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          box-sizing: border-box;
          padding: 0.85rem 1rem;
          border-radius: 999px;
          background: #2a2420;
          color: #fff;
          text-decoration: none;
          font-family: "Space Mono", monospace;
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          transition: transform 200ms ease, box-shadow 200ms ease;
        }
        #looper-info-studio-link:hover,
        #looper-info-studio-link:focus-visible {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(42, 36, 32, 0.22);
        }
        #looper-info-terms-section {
          margin-top: 1.1rem;
          border-top: 1px solid rgba(212, 196, 171, 0.5);
          padding-top: 0.9rem;
        }
        #looper-info-terms-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 0.55rem 0;
          background: none;
          border: none;
          cursor: pointer;
          font-family: "Space Mono", monospace;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(42, 36, 32, 0.6);
        }
        #looper-info-terms-toggle:hover { color: #2a2420; }
        #looper-info-terms-body {
          max-height: 13rem;
          overflow-y: auto;
          padding: 0.25rem 0.15rem 0.25rem 0;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          scrollbar-width: thin;
        }
        .looper-info-term-heading {
          margin: 0 0 0.2rem;
          font-family: "Space Mono", monospace;
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(42, 36, 32, 0.62);
        }
        .looper-info-term-copy {
          margin: 0;
          font-size: 0.8rem;
          line-height: 1.5;
          color: rgba(42, 36, 32, 0.7);
        }
        #looper-info-footer {
          font-family: "Space Mono", monospace;
          font-size: 0.62rem;
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
          #looper-info-overlay { padding: 0.5rem; }
          #looper-info-card { padding: 1.25rem; }
          #looper-info-footer { flex-direction: column; align-items: flex-start; gap: 0.35rem; }
        }
      `}</style>
    </div>
  );
}
