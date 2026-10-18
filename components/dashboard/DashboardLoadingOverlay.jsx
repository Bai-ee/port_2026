import { useEffect, useState } from 'react';
import { internalPageGlassCardStyle, marqueeCardEdgeStyle, marqueeEdgeFadeStyle } from '../../pageSurfaceSystem';

export default function DashboardLoadingOverlay({
  dashboardReady,
  loadingOverlayRef,
  showLoadingCard,
}) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!showLoadingCard) return null;

  return (
    <div
      ref={loadingOverlayRef}
      id="dashboard-loading-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(1rem, 5vw, 2rem)',
        boxSizing: 'border-box',
        pointerEvents: dashboardReady ? 'none' : 'auto',
      }}
    >
      <style>{`
        @keyframes loading-marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .loading-marquee-track {
          display: flex;
          align-items: center;
          width: max-content;
          animation: loading-marquee 12s linear infinite;
          will-change: transform;
        }
      `}</style>
      <div
        style={{
          width: '100%',
          maxWidth: '30rem',
          padding: 'clamp(1.25rem, 5vw, 2rem)',
          borderRadius: '1.1rem',
          boxSizing: 'border-box',
          overflow: 'hidden',
          ...internalPageGlassCardStyle,
          background: 'color-mix(in srgb, var(--t-raised) 94%, transparent)',
          // Shared marquee-card edge: faint top/bottom hairlines so only the marquee reads.
          ...marqueeCardEdgeStyle,
        }}
      >
        {/* Brand row content hidden; the row keeps its 2.75rem height so the card stays the same size. */}
        <div id="dashboard-loading-brand-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem', height: '2.75rem' }}>
          {/* <img src="/img/profile2_400x400.png?v=1774582808" alt="" aria-hidden="true" style={{ width: '2.75rem', height: '2.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid color-mix(in srgb, var(--t-surface) 35%, transparent)', display: 'block' }} />
          <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--t-text) 44%, transparent)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            {isMobile ? 'Access' : 'Dashboard Access'}
          </span>
          <img
            src="/img/circle_logo.png"
            alt=""
            aria-hidden="true"
            style={{ width: '2.4rem', height: '2.4rem', borderRadius: '50%', objectFit: 'contain', display: 'block' }}
          /> */}
        </div>

        <div id="dashboard-loading-marquee-viewport" style={{ width: '100%', overflow: 'hidden', margin: '0 0 1.85rem', ...marqueeEdgeFadeStyle }}>
          <div className="loading-marquee-track">
            {['a', 'b'].map((k) => (
              <div key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                {['LOADING YOUR DASHBOARD', '\u2022'].map((w, j) => (
                  <span
                    key={j}
                    style={{
                      margin: 0,
                      flexShrink: 0,
                      color: 'var(--t-text)',
                      fontSize: 'clamp(2rem, 8.5vw, 7rem)',
                      lineHeight: 1,
                      letterSpacing: '-0.04em',
                      fontFamily: '"Doto", "Space Mono", monospace',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {w}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Signature hidden; the row keeps the sig's height so the card stays the same size. */}
        <div id="dashboard-loading-sig-row" style={{ display: 'flex', justifyContent: 'center', height: 'clamp(1.6rem, 4.5vw, 2.4rem)' }}>
          {/* <img
            src="/img/sig.png"
            alt="Signature"
            style={{ height: 'clamp(1.6rem, 4.5vw, 2.4rem)', width: 'auto', objectFit: 'contain', display: 'block' }}
          /> */}
        </div>
      </div>
    </div>
  );
}
