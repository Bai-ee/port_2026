import { useEffect, useState } from 'react';
import { internalPageGlassCardStyle } from '../../pageSurfaceSystem';

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
          background: 'rgba(255, 252, 248, 0.94)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4), 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15)',
          border: '1px solid #E4E4E4',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
          <img src="/img/profile2_400x400.png?v=1774582808" alt="" aria-hidden="true" style={{ width: '2.75rem', height: '2.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.35)', display: 'block' }} />
          <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            {isMobile ? 'Access' : 'Dashboard Access'}
          </span>
          <img
            src="/img/circle_logo.png"
            alt=""
            aria-hidden="true"
            style={{ width: '2.4rem', height: '2.4rem', borderRadius: '50%', objectFit: 'contain', display: 'block' }}
          />
        </div>

        <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
          <div className="loading-marquee-track">
            {['a', 'b'].map((k) => (
              <div key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                {['LOADING YOUR DASHBOARD', '\u2022'].map((w, j) => (
                  <span
                    key={j}
                    style={{
                      margin: 0,
                      flexShrink: 0,
                      color: '#2a2420',
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

        <p style={{ margin: 0, color: 'rgba(42,36,32,0.66)', lineHeight: 1.6, fontFamily: '"Space Grotesk", system-ui, sans-serif', textAlign: 'center' }}>
          {isMobile ? 'Loading Dashboard' : 'Loading the latest dashboard state.'}
        </p>
      </div>
    </div>
  );
}
