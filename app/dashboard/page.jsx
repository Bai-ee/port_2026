'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { useAuth } from '../../AuthContext';
import DashboardPage from '../../DashboardPage';
import InternalPageBackground from '../../InternalPageBackground';
import { internalPageGlassCardStyle } from '../../pageSurfaceSystem';

export default function DashboardRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showLoadingCard, setShowLoadingCard] = useState(true);
  const [bgReady, setBgReady] = useState(false);
  const loadingOverlayRef = useRef(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?redirect=/dashboard');
    }
  }, [user, loading, router]);

  // Fade out the loading card only once three conditions are met:
  //   1. auth has resolved         (loading === false)
  //   2. the user is present       (!!user)
  //   3. the three.js canvas has rendered its first frame (bgReady)
  // The three.js background stays mounted in the parent tree, so no canvas swap.
  useEffect(() => {
    if (loading || !user || !bgReady) return;
    if (!loadingOverlayRef.current) return;
    const tween = gsap.to(loadingOverlayRef.current, {
      autoAlpha: 0,
      duration: 0.45,
      ease: 'power2.inOut',
      onComplete: () => setShowLoadingCard(false),
    });
    return () => tween.kill();
  }, [loading, user, bgReady]);

  const dashboardReady = !loading && !!user;

  return (
    <div style={{ minHeight: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <InternalPageBackground onReady={() => setBgReady(true)} />

      {dashboardReady ? (
        <div style={{
          opacity: showLoadingCard ? 0 : 1,
          transition: 'opacity 0.35s ease',
          pointerEvents: showLoadingCard ? 'none' : 'auto',
        }}>
          <DashboardPage />
        </div>
      ) : null}

      {showLoadingCard ? (
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
            {/* Brand row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
              <img src="/img/sig.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: 'auto', display: 'block' }} />
              <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
                Dashboard Access
              </span>
              <span
                aria-hidden="true"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.4rem', height: '2.4rem', borderRadius: '999px', background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(42,36,32,0.12)' }}
              >
                <span style={{ width: '0.46rem', height: '0.46rem', borderRadius: '999px', background: '#4A9E5C' }} />
              </span>
            </div>

            {/* Scrolling marquee heading */}
            <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
              <div className="loading-marquee-track">
                {['a', 'b'].map((k) => (
                  <span
                    key={k}
                    aria-hidden={k === 'b' ? 'true' : undefined}
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
                    {'LOADING YOUR DASHBOARD\u00A0\u00A0\u00B7\u00A0\u00A0'}
                  </span>
                ))}
              </div>
            </div>

            <p style={{ margin: 0, color: 'rgba(42,36,32,0.66)', lineHeight: 1.6, fontFamily: '"Space Grotesk", system-ui, sans-serif', textAlign: 'center' }}>
              Loading the latest dashboard state.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
